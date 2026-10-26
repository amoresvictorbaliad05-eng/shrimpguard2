import hmac
import io
import math
import os
import re
import secrets
import zipfile
from datetime import datetime, timedelta
from functools import wraps
from xml.sax.saxutils import escape

from flask import Flask, flash, jsonify, redirect, render_template, request, send_file, session, url_for
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import insert, select, text
from sqlalchemy.engine import URL
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from werkzeug.security import check_password_hash, generate_password_hash

app = Flask(__name__)


def load_secret_key():
    configured_key = os.getenv("SECRET_KEY")
    if configured_key:
        return configured_key

    os.makedirs(app.instance_path, exist_ok=True)
    key_path = os.path.join(app.instance_path, "secret_key")
    try:
        with open(key_path, "x", encoding="ascii") as key_file:
            key_file.write(secrets.token_hex(32))
    except FileExistsError:
        pass

    with open(key_path, "r", encoding="ascii") as key_file:
        secret_key = key_file.read().strip()
    if not secret_key:
        raise RuntimeError("The Flask session secret key is empty.")
    return secret_key


app.config["SECRET_KEY"] = load_secret_key()
app.config["PERMANENT_SESSION_LIFETIME"] = timedelta(days=30)
app.config["SESSION_REFRESH_EACH_REQUEST"] = True

def get_database_uri():
    configured_database_url = os.getenv("DATABASE_URL")
    if configured_database_url:
        return configured_database_url

    return URL.create(
        "mysql+pymysql",
        username=os.getenv("DB_USER", "root"),
        password=os.getenv("DB_PASSWORD") or None,
        host=os.getenv("DB_HOST", "127.0.0.1"),
        port=int(os.getenv("DB_PORT") or "3306"),
        database=os.getenv("DB_NAME", "shrimpguard_users"),
        query={"charset": "utf8mb4"},
    )


app.config["SQLALCHEMY_DATABASE_URI"] = get_database_uri()
app.config["SQLALCHEMY_TRACK_MODIFICATIONS"] = False
app.config["SQLALCHEMY_ENGINE_OPTIONS"] = {"pool_pre_ping": True}

db = SQLAlchemy(app)

sensor_readings = db.Table(
    "sensors",
    db.metadata,
    db.Column("ph_level", db.Float, nullable=False),
    db.Column("temperature", db.Float, nullable=False),
    db.Column("date", db.String(45), nullable=False),
    db.Column("status", db.String(45), nullable=False),
    schema=(
        None
        if str(app.config["SQLALCHEMY_DATABASE_URI"]).startswith("sqlite")
        else "shrimpguard_users"
    ),
)


@app.context_processor
def inject_logout_csrf_token():
    if session.get("user_id") is None:
        return {"logout_csrf_token": ""}
    return {
        "logout_csrf_token": session.setdefault(
            "logout_csrf_token", secrets.token_urlsafe(32)
        )
    }


def table_args_for_schema(schema_name):
    database_url = str(app.config["SQLALCHEMY_DATABASE_URI"])
    if database_url.startswith("sqlite"):
        return {}
    return {"schema": schema_name}


def serialize_sensor_reading(reading):
    return {
        "temperature": reading["temperature"],
        "ph": reading["ph_level"],
        "recorded_at": reading["date"],
        "status": reading["status"],
    }


class AlertLog(db.Model):
    __tablename__ = "alert_logs"
    __table_args__ = table_args_for_schema("shrimpguard_sensors")

    id = db.Column(db.Integer, primary_key=True)
    alert_type = db.Column(db.String(100), nullable=False)
    severity = db.Column(db.String(50), nullable=False)
    message = db.Column(db.Text, nullable=False)
    created_at = db.Column(db.DateTime, nullable=False, default=datetime.utcnow)

    def to_dict(self):
        return {
            "id": self.id,
            "alert_type": self.alert_type,
            "severity": self.severity,
            "message": self.message,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }


class User(db.Model):
    __tablename__ = "users"
    __table_args__ = table_args_for_schema("shrimpguard_users")

    email = db.Column(db.String(255), primary_key=True)
    user_name = db.Column("name", db.String(80), nullable=False, unique=True)
    role = db.Column(db.String(50), nullable=False)
    password_hash = db.Column("password", db.String(255), nullable=False)
    status = db.Column(db.String(20), nullable=False, default="Active")
    last_login = db.Column(db.DateTime, nullable=True)

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        if self.password_hash.startswith(("scrypt:", "pbkdf2:")):
            return check_password_hash(self.password_hash, password)
        return hmac.compare_digest(self.password_hash, password)

    def password_needs_rehash(self):
        return not self.password_hash.startswith(("scrypt:", "pbkdf2:"))


def role_required(required_role):
    def decorate(view):
        @wraps(view)
        def wrapped(*args, **kwargs):
            user_id = session.get("user_id")
            if user_id is None:
                return redirect(url_for("login"))

            try:
                user = db.session.get(User, user_id)
            except SQLAlchemyError:
                db.session.rollback()
                return "Authentication service is temporarily unavailable. Please retry.", 503

            if user is None:
                session.clear()
                return redirect(url_for("login"))

            actual_role = user.role.strip().casefold()
            if actual_role != required_role.casefold():
                if actual_role == "admin":
                    return redirect(url_for("admin_home"))
                if actual_role == "client":
                    return redirect(url_for("dashboard"))
                session.clear()
                return redirect(url_for("login"))

            return view(*args, **kwargs)

        return wrapped

    return decorate


@app.cli.command("init-db")
def init_db_command():
    with app.app_context():
        db.create_all()
        print("Database tables created successfully.")


with app.app_context():
    try:
        db.engine.connect()
        db.create_all()
    except Exception:
        pass


@app.route("/api/readings", methods=["POST"])
def create_reading():
    payload = request.get_json(silent=True) or {}
    required_fields = ["temperature", "ph"]

    if not all(field in payload for field in required_fields):
        return jsonify({"error": "Missing required water quality fields."}), 400

    try:
        temperature = float(payload["temperature"])
        ph = float(payload["ph"])
        recorded_at = (
            datetime.fromisoformat(payload["recorded_at"])
            if payload.get("recorded_at")
            else datetime.utcnow()
        )
    except (TypeError, ValueError):
        return jsonify({"error": "Reading values must be valid numbers and date."}), 400
    if not math.isfinite(temperature) or not math.isfinite(ph):
        return jsonify({"error": "Reading values must be finite numbers."}), 400

    status = (
        "Critical"
        if temperature < 26 or temperature > 32 or ph < 7.5 or ph > 8.5
        else "Normal"
    )
    try:
        db.session.execute(
            insert(sensor_readings).values(
                ph_level=ph,
                temperature=temperature,
                date=recorded_at.isoformat(),
                status=status,
            )
        )
        db.session.commit()
        return jsonify(
            {
                "temperature": temperature,
                "ph": ph,
                "recorded_at": recorded_at.isoformat(),
                "status": status,
            }
        ), 201
    except SQLAlchemyError:
        db.session.rollback()
        app.logger.exception("Unable to save sensor reading.")
        return jsonify({"error": "Unable to save sensor reading."}), 503


@app.route("/api/readings/latest")
@role_required("Client")
def latest_reading():
    try:
        reading = db.session.execute(
            select(sensor_readings)
            .order_by(sensor_readings.c.date.desc())
            .limit(1)
        ).mappings().first()
    except SQLAlchemyError:
        db.session.rollback()
        app.logger.exception("Unable to load the latest sensor reading.")
        return jsonify({"error": "Unable to load sensor readings."}), 503
    if not reading:
        return jsonify(None)
    return jsonify(serialize_sensor_reading(reading))


@app.route("/api/readings/history")
@role_required("Client")
def reading_history():
    try:
        readings = db.session.execute(
            select(sensor_readings)
            .order_by(sensor_readings.c.date.desc())
            .limit(20)
        ).mappings().all()
    except SQLAlchemyError:
        db.session.rollback()
        app.logger.exception("Unable to load sensor reading history.")
        return jsonify({"error": "Unable to load sensor readings."}), 503
    return jsonify([serialize_sensor_reading(reading) for reading in reversed(readings)])


