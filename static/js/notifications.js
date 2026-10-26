const readingKey = "shrimpGuardLatest";
const historyKey = "shrimpGuardHistory";

function getAlertData(reading) {
    const alerts = [];

    if (!reading) {
        return alerts;
    }

    if (reading.temperature < 26 || reading.temperature > 32) {
        const severity = reading.temperature < 24 || reading.temperature > 34 ? "Critical" : "Mild";
        alerts.push({
            severity,
            title: `${severity} Temperature Alert`,
            message: `Temperature is currently ${reading.temperature} °C, outside the recommended range of 26–32 °C.`,
            notification: `SMS: Pond temperature is ${reading.temperature} °C. Check cooling or heating systems and respond promptly.`,
            recorded_at: reading.recorded_at
        });
    }

    if (reading.ph < 7.5 || reading.ph > 8.5) {
        const severity = reading.ph < 7.0 || reading.ph > 9.0 ? "Critical" : "Mild";
        alerts.push({
            severity,
            title: `${severity} pH Alert`,
            message: `pH is currently ${reading.ph}, outside the recommended range of 7.5–8.5.`,
            notification: `SMS: pH is ${reading.ph}. Adjust water treatment and verify the pH control system.`,
            recorded_at: reading.recorded_at
        });
    }

    return alerts;
}

function getRecentNotifications() {
    const history = JSON.parse(localStorage.getItem(historyKey) || "[]");
    const notifications = [];

    history.forEach((reading) => {
        const readingAlerts = getAlertData(reading);
        readingAlerts.forEach((alert) => {
            notifications.push({
                ...alert,
                recorded_at: alert.recorded_at || reading.recorded_at
            });
        });
    });

    return notifications
        .sort((a, b) => new Date(b.recorded_at) - new Date(a.recorded_at))
        .slice(0, 7);
}

function renderNotifications() {
    const notificationContainer = document.getElementById("notification-content");

    if (!notificationContainer) {
        return;
    }

    const notifications = getRecentNotifications();

    if (notifications.length === 0) {
        notificationContainer.innerHTML = `
            <div class="notification-empty">
                <svg class="ui-icon"><use href="#icon-check-circle"></use></svg> No alerts or notifications have been generated yet. Submit a reading from the dashboard to create the first alert feed.
            </div>
        `;
        return;
    }

    notificationContainer.innerHTML = `
        <ul class="notification-list">
            ${notifications.map((item) => `
                <li class="notification-item ${item.severity.toLowerCase()}">
                    <div class="notification-meta">
                        <span class="notification-severity">${item.severity}</span>
                        <small>${new Date(item.recorded_at).toLocaleString()}</small>
                    </div>
                    <h3>${item.title}</h3>
                    <p>${item.message}</p>
                    <p><strong>Notification:</strong> ${item.notification}</p>
                </li>
            `).join("")}
        </ul>
    `;
}

function setupNotificationModal() {
    const button = document.getElementById("notification-button");
    const backdrop = document.getElementById("notification-modal-backdrop");
    const closeButton = document.getElementById("notification-modal-close");

    if (!button || !backdrop || !closeButton) {
        return;
    }

    button.setAttribute("aria-controls", backdrop.id);
    button.setAttribute("aria-expanded", "false");

    const closeNotifications = () => {
        backdrop.classList.remove("visible");
        button.setAttribute("aria-expanded", "false");
    };

    button.addEventListener("click", () => {
        if (backdrop.classList.contains("visible")) {
            closeNotifications();
            return;
        }

        renderNotifications();
        backdrop.classList.add("visible");
        button.setAttribute("aria-expanded", "true");
    });

    closeButton.addEventListener("click", () => {
        closeNotifications();
    });

    document.addEventListener("click", (event) => {
        if (!backdrop.contains(event.target) && !button.contains(event.target)) {
            closeNotifications();
        }
    });

    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape" && backdrop.classList.contains("visible")) {
            closeNotifications();
            button.focus();
        }
    });
}

function createNotificationModal() {
    if (document.getElementById("notification-modal-backdrop")) {
        return;
    }

    const modal = document.createElement("div");
    modal.className = "notification-modal-backdrop";
    modal.id = "notification-modal-backdrop";
    modal.innerHTML = `
        <div class="notification-modal" role="dialog" aria-labelledby="notification-modal-title">
            <div class="notification-header">
                <h2 id="notification-modal-title">Notifications</h2>
                <button id="notification-modal-close" class="notification-close" type="button" aria-label="Close notifications"><svg class="ui-icon"><use href="#icon-x"></use></svg></button>
            </div>
            <div id="notification-content" class="notification-content"></div>
        </div>
    `;

    document.body.appendChild(modal);
}

function initializeNotifications() {
    createNotificationModal();
    setupNotificationModal();
    renderNotifications();
}

initializeNotifications();
window.addEventListener("storage", renderNotifications);
