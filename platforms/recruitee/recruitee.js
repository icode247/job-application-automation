// platforms/recruitee/recruitee.js

import BasePlatform from "../base-platform.js";
import { RecruiteeJobAutomation } from "./recruitee-automation.js";
import {
  AIService,
  ApplicationTrackerService,
  UserService,
  StatusOverlay,
} from "../../services/index.js";
import { markLinkAsColor } from "../../utils/mark-links.js";

export default class RecruiteePlatform extends BasePlatform {
  constructor(config) {
    super(config);
    this.platform = "recruitee";
    this.baseUrl = "https://jobs.recruitee.co";

    // Initialize user profile from multiple sources
    this.userProfile =
      config.userProfile || config.sessionContext?.userProfile || null;
    this.sessionContext = config.sessionContext || null;

    console.log(
      `🔧 Recruitee platform constructor - User profile available: ${!!this
        .userProfile}`
    );
    if (this.userProfile) {
      console.log(`👤 User profile details:`, {
        name: this.userProfile.name || this.userProfile.firstName,
        email: this.userProfile.email,
        hasResumeUrl: !!this.userProfile.resumeUrl,
        resumeUrls: this.userProfile.resumeUrls?.length || 0,
      });
    }

    this.aiService = new AIService({ apiHost: this.getApiHost() });
    this.applicationTracker = new ApplicationTrackerService({
      userId: this.userId,
    });
    this.userService = new UserService({ userId: this.userId });

    this.statusOverlay = new StatusOverlay({
      id: "recruitee-status-overlay",
      title: "RECRUITEE AUTOMATION",
      icon: "🤖",
      position: { top: "10px", right: "10px" },
    });

    this.fileHandler = null;
    this.formHandler = null;

    // Communication state
    this.port = null;
    this.connectionRetries = 0;
    this.maxRetries = 3;
    this.hasSessionContext = !!this.sessionContext;

    // Application state
    this.applicationState = {
      isApplicationInProgress: false,
      applicationStartTime: null,
      applicationUrl: null,
      processedUrls: new Set(),
      processedLinksCount: 0,
    };

    // Search data
    this.searchData = {
      limit: 0,
      current: 0,
      domain: ["recruitee.co"],
      submittedLinks: [],
      searchLinkPattern: null,
    };

    // Timers
    this.healthCheckTimer = null;
    this.keepAliveInterval = null;
    this.sendCvPageNotRespondTimeout = null;
    this.stuckStateTimer = null;
    this.stateVerificationInterval = null;

    this.markLinkAsColor = markLinkAsColor;
  }

  async setSessionContext(sessionContext) {
    try {
      this.sessionContext = sessionContext;
      this.hasSessionContext = true;

      // Update basic properties
      if (sessionContext.sessionId) this.sessionId = sessionContext.sessionId;
      if (sessionContext.platform) this.platform = sessionContext.platform;
      if (sessionContext.userId) this.userId = sessionContext.userId;

      // Set user profile with priority handling
      if (sessionContext.userProfile) {
        if (!this.userProfile || Object.keys(this.userProfile).length === 0) {
          this.userProfile = sessionContext.userProfile;
          console.log("👤 User profile loaded from session context");
        } else {
          // Merge profiles, preferring non-null values
          this.userProfile = {
            ...this.userProfile,
            ...sessionContext.userProfile,
          };
          console.log("👤 User profile merged with session context");
        }
      }

      // Fetch user profile if still missing
      if (!this.userProfile && this.userId) {
        try {
          console.log("📡 Fetching user profile from user service...");
          this.userProfile = await this.userService.getUserDetails();
          console.log("✅ User profile fetched successfully");
        } catch (error) {
          console.error("❌ Failed to fetch user profile:", error);
          this.statusOverlay?.addError(
            "Failed to fetch user profile: " + error.message
          );
        }
      }

      // Update services with user context
      if (this.userId) {
        this.applicationTracker = new ApplicationTrackerService({
          userId: this.userId,
        });
        this.userService = new UserService({ userId: this.userId });
      }

      // Store API host from session context
      if (sessionContext.apiHost) {
        this.sessionApiHost = sessionContext.apiHost;
      }

      // Pass session context to automation if it exists
      if (this.automation && this.automation.setSessionContext) {
        await this.automation.setSessionContext(sessionContext);
      }

      console.log("✅ Recruitee session context set successfully", {
        hasUserProfile: !!this.userProfile,
        userId: this.userId,
        sessionId: this.sessionId,
        profileName: this.userProfile?.name || this.userProfile?.firstName,
        profileEmail: this.userProfile?.email,
      });
    } catch (error) {
      console.error("❌ Error setting Recruitee session context:", error);
      this.statusOverlay?.addError(
        "❌ Error setting session context: " + error.message
      );
    }
  }

