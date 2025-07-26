// core/logger.js
export default class Logger {
  constructor(context = "Automation", devMode = false) {
    this.context = context;
    this.devMode = devMode;
    this.logs = [];
    this.maxLogs = 1000;
  }

  info(message, data = {}) {
    this.log("INFO", message, data);
  }

  warn(message, data = {}) {
    this.log("WARN", message, data);
  }

  error(message, data = {}) {
    this.log("ERROR", message, data);
  }

  debug(message, data = {}) {
    this.log("DEBUG", message, data);
  }

  log(level, message, data = {}) {
    const logEntry = {
      timestamp: new Date().toISOString(),
      level,
      context: this.context,
      message,
      data,
      sessionId: data.sessionId || null,
    };

    this.logs.push(logEntry);

    // Keep only recent logs
    if (this.logs.length > this.maxLogs) {
      this.logs = this.logs.slice(-this.maxLogs);
    }

    // Only show console output in dev mode
    if (this.devMode) {
      const emoji = this.getEmojiForLevel(level);
      const prefix = `${emoji} [${this.context}]`;

      if (level === "ERROR") {
        console.error(prefix, message, data);
      } else if (level === "WARN") {
        console.warn(prefix, message, data);
      } else {
        console.log(prefix, message, data);
      }
    }

    // Store in chrome.storage for persistence if needed
    this.persistLogs();
  }

  getEmojiForLevel(level) {
    const emojis = {
      INFO: "ℹ️",
      WARN: "⚠️",
      ERROR: "❌",
      DEBUG: "🔍",
    };
    return emojis[level] || "📝";
  }

  async persistLogs() {
    try {
      // Only persist last 100 logs to avoid storage issues
      const recentLogs = this.logs.slice(-100);
      await chrome.storage.local.set({
        [`logs_${this.context}`]: recentLogs,
      });
    } catch (error) {
      // Fail silently to avoid infinite loops
    }
  }

  async getLogs(sessionId = null) {
    if (sessionId) {
      return this.logs.filter((log) => log.sessionId === sessionId);
    }
    return [...this.logs];
  }

  clearLogs() {
    this.logs = [];
  }
}