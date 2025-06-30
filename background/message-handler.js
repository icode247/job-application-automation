
// background/message-handler.js - UPDATED WITH LEVER AUTOMATION FLOW
import AutomationOrchestrator from "../core/automation-orchestrator.js";
import SessionManager from "./session-manager.js";
import WindowManager from "./window-manager.js";

export default class MessageHandler {
  constructor() {
    this.orchestrator = new AutomationOrchestrator();
    this.sessionManager = new SessionManager();
    this.windowManager = new WindowManager();
    this.activeAutomations = new Map();
    this.pendingRequests = new Set();
    
    // NEW: Lever-specific state management
    this.leverAutomations = new Map(); // sessionId -> automation state
    this.portConnections = new Map(); // tabId -> port
    
    // Set up port-based communication for Lever
    this.setupPortHandlers();
  }

  // NEW: Set up long-lived port connections for Lever automation
  setupPortHandlers() {
    chrome.runtime.onConnect.addListener((port) => {
      console.log("📨 New port connection established:", port.name);
      
      // Check if this is a Lever automation port
      if (port.name.startsWith('lever-')) {
        this.handleLeverPortConnection(port);
      }
    });
  }

  // NEW: Handle Lever-specific port connections
  handleLeverPortConnection(port) {
    const portNameParts = port.name.split('-');
    const portType = portNameParts[1]; // 'search' or 'apply'
    const tabId = parseInt(portNameParts[2]) || port.sender?.tab?.id;
    
    if (tabId) {
      this.portConnections.set(tabId, port);
      console.log(`📝 Registered ${portType} port for tab ${tabId}`);
    }
    
    // Set up message handler for this port
    port.onMessage.addListener((message) => {
      this.handleLeverPortMessage(message, port);
    });
    
    // Handle port disconnection
    port.onDisconnect.addListener(() => {
      console.log("📪 Port disconnected:", port.name);
      if (tabId) {
        this.portConnections.delete(tabId);
      }
    });
  }

  // NEW: Handle messages from Lever content scripts via ports
  async handleLeverPortMessage(message, port) {
    try {
      console.log("📨 Lever port message received:", message);
      
      const { type, data } = message;
      const tabId = port.sender?.tab?.id;
      
      switch (type) {
        case 'GET_SEARCH_TASK':
          await this.handleGetSearchTask(port, data);
          break;
          
        case 'GET_SEND_CV_TASK':
          await this.handleGetSendCvTask(port, data);
          break;
          
        case 'SEND_CV_TASK':
          await this.handleSendCvTask(port, data);
          break;
          
        case 'SEND_CV_TASK_DONE':
          await this.handleSendCvTaskDone(port, data);
          break;
          
        case 'SEND_CV_TASK_ERROR':
          await this.handleSendCvTaskError(port, data);
          break;
          
        case 'SEND_CV_TASK_SKIP':
          await this.handleSendCvTaskSkip(port, data);
          break;
          
        case 'SEARCH_TASK_DONE':
          await this.handleSearchTaskDone(port, data);
          break;
          
        case 'VERIFY_APPLICATION_STATUS':
          await this.handleVerifyApplicationStatus(port, data);
          break;
          
        case 'CHECK_JOB_TAB_STATUS':
          await this.handleCheckJobTabStatus(port, data);
          break;
          
        case 'SEARCH_NEXT_READY':
          await this.handleSearchNextReady(port, data);
          break;
          
        default:
          console.log(`❓ Unhandled Lever port message type: ${type}`);
          this.sendPortResponse(port, {
            type: 'ERROR',
            message: `Unknown message type: ${type}`
          });
      }
    } catch (error) {
      console.error("❌ Error handling Lever port message:", error);
      this.sendPortResponse(port, {
        type: 'ERROR',
        message: error.message
      });
    }
  }

  // NEW: Handle GET_SEARCH_TASK for Lever
  async handleGetSearchTask(port, data) {
    const tabId = port.sender?.tab?.id;
    const windowId = port.sender?.tab?.windowId;
    
    // Find the automation session for this window
    let sessionData = null;
    for (const [sessionId, automation] of this.activeAutomations.entries()) {
      if (automation.windowId === windowId) {
        sessionData = {
          tabId: tabId,
          limit: automation.params?.jobsToApply || 10,
          current: 0,
          domain: ['https://jobs.lever.co'],
          submittedLinks: automation.submittedLinks || [],
          searchLinkPattern: /^https:\/\/jobs\.lever\.co\/[^\/]+\/[^\/]+\/?.*$/.toString()
        };
        break;
      }
    }
    
    this.sendPortResponse(port, {
      type: 'SUCCESS',
      data: sessionData || {}
    });
  }