  initializePortConnection() {
    try {
      this.statusOverlay.addInfo(
        "📡 Initializing port connection with background script"
      );

      // Disconnect existing port if any
      if (this.port) {
        try {
          this.port.disconnect();
        } catch (e) {
          // Ignore errors when disconnecting
        }
      }

      // Determine port name based on page type and session
      const isApplyPage = window.location.href.match(
        /(recruitee\.com\/(o|career))/i
      );
      const sessionSuffix = this.sessionId
        ? `-${this.sessionId.slice(-6)}`
        : "";
      const timestamp = Date.now();
      const portName = isApplyPage
        ? `recruitee-apply-${timestamp}${sessionSuffix}`
        : `recruitee-search-${timestamp}${sessionSuffix}`;

      this.log(`🔌 Creating connection with port name: ${portName}`);

      // Create the connection
      this.port = chrome.runtime.connect({ name: portName });

      if (!this.port) {
        throw new Error(
          "Failed to establish connection with background script"
        );
      }

      // Set up message handler
      this.port.onMessage.addListener((message) => {
        this.handlePortMessage(message);
      });

      // Handle port disconnection
      this.port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        if (error) {
          this.log("❌ Port disconnected due to error:", error);
        } else {
          this.log("🔌 Port disconnected");
        }

        this.port = null;

        // Attempt to reconnect
        if (this.connectionRetries < this.maxRetries) {
          this.connectionRetries++;
          this.log(
            `🔄 Attempting to reconnect (${this.connectionRetries}/${this.maxRetries})...`
          );
          setTimeout(() => this.initializePortConnection(), 5000);
        }
      });

      // Start keep-alive interval
      this.startKeepAliveInterval();