@app.route("/historical/export", methods=["POST"])
@role_required("Client")
def export_historical_data():
    payload = request.get_json(silent=True)
    if not isinstance(payload, dict) or not isinstance(payload.get("readings"), list):
        return jsonify({"error": "A list of historical readings is required."}), 400
    if len(payload["readings"]) > 10000:
        return jsonify({"error": "Too many readings to export at once."}), 400

    rows = [
        ("Date", "Temperature (°C)", "pH", "Status"),
    ]
    for reading in payload["readings"]:
        if not isinstance(reading, dict):
            return jsonify({"error": "A historical reading is invalid."}), 400
        try:
            recorded_at = datetime.fromisoformat(reading["recorded_at"])
            temperature = float(reading["temperature"])
            ph = float(reading["ph"])
        except (KeyError, TypeError, ValueError):
            return jsonify({"error": "A historical reading has invalid values."}), 400
        if not math.isfinite(temperature) or not math.isfinite(ph):
            return jsonify({"error": "Readings must contain finite numeric values."}), 400
        status = (
            "Critical"
            if temperature < 26
            or temperature > 32
            or ph < 7.5
            or ph > 8.5
            else "Normal"
        )
        rows.append(
            (
                recorded_at.strftime("%Y-%m-%d %H:%M:%S"),
                format(temperature, ".15g"),
                format(ph, ".15g"),
                status,
            )
        )

    def text_cell(reference, value):
        return (
            f'<c r="{reference}" t="inlineStr"><is><t xml:space="preserve">'
            f"{escape(str(value))}</t></is></c>"
        )

    worksheet_rows = []
    for row_number, row in enumerate(rows, start=1):
        cells = [
            text_cell(f"A{row_number}", row[0]),
            text_cell(f"B{row_number}", row[1]) if row_number == 1 else f'<c r="B{row_number}"><v>{row[1]}</v></c>',
            text_cell(f"C{row_number}", row[2]) if row_number == 1 else f'<c r="C{row_number}"><v>{row[2]}</v></c>',
            text_cell(f"D{row_number}", row[3]),
        ]
        worksheet_rows.append(f'<row r="{row_number}">{"".join(cells)}</row>')

    worksheet = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        f'<sheetData>{"".join(worksheet_rows)}</sheetData></worksheet>'
    )
    workbook = io.BytesIO()
    with zipfile.ZipFile(workbook, "w", zipfile.ZIP_DEFLATED) as excel_file:
        excel_file.writestr(
            "[Content_Types].xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            "</Types>",
        )
        excel_file.writestr(
            "_rels/.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
            "</Relationships>",
        )
        excel_file.writestr(
            "xl/workbook.xml",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets><sheet name="Historical Data" sheetId="1" r:id="rId1"/></sheets></workbook>',
        )
        excel_file.writestr(
            "xl/_rels/workbook.xml.rels",
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
            "</Relationships>",
        )
        excel_file.writestr("xl/worksheets/sheet1.xml", worksheet)

    workbook.seek(0)
    return send_file(
        workbook,
        as_attachment=True,
        download_name="shrimpguard-historical-data.xlsx",
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@app.route("/")
def landing():
    user_id = session.get("user_id")
    if user_id is not None:
        try:
            user = db.session.get(User, user_id)
        except SQLAlchemyError:
            db.session.rollback()
            return "Authentication service is temporarily unavailable. Please retry.", 503

        if user is None:
            session.clear()
        else:
            role = user.role.strip().casefold()
            if role == "admin":
                return redirect(url_for("admin_home"))
            if role == "client":
                return redirect(url_for("dashboard"))
            session.clear()

    return render_template("landing.html")


@app.route("/dashboard")
@role_required("Client")
def dashboard():
    try:
        with db.engine.connect() as connection:
            connection.execute(text("SELECT 1"))
    except Exception:
        pass
    return render_template("dashboard.html")


@app.route("/admin")
@role_required("Admin")
def admin_dashboard():
    try:
        with db.engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        users = User.query.order_by(User.email.asc()).all()
        active_users = sum(user.status.strip().casefold() == "active" for user in users)
        inactive_users = sum(user.status.strip().casefold() == "inactive" for user in users)
        system_online = True
    except SQLAlchemyError:
        db.session.rollback()
        users = []
        active_users = 0
        inactive_users = 0
        system_online = False

    return render_template(
        "admin.html",
        total_users=len(users),
        active_users=active_users,
        inactive_users=inactive_users,
        system_online=system_online,
        users=users,
        admin_csrf_token=session.setdefault("admin_csrf_token", secrets.token_urlsafe(32)),
    )


@app.route("/admin/users", methods=["POST"])
@role_required("Admin")
def create_user():
    expected_token = session.get("admin_csrf_token", "")
    submitted_token = request.form.get("csrf_token", "")
    if not expected_token or not hmac.compare_digest(expected_token, submitted_token):
        flash("Your request expired. Please try again.", "error")
        return redirect(url_for("admin_dashboard"))

    user_name = request.form.get("name", "").strip()
    email = request.form.get("email", "").strip().lower()
    role = request.form.get("role", "").strip()
    status = request.form.get("status", "").strip()
    password = request.form.get("password", "")

    if not user_name or len(user_name) > 80:
        flash("Enter a name between 1 and 80 characters.", "error")
    elif not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) or len(email) > 255:
        flash("Enter a valid email address.", "error")
    elif role not in {"Admin", "Client"}:
        flash("Choose Admin or Client as the role.", "error")
    elif status not in {"Active", "Inactive"}:
        flash("Choose Active or Inactive as the status.", "error")
    elif len(password) < 8:
        flash("Use a password with at least 8 characters.", "error")
    elif User.query.filter_by(email=email).first():
        flash("An account with that email already exists.", "error")
    elif User.query.filter_by(user_name=user_name).first():
        flash("A user with that name already exists.", "error")
    else:
        user = User(user_name=user_name, email=email, role=role, status=status)
        user.set_password(password)
        db.session.add(user)
        try:
            db.session.commit()
        except SQLAlchemyError:
            db.session.rollback()
            flash("The user could not be saved. Please try again.", "error")
        else:
            session["admin_csrf_token"] = secrets.token_urlsafe(32)
            flash("User added successfully.", "success")

    return redirect(url_for("admin_dashboard"))