  // NEW: Handle GET_SEND_CV_TASK for Lever
  async handleGetSendCvTask(port, data) {
    const tabId = port.sender?.tab?.id;
    const windowId = port.sender?.tab?.windowId;
    
    // Find the automation session for this window
    let sessionData = null;
    for (const [sessionId, automation] of this.activeAutomations.entries()) {
      if (automation.windowId === windowId) {
        sessionData = {
          devMode: automation.params?.devMode || false,
          profile: automation.userProfile,
          session: automation.sessionConfig,
          avatarUrl: automation.userProfile?.avatarUrl
        };
        break;
      }
    }
    
    this.sendPortResponse(port, {
      type: 'SUCCESS',
      data: sessionData || {}
    });
  }

  // NEW: Handle SEND_CV_TASK - open job in new tab
  async handleSendCvTask(port, data) {
    try {
      const { url, title } = data;
      const windowId = port.sender?.tab?.windowId;
      
      console.log(`🎯 Opening job in new tab: ${url}`);
      
      // Find the automation session
      let automation = null;
      for (const [sessionId, auto] of this.activeAutomations.entries()) {
        if (auto.windowId === windowId) {
          automation = auto;
          break;
        }
      }
      
      if (!automation) {
        throw new Error('No automation session found');
      }
      
      // Check if already processing a job
      if (automation.isProcessingJob) {
        this.sendPortResponse(port, {
          type: 'ERROR',
          message: 'Already processing another job'
        });
        return;
      }
      
      // Check for duplicates
      const normalizedUrl = this.normalizeUrl(url);
      if (automation.submittedLinks?.some(link => 
        this.normalizeUrl(link.url) === normalizedUrl)) {
        this.sendPortResponse(port, {
          type: 'DUPLICATE',
          message: 'This job has already been processed',
          data: { url }
        });
        return;
      }
      
      // Create new tab for job application
      const tab = await chrome.tabs.create({
        url: url.endsWith('/apply') ? url : url + '/apply',
        windowId: windowId,
        active: true
      });
      
      // Update automation state
      automation.isProcessingJob = true;
      automation.currentJobUrl = url;
      automation.currentJobTabId = tab.id;
      automation.applicationStartTime = Date.now();
      
      // Add to submitted links as processing
      if (!automation.submittedLinks) {
        automation.submittedLinks = [];
      }
      automation.submittedLinks.push({
        url: url,
        status: 'PROCESSING',
        timestamp: Date.now()
      });
      
      this.sendPortResponse(port, {
        type: 'SUCCESS',
        message: 'Apply tab will be created'
      });
      
      console.log(`✅ Job tab created: ${tab.id} for URL: ${url}`);
      
    } catch (error) {
      console.error("❌ Error handling SEND_CV_TASK:", error);
      this.sendPortResponse(port, {
        type: 'ERROR',
        message: error.message
      });
    }
  }

  // NEW: Handle SEND_CV_TASK_DONE - job application completed successfully
  async handleSendCvTaskDone(port, data) {
    try {
      const windowId = port.sender?.tab?.windowId;
      const tabId = port.sender?.tab?.id;
      
      console.log(`✅ Job application completed successfully in tab ${tabId}`);
      
      // Find automation session
      let automation = null;
      for (const [sessionId, auto] of this.activeAutomations.entries()) {
        if (auto.windowId === windowId) {
          automation = auto;
          break;
        }
      }
      
      if (automation) {
        // Update submitted links
        const url = automation.currentJobUrl;
        if (url && automation.submittedLinks) {
          const linkIndex = automation.submittedLinks.findIndex(link => 
            this.normalizeUrl(link.url) === this.normalizeUrl(url));
          if (linkIndex >= 0) {
            automation.submittedLinks[linkIndex].status = 'SUCCESS';
            automation.submittedLinks[linkIndex].details = data;
          }
        }
        
        // Close the job tab
        if (automation.currentJobTabId) {
          try {
            await chrome.tabs.remove(automation.currentJobTabId);
          } catch (error) {
            console.warn("⚠️ Error closing job tab:", error);
          }
        }
        
        // Reset processing state
        automation.isProcessingJob = false;
        const oldUrl = automation.currentJobUrl;
        automation.currentJobUrl = null;
        automation.currentJobTabId = null;
        automation.applicationStartTime = null;
        
        // Notify search tab to continue
        await this.sendSearchNextMessage(windowId, {
          url: oldUrl,
          status: 'SUCCESS',
          data: data
        });
      }
      
      this.sendPortResponse(port, {
        type: 'SUCCESS',
        message: 'Application completed'
      });
      
    } catch (error) {
      console.error("❌ Error handling SEND_CV_TASK_DONE:", error);
      this.sendPortResponse(port, {
        type: 'ERROR',
        message: error.message
      });
    }
  }