      this.connectionRetries = 0;
      this.log("✅ Port connection established successfully");
      this.statusOverlay.addSuccess("Connection established");
    } catch (error) {
      this.log("❌ Error initializing port connection:", error);
      this.statusOverlay.addError("Connection failed: " + error.message);
      if (this.connectionRetries < this.maxRetries) {
        this.connectionRetries++;
        setTimeout(() => this.initializePortConnection(), 5000);
      }
    }
  }

  handlePortMessage(message) {
    try {
      this.log("📨 Received port message:", message);

      const { type, data } = message || {};
      if (!type) {
        this.log("⚠️ Received message without type, ignoring");
        return;
      }

      switch (type) {
        case "SEARCH_TASK_DATA":
          this.handleSearchTaskData(data);
          break;

        case "APPLICATION_TASK_DATA":
          this.handleApplicationTaskData(data);
          break;

        case "SEARCH_NEXT":
          this.handleSearchNext(data);
          break;

        case "APPLICATION_STATUS":
          this.handleApplicationStatus(data);
          break;

        case "KEEPALIVE_RESPONSE":
          // Just acknowledge keepalive
          break;

        default:
          this.log(`❓ Unhandled message type: ${type}`);
      }
    } catch (error) {
      this.log("❌ Error handling port message:", error);
    }
  }

  handleSearchTaskData(data) {
    try {
      this.log("📊 Processing search task data:", data);

      if (!data) {
        this.log("⚠️ No search task data provided");
        return;
      }

      this.searchData = {
        limit: data.limit || 10,
        current: data.current || 0,
        domain: data.domain || ["recruitee.com"],
        submittedLinks: data.submittedLinks || [],
        searchLinkPattern: data.searchLinkPattern
          ? new RegExp(data.searchLinkPattern.replace(/^\/|\/[gimy]*$/g, ""))
          : /^https:\/\/.*\.recruitee\.com\/(o|career)\/([^\/]+)\/?.*$/,
      };

      this.log("✅ Search data initialized:", this.searchData);
      this.statusOverlay.addSuccess("Search initialization complete");

      // Start search process
      setTimeout(() => this.startSearchProcess(), 1000);
    } catch (error) {
      this.log("❌ Error processing search task data:", error);
      this.statusOverlay.addError(
        "Error processing search task data: " + error.message
      );
    }
  }

  handleApplicationTaskData(data) {
    try {
      this.log("📊 Processing application task data:", data);

      if (!data) {
        this.log("⚠️ No application task data provided");
        return;
      }

      // Store application data
      this.applicationData = data;

      // Ensure user profile is available
      if (data.profile && !this.userProfile) {
        this.userProfile = data.profile;
        this.log("👤 User profile loaded from application task data");
      }

      this.statusOverlay.addSuccess("Application initialization complete");

      // Start application process
      setTimeout(() => this.startApplicationProcess(), 1000);
    } catch (error) {
      this.log("❌ Error processing application task data:", error);
      this.statusOverlay.addError(
        "Error processing application task data: " + error.message
      );
    }
  }

  startKeepAliveInterval() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }

    this.keepAliveInterval = setInterval(() => {
      try {
        if (this.port) {
          this.safeSendPortMessage({ type: "KEEPALIVE" });
        } else {
          this.log("🔄 Port is null during keepalive, attempting to reconnect");
          this.initializePortConnection();
        }
      } catch (error) {
        this.log("❌ Error sending keepalive, reconnecting:", error);
        this.initializePortConnection();
      }
    }, 25000);
  }

  safeSendPortMessage(message) {
    try {
      if (!this.port) {
        this.log("⚠️ Port not available, attempting to reconnect");
        this.initializePortConnection();
        return false;
      }

      this.port.postMessage(message);
      return true;
    } catch (error) {
      this.log("❌ Error sending port message:", error);
      this.initializePortConnection();
      return false;
    }
  }

  startHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(() => this.checkHealth(), 60000);
  }

  startStateVerification() {
    if (this.stateVerificationInterval) {
      clearInterval(this.stateVerificationInterval);
    }

    this.stateVerificationInterval = setInterval(() => {
      if (this.applicationState.isApplicationInProgress && this.port) {
        try {
          this.log("Verifying application status with background script");
          this.safeSendPortMessage({ type: "CHECK_APPLICATION_STATUS" });
        } catch (e) {
          this.log("Error in periodic state verification:", e);
        }
      }
    }, 30000);
  }

  checkHealth() {
    try {
      const now = Date.now();

      // Check for stuck application
      if (
        this.applicationState.isApplicationInProgress &&
        this.applicationState.applicationStartTime
      ) {
        const applicationTime =
          now - this.applicationState.applicationStartTime;

        if (applicationTime > 5 * 60 * 1000) {
          this.log("🚨 Application stuck for over 5 minutes, forcing reset");
          this.applicationState.isApplicationInProgress = false;
          this.applicationState.applicationStartTime = null;
          this.statusOverlay.addWarning(
            "Application timeout detected - resetting state"
          );
          setTimeout(() => this.searchNext(), 1000);
        }
      }
    } catch (error) {
      this.log("❌ Health check error", error);
    }
  }

  async initialize() {
    await super.initialize();

    // Create status overlay FIRST
    this.statusOverlay.create();

    this.initializePortConnection();

    // Set up health monitoring
    this.startHealthCheck();
    this.startStateVerification();
    this.statusOverlay.addSuccess("Recruitee automation initialized");
  }

  async start(params = {}) {
    try {
      this.isRunning = true;
      this.log("▶️ Starting Recruitee automation");

      // Update config with parameters
      this.config = { ...this.config, ...params };

      // FIXED: Send contentScriptReady message to background
      this.notifyBackgroundReady();

      // Wait for page to be ready
      await this.waitForPageLoad();

      // Detect page type and request appropriate task
      await this.detectPageTypeAndRequestTask();

      return true;
    } catch (error) {
      this.reportError(error, { action: "start" });
      return false;
    }
  }

  notifyBackgroundReady() {
    this.contentScript
      .sendMessageToBackground({
        action: "contentScriptReady",
        sessionId: this.sessionId,
        platform: this.platform,
        userId: this.userId,
        url: window.location.href,
        sessionContext: this.sessionContext,
        hasUserProfile: !!this.userProfile,
      })
      .catch(console.error);
  }

  // Rest of the methods remain the same...
  getApiHost() {
    return (
      this.sessionApiHost ||
      this.sessionContext?.apiHost ||
      this.config.apiHost ||
      "http://localhost:3000"
    );
  }

  async findJobs() {
    return [];
  }

  async applyToJob(jobElement) {
    return false;
  }

  onDOMChange() {
    if (this.automation && this.automation.onDOMChange) {
      this.automation.onDOMChange();
    }
  }

  onNavigation(oldUrl, newUrl) {
    if (this.automation && this.automation.onNavigation) {
      this.automation.onNavigation(oldUrl, newUrl);
    }
  }

  async pause() {
    await super.pause();
    if (this.automation && this.automation.pause) {
      await this.automation.pause();
    }
  }

  async resume() {
    await super.resume();
    if (this.automation && this.automation.resume) {
      await this.automation.resume();
    }
  }

  async stop() {
    await super.stop();
    if (this.automation && this.automation.stop) {
      await this.automation.stop();
    }
  }

  cleanup() {
    if (this.automation && this.automation.cleanup) {
      this.automation.cleanup();
    }
    super.cleanup();
  }

  async detectPageTypeAndRequestTask() {
    const url = window.location.href;
    this.log(`🔍 Detecting page type for: ${url}`);

    if (url.includes("google.com/search")) {
      this.log("📊 Google search page detected");
      this.statusOverlay.addInfo("Google search page detected");
      this.safeSendPortMessage({ type: "GET_SEARCH_TASK" });
    } else if (url.match(/(recruitee\.com\/(o|career))/i)) {
      this.log("📋 Recruitee job page detected");
      this.statusOverlay.addInfo("Recruitee job page detected");
      this.safeSendPortMessage({ type: "GET_APPLICATION_TASK" });
    } else {
      this.log("❓ Unknown page type, waiting for navigation");
      await this.waitForValidPage();
    }
  }

  async startSearchProcess() {
    try {
      this.statusOverlay.addInfo("Starting job search process");
      this.statusOverlay.updateStatus("searching");

      // Create RecruiteeJobAutomation for search
      this.automation = new RecruiteeJobAutomation();
      await this.automation.searchNext();
    } catch (error) {
      this.reportError(error, { phase: "search" });
    }
  }

  async startApplicationProcess() {
    try {
      this.statusOverlay.addInfo("Starting application process");
      this.statusOverlay.updateStatus("applying");

      // Create RecruiteeJobAutomation for application
      this.automation = new RecruiteeJobAutomation();
      await this.automation.startApplying();
    } catch (error) {
      this.reportError(error, { phase: "application" });
    }
  }

  async waitForPageLoad(timeout = 30000) {
    return new Promise((resolve) => {
      if (document.readyState === "complete") {
        resolve(true);
        return;
      }

      const checkComplete = () => {
        if (document.readyState === "complete") {
          resolve(true);
        } else {
          setTimeout(checkComplete, 100);
        }
      };

      checkComplete();

      setTimeout(() => resolve(false), timeout);
    });
  }

  async waitForValidPage(timeout = 30000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const url = window.location.href;

      if (
        url.includes("google.com/search") ||
        url.match(/(recruitee\.com\/(o|career))/i)
      ) {
        await this.detectPageTypeAndRequestTask();
        return;
      }

      await this.delay(1000);
    }

    throw new Error("Timeout waiting for valid page");
  }

  handleSearchNext(data) {
    this.log("🔄 Received search next notification", data);
    
    if (this.automation && this.automation.searchNext) {
      this.automation.searchNext();
    }
  }
  
  handleApplicationStatus(data) {
    this.log("📊 Application status:", data);
    
    if (this.automation && this.automation.handleApplicationStatus) {
      this.automation.handleApplicationStatus(data);
    }
  }
  
  cleanup() {
    // Clear timers
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
  
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }
  
    if (this.stateVerificationInterval) {
      clearInterval(this.stateVerificationInterval);
    }
  
    // Disconnect port
    if (this.port) {
      try {
        this.port.disconnect();
      } catch (e) {
        // Ignore errors
      }
      this.port = null;
    }
  
    // Cleanup automation
    if (this.automation && this.automation.cleanup) {
      this.automation.cleanup();
    }
  
    // Cleanup status overlay
    if (this.statusOverlay) {
      this.statusOverlay.destroy();
      this.statusOverlay = null;
    }
  
    // Reset state
    this.applicationState.isApplicationInProgress = false;
    this.applicationState.applicationStartTime = null;
    this.applicationState.applicationUrl = null;
  
    super.cleanup();
    this.log("🧹 Recruitee platform cleanup completed");
  }
}
