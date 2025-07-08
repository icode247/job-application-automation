import AutomationOrchestrator from "../core/automation-orchestrator.js";
import SessionManager from "./session-manager.js";
import WindowManager from "./window-manager.js";
import LeverAutomationHandler from "./platforms/lever.js";

export default class MessageHandler {
  constructor() {
    this.orchestrator = new AutomationOrchestrator();
    this.sessionManager = new SessionManager();
    this.windowManager = new WindowManager();
    
    // Platform automation state management
    this.activeAutomations = new Map(); // sessionId -> automation state
    this.portConnections = new Map(); // tabId -> port
    this.platformHandlers = new Map(); // platform -> handler instance
    
    // NEW: Tab session tracking
    this.tabSessions = new Map();
    this.windowSessions = new Map();
    
    // Pending requests tracking
    this.pendingRequests = new Set();
    
    // Set up port-based communication
    this.setupPortHandlers();
    
    // Initialize platform handlers
    this.initializePlatformHandlers();
    
    // Listen for tab creation to inject session context
    this.setupTabListeners();
  }

  setupTabListeners() {
    // Track new tabs created during automation
    chrome.tabs.onCreated.addListener((tab) => {
      this.handleTabCreated(tab);
    });

    // Track tab updates for session context injection
    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === 'complete') {
        this.handleTabUpdated(tab);
      }
    });

    // Clean up when tabs are closed
    chrome.tabs.onRemoved.addListener((tabId) => {
      this.tabSessions.delete(tabId);
      this.portConnections.delete(tabId);
    });
  }

  handleTabCreated(tab) {
    // Check if this tab was created in an automation window
    const sessionId = this.windowSessions.get(tab.windowId);
    if (sessionId) {
      console.log(`🆕 New tab ${tab.id} created in automation window ${tab.windowId}`);
      
      const automation = this.activeAutomations.get(sessionId);
      if (automation) {
        // Store session context for this tab
        this.tabSessions.set(tab.id, {
          sessionId: sessionId,
          platform: automation.platform,
          userId: automation.userId,
          windowId: tab.windowId,
          isAutomationTab: true,
          createdAt: Date.now(),
          parentSessionId: sessionId
        });
        
        console.log(`✅ Session context stored for tab ${tab.id}:`, this.tabSessions.get(tab.id));
      }
    }
  }

  async handleTabUpdated(tab) {
    // Inject session context into automation tabs
    const sessionData = this.tabSessions.get(tab.id);
    if (sessionData && tab.url) {
      try {
        // Inject session context via executeScript
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: (sessionData) => {
            // Store session data in multiple places for reliability
            window.automationSessionId = sessionData.sessionId;
            window.automationPlatform = sessionData.platform;
            window.automationUserId = sessionData.userId;
            window.isAutomationWindow = true;
            window.isAutomationTab = true;
            window.parentSessionId = sessionData.parentSessionId;
            
            // Also store in sessionStorage
            sessionStorage.setItem('automationSessionId', sessionData.sessionId);
            sessionStorage.setItem('automationPlatform', sessionData.platform);
            sessionStorage.setItem('automationUserId', sessionData.userId);
            sessionStorage.setItem('isAutomationWindow', 'true');
            sessionStorage.setItem('isAutomationTab', 'true');
            sessionStorage.setItem('parentSessionId', sessionData.parentSessionId);
            
            console.log('🔧 Session context injected into tab:', sessionData);
          },
          args: [sessionData]
        });
        
        console.log(`✅ Session context injected into tab ${tab.id}`);
      } catch (error) {
        console.warn(`⚠️ Failed to inject session context into tab ${tab.id}:`, error);
      }
    }
  }

  // Enhanced handleStartApplying to track window sessions
  async handleStartApplying(request, sendResponse) {
    try {
      console.log("📨 Start applying request received:", request);

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
        apiHost
      });

      if (result.success) {
        const automationInstance = result.automationInstance;
        
        // Store automation instance
        automationInstance.platform = platform;
        automationInstance.userId = userId;
        
        // Set up platform-specific state
        automationInstance.platformState = {
          isProcessingJob: false,
          currentJobUrl: null,
          currentJobTabId: null,
          applicationStartTime: null,
          submittedLinks: submittedLinks || [],
          searchTabId: null,
          searchData: {
            limit: jobsToApply,
            current: 0,
            domain: this.getPlatformDomains(platform),
            searchLinkPattern: this.getPlatformLinkPattern(platform)
          }
        };

        this.activeAutomations.set(sessionId, automationInstance);
        
        this.windowSessions.set(result.windowId, sessionId);
        
        console.log(`🪟 Window ${result.windowId} mapped to session ${sessionId}`);

        sendResponse({
          status: "started",
          platform: platform,
          sessionId: sessionId,
          windowId: result.windowId,
          message: `Job search started for ${platform}! Applying to ${jobsToApply} jobs.`,
        });

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

  // Enhanced handleContentScriptReady to provide session context
  handleContentScriptReady(request, sender, sendResponse) {
    const { sessionId, platform, url, userId } = request;
    console.log(`📱 Content script ready: ${platform} session ${sessionId} tab ${sender.tab?.id}`);

    // Store tab session if not already stored
    if (sender.tab && !this.tabSessions.has(sender.tab.id)) {
      this.tabSessions.set(sender.tab.id, {
        sessionId: sessionId,
        platform: platform,
        userId: userId,
        windowId: sender.tab.windowId,
        isAutomationTab: true,
        createdAt: Date.now()
      });
    }

    const automation = this.activeAutomations.get(sessionId);
    if (automation && sender.tab) {
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(sender.tab.id, {
            action: "startAutomation",
            sessionId: sessionId,
            config: automation.getConfig(),
            sessionContext: {
              sessionId: sessionId,
              platform: platform,
              userId: userId,
              userProfile: automation.userProfile,
              preferences: automation.preferences || {},
              apiHost: automation.apiHost
            }
          });
          console.log(`📤 Sent start message with context to content script for session ${sessionId}`);
        } catch (error) {
          console.error(`❌ Failed to send start message to content script:`, error);
        }
      }, 1000);
    }

    sendResponse({ success: true });
  }

  getTabSessionContext(tabId) {
    const sessionData = this.tabSessions.get(tabId);
    if (!sessionData) return null;

    const automation = this.activeAutomations.get(sessionData.sessionId);
    if (!automation) return null;

    return {
      sessionId: sessionData.sessionId,
      platform: sessionData.platform,
      userId: sessionData.userId,
      userProfile: automation.userProfile,
      preferences: automation.preferences || {},
      apiHost: automation.apiHost,
      sessionConfig: automation.sessionConfig
    };
  }

  initializePlatformHandlers() {
    this.platformHandlers.set('lever', new LeverAutomationHandler(this));
    // this.platformHandlers.set('workable', new WorkableAutomationHandler(this));
    // this.platformHandlers.set('recruitee', new RecruiteeAutomationHandler(this));
  }

  setupPortHandlers() {
    chrome.runtime.onConnect.addListener((port) => {
      console.log("📨 New port connection established:", port.name);
      
      // Determine platform from port name (e.g., "lever-search-123", "workable-apply-456")
      const portParts = port.name.split('-');
      if (portParts.length >= 3) {
        const platform = portParts[0];
        const handler = this.platformHandlers.get(platform);
        
        if (handler) {
          handler.handlePortConnection(port);
        } else {
          console.warn(`No handler found for platform: ${platform}`);
        }
      }
    });
  }

  async handlePlatformPortMessage(message, port, platform) {
    try {
      console.log(`📨 ${platform} port message received:`, message);
      
      const handler = this.platformHandlers.get(platform);
      if (handler) {
        await handler.handlePortMessage(message, port);
      } else {
        console.error(`No handler for platform: ${platform}`);
        this.sendPortResponse(port, {
          type: 'ERROR',
          message: `Unsupported platform: ${platform}`
        });
      }
    } catch (error) {
      console.error(`❌ Error handling ${platform} port message:`, error);
      this.sendPortResponse(port, {
        type: 'ERROR',
        message: error.message
      });
    }
  }

  sendPortResponse(port, message) {
    try {
      if (port && port.sender) {
        port.postMessage(message);
      }
    } catch (error) {
      console.warn("⚠️ Failed to send port response:", error);
    }
  }

  normalizeUrl(url) {
    try {
      if (!url) return '';
      
      if (!url.startsWith('http')) {
        url = 'https://' + url;
      }
      
      url = url.replace(/\/apply$/, '');
      
      const urlObj = new URL(url);
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

    return true;
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

  // Get platform-specific domains
  getPlatformDomains(platform) {
    const domainMap = {
      lever: ['https://jobs.lever.co'],
      workable: ['https://apply.workable.com', 'https://jobs.workable.com'],
      recruitee: ['https://recruitee.com'],
      greenhouse: ['https://boards.greenhouse.io'],
      // Add more platforms as needed
    };
    
    return domainMap[platform] || [];
  }

  // Get platform-specific link patterns
  getPlatformLinkPattern(platform) {
    const patternMap = {
      lever: /^https:\/\/jobs\.lever\.co\/[^\/]+\/[^\/]+\/?.*$/,
      workable: /^https:\/\/apply\.workable\.com\/[^\/]+\/[^\/]+\/?.*$/,
      recruitee: /^https:\/\/.*\.recruitee\.com\/o\/[^\/]+\/?.*$/,
      greenhouse: /^https:\/\/boards\.greenhouse\.io\/[^\/]+\/jobs\/[^\/]+\/?.*$/,
      // Add more platforms as needed
    };
    
    return patternMap[platform] || null;
  }

  // Handle content script ready
  handleContentScriptReady(request, sender, sendResponse) {
    const { sessionId, platform, url } = request;
    console.log(`📱 Content script ready: ${platform} session ${sessionId}`);

    const automation = this.activeAutomations.get(sessionId);
    if (automation && sender.tab) {
      setTimeout(async () => {
        try {
          await chrome.tabs.sendMessage(sender.tab.id, {
            action: "startAutomation",
            sessionId: sessionId,
            config: automation.getConfig(),
          });
          console.log(`📤 Sent start message to content script for session ${sessionId}`);
        } catch (error) {
          console.error(`❌ Failed to send start message to content script:`, error);
        }
      }, 1000);
    }

    sendResponse({ success: true });
  }

  // Handle other methods (pause, stop, status, etc.)
  async handlePauseApplying(request, sendResponse) {
    const { sessionId } = request;

    if (this.activeAutomations.has(sessionId)) {
      const automation = this.activeAutomations.get(sessionId);
      await automation.pause();

      await this.sessionManager.updateSession(sessionId, {
        status: "paused",
        pausedAt: Date.now(),
      });

      sendResponse({ status: "paused", sessionId });
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

      sendResponse({ status: "stopped", sessionId });
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

      sendResponse({ status: "success", session, progress });
    } catch (error) {
      sendResponse({
        status: "error",
        message: "Failed to get automation status",
      });
    }
  }

  // Handle progress, error, and application reports
  handleProgressReport(request, sender, sendResponse) {
    const { sessionId, progress } = request;

    this.sessionManager.updateSession(sessionId, {
      progress,
      lastActivity: Date.now(),
    });

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

    this.sessionManager.updateSession(sessionId, {
      status: "error",
      error,
      errorContext: context,
      errorTime: Date.now(),
    });

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

    this.sessionManager.addApplication(sessionId, {
      jobData,
      applicationData,
      submittedAt: Date.now(),
      tabId: sender.tab?.id,
      url: sender.tab?.url,
    });

    this.notifyFrontend({
      type: "application_submitted",
      sessionId,
      jobData,
      applicationData,
    });

    sendResponse({ success: true });
  }

  // Validation method
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
      "lever",
      "workable",
      "greenhouse"
    ];
    
    if (!supportedPlatforms.includes(request.platform)) {
      return {
        valid: false,
        error: `Unsupported platform: ${request.platform}. Supported platforms: ${supportedPlatforms.join(", ")}`,
      };
    }

    return { valid: true };
  }

  // Handle window closed - stop associated automations
  async handleWindowClosed(windowId) {
    for (const [sessionId, automation] of this.activeAutomations.entries()) {
      if (automation.windowId === windowId) {
        console.log(`🪟 Window ${windowId} closed, stopping automation ${sessionId}`);
        await automation.stop();
        this.activeAutomations.delete(sessionId);

        await this.sessionManager.updateSession(sessionId, {
          status: "stopped",
          stoppedAt: Date.now(),
          reason: "Window closed",
        });

        this.notifyFrontend({
          type: "automation_stopped",
          sessionId,
          reason: "Window closed",
        });
      }
    }
  }

  // Notify frontend
  notifyFrontend(data) {
    console.log("📤 Notifying frontend:", data);
    // Implementation depends on your frontend communication method
  }
}

