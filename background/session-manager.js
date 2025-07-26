// background/session-manager.js

export default class SessionManager {
  constructor(logger) {
    this.sessions = new Map();
    this.storageKey = "automationSessions";
    this.logger = logger;
    
  }

  async initialize() {
    await this.loadSessions();
    this.logger.log("📊 Session manager initialized");
  }

  async loadSessions() {
    try {
      const result = await chrome.storage.local.get(this.storageKey);
      if (result[this.storageKey]) {
        const sessionsArray = result[this.storageKey];
        for (const session of sessionsArray) {
          this.sessions.set(session.sessionId, session);
        }
      }
    } catch (error) {
      this.logger.error("Error loading sessions:", error);
    }
  }

  async saveSessions() {
    try {
      const sessionsArray = Array.from(this.sessions.values());
      await chrome.storage.local.set({
        [this.storageKey]: sessionsArray,
      });
    } catch (error) {
      this.logger.error("Error saving sessions:", error);
    }
  }

  async createSession(sessionData) {
    const sessionId = this.generateSessionId();
    const session = {
      sessionId,
      ...sessionData,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "created",
      progress: {
        total: sessionData.jobsToApply || 0,
        completed: 0,
        failed: 0,
        skipped: 0,
      },
      applications: [],
      notifications: [],
    };

    this.sessions.set(sessionId, session);
    await this.saveSessions();

    this.logger.log(`📝 Created session ${sessionId}`, session);
    return sessionId;
  }

  async updateSession(sessionId, updates) {
    const session = this.sessions.get(sessionId);
    if (session) {
      Object.assign(session, updates, { updatedAt: Date.now() });
      this.sessions.set(sessionId, session);
      await this.saveSessions();
    }
  }

  async getSession(sessionId) {
    return this.sessions.get(sessionId);
  }

  async addApplication(sessionId, applicationData) {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.applications.push({
        ...applicationData,
        id: this.generateApplicationId(),
        timestamp: Date.now(),
      });

      session.progress.completed = session.applications.length;
      session.updatedAt = Date.now();

      this.sessions.set(sessionId, session);
      await this.saveSessions();
    }
  }

  async addNotification(sessionId, notificationData) {
    if (!sessionId) {
      // Handle cases where sessionId might be null
      this.logger.warn("Cannot add notification: sessionId is null");
      return false;
    }

    const session = this.sessions.get(sessionId);
    if (session) {
      if (!session.notifications) {
        session.notifications = [];
      }

      session.notifications.push({
        ...notificationData,
        id: this.generateNotificationId(),
        timestamp: Date.now(),
      });

      // Keep only last 50 notifications per session
      if (session.notifications.length > 50) {
        session.notifications = session.notifications.slice(-50);
      }

      session.updatedAt = Date.now();
      this.sessions.set(sessionId, session);
      await this.saveSessions();
      return true;
    }
    return false;
  }

  async handleWindowClosed(windowId) {
    for (const [sessionId, session] of this.sessions.entries()) {
      if (
        session.windowId === windowId &&
        ["running", "starting", "paused"].includes(session.status)
      ) {
        this.logger.log(
          `🛑 Force stopping session ${sessionId} due to window close`
        );
        await this.forceStopSession(sessionId, "Window closed by user");
      }
    }
  }

  async handleTabUpdated(tabId, tab) {
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.windowId === tab.windowId && session.status === "running") {
        await this.updateSession(sessionId, {
          currentUrl: tab.url,
          currentTitle: tab.title,
          lastActivity: Date.now(),
        });
      }
    }
  }

  generateSessionId() {
    return (
      "session_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).substr(2, 9)
    );
  }

  generateApplicationId() {
    return (
      "app_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).substr(2, 5)
    );
  }

  generateNotificationId() {
    return (
      "notif_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).substr(2, 5)
    );
  }

  async cleanupOldSessions(maxAge = 7 * 24 * 60 * 60 * 1000) {
    // 7 days
    const cutoff = Date.now() - maxAge;
    let cleaned = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.createdAt < cutoff) {
        this.sessions.delete(sessionId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      await this.saveSessions();
      this.logger.log(`🧹 Cleaned up ${cleaned} old sessions`);
    }
  }

  async forceStopSession(sessionId, reason = "Window closed") {
    try {
      const session = this.sessions.get(sessionId);
      if (!session) {
        this.logger.warn(`⚠️ Session ${sessionId} not found for force stop`);
        return false;
      }

      // Update session with stopped status
      await this.updateSession(sessionId, {
        status: "stopped",
        stoppedAt: Date.now(),
        endTime: Date.now(),
        reason: reason,
        forceStop: true,
      });

      // Add notification about the forced stop
      await this.addNotification(sessionId, {
        type: "automation_force_stopped",
        reason: reason,
        timestamp: Date.now(),
        message: `Automation was forcefully stopped: ${reason}`,
      });

      this.logger.log(`✅ Session ${sessionId} force stopped successfully`);
      return true;
    } catch (error) {
      this.logger.error(`❌ Error force stopping session ${sessionId}:`, error);
      return false;
    }
  }

  /**
 * Logging with platform context
 */
  log(message, data = {}) {
    console.log(`🚀 [SessionManager] ${message}`, data);
  }
}
