// core/automation-orchestrator.js
import PlatformRegistry from "../platforms/platform-registry.js";
import WindowManager from "../background/window-manager.js";
import Logger from "./logger.js";

export default class AutomationOrchestrator {
  constructor() {
    this.platformRegistry = new PlatformRegistry();
    this.windowManager = new WindowManager();
    this.logger = new Logger();
    this.activeAutomations = new Map();
  }

  async startAutomation(params) {
    const {
      sessionId,
      platform,
      userId,
      jobsToApply,
      submittedLinks,
      devMode,
      country,
      userPlan,
      userCredits,
      dailyRemaining,
      resumeUrl,
      coverLetterTemplate,
      preferences,
    } = params;

    try {
      this.logger.info(`🚀 Starting automation for platform: ${platform}`, {
        sessionId,
      });

      // Get platform handler
      const PlatformClass = await this.platformRegistry.getPlatform(platform);
      console.log(PlatformClass, platform)
      if (!PlatformClass) {
        throw new Error(`Platform ${platform} not supported`);
      }

      // Create automation window
      const automationWindow = await this.createAutomationWindow(
        platform,
        sessionId
      );
      if (!automationWindow) {
        throw new Error("Failed to create automation window");
      }

      // Initialize platform automation
      const platformAutomation = new PlatformClass({
        sessionId,
        windowId: automationWindow.id,
        userId,
        jobsToApply,
        submittedLinks,
        devMode,
        country,
        userPlan,
        userCredits,
        dailyRemaining,
        resumeUrl,
        coverLetterTemplate,
        preferences,
        logger: this.logger,
      });

      // Create automation session
      const automationSession = new AutomationSession({
        sessionId,
        platform,
        platformAutomation,
        windowId: automationWindow.id,
        params,
        orchestrator: this,
      });

      // Store active automation
      this.activeAutomations.set(sessionId, automationSession);

      // Start the automation
      await automationSession.start();

      this.logger.info(`✅ Automation started successfully`, {
        sessionId,
        platform,
      });

      return {
        success: true,
        automationInstance: automationSession,
        windowId: automationWindow.id,
      };
    } catch (error) {
      this.logger.error(`❌ Failed to start automation: ${error.message}`, {
        sessionId,
        platform,
        error: error.stack,
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  async createAutomationWindow(platform, sessionId) {
    try {
      // Get platform-specific starting URL
      const startUrl = this.getStartingUrl(platform);

      const window = await chrome.windows.create({
        url: startUrl,
        type: "normal",
        focused: true,
        width: 1200,
        height: 800,
      });

      // Register as automation window
      await this.windowManager.registerAutomationWindow(window.id, {
        sessionId,
        platform,
        createdAt: Date.now(),
      });

      // Inject automation flag
      setTimeout(async () => {
        try {
          if (window.tabs && window.tabs[0]) {
            await chrome.scripting.executeScript({
              target: { tabId: window.tabs[0].id },
              func: (sessionId, platform) => {
                window.automationSessionId = sessionId;
                window.automationPlatform = platform;
                window.isAutomationWindow = true;
                sessionStorage.setItem("automationSessionId", sessionId);
                sessionStorage.setItem("automationPlatform", platform);
                sessionStorage.setItem("automationWindow", "true");
              },
              args: [sessionId, platform],
            });
          }
        } catch (error) {
          console.error("Error injecting automation context:", error);
        }
      }, 100);

      return window;
    } catch (error) {
      throw new Error(`Failed to create automation window: ${error.message}`);
    }
  }

  getStartingUrl(platform) {
    const urls = {
      linkedin: "https://www.linkedin.com/jobs/search/",
      indeed: "https://www.indeed.com/jobs",
      recruitee:
        "https://www.google.com/search?q=site:recruitee.com+software+engineer",
      glassdoor: "https://www.glassdoor.com/Job/index.htm",
      workday:
        "https://www.google.com/search?q=site:myworkdayjobs.com+software+engineer",
    };

    return (
      urls[platform] || "https://www.google.com/search?q=software+engineer+jobs"
    );
  }

  async stopAutomation(sessionId) {
    const automation = this.activeAutomations.get(sessionId);
    if (automation) {
      await automation.stop();
      this.activeAutomations.delete(sessionId);
      return true;
    }
    return false;
  }

  async pauseAutomation(sessionId) {
    const automation = this.activeAutomations.get(sessionId);
    if (automation) {
      await automation.pause();
      return true;
    }
    return false;
  }

  async resumeAutomation(sessionId) {
    const automation = this.activeAutomations.get(sessionId);
    if (automation) {
      await automation.resume();
      return true;
    }
    return false;
  }

  getAutomationStatus(sessionId) {
    const automation = this.activeAutomations.get(sessionId);
    return automation ? automation.getStatus() : null;
  }

  // Clean up automation when window is closed
  async handleWindowClosed(windowId) {
    for (const [sessionId, automation] of this.activeAutomations.entries()) {
      if (automation.windowId === windowId) {
        await automation.stop();
        this.activeAutomations.delete(sessionId);
        this.logger.info(`🧹 Cleaned up automation for closed window`, {
          sessionId,
          windowId,
        });
      }
    }
  }
}

class AutomationSession {
  constructor({
    sessionId,
    platform,
    platformAutomation,
    windowId,
    params,
    orchestrator,
  }) {
    this.sessionId = sessionId;
    this.platform = platform;
    this.platformAutomation = platformAutomation;
    this.windowId = windowId;
    this.params = params;
    this.orchestrator = orchestrator;

    this.status = "created";
    this.startTime = null;
    this.endTime = null;
    this.progress = {
      total: params.jobsToApply,
      completed: 0,
      failed: 0,
      skipped: 0,
      current: null,
    };
    this.errors = [];
    this.isPaused = false;
  }

  async start() {
    try {
      this.status = "running";
      this.startTime = Date.now();

      // Set up progress monitoring
      this.platformAutomation.onProgress = (progress) => {
        this.updateProgress(progress);
      };

      this.platformAutomation.onError = (error) => {
        this.handleError(error);
      };

      this.platformAutomation.onComplete = () => {
        this.handleComplete();
      };

      // Start platform automation
      await this.platformAutomation.start();
    } catch (error) {
      this.status = "failed";
      this.errors.push({
        message: error.message,
        timestamp: Date.now(),
        context: "start",
      });
      throw error;
    }
  }

  async pause() {
    this.isPaused = true;
    this.status = "paused";

    if (this.platformAutomation.pause) {
      await this.platformAutomation.pause();
    }
  }

  async resume() {
    this.isPaused = false;
    this.status = "running";

    if (this.platformAutomation.resume) {
      await this.platformAutomation.resume();
    }
  }

  async stop() {
    this.status = "stopped";
    this.endTime = Date.now();

    if (this.platformAutomation.stop) {
      await this.platformAutomation.stop();
    }
  }

  updateProgress(progressUpdate) {
    this.progress = { ...this.progress, ...progressUpdate };

    // Report progress to background
    chrome.runtime.sendMessage({
      action: "reportProgress",
      sessionId: this.sessionId,
      progress: this.progress,
    });
  }

  handleError(error) {
    this.errors.push({
      message: error.message,
      timestamp: Date.now(),
      context: error.context || "unknown",
    });

    // Report error to background
    chrome.runtime.sendMessage({
      action: "reportError",
      sessionId: this.sessionId,
      error: error.message,
      context: error.context,
    });
  }

  handleComplete() {
    this.status = "completed";
    this.endTime = Date.now();

    // Report completion
    chrome.runtime.sendMessage({
      action: "automationComplete",
      sessionId: this.sessionId,
      progress: this.progress,
      duration: this.endTime - this.startTime,
    });
  }

  getProgress() {
    return {
      ...this.progress,
      status: this.status,
      isPaused: this.isPaused,
      duration: this.startTime ? Date.now() - this.startTime : 0,
      errors: this.errors,
    };
  }

  getStatus() {
    return {
      sessionId: this.sessionId,
      platform: this.platform,
      status: this.status,
      progress: this.progress,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.startTime
        ? (this.endTime || Date.now()) - this.startTime
        : 0,
      errors: this.errors,
      isPaused: this.isPaused,
    };
  }
}
