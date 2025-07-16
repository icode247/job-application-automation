// background/message-handler.js - FIXED VERSION
import AutomationOrchestrator from "../core/automation-orchestrator.js";
import SessionManager from "./session-manager.js";
import WindowManager from "./window-manager.js";
import LeverAutomationHandler from "./platforms/lever.js";
import RecruiteeAutomationHandler from "./platforms/recruitee.js";
import LinkedInAutomationHandler from "./platforms/linkedin.js";
import BreezyAutomationHandler from "./platforms/breezy.js";
import ZipRecruiterAutomationHandler from "./platforms/ziprecruiter.js";
import AshbyAutomationHandler from "./platforms/ashby.js";
import IndeedAutomationHandler from "./platforms/indeed.js";
import GlassdoorAutomationHandler from "./platforms/glassdoor.js";
import WorkableAutomationHandler from "./platforms/workable.js";
import WellfoundAutomationHandler from "./platforms/wellfound.js";
//handleExternalMessage
export default class MessageHandler {
  constructor() {
    this.orchestrator = new AutomationOrchestrator();
    this.sessionManager = new SessionManager();
    this.windowManager = new WindowManager();

    this.activeAutomations = new Map();
    this.portConnections = new Map();
    this.platformHandlers = new Map();
    this.tabSessions = new Map();
    // ✅ REMOVE: this.windowSessions - use orchestrator's instead
    this.pendingRequests = new Set();

    this.setupPortHandlers();
    this.setupTabListeners();
  }

  setupTabListeners() {
    chrome.tabs.onCreated.addListener((tab) => {
      this.handleTabCreated(tab);
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === "complete") {
        this.handleTabUpdated(tab);
      }
    });