  // NEW: Handle SEND_CV_TASK_ERROR - job application failed
  async handleSendCvTaskError(port, data) {
    try {
      const windowId = port.sender?.tab?.windowId;
      const tabId = port.sender?.tab?.id;
      
      console.log(`❌ Job application failed in tab ${tabId}:`, data);
      
      // Find automation session
      let automation = null;
      for (const [sessionId, auto] of this.activeAutomations.entries()) {
        if (auto.windowId === windowId) {
          automation = auto;
          break;
        }
      }
      
      if (automation) {
        // Update submitted links
        const url = automation.currentJobUrl;
        if (url && automation.submittedLinks) {
          const linkIndex = automation.submittedLinks.findIndex(link => 
            this.normalizeUrl(link.url) === this.normalizeUrl(url));
          if (linkIndex >= 0) {
            automation.submittedLinks[linkIndex].status = 'ERROR';
            automation.submittedLinks[linkIndex].error = data;
          }
        }
        
        // Close the job tab
        if (automation.currentJobTabId) {
          try {
            await chrome.tabs.remove(automation.currentJobTabId);
          } catch (error) {
            console.warn("⚠️ Error closing job tab:", error);
          }
        }
        
        // Reset processing state
        automation.isProcessingJob = false;
        const oldUrl = automation.currentJobUrl;
        automation.currentJobUrl = null;
        automation.currentJobTabId = null;
        automation.applicationStartTime = null;
        
        // Notify search tab to continue
        await this.sendSearchNextMessage(windowId, {
          url: oldUrl,
          status: 'ERROR',
          message: typeof data === 'string' ? data : 'Application error'
        });
      }
      
      this.sendPortResponse(port, {
        type: 'SUCCESS',
        message: 'Error acknowledged'
      });
      
    } catch (error) {
      console.error("❌ Error handling SEND_CV_TASK_ERROR:", error);
    }
  }

  // NEW: Handle SEND_CV_TASK_SKIP - job application skipped
  async handleSendCvTaskSkip(port, data) {
    try {
      const windowId = port.sender?.tab?.windowId;
      const tabId = port.sender?.tab?.id;
      
      console.log(`⏭️ Job application skipped in tab ${tabId}:`, data);
      
      // Find automation session
      let automation = null;
      for (const [sessionId, auto] of this.activeAutomations.entries()) {
        if (auto.windowId === windowId) {
          automation = auto;
          break;
        }
      }
      
      if (automation) {
        // Update submitted links
        const url = automation.currentJobUrl;
        if (url && automation.submittedLinks) {
          const linkIndex = automation.submittedLinks.findIndex(link => 
            this.normalizeUrl(link.url) === this.normalizeUrl(url));
          if (linkIndex >= 0) {
            automation.submittedLinks[linkIndex].status = 'SKIPPED';
            automation.submittedLinks[linkIndex].reason = data;
          }
        }
        
        // Close the job tab
        if (automation.currentJobTabId) {
          try {
            await chrome.tabs.remove(automation.currentJobTabId);
          } catch (error) {
            console.warn("⚠️ Error closing job tab:", error);
          }
        }
        
        // Reset processing state
        automation.isProcessingJob = false;
        const oldUrl = automation.currentJobUrl;
        automation.currentJobUrl = null;
        automation.currentJobTabId = null;
        automation.applicationStartTime = null;
        
        // Notify search tab to continue
        await this.sendSearchNextMessage(windowId, {
          url: oldUrl,
          status: 'SKIPPED',
          message: data
        });
      }
      
      this.sendPortResponse(port, {
        type: 'SUCCESS',
        message: 'Skip acknowledged'
      });
      
    } catch (error) {
      console.error("❌ Error handling SEND_CV_TASK_SKIP:", error);
    }
  }

  // NEW: Handle VERIFY_APPLICATION_STATUS
  async handleVerifyApplicationStatus(port, data) {
    const windowId = port.sender?.tab?.windowId;
    
    // Find automation session
    let automation = null;
    for (const [sessionId, auto] of this.activeAutomations.entries()) {
      if (auto.windowId === windowId) {
        automation = auto;
        break;
      }
    }
    
    const isActive = automation ? automation.isProcessingJob : false;
    
    this.sendPortResponse(port, {
      type: 'APPLICATION_STATUS_RESPONSE',
      data: {
        active: isActive,
        url: automation?.currentJobUrl || null,
        tabId: automation?.currentJobTabId || null
      }
    });
  }

