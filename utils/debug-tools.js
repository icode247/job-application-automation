// utils/debug-tools.js
export default class DebugTools {
  constructor() {
    this.debugMode = false;
    this.logs = [];
    this.maxLogs = 1000;
  }

  enable() {
    this.debugMode = true;
    console.log("🐛 Debug mode enabled");

    // Add debug UI
    this.createDebugUI();
  }

  disable() {
    this.debugMode = false;
    this.removeDebugUI();
    console.log("🐛 Debug mode disabled");
  }

  log(message, data = {}) {
    if (!this.debugMode) return;

    const logEntry = {
      timestamp: new Date().toISOString(),
      message,
      data,
      stack: new Error().stack,
    };

    this.logs.push(logEntry);

    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    console.log(`🐛 [DEBUG] ${message}`, data);
  }

  createDebugUI() {
    const debugPanel = document.createElement("div");
    debugPanel.id = "automation-debug-panel";
    debugPanel.style.cssText = `
      position: fixed;
      bottom: 10px;
      left: 10px;
      width: 300px;
      max-height: 400px;
      background: rgba(0, 0, 0, 0.9);
      color: #00ff00;
      font-family: monospace;
      font-size: 11px;
      padding: 10px;
      border-radius: 5px;
      z-index: 999999;
      overflow-y: auto;
      border: 1px solid #333;
    `;

    debugPanel.innerHTML = `
      <div style="border-bottom: 1px solid #333; padding-bottom: 5px; margin-bottom: 5px;">
        <strong>🐛 Debug Panel</strong>
        <button onclick="this.parentElement.parentElement.remove()" style="float: right; background: #ff4444; color: white; border: none; border-radius: 3px; padding: 2px 6px; cursor: pointer;">×</button>
      </div>
      <div id="debug-logs"></div>
    `;

    document.body.appendChild(debugPanel);

    // Update logs every second
    this.debugInterval = setInterval(() => {
      this.updateDebugLogs();
    }, 1000);
  }

  removeDebugUI() {
    const panel = document.getElementById("automation-debug-panel");
    if (panel) panel.remove();

    if (this.debugInterval) {
      clearInterval(this.debugInterval);
    }
  }

  updateDebugLogs() {
    const logsContainer = document.getElementById("debug-logs");
    if (!logsContainer) return;

    const recentLogs = this.logs.slice(-20); // Show last 20 logs
    logsContainer.innerHTML = recentLogs
      .map(
        (log) =>
          `<div style="margin-bottom: 2px; font-size: 10px;">
        <span style="color: #666;">${new Date(
          log.timestamp
        ).toLocaleTimeString()}</span>
        <span style="color: #00ff00;">${log.message}</span>
      </div>`
      )
      .join("");

    logsContainer.scrollTop = logsContainer.scrollHeight;
  }

  highlightElement(selector, color = "#ff4444") {
    const element = document.querySelector(selector);
    if (element) {
      element.style.outline = `3px solid ${color}`;
      element.style.backgroundColor = `${color}22`;

      setTimeout(() => {
        element.style.outline = "";
        element.style.backgroundColor = "";
      }, 3000);

      this.log(`Highlighted element: ${selector}`);
    }
  }

  exportLogs() {
    const logData = JSON.stringify(this.logs, null, 2);
    const blob = new Blob([logData], { type: "application/json" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `automation-debug-logs-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    this.log("Debug logs exported");
  }

  clearLogs() {
    this.logs = [];
    this.log("Debug logs cleared");
  }

  getSystemInfo() {
    return {
      userAgent: navigator.userAgent,
      url: window.location.href,
      timestamp: new Date().toISOString(),
      performance: performance.memory
        ? {
            usedJSHeapSize: performance.memory.usedJSHeapSize,
            totalJSHeapSize: performance.memory.totalJSHeapSize,
            jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
          }
        : null,
      screen: {
        width: screen.width,
        height: screen.height,
        colorDepth: screen.colorDepth,
      },
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
      },
    };
  }
}