// Platform-specific automation handlers
// class LeverAutomationHandler {
//   constructor(messageHandler) {
//     this.messageHandler = messageHandler;
//     this.portConnections = new Map(); // tabId -> port
//   }

//   handlePortConnection(port) {
//     const portNameParts = port.name.split('-');
//     const portType = portNameParts[1]; // 'search' or 'apply'
//     const tabId = parseInt(portNameParts[2]) || port.sender?.tab?.id;
    
//     if (tabId) {
//       this.portConnections.set(tabId, port);
//       console.log(`📝 Registered Lever ${portType} port for tab ${tabId}`);
//     }
    
//     port.onMessage.addListener((message) => {
//       this.handlePortMessage(message, port);
//     });
    
//     port.onDisconnect.addListener(() => {
//       console.log("📪 Lever port disconnected:", port.name);
//       if (tabId) {
//         this.portConnections.delete(tabId);
//       }
//     });
//   }

//   async handlePortMessage(message, port) {
//     const { type, data } = message || {};
//     if (!type) return;

//     switch (type) {
//       case 'GET_SEARCH_TASK':
//         await this.handleGetSearchTask(port, data);
//         break;
        
//       case 'GET_SEND_CV_TASK':
//         await this.handleGetSendCvTask(port, data);
//         break;
        
