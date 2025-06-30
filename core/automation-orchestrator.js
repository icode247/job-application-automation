// core/automation-orchestrator.js
import WindowManager from "../background/window-manager.js";
import Logger from "./logger.js";

export default class AutomationOrchestrator {
  constructor() {
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
        userId,
        jobsToApply,
      });

      // Create automation window
      const automationWindow = await this.createAutomationWindow(
        platform,
        sessionId,
        userId
      );
      if (!automationWindow) {
        throw new Error("Failed to create automation window");
      }

      // Create automation session (background tracking only)
      const automationSession = new AutomationSession({
        sessionId,
        platform,
        userId,
        windowId: automationWindow.id,
        params,
        orchestrator: this,
      });

      // Store active automation
      this.activeAutomations.set(sessionId, automationSession);

      this.logger.info(`✅ Automation started successfully`, {
        sessionId,
        platform,
        windowId: automationWindow.id,
        userId,
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
        userId,
        error: error.stack,
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  async createAutomationWindow(platform, sessionId, userId) {
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
        userId,
        createdAt: Date.now(),
      });

      // Inject automation context with all required data
      setTimeout(async () => {
        try {
          if (window.tabs && window.tabs[0]) {
            await chrome.scripting.executeScript({
              target: { tabId: window.tabs[0].id },
              func: (sessionId, platform, userId) => {
                // Set window properties
                window.automationSessionId = sessionId;
                window.automationPlatform = platform;
                window.automationUserId = userId;
                window.isAutomationWindow = true;

                // Set session storage
                sessionStorage.setItem("automationSessionId", sessionId);
                sessionStorage.setItem("automationPlatform", platform);
                sessionStorage.setItem("automationUserId", userId);
                sessionStorage.setItem("automationWindow", "true");

                console.log("🚀 Automation context injected", {
                  sessionId,
                  platform,
                  userId,
                });
              },
              args: [sessionId, platform, userId],
            });
          }
        } catch (error) {
          console.error("Error injecting automation context:", error);
        }
      }, 500); // Shorter delay

      return window;
    } catch (error) {
      throw new Error(`Failed to create automation window: ${error.message}`);
    }
  }

  getStartingUrl(platform) {
    const urls = {
      linkedin:
        "https://www.linkedin.com/jobs/search/?f_AL=true&keywords=software%20engineer&sortBy=DD",
      indeed: "https://www.indeed.com/jobs?q=software+engineer&sort=date",
      recruitee:
        "https://www.google.com/search?q=site:recruitee.com+software+engineer+jobs",
      glassdoor:
        "https://www.glassdoor.com/Job/jobs.htm?suggestCount=0&suggestChosen=false&clickSource=searchBtn&typedKeyword=software+engineer&sc.keyword=software+engineer&locT=&locId=&jobType=",
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

      // Close the window
      try {
        await chrome.windows.remove(automation.windowId);
      } catch (error) {
        console.error("Error closing automation window:", error);
      }

      this.logger.info(`🛑 Automation stopped`, { sessionId });
      return true;
    }
    return false;
  }

  async pauseAutomation(sessionId) {
    const automation = this.activeAutomations.get(sessionId);
    if (automation) {
      await automation.pause();
      this.logger.info(`⏸️ Automation paused`, { sessionId });
      return true;
    }
    return false;
  }

  async resumeAutomation(sessionId) {
    const automation = this.activeAutomations.get(sessionId);
    if (automation) {
      await automation.resume();
      this.logger.info(`▶️ Automation resumed`, { sessionId });
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
          userId: automation.userId,
        });
      }
    }
  }
}

class AutomationSession {
  constructor({ sessionId, platform, userId, windowId, params, orchestrator }) {
    this.sessionId = sessionId;
    this.platform = platform;
    this.userId = userId; // Store userId
    this.windowId = windowId;
    this.params = params;
    this.orchestrator = orchestrator;

    this.status = "created";
    this.startTime = Date.now();
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

  getConfig() {
    return {
      sessionId: this.sessionId,
      platform: this.platform,
      userId: this.userId, // Include userId in config
      jobsToApply: this.params.jobsToApply,
      submittedLinks: this.params.submittedLinks || [],
      preferences: this.params.preferences || {},
      resumeUrl: this.params.resumeUrl,
      coverLetterTemplate: this.params.coverLetterTemplate,
      userPlan: this.params.userPlan,
      userCredits: this.params.userCredits,
      dailyRemaining: this.params.dailyRemaining,
      devMode: this.params.devMode || false,
      country: this.params.country || "US",
    };
  }

  async pause() {
    this.isPaused = true;
    this.status = "paused";

    // Send pause message to content script
    await this.sendMessageToContentScript({
      action: "pauseAutomation",
    });
  }

  async resume() {
    this.isPaused = false;
    this.status = "running";

    // Send resume message to content script
    await this.sendMessageToContentScript({
      action: "resumeAutomation",
    });
  }

  async stop() {
    this.status = "stopped";
    this.endTime = Date.now();

    // Send stop message to content script
    await this.sendMessageToContentScript({
      action: "stopAutomation",
    });
  }

  async sendMessageToContentScript(message) {
    try {
      const tabs = await chrome.tabs.query({
        windowId: this.windowId,
        active: true,
      });
      if (tabs.length > 0) {
        await chrome.tabs.sendMessage(tabs[0].id, {
          ...message,
          sessionId: this.sessionId,
          userId: this.userId, // Include userId in messages
        });
      }
    } catch (error) {
      console.error("Error sending message to content script:", error);
    }
  }

  updateProgress(progressUpdate) {
    this.progress = { ...this.progress, ...progressUpdate };
  }

  handleError(error) {
    this.errors.push({
      message: error.message,
      timestamp: Date.now(),
      context: error.context || "unknown",
    });
  }

  getProgress() {
    return {
      ...this.progress,
      status: this.status,
      isPaused: this.isPaused,
      duration: this.startTime ? Date.now() - this.startTime : 0,
      errors: this.errors,
      userId: this.userId, // Include userId in progress
    };
  }

  getStatus() {
    return {
      sessionId: this.sessionId,
      platform: this.platform,
      userId: this.userId, // Include userId in status
      status: this.status,
      progress: this.progress,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.startTime
        ? (this.endTime || Date.now()) - this.startTime
        : 0,
      errors: this.errors,
      isPaused: this.isPaused,
      windowId: this.windowId,
    };
  }
}
