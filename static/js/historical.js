let sensorHistory = [];
let historyPage = 1;
const readingsPerPage = 10;
const parameterLabels = {
    temperature: "Temperature",
    ph: "pH Level"
};
const units = { temperature: "°C", ph: "pH" };
const colors = { temperature: "#2f6fbd", ph: "#2f8a57" };

function updateDeviceTime() {
    document.getElementById("time").textContent = new Date().toLocaleTimeString([], {
        hour: "2-digit", minute: "2-digit", second: "2-digit"
    });
}

function statusFor(reading) {
    return reading.temperature < 26 || reading.temperature > 32 || reading.ph < 7.5 ||
        reading.ph > 8.5 ? "Needs attention" : "Good";
}

function localDate(reading) {
    const date = new Date(reading.recorded_at);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function filterHistory(history) {
    const selectedDate = document.getElementById("history-date").value;
    const interval = document.getElementById("history-interval").value;
    const now = Date.now();
    return history.filter((reading) => {
        const recorded = new Date(reading.recorded_at).getTime();
        const dateMatches = !selectedDate || localDate(reading) === selectedDate;
        const intervalMatches = interval === "all" || now - recorded <= Number(interval) * 60 * 60 * 1000;
        return dateMatches && intervalMatches;
    });
}

function selectedParameters() {
    const selected = document.getElementById("history-parameter").value;
    return selected === "all" ? Object.keys(parameterLabels) : [selected];
}

function drawChart(history, parameters) {
    const canvas = document.getElementById("historical-chart");
    const context = canvas.getContext("2d");
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const scale = window.devicePixelRatio || 1;
    const allValues = parameters.flatMap((key) => history.map((reading) => reading[key]));
    const minimum = Math.min(...allValues);
    const maximum = Math.max(...allValues);
    const range = maximum - minimum || 1;
    const padding = { top: 20, right: 20, bottom: 28, left: 42 };

    canvas.width = width * scale;
    canvas.height = height * scale;
    context.scale(scale, scale);
    context.clearRect(0, 0, width, height);
    context.strokeStyle = "#e2e8f0";
    context.fillStyle = "#667085";
    context.font = "12px Arial";
    for (let index = 0; index < 4; index += 1) {
        const y = padding.top + ((height - padding.top - padding.bottom) / 3) * index;
        context.beginPath(); context.moveTo(padding.left, y); context.lineTo(width - padding.right, y); context.stroke();
        context.fillText((maximum - (range / 3) * index).toFixed(1), 5, y + 4);
    }
    parameters.forEach((key) => {
        context.beginPath();
        history.forEach((reading, index) => {
            const x = history.length === 1 ? width / 2 : padding.left + index / (history.length - 1) * (width - padding.left - padding.right);
            const y = padding.top + (1 - (reading[key] - minimum) / range) * (height - padding.top - padding.bottom);
            index === 0 ? context.moveTo(x, y) : context.lineTo(x, y);
        });
        context.strokeStyle = colors[key]; context.lineWidth = 2.5; context.stroke();
    });
}

function updateLegend(parameters) {
    document.getElementById("historical-legend").innerHTML = parameters.map((key) =>
        `<span><i style="background:${colors[key]}"></i>${parameterLabels[key]}</span>`).join("");
}

function updateSummary(history, parameters) {
    const values = parameters.flatMap((key) => history.map((reading) => reading[key]));
    const average = parameters.length === 1 && values.length
        ? values.reduce((total, value) => total + value, 0) / values.length
        : null;
    const summaryMinimum = parameters.length === 1 && values.length ? Math.min(...values).toFixed(2) : "--";
    const summaryMaximum = parameters.length === 1 && values.length ? Math.max(...values).toFixed(2) : "--";
    document.getElementById("summary-title").textContent = parameters.length === 1 ? parameterLabels[parameters[0]] : "All parameters";
    document.getElementById("summary-count").textContent = history.length;
    document.getElementById("summary-average").textContent = average === null ? "--" : average.toFixed(2);
    document.getElementById("summary-minimum").textContent = summaryMinimum;
    document.getElementById("summary-maximum").textContent = summaryMaximum;
    document.getElementById("data-review").textContent = history.length
        ? `Showing ${history.length} saved reading${history.length === 1 ? "" : "s"} for the selected filters.`
        : "No saved readings match the selected filters.";
    const attentionCount = history.filter((reading) => statusFor(reading) === "Needs attention").length;
    const reviewStatus = document.getElementById("review-status");
    reviewStatus.textContent = attentionCount ? `${attentionCount} reading${attentionCount === 1 ? "" : "s"} need attention` : "All readings look good";
    reviewStatus.className = attentionCount ? "review-status review-warning" : "review-status";
}

function updateTable(history) {
    const body = document.getElementById("readings-body");
    const pagination = document.getElementById("readings-pagination");
    const hasDemoData = history.some((reading) => reading.status === "Demo");
    const sortedHistory = history.slice().reverse();
    const pageCount = Math.ceil(sortedHistory.length / readingsPerPage);
    historyPage = Math.min(historyPage, Math.max(pageCount, 1));
    document.getElementById("demo-data-note").hidden = !hasDemoData;
    body.innerHTML = sortedHistory.slice(
        (historyPage - 1) * readingsPerPage,
        historyPage * readingsPerPage
    ).map((reading) => {
        const date = new Date(reading.recorded_at);
        const qualityStatus = statusFor(reading);
        const isDemo = reading.status === "Demo";
        const statusLabel = isDemo ? `Demo · ${qualityStatus}` : qualityStatus;
        const statusClass = isDemo ? "demo" : qualityStatus === "Good" ? "good" : "warning";
        return `<tr><td>${date.toLocaleDateString()}</td><td>${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</td><td>${reading.temperature} °C</td><td>${reading.ph}</td><td><span class="table-status ${statusClass}">${statusLabel}</span></td></tr>`;
    }).join("");
    document.getElementById("table-empty").hidden = history.length > 0;
    pagination.replaceChildren();
    pagination.hidden = pageCount <= 1;
    if (pageCount <= 1) return;

    const addPageButton = (label, page, options = {}) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "readings-page-button";
        button.textContent = label;
        if (options.label) button.setAttribute("aria-label", options.label);
        if (options.current) button.setAttribute("aria-current", "page");
        if (options.disabled) button.disabled = true;
        button.addEventListener("click", () => {
            historyPage = page;
            updateTable(history);
        });
        pagination.appendChild(button);
    };

    addPageButton("‹", historyPage - 1, {
        label: "Previous page",
        disabled: historyPage === 1
    });

    let visiblePages;
    if (pageCount <= 7) {
        visiblePages = Array.from({ length: pageCount }, (_, index) => index + 1);
    } else if (historyPage <= 4) {
        visiblePages = [1, 2, 3, 4, 5, "…", pageCount];
    } else if (historyPage >= pageCount - 3) {
        visiblePages = [1, "…", pageCount - 4, pageCount - 3, pageCount - 2, pageCount - 1, pageCount];
    } else {
        visiblePages = [1, "…", historyPage - 1, historyPage, historyPage + 1, "…", pageCount];
    }

    visiblePages.forEach((page) => {
        if (typeof page !== "number") {
            const ellipsis = document.createElement("span");
            ellipsis.className = "readings-page-ellipsis";
            ellipsis.textContent = page;
            ellipsis.setAttribute("aria-hidden", "true");
            pagination.appendChild(ellipsis);
            return;
        }
        addPageButton(String(page), page, { current: page === historyPage });
    });

    addPageButton("›", historyPage + 1, {
        label: "Next page",
        disabled: historyPage === pageCount
    });
}

function applyFilters() {
    const history = filterHistory(sensorHistory);
    const parameters = selectedParameters();
    const hasData = history.length > 0;
    document.getElementById("history-count").textContent = `${history.length} reading${history.length === 1 ? "" : "s"}`;
    document.getElementById("history-export-button").disabled = sensorHistory.length === 0;
    document.getElementById("history-empty").hidden = hasData;
    if (hasData) drawChart(history, parameters);
    updateLegend(parameters); updateSummary(history, parameters); updateTable(history);
}

document.getElementById("history-export-button").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.setAttribute("aria-busy", "true");

    try {
        const response = await fetch("/historical/export");
        if (response.redirected) {
            throw new Error("Your session has expired. Sign in again to download historical data.");
        }
        if (!response.ok || !(response.headers.get("Content-Type") || "").includes("spreadsheetml")) {
            let message = "The historical data could not be exported.";
            try {
                const result = await response.json();
                message = result.error || message;
            } catch (error) {
                console.error("The export server returned an unexpected response:", error);
            }
            throw new Error(message);
        }

        const downloadUrl = URL.createObjectURL(await response.blob());
        const downloadLink = document.createElement("a");
        downloadLink.href = downloadUrl;
        downloadLink.download = "shrimpguard-historical-data.xlsx";
        document.body.appendChild(downloadLink);
        downloadLink.click();
        downloadLink.remove();
        setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
    } catch (error) {
        console.error("Unable to export historical readings:", error);
        window.alert(`Unable to download historical data: ${error.message}`);
    } finally {
        button.disabled = sensorHistory.length === 0;
        button.removeAttribute("aria-busy");
    }
});

document.getElementById("history-filter").addEventListener("submit", (event) => {
    event.preventDefault();
    historyPage = 1;
    applyFilters();
});
async function loadHistory() {
    try {
        const response = await fetch("/api/readings/history");
        if (!response.ok) {
            throw new Error(`History request failed with status ${response.status}.`);
        }

        const history = await response.json();
        if (!Array.isArray(history)) {
            throw new Error("The history response has an invalid format.");
        }

        sensorHistory = history;
    } catch (error) {
        console.error("Unable to load saved sensor history:", error);
        sensorHistory = [];
        document.getElementById("history-count").textContent = "Data unavailable";
        document.getElementById("history-empty").textContent = "Unable to load sensor data. Please refresh or retry.";
        document.getElementById("history-empty").hidden = false;
        document.getElementById("table-empty").textContent = "Unable to load sensor data from the database.";
        document.getElementById("table-empty").hidden = false;
        document.getElementById("readings-body").replaceChildren();
        document.getElementById("readings-pagination").hidden = true;
        return;
    }

    applyFilters();
}

updateDeviceTime(); setInterval(updateDeviceTime, 1000); loadHistory();
setInterval(loadHistory, 10000);
window.addEventListener("resize", applyFilters);