  // NEW: Handle CHECK_JOB_TAB_STATUS
  async handleCheckJobTabStatus(port, data) {
    const windowId = port.sender?.tab?.windowId;
    
    // Find automation session
    let automation = null;
    for (const [sessionId, auto] of this.activeAutomations.entries()) {
      if (auto.windowId === windowId) {
        automation = auto;
        break;
      }
    }
    
    const isOpen = automation ? automation.isProcessingJob : false;
    
    this.sendPortResponse(port, {
      type: 'JOB_TAB_STATUS',
      data: {
        isOpen: isOpen,
        tabId: automation?.currentJobTabId || null,
        isProcessing: isOpen
      }
    });
  }

  // NEW: Handle SEARCH_NEXT_READY
  async handleSearchNextReady(port, data) {
    console.log("🔄 Search ready for next job");
    
    this.sendPortResponse(port, {
      type: 'NEXT_READY_ACKNOWLEDGED',
      data: { status: 'success' }
    });
  }

  // NEW: Handle SEARCH_TASK_DONE
  async handleSearchTaskDone(port, data) {
    const windowId = port.sender?.tab?.windowId;
    
    console.log(`🏁 Search task completed for window ${windowId}`);
    
    // Show completion notification
    try {
      chrome.notifications.create({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'Lever Job Search Completed',
        message: 'All job applications have been processed.'
      });
    } catch (error) {
      console.warn("⚠️ Error showing notification:", error);
    }
    
    this.sendPortResponse(port, {
      type: 'SUCCESS',
      message: 'Search completion acknowledged'
    });
  }

  // NEW: Send SEARCH_NEXT message to search tab
  async sendSearchNextMessage(windowId, data) {
    try {
      console.log(`📤 Sending SEARCH_NEXT message to window ${windowId}:`, data);
      
      // Get all tabs in the window
      const tabs = await chrome.tabs.query({ windowId: windowId });
      
      // Find the search tab (Google search page)
      for (const tab of tabs) {
        if (tab.url && tab.url.includes('google.com/search')) {
          // Try port-based communication first
          const port = this.portConnections.get(tab.id);
          if (port) {
            try {
              port.postMessage({
                type: 'SEARCH_NEXT',
                data: data
              });
              console.log(`✅ Sent SEARCH_NEXT via port to tab ${tab.id}`);
              return true;
            } catch (error) {
              console.warn("⚠️ Port message failed, trying tabs API:", error);
            }
          }
          
          // Fallback to tabs API
          try {
            await chrome.tabs.sendMessage(tab.id, {
              type: 'SEARCH_NEXT',
              data: data
            });
            console.log(`✅ Sent SEARCH_NEXT via tabs API to tab ${tab.id}`);
            return true;
          } catch (error) {
            console.warn("⚠️ Tabs API message failed:", error);
          }
        }
      }
      
      console.warn("⚠️ Could not find search tab to send SEARCH_NEXT message");
      return false;
      
    } catch (error) {
      console.error("❌ Error sending SEARCH_NEXT message:", error);
      return false;
    }
  }

  // NEW: Utility method to send response via port
  sendPortResponse(port, message) {
    try {
      if (port && port.sender) {
        port.postMessage(message);
      }
    } catch (error) {
      console.warn("⚠️ Failed to send port response:", error);
    }
  }

  // NEW: Utility method to normalize URLs for comparison
  normalizeUrl(url) {
    try {
      if (!url) return '';
      
      // Handle URLs with or without protocol
      if (!url.startsWith('http')) {
        url = 'https://' + url;
      }
      
      // Remove /apply suffix commonly found in Lever job URLs
      url = url.replace(/\/apply$/, '');
      
      const urlObj = new URL(url);
      // Remove trailing slashes and query parameters
      return (urlObj.origin + urlObj.pathname)
        .toLowerCase()
        .trim()
        .replace(/\/+$/, '');
    } catch (e) {
      console.warn("⚠️ Error normalizing URL:", e);
      return url.toLowerCase().trim();
    }
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
        apiHost = "http://localhost:3000",
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
        apiHost
      });

      if (result.success) {
        // UPDATED: Enhanced automation instance for Lever
        const automationInstance = result.automationInstance;
        
        // Initialize Lever-specific properties
        automationInstance.isProcessingJob = false;
        automationInstance.currentJobUrl = null;
        automationInstance.currentJobTabId = null;
        automationInstance.applicationStartTime = null;
        automationInstance.submittedLinks = submittedLinks || [];
        automationInstance.params = {
          userId,
          jobsToApply,
          submittedLinks,
          devMode,
          preferences,
          apiHost
        };

        this.activeAutomations.set(sessionId, automationInstance);

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