//       case 'SEND_CV_TASK':
//         await this.handleSendCvTask(port, data);
//         break;
        
//       case 'SEND_CV_TASK_DONE':
//         await this.handleSendCvTaskDone(port, data);
//         break;
        
//       case 'SEND_CV_TASK_ERROR':
//         await this.handleSendCvTaskError(port, data);
//         break;
        
//       case 'SEND_CV_TASK_SKIP':
//         await this.handleSendCvTaskSkip(port, data);
//         break;
        
//       case 'SEARCH_TASK_DONE':
//         await this.handleSearchTaskDone(port, data);
//         break;
        
//       case 'VERIFY_APPLICATION_STATUS':
//         await this.handleVerifyApplicationStatus(port, data);
//         break;
        
//       case 'CHECK_JOB_TAB_STATUS':
//         await this.handleCheckJobTabStatus(port, data);
//         break;
        
//       case 'SEARCH_NEXT_READY':
//         await this.handleSearchNextReady(port, data);
//         break;
        
//       default:
//         console.log(`❓ Unhandled Lever port message type: ${type}`);
//         this.messageHandler.sendPortResponse(port, {
//           type: 'ERROR',
//           message: `Unknown message type: ${type}`
//         });
//     }
//   }

//   async handleGetSearchTask(port, data) {
//     const tabId = port.sender?.tab?.id;
//     const windowId = port.sender?.tab?.windowId;
    