    chrome.tabs.onRemoved.addListener((tabId) => {
      this.tabSessions.delete(tabId);
      this.portConnections.delete(tabId);
    });
  }

  handleTabCreated(tab) {
    // ✅ FIX: Use orchestrator's window session mapping
    const sessionId = this.orchestrator.getSessionForWindow(tab.windowId);

    if (sessionId) {
      console.log(
        `🆕 New tab ${tab.id} created in automation window ${tab.windowId}`
      );

      const automation = this.activeAutomations.get(sessionId);
      if (automation) {
        const sessionContext = {
          sessionId: sessionId,
          platform: automation.platform,
          userId: automation.userId,
          windowId: tab.windowId,
          isAutomationTab: true,
          createdAt: Date.now(),
          parentSessionId: sessionId,
          userProfile: automation.userProfile,
          sessionConfig: automation.sessionConfig,
          apiHost: automation.sessionConfig?.apiHost,
          preferences: automation.sessionConfig?.preferences || {},
        };

        this.tabSessions.set(tab.id, sessionContext);

        console.log(`✅ Session context stored for tab ${tab.id}:`, {
          sessionId,
          platform: automation.platform,
          hasUserProfile: !!sessionContext.userProfile,
          hasSessionConfig: !!sessionContext.sessionConfig,
        });

        // ✅ FIX: Notify orchestrator to inject context
        this.orchestrator.handleTabCreated(tab.id, tab.windowId);
      }
    }
  }

  async handleTabUpdated(tab) {
    // ✅ FIX: Enhanced context injection with better timing
    const sessionData = this.tabSessions.get(tab.id);
    const isAutomationWindow = this.orchestrator.isAutomationWindow(
      tab.windowId
    );

    if ((sessionData || isAutomationWindow) && tab.url) {
      try {
        // If we don't have session data but it's an automation window, try to get it
        let contextToInject = sessionData;

        if (!contextToInject && isAutomationWindow) {
          const sessionId = this.orchestrator.getSessionForWindow(tab.windowId);
          const automation = this.activeAutomations.get(sessionId);

          if (automation) {
            contextToInject = {
              sessionId: sessionId,
              platform: automation.platform,
              userId: automation.userId,
              windowId: tab.windowId,
              isAutomationTab: true,
              userProfile: automation.userProfile,
              sessionConfig: automation.sessionConfig,
              apiHost: automation.sessionConfig?.apiHost,
              preferences: automation.sessionConfig?.preferences || {},
            };

            // Store for future reference
            this.tabSessions.set(tab.id, contextToInject);
          }
        }

        if (contextToInject) {
          // Wait a bit longer for page to stabilize
          setTimeout(async () => {
            try {
              await this.injectEnhancedSessionContext(tab.id, contextToInject);
              console.log(
                `✅ Enhanced session context injected into tab ${tab.id}`
              );
            } catch (error) {
              console.warn(
                `⚠️ Failed to inject session context into tab ${tab.id}:`,
                error
              );

              // ✅ FIX: Retry injection once more
              setTimeout(async () => {
                try {
                  await this.injectEnhancedSessionContext(
                    tab.id,
                    contextToInject
                  );
                  console.log(
                    `✅ Session context injected on retry for tab ${tab.id}`
                  );
                } catch (retryError) {
                  console.error(
                    `❌ Final injection attempt failed for tab ${tab.id}:`,
                    retryError
                  );
                }
              }, 2000);
            }
          }, 1500);
        }
      } catch (error) {
        console.error(`❌ Error in handleTabUpdated for tab ${tab.id}:`, error);
      }
    }
  }

  // ✅ NEW: Enhanced session context injection
  async injectEnhancedSessionContext(tabId, sessionData) {
    await chrome.scripting.executeScript({
      target: { tabId: tabId },
      func: (sessionData) => {
        // Store session data in multiple places for reliability
        window.automationSessionId = sessionData.sessionId;
        window.automationPlatform = sessionData.platform;
        window.automationUserId = sessionData.userId;
        window.isAutomationWindow = true;
        window.isAutomationTab = true;
        window.parentSessionId = sessionData.parentSessionId;

        // Store user profile and session config
        if (sessionData.userProfile) {
          window.automationUserProfile = sessionData.userProfile;
        }
        if (sessionData.sessionConfig) {
          window.automationSessionConfig = sessionData.sessionConfig;
        }
        if (sessionData.apiHost) {
          window.automationApiHost = sessionData.apiHost;
        }

        // Also store in sessionStorage with error handling
        try {
          sessionStorage.setItem("automationSessionId", sessionData.sessionId);
          sessionStorage.setItem("automationPlatform", sessionData.platform);
          sessionStorage.setItem("automationUserId", sessionData.userId);
          sessionStorage.setItem("isAutomationWindow", "true");
          sessionStorage.setItem("isAutomationTab", "true");
          sessionStorage.setItem(
            "parentSessionId",
            sessionData.parentSessionId
          );

          if (sessionData.userProfile) {
            sessionStorage.setItem(
              "automationUserProfile",
              JSON.stringify(sessionData.userProfile)
            );
          }
          if (sessionData.sessionConfig) {
            sessionStorage.setItem(
              "automationSessionConfig",
              JSON.stringify(sessionData.sessionConfig)
            );
          }
          if (sessionData.apiHost) {
            sessionStorage.setItem("automationApiHost", sessionData.apiHost);
          }
        } catch (storageError) {
          console.warn("Failed to store in sessionStorage:", storageError);
        }

        console.log("🔧 Enhanced session context injected into tab:", {
          sessionId: sessionData.sessionId,
          platform: sessionData.platform,
          hasUserProfile: !!sessionData.userProfile,
          hasSessionConfig: !!sessionData.sessionConfig,
          url: window.location.href,
        });

        // Signal successful injection
        window.automationContextInjected = true;
        window.automationContextTimestamp = Date.now();
      },
      args: [sessionData],
    });
  }

  async handleStartApplying(request, sendResponse) {
    try {
      console.log("📨 Start applying request received:", request);

      const validation = this.validateStartApplyingRequest(request);
      if (!validation.valid) {
        sendResponse({ status: "error", message: validation.error });
        return;
      }

      const {
        platform,
        userId,
        jobsToApply,
        submittedLinks = [],
        userPlan,
        userCredits,
        dailyRemaining,
        preferences = {},
        apiHost = "http://localhost:3000",
      } = request;

      // ✅ FIX: Fetch user profile before starting automation
      let userProfile = null;
      try {
        console.log(`📡 Fetching user profile for user ${userId}`);
        const response = await fetch(`${apiHost}/api/user/${userId}`);
        if (response.ok) {
          userProfile = await response.json();
          console.log(`✅ User profile fetched successfully:`, {
            hasProfile: !!userProfile,
            name: userProfile?.name || userProfile?.firstName,
            email: userProfile?.email,
          });
        } else {
          console.warn(`⚠️ Failed to fetch user profile: ${response.status}`);
        }
      } catch (error) {
        console.error(`❌ Error fetching user profile:`, error);
      }

      // Create automation session
      const sessionId = await this.sessionManager.createSession({
        userId,
        platform,
        jobsToApply,
        submittedLinks,
        userPlan,
        userCredits,
        dailyRemaining,
        userProfile,
        startTime: Date.now(),
        status: "starting",
      });

      // ✅ FIX: Use orchestrator to start automation
      const result = await this.orchestrator.startAutomation({
        sessionId,
        platform,
        userId,
        jobsToApply,
        preferences,
        apiHost,
        userProfile, // Pass user profile to orchestrator
      });

      if (result.success) {
        const automationInstance = result.automationInstance;

        // ✅ FIX: Ensure all required properties are set
        automationInstance.platform = platform;
        automationInstance.userId = userId;
        automationInstance.userProfile = userProfile;
        automationInstance.sessionConfig = {
          sessionId,
          platform,
          userId,
          userProfile,
          apiHost,
          preferences,
        };

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
            searchLinkPattern: this.getPlatformLinkPattern(platform),
          },
        };

        // ✅ FIX: Store in message handler's tracking
        this.activeAutomations.set(sessionId, automationInstance);

        console.log(
          `🪟 Window ${result.windowId} mapped to session ${sessionId}`
        );
        console.log(
          `👤 User profile stored in automation:`,
          !!automationInstance.userProfile
        );

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

  // Handle internal messages from content scripts
  handleInternalMessage(request, sender, sendResponse) {
    switch (request.action) {
      case "checkIfAutomationWindow":
        return this.handleCheckIfAutomationWindow(sender, sendResponse);

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

  // ✅ FIX: Enhanced automation window check
  async handleCheckIfAutomationWindow(sender, sendResponse) {
    try {
      let isAutomationWindow = false;

      // Check multiple sources
      if (sender.tab) {
        // Method 1: Check window manager
        const windowManagerCheck = this.windowManager.isAutomationWindow(
          sender.tab.windowId
        );

        // Method 2: Check orchestrator
        const orchestratorCheck = this.orchestrator.isAutomationWindow(
          sender.tab.windowId
        );

        // Method 3: Check if we have session data for this tab
        const hasTabSession = this.tabSessions.has(sender.tab.id);

        isAutomationWindow =
          windowManagerCheck || orchestratorCheck || hasTabSession;

        console.log(
          `🔍 Automation window check for window ${sender.tab.windowId}, tab ${sender.tab.id}:`,
          {
            windowManagerCheck,
            orchestratorCheck,
            hasTabSession,
            isAutomationWindow,
          }
        );

        // If it's an automation window but we don't have tab session, create one
        if (isAutomationWindow && !hasTabSession) {
          const sessionId = this.orchestrator.getSessionForWindow(
            sender.tab.windowId
          );
          if (sessionId) {
            const automation = this.activeAutomations.get(sessionId);
            if (automation) {
              const sessionContext = {
                sessionId,
                platform: automation.platform,
                userId: automation.userId,
                windowId: sender.tab.windowId,
                isAutomationTab: true,
                userProfile: automation.userProfile,
                sessionConfig: automation.sessionConfig,
                apiHost: automation.sessionConfig?.apiHost,
                preferences: automation.sessionConfig?.preferences || {},
              };

              this.tabSessions.set(sender.tab.id, sessionContext);
              console.log(
                `✅ Created missing tab session for tab ${sender.tab.id}`
              );
            }
          }
        }
      }

      sendResponse({ isAutomationWindow });
      return true;
    } catch (error) {
      console.error("Error checking automation window:", error);
      sendResponse({ isAutomationWindow: false, error: error.message });
      return true;
    }
  }

  handleContentScriptReady(request, sender, sendResponse) {
    const { sessionId, platform, url, userId } = request;
    console.log(
      `📱 Content script ready: ${platform} session ${sessionId} tab ${sender.tab?.id}`
    );

    // Store or update tab session if not already stored
    if (sender.tab && !this.tabSessions.has(sender.tab.id)) {
      // Try to find the automation session
      const automation =
        this.activeAutomations.get(sessionId) ||
        this.findAutomationByWindow(sender.tab.windowId);

      if (automation) {
        const sessionContext = {
          sessionId: sessionId || automation.sessionId,
          platform: platform || automation.platform,
          userId: userId || automation.userId,
          windowId: sender.tab.windowId,
          isAutomationTab: true,
          createdAt: Date.now(),
          userProfile: automation.userProfile,
          sessionConfig: automation.sessionConfig,
          apiHost: automation.sessionConfig?.apiHost,
          preferences: automation.sessionConfig?.preferences || {},
        };

        this.tabSessions.set(sender.tab.id, sessionContext);
        console.log(`📊 Session context stored for ready tab ${sender.tab.id}`);
      }
    }

    const automation =
      this.activeAutomations.get(sessionId) ||
      this.findAutomationByWindow(sender.tab?.windowId);

    if (automation && sender.tab) {
      setTimeout(async () => {
        try {
          const sessionContext = {
            sessionId: sessionId || automation.sessionId,
            platform: platform || automation.platform,
            userId: userId || automation.userId,
            userProfile: automation.userProfile,
            sessionConfig: automation.sessionConfig,
            preferences: automation.sessionConfig?.preferences || {},
            apiHost: automation.sessionConfig?.apiHost,
          };

          await chrome.tabs.sendMessage(sender.tab.id, {
            action: "startAutomation",
            sessionId: sessionContext.sessionId,
            config: automation.getConfig ? automation.getConfig() : {},
            sessionContext: sessionContext,
          });

          console.log(
            `📤 Sent start message with full context to content script for session ${sessionContext.sessionId}`
          );
        } catch (error) {
          console.error(
            `❌ Failed to send start message to content script:`,
            error
          );
        }
      }, 1000);
    }

    sendResponse({ success: true });
  }

  // ✅ NEW: Find automation by window ID
  findAutomationByWindow(windowId) {
    if (!windowId) return null;

    const sessionId = this.orchestrator.getSessionForWindow(windowId);
    if (sessionId) {
      return this.activeAutomations.get(sessionId);
    }

    return null;
  }

  // ✅ FIX: Enhanced tab session context
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
      sessionConfig: automation.sessionConfig,
      preferences: automation.sessionConfig?.preferences || {},
      apiHost: automation.sessionConfig?.apiHost,
    };
  }

  // ✅ FIX: Enhanced window closed handler
  async handleWindowClosed(windowId) {
    console.log(`🪟 Window ${windowId} closed, cleaning up...`);

    // Use orchestrator's tracking
    const sessionId = this.orchestrator.getSessionForWindow(windowId);

    if (sessionId) {
      const automation = this.activeAutomations.get(sessionId);
      if (automation) {
        console.log(
          `🛑 Stopping automation ${sessionId} for closed window ${windowId}`
        );

        const platform = automation.platform;
        const userId = automation.userId;
        const requestKey = `startApplying_${userId}_${platform}`;

        if (this.pendingRequests.has(requestKey)) {
          this.pendingRequests.delete(requestKey);
          console.log(`🧹 Cleaned up pending request: ${requestKey}`);
        }

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

    // Clean up tab sessions for this window
    const tabsToRemove = [];
    for (const [tabId, sessionData] of this.tabSessions.entries()) {
      if (sessionData.windowId === windowId) {
        tabsToRemove.push(tabId);
      }
    }

    for (const tabId of tabsToRemove) {
      this.tabSessions.delete(tabId);
    }

    // Notify orchestrator
    await this.orchestrator.handleWindowClosed(windowId);

    console.log(`✅ Cleanup completed for window ${windowId}`);
  }

  initializePlatformHandler(platform) {
    if (this.platformHandlers.has(platform)) {
      return this.platformHandlers.get(platform);
    }

    console.log(`🔧 Initializing platform handler for: ${platform}`);

    let handler = null;

    switch (platform) {
      case "lever":
        handler = new LeverAutomationHandler(this);
        break;
      case "workable":
        handler = new WorkableAutomationHandler(this);
        break;
      case "recruitee":
        handler = new RecruiteeAutomationHandler(this);
        break;
      case "linkedin":
        handler = new LinkedInAutomationHandler(this);
        break;
      case "breezy":
        handler = new BreezyAutomationHandler(this);
        break;
      case "ziprecruiter":
        handler = new ZipRecruiterAutomationHandler(this);
        break;
      case "ashby":
        handler = new AshbyAutomationHandler(this);
        break;
      case "indeed":
        handler = new IndeedAutomationHandler(this);
        break;
      case "glassdoor":
        handler = new GlassdoorAutomationHandler(this);
        break;
      case "wellfound":
        handler = new WellfoundAutomationHandler(this);
        break;
      default:
        console.error(`❌ Unsupported platform: ${platform}`);
        return null;
    }

    if (handler) {
      this.platformHandlers.set(platform, handler);
      console.log(`✅ Platform handler initialized for: ${platform}`);
    }

    return handler;
  }

  getPlatformDomains(platform) {
    if (this.platformHandlers.has(platform)) {
      return this.platformHandlers.get(platform);
    }

    console.log(`🔧 Initializing platform handler for: ${platform}`);

    let handler = null;

    switch (platform) {
      case "lever":
        handler = new LeverAutomationHandler(this);
        break;
      case "workable":
        handler = new WorkableAutomationHandler(this);
        break;
      case "recruitee":
        handler = new RecruiteeAutomationHandler(this);
        break;
      case "linkedin":
        handler = new LinkedInAutomationHandler(this);
        break;
      case "breezy":
        handler = new BreezyAutomationHandler(this);
        break;
      case "ziprecruiter":
        handler = new ZipRecruiterAutomationHandler(this);
        break;
      case "ashby":
        handler = new AshbyAutomationHandler(this);
        break;
      case "indeed":
        handler = new IndeedAutomationHandler(this);
        break;
      case "glassdoor":
        handler = new GlassdoorAutomationHandler(this);
        break;
      case "wellfound":
        handler = new WellfoundAutomationHandler(this);
        break;
      default:
        console.error(`❌ Unsupported platform: ${platform}`);
        return null;
    }

    if (handler) {
      this.platformHandlers.set(platform, handler);
      console.log(`✅ Platform handler initialized for: ${platform}`);
    }

    return handler;
  }

  getPlatformHandler(platform) {
    return (
      this.platformHandlers.get(platform) ||
      this.initializePlatformHandler(platform)
    );
  }

  setupPortHandlers() {
    chrome.runtime.onConnect.addListener((port) => {
      console.log("📨 New port connection established:", port.name);

      const portParts = port.name.split("-");
      if (portParts.length >= 3) {
        const platform = portParts[0];
        const handler = this.getPlatformHandler(platform);

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

      const handler = this.getPlatformHandler(platform);
      if (handler) {
        await handler.handlePortMessage(message, port);
      } else {
        console.error(`No handler for platform: ${platform}`);
        this.sendPortResponse(port, {
          type: "ERROR",
          message: `Unsupported platform: ${platform}`,
        });
      }
    } catch (error) {
      console.error(`❌ Error handling ${platform} port message:`, error);
      this.sendPortResponse(port, {
        type: "ERROR",
        message: error.message,
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
      if (!url) return "";

      if (!url.startsWith("http")) {
        url = "https://" + url;
      }

      url = url.replace(/\/apply$/, "");

      const urlObj = new URL(url);
      return (urlObj.origin + urlObj.pathname)
        .toLowerCase()
        .trim()
        .replace(/\/+$/, "");
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

      case "pauseAutomation":
        this.handlePauseApplying(request, sendResponse);
        break;

      case "resumeAutomation":
        this.handleResumeApplying(request, sendResponse);
        break;

      case "stopAutomation":
        this.handleStopApplying(request, sendResponse);
        break;

      default:
        sendResponse({
          status: "error",
          message: `Unknown action: ${request.action}`,
        });
    }

    return true;
  }

  async handleResumeApplying(request, sendResponse) {
    const { sessionId } = request;

    if (this.activeAutomations.has(sessionId)) {
      const automation = this.activeAutomations.get(sessionId);
      automation.isPaused = false;

      // Send resume message to all tabs in the automation window
      try {
        const tabs = await chrome.tabs.query({ windowId: automation.windowId });
        for (const tab of tabs) {
          chrome.tabs.sendMessage(tab.id, {
            action: "resumeAutomation",
            sessionId: sessionId,
          });
        }
      } catch (error) {
        console.error("Error sending resume message:", error);
      }

      await this.sessionManager.updateSession(sessionId, {
        status: "running",
        resumedAt: Date.now(),
      });

      sendResponse({ status: "resumed", sessionId });
    } else {
      sendResponse({
        status: "error",
        message: "No active automation found for session",
      });
    }
  }
  async handlePauseApplying(request, sendResponse) {
    const { sessionId } = request;

    if (this.activeAutomations.has(sessionId)) {
      const automation = this.activeAutomations.get(sessionId);
      automation.isPaused = true;

      // Send pause message to all tabs in the automation window
      try {
        const tabs = await chrome.tabs.query({ windowId: automation.windowId });
        for (const tab of tabs) {
          chrome.tabs.sendMessage(tab.id, {
            action: "pauseAutomation",
            sessionId: sessionId,
          });
        }
      } catch (error) {
        console.error("Error sending pause message:", error);
      }

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

  // Get platform-specific domains
  getPlatformDomains(platform) {
    const domainMap = {
      lever: ["https://jobs.lever.co"],
      workable: ["https://apply.workable.com", "https://jobs.workable.com"],
      recruitee: ["https://recruitee.com"],
      greenhouse: ["https://boards.greenhouse.io"],
      breezy: ["breezy.hr", "app.breezy.hr"],
      ziprecruiter: ["https://www.ziprecruiter.com"],
      ashby: ["ashbyhq.com", "jobs.ashbyhq.com"],
      indeed: ["https://www.indeed.com", "https://smartapply.indeed.com"],
      glassdoor: ["https://www.glassdoor.com"],
      wellfound: ["https://wellfound.com"],
    };

    return domainMap[platform] || [];
  }

  // Get platform-specific link patterns
  getPlatformLinkPattern(platform) {
    const patternMap = {
      ziprecruiter:
        /^https:\/\/(www\.)?ziprecruiter\.com\/(job|jobs|jz|apply).*$/,
      lever: /^https:\/\/jobs\.lever\.co\/[^\/]+\/[^\/]+\/?.*$/,
      workable: /^https:\/\/apply\.workable\.com\/[^\/]+\/[^\/]+\/?.*$/,
      recruitee: /^https:\/\/.*\.recruitee\.com\/o\/[^\/]+\/?.*$/,
      greenhouse:
        /^https:\/\/boards\.greenhouse\.io\/[^\/]+\/jobs\/[^\/]+\/?.*$/,
      breezy:
        /^https:\/\/([\w-]+\.breezy\.hr\/p\/|app\.breezy\.hr\/jobs\/)([^\/]+)\/?.*$/,
      ashby:
        /^https:\/\/(jobs\.ashbyhq\.com\/[^\/]+\/[^\/]+|[^\/]+\.ashbyhq\.com\/[^\/]+)\/?.*$/,
      indeed: /^https:\/\/(www\.)?indeed\.com\/(viewjob|job|jobs|apply).*$/,
      glassdoor:
        /^https:\/\/(www\.)?glassdoor\.com\/(job|Job|partner|apply).*$/,
      wellfound: /^https:\/\/wellfound\.com\/jobs\/\d+/,
    };

    return patternMap[platform] || null;
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
      "ziprecruiter",
      "recruitee",
      "glassdoor",
      "workday",
      "lever",
      "workable",
      "greenhouse",
      "breezy",
      "ashby",
      "wellfound",
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

  // Notify frontend
  notifyFrontend(data) {
    console.log("📤 Notifying frontend:", data);
    // Implementation depends on your frontend communication method
  }
}