@app.route("/admin/users/edit", methods=["POST"])
@role_required("Admin")
def edit_user():
    expected_token = session.get("admin_csrf_token", "")
    submitted_token = request.form.get("csrf_token", "")
    if not expected_token or not hmac.compare_digest(expected_token, submitted_token):
        flash("Your request expired. Please try again.", "error")
        return redirect(url_for("admin_dashboard"))

    current_email = request.form.get("current_email", "").strip().lower()
    user = db.session.get(User, current_email)
    if user is None:
        flash("That user could not be found.", "error")
        return redirect(url_for("admin_dashboard"))

    user_name = request.form.get("name", "").strip()
    email = request.form.get("email", "").strip().lower()
    role = request.form.get("role", "").strip()
    status = request.form.get("status", "").strip()

    if not user_name or len(user_name) > 80:
        flash("Enter a name between 1 and 80 characters.", "error")
    elif not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) or len(email) > 255:
        flash("Enter a valid email address.", "error")
    elif role not in {"Admin", "Client"}:
        flash("Choose Admin or Client as the role.", "error")
    elif status not in {"Active", "Inactive"}:
        flash("Choose Active or Inactive as the status.", "error")
    elif User.query.filter(User.email != current_email, User.email == email).first():
        flash("An account with that email already exists.", "error")
    elif User.query.filter(User.email != current_email, User.user_name == user_name).first():
        flash("A user with that name already exists.", "error")
    elif session.get("user_id") == current_email and (role != "Admin" or status != "Active"):
        flash("You cannot remove Admin access from your current account.", "error")
    else:
        user.user_name = user_name
        user.email = email
        user.role = role
        user.status = status
        try:
            db.session.commit()
        except SQLAlchemyError:
            db.session.rollback()
            flash("The user could not be updated. Please try again.", "error")
        else:
            if session.get("user_id") == current_email:
                session["user_id"] = email
            session["admin_csrf_token"] = secrets.token_urlsafe(32)
            flash("User updated successfully.", "success")

    return redirect(url_for("admin_dashboard"))


