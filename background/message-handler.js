// background/message-handler.js
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
    this.processingRequests = new Set(); // Track processing requests to prevent duplicates
  }

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

  // Handle internal messages from content scripts
  handleInternalMessage(request, sender, sendResponse) {
    switch (request.action) {
      case "checkIfAutomationWindow":
        return this.windowManager.checkIfAutomationWindow(sender, sendResponse);

      case "contentScriptReady":
        this.handleContentScriptReady(request, sender, sendResponse);
        break;

      case "contentScriptError":
        this.handleContentScriptError(request, sender, sendResponse);
        break;

      case "reportProgress":
        this.handleProgressReport(request, sender, sendResponse);
        break;

      case "reportError":
        this.handleErrorReport(request, sender, sendResponse);
        break;

      case "applicationSubmitted":
        this.handleApplicationSubmitted(request, sender, sendResponse);
        break;

      case "statusUpdate":
        this.handleStatusUpdate(request, sender, sendResponse);
        break;

      case "platformNotification":
        this.handlePlatformNotification(request, sender, sendResponse);
        break;

      default:
        sendResponse({ error: "Unknown internal action" });
    }

    return true;
  }

  async handleStartApplying(request, sendResponse) {
    try {
      console.log("📨 Start applying request received:", request);
      
      // Create unique request ID to prevent duplicates
      const requestId = `${request.platform}_${request.userId}_${Date.now()}`;
      
      // Check if we're already processing a similar request
      if (this.processingRequests.has(requestId.substring(0, requestId.lastIndexOf('_')))) {
        console.log("🔄 Duplicate request detected, ignoring");
        sendResponse({
          status: "error",
          message: "Request already being processed"
        });
        return;
      }
      
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

      // Mark request as processing
      const processingKey = `${platform}_${userId}`;
      this.processingRequests.add(processingKey);

      try {
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
        });

        // Start automation using orchestrator
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

          await this.sessionManager.updateSession(sessionId, {
            status: "running",
            windowId: result.windowId
          });

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
            windowId: result.windowId
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
      } finally {
        // Remove from processing set after delay to prevent rapid duplicate requests
        setTimeout(() => {
          this.processingRequests.delete(processingKey);
        }, 5000);
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

      // Notify frontend
      this.notifyFrontend({
        type: "automation_paused",
        sessionId
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

      // Notify frontend
      this.notifyFrontend({
        type: "automation_stopped",
        sessionId
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

  handleContentScriptReady(request, sender, sendResponse) {
    const { sessionId, platform, url } = request;
    
    console.log(`📱 Content script ready: ${platform} session ${sessionId}`);
    
    // Update session with tab info
    if (sender.tab) {
      this.sessionManager.updateSession(sessionId, {
        tabId: sender.tab.id,
        currentUrl: url,
        contentScriptReady: true,
        readyAt: Date.now()
      });
    }

    sendResponse({ success: true });
  }

  handleContentScriptError(request, sender, sendResponse) {
    const { sessionId, platform, error, url } = request;

    console.error(`❌ Content script error in ${platform} session ${sessionId}:`, error);

    // Update session with error
    this.sessionManager.updateSession(sessionId, {
      status: "error",
      error,
      errorTime: Date.now(),
      currentUrl: url
    });

    // Notify frontend
    this.notifyFrontend({
      type: "content_script_error",
      sessionId,
      platform,
      error,
      url
    });

    sendResponse({ success: true });
  }

  handleProgressReport(request, sender, sendResponse) {
    const { sessionId, progress } = request;

    // Update session with progress
    this.sessionManager.updateSession(sessionId, {
      progress,
      lastActivity: Date.now(),
    });

    // Notify frontend
    this.notifyFrontend({
      type: "progress_update",
      sessionId,
      progress,
    });

    sendResponse({ success: true });
  }

  handleErrorReport(request, sender, sendResponse) {
    const { sessionId, error, context } = request;

    console.error(`❌ Automation error in session ${sessionId}:`, error);

    // Update session
    this.sessionManager.updateSession(sessionId, {
      status: "error",
      error,
      errorContext: context,
      errorTime: Date.now(),
    });

    // Notify frontend
    this.notifyFrontend({
      type: "automation_error",
      sessionId,
      error,
      context,
    });

    sendResponse({ success: true });
  }

  handleApplicationSubmitted(request, sender, sendResponse) {
    const { sessionId, jobData, applicationData } = request;

    // Track application
    this.sessionManager.addApplication(sessionId, {
      jobData,
      applicationData,
      submittedAt: Date.now(),
      tabId: sender.tab?.id,
      url: sender.tab?.url,
    });

    // Notify frontend
    this.notifyFrontend({
      type: "application_submitted",
      sessionId,
      jobData,
      applicationData,
    });

    sendResponse({ success: true });
  }

  handleStatusUpdate(request, sender, sendResponse) {
    const { status, message, timestamp } = request;

    // Forward status update to frontend
    this.notifyFrontend({
      type: "status_update",
      status,
      message,
      timestamp: timestamp || Date.now()
    });

    sendResponse({ success: true });
  }

  handlePlatformNotification(request, sender, sendResponse) {
    const { type, data, sessionId, platform } = request;

    // Update session activity
    this.sessionManager.updateSession(sessionId, {
      lastActivity: Date.now(),
      lastNotification: { type, data, timestamp: Date.now() }
    });

    // Forward to frontend
    this.notifyFrontend({
      type: "platform_notification",
      sessionId,
      platform,
      notificationType: type,
      data
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
    // This would send messages back to your web app
    // You might need to implement this based on your specific setup
    console.log("📤 Notifying frontend:", data);

    // Example: You could use chrome.tabs.sendMessage to active tabs
    // or implement a webhook/websocket connection to your frontend
    
    // For now, we'll store the notification for potential retrieval
    if (data.sessionId) {
      this.sessionManager.addNotification(data.sessionId, data);
    }
  }
}