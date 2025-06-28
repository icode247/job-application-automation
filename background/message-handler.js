// background/message-handler.js - Simplified approach
import AutomationOrchestrator from "../core/automation-orchestrator.js";
import SessionManager from "./session-manager.js";
import WindowManager from "./window-manager.js";

export default class MessageHandler {
  constructor() {
    this.orchestrator = new AutomationOrchestrator();
    this.sessionManager = new SessionManager();
    this.windowManager = new WindowManager();
    this.activeAutomations = new Map();
    this.backgroundService = null;
  }

  // Set reference to background service
  setBackgroundService(backgroundService) {
    this.backgroundService = backgroundService;
  }

  // Handle messages from your frontend web application
  handleExternalMessage(request, sender, sendResponse) {
    console.log("📨 External message received:", request);

    switch (request.action) {
      case "startApplying":
        this.handleStartApplying(request, sendResponse);
        break;

      case "pauseApplying":
        this.handlePauseApplying(request, sendResponse);
        break;

      case "stopApplying":
        this.handleStopApplying(request, sendResponse);
        break;

      case "getStatus":
        this.handleGetStatus(request, sendResponse);
        break;

      default:
        sendResponse({
          status: "error",
          message: `Unknown action: ${request.action}`,
        });
    }

    return true; // Keep message channel open for async response
  }

  // Handle internal messages from content scripts (simplified)
  handleInternalMessage(request, sender, sendResponse) {
    switch (request.action) {
      case "reportProgress":
        this.handleProgressReport(request, sender, sendResponse);
        break;

      case "reportError":
        this.handleErrorReport(request, sender, sendResponse);
        break;

      case "applicationSubmitted":
        this.handleApplicationSubmitted(request, sender, sendResponse);
        break;

      case "contentScriptReady":
        this.handleContentScriptReady(request, sender, sendResponse);
        break;

      case "domChanged":
        this.handleDOMChanged(request, sender, sendResponse);
        break;

      case "navigationDetected":
        this.handleNavigationDetected(request, sender, sendResponse);
        break;

      default:
        sendResponse({ error: "Unknown internal action" });
    }

    return true;
  }

  async handleStartApplying(request, sendResponse) {
    try {
      console.log("📨 Start applying request received:", request);

      // Validate required parameters
      const validation = this.validateStartApplyingRequest(request);
      if (!validation.valid) {
        sendResponse({
          status: "error",
          message: validation.error,
        });
        return;
      }

      const {
        platform,
        userId,
        jobsToApply,
        submittedLinks = [],
        devMode = false,
        country = "US",
        userPlan,
        userCredits,
        dailyRemaining,
        resumeUrl,
        coverLetterTemplate,
        preferences = {},
      } = request;

      // Create automation session
      const sessionId = await this.sessionManager.createSession({
        userId,
        platform,
        jobsToApply,
        submittedLinks,
        userPlan,
        userCredits,
        dailyRemaining,
        startTime: Date.now(),
        status: "starting",
        preferences,
      });

      // Start automation
      const result = await this.orchestrator.startAutomation({
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
      });

      if (result.success) {
        this.activeAutomations.set(sessionId, result.automationInstance);

        sendResponse({
          status: "started",
          platform: platform,
          sessionId: sessionId,
          windowId: result.windowId,
          message: `Job search started for ${platform}! Applying to ${jobsToApply} jobs.`,
        });

        // Notify frontend about successful start
        this.notifyFrontend({
          type: "automation_started",
          sessionId,
          platform,
          jobsToApply,
          windowId: result.windowId,
        });
      } else {
        await this.sessionManager.updateSession(sessionId, {
          status: "failed",
          error: result.error,
        });

        sendResponse({
          status: "error",
          message: result.error || "Failed to start automation",
        });
      }
    } catch (error) {
      console.error("Error in handleStartApplying:", error);
      sendResponse({
        status: "error",
        message: "An unexpected error occurred while starting automation",
      });
    }
  }

  async handlePauseApplying(request, sendResponse) {
    const { sessionId } = request;

    if (this.activeAutomations.has(sessionId)) {
      const automation = this.activeAutomations.get(sessionId);
      await automation.pause();

      await this.sessionManager.updateSession(sessionId, {
        status: "paused",
        pausedAt: Date.now(),
      });

      sendResponse({
        status: "paused",
        sessionId,
      });
    } else {
      sendResponse({
        status: "error",
        message: "No active automation found for session",
      });
    }
  }

  async handleStopApplying(request, sendResponse) {
    const { sessionId } = request;

    if (this.activeAutomations.has(sessionId)) {
      const automation = this.activeAutomations.get(sessionId);
      await automation.stop();
      this.activeAutomations.delete(sessionId);

      await this.sessionManager.updateSession(sessionId, {
        status: "stopped",
        stoppedAt: Date.now(),
      });

      sendResponse({
        status: "stopped",
        sessionId,
      });
    } else {
      sendResponse({
        status: "error",
        message: "No active automation found for session",
      });
    }
  }

  async handleGetStatus(request, sendResponse) {
    const { sessionId } = request;

    try {
      const session = await this.sessionManager.getSession(sessionId);
      const automation = this.activeAutomations.get(sessionId);

      let progress = null;
      if (automation) {
        progress = automation.getProgress();
      }

      sendResponse({
        status: "success",
        session,
        progress,
      });
    } catch (error) {
      sendResponse({
        status: "error",
        message: "Failed to get automation status",
      });
    }
  }

  handleProgressReport(request, sender, sendResponse) {
    const { sessionId, progress } = request;
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;

    console.log(
      `📊 Progress report from window ${windowId}, tab ${tabId}:`,
      progress
    );

    // Update session with progress
    this.sessionManager.updateSession(sessionId, {
      progress,
      lastActivity: Date.now(),
      activeTabId: tabId,
      activeWindowId: windowId,
    });

    // Notify frontend
    this.notifyFrontend({
      type: "progress_update",
      sessionId,
      progress,
      tabId,
      windowId,
    });

    sendResponse({ success: true });
  }

  handleErrorReport(request, sender, sendResponse) {
    const { sessionId, error, context } = request;
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;

    console.error(
      `💥 Automation error in window ${windowId}, tab ${tabId}:`,
      error
    );

    // Update session
    this.sessionManager.updateSession(sessionId, {
      status: "error",
      error,
      errorContext: context,
      errorTime: Date.now(),
      errorTabId: tabId,
      errorWindowId: windowId,
    });

    // Notify frontend
    this.notifyFrontend({
      type: "automation_error",
      sessionId,
      error,
      context,
      tabId,
      windowId,
    });

    sendResponse({ success: true });
  }

  handleApplicationSubmitted(request, sender, sendResponse) {
    const { sessionId, jobData, applicationData } = request;
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;

    console.log(
      `📝 Application submitted in window ${windowId}, tab ${tabId}:`,
      jobData.title
    );

    // Track application
    this.sessionManager.addApplication(sessionId, {
      jobData,
      applicationData,
      submittedAt: Date.now(),
      tabId: tabId,
      windowId: windowId,
      url: sender.tab?.url,
    });

    // Notify frontend
    this.notifyFrontend({
      type: "application_submitted",
      sessionId,
      jobData,
      applicationData,
      tabId,
      windowId,
    });

    sendResponse({ success: true });
  }

  handleContentScriptReady(request, sender, sendResponse) {
    const { sessionId, platform } = request;
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;

    console.log(
      `✅ Content script ready in window ${windowId}, tab ${tabId}: ${platform}`
    );

    // Update session with ready tab info
    this.sessionManager.updateSession(sessionId, {
      lastReadyTab: {
        tabId,
        windowId,
        platform,
        readyAt: Date.now(),
        url: sender.tab?.url,
      },
    });

    sendResponse({ success: true, message: "Content script registered" });
  }

  handleDOMChanged(request, sender, sendResponse) {
    const { sessionId } = request;
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;

    // Update last activity
    this.sessionManager.updateSession(sessionId, {
      lastActivity: Date.now(),
      lastDOMChangeTabId: tabId,
      lastDOMChangeWindowId: windowId,
    });

    sendResponse({ success: true });
  }

  handleNavigationDetected(request, sender, sendResponse) {
    const { sessionId, oldUrl, newUrl } = request;
    const tabId = sender.tab?.id;
    const windowId = sender.tab?.windowId;

    console.log(
      `🔄 Navigation in window ${windowId}, tab ${tabId}: ${oldUrl} → ${newUrl}`
    );

    // Update session with navigation info
    this.sessionManager.updateSession(sessionId, {
      lastNavigation: {
        tabId,
        windowId,
        oldUrl,
        newUrl,
        navigatedAt: Date.now(),
      },
      lastActivity: Date.now(),
    });

    sendResponse({ success: true });
  }

  validateStartApplyingRequest(request) {
    const required = ["platform", "userId", "jobsToApply"];

    for (const field of required) {
      if (!request[field]) {
        return {
          valid: false,
          error: `Missing required field: ${field}`,
        };
      }
    }

    if (!Number.isInteger(request.jobsToApply) || request.jobsToApply <= 0) {
      return {
        valid: false,
        error: "jobsToApply must be a positive integer",
      };
    }

    const supportedPlatforms = [
      "linkedin",
      "indeed",
      "recruitee",
      "glassdoor",
      "workday",
    ];
    if (!supportedPlatforms.includes(request.platform)) {
      return {
        valid: false,
        error: `Unsupported platform: ${
          request.platform
        }. Supported platforms: ${supportedPlatforms.join(", ")}`,
      };
    }

    return { valid: true };
  }

  // Notify your frontend web application
  notifyFrontend(data) {
    console.log("📤 Notifying frontend:", data);
    // This would send messages back to your web app
    // You might need to implement this based on your specific setup
  }

  // Clean up finished automations
  async cleanupFinishedAutomations() {
    for (const [sessionId, automation] of this.activeAutomations.entries()) {
      const status = automation.getStatus();

      if (["completed", "stopped", "failed"].includes(status.status)) {
        console.log(`🧹 Cleaning up finished automation: ${sessionId}`);
        this.activeAutomations.delete(sessionId);

        // Cleanup the automation instance
        if (automation.cleanup) {
          automation.cleanup();
        }
      }
    }
  }

  // Get automation statistics
  getAutomationStats() {
    return {
      activeAutomations: this.activeAutomations.size,
      activeSessions: Array.from(this.activeAutomations.keys()),
      automationWindows: this.backgroundService
        ? this.backgroundService.getAutomationWindowsCount()
        : 0,
    };
  }
}