@app.route("/admin/dashboard")
@role_required("Admin")
def admin_home():
    try:
        with db.engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        users = User.query.all()
        total_users = len(users)
        active_users = sum(user.status.strip().casefold() == "active" for user in users)
        inactive_users = sum(user.status.strip().casefold() == "inactive" for user in users)
        system_online = True
    except SQLAlchemyError:
        db.session.rollback()
        total_users = 0
        active_users = 0
        inactive_users = 0
        system_online = False

    return render_template(
        "admin_dashboard.html",
        total_users=total_users,
        active_users=active_users,
        inactive_users=inactive_users,
        system_online=system_online,
    )


@app.route("/login", methods=["GET", "POST"])
def login():
    error = None

    if request.method == "GET":
        user_id = session.get("user_id")
        if user_id is not None:
            try:
                current_user = db.session.get(User, user_id)
            except SQLAlchemyError:
                db.session.rollback()
                current_user = None
                error = "Sign-in is temporarily unavailable. Please try again."

            if current_user is not None:
                role = current_user.role.strip().casefold()
                if role == "admin":
                    return redirect(url_for("admin_home"))
                if role == "client":
                    return redirect(url_for("dashboard"))
                session.clear()

        session["login_csrf_token"] = secrets.token_urlsafe(32)

    else:
        expected_token = session.get("login_csrf_token", "")
        submitted_token = request.form.get("csrf_token", "")
        user_name = request.form.get("user_name", "").strip()
        password = request.form.get("password", "")

        if not expected_token or not hmac.compare_digest(expected_token, submitted_token):
            error = "Your sign-in request expired. Please try again."
        elif not user_name or not password:
            error = "Enter your username and password."
        else:
            try:
                user = User.query.filter(
                    db.or_(
                        User.user_name == user_name,
                        User.email == user_name.lower(),
                    )
                ).first()
            except SQLAlchemyError:
                db.session.rollback()
                user = None
                error = "Sign-in is temporarily unavailable. Please try again."

            if error is None:
                try:
                    password_is_valid = user is not None and user.check_password(password)
                except (TypeError, ValueError):
                    password_is_valid = False

                if not password_is_valid:
                    error = "Username or password is incorrect."
                else:
                    role = user.role.strip().casefold()
                    if role not in {"admin", "client"}:
                        error = "This account does not have an authorized role."
                    else:
                        user.last_login = datetime.utcnow()
                        if user.password_needs_rehash():
                            user.set_password(password)

                        try:
                            db.session.commit()
                        except SQLAlchemyError:
                            db.session.rollback()
                            error = "Sign-in is temporarily unavailable. Please try again."

                        if error is None:
                            session.clear()
                            session.permanent = True
                            session["user_id"] = user.email
                            destination = "admin_home" if role == "admin" else "dashboard"
                            return redirect(url_for(destination))

    return render_template("login.html", error=error)


@app.route("/signup", methods=["GET", "POST"])
def signup():
    error = None

    if request.method == "GET":
        session["signup_csrf_token"] = secrets.token_urlsafe(32)
    else:
        expected_token = session.get("signup_csrf_token", "")
        submitted_token = request.form.get("csrf_token", "")
        user_name = request.form.get("user_name", "").strip()
        email = request.form.get("email", "").strip().lower()
        password = request.form.get("password", "")
        confirm_password = request.form.get("confirm_password", "")

        if not expected_token or not hmac.compare_digest(expected_token, submitted_token):
            error = "Your sign-up request expired. Please try again."
        elif not user_name or len(user_name) > 80:
            error = "Enter a username between 1 and 80 characters."
        elif not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) or len(email) > 255:
            error = "Enter a valid email address."
        elif len(password) < 8:
            error = "Use a password with at least 8 characters."
        elif password != confirm_password:
            error = "The passwords do not match."
        else:
            try:
                existing_user = User.query.filter(
                    (User.email == email) | (User.user_name == user_name)
                ).first()
            except SQLAlchemyError:
                db.session.rollback()
                error = "Sign-up is temporarily unavailable. Please try again."
            else:
                if existing_user is not None:
                    error = "An account with that username or email already exists."
                else:
                    user = User(
                        user_name=user_name,
                        email=email,
                        role="Client",
                        status="Active",
                    )
                    user.set_password(password)
                    db.session.add(user)
                    try:
                        db.session.commit()
                    except IntegrityError:
                        db.session.rollback()
                        error = "An account with that username or email already exists."
                    except SQLAlchemyError:
                        db.session.rollback()
                        error = "Sign-up is temporarily unavailable. Please try again."
                    else:
                        session.pop("signup_csrf_token", None)
                        flash("Your account was created. Please sign in.", "success")
                        return redirect(url_for("login"))

        session["signup_csrf_token"] = secrets.token_urlsafe(32)

    return render_template("signup.html", error=error)