//     let sessionData = null;
//     for (const [sessionId, automation] of this.messageHandler.activeAutomations.entries()) {
//       if (automation.windowId === windowId) {
//         const platformState = automation.platformState;
//         sessionData = {
//           tabId: tabId,
//           limit: platformState.searchData.limit,
//           current: platformState.searchData.current,
//           domain: platformState.searchData.domain,
//           submittedLinks: platformState.submittedLinks || [],
//           searchLinkPattern: platformState.searchData.searchLinkPattern.toString()
//         };
        
//         // Update search tab ID
//         platformState.searchTabId = tabId;
//         break;
//       }
//     }
    
//     this.messageHandler.sendPortResponse(port, {
//       type: 'SUCCESS',
//       data: sessionData || {}
//     });
//   }

//   async handleGetSendCvTask(port, data) {
//     const tabId = port.sender?.tab?.id;
//     const windowId = port.sender?.tab?.windowId;
    
//     let sessionData = null;
//     for (const [sessionId, automation] of this.messageHandler.activeAutomations.entries()) {
//       if (automation.windowId === windowId) {
//         sessionData = {
//           devMode: automation.params?.devMode || false,
//           profile: automation.userProfile,
//           session: automation.sessionConfig,
//           avatarUrl: automation.userProfile?.avatarUrl
//         };
//         break;
//       }
//     }
    
//     this.messageHandler.sendPortResponse(port, {
//       type: 'SUCCESS',
//       data: sessionData || {}
//     });
//   }

//   async handleSendCvTask(port, data) {
//     try {
//       const { url, title } = data;
//       const windowId = port.sender?.tab?.windowId;
      
//       console.log(`🎯 Opening Lever job in new tab: ${url}`);
      
//       let automation = null;
//       for (const [sessionId, auto] of this.messageHandler.activeAutomations.entries()) {
//         if (auto.windowId === windowId) {
//           automation = auto;
//           break;
//         }
//       }
      
//       if (!automation) {
//         throw new Error('No automation session found');
//       }
      
//       if (automation.platformState.isProcessingJob) {
//         this.messageHandler.sendPortResponse(port, {
//           type: 'ERROR',
//           message: 'Already processing another job'
//         });
//         return;
//       }
      
//       // Check for duplicates
//       const normalizedUrl = this.messageHandler.normalizeUrl(url);
//       if (automation.platformState.submittedLinks?.some(link => 
//         this.messageHandler.normalizeUrl(link.url) === normalizedUrl)) {
//         this.messageHandler.sendPortResponse(port, {
//           type: 'DUPLICATE',
//           message: 'This job has already been processed',
//           data: { url }
//         });
//         return;
//       }
      
//       // Create new tab for job application
//       const tab = await chrome.tabs.create({
//         url: url.endsWith('/apply') ? url : url + '/apply',
//         windowId: windowId,
//         active: true
//       });
      
//       // Update automation state
//       automation.platformState.isProcessingJob = true;
//       automation.platformState.currentJobUrl = url;
//       automation.platformState.currentJobTabId = tab.id;
//       automation.platformState.applicationStartTime = Date.now();
      
//       // Add to submitted links
//       if (!automation.platformState.submittedLinks) {
//         automation.platformState.submittedLinks = [];
//       }
//       automation.platformState.submittedLinks.push({
//         url: url,
//         status: 'PROCESSING',
//         timestamp: Date.now()
//       });
      
//       this.messageHandler.sendPortResponse(port, {
//         type: 'SUCCESS',
//         message: 'Apply tab will be created'
//       });
      
//       console.log(`✅ Lever job tab created: ${tab.id} for URL: ${url}`);
      
//     } catch (error) {
//       console.error("❌ Error handling Lever SEND_CV_TASK:", error);
//       this.messageHandler.sendPortResponse(port, {
//         type: 'ERROR',
//         message: error.message
//       });
//     }
//   }

//   async handleSendCvTaskDone(port, data) {
//     try {
//       const windowId = port.sender?.tab?.windowId;
//       const tabId = port.sender?.tab?.id;
      
//       console.log(`✅ Lever job application completed successfully in tab ${tabId}`);
      
//       let automation = null;
//       for (const [sessionId, auto] of this.messageHandler.activeAutomations.entries()) {
//         if (auto.windowId === windowId) {
//           automation = auto;
//           break;
//         }
//       }
      
//       if (automation) {
//         const url = automation.platformState.currentJobUrl;
//         if (url && automation.platformState.submittedLinks) {
//           const linkIndex = automation.platformState.submittedLinks.findIndex(link => 
//             this.messageHandler.normalizeUrl(link.url) === this.messageHandler.normalizeUrl(url));
//           if (linkIndex >= 0) {
//             automation.platformState.submittedLinks[linkIndex].status = 'SUCCESS';
//             automation.platformState.submittedLinks[linkIndex].details = data;
//           }
//         }
        
//         // Close the job tab
//         if (automation.platformState.currentJobTabId) {
//           try {
//             await chrome.tabs.remove(automation.platformState.currentJobTabId);
//           } catch (error) {
//             console.warn("⚠️ Error closing job tab:", error);
//           }
//         }
        
//         // Reset processing state
//         automation.platformState.isProcessingJob = false;
//         const oldUrl = automation.platformState.currentJobUrl;
//         automation.platformState.currentJobUrl = null;
//         automation.platformState.currentJobTabId = null;
//         automation.platformState.applicationStartTime = null;
        
//         // Increment current count
//         automation.platformState.searchData.current++;
        
//         // Notify search tab to continue
//         await this.sendSearchNextMessage(windowId, {
//           url: oldUrl,
//           status: 'SUCCESS',
//           data: data
//         });
//       }
      
//       this.messageHandler.sendPortResponse(port, {
//         type: 'SUCCESS',
//         message: 'Application completed'
//       });
      
//     } catch (error) {
//       console.error("❌ Error handling Lever SEND_CV_TASK_DONE:", error);
//       this.messageHandler.sendPortResponse(port, {
//         type: 'ERROR',
//         message: error.message
//       });
//     }
//   }

