/**
 * StatusOverlay - A reusable status notification overlay system
 * Provides visual feedback with status indicators and message logging
 */
export default class StatusOverlay {
  constructor(options = {}) {
    this.options = {
      id: options.id || "status-overlay",
      title: options.title || "AUTOMATION",
      icon: options.icon || "🤖",
      position: options.position || { top: "10px", right: "10px" },
      width: options.width || "320px",
      maxHeight: options.maxHeight || "300px",
      maxMessages: options.maxMessages || 50,
      autoHide: options.autoHide || false,
      autoHideDelay: options.autoHideDelay || 5000,
      ...options,
    };

    // State
    this.container = null;
    this.statusIndicator = null;
    this.logContainer = null;
    this.isVisible = true;
    this.messageCount = 0;

    // Initialize if not set to manual
    if (!options.manual) {
      this.create();
    }
  }

  /**
   * Create the status overlay
   */
  create() {
    this.destroy(); // Remove existing overlay if any

    // Create main container
    this.container = document.createElement("div");
    this.container.id = this.options.id;
    this.container.style.cssText = `
      position: fixed;
      top: ${this.options.position.top};
      right: ${this.options.position.right};
      width: ${this.options.width};
      max-height: ${this.options.maxHeight};
      overflow-y: auto;
      background: rgba(0,0,0,0.85);
      color: white;
      padding: 15px;
      font-family: 'Segoe UI', Arial, sans-serif;
      font-size: 13px;
      z-index: 9999999;
      border-radius: 8px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.25);
      border-left: 4px solid #4a90e2;
      transition: all 0.3s ease;
      ${!this.isVisible ? "opacity: 0; transform: translateX(100%);" : ""}
    `;

    // Create header
    const header = this.createHeader();
    this.container.appendChild(header);

    // Create log container
    this.logContainer = document.createElement("div");
    this.logContainer.style.cssText = `
      margin-top: 10px;
      max-height: 220px;
      overflow-y: auto;
      font-size: 12px;
      line-height: 1.4;
    `;

    this.container.appendChild(this.logContainer);
    document.body.appendChild(this.container);

    this.updateStatus("ready");
    return this;
  }