@app.route("/logout", methods=["POST"])
def logout():
    expected_token = session.get("logout_csrf_token", "")
    submitted_token = request.form.get("csrf_token", "")
    if not expected_token or not hmac.compare_digest(expected_token, submitted_token):
        return "Invalid logout request.", 400

    session.clear()
    return redirect(url_for("login"))


@app.route("/monitoring")
@role_required("Client")
def monitoring():
    return render_template("monitoring.html")


@app.route("/historical")
@role_required("Client")
def historical():
    return render_template("historical.html")


@app.route("/alerts")
@role_required("Client")
def alerts():
    return render_template("alerts.html")


@app.route("/analytics")
@role_required("Client")
def analytics():
    return render_template("analytics.html")


@app.route("/settings", methods=["GET", "POST"])
@role_required("Client")
def settings():
    user_email = session.get("user_id")
    user = db.session.get(User, user_email)
    if user is None:
        session.clear()
        return redirect(url_for("login"))

    csrf_token = session.setdefault("settings_csrf_token", secrets.token_urlsafe(32))
    if request.method == "POST":
        submitted_token = request.form.get("csrf_token", "")
        action = request.form.get("action", "")
        if not hmac.compare_digest(csrf_token, submitted_token):
            flash("Your request expired. Please try again.", "error")
        elif action == "profile":
            user_name = request.form.get("name", "").strip()
            email = request.form.get("email", "").strip().lower()
            if not user_name or len(user_name) > 80:
                flash("Enter a name between 1 and 80 characters.", "error")
            elif not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email) or len(email) > 255:
                flash("Enter a valid email address.", "error")
            elif User.query.filter(User.email != user_email, User.email == email).first():
                flash("An account with that email already exists.", "error")
            elif User.query.filter(User.email != user_email, User.user_name == user_name).first():
                flash("A user with that name already exists.", "error")
            else:
                user.user_name = user_name
                user.email = email
                try:
                    db.session.commit()
                except SQLAlchemyError:
                    db.session.rollback()
                    flash("Your profile could not be saved. Please try again.", "error")
                else:
                    session["user_id"] = email
                    session["settings_csrf_token"] = secrets.token_urlsafe(32)
                    flash("Profile updated successfully.", "success")
        elif action == "password":
            current_password = request.form.get("current_password", "")
            new_password = request.form.get("new_password", "")
            confirm_password = request.form.get("confirm_password", "")
            if not user.check_password(current_password):
                flash("Your current password is incorrect.", "error")
            elif len(new_password) < 8:
                flash("Use a new password with at least 8 characters.", "error")
            elif new_password != confirm_password:
                flash("The new passwords do not match.", "error")
            else:
                user.set_password(new_password)
                try:
                    db.session.commit()
                except SQLAlchemyError:
                    db.session.rollback()
                    flash("Your password could not be updated. Please try again.", "error")
                else:
                    session["settings_csrf_token"] = secrets.token_urlsafe(32)
                    flash("Password updated successfully.", "success")
        else:
            flash("Choose a valid settings action.", "error")

        return redirect(url_for("settings"))

    return render_template("settings.html", user=user, settings_csrf_token=csrf_token)


if __name__ == "__main__":
    app.run(debug=True)