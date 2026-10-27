function updateDeviceTime() {
    document.getElementById("time").textContent =
        new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function getAlertData(reading) {
    const alerts = [];

    if (!reading) {
        return alerts;
    }

    if (reading.temperature < 26 || reading.temperature > 32) {
        const severity = reading.temperature < 24 || reading.temperature > 34 ? "Critical" : "Warning";
        alerts.push({
            severity,
            title: `${severity} Temperature Alert`,
            message: `Temperature is currently ${reading.temperature} °C, outside the recommended range of 26–32 °C.`,
            notification: `SMS: Pond temperature is ${reading.temperature} °C. Check cooling or heating systems and respond promptly.`
        });
    }

    if (reading.ph < 7.5 || reading.ph > 8.5) {
        const severity = reading.ph < 7.0 || reading.ph > 9.0 ? "Critical" : "Warning";
        alerts.push({
            severity,
            title: `${severity} pH Alert`,
            message: `pH is currently ${reading.ph}, outside the recommended range of 7.5–8.5.`,
            notification: `SMS: pH is ${reading.ph}. Adjust water treatment and verify the pH control system.`
        });
    }

    return alerts;
}

function formatDateTime(isoString) {
    if (!isoString) {
        return "-";
    }

    const date = new Date(isoString);
    return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function updateSummaryCards(history, latestReading) {
    const alertsFromHistory = history.flatMap((reading) => getAlertData(reading));
    const criticalAlerts = alertsFromHistory.filter((alert) => alert.severity === "Critical").length;
    const warningAlerts = alertsFromHistory.filter((alert) => alert.severity === "Warning").length;
    const resolvedAlerts = history.filter((reading) => getAlertData(reading).length === 0).length;
    const unreadNotifications = alertsFromHistory.length;

    document.getElementById("critical-alerts-count").textContent = criticalAlerts;
    document.getElementById("warning-alerts-count").textContent = warningAlerts;
    document.getElementById("resolved-alerts-count").textContent = resolvedAlerts;
    document.getElementById("unread-notifications-count").textContent = unreadNotifications;

    const activeAlerts = latestReading ? getAlertData(latestReading) : [];
    const activeAlertsContainer = document.getElementById("active-alerts");

    if (activeAlerts.length === 0) {
        activeAlertsContainer.innerHTML = `
            <div class="status-box">
                <svg class="ui-icon"><use href="#icon-check-circle"></use></svg> No active alerts right now. All monitored parameters are within the recommended range.
            </div>
        `;
    } else {
        activeAlertsContainer.innerHTML = activeAlerts.map((item) => `
            <div class="alert">
                <svg class="ui-icon"><use href="${item.severity === "Critical" ? "#icon-alert" : "#icon-bell"}"></use></svg> ${item.title}
                <br>
                ${item.message}
                <br><br>
                <strong>Notification:</strong> ${item.notification}
            </div>
        `).join("");
    }

    const statusContainer = document.getElementById("notification-status");
    statusContainer.className = "notification-status-panel";
    statusContainer.innerHTML = `
        <div class="notification-status-header">
            <h3>Notification Status</h3>
            <button type="button" class="notification-status-action">View History</button>
        </div>

        <div class="notification-status-subtitle">SMS Notification (SIM800L)</div>

        <div class="notification-status-row">
            <div class="notification-status-main">
                <div class="notification-status-icon success"><svg class="ui-icon"><use href="#icon-check"></use></svg></div>
                <div class="notification-status-copy">
                    <div class="notification-status-value">0</div>
                    <div class="notification-status-label">Sent</div>
                </div>
            </div>
            <div class="notification-status-date">Today</div>
        </div>

        <div class="notification-status-row">
            <div class="notification-status-main">
                <div class="notification-status-icon success"><svg class="ui-icon"><use href="#icon-check"></use></svg></div>
                <div class="notification-status-copy">
                    <div class="notification-status-value">0</div>
                    <div class="notification-status-label">Delivered</div>
                </div>
            </div>
            <div class="notification-status-date">Today</div>
        </div>

        <div class="notification-status-row">
            <div class="notification-status-main">
                <div class="notification-status-icon danger"><svg class="ui-icon"><use href="#icon-x"></use></svg></div>
                <div class="notification-status-copy">
                    <div class="notification-status-value">0</div>
                    <div class="notification-status-label">Failed</div>
                </div>
            </div>
            <div class="notification-status-date">Today</div>
        </div>
    `;
}

function renderRecentNotifications(history) {
    const container = document.getElementById("recent-notifications");
    const allAlerts = history
        .flatMap((reading) => getAlertData(reading).map((alert) => ({ ...alert, recorded_at: reading.recorded_at })))
        .sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at))
        .slice(0, 5);

    if (allAlerts.length === 0) {
        container.innerHTML = `
            <div class="status-box">
                No notifications available yet.
            </div>
        `;
        return;
    }

    container.innerHTML = allAlerts.map((item) => `
        <div class="alert">
            <strong>${item.title}</strong>
            <br>
            ${item.message}
            <br>
            <small>${formatDateTime(item.recorded_at)}</small>
        </div>
    `).join("");
}

function renderAlertHistory(history) {
    const tableBody = document.getElementById("alert-history-body");

    if (!history.length) {
        tableBody.innerHTML = `
            <tr>
                <td colspan="6" class="table-empty">No alert history available.</td>
            </tr>
        `;
        return;
    }

    tableBody.innerHTML = history.slice().reverse().map((reading) => {
        const alerts = getAlertData(reading);
        const highestSeverity = alerts.length ? alerts.reduce((max, alert) => {
            const priority = { Critical: 2, Warning: 1 };
            return priority[alert.severity] > priority[max] ? alert.severity : max;
        }, "Warning") : "-";

        return `
            <tr>
                <td>${new Date(reading.recorded_at).toLocaleDateString()}</td>
                <td>${new Date(reading.recorded_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td>
                <td>${alerts.length}</td>
                <td>${highestSeverity}</td>
                <td>${alerts.length ? "Active" : "Resolved"}</td>
                <td>${alerts.length ? alerts.map((alert) => alert.title).join(", ") : "No issues detected"}</td>
            </tr>
        `;
    }).join("");
}

async function loadAlertsData() {
    try {
        const [latestResponse, historyResponse] = await Promise.all([
            fetch("/api/readings/latest"),
            fetch("/api/readings/history")
        ]);

        if (!latestResponse.ok || !historyResponse.ok) {
            throw new Error(`Sensor API returned ${latestResponse.status} / ${historyResponse.status}.`);
        }
        const reading = await latestResponse.json();
        const history = await historyResponse.json();
        if (!Array.isArray(history)) {
            throw new Error("Sensor history response has an invalid format.");
        }

        updateSummaryCards(history, reading);
        renderRecentNotifications(history);
        renderAlertHistory(history);
        document.getElementById("critical-alerts-count").textContent = history.flatMap((item) => getAlertData(item)).filter((alert) => alert.severity === "Critical").length;
        document.getElementById("warning-alerts-count").textContent = history.flatMap((item) => getAlertData(item)).filter((alert) => alert.severity === "Warning").length;
    } catch (error) {
        console.error("Unable to load sensor data for alerts:", error);
        document.getElementById("active-alerts").innerHTML = '<div class="status-box">Unable to load sensor data. Please refresh or retry.</div>';
        document.getElementById("recent-notifications").innerHTML = '<div class="status-box">Unable to load sensor data. Please refresh or retry.</div>';
        document.getElementById("alert-history-body").innerHTML = '<tr><td colspan="9" class="table-empty">Unable to load sensor data.</td></tr>';
        document.getElementById("notification-status").innerHTML = '<div class="status-box">Sensor database unavailable.</div>';
    }
}

updateDeviceTime();
setInterval(updateDeviceTime, 1000);
loadAlertsData();
setInterval(loadAlertsData, 10000);
