const readingKey = "shrimpGuardLatest";
const historyKey = "shrimpGuardHistory";
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
        "Last submitted " + new Date(reading.recorded_at).toLocaleString();
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

function updateRecommendations(reading) {
    const recommendationsList = document.getElementById("monitoring-recommendations");
    const recommendations = [];

    if (!reading) {
        recommendationsList.innerHTML = "<li>No reading available yet. Submit dashboard readings to receive AI recommendations.</li>";
        return;
    }

    if (reading.temperature < 26) {
        recommendations.push('<svg class="ui-icon"><use href="#icon-thermometer"></use></svg> Temperature is below the ideal range. Consider adjusting pond heating or reducing cooling to stabilize conditions.');
    } else if (reading.temperature > 32) {
        recommendations.push('<svg class="ui-icon"><use href="#icon-thermometer"></use></svg> Temperature is above the ideal range. Increase aeration and consider cooling measures to reduce stress on shrimp.');
    }

    if (reading.ph < 7.5) {
        recommendations.push('<svg class="ui-icon"><use href="#icon-droplet"></use></svg> pH is too low. Add buffering agents to raise pH toward the recommended range.');
    } else if (reading.ph > 8.5) {
        recommendations.push('<svg class="ui-icon"><use href="#icon-droplet"></use></svg> pH is too high. Check the water source and apply corrective treatment to bring pH back down.');
    }

    if (recommendations.length === 0) {
        recommendationsList.innerHTML = '<li><svg class="ui-icon"><use href="#icon-check-circle"></use></svg> No abnormal readings detected. Continue regular monitoring and keep the current conditions stable.</li>';
        return;
    }

    recommendationsList.innerHTML = recommendations
        .map((item) => `<li>${item}</li>`)
        .join("");
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

            if (!latest || history.length === 0) {
                emptyMessage.hidden = false;
                document.getElementById("trend-count").textContent = "No readings yet";
                updateRecommendations(null);
                return;
            }

            emptyMessage.hidden = true;
            updateSummary(latest);
            updateRecommendations(latest);
            document.getElementById("trend-count").textContent = `${history.length} reading${history.length === 1 ? "" : "s"}`;
            drawTrendChart(history);
            return;
        }
    } catch (error) {
        console.warn("Falling back to localStorage for monitoring data:", error);
    }

    const latest = JSON.parse(localStorage.getItem(readingKey) || "null");
    const history = JSON.parse(localStorage.getItem(historyKey) || "[]");

    if (!latest || history.length === 0) {
        emptyMessage.hidden = false;
        document.getElementById("trend-count").textContent = "No readings yet";
        updateRecommendations(null);
        return;
    }

    emptyMessage.hidden = true;
    updateSummary(latest);
    updateRecommendations(latest);
    document.getElementById("trend-count").textContent = `${history.length} reading${history.length === 1 ? "" : "s"}`;
    drawTrendChart(history);
}

updateDeviceTime();
setInterval(updateDeviceTime, 1000);
loadMonitoringData();
window.addEventListener("storage", loadMonitoringData);
window.addEventListener("resize", loadMonitoringData);
setInterval(loadMonitoringData, 1000);
