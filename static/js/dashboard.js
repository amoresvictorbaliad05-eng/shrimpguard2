function displayResults(data) {
    document.getElementById("temperature").textContent = `${data.temperature} °C`;
    document.getElementById("ph").textContent = data.ph;
    const needsAttention = data.temperature < 26 || data.temperature > 32 ||
        data.ph < 7.5 || data.ph > 8.5;
    document.getElementById("temperature-status").textContent =
        data.temperature < 26 || data.temperature > 32 ? "Outside recommended range" : "Within recommended range";
    document.getElementById("ph-status").textContent =
        data.ph < 7.5 || data.ph > 8.5 ? "Outside recommended range" : "Within recommended range";
    document.getElementById("last-updated").textContent = data.recorded_at
        ? `Last updated ${new Date(data.recorded_at).toLocaleString()}`
        : "";
    document.getElementById("dashboard-demo-note").hidden = data.status !== "Demo";
    updateStatus(data);
    calculateWQI(data);
    createAlerts(data);
}


async function saveReading(data) {
    const reading = {
        ...data,
        recorded_at: new Date().toISOString()
    };

    const response = await fetch("/api/readings", {
        method: "POST",
        headers: {
            "Content-Type": "application/json"
        },
        body: JSON.stringify(reading)
    });

    if (!response.ok) {
        const result = await response.json();
        throw new Error(result.error || "Unable to save reading to the database.");
    }

    return response.json();
}


function updateDeviceTime() {
    document.getElementById("time").textContent =
        new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}


function updateStatus(data) {

    let status =
        "Overall water quality is GOOD.";

    if (data.temperature < 26 || data.temperature > 32 || data.ph < 7.5 || data.ph > 8.5) {

        status =
            "Overall water quality needs attention.";

    }

    document.getElementById("overall-status").textContent =
        status;

}


function calculateWQI(data) {

    let wqi = 100;

    if (data.temperature < 26 || data.temperature > 32) {
        wqi -= 15;
    }

    if (data.ph < 7.5 || data.ph > 8.5) {
        wqi -= 20;
    }

    document.getElementById("wqi-value").textContent =
        Math.max(0, wqi);

    let status = "GOOD";

    if (wqi < 70) {
        status = "WARNING";
    }

    document.getElementById("wqi-status").textContent =
        status;

}


function createAlerts(data) {

    const alerts =
        document.getElementById("alerts");


    alerts.innerHTML = "";

    const alertItems = [];

    if (data.temperature < 26 || data.temperature > 32) {

        const severity = data.temperature < 24 || data.temperature > 34 ? "Critical" : "Mild";

        alertItems.push({
            severity,
            title: `${severity} Temperature Alert`,
            message: `Temperature is currently ${data.temperature} °C, which is outside the recommended range of 26–32 °C.`,
            notification: `SMS: Pond temperature is ${data.temperature} °C. Check cooling or heating systems and respond to avoid stress on shrimp.`
        });

    }

    if (data.ph < 7.5 || data.ph > 8.5) {

        const severity = data.ph < 7.0 || data.ph > 9.0 ? "Critical" : "Mild";

        alertItems.push({
            severity,
            title: `${severity} pH Alert`,
            message: `pH is currently ${data.ph}, which is outside the recommended range of 7.5–8.5.`,
            notification: `SMS: pH is ${data.ph}. Adjust water treatment and confirm the pH control system is working properly.`
        });

    }


    if (alertItems.length === 0) {

        alerts.innerHTML = `

            <div class="status-box">

                <svg class="ui-icon"><use href="#icon-check-circle"></use></svg> No abnormal readings detected. Alerts and notifications are normal.

            </div>

        `;

        return;

    }


    alertItems.forEach((item) => {

        alerts.innerHTML += `

            <div class="alert">

                <svg class="ui-icon"><use href="${item.severity === "Critical" ? "#icon-alert" : "#icon-bell"}"></use></svg> ${item.title}

                <br>

                ${item.message}

                <br><br>

                <strong>Notification:</strong> ${item.notification}

            </div>

        `;

    });

}

updateDeviceTime();
setInterval(updateDeviceTime, 1000);


document.getElementById("quality-form").addEventListener("submit", async function (event) {
    event.preventDefault();

    const formData = new FormData(event.currentTarget);
    const data = {
        temperature: Number(formData.get("temperature")),
        ph: Number(formData.get("ph"))
    };

    const submitButton = event.currentTarget.querySelector("button[type=submit]");
    submitButton.disabled = true;
    try {
        const savedReading = await saveReading(data);
        displayResults(savedReading);
    } catch (error) {
        console.error("Unable to save water quality reading:", error);
        window.alert(`Unable to save reading: ${error.message}`);
    } finally {
        submitButton.disabled = false;
    }
});

async function loadLatestReading() {
    try {
        const response = await fetch("/api/readings/latest");
        if (!response.ok) {
            throw new Error(`Sensor request failed with status ${response.status}.`);
        }
        const reading = await response.json();
        if (reading) {
            displayResults(reading);
        } else {
            document.getElementById("overall-status").textContent = "No sensor readings are saved yet.";
        }
    } catch (error) {
        console.error("Unable to load the latest sensor reading:", error);
        document.getElementById("overall-status").textContent = "Unable to load sensor data. Please refresh or retry.";
    }
}

loadLatestReading();
setInterval(loadLatestReading, 10000);