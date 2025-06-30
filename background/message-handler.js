// background/message-handler.js - COMPLETE FILE WITH ALL LEVER UPDATES
import AutomationOrchestrator from "../core/automation-orchestrator.js";
import SessionManager from "./session-manager.js";
import WindowManager from "./window-manager.js";

export default class MessageHandler {
  constructor() {
    this.orchestrator = new AutomationOrchestrator();
    this.sessionManager = new SessionManager();
    this.windowManager = new WindowManager();
    this.activeAutomations = new Map();
    this.pendingRequests = new Set(); // Track pending requests to prevent duplicates
  }

  // Handle messages from your frontend web application
  handleExternalMessage(request, sender, sendResponse) {
    console.log("📨 External message received:", request);

    // Prevent duplicate requests
    const requestKey = `${request.action}_${request.userId}_${request.platform}`;
    if (this.pendingRequests.has(requestKey)) {
      console.log("🔄 Duplicate request detected, ignoring");
      sendResponse({
        status: "error",
        message: "Duplicate request already in progress",
      });
      return true;
    }

    switch (request.action) {
      case "startApplying":
        this.pendingRequests.add(requestKey);
        this.handleStartApplying(request, sendResponse).finally(() => {
          this.pendingRequests.delete(requestKey);
        });
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

      case "reportProgress":
        this.handleProgressReport(request, sender, sendResponse);
        break;

      case "reportError":
        this.handleErrorReport(request, sender, sendResponse);
        break;

      case "applicationSubmitted":
        this.handleApplicationSubmitted(request, sender, sendResponse);
        break;

      // NEW: Added for Lever tab management
      case "openJobInNewTab":
        this.handleOpenJobInNewTab(request, sender, sendResponse);
        break;

      case "applicationCompleted":
        this.handleApplicationCompleted(request, sender, sendResponse);
        break;

      case "applicationError":
        this.handleApplicationError(request, sender, sendResponse);
        break;

      case "applicationSkipped":
        this.handleApplicationSkipped(request, sender, sendResponse);
        break;

      default:
        sendResponse({ error: "Unknown internal action" });
    }

    return true;
  }

  // NEW: Handle request to open job in new tab
  async handleOpenJobInNewTab(request, sender, sendResponse) {
    try {
      const { url, title, sessionId, platform } = request;
      
      // Find the active automation for this session
      const automation = this.activeAutomations.get(sessionId);
      if (!automation) {
        sendResponse({
          success: false,
          error: "No active automation found for session"
        });
        return;
      }

      // Check if already processing a job
      if (automation.isProcessingJob) {
        sendResponse({
          success: false,
          error: "Already processing another job"
        });
        return;
      }

      // Create new tab for job application
      const tab = await chrome.tabs.create({
        url: url,
        windowId: automation.windowId,
        active: true
      });

      // Mark automation as processing job
      automation.isProcessingJob = true;
      automation.currentJobUrl = url;
      automation.currentJobTabId = tab.id;

      sendResponse({
        success: true,
        tabId: tab.id,
        message: "Job tab opened successfully"
      });

    } catch (error) {
      console.error("Error opening job in new tab:", error);
      sendResponse({
        success: false,
        error: error.message
      });
    }
  }

  // NEW: Handle successful application completion
  async handleApplicationCompleted(request, sender, sendResponse) {
    try {
      const { sessionId, data, url } = request;
      
      const automation = this.activeAutomations.get(sessionId);
      if (automation) {
        // Reset job processing state
        automation.isProcessingJob = false;
        automation.currentJobUrl = null;
        
        // Close the job tab
        if (automation.currentJobTabId) {
          try {
            await chrome.tabs.remove(automation.currentJobTabId);
          } catch (error) {
            console.error("Error closing job tab:", error);
          }
          automation.currentJobTabId = null;
        }
        
        // Notify search tab to continue
        await this.notifySearchTabNext(automation.windowId, {
          url: url || automation.currentJobUrl,
          status: "SUCCESS",
          data: data
        });
      }

      sendResponse({ success: true });
    } catch (error) {
      console.error("Error handling application completion:", error);
      sendResponse({ success: false, error: error.message });
    }
  }

