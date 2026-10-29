function getAdjustmentStatus(key, value, min, max) {
    if (value < min) {
        if (key === "temperature") return { text: "Too cold", amount: min - value, unit: "°C" };
        return { text: "Too acidic", amount: min - value, unit: "" };
    }

    if (value > max) {
        if (key === "temperature") return { text: "Too hot", amount: value - max, unit: "°C" };
        return { text: "Too alkaline", amount: value - max, unit: "" };
    }

    return { text: "Within range", amount: 0, unit: "" };
}

function getReadingQuality(reading) {
    let score = 100;
    if (reading.temperature < 26 || reading.temperature > 32) score -= 15;
    if (reading.ph < 7.5 || reading.ph > 8.5) score -= 20;
    return Math.max(0, score);
}

function getAlertCounts(history) {
    return history.reduce((counts, reading) => {
        if (reading.temperature < 26 || reading.temperature > 32) {
            if (reading.temperature < 24 || reading.temperature > 34) counts.critical += 1;
            else counts.warnings += 1;
        }
        if (reading.ph < 7.5 || reading.ph > 8.5) {
            if (reading.ph < 7 || reading.ph > 9) counts.critical += 1;
            else counts.warnings += 1;
        }
        return counts;
    }, { critical: 0, warnings: 0 });
}

function setAdjustment(key, value, min, max) {
    const valueElement = document.getElementById(`${key}-adjustment`);
    const statusElement = document.getElementById(`${key}-status`);
    if (!valueElement || !statusElement) return;

    const adjustment = getAdjustmentStatus(key, value, min, max);
    valueElement.textContent = adjustment.amount === 0 ? "0.0" : `${adjustment.amount.toFixed(1)}${adjustment.unit}`;
    statusElement.textContent = adjustment.amount === 0 ? "(Within range)" : `(${adjustment.text})`;
}

function showNoReadings() {
    document.getElementById("analytics-demo-note").hidden = true;
    document.getElementById("analytics-average-quality").textContent = "--";
    document.getElementById("analytics-quality-summary").textContent = "No sensor readings are saved";
    document.getElementById("analytics-active-alerts").textContent = "0";
    document.getElementById("analytics-alert-summary").textContent = "No readings to evaluate";
    document.getElementById("analytics-recommended-action").textContent = "No data";
    document.getElementById("analytics-action-summary").textContent = "Submit a reading to get an action";
    document.getElementById("analytics-monitoring-status").textContent = "Waiting";
    document.getElementById("analytics-last-update").textContent = "No readings available";
    document.getElementById("analytics-health-heading").textContent = "No sensor readings are available.";
    document.getElementById("analytics-health-detail").textContent = "Submit a dashboard reading to populate the sensor history.";
    document.getElementById("analytics-key-findings").innerHTML = "<li>No sensor readings are available.</li>";
    document.getElementById("analytics-recommended-operations").innerHTML = "<li>Submit a sensor reading to see recommendations.</li>";
    document.getElementById("analytics-report-quality").textContent = "--";
    document.getElementById("analytics-report-critical").textContent = "0";
    document.getElementById("analytics-report-warnings").textContent = "0";
    document.getElementById("analytics-report-updated").textContent = "--";
    document.getElementById("temp-adjustment").textContent = "--";
    document.getElementById("temp-status").textContent = "Waiting for reading";
    document.getElementById("ph-adjustment").textContent = "--";
    document.getElementById("ph-status").textContent = "Waiting for reading";
}

function showUnavailable() {
    document.getElementById("analytics-demo-note").hidden = true;
    document.getElementById("analytics-average-quality").textContent = "--";
    document.getElementById("analytics-quality-summary").textContent = "Sensor database unavailable";
    document.getElementById("analytics-active-alerts").textContent = "--";
    document.getElementById("analytics-alert-summary").textContent = "Unable to load alerts";
    document.getElementById("analytics-recommended-action").textContent = "Unavailable";
    document.getElementById("analytics-action-summary").textContent = "Could not load sensor readings";
    document.getElementById("analytics-monitoring-status").textContent = "Unavailable";
    document.getElementById("analytics-last-update").textContent = "Could not connect to database";
    document.getElementById("analytics-health-heading").textContent = "Sensor data is unavailable.";
    document.getElementById("analytics-health-detail").textContent = "Check the database connection and refresh this page.";
    document.getElementById("analytics-key-findings").innerHTML = "<li>Unable to load sensor data.</li>";
    document.getElementById("analytics-recommended-operations").innerHTML = "<li>Unable to load sensor data.</li>";
    document.getElementById("analytics-report-quality").textContent = "--";
    document.getElementById("analytics-report-critical").textContent = "--";
    document.getElementById("analytics-report-warnings").textContent = "--";
    document.getElementById("analytics-report-updated").textContent = "--";
    document.getElementById("temp-adjustment").textContent = "--";
    document.getElementById("temp-status").textContent = "Sensor data unavailable";
    document.getElementById("ph-adjustment").textContent = "--";
    document.getElementById("ph-status").textContent = "Sensor data unavailable";
}

function renderAnalytics(reading, history, recommendation) {
    if (!reading || history.length === 0) {
        showNoReadings();
        return;
    }

    const counts = getAlertCounts(history);
    const latestDate = new Date(reading.recorded_at);
    const qualityAverage = Math.round(history.reduce((sum, item) => sum + getReadingQuality(item), 0) / history.length);
    const activeAlerts = counts.critical + counts.warnings;
    const outsideRange = reading.temperature < 26 || reading.temperature > 32 ||
        reading.ph < 7.5 || reading.ph > 8.5;
    document.getElementById("analytics-demo-note").hidden =
        !history.some((item) => item.status === "Demo");

    document.getElementById("analytics-average-quality").textContent = `${qualityAverage} / 100`;
    document.getElementById("analytics-quality-summary").textContent =
        `Average across ${history.length} saved readings`;
    document.getElementById("analytics-active-alerts").textContent = String(activeAlerts);
    document.getElementById("analytics-alert-summary").textContent =
        `${counts.critical} critical, ${counts.warnings} warning conditions in saved readings`;
    document.getElementById("analytics-recommended-action").textContent =
        recommendation ? recommendation.classification : "Unavailable";
    document.getElementById("analytics-action-summary").textContent =
        recommendation
            ? recommendation.recommendation
            : "AI recommendations are temporarily unavailable.";
    document.getElementById("analytics-monitoring-status").textContent = "Database";
    document.getElementById("analytics-last-update").textContent = latestDate.toLocaleString();
    document.getElementById("analytics-health-heading").textContent = outsideRange
        ? "Latest pond readings need attention."
        : "Latest pond readings are within range.";
    document.getElementById("analytics-health-detail").textContent =
        `Latest temperature: ${reading.temperature} °C; latest pH: ${reading.ph}. ${history.length} readings loaded from the sensors table.`;
    document.getElementById("analytics-key-findings").innerHTML = [
        `<li>Latest temperature is ${reading.temperature} °C (${getAdjustmentStatus("temperature", reading.temperature, 26, 32).text.toLowerCase()}).</li>`,
        `<li>Latest pH is ${reading.ph} (${getAdjustmentStatus("ph", reading.ph, 7.5, 8.5).text.toLowerCase()}).</li>`,
        `<li>${counts.critical} critical and ${counts.warnings} warning conditions across saved readings.</li>`
    ].join("");
    document.getElementById("analytics-recommended-operations").innerHTML = [
        `<li>${recommendation ? recommendation.recommendation : "AI recommendations are temporarily unavailable."}</li>`,
        `<li>Review the ${history.length} saved sensor readings and continue regular monitoring.</li>`
    ].join("");
    document.getElementById("analytics-report-quality").textContent = `${qualityAverage} / 100`;
    document.getElementById("analytics-report-critical").textContent = String(counts.critical);
    document.getElementById("analytics-report-warnings").textContent = String(counts.warnings);
    document.getElementById("analytics-report-updated").textContent = latestDate.toLocaleString();

    setAdjustment("temperature", reading.temperature, 26, 32);
    setAdjustment("ph", reading.ph, 7.5, 8.5);
}

async function loadRecommendation(reading) {
    const response = await fetch("/api/recommendations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ temperature: reading.temperature, ph: reading.ph })
    });
    if (!response.ok) {
        throw new Error(`Recommendation API returned ${response.status}.`);
    }

    const recommendation = await response.json();
    if (typeof recommendation.classification !== "string" ||
        typeof recommendation.recommendation !== "string") {
        throw new Error("Recommendation response has an invalid format.");
    }
    return recommendation;
}

async function loadSensorAnalytics() {
    try {
        const [latestResponse, historyResponse] = await Promise.all([
            fetch("/api/readings/latest"),
            fetch("/api/readings/history")
        ]);
        if (!latestResponse.ok || !historyResponse.ok) {
            throw new Error(`Sensor API returned ${latestResponse.status} / ${historyResponse.status}.`);
        }

        const [reading, history] = await Promise.all([latestResponse.json(), historyResponse.json()]);
        if (!Array.isArray(history)) throw new Error("Sensor history response has an invalid format.");
        let recommendation = null;
        if (reading && history.length > 0) {
            try {
                recommendation = await loadRecommendation(reading);
            } catch (error) {
                console.error("Unable to load AI recommendations for analytics:", error);
            }
        }
        renderAnalytics(reading, history, recommendation);
    } catch (error) {
        console.error("Unable to load sensor data for analytics:", error);
        showUnavailable();
    }
}

function updateDeviceTime() {
    document.getElementById("time").textContent =
        new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

updateDeviceTime();
setInterval(updateDeviceTime, 1000);
loadSensorAnalytics();
setInterval(loadSensorAnalytics, 10000);
