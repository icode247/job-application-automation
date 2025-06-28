// background/session-manager.js
export default class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.storageKey = "automationSessions";
  }

  async initialize() {
    await this.loadSessions();
    console.log("📊 Session manager initialized");
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
      console.error("Error loading sessions:", error);
    }
  }

  async saveSessions() {
    try {
      const sessionsArray = Array.from(this.sessions.values());
      await chrome.storage.local.set({
        [this.storageKey]: sessionsArray,
      });
    } catch (error) {
      console.error("Error saving sessions:", error);
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
    };

    this.sessions.set(sessionId, session);
    await this.saveSessions();

    console.log(`📝 Created session ${sessionId}`, session);
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

  async handleWindowClosed(windowId) {
    // Find sessions associated with this window and mark as interrupted
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.windowId === windowId && session.status === "running") {
        await this.updateSession(sessionId, {
          status: "interrupted",
          interruptedAt: Date.now(),
        });
      }
    }
  }

  async handleTabUpdated(tabId, tab) {
    // Update session with current tab information if needed
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
      console.log(`🧹 Cleaned up ${cleaned} old sessions`);
    }
  }
}