  /**
   * Create the header section
   */
  createHeader() {
    const header = document.createElement("div");
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(255,255,255,0.2);
    `;

    // Logo section
    const logoDiv = document.createElement("div");
    logoDiv.style.cssText = `
      display: flex;
      align-items: center;
      font-weight: bold;
      font-size: 15px;
    `;

    const logoIcon = document.createElement("span");
    logoIcon.textContent = this.options.icon;
    logoIcon.style.cssText = `
      margin-right: 6px;
      font-size: 18px;
    `;

    const logoText = document.createElement("span");
    logoText.textContent = this.options.title;

    logoDiv.appendChild(logoIcon);
    logoDiv.appendChild(logoText);

    // Status indicator
    this.statusIndicator = document.createElement("span");
    this.statusIndicator.textContent = "Initializing...";
    this.statusIndicator.style.cssText = `
      font-size: 12px;
      padding: 3px 8px;
      background: rgba(74, 144, 226, 0.2);
      border-radius: 12px;
      color: #4a90e2;
      cursor: pointer;
    `;

    // Add click handler to toggle visibility
    this.statusIndicator.addEventListener("click", () => this.toggle());

    header.appendChild(logoDiv);
    header.appendChild(this.statusIndicator);

    return header;
  }

  /**
   * Update the status indicator
   */
  updateStatus(status, details = "") {
    if (!this.statusIndicator) return this;

    const statusConfig = this.getStatusConfig(status);
    const displayText = details
      ? `${statusConfig.text}: ${details}`
      : statusConfig.text;

    this.statusIndicator.textContent = displayText;
    this.statusIndicator.style.color = statusConfig.color;
    this.statusIndicator.style.background = statusConfig.bgColor;

    return this;
  }

  /**
   * Get status configuration
   */
  getStatusConfig(status) {
    const configs = {
      ready: {
        text: "Ready",
        color: "#4caf50",
        bgColor: "rgba(76, 175, 80, 0.2)",
      },
      searching: {
        text: "Searching",
        color: "#ff9800",
        bgColor: "rgba(255, 152, 0, 0.2)",
      },
      applying: {
        text: "Applying",
        color: "#4a90e2",
        bgColor: "rgba(74, 144, 226, 0.2)",
      },
      success: {
        text: "Success",
        color: "#4caf50",
        bgColor: "rgba(76, 175, 80, 0.2)",
      },
      error: {
        text: "Error",
        color: "#f44336",
        bgColor: "rgba(244, 67, 54, 0.2)",
      },
      warning: {
        text: "Warning",
        color: "#ff9800",
        bgColor: "rgba(255, 152, 0, 0.2)",
      },
      info: {
        text: "Info",
        color: "#2196f3",
        bgColor: "rgba(33, 150, 243, 0.2)",
      },
    };

    return (
      configs[status] || {
        text: status.charAt(0).toUpperCase() + status.slice(1),
        color: "#4a90e2",
        bgColor: "rgba(74, 144, 226, 0.2)",
      }
    );
  }

  /**
   * Add a message to the log
   */
  addMessage(message, type = "info") {
    if (!this.logContainer) return this;

    const timestamp = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const messageElement = document.createElement("div");
    messageElement.style.cssText = `
      padding: 4px 0;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      animation: fadeIn 0.3s ease-in;
      ${this.getMessageTypeStyles(type)}
    `;

    const timeSpan = document.createElement("span");
    timeSpan.textContent = timestamp;
    timeSpan.style.cssText = `
      color: rgba(255,255,255,0.5);
      margin-right: 8px;
      font-size: 11px;
    `;

    const messageSpan = document.createElement("span");
    messageSpan.textContent = message;

    messageElement.appendChild(timeSpan);
    messageElement.appendChild(messageSpan);
    this.logContainer.appendChild(messageElement);

    // Auto-scroll to bottom
    this.logContainer.scrollTop = this.logContainer.scrollHeight;

    // Keep only the last N messages
    this.messageCount++;
    while (this.logContainer.children.length > this.options.maxMessages) {
      this.logContainer.removeChild(this.logContainer.firstChild);
    }

    // Auto-hide if enabled
    if (this.options.autoHide && type !== "error") {
      setTimeout(() => {
        if (this.messageCount > 0) {
          this.hide();
        }
      }, this.options.autoHideDelay);
    }

    // Show overlay if hidden and it's an important message
    if (!this.isVisible && (type === "error" || type === "warning")) {
      this.show();
    }

    return this;
  }

  /**
   * Get message type styles
   */
  getMessageTypeStyles(type) {
    const styles = {
      error: "color: #ff6b6b;",
      warning: "color: #ffb74d;",
      success: "color: #81c784;",
      info: "color: #64b5f6;",
      default: "",
    };

    return styles[type] || styles.default;
  }

  /**
   * Add an error message
   */
  addError(error) {
    const message =
      typeof error === "string" ? error : error.message || "Unknown error";
    this.addMessage("ERROR: " + message, "error");
    this.updateStatus("error");
    return this;
  }

  /**
   * Add a success message
   */
  addSuccess(message) {
    this.addMessage(message, "success");
    this.updateStatus("success");
    return this;
  }

  /**
   * Add a warning message
   */
  addWarning(message) {
    this.addMessage(message, "warning");
    this.updateStatus("warning");
    return this;
  }

  /**
   * Add an info message
   */
  addInfo(message) {
    this.addMessage(message, "info");
    return this;
  }

  /**
   * Show the overlay
   */
  show() {
    if (!this.container) return this;

    this.isVisible = true;
    this.container.style.opacity = "1";
    this.container.style.transform = "translateX(0)";
    return this;
  }

  /**
   * Hide the overlay
   */
  hide() {
    if (!this.container) return this;

    this.isVisible = false;
    this.container.style.opacity = "0";
    this.container.style.transform = "translateX(100%)";
    return this;
  }

  /**
   * Toggle overlay visibility
   */
  toggle() {
    return this.isVisible ? this.hide() : this.show();
  }

  /**
   * Clear all messages
   */
  clear() {
    if (this.logContainer) {
      this.logContainer.innerHTML = "";
      this.messageCount = 0;
    }
    return this;
  }

  /**
   * Update the title
   */
  setTitle(title) {
    this.options.title = title;
    const logoText = this.container?.querySelector("span:last-child");
    if (logoText) {
      logoText.textContent = title;
    }
    return this;
  }

  /**
   * Move overlay to a new position
   */
  setPosition(position) {
    if (!this.container) return this;

    if (position.top !== undefined) this.container.style.top = position.top;
    if (position.right !== undefined)
      this.container.style.right = position.right;
    if (position.bottom !== undefined)
      this.container.style.bottom = position.bottom;
    if (position.left !== undefined) this.container.style.left = position.left;

    return this;
  }

  /**
   * Destroy the overlay
   */
  destroy() {
    const existing = document.getElementById(this.options.id);
    if (existing) {
      existing.remove();
    }

    this.container = null;
    this.statusIndicator = null;
    this.logContainer = null;
    this.messageCount = 0;

    return this;
  }

  /**
   * Check if overlay exists and is visible
   */
  exists() {
    return !!this.container && document.body.contains(this.container);
  }

  /**
   * Add CSS animation keyframes if not already added
   */
  static addAnimationStyles() {
    if (document.getElementById("status-overlay-animations")) return;

    const style = document.createElement("style");
    style.id = "status-overlay-animations";
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; transform: translateY(-5px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;
    document.head.appendChild(style);
  }
}

// Add animations when class is loaded
StatusOverlay.addAnimationStyles();