//   async handleSendCvTaskError(port, data) {
//     try {
//       const windowId = port.sender?.tab?.windowId;
//       const tabId = port.sender?.tab?.id;
      
//       console.log(`❌ Lever job application failed in tab ${tabId}:`, data);
      
//       let automation = null;
//       for (const [sessionId, auto] of this.messageHandler.activeAutomations.entries()) {
//         if (auto.windowId === windowId) {
//           automation = auto;
//           break;
//         }
//       }
      
//       if (automation) {
//         const url = automation.platformState.currentJobUrl;
//         if (url && automation.platformState.submittedLinks) {
//           const linkIndex = automation.platformState.submittedLinks.findIndex(link => 
//             this.messageHandler.normalizeUrl(link.url) === this.messageHandler.normalizeUrl(url));
//           if (linkIndex >= 0) {
//             automation.platformState.submittedLinks[linkIndex].status = 'ERROR';
//             automation.platformState.submittedLinks[linkIndex].error = data;
//           }
//         }
        
//         if (automation.platformState.currentJobTabId) {
//           try {
//             await chrome.tabs.remove(automation.platformState.currentJobTabId);
//           } catch (error) {
//             console.warn("⚠️ Error closing job tab:", error);
//           }
//         }
        
//         automation.platformState.isProcessingJob = false;
//         const oldUrl = automation.platformState.currentJobUrl;
//         automation.platformState.currentJobUrl = null;
//         automation.platformState.currentJobTabId = null;
//         automation.platformState.applicationStartTime = null;
        
//         await this.sendSearchNextMessage(windowId, {
//           url: oldUrl,
//           status: 'ERROR',
//           message: typeof data === 'string' ? data : 'Application error'
//         });
//       }
      
//       this.messageHandler.sendPortResponse(port, {
//         type: 'SUCCESS',
//         message: 'Error acknowledged'
//       });
      
//     } catch (error) {
//       console.error("❌ Error handling Lever SEND_CV_TASK_ERROR:", error);
//     }
//   }

//   async handleSendCvTaskSkip(port, data) {
//     try {
//       const windowId = port.sender?.tab?.windowId;
//       const tabId = port.sender?.tab?.id;
      
//       console.log(`⏭️ Lever job application skipped in tab ${tabId}:`, data);
      
//       let automation = null;
//       for (const [sessionId, auto] of this.messageHandler.activeAutomations.entries()) {
//         if (auto.windowId === windowId) {
//           automation = auto;
//           break;
//         }
//       }
      
//       if (automation) {
//         const url = automation.platformState.currentJobUrl;
//         if (url && automation.platformState.submittedLinks) {
//           const linkIndex = automation.platformState.submittedLinks.findIndex(link => 
//             this.messageHandler.normalizeUrl(link.url) === this.messageHandler.normalizeUrl(url));
//           if (linkIndex >= 0) {
//             automation.platformState.submittedLinks[linkIndex].status = 'SKIPPED';
//             automation.platformState.submittedLinks[linkIndex].reason = data;
//           }
//         }
        
//         if (automation.platformState.currentJobTabId) {
//           try {
//             await chrome.tabs.remove(automation.platformState.currentJobTabId);
//           } catch (error) {
//             console.warn("⚠️ Error closing job tab:", error);
//           }
//         }
        
//         automation.platformState.isProcessingJob = false;
//         const oldUrl = automation.platformState.currentJobUrl;
//         automation.platformState.currentJobUrl = null;
//         automation.platformState.currentJobTabId = null;
//         automation.platformState.applicationStartTime = null;
        
//         await this.sendSearchNextMessage(windowId, {
//           url: oldUrl,
//           status: 'SKIPPED',
//           message: data
//         });
//       }
      
//       this.messageHandler.sendPortResponse(port, {
//         type: 'SUCCESS',
//         message: 'Skip acknowledged'
//       });
      
//     } catch (error) {
//       console.error("❌ Error handling Lever SEND_CV_TASK_SKIP:", error);
//     }
//   }

//   async handleVerifyApplicationStatus(port, data) {
//     const windowId = port.sender?.tab?.windowId;
    
//     let automation = null;
//     for (const [sessionId, auto] of this.messageHandler.activeAutomations.entries()) {
//       if (auto.windowId === windowId) {
//         automation = auto;
//         break;
//       }
//     }
    
//     const isActive = automation ? automation.platformState.isProcessingJob : false;
    
