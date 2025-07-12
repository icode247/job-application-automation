//detectPlatformFromUrl
// background/message-handler.js - UPDATED WITH WELLFOUND SUPPORT
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
import WellfoundAutomationHandler from "./platforms/wellfound.js";

//getPlatformLinkPattern

export default class MessageHandler {
  constructor() {
    this.orchestrator = new AutomationOrchestrator();
    this.sessionManager = new SessionManager();
    this.windowManager = new WindowManager();

    this.activeAutomations = new Map();
    this.portConnections = new Map();
    this.platformHandlers = new Map();
    this.tabSessions = new Map();
    this.windowSessions = new Map();
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
    const sessionId = this.windowSessions.get(tab.windowId);
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
          // FIXED: Include user profile and session config
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
      }
    }
  }

  async handleTabUpdated(tab) {
    const sessionData = this.tabSessions.get(tab.id);
    if (sessionData && tab.url) {
      try {
        // Inject comprehensive session context
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

            // FIXED: Store user profile and session config
            if (sessionData.userProfile) {
              window.automationUserProfile = sessionData.userProfile;
            }
            if (sessionData.sessionConfig) {
              window.automationSessionConfig = sessionData.sessionConfig;
            }
            if (sessionData.apiHost) {
              window.automationApiHost = sessionData.apiHost;
            }

            // Also store in sessionStorage
            sessionStorage.setItem(
              "automationSessionId",
              sessionData.sessionId
            );
            sessionStorage.setItem("automationPlatform", sessionData.platform);
            sessionStorage.setItem("automationUserId", sessionData.userId);
            sessionStorage.setItem("isAutomationWindow", "true");
            sessionStorage.setItem("isAutomationTab", "true");
            sessionStorage.setItem(
              "parentSessionId",
              sessionData.parentSessionId
            );

            // FIXED: Store additional context in sessionStorage
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

            console.log("🔧 Enhanced session context injected into tab:", {
              sessionId: sessionData.sessionId,
              platform: sessionData.platform,
              hasUserProfile: !!sessionData.userProfile,
              hasSessionConfig: !!sessionData.sessionConfig,
            });
          },
          args: [sessionData],
        });

        console.log(`✅ Enhanced session context injected into tab ${tab.id}`);
      } catch (error) {
        console.warn(
          `⚠️ Failed to inject session context into tab ${tab.id}:`,
          error
        );
      }
    }
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

      const platformHandler = this.initializePlatformHandler(platform);
      if (!platformHandler) {
        sendResponse({
          status: "error",
          message: `Platform handler for ${platform} is not available`,
        });
        return;
      }

      // FIXED: Fetch user profile data before starting automation
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

      // Start automation using orchestrator
      const result = await this.orchestrator.startAutomation({
        sessionId,
        platform,
        userId,
        userProfile, // FIXED: Pass user profile to orchestrator
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
        apiHost,
      });

      if (result.success) {
        const automationInstance = result.automationInstance;

        automationInstance.platform = platform;
        automationInstance.userId = userId;
        automationInstance.userProfile = userProfile; // FIXED: Ensure user profile is stored
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

        this.activeAutomations.set(sessionId, automationInstance);
        this.windowSessions.set(result.windowId, sessionId);

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

  handleContentScriptReady(request, sender, sendResponse) {
    const { sessionId, platform, url, userId } = request;
    console.log(
      `📱 Content script ready: ${platform} session ${sessionId} tab ${sender.tab?.id}`
    );

    // Store or update tab session if not already stored
    if (sender.tab && !this.tabSessions.has(sender.tab.id)) {
      // Try to find the automation session
      const automation = this.activeAutomations.get(sessionId);
      if (automation) {
        const sessionContext = {
          sessionId: sessionId,
          platform: platform,
          userId: userId,
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

    const automation = this.activeAutomations.get(sessionId);
    if (automation && sender.tab) {
      setTimeout(async () => {
        try {
          const sessionContext = {
            sessionId: sessionId,
            platform: platform,
            userId: userId,
            userProfile: automation.userProfile,
            sessionConfig: automation.sessionConfig,
            preferences: automation.sessionConfig?.preferences || {},
            apiHost: automation.sessionConfig?.apiHost,
          };

          await chrome.tabs.sendMessage(sender.tab.id, {
            action: "startAutomation",
            sessionId: sessionId,
            config: automation.getConfig(),
            sessionContext: sessionContext,
          });

          console.log(
            `📤 Sent start message with full context to content script for session ${sessionId}`
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

  getTabSessionContext(tabId) {
    const sessionData = this.tabSessions.get(tabId);
    if (!sessionData) return null;

    const automation = this.activeAutomations.get(sessionData.sessionId);
    if (!automation) return null;

    return {
      sessionId: sessionData.sessionId,
      platform: sessionData.platform,
      userId: sessionData.userId,
      userProfile: automation.userProfile, // FIXED: Ensure user profile is included
      sessionConfig: automation.sessionConfig,
      preferences: automation.sessionConfig?.preferences || {},
      apiHost: automation.sessionConfig?.apiHost,
    };
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
          console.log(
            `📤 Sent start message to content script for session ${sessionId}`
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

  // Handle window closed - stop associated automations
  async handleWindowClosed(windowId) {
    for (const [sessionId, automation] of this.activeAutomations.entries()) {
      if (automation.windowId === windowId) {
        console.log(
          `🪟 Window ${windowId} closed, stopping automation ${sessionId}`
        );
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



// core/automation-orchestrator.js - UPDATED WITH WELLFOUND SUPPORT
//buildIndeedUrl
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
      preferences = {},
      apiHost,
    } = params;

    try {
      this.logger.info(`🚀 Starting automation for platform: ${platform}`, {
        sessionId,
        userId,
        jobsToApply,
        preferences,
      });

      // Pass preferences as-is without modification
      this.logger.info(`📋 Using user preferences:`, preferences);

      // Create automation window with user preferences
      const automationWindow = await this.createAutomationWindow(
        platform,
        sessionId,
        userId,
        preferences
      );

      if (!automationWindow) {
        throw new Error("Failed to create automation window");
      }

      const fullParams = {
        ...params,
        preferences: preferences, // Pass through user preferences unchanged
        apiHost: apiHost || "http://localhost:3000",
      };

      // Create automation session
      const automationSession = new AutomationSession({
        sessionId,
        platform,
        userId,
        windowId: automationWindow.id,
        params: fullParams,
        orchestrator: this,
      });

      // Store active automation
      this.activeAutomations.set(sessionId, automationSession);

      this.logger.info(`✅ Automation started successfully`, {
        sessionId,
        platform,
        windowId: automationWindow.id,
        userId,
        preferences,
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

  async createAutomationWindow(platform, sessionId, userId, preferences) {
    try {
      // Get platform-specific starting URL with user preferences
      const startUrl = this.buildStartingUrl(platform, preferences);

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
        preferences,
        createdAt: Date.now(),
      });

      // Inject automation context with preferences
      setTimeout(async () => {
        try {
          if (window.tabs && window.tabs[0]) {
            await chrome.scripting.executeScript({
              target: { tabId: window.tabs[0].id },
              func: (sessionId, platform, userId, preferences) => {
                // Set window properties
                window.automationSessionId = sessionId;
                window.automationPlatform = platform;
                window.automationUserId = userId;
                window.automationPreferences = preferences;
                window.isAutomationWindow = true;

                // Set session storage
                sessionStorage.setItem("automationSessionId", sessionId);
                sessionStorage.setItem("automationPlatform", platform);
                sessionStorage.setItem("automationUserId", userId);
                sessionStorage.setItem(
                  "automationPreferences",
                  JSON.stringify(preferences)
                );
                sessionStorage.setItem("automationWindow", "true");

                console.log("🚀 Automation context injected with preferences", {
                  sessionId,
                  platform,
                  userId,
                  preferences,
                });
              },
              args: [sessionId, platform, userId, preferences],
            });
          }
        } catch (error) {
          console.error("Error injecting automation context:", error);
        }
      }, 500);

      return window;
    } catch (error) {
      throw new Error(`Failed to create automation window: ${error.message}`);
    }
  }

  buildWellfoundUrl(preferences) {
    const baseUrl = "https://wellfound.com/jobs?";
    const params = new URLSearchParams();

    // Handle job positions/roles
    if (preferences.positions?.length) {
      params.set("role", preferences.positions.join(","));
    }

    // Handle location
    if (preferences.location?.length) {
      const location = preferences.location[0];
      if (location === "Remote") {
        params.set("remote", "true");
      } else {
        params.set("location", location);
      }
    }

    // Handle remote work preference
    if (preferences.remoteOnly) {
      params.set("remote", "true");
    }

    // Handle experience level
    if (preferences.experience?.length) {
      const experienceMap = {
        Internship: "intern",
        "Entry level": "junior",
        "Mid level": "mid",
        "Senior level": "senior",
        Executive: "lead",
      };

      const wellfoundExperience = preferences.experience
        .map((exp) => experienceMap[exp])
        .filter(Boolean);

      if (wellfoundExperience.length) {
        params.set("experience", wellfoundExperience.join(","));
      }
    }

    // Handle job type
    if (preferences.jobType?.length) {
      const jobTypeMap = {
        "Full-time": "full-time",
        "Part-time": "part-time",
        Contract: "contract",
        Internship: "internship",
      };

      const wellfoundJobTypes = preferences.jobType
        .map((type) => jobTypeMap[type])
        .filter(Boolean);

      if (wellfoundJobTypes.length) {
        params.set("jobType", wellfoundJobTypes.join(","));
      }
    }

    // Handle company stage
    if (preferences.companyStage?.length) {
      const stageMap = {
        "Pre-Seed": "pre-seed",
        Seed: "seed",
        "Series A": "series-a",
        "Series B": "series-b",
        "Series C+": "series-c",
        Public: "public",
      };

      const wellfoundStages = preferences.companyStage
        .map((stage) => stageMap[stage])
        .filter(Boolean);

      if (wellfoundStages.length) {
        params.set("stage", wellfoundStages.join(","));
      }
    }

    // Handle salary range
    if (preferences.salary?.length === 2) {
      const [minSalary, maxSalary] = preferences.salary;
      if (minSalary > 0) {
        params.set("minSalary", minSalary.toString());
      }
      if (maxSalary > 0) {
        params.set("maxSalary", maxSalary.toString());
      }
    }

    return baseUrl + params.toString();
  }

  buildZipRecruiterUrl(preferences) {
    const params = new URLSearchParams();

    // Keywords from positions
    if (preferences.positions?.length) {
      params.set("search", preferences.positions.join(" OR "));
    }

    // Location
    if (preferences.location?.length && !preferences.remoteOnly) {
      params.set("location", preferences.location[0]);
    }

    // Remote work
    if (preferences.remoteOnly || preferences.workMode?.includes("Remote")) {
      params.set("refine_by_location_type", "only_remote");
    } else {
      params.set("refine_by_location_type", ""); // For in-person jobs
    }

    // Date posted
    const datePostedMap = {
      "Any time": "",
      "Past month": "30",
      "Past week": "7",
      "Past 24 hours": "1",
      "Few Minutes Ago": "1",
    };

    if (preferences.datePosted && datePostedMap[preferences.datePosted]) {
      params.set("days", datePostedMap[preferences.datePosted]);
    }

    // Job type
    const jobTypeMap = {
      "Full-time": "full_time",
      "Part-time": "part_time",
      Contract: "contract",
      Temporary: "temp",
      Internship: "internship",
    };

    if (preferences.jobType?.length) {
      const zipRecruiterJobType = preferences.jobType
        .map((type) => jobTypeMap[type])
        .filter(Boolean)[0]; // ZipRecruiter typically takes one job type

      if (zipRecruiterJobType) {
        params.set(
          "refine_by_employment",
          `employment_type:${zipRecruiterJobType}`
        );
      }
    }

    // Salary filters
    if (preferences.salary?.length === 2) {
      const [minSalary, maxSalary] = preferences.salary;
      if (minSalary > 0) {
        params.set("refine_by_salary", minSalary.toString());
      }
      if (maxSalary > 0) {
        params.set("refine_by_salary_ceil", maxSalary.toString());
      }
    }

    // Default search radius
    params.set("radius", "25");

    return `https://www.ziprecruiter.com/jobs-search?${params.toString()}`;
  }

  buildStartingUrl(platform, preferences) {
    switch (platform) {
      case "linkedin":
        return this.buildLinkedInUrl(preferences);
      case "indeed":
        return this.buildIndeedUrl(preferences);
      case "ziprecruiter":
        return this.buildZipRecruiterUrl(preferences);
      case "glassdoor":
        return this.buildGlassdoorUrl(preferences);
      case "workday":
        return this.buildWorkdayUrl(preferences);
      case "recruitee":
        return this.buildRecruiteeUrl(preferences);
      case "lever":
        return this.buildLeverUrl(preferences);
      case "breezy":
        return this.buildBreezyUrl(preferences);
      case "ashby":
        return this.buildAshbyUrl(preferences);
      case "wellfound":
        return this.buildWellfoundUrl(preferences);
      default:
        return this.buildGenericSearchUrl(preferences);
    }
  }

  buildAshbyUrl(preferences) {
    const keywords = preferences.positions?.length
      ? preferences.positions.join(" OR ")
      : "software engineer";
    const location =
      preferences.location?.length && !preferences.remoteOnly
        ? ` "${preferences.location[0]}"`
        : "";
    const remoteKeyword =
      preferences.remoteOnly || preferences.workMode?.includes("Remote")
        ? " remote"
        : "";

    return `https://www.google.com/search?q=site:ashbyhq.com+"${encodeURIComponent(
      keywords
    )}"${location}${remoteKeyword}`;
  }

  buildBreezyUrl(preferences) {
    const keywords = preferences.positions?.length
      ? preferences.positions.join(" OR ")
      : "software engineer";
    const location =
      preferences.location?.length && !preferences.remoteOnly
        ? ` "${preferences.location[0]}"`
        : "";
    const remoteKeyword =
      preferences.remoteOnly || preferences.workMode?.includes("Remote")
        ? " remote"
        : "";

    return `https://www.google.com/search?q=site:breezy.hr+"${encodeURIComponent(
      keywords
    )}"${location}${remoteKeyword}`;
  }

  buildLinkedInUrl(preferences) {
    const baseUrl = "https://www.linkedin.com/jobs/search/?";
    const joinWithOR = (arr) => (arr ? arr.join(" OR ") : "");
    const params = new URLSearchParams();

    params.append("f_AL", "true"); // Easy Apply filter

    // Handle positions
    if (preferences.positions?.length) {
      params.append("keywords", joinWithOR(preferences.positions));
    }

    // Handle location with GeoId mapping
    if (preferences.location?.length) {
      const location = preferences.location[0]; // Take first location

      const geoIdMap = {
        Nigeria: "105365761",
        Netherlands: "102890719",
        "United States": "103644278",
        "United Kingdom": "101165590",
        Canada: "101174742",
        Australia: "101452733",
        Germany: "101282230",
        France: "105015875",
        India: "102713980",
        Singapore: "102454443",
        "South Africa": "104035573",
        Ireland: "104738515",
        "New Zealand": "105490917",
      };

      if (location === "Remote" || preferences.remoteOnly) {
        params.append("f_WT", "2");
      } else if (geoIdMap[location]) {
        params.append("geoId", geoIdMap[location]);
      } else {
        params.append("location", location);
      }
    }

    // Handle work mode
    const workModeMap = {
      Remote: "2",
      Hybrid: "3",
      "On-site": "1",
    };

    if (preferences.workMode?.length) {
      const workModeCodes = preferences.workMode
        .map((mode) => workModeMap[mode])
        .filter(Boolean);
      if (workModeCodes.length) {
        params.append("f_WT", workModeCodes.join(","));
      }
    } else if (preferences.remoteOnly) {
      params.append("f_WT", "2");
    }

    // Handle date posted
    const datePostedMap = {
      "Any time": "",
      "Past month": "r2592000",
      "Past week": "r604800",
      "Past 24 hours": "r86400",
      "Few Minutes Ago": "r3600",
    };

    if (preferences.datePosted) {
      const dateCode = datePostedMap[preferences.datePosted];
      if (dateCode) {
        params.append("f_TPR", dateCode);
      }
    }

    // Handle experience level
    const experienceLevelMap = {
      Internship: "1",
      "Entry level": "2",
      Associate: "3",
      "Mid-Senior level": "4",
      Director: "5",
      Executive: "6",
    };

    if (preferences.experience?.length) {
      const experienceCodes = preferences.experience
        .map((level) => experienceLevelMap[level])
        .filter(Boolean);
      if (experienceCodes.length) {
        params.append("f_E", experienceCodes.join(","));
      }
    }

    // Handle job type
    const jobTypeMap = {
      "Full-time": "F",
      "Part-time": "P",
      Contract: "C",
      Temporary: "T",
      Internship: "I",
      Volunteer: "V",
    };

    if (preferences.jobType?.length) {
      const jobTypeCodes = preferences.jobType
        .map((type) => jobTypeMap[type])
        .filter(Boolean);
      if (jobTypeCodes.length) {
        params.append("f_JT", jobTypeCodes.join(","));
      }
    }

    // Handle salary range
    if (preferences.salary?.length === 2) {
      const [min] = preferences.salary;
      const salaryBuckets = {
        40000: "1",
        60000: "2",
        80000: "3",
        100000: "4",
        120000: "5",
        140000: "6",
        160000: "7",
        180000: "8",
        200000: "9",
      };

      const bucketValue = Object.entries(salaryBuckets)
        .reverse()
        .find(([threshold]) => min >= parseInt(threshold))?.[1];

      if (bucketValue) {
        params.append("f_SB", bucketValue);
      }
    }

    // Sorting
    params.append("sortBy", "R");

    return baseUrl + params.toString();
  }

  buildIndeedUrl(preferences) {
    const params = new URLSearchParams();

    // Keywords from positions
    if (preferences.positions?.length) {
      params.set("q", preferences.positions.join(" OR "));
    }

    // Location
    if (preferences.location?.length && !preferences.remoteOnly) {
      params.set("l", preferences.location[0]);
    }

    // Remote work
    if (preferences.remoteOnly || preferences.workMode?.includes("Remote")) {
      params.set("remotejob", "1");
    }

    // Date posted
    const datePostedMap = {
      "Any time": "",
      "Past month": "14",
      "Past week": "7",
      "Past 24 hours": "1",
      "Few Minutes Ago": "1",
    };

    if (preferences.datePosted && datePostedMap[preferences.datePosted]) {
      params.set("fromage", datePostedMap[preferences.datePosted]);
    }

    // Job type
    const jobTypeMap = {
      "Full-time": "fulltime",
      "Part-time": "parttime",
      Contract: "contract",
      Temporary: "temporary",
      Internship: "internship",
    };

    if (preferences.jobType?.length) {
      const indeedJobType = preferences.jobType
        .map((type) => jobTypeMap[type])
        .filter(Boolean)[0]; // Indeed typically takes one job type

      if (indeedJobType) {
        params.set("jt", indeedJobType);
      }
    }

    // Salary
    if (preferences.salary?.length === 2) {
      const [minSalary] = preferences.salary;
      if (minSalary > 0) {
        params.set("salary", minSalary.toString());
      }
    }

    params.set("sort", "date");

    return `https://www.indeed.com/jobs?${params.toString()}`;
  }

  buildGlassdoorUrl(preferences) {
    const params = new URLSearchParams();

    // Keywords
    if (preferences.positions?.length) {
      const keywords = preferences.positions.join(" ");
      params.set("sc.keyword", keywords);
      params.set("typedKeyword", keywords);
    }

    // Location
    if (preferences.location?.length && !preferences.remoteOnly) {
      params.set("locT", "C");
      params.set("locId", preferences.location[0]);
    }

    // Job type
    const jobTypeMap = {
      "Full-time": "full-time",
      "Part-time": "part-time",
      Contract: "contract",
      Internship: "internship",
    };

    if (preferences.jobType?.length) {
      const glassdoorJobType = preferences.jobType
        .map((type) => jobTypeMap[type])
        .filter(Boolean)[0];

      if (glassdoorJobType) {
        params.set("jobType", glassdoorJobType);
      }
    }

    // Default params
    params.set("suggestCount", "0");
    params.set("suggestChosen", "false");
    params.set("clickSource", "searchBtn");

    return `https://www.glassdoor.com/Job/jobs.htm?${params.toString()}`;
  }

  buildWorkdayUrl(preferences) {
    const keywords = preferences.positions?.length
      ? preferences.positions.join(" OR ")
      : "software engineer";
    const location =
      preferences.location?.length && !preferences.remoteOnly
        ? ` "${preferences.location[0]}"`
        : "";

    return `https://www.google.com/search?q=site:myworkdayjobs.com+"${encodeURIComponent(
      keywords
    )}"${location}`;
  }

  buildRecruiteeUrl(preferences) {
    const keywords = preferences.positions?.length
      ? preferences.positions.join(" OR ")
      : "software engineer";
    const location =
      preferences.location?.length && !preferences.remoteOnly
        ? ` "${preferences.location[0]}"`
        : "";

    return `https://www.google.com/search?q=site:recruitee.com+"${encodeURIComponent(
      keywords
    )}"${location}`;
  }

  buildLeverUrl(preferences) {
    const keywords = preferences.positions?.length
      ? preferences.positions.join(" OR ")
      : "software engineer";
    const location =
      preferences.location?.length && !preferences.remoteOnly
        ? ` "${preferences.location[0]}"`
        : "";

    return `https://www.google.com/search?q=site:jobs.lever.co+"${encodeURIComponent(
      keywords
    )}"${location}`;
  }

  buildGenericSearchUrl(preferences) {
    const keywords = preferences.positions?.length
      ? preferences.positions.join(" OR ") + " jobs"
      : "software engineer jobs";
    const location =
      preferences.location?.length && !preferences.remoteOnly
        ? ` ${preferences.location[0]}`
        : "";

    return `https://www.google.com/search?q=${encodeURIComponent(
      keywords + location
    )}`;
  }

  async stopAutomation(sessionId) {
    const automation = this.activeAutomations.get(sessionId);
    if (automation) {
      await automation.stop();
      this.activeAutomations.delete(sessionId);

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
    this.userId = userId;
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
      userId: this.userId,
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
      apiHost: this.params.apiHost || "http://localhost:3000",
    };
  }

  getApiHost() {
    return (
      this.params.apiHost ||
      this.orchestrator.config?.apiHost ||
      process.env.API_HOST ||
      "http://localhost:3000"
    );
  }

  async pause() {
    this.isPaused = true;
    this.status = "paused";
    await this.sendMessageToContentScript({ action: "pauseAutomation" });
  }

  async resume() {
    this.isPaused = false;
    this.status = "running";
    await this.sendMessageToContentScript({ action: "resumeAutomation" });
  }

  async stop() {
    this.status = "stopped";
    this.endTime = Date.now();
    await this.sendMessageToContentScript({ action: "stopAutomation" });
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
          userId: this.userId,
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
      userId: this.userId,
      preferences: this.params.preferences,
    };
  }

  getStatus() {
    return {
      sessionId: this.sessionId,
      platform: this.platform,
      userId: this.userId,
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
      preferences: this.params.preferences,
    };
  }
}



// content/content-main.js - UPDATED WITH WELLFOUND SUPPORT
//loadPlatformModule
class ContentScriptManager {
    constructor() {
      this.isInitialized = false;
      this.automationActive = false;
      this.sessionId = null;
      this.platform = null;
      this.userId = null;
      this.platformAutomation = null;
      this.domObserver = null;
      this.indicator = null;
      this.config = {};
      this.initializationTimeout = null;
      this.sessionContext = null;
      this.userProfile = null;
      this.maxInitializationAttempts = 3;
      this.initializationAttempts = 0;
    }
  
    async initialize() {
      if (this.isInitialized) return;
  
      try {
        this.initializationAttempts++;
        console.log(
          `📝 Content script initialization attempt ${this.initializationAttempts}`
        );
  
        const isAutomationWindow = await this.checkIfAutomationWindow();
        console.log(isAutomationWindow);
  
        if (isAutomationWindow) {
          this.automationActive = true;
  
          const sessionContext = await this.getSessionContext();
          console.log("Session context retrieved:", sessionContext);
          if (sessionContext) {
            this.sessionContext = sessionContext;
            this.sessionId = sessionContext.sessionId;
            this.platform = sessionContext.platform;
            this.userId = sessionContext.userId;
  
            if (sessionContext.userProfile) {
              this.userProfile = sessionContext.userProfile;
              console.log(`👤 User profile loaded from session context:`, {
                name: this.userProfile.name || this.userProfile.firstName,
                email: this.userProfile.email,
                hasResumeUrl: !!this.userProfile.resumeUrl,
              });
            }
  
            console.log(`🤖 Session context retrieved:`, {
              sessionId: this.sessionId,
              platform: this.platform,
              userId: this.userId,
              hasUserProfile: !!this.userProfile,
              url: window.location.href,
            });
  
            if (this.platform && this.platform !== "unknown") {
              await this.setupAutomation();
              this.isInitialized = true;
  
              console.log(`✅ Content script initialized for ${this.platform}`);
              this.notifyBackgroundReady();
              this.setAutoStartTimeout();
            }
          } else {
            throw new Error("Failed to retrieve session context");
          }
        }
      } catch (error) {
        console.error("❌ Error initializing content script:", error);
  
        if (this.initializationAttempts < this.maxInitializationAttempts) {
          console.log(`🔄 Retrying initialization in 3 seconds...`);
          setTimeout(() => this.initialize(), 3000);
        }
      }
    }
  
    async checkIfAutomationWindow() {
      // Method 1: Check window flags set by background script
      console.log(window.isAutomationWindow, window.automationSessionId);
      if (window.isAutomationWindow && window.automationSessionId) {
        console.log("🔍 Automation window detected via window flags");
        return true;
      }
  
      // Method 2: Check sessionStorage
      const sessionId = sessionStorage.getItem("automationSessionId");
      const platform = sessionStorage.getItem("automationPlatform");
      const userId = sessionStorage.getItem("automationUserId");
      console.log(sessionId, platform, userId);
      if (sessionId && platform) {
        console.log("🔍 Automation window detected via sessionStorage");
        window.automationSessionId = sessionId;
        window.automationPlatform = platform;
        window.automationUserId = userId;
        window.isAutomationWindow = true;
        return true;
      }
  
      // Method 3: Check if this is an automation tab via background script
      try {
        const response = await this.sendMessageToBackground({
          action: "checkIfAutomationWindow",
          tabId: await this.getTabId(),
        });
  
        console.log(response);
        if (response && response.isAutomationWindow) {
          console.log("🔍 Automation window detected via background script");
          window.isAutomationWindow = true;
          return true;
        }
      } catch (error) {
        console.error("Error checking automation window status:", error);
      }
  
      return false;
    }
  
    async getTabId() {
      return new Promise((resolve) => {
        try {
          chrome.runtime.sendMessage(
            { action: "getCurrentTabId" },
            (response) => {
              resolve(response?.tabId || null);
            }
          );
        } catch (error) {
          resolve(null);
        }
      });
    }
  
    async getSessionContext() {
      let context = this.getSessionContextFromStorage();
      if (context && context.sessionId) {
        console.log("📊 Session context found in storage");
        return await this.enrichSessionContext(context);
      }
  
      try {
        console.log("📡 Requesting session context from background script");
        const response = await this.sendMessageToBackground({
          action: "getSessionContext",
          tabId: await this.getTabId(),
          url: window.location.href,
        });
  
        if (response && response.sessionContext) {
          console.log("📊 Session context received from background");
          this.storeSessionContextInStorage(response.sessionContext);
          return response.sessionContext;
        }
      } catch (error) {
        console.error("Error getting session context from background:", error);
      }
  
      const detectedPlatform = this.detectPlatformFromUrl();
      if (detectedPlatform !== "unknown") {
        try {
          console.log(
            `🔍 Detected platform: ${detectedPlatform}, requesting session assignment`
          );
          const response = await this.sendMessageToBackground({
            action: "assignSessionToTab",
            platform: detectedPlatform,
            url: window.location.href,
            tabId: await this.getTabId(),
          });
  
          if (response && response.sessionContext) {
            console.log("📊 Session assigned by background script");
            this.storeSessionContextInStorage(response.sessionContext);
            return response.sessionContext;
          }
        } catch (error) {
          console.error("Error requesting session assignment:", error);
        }
      }
  
      return null;
    }
  
    getSessionContextFromStorage() {
      try {
        const baseContext = {
          sessionId:
            window.automationSessionId ||
            sessionStorage.getItem("automationSessionId"),
          platform:
            window.automationPlatform ||
            sessionStorage.getItem("automationPlatform"),
          userId:
            window.automationUserId || sessionStorage.getItem("automationUserId"),
          isAutomationTab:
            window.isAutomationTab ||
            sessionStorage.getItem("isAutomationTab") === "true",
          parentSessionId:
            window.parentSessionId || sessionStorage.getItem("parentSessionId"),
        };
  
        // FIXED: Retrieve user profile from storage
        let userProfile = null;
        try {
          if (window.automationUserProfile) {
            userProfile = window.automationUserProfile;
          } else {
            const storedProfile = sessionStorage.getItem("automationUserProfile");
            if (storedProfile) {
              userProfile = JSON.parse(storedProfile);
            }
          }
        } catch (error) {
          console.warn("Error parsing stored user profile:", error);
        }
  
        // FIXED: Retrieve session config
        let sessionConfig = null;
        try {
          if (window.automationSessionConfig) {
            sessionConfig = window.automationSessionConfig;
          } else {
            const storedConfig = sessionStorage.getItem(
              "automationSessionConfig"
            );
            if (storedConfig) {
              sessionConfig = JSON.parse(storedConfig);
            }
          }
        } catch (error) {
          console.warn("Error parsing stored session config:", error);
        }
  
        // FIXED: Get API host
        const apiHost =
          window.automationApiHost || sessionStorage.getItem("automationApiHost");
  
        return {
          ...baseContext,
          userProfile,
          sessionConfig,
          apiHost,
          preferences: sessionConfig?.preferences || {},
        };
      } catch (error) {
        console.error("Error getting session context from storage:", error);
        return null;
      }
    }
  
    storeSessionContextInStorage(context) {
      try {
        // Store basic context in window
        window.automationSessionId = context.sessionId;
        window.automationPlatform = context.platform;
        window.automationUserId = context.userId;
        window.isAutomationWindow = true;
        window.isAutomationTab = true;
  
        // FIXED: Store user profile and session config in window
        if (context.userProfile) {
          window.automationUserProfile = context.userProfile;
        }
        if (context.sessionConfig) {
          window.automationSessionConfig = context.sessionConfig;
        }
        if (context.apiHost) {
          window.automationApiHost = context.apiHost;
        }
  
        // Store in sessionStorage
        sessionStorage.setItem("automationSessionId", context.sessionId);
        sessionStorage.setItem("automationPlatform", context.platform);
        sessionStorage.setItem("automationUserId", context.userId);
        sessionStorage.setItem("isAutomationWindow", "true");
        sessionStorage.setItem("isAutomationTab", "true");
  
        // FIXED: Store additional context in sessionStorage
        if (context.userProfile) {
          sessionStorage.setItem(
            "automationUserProfile",
            JSON.stringify(context.userProfile)
          );
        }
        if (context.sessionConfig) {
          sessionStorage.setItem(
            "automationSessionConfig",
            JSON.stringify(context.sessionConfig)
          );
        }
        if (context.apiHost) {
          sessionStorage.setItem("automationApiHost", context.apiHost);
        }
        if (context.parentSessionId) {
          window.parentSessionId = context.parentSessionId;
          sessionStorage.setItem("parentSessionId", context.parentSessionId);
        }
  
        console.log("💾 Enhanced session context stored in storage");
      } catch (error) {
        console.error("Error storing session context:", error);
      }
    }
  
    async enrichSessionContext(basicContext) {
      // Get additional context data from background script
      try {
        const response = await this.sendMessageToBackground({
          action: "getFullSessionContext",
          sessionId: basicContext.sessionId,
        });
  
        if (response && response.sessionContext) {
          return { ...basicContext, ...response.sessionContext };
        }
      } catch (error) {
        console.error("Error enriching session context:", error);
      }
  
      return basicContext;
    }
  
    getSessionId() {
      return (
        this.sessionContext?.sessionId ||
        window.automationSessionId ||
        sessionStorage.getItem("automationSessionId") ||
        null
      );
    }
  
    getPlatform() {
      return (
        this.sessionContext?.platform ||
        window.automationPlatform ||
        sessionStorage.getItem("automationPlatform") ||
        this.detectPlatformFromUrl()
      );
    }
  
    getUserId() {
      return (
        this.sessionContext?.userId ||
        window.automationUserId ||
        sessionStorage.getItem("automationUserId") ||
        null
      );
    }
  
    detectPlatformFromUrl() {
      const url = window.location.href.toLowerCase();
  
      if (url.includes("linkedin.com")) return "linkedin";
      if (url.includes("indeed.com")) return "indeed";
      if (url.includes("ziprecruiter.com")) return "ziprecruiter";
      if (url.includes("recruitee.com")) return "recruitee";
      if (url.includes("glassdoor.com")) return "glassdoor";
      if (url.includes("myworkdayjobs.com")) return "workday";
      if (url.includes("lever.co")) return "lever";
      if (url.includes("greenhouse.io")) return "greenhouse";
      if (url.includes("workable.com")) return "workable";
      if (url.includes("ashbyhq.com")) return "ashby";
      if (url.includes("wellfound.com")) return "wellfound";
  
      // Handle Google search for specific platforms
      if (url.includes("google.com/search")) {
        if (url.includes("site:recruitee.com") || url.includes("recruitee.com"))
          return "recruitee";
        if (
          url.includes("site:ziprecruiter.com") ||
          url.includes("ziprecruiter.com")
        )
          return "ziprecruiter";
        if (
          url.includes("site:myworkdayjobs.com") ||
          url.includes("myworkdayjobs.com")
        )
          return "workday";
        if (url.includes("site:lever.co") || url.includes("lever.co"))
          return "lever";
        if (url.includes("site:workable.com") || url.includes("workable.com"))
          return "workable";
  
        if (url.includes("site:ashbyhq.com") || url.includes("ashbyhq.com"))
          return "ashby";
          
        if (url.includes("site:wellfound.com") || url.includes("wellfound.com"))
          return "wellfound";
      }
  
      return "unknown";
    }
  
    async setupAutomation() {
      try {
        const PlatformClass = await this.loadPlatformModule(this.platform);
        console.log("PlatformClass loaded:", PlatformClass?.name);
  
        if (!PlatformClass) {
          throw new Error(`Platform ${this.platform} not supported`);
        }
  
        // FIXED: Create platform automation with comprehensive config
        const automationConfig = {
          sessionId: this.sessionId,
          platform: this.platform,
          userId: this.userId,
          contentScript: this,
          config: this.config,
          sessionContext: this.sessionContext,
          userProfile: this.userProfile, // FIXED: Pass user profile directly
        };
  
        console.log("Creating platform automation with config:", {
          sessionId: automationConfig.sessionId,
          platform: automationConfig.platform,
          userId: automationConfig.userId,
          hasSessionContext: !!automationConfig.sessionContext,
          hasUserProfile: !!automationConfig.userProfile,
        });
  
        this.platformAutomation = new PlatformClass(automationConfig);
  
        // Set up automation UI
        this.addAutomationIndicator();
        this.setupMessageListeners();
        this.setupDOMObserver();
        this.setupNavigationListeners();
  
        // Initialize platform automation
        await this.platformAutomation.initialize();
  
        // FIXED: Set session context with user profile
        if (this.sessionContext) {
          // Ensure user profile is in session context
          if (this.userProfile && !this.sessionContext.userProfile) {
            this.sessionContext.userProfile = this.userProfile;
          }
          await this.platformAutomation.setSessionContext(this.sessionContext);
        }
  
        await this.platformAutomation.start(this.config);
      } catch (error) {
        console.error(
          `❌ Failed to setup automation for ${this.platform}:`,
          error
        );
        this.notifyBackgroundError(error);
      }
    }
  
    async updateSessionContext(newContext) {
      this.sessionContext = { ...this.sessionContext, ...newContext };
  
      // Update user profile if provided
      if (newContext.userProfile) {
        this.userProfile = newContext.userProfile;
        console.log("👤 User profile updated from session context");
      }
  
      this.storeSessionContextInStorage(this.sessionContext);
  
      if (this.platformAutomation && this.platformAutomation.setSessionContext) {
        await this.platformAutomation.setSessionContext(this.sessionContext);
      }
    }
  
    async loadPlatformModule(platform) {
      try {
        switch (platform) {
          case "linkedin":
            const { default: LinkedInPlatform } = await import(
              "../platforms/linkedin/linkedin.js"
            );
            return LinkedInPlatform;
  
          case "indeed":
            const { default: IndeedPlatform } = await import(
              "../platforms/indeed/indeed.js"
            );
            return IndeedPlatform;
  
          case "ziprecruiter":
            const { default: ZipRecruiterPlatform } = await import(
              "../platforms/ziprecruiter/ziprecruiter.js"
            );
            return ZipRecruiterPlatform;
  
          case "recruitee":
            const { default: RecruiteePlatform } = await import(
              "../platforms/recruitee/recruitee.js"
            );
            return RecruiteePlatform;
  
          case "glassdoor":
            const { default: GlassdoorPlatform } = await import(
              "../platforms/glassdoor/glassdoor.js"
            );
            return GlassdoorPlatform;
  
          case "workday":
            const { default: WorkdayPlatform } = await import(
              "../platforms/workday/workday.js"
            );
            return WorkdayPlatform;
  
          case "lever":
            const { default: LeverPlatform } = await import(
              "../platforms/lever/lever.js"
            );
            return LeverPlatform;
  
          case "breezy":
            const { default: BreezyPlatform } = await import(
              "../platforms/breezy/breezy.js"
            );
            return BreezyPlatform;
  
          case "ashby":
            const { default: AshbyPlatform } = await import(
              "../platforms/ashby/ashby.js"
            );
            return AshbyPlatform;
            
          case "wellfound":
            const { default: WellfoundPlatform } = await import(
              "../platforms/wellfound/wellfound.js"
            );
            return WellfoundPlatform;
            
          default:
            console.warn(`Platform ${platform} not supported`);
            return null;
        }
      } catch (error) {
        console.error(`Failed to load platform module for ${platform}:`, error);
        return null;
      }
    }
  
    setupMessageListeners() {
      // Listen for messages from background script
      chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        this.handleMessage(request, sender, sendResponse);
        return true; // Keep message channel open for async responses
      });
    }
  
    async handleMessage(request, sender, sendResponse) {
      try {
        switch (request.action) {
          case "startAutomation":
            await this.handleStartAutomation(request, sendResponse);
            break;
  
          case "pauseAutomation":
            await this.handlePauseAutomation(request, sendResponse);
            break;
  
          case "resumeAutomation":
            await this.handleResumeAutomation(request, sendResponse);
            break;
  
          case "stopAutomation":
            await this.handleStopAutomation(request, sendResponse);
            break;
  
          case "getPageData":
            this.handleGetPageData(sendResponse);
            break;
  
          case "executeAction":
            await this.handleExecuteAction(request, sendResponse);
            break;
  
          case "extractJobData":
            this.handleExtractJobData(sendResponse);
            break;
  
          default:
            sendResponse({ success: false, error: "Unknown action" });
        }
      } catch (error) {
        console.error("Error handling message:", error);
        sendResponse({ success: false, error: error.message });
      }
    }
  
    async handleStartAutomation(request, sendResponse) {
      try {
        if (this.platformAutomation) {
          if (this.initializationTimeout) {
            clearTimeout(this.initializationTimeout);
            this.initializationTimeout = null;
          }
  
          // Update config
          this.config = { ...this.config, ...request.config };
  
          // FIXED: Update session context and ensure user profile is available
          if (request.sessionContext) {
            this.sessionContext = {
              ...this.sessionContext,
              ...request.sessionContext,
            };
  
            // Extract user profile if not already set
            if (!this.userProfile && request.sessionContext.userProfile) {
              this.userProfile = request.sessionContext.userProfile;
              console.log(`👤 User profile loaded from start message:`, {
                name: this.userProfile.name || this.userProfile.firstName,
                email: this.userProfile.email,
              });
            }
  
            this.storeSessionContextInStorage(this.sessionContext);
            await this.platformAutomation.setSessionContext(this.sessionContext);
          }
  
          // FIXED: Validate user profile before starting
          if (!this.userProfile) {
            console.warn("⚠️ No user profile available, attempting to fetch...");
            try {
              // Try to get user profile from session context one more time
              const context = this.getSessionContextFromStorage();
              if (context && context.userProfile) {
                this.userProfile = context.userProfile;
                console.log("✅ User profile recovered from storage");
              }
            } catch (error) {
              console.error("Failed to recover user profile:", error);
            }
          }
  
          console.log(
            `🤖 Starting automation for ${this.platform} with config:`,
            {
              hasConfig: !!this.config,
              hasUserProfile: !!this.userProfile,
              jobsToApply: this.config.jobsToApply,
            }
          );
  
          await this.platformAutomation.start(this.config);
  
          sendResponse({
            success: true,
            message: "Automation started in content script",
          });
        } else {
          sendResponse({
            success: false,
            error: "Platform automation not initialized",
          });
        }
      } catch (error) {
        console.error(`❌ Error starting automation: ${error.message}`);
        sendResponse({ success: false, error: error.message });
      }
    }
  
    setAutoStartTimeout() {
      // Auto-start after 10 seconds if no start message received
      this.initializationTimeout = setTimeout(async () => {
        if (this.platformAutomation && !this.platformAutomation.isRunning) {
          this.log("🔄 Auto-starting automation with basic config");
          try {
            await this.platformAutomation.start({
              jobsToApply: 10, // Default value
              submittedLinks: [],
              preferences: {},
              userId: this.userId, // Include userId
            });
          } catch (error) {
            this.log(`❌ Auto-start failed: ${error.message}`);
          }
        }
      }, 10000);
    }
  
    addAutomationIndicator() {
      const existing = document.getElementById("automation-indicator");
      if (existing) existing.remove();
  
      const indicator = document.createElement("div");
      indicator.id = "automation-indicator";
  
      const profileStatus = this.userProfile ? "✓" : "✗";
      const profileText = this.userProfile
        ? this.userProfile.name || this.userProfile.firstName || "Unknown"
        : "No Profile";
  
      indicator.innerHTML = `
        <div style="
          position: fixed;
          top: 10px;
          right: 10px;
          background: linear-gradient(135deg, #4CAF50, #45a049);
          color: white;
          padding: 12px 16px;
          border-radius: 8px;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
          font-size: 13px;
          font-weight: 600;
          z-index: 999999;
          box-shadow: 0 4px 12px rgba(0,0,0,0.15);
          border: 1px solid rgba(255,255,255,0.2);
          backdrop-filter: blur(10px);
          cursor: pointer;
          transition: all 0.3s ease;
        " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 16px;">🤖</span>
            <div>
              <div style="font-weight: 700;">AUTOMATION ACTIVE</div>
              <div style="font-size: 11px; opacity: 0.9;">
                ${this.platform?.toUpperCase()} • ${this.sessionId?.slice(
        -6
      )}<br/>
                Profile: ${profileStatus} ${profileText}
              </div>
            </div>
          </div>
        </div>
      `;
  
      indicator.addEventListener("click", () => this.showAutomationStatus());
      document.documentElement.appendChild(indicator);
      this.indicator = indicator;
    }
  
    notifyBackgroundReady() {
      this.sendMessageToBackground({
        action: "contentScriptReady",
        sessionId: this.sessionId,
        platform: this.platform,
        userId: this.userId,
        url: window.location.href,
        sessionContext: this.sessionContext,
        hasUserProfile: !!this.userProfile,
      }).catch(console.error);
    }
  
    // Rest of the methods remain the same...
    async handlePauseAutomation(request, sendResponse) {
      if (this.platformAutomation && this.platformAutomation.pause) {
        await this.platformAutomation.pause();
        sendResponse({ success: true, message: "Automation paused" });
      } else {
        sendResponse({ success: false, error: "Cannot pause automation" });
      }
    }
  
    async handleResumeAutomation(request, sendResponse) {
      if (this.platformAutomation && this.platformAutomation.resume) {
        await this.platformAutomation.resume();
        sendResponse({ success: true, message: "Automation resumed" });
      } else {
        sendResponse({ success: false, error: "Cannot resume automation" });
      }
    }
  
    async handleStopAutomation(request, sendResponse) {
      if (this.platformAutomation && this.platformAutomation.stop) {
        await this.platformAutomation.stop();
        sendResponse({ success: true, message: "Automation stopped" });
      } else {
        sendResponse({ success: false, error: "Cannot stop automation" });
      }
    }
  
    handleGetPageData(sendResponse) {
      const pageData = {
        url: window.location.href,
        title: document.title,
        platform: this.platform,
        sessionId: this.sessionId,
        userId: this.userId,
        readyState: document.readyState,
        timestamp: Date.now(),
      };
  
      sendResponse({ success: true, data: pageData });
    }
  
    async handleExecuteAction(request, sendResponse) {
      const { actionType, selector, value, options = {} } = request;
  
      try {
        let result = false;
  
        switch (actionType) {
          case "click":
            result = await this.clickElement(selector, options);
            break;
  
          case "fill":
            result = await this.fillElement(selector, value, options);
            break;
  
          case "wait":
            result = await this.waitForElement(
              selector,
              options.timeout || 10000
            );
            break;
  
          case "scroll":
            result = await this.scrollToElement(selector, options);
            break;
  
          default:
            throw new Error(`Unknown action type: ${actionType}`);
        }
  
        sendResponse({ success: true, result });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    }
  
    handleExtractJobData(sendResponse) {
      try {
        const jobData = this.extractCurrentJobData();
        sendResponse({ success: true, data: jobData });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    }
  
    setupDOMObserver() {
      // Set up MutationObserver to detect significant DOM changes
      this.domObserver = new MutationObserver((mutations) => {
        this.handleDOMChanges(mutations);
      });
  
      this.domObserver.observe(document.body, {
        childList: true,
        subtree: true,
        attributes: false,
      });
    }
  
    handleDOMChanges(mutations) {
      let significantChange = false;
  
      for (const mutation of mutations) {
        if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
          // Check if new content suggests page change or important updates
          const addedElements = Array.from(mutation.addedNodes).filter(
            (node) => node.nodeType === 1
          );
  
          if (addedElements.some((el) => this.isSignificantElement(el))) {
            significantChange = true;
            break;
          }
        }
      }
  
      if (significantChange) {
        this.notifyDOMChange();
  
        // Notify platform automation of DOM changes
        if (this.platformAutomation && this.platformAutomation.onDOMChange) {
          this.platformAutomation.onDOMChange();
        }
      }
    }
  
    isSignificantElement(element) {
      const significantSelectors = [
        "form",
        ".job",
        ".application",
        ".modal",
        ".dialog",
        '[class*="job"]',
        '[class*="apply"]',
        '[class*="form"]',
      ];
  
      return significantSelectors.some((selector) => {
        try {
          return (
            element.matches &&
            (element.matches(selector) || element.querySelector(selector))
          );
        } catch (e) {
          return false;
        }
      });
    }
  
    setupNavigationListeners() {
      // Listen for URL changes (for SPAs)
      let currentUrl = window.location.href;
  
      const checkUrlChange = () => {
        if (window.location.href !== currentUrl) {
          const oldUrl = currentUrl;
          currentUrl = window.location.href;
  
          console.log(`🔄 Navigation detected: ${oldUrl} → ${currentUrl}`);
          this.notifyNavigation(oldUrl, currentUrl);
  
          // Notify platform automation of navigation
          if (this.platformAutomation && this.platformAutomation.onNavigation) {
            this.platformAutomation.onNavigation(oldUrl, currentUrl);
          }
        }
      };
  
      // Check for URL changes periodically
      setInterval(checkUrlChange, 1000);
  
      // Listen for popstate events
      window.addEventListener("popstate", checkUrlChange);
  
      // Override pushState and replaceState to catch programmatic navigation
      const originalPushState = history.pushState;
      const originalReplaceState = history.replaceState;
  
      history.pushState = function (...args) {
        originalPushState.apply(this, args);
        setTimeout(checkUrlChange, 100);
      };
  
      history.replaceState = function (...args) {
        originalReplaceState.apply(this, args);
        setTimeout(checkUrlChange, 100);
      };
    }
  
    // Utility methods for DOM manipulation
    async clickElement(selector, options = {}) {
      const element = document.querySelector(selector);
      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }
  
      // Scroll into view
      element.scrollIntoView({ behavior: "smooth", block: "center" });
  
      // Wait a bit for scroll
      await this.delay(options.delay || 500);
  
      // Click the element
      element.click();
  
      return true;
    }
  
    async fillElement(selector, value, options = {}) {
      const element = document.querySelector(selector);
      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }
  
      // Focus and fill
      element.focus();
      element.value = value;
  
      // Trigger events
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
  
      if (options.blur) {
        element.blur();
      }
  
      return true;
    }
  
    async scrollToElement(selector, options = {}) {
      const element = document.querySelector(selector);
      if (!element) {
        throw new Error(`Element not found: ${selector}`);
      }
  
      const scrollOptions = {
        behavior: "smooth",
        block: "center",
        inline: "nearest",
        ...options,
      };
  
      element.scrollIntoView(scrollOptions);
      return true;
    }
  
    async waitForElement(selector, timeout = 10000) {
      return new Promise((resolve) => {
        const element = document.querySelector(selector);
        if (element) {
          resolve(element);
          return;
        }
  
        const observer = new MutationObserver((mutations, obs) => {
          const element = document.querySelector(selector);
          if (element) {
            obs.disconnect();
            resolve(element);
          }
        });
  
        observer.observe(document, {
          childList: true,
          subtree: true,
        });
  
        setTimeout(() => {
          observer.disconnect();
          resolve(null);
        }, timeout);
      });
    }
  
    extractCurrentJobData() {
      // Extract job information from current page
      const jobData = {
        title: this.extractText([
          "h1",
          ".job-title",
          '[data-testid="job-title"]',
          ".jobsearch-JobInfoHeader-title",
        ]),
        company: this.extractText([
          ".company",
          ".company-name",
          '[data-testid="company-name"]',
          ".jobsearch-InlineCompanyRating",
        ]),
        location: this.extractText([
          ".location",
          ".job-location",
          '[data-testid="job-location"]',
          ".jobsearch-JobLocation",
        ]),
        description: this.extractText([
          ".job-description",
          ".description",
          '[data-testid="job-description"]',
        ]),
        url: window.location.href,
        platform: this.platform,
        userId: this.userId,
        extractedAt: Date.now(),
      };
  
      return jobData;
    }
  
    extractText(selectors) {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element) {
          return element.textContent?.trim() || "";
        }
      }
      return "";
    }
  
    // Communication methods
    async sendMessageToBackground(message) {
      return new Promise((resolve, reject) => {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      });
    }
  
    notifyBackgroundError(error) {
      this.sendMessageToBackground({
        action: "contentScriptError",
        sessionId: this.sessionId,
        platform: this.platform,
        userId: this.userId,
        error: error.message,
        url: window.location.href,
      }).catch(console.error);
    }
  
    notifyDOMChange() {
      this.sendMessageToBackground({
        action: "domChanged",
        sessionId: this.sessionId,
        url: window.location.href,
        timestamp: Date.now(),
      }).catch(console.error);
    }
  
    notifyNavigation(oldUrl, newUrl) {
      this.sendMessageToBackground({
        action: "navigationDetected",
        sessionId: this.sessionId,
        oldUrl,
        newUrl,
        timestamp: Date.now(),
      }).catch(console.error);
    }
  
    showAutomationStatus() {
      const modal = document.createElement("div");
      modal.style.cssText = `
        position: fixed; top: 0; left: 0; width: 100%; height: 100%;
        background: rgba(0,0,0,0.5); z-index: 1000000; display: flex;
        align-items: center; justify-content: center;
      `;
  
      modal.innerHTML = `
        <div style="background: white; padding: 24px; border-radius: 12px; max-width: 500px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);">
          <h3 style="margin: 0 0 16px 0; color: #333;">Automation Status</h3>
          <p><strong>Platform:</strong> ${this.platform}</p>
          <p><strong>Session ID:</strong> ${this.sessionId}</p>
          <p><strong>User ID:</strong> ${this.userId}</p>
          <p><strong>User Profile:</strong> ${
            this.userProfile ? "✅ Loaded" : "❌ Missing"
          }</p>
          ${
            this.userProfile
              ? `
            <p><strong>Profile Name:</strong> ${
              this.userProfile.name || this.userProfile.firstName || "N/A"
            }</p>
            <p><strong>Profile Email:</strong> ${
              this.userProfile.email || "N/A"
            }</p>
            <p><strong>Resume URL:</strong> ${
              this.userProfile.resumeUrl ? "✅ Available" : "❌ Missing"
            }</p>
          `
              : ""
          }
          <p><strong>Current URL:</strong> ${window.location.href}</p>
          <p><strong>Status:</strong> ${
            this.automationActive ? "Active" : "Inactive"
          }</p>
          <button onclick="this.closest('div').remove()" style="
            background: #4CAF50; color: white; border: none; padding: 8px 16px;
            border-radius: 4px; cursor: pointer; margin-top: 16px;
          ">Close</button>
        </div>
      `;
  
      modal.addEventListener("click", (e) => {
        if (e.target === modal) modal.remove();
      });
  
      document.body.appendChild(modal);
    }
  
    delay(ms) {
      return new Promise((resolve) => setTimeout(resolve, ms));
    }
  
    log(message, data = {}) {
      console.log(`🤖 [ContentScript-${this.platform}] ${message}`, data);
    }
  
    cleanup() {
      // Clear timeout
      if (this.initializationTimeout) {
        clearTimeout(this.initializationTimeout);
        this.initializationTimeout = null;
      }
  
      // Remove automation indicator
      if (this.indicator) {
        this.indicator.remove();
        this.indicator = null;
      }
  
      // Disconnect DOM observer
      if (this.domObserver) {
        this.domObserver.disconnect();
        this.domObserver = null;
      }
  
      // Stop platform automation
      if (this.platformAutomation && this.platformAutomation.cleanup) {
        this.platformAutomation.cleanup();
      }
  
      this.isInitialized = false;
      this.automationActive = false;
    }
  }
  
  // Initialize content script manager
  const contentManager = new ContentScriptManager();
  console.log("📝 Content script manager created");
  // Initialize when DOM is ready
  const initializeWhenReady = () => {
    console.log("📝 Initializing content script manager...");
    if (document.readyState === "complete") {
      contentManager.initialize();
      console.log("✅ Content script manager initialized");
    } else {
      setTimeout(initializeWhenReady, 100);
    }
  };
  
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => {
      setTimeout(() => contentManager.initialize(), 1000);
    });
  } else {
    setTimeout(() => contentManager.initialize(), 1000);
  }
  
  // Also initialize on page show (for back/forward navigation)
  window.addEventListener("pageshow", () => {
    setTimeout(() => contentManager.initialize(), 1000);
  });
  
  // Cleanup on page unload
  window.addEventListener("beforeunload", () => contentManager.cleanup());