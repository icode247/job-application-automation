// background/message-handler.js
import AutomationOrchestrator from "../core/automation-orchestrator.js";
import SessionManager from "./session-manager.js";
import WindowManager from "./window-manager.js";

export default class MessageHandler {
  constructor() {
    this.orchestrator = new AutomationOrchestrator();
    this.sessionManager = new SessionManager();
    this.windowManager = new WindowManager();
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

      case "healthCheck":
        this.handleHealthCheck(request, sendResponse);
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

      case "automationComplete":
        this.handleAutomationComplete(request, sender, sendResponse);
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

      // Create automation session in session manager
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

      // Start automation orchestration (creates window + sends message to content script)
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
        // Update session status
        await this.sessionManager.updateSession(sessionId, {
          status: "started",
          windowId: result.windowId,
        });

        sendResponse({
          status: "started",
          platform: platform,
          sessionId: sessionId,
          message: `Job search started for ${platform}! Session: ${sessionId}`,
        });

        // Notify frontend about successful start
        this.notifyFrontend({
          type: "automation_started",
          sessionId,
          platform,
          jobsToApply,
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

    try {
      const success = await this.orchestrator.pauseAutomation(sessionId);
      
      if (success) {
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
    } catch (error) {
      sendResponse({
        status: "error",
        message: "Failed to pause automation",
      });
    }
  }

  async handleStopApplying(request, sendResponse) {
    const { sessionId } = request;

    try {
      const success = await this.orchestrator.stopAutomation(sessionId);
      
      if (success) {
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
    } catch (error) {
      sendResponse({
        status: "error",
        message: "Failed to stop automation",
      });
    }
  }

  async handleGetStatus(request, sendResponse) {
    const { sessionId } = request;

    try {
      const session = await this.sessionManager.getSession(sessionId);
      const progress = this.orchestrator.getAutomationStatus(sessionId);

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

  handleHealthCheck(request, sendResponse) {
    sendResponse({
      status: "healthy",
      timestamp: Date.now(),
      version: "2.1.0"
    });
  }

  handleProgressReport(request, sender, sendResponse) {
    const { sessionId, progress } = request;

    try {
      // Update orchestrator with progress
      this.orchestrator.handleProgressUpdate(sessionId, progress);

      // Update session manager
      this.sessionManager.updateSession(sessionId, {
        progress,
        lastActivity: Date.now(),
        status: "running"
      });

      // Notify frontend
      this.notifyFrontend({
        type: "progress_update",
        sessionId,
        progress,
      });

      sendResponse({ success: true });
    } catch (error) {
      console.error("Error handling progress report:", error);
      sendResponse({ success: false, error: error.message });
    }
  }

  handleErrorReport(request, sender, sendResponse) {
    const { sessionId, error, context } = request;

    try {
      console.error(`Automation error in session ${sessionId}:`, error);

      // Update orchestrator
      this.orchestrator.handleErrorReport(sessionId, error, context);

      // Update session
      this.sessionManager.updateSession(sessionId, {
        lastError: {
          message: error,
          context,
          timestamp: Date.now()
        },
        lastActivity: Date.now(),
      });

      // Notify frontend
      this.notifyFrontend({
        type: "automation_error",
        sessionId,
        error,
        context,
      });

      sendResponse({ success: true });
    } catch (err) {
      console.error("Error handling error report:", err);
      sendResponse({ success: false, error: err.message });
    }
  }

  handleApplicationSubmitted(request, sender, sendResponse) {
    const { sessionId, jobData, applicationData } = request;

    try {
      // Update orchestrator
      this.orchestrator.handleApplicationSubmitted(sessionId, jobData, applicationData);

      // Track application in session manager
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
    } catch (error) {
      console.error("Error handling application submission:", error);
      sendResponse({ success: false, error: error.message });
    }
  }

  handleContentScriptReady(request, sender, sendResponse) {
    const { sessionId, platform, url } = request;
    
    console.log(`📱 Content script ready for session ${sessionId} on ${platform}`);
    
    // Update session status
    this.sessionManager.updateSession(sessionId, {
      status: "content_ready",
      currentUrl: url,
      contentScriptLoadedAt: Date.now()
    });

    sendResponse({ success: true });
  }

  handleAutomationComplete(request, sender, sendResponse) {
    const { sessionId, progress, duration } = request;

    try {
      // Update session as completed
      this.sessionManager.updateSession(sessionId, {
        status: "completed",
        completedAt: Date.now(),
        finalProgress: progress,
        totalDuration: duration
      });

      // Notify frontend
      this.notifyFrontend({
        type: "automation_completed",
        sessionId,
        progress,
        duration,
      });

      sendResponse({ success: true });
    } catch (error) {
      console.error("Error handling automation complete:", error);
      sendResponse({ success: false, error: error.message });
    }
  }

  handlePlatformNotification(request, sender, sendResponse) {
    const { type, data, sessionId, platform } = request;

    console.log(`📢 Platform notification from ${platform}:`, type, data);

    // Route platform notifications to appropriate handlers
    switch (type) {
      case "progress":
        this.handleProgressReport({ sessionId, progress: data }, sender, sendResponse);
        break;
      case "error":
        this.handleErrorReport({ sessionId, error: data.message, context: data.context }, sender, sendResponse);
        break;
      case "applicationSubmitted":
        this.handleApplicationSubmitted({ sessionId, jobData: data.jobData, applicationData: data.applicationData }, sender, sendResponse);
        break;
      default:
        sendResponse({ success: true });
    }
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

    // In a real implementation, you might:
    // - Send to specific tabs that have your web app open
    // - Use webhooks to notify your backend
    // - Store in shared storage for the frontend to poll
    
    // Example: Send to all tabs with your domain
    // chrome.tabs.query({ url: "https://yourdomain.com/*" }, (tabs) => {
    //   tabs.forEach(tab => {
    //     chrome.tabs.sendMessage(tab.id, {
    //       type: "automation_update",
    //       data
    //     });
    //   });
    // });
  }
}