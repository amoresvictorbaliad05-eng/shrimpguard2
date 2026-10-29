const chartColors = ["#2f6fbd", "#2f8a57"];

function updateDeviceTime() {
    document.getElementById("time").textContent =
        new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function getQualityStatus(reading) {
    const needsAttention = reading.temperature < 26 || reading.temperature > 32 ||
        reading.ph < 7.5 || reading.ph > 8.5;

    return needsAttention ? "Needs attention" : "Water quality is GOOD";
}

function updateSummary(reading) {
    document.getElementById("monitor-temperature").textContent = reading.temperature;
    document.getElementById("monitor-ph").textContent = reading.ph;
    document.getElementById("monitoring-status").textContent = getQualityStatus(reading);
    document.getElementById("monitoring-updated").textContent =
        "Last updated " + new Date(reading.recorded_at).toLocaleString();
    document.getElementById("monitoring-demo-note").hidden = reading.status !== "Demo";
}

function drawTrendChart(history) {
    const canvas = document.getElementById("trend-chart");
    const context = canvas.getContext("2d");
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const scale = window.devicePixelRatio || 1;
    const series = ["temperature", "ph"];
    const values = series.map((key) => history.map((reading) => reading[key]));
    const allValues = values.flat();
    const minimum = Math.min(...allValues);
    const maximum = Math.max(...allValues);
    const range = maximum - minimum || 1;
    const padding = { top: 20, right: 20, bottom: 28, left: 34 };

    canvas.width = width * scale;
    canvas.height = height * scale;
    context.scale(scale, scale);
    context.clearRect(0, 0, width, height);

    context.strokeStyle = "#e2e8f0";
    context.fillStyle = "#667085";
    context.font = "12px Arial";
    context.lineWidth = 1;
    for (let index = 0; index < 4; index += 1) {
        const y = padding.top + ((height - padding.top - padding.bottom) / 3) * index;
        context.beginPath();
        context.moveTo(padding.left, y);
        context.lineTo(width - padding.right, y);
        context.stroke();
        context.fillText((maximum - (range / 3) * index).toFixed(1), 4, y + 4);
    }

    series.forEach((key, seriesIndex) => {
        context.beginPath();
        values[seriesIndex].forEach((value, index) => {
            const x = history.length === 1
                ? width / 2
                : padding.left + (index / (history.length - 1)) * (width - padding.left - padding.right);
            const y = padding.top + (1 - (value - minimum) / range) * (height - padding.top - padding.bottom);
            if (index === 0) context.moveTo(x, y);
            else context.lineTo(x, y);
        });
        context.strokeStyle = chartColors[seriesIndex];
        context.lineWidth = 2.5;
        context.stroke();
    });
}

function updateRecommendations(reading, recommendation) {
    const recommendationsList = document.getElementById("monitoring-recommendations");

    if (!reading) {
        recommendationsList.innerHTML = "<li>No reading available yet. Submit dashboard readings to receive AI recommendations.</li>";
        return;
    }

    if (!recommendation) {
        recommendationsList.textContent = "";
        const item = document.createElement("li");
        item.textContent = "AI recommendations are temporarily unavailable.";
        recommendationsList.appendChild(item);
        return;
    }

    recommendationsList.textContent = "";
    const item = document.createElement("li");
    item.textContent = `${recommendation.classification}: ${recommendation.recommendation}`;
    recommendationsList.appendChild(item);
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

async function loadMonitoringData() {
    const emptyMessage = document.getElementById("chart-empty");

    try {
        const [latestResponse, historyResponse] = await Promise.all([
            fetch("/api/readings/latest"),
            fetch("/api/readings/history")
        ]);

        if (latestResponse.ok && historyResponse.ok) {
            const latest = await latestResponse.json();
            const history = await historyResponse.json();
            if (!Array.isArray(history)) {
                throw new Error("Sensor history response has an invalid format.");
            }

            if (!latest || history.length === 0) {
                emptyMessage.hidden = false;
                document.getElementById("trend-count").textContent = "No readings yet";
                updateRecommendations(null);
                document.getElementById("monitor-temperature").textContent = "--";
                document.getElementById("monitor-ph").textContent = "--";
                document.getElementById("monitoring-status").textContent = "Waiting for a reading";
                document.getElementById("monitoring-updated").textContent = "No sensor readings are saved yet.";
                document.getElementById("monitoring-demo-note").hidden = true;
                return;
            }

            emptyMessage.hidden = true;
            updateSummary(latest);
            try {
                updateRecommendations(latest, await loadRecommendation(latest));
            } catch (error) {
                console.error("Unable to load AI recommendations:", error);
                updateRecommendations(latest, null);
            }
            document.getElementById("trend-count").textContent = `${history.length} reading${history.length === 1 ? "" : "s"}`;
            drawTrendChart(history);
            return;
        }
        throw new Error(`Sensor API returned ${latestResponse.status} / ${historyResponse.status}.`);
    } catch (error) {
        console.error("Unable to load sensor data for monitoring:", error);
        emptyMessage.hidden = false;
        emptyMessage.textContent = "Unable to load sensor data. Please refresh or retry.";
        document.getElementById("trend-count").textContent = "Data unavailable";
        document.getElementById("monitoring-status").textContent = "Sensor data unavailable";
        document.getElementById("monitoring-updated").textContent = "Could not connect to the sensors database.";
        document.getElementById("monitoring-demo-note").hidden = true;
        updateRecommendations(null);
    }
}

updateDeviceTime();
setInterval(updateDeviceTime, 1000);
loadMonitoringData();
window.addEventListener("storage", loadMonitoringData);
window.addEventListener("resize", loadMonitoringData);
setInterval(loadMonitoringData, 10000);