//     this.messageHandler.sendPortResponse(port, {
//       type: 'APPLICATION_STATUS_RESPONSE',
//       data: {
//         active: isActive,
//         url: automation?.platformState.currentJobUrl || null,
//         tabId: automation?.platformState.currentJobTabId || null
//       }
//     });
//   }

//   async handleCheckJobTabStatus(port, data) {
//     const windowId = port.sender?.tab?.windowId;
    
//     let automation = null;
//     for (const [sessionId, auto] of this.messageHandler.activeAutomations.entries()) {
//       if (auto.windowId === windowId) {
//         automation = auto;
//         break;
//       }
//     }
    
//     const isOpen = automation ? automation.platformState.isProcessingJob : false;
    
//     this.messageHandler.sendPortResponse(port, {
//       type: 'JOB_TAB_STATUS',
//       data: {
//         isOpen: isOpen,
//         tabId: automation?.platformState.currentJobTabId || null,
//         isProcessing: isOpen
//       }
//     });
//   }

//   async handleSearchNextReady(port, data) {
//     console.log("🔄 Lever search ready for next job");
    
//     this.messageHandler.sendPortResponse(port, {
//       type: 'NEXT_READY_ACKNOWLEDGED',
//       data: { status: 'success' }
//     });
//   }

//   async handleSearchTaskDone(port, data) {
//     const windowId = port.sender?.tab?.windowId;
    
//     console.log(`🏁 Lever search task completed for window ${windowId}`);
    
//     try {
//       chrome.notifications.create({
//         type: 'basic',
//         iconUrl: 'icons/icon48.png',
//         title: 'Lever Job Search Completed',
//         message: 'All job applications have been processed.'
//       });
//     } catch (error) {
//       console.warn("⚠️ Error showing notification:", error);
//     }
    
//     this.messageHandler.sendPortResponse(port, {
//       type: 'SUCCESS',
//       message: 'Search completion acknowledged'
//     });
//   }

//   async sendSearchNextMessage(windowId, data) {
//     try {
//       console.log(`📤 Sending SEARCH_NEXT message to Lever window ${windowId}:`, data);
      
//       const tabs = await chrome.tabs.query({ windowId: windowId });
      
//       for (const tab of tabs) {
//         if (tab.url && tab.url.includes('google.com/search')) {
//           const port = this.portConnections.get(tab.id);
//           if (port) {
//             try {
//               port.postMessage({
//                 type: 'SEARCH_NEXT',
//                 data: data
//               });
//               console.log(`✅ Sent SEARCH_NEXT via port to Lever tab ${tab.id}`);
//               return true;
//             } catch (error) {
//               console.warn("⚠️ Port message failed, trying tabs API:", error);
//             }
//           }
          
//           try {
//             await chrome.tabs.sendMessage(tab.id, {
//               type: 'SEARCH_NEXT',
//               data: data
//             });
//             console.log(`✅ Sent SEARCH_NEXT via tabs API to Lever tab ${tab.id}`);
//             return true;
//           } catch (error) {
//             console.warn("⚠️ Tabs API message failed:", error);
//           }
//         }
//       }
      
//       console.warn("⚠️ Could not find Lever search tab to send SEARCH_NEXT message");
//       return false;
      
//     } catch (error) {
//       console.error("❌ Error sending Lever SEARCH_NEXT message:", error);
//       return false;
//     }
//   }
// }

// Placeholder handlers for other platforms - can be expanded similarly
class WorkableAutomationHandler {
  constructor(messageHandler) {
    this.messageHandler = messageHandler;
    this.portConnections = new Map();
  }

  handlePortConnection(port) {
    // Similar to Lever but for Workable-specific logic
    console.log("Workable port connection established");
    // TODO: Implement Workable-specific port handling
  }

  async handlePortMessage(message, port) {
    // TODO: Implement Workable-specific message handling
    console.log("Workable port message:", message);
  }
}

class RecruiteeAutomationHandler {
  constructor(messageHandler) {
    this.messageHandler = messageHandler;
    this.portConnections = new Map();
  }

  handlePortConnection(port) {
    // Similar to Lever but for Recruitee-specific logic
    console.log("Recruitee port connection established");
    // TODO: Implement Recruitee-specific port handling
  }

  async handlePortMessage(message, port) {
    // TODO: Implement Recruitee-specific message handling
    console.log("Recruitee port message:", message);
  }
}