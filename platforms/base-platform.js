// platforms/base-platform.js
export default class BasePlatform {
  constructor(config) {
    this.sessionId = config.sessionId;
    this.platform = config.platform;
    this.userId = config.userId;
    this.contentScript = config.contentScript;
    this.config = config.config || {};

    // State
    this.isRunning = false;
    this.isPaused = false;
    this.currentJob = null;
    this.progress = {
      total: this.config.jobsToApply || 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      current: null,
    };

    // Callbacks
    this.onProgress = null;
    this.onError = null;
    this.onComplete = null;
    this.onApplicationSubmitted = null;
    this.onDOMChange = null;
    this.onNavigation = null;
  }

  // Abstract methods - must be implemented by platform-specific classes
  async initialize() {
    this.log("🚀 Initializing platform automation");
  }

  async initialize() {
    this.log("🚀 Initializing platform automation");
  }

  async start(params = {}) {
    throw new Error("start() method must be implemented by platform class");
  }

  async findJobs() {
    throw new Error("findJobs() method must be implemented by platform class");
  }

  async applyToJob(jobElement) {
    throw new Error(
      "applyToJob() method must be implemented by platform class"
    );
  }

  async setSessionContext(sessionContext) {
    try {
      this.sessionContext = sessionContext;

      // Update basic properties if available
      if (sessionContext.sessionId) this.sessionId = sessionContext.sessionId;
      if (sessionContext.platform) this.platform = sessionContext.platform;
      if (sessionContext.userId) this.userId = sessionContext.userId;
      if (sessionContext.userProfile)
        this.userProfile = sessionContext.userProfile;

      this.log("✅ Session context set successfully");
    } catch (error) {
      this.log("❌ Error setting session context:", error);
      throw error;
    }
  }

  handlePortMessage(message) {
    const { type, data } = message || {};

    switch (type) {
      case "CONNECTION_ESTABLISHED":
        this.log("✅ Port connection established");
        break;

      case "KEEPALIVE_RESPONSE":
        // Acknowledge keepalive
        break;

      default:
        this.log(`❓ Unhandled message type: ${type}`);
    }
  }

  async start(params = {}) {
    throw new Error("start() method must be implemented by platform class");
  }

  async findJobs() {
    throw new Error("findJobs() method must be implemented by platform class");
  }

  async applyToJob(jobElement) {
    throw new Error(
      "applyToJob() method must be implemented by platform class"
    );
  }

  // Common utility methods
  async pause() {
    this.isPaused = true;
    this.log("⏸️ Automation paused");
  }

  async resume() {
    this.isPaused = false;
    this.log("▶️ Automation resumed");
  }

  async stop() {
    this.isRunning = false;
    this.isPaused = false;
    this.log("⏹️ Automation stopped");
  }

  // Progress reporting
  updateProgress(updates) {
    this.progress = { ...this.progress, ...updates };

    if (this.onProgress) {
      this.onProgress(this.progress);
    }

    // Notify content script
    this.notifyContentScript("progress", this.progress);
  }

  reportError(error, context = {}) {
    const errorInfo = {
      message: error.message || error,
      context,
      timestamp: Date.now(),
      sessionId: this.sessionId,
      platform: this.platform,
    };

    this.log(`❌ Error: ${errorInfo.message}`, errorInfo);

    if (this.onError) {
      this.onError(errorInfo);
    }

    // Notify content script
    this.notifyContentScript("error", errorInfo);
  }

  reportComplete() {
    this.isRunning = false;
    this.log("✅ Automation completed");

    if (this.onComplete) {
      this.onComplete();
    }

    // Notify content script
    this.notifyContentScript("complete", {
      sessionId: this.sessionId,
      progress: this.progress,
    });
  }

  reportApplicationSubmitted(jobData, applicationData) {
    this.progress.completed++;
    this.updateProgress({
      completed: this.progress.completed,
      current: null,
    });

    this.log(
      `📝 Application submitted: ${jobData.title} at ${jobData.company}`
    );

    if (this.onApplicationSubmitted) {
      this.onApplicationSubmitted(jobData, applicationData);
    }

    // Notify content script
    this.notifyContentScript("applicationSubmitted", {
      jobData,
      applicationData,
      sessionId: this.sessionId,
    });
  }

  // Basic DOM utility methods (generic only)
  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Communication with content script and background
  async notifyContentScript(type, data) {
    if (this.contentScript && this.contentScript.sendMessageToBackground) {
      try {
        await this.contentScript.sendMessageToBackground({
          action: "platformNotification",
          type,
          data,
          sessionId: this.sessionId,
          platform: this.platform,
        });
      } catch (error) {
        console.error("Error notifying content script:", error);
      }
    }
  }

  // Utility methods
  log(message, data = {}) {
    const logEntry = `🤖 [${this.platform}-${this.sessionId?.slice(
      -6
    )}] ${message}`;
    console.log(logEntry, data);
  }

  getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  cleanup() {
    this.isRunning = false;
    this.isPaused = false;
    this.log("🧹 Platform cleanup completed");
  }
}