  // NEW: Handle application error
  async handleApplicationError(request, sender, sendResponse) {
    try {
      const { sessionId, message, url } = request;
      
      const automation = this.activeAutomations.get(sessionId);
      if (automation) {
        // Reset job processing state
        automation.isProcessingJob = false;
        automation.currentJobUrl = null;
        
        // Close the job tab
        if (automation.currentJobTabId) {
          try {
            await chrome.tabs.remove(automation.currentJobTabId);
          } catch (error) {
            console.error("Error closing job tab:", error);
          }
          automation.currentJobTabId = null;
        }
        
        // Notify search tab to continue
        await this.notifySearchTabNext(automation.windowId, {
          url: url || automation.currentJobUrl,
          status: "ERROR",
          message: message
        });
      }

      sendResponse({ success: true });
    } catch (error) {
      console.error("Error handling application error:", error);
      sendResponse({ success: false, error: error.message });
    }
  }

  // NEW: Handle application skipped
  async handleApplicationSkipped(request, sender, sendResponse) {
    try {
      const { sessionId, message, url } = request;
      
      const automation = this.activeAutomations.get(sessionId);
      if (automation) {
        // Reset job processing state
        automation.isProcessingJob = false;
        automation.currentJobUrl = null;
        
        // Close the job tab
        if (automation.currentJobTabId) {
          try {
            await chrome.tabs.remove(automation.currentJobTabId);
          } catch (error) {
            console.error("Error closing job tab:", error);
          }
          automation.currentJobTabId = null;
        }
        
        // Notify search tab to continue
        await this.notifySearchTabNext(automation.windowId, {
          url: url || automation.currentJobUrl,
          status: "SKIPPED",
          message: message
        });
      }

      sendResponse({ success: true });
    } catch (error) {
      console.error("Error handling application skip:", error);
      sendResponse({ success: false, error: error.message });
    }
  }

  // NEW: Notify search tab to continue processing next job
  async notifySearchTabNext(windowId, data) {
    try {
      // Get all tabs in the automation window
      const tabs = await chrome.tabs.query({ windowId: windowId });
      
      // Find the search tab (Google search page)
      for (const tab of tabs) {
        if (tab.url && tab.url.includes('google.com/search')) {
          await chrome.tabs.sendMessage(tab.id, {
            type: 'SEARCH_NEXT',
            data: data
          });
          break;
        }
      }
    } catch (error) {
      console.error("Error notifying search tab:", error);
    }
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
        apiHost = "http://localhost:3000", // Default API host
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
      });

      // Start automation
      const result = await this.orchestrator.startAutomation({
        sessionId,
        platform,
        userId, // Ensure userId is passed
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
        apiHost
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

  handleContentScriptReady(request, sender, sendResponse) {
    const { sessionId, platform, url } = request;
    console.log(`📱 Content script ready: ${platform} session ${sessionId}`);

    // Find the active automation for this session
    const automation = this.activeAutomations.get(sessionId);
    if (automation && sender.tab) {
      // Send start message to content script with proper delay
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(sender.tab.id, {
            action: "startAutomation",
            sessionId: sessionId,
            config: automation.getConfig(), // Get config from automation instance
          });
          console.log(
            `📤 Sent start message to content script for session ${sessionId}`
          );
        } catch (error) {
          console.error(
            `❌ Failed to send start message to content script:`,
            error
          );
        }
      }, 1000); // Wait 1 second for content script to be fully ready
    }

    sendResponse({ success: true });
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

    console.error(`Automation error in session ${sessionId}:`, error);

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

    // UPDATED: Added lever to supported platforms
    const supportedPlatforms = [
      "linkedin",
      "indeed",
      "recruitee",
      "glassdoor",
      "workday",
      "lever",
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

  // Handle window closed - stop associated automations
  async handleWindowClosed(windowId) {
    for (const [sessionId, automation] of this.activeAutomations.entries()) {
      if (automation.windowId === windowId) {
        console.log(
          `🪟 Window ${windowId} closed, stopping automation ${sessionId}`
        );
        await automation.stop();
        this.activeAutomations.delete(sessionId);

        // Update session status
        await this.sessionManager.updateSession(sessionId, {
          status: "stopped",
          stoppedAt: Date.now(),
          reason: "Window closed",
        });

        // Notify frontend
        this.notifyFrontend({
          type: "automation_stopped",
          sessionId,
          reason: "Window closed",
        });
      }
    }
  }

  // Notify your frontend web application
  notifyFrontend(data) {
    console.log("📤 Notifying frontend:", data);
    // Implementation depends on your frontend communication method
  }
}