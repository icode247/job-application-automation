// services/status-notification-service.js
export default class StatusNotificationService {
  constructor() {
    this.currentNotification = null;
    this.notificationTimeout = null;
  }

  show(message, type = "info", duration = 5000) {
    // Remove existing notification
    this.hide();

    // Create notification element
    const notification = document.createElement("div");
    notification.className = `automation-notification automation-notification--${type}`;
    notification.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      background: ${this.getBackgroundColor(type)};
      color: white;
      padding: 12px 20px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      font-size: 14px;
      font-weight: 500;
      z-index: 999999;
      box-shadow: 0 4px 20px rgba(0,0,0,0.15);
      border-left: 4px solid ${this.getBorderColor(type)};
      max-width: 400px;
      word-wrap: break-word;
      opacity: 0;
      transform: translateX(100%);
      transition: all 0.3s ease;
    `;

    notification.innerHTML = `
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 16px;">${this.getIcon(type)}</span>
        <span>${message}</span>
        <button onclick="this.parentElement.parentElement.remove()" style="
          background: transparent;
          border: none;
          color: white;
          font-size: 18px;
          cursor: pointer;
          padding: 0;
          margin-left: auto;
          opacity: 0.7;
        ">×</button>
      </div>
    `;

    document.body.appendChild(notification);
    this.currentNotification = notification;

    // Trigger animation
    requestAnimationFrame(() => {
      notification.style.opacity = "1";
      notification.style.transform = "translateX(0)";
    });

    // Auto-hide after duration
    if (duration > 0) {
      this.notificationTimeout = setTimeout(() => {
        this.hide();
      }, duration);
    }

    // Send status update to background
    this.sendStatusUpdate(type, message);
  }

  hide() {
    if (this.currentNotification) {
      this.currentNotification.style.opacity = "0";
      this.currentNotification.style.transform = "translateX(100%)";

      setTimeout(() => {
        if (
          this.currentNotification &&
          this.currentNotification.parentElement
        ) {
          this.currentNotification.remove();
        }
        this.currentNotification = null;
      }, 300);
    }

    if (this.notificationTimeout) {
      clearTimeout(this.notificationTimeout);
      this.notificationTimeout = null;
    }
  }

  getBackgroundColor(type) {
    const colors = {
      info: "#2196F3",
      success: "#4CAF50",
      warning: "#FF9800",
      error: "#F44336",
    };
    return colors[type] || colors.info;
  }

  getBorderColor(type) {
    const colors = {
      info: "#1976D2",
      success: "#388E3C",
      warning: "#F57C00",
      error: "#D32F2F",
    };
    return colors[type] || colors.info;
  }

  getIcon(type) {
    const icons = {
      info: "ℹ️",
      success: "✅",
      warning: "⚠️",
      error: "❌",
    };
    return icons[type] || icons.info;
  }

  sendStatusUpdate(status, message) {
    try {
      chrome.runtime.sendMessage({
        action: "statusUpdate",
        status: status,
        message: message,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error("Error sending status update:", error);
    }
  }
}
