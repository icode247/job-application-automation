import BasePlatform from "../base-platform.js";
import LeverFormHandler from "./lever-form-handler.js";
import LeverFileHandler from "./lever-file-handler.js";
import {
  AIService,
  ApplicationTrackerService,
  UserService,
  StatusOverlay,
} from "../../services/index.js";
import { markLinkAsColor } from "../../utils/mark-links.js";
//apply()
export default class LeverPlatform extends BasePlatform {
  constructor(config) {
    super(config);
    this.platform = "lever";
    this.baseUrl = "https://jobs.lever.co";

    // Initialize user profile from multiple sources
    this.userProfile =
      config.userProfile || config.sessionContext?.userProfile || null;
    this.sessionContext = config.sessionContext || null;

    console.log(
      `🔧 Lever platform constructor - User profile available: ${!!this
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
      id: "lever-status-overlay",
      title: "LEVER AUTOMATION",
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
      domain: ["lever.co"],
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

  validateHandlers() {
    const issues = [];

    if (!this.statusOverlay) issues.push("Status overlay not initialized");
    if (!this.fileHandler) issues.push("File handler not initialized");
    if (!this.formHandler) issues.push("Form handler not initialized");
    if (!this.userProfile) issues.push("User profile not available");

    if (issues.length > 0) {
      console.error("❌ Handler validation failed:", issues);
      this.statusOverlay?.addError(
        "Initialization issues: " + issues.join(", ")
      );
      return false;
    }

    console.log("✅ All handlers validated successfully");
    return true;
  }

  async setSessionContext(sessionContext) {
    try {
      console.log("🔧 Setting session context:", {
        hasSessionContext: !!sessionContext,
        hasUserProfile: !!sessionContext?.userProfile,
        sessionId: sessionContext?.sessionId,
      });

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
          console.log("👤 User profile set from session context");
        } else {
          // Merge profiles, preferring non-null values
          this.userProfile = {
            ...this.userProfile,
            ...sessionContext.userProfile,
          };
          console.log("👤 User profile merged from session context");
        }
      }

      // Fetch user profile if still missing
      if (!this.userProfile && this.userId) {
        console.log("📡 User profile missing, attempting to fetch...");
        try {
          this.userProfile = await this.userService.getUserDetails();
          console.log("✅ User profile fetched successfully");
        } catch (error) {
          console.error("❌ Failed to fetch user profile:", error);
        }
      }

      // Update services with user context
      if (this.userId) {
        this.applicationTracker = new ApplicationTrackerService({
          userId: this.userId,
        });
        this.userService = new UserService({ userId: this.userId });
      }

      // FIXED: Update form handler if it exists
      if (this.formHandler && this.userProfile) {
        this.formHandler.userData = this.userProfile;
        console.log("📝 Form handler updated with user profile");
      }

      // Store API host from session context
      if (sessionContext.apiHost) {
        this.sessionApiHost = sessionContext.apiHost;

        // FIXED: Update file handler API host if it exists
        if (this.fileHandler) {
          this.fileHandler.apiHost = sessionContext.apiHost;
          console.log("📎 File handler API host updated");
        }
      }

      console.log("✅ Session context applied successfully", {
        hasUserProfile: !!this.userProfile,
        profileName: this.userProfile?.name || this.userProfile?.firstName,
        hasResumeUrl: !!(
          this.userProfile?.resumeUrl || this.userProfile?.resumeUrls?.length
        ),
      });
    } catch (error) {
      console.error("❌ Error setting session context:", error);
    }
  }

  getApiHost() {
    return (
      this.sessionApiHost ||
      this.sessionContext?.apiHost ||
      this.config.apiHost ||
      "http://localhost:3000"
    );
  }

  async initialize() {
    await super.initialize();
    console.log("🎯 Lever platform initialized");

    // Create status overlay FIRST
    this.statusOverlay.create();
    console.log("✅ Status overlay created");

    // Initialize file handler with the created status overlay
    this.fileHandler = new LeverFileHandler({
      statusService: this.statusOverlay,
      apiHost: this.getApiHost(),
    });
    console.log("📎 File handler initialized with status service");

    // Set up communication with background script
    this.initializePortConnection();

    // Set up health monitoring
    this.startHealthCheck();
    this.startStateVerification();

    // FIXED: Initialize form handler with user profile validation
    this.formHandler = new LeverFormHandler({
      logger: (message) => this.statusOverlay.addInfo(message),
      host: this.getApiHost(),
      userData: this.userProfile || {},
      jobDescription: "",
    });

    console.log("🔧 All handlers initialized", {
      hasFileHandler: !!this.fileHandler,
      hasFormHandler: !!this.formHandler,
      hasStatusOverlay: !!this.statusOverlay,
      hasUserData: !!this.userProfile,
    });

    this.statusOverlay.addSuccess("Lever automation initialized");
  }

  initializePortConnection() {
    try {
      this.log("📡 Initializing port connection with background script");

      // Disconnect existing port if any
      if (this.port) {
        try {
          this.port.disconnect();
        } catch (e) {
          // Ignore errors when disconnecting
        }
      }

      // Determine port name based on page type and session
      const isApplyPage =
        window.location.href.includes("/apply") ||
        window.location.pathname.includes("/apply");

      const sessionSuffix = this.sessionId
        ? `-${this.sessionId.slice(-6)}`
        : "";
      const timestamp = Date.now();
      const portName = isApplyPage
        ? `lever-apply-${timestamp}${sessionSuffix}`
        : `lever-search-${timestamp}${sessionSuffix}`;

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

  isFormValid(form) {
    try {
      const inputs = form.querySelectorAll("input, select, textarea");
      const visibleInputs = Array.from(inputs).filter(
        (input) => input.type !== "hidden" && this.isElementVisible(input)
      );

      return visibleInputs.length >= 2;
    } catch (e) {
      return false;
    }
  }

  isElementVisible(element) {
    if (!element) return false;

    try {
      const style = window.getComputedStyle(element);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        element.offsetWidth > 0 &&
        element.offsetHeight > 0 &&
        element.offsetParent !== null
      );
    } catch (error) {
      return false;
    }
  }

  isFormVisible(form) {
    try {
      if (!form || !form.offsetParent) return false;

      const style = window.getComputedStyle(form);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        form.offsetWidth > 0 &&
        form.offsetHeight > 0
      );
    } catch (e) {
      return false;
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
          this.safeSendPortMessage({ type: "VERIFY_APPLICATION_STATUS" });
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

  handlePortMessage(message) {
    try {
      this.log("📨 Received port message:", message);

      const { type, data } = message || {};
      if (!type) {
        this.log("⚠️ Received message without type, ignoring");
        return;
      }

      switch (type) {
        case "APPLICATION_STATUS_RESPONSE":
          this.handleApplicationStatusResponse(data);
          break;

        case "SUCCESS":
          this.handleSuccessMessage(data);
          break;

        case "SEARCH_NEXT":
          this.handleSearchNext(data);
          break;

        case "JOB_TAB_STATUS":
          this.handleJobTabStatus(data);
          break;

        case "DUPLICATE":
          this.handleDuplicateJob(data);
          break;

        case "ERROR":
          this.handleErrorMessage(data);
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

  handleApplicationStatusResponse(data) {
    this.log("📊 Application status response:", data);

    if (
      data &&
      data.active === false &&
      this.applicationState.isApplicationInProgress
    ) {
      this.log(
        "⚠️ State mismatch detected! Resetting application progress flag"
      );
      this.applicationState.isApplicationInProgress = false;
      this.applicationState.applicationStartTime = null;
      this.statusOverlay.addWarning(
        "Detected state mismatch - resetting flags"
      );

      setTimeout(() => this.searchNext(), 1000);
    }
  }

  handleSuccessMessage(data) {
    if (data) {
      if (data.submittedLinks !== undefined) {
        this.processSearchTaskData(data);
      } else if (data.profile !== undefined) {
        // Only process if we don't have user profile
        if (!this.userProfile) {
          this.processSendCvTaskData(data);
        } else {
          this.log(
            "✅ User profile already available, skipping CV task data processing"
          );
        }
      }
    }
  }

  handleSearchNext(data) {
    this.log("🔄 Received search next notification", data);

    // Clear timeout first
    if (this.sendCvPageNotRespondTimeout) {
      clearTimeout(this.sendCvPageNotRespondTimeout);
      this.sendCvPageNotRespondTimeout = null;
    }

    // Reset application state
    this.applicationState.isApplicationInProgress = false;
    this.applicationState.applicationStartTime = null;
    this.applicationState.processedLinksCount++;

    // Notify background we're ready for next job
    this.safeSendPortMessage({ type: "SEARCH_NEXT_READY" });

    if (!data || !data.url) {
      this.log("No URL data in handleSearchNext");
      this.statusOverlay.addInfo("Job processed, searching next...");
      setTimeout(() => this.searchNext(), 2500);
      return;
    }

    const normalizedUrl = this.normalizeUrlFully(data.url);

    // Update visual status of the processed link
    const links = this.findAllLinksElements();
    let linkFound = false;

    for (let i = 0; i < links.length; i++) {
      const linkUrl = this.normalizeUrlFully(links[i].href);

      if (
        linkUrl === normalizedUrl ||
        linkUrl.includes(normalizedUrl) ||
        normalizedUrl.includes(linkUrl)
      ) {
        if (data.status === "SUCCESS") {
          this.markLinkAsColor(links[i], "orange");
          this.statusOverlay.addSuccess("Successfully submitted: " + data.url);
        } else if (data.status === "ERROR") {
          this.markLinkAsColor(links[i], "red");
          this.statusOverlay.addError(
            "Error with: " +
              data.url +
              (data.message ? ` - ${data.message}` : "")
          );
        } else {
          this.markLinkAsColor(links[i], "orange");
          this.statusOverlay.addWarning(
            "Skipped: " + data.url + (data.message ? ` - ${data.message}` : "")
          );
        }

        linkFound = true;
        break;
      }
    }

    if (!linkFound) {
      this.log("Link not found in current page:", normalizedUrl);
    }

    // Record submission if not already in the list
    if (
      !this.searchData.submittedLinks.some((link) => {
        const linkUrl = this.normalizeUrlFully(link.url);
        return (
          linkUrl === normalizedUrl ||
          linkUrl.includes(normalizedUrl) ||
          normalizedUrl.includes(linkUrl)
        );
      })
    ) {
      this.searchData.submittedLinks.push({ ...data });
    }

    setTimeout(() => this.searchNext(), 2500);
  }

  handleJobTabStatus(data) {
    this.log("📊 Job tab status:", data);

    if (data.isOpen && data.isProcessing) {
      this.applicationState.isApplicationInProgress = true;
      this.statusOverlay.addInfo("Job application in progress, waiting...");

      setTimeout(() => {
        if (this.applicationState.isApplicationInProgress) {
          this.safeSendPortMessage({ type: "CHECK_JOB_TAB_STATUS" });
        }
      }, 10000);
    } else {
      if (this.applicationState.isApplicationInProgress) {
        this.log("🔄 Resetting application in progress flag");
        this.applicationState.isApplicationInProgress = false;
        this.applicationState.applicationStartTime = null;
        this.statusOverlay.addInfo(
          "No active job application, resuming search"
        );

        setTimeout(() => this.searchNext(), 1000);
      }
    }
  }

  handleDuplicateJob(data) {
    this.log("⚠️ Duplicate job detected, resetting application state");
    this.applicationState.isApplicationInProgress = false;
    this.applicationState.applicationStartTime = null;
    this.statusOverlay.addWarning(
      `Job already processed: ${data?.url || "Unknown URL"}`
    );

    setTimeout(() => this.searchNext(), 1000);
  }

  handleErrorMessage(data) {
    const errorMessage =
      data && data.message
        ? data.message
        : "Unknown error from background script";
    this.log("❌ Error from background script:", errorMessage);
    this.statusOverlay.addError("Background error: " + errorMessage);
  }

  async start(params = {}) {
    try {
      this.isRunning = true;
      this.log("🚀 Starting Lever automation");
      this.statusOverlay.addInfo("Starting Lever automation");

      // Update config with parameters
      this.config = { ...this.config, ...params };

      // Wait for page to be ready
      await this.waitForPageLoad();

      // Detect page type and start appropriate automation
      await this.detectPageTypeAndStart();
    } catch (error) {
      this.reportError(error, { phase: "start" });
    }
  }

  async detectPageTypeAndStart() {
    const url = window.location.href;
    this.log(`🔍 Detecting page type for: ${url}`);

    if (url.includes("google.com/search")) {
      this.log("📊 Google search page detected");
      this.statusOverlay.addInfo("Google search page detected");
      await this.startSearchProcess();
    } else if (this.isLeverJobPage(url)) {
      this.log("📋 Lever job page detected");
      this.statusOverlay.addInfo("Lever job page detected");
      await this.startApplicationProcess();
    } else {
      this.log("❓ Unknown page type, waiting for navigation");
      await this.waitForValidPage();
    }
  }

  isLeverJobPage(url) {
    return /^https:\/\/jobs\.(eu\.)?lever\.co\/([^\/]*)\/([^\/]*)\/?(.*)?$/.test(
      url
    );
  }

  async startSearchProcess() {
    try {
      this.statusOverlay.addInfo("Starting job search process");
      this.statusOverlay.updateStatus("searching");

      // Get search task data from background
      await this.fetchSearchTaskData();

      // Start job search loop
      await this.searchNext();
    } catch (error) {
      this.reportError(error, { phase: "search" });
    }
  }

  async fetchSearchTaskData() {
    this.log("📡 Fetching search task data from background");
    this.statusOverlay.addInfo("Fetching search task data...");

    const success = this.safeSendPortMessage({ type: "GET_SEARCH_TASK" });
    if (!success) {
      throw new Error("Failed to request search task data");
    }
  }

  processSearchTaskData(data) {
    try {
      this.log("📊 Processing search task data:", data);

      if (!data) {
        this.log("⚠️ No search task data provided");
        return;
      }

      this.searchData = {
        tabId: data.tabId,
        limit: data.limit || 10,
        current: data.current || 0,
        domain: data.domain || ["https://jobs.lever.co"],
        submittedLinks: data.submittedLinks
          ? data.submittedLinks.map((link) => ({ ...link, tries: 0 }))
          : [],
        searchLinkPattern: data.searchLinkPattern
          ? new RegExp(data.searchLinkPattern.replace(/^\/|\/[gimy]*$/g, ""))
          : /^https:\/\/jobs\.(eu\.)?lever\.co\/([^\/]*)\/([^\/]*)\/?(.*)?$/,
      };

      this.log("✅ Search data initialized:", this.searchData);
      this.statusOverlay.addSuccess("Search initialization complete");
    } catch (error) {
      this.log("❌ Error processing search task data:", error);
      this.statusOverlay.addError(
        "Error processing search task data: " + error.message
      );
    }
  }

  async searchNext() {
    try {
      this.log("Executing searchNext");

      // Critical: If an application is in progress, do not continue
      if (this.applicationState.isApplicationInProgress) {
        this.log("Application in progress, not searching for next link");
        this.statusOverlay.addInfo(
          "Application in progress, waiting to complete..."
        );

        // Verify with background script
        this.safeSendPortMessage({ type: "CHECK_JOB_TAB_STATUS" });
        return;
      }

      this.statusOverlay.addInfo("Searching for job links...");

      // Find all matching links
      let links = this.findAllLinksElements();
      this.log(`Found ${links.length} links`);

      // If no links on page, try to load more
      if (links.length === 0) {
        this.log("No links found, trying to load more");
        this.statusOverlay.addInfo("No links found, trying to load more...");

        if (this.applicationState.isApplicationInProgress) {
          this.log("Application became in progress, aborting navigation");
          return;
        }

        await this.wait(2000);

        if (this.applicationState.isApplicationInProgress) {
          this.log("Application became in progress, aborting navigation");
          return;
        }

        const loadMoreBtn = this.findLoadMoreElement();
        if (loadMoreBtn) {
          if (this.applicationState.isApplicationInProgress) {
            this.log("Application became in progress, aborting navigation");
            return;
          }

          this.statusOverlay.addInfo('Clicking "More results" button');
          loadMoreBtn.click();
          await this.wait(3000);

          if (!this.applicationState.isApplicationInProgress) {
            this.fetchSearchTaskData();
          }
          return;
        } else {
          this.statusOverlay.addWarning("No more results to load");
          this.safeSendPortMessage({ type: "SEARCH_TASK_DONE" });
          this.log("Search task completed");
          return;
        }
      }

      // Process links one by one - USE URL-BASED TRACKING!
      let foundUnprocessedLink = false;

      // First pass: mark all already processed links
      for (let i = 0; i < links.length; i++) {
        let url = this.normalizeUrlFully(links[i].href);

        // Check if this URL is already in processed links
        const processedLink = this.searchData.submittedLinks.find((link) => {
          if (!link.url) return false;
          const normalizedLinkUrl = this.normalizeUrlFully(link.url);
          return (
            normalizedLinkUrl === url ||
            url.includes(normalizedLinkUrl) ||
            normalizedLinkUrl.includes(url)
          );
        });

        // Also check local cache
        const inLocalCache =
          this.applicationState.processedUrls &&
          this.applicationState.processedUrls.has(url);

        if (processedLink || inLocalCache) {
          // Mark as already processed with the appropriate color
          if (processedLink && processedLink.status === "SUCCESS") {
            this.markLinkAsColor(links[i], "orange", "Completed");
          } else if (processedLink && processedLink.status === "ERROR") {
            this.markLinkAsColor(links[i], "red", "Skipped");
          } else {
            this.markLinkAsColor(links[i], "orange", "Completed");
          }

          this.statusOverlay.addInfo(`Skipping already processed: ${url}`);
          continue;
        }

        // Check if URL matches pattern
        if (this.searchData.searchLinkPattern) {
          const pattern =
            typeof this.searchData.searchLinkPattern === "string"
              ? new RegExp(
                  this.searchData.searchLinkPattern.replace(
                    /^\/|\/[gimy]*$/g,
                    ""
                  )
                )
              : this.searchData.searchLinkPattern;

          if (!pattern.test(url)) {
            this.log(`Link ${url} does not match pattern`);
            this.markLinkAsColor(links[i], "red", "Invalid");

            // Add to processed URLs to avoid rechecking
            if (!this.applicationState.processedUrls)
              this.applicationState.processedUrls = new Set();
            this.applicationState.processedUrls.add(url);

            // Add to search data to maintain consistency
            this.searchData.submittedLinks.push({
              url,
              status: "SKIP",
              message: "Link does not match pattern",
            });

            this.statusOverlay.addWarning(
              `Skipping link that doesn't match pattern: ${url}`
            );
            continue;
          }
        }

        // Found an unprocessed link that matches the pattern
        foundUnprocessedLink = true;
      }

      // Check for application in progress before second pass
      if (this.applicationState.isApplicationInProgress) {
        this.log("Application became in progress during first pass, aborting");
        return;
      }

      // Second pass: find the first unprocessed link that meets criteria
      for (let i = 0; i < links.length; i++) {
        let url = this.normalizeUrlFully(links[i].href);

        // Check if this URL is already in processed links
        const alreadyProcessed = this.searchData.submittedLinks.some((link) => {
          if (!link.url) return false;
          const normalizedLinkUrl = this.normalizeUrlFully(link.url);
          return (
            normalizedLinkUrl === url ||
            url.includes(normalizedLinkUrl) ||
            normalizedLinkUrl.includes(url)
          );
        });

        // Also check local cache
        const inLocalCache =
          this.applicationState.processedUrls &&
          this.applicationState.processedUrls.has(url);

        if (alreadyProcessed || inLocalCache) {
          continue;
        }

        // Check if URL matches pattern
        if (this.searchData.searchLinkPattern) {
          const pattern =
            typeof this.searchData.searchLinkPattern === "string"
              ? new RegExp(
                  this.searchData.searchLinkPattern.replace(
                    /^\/|\/[gimy]*$/g,
                    ""
                  )
                )
              : this.searchData.searchLinkPattern;

          if (!pattern.test(url)) {
            continue;
          }
        }

        // Found an unprocessed link that matches the pattern - process it!
        this.statusOverlay.addSuccess("Found job to apply: " + url);

        // Check one more time before proceeding
        if (this.applicationState.isApplicationInProgress) {
          this.log("Application became in progress, aborting new task");
          return;
        }

        // Mark as processing and add to local cache immediately
        this.markLinkAsColor(links[i], "green", "In Progress");

        // Set the application flag BEFORE sending task
        this.applicationState.isApplicationInProgress = true;
        this.applicationState.applicationStartTime = Date.now();

        // Add to local cache immediately to prevent double processing
        if (!this.applicationState.processedUrls)
          this.applicationState.processedUrls = new Set();
        this.applicationState.processedUrls.add(url);

        // Set timeout for detecting stuck applications BEFORE sending message
        if (this.sendCvPageNotRespondTimeout) {
          clearTimeout(this.sendCvPageNotRespondTimeout);
        }

        this.sendCvPageNotRespondTimeout = setTimeout(() => {
          if (this.applicationState.isApplicationInProgress) {
            this.statusOverlay.addWarning(
              "No response from job page, resuming search"
            );
            this.safeSendPortMessage({ type: "SEND_CV_TAB_NOT_RESPOND" });
            this.applicationState.isApplicationInProgress = false;
            this.applicationState.applicationStartTime = null;
            setTimeout(() => this.searchNext(), 2000);
          }
        }, 180000);

        // Send message to the background script
        try {
          this.safeSendPortMessage({
            type: "SEND_CV_TASK",
            data: {
              url,
              title: links[i].textContent.trim() || "Job Application",
            },
          });
        } catch (err) {
          this.log(`Error sending CV task for ${url}:`, err);
          this.statusOverlay.addError("Error sending CV task: " + err.message);

          // Reset flags on error
          this.applicationState.isApplicationInProgress = false;
          this.applicationState.applicationStartTime = null;
          if (this.sendCvPageNotRespondTimeout) {
            clearTimeout(this.sendCvPageNotRespondTimeout);
            this.sendCvPageNotRespondTimeout = null;
          }

          // Remove from processed URLs since we couldn't process it
          if (this.applicationState.processedUrls) {
            this.applicationState.processedUrls.delete(url);
          }

          // Mark as error and continue with next link
          this.markLinkAsColor(links[i], "red", "Error");
          continue;
        }

        // We found a suitable link and sent the message successfully
        foundUnprocessedLink = true;
        return; // Exit after sending one job for processing
      }

      // If we couldn't find any unprocessed links
      if (!foundUnprocessedLink) {
        // Check one more time before trying to navigate
        if (this.applicationState.isApplicationInProgress) {
          this.log("Application became in progress, aborting navigation");
          return;
        }

        // Try to load more results
        this.statusOverlay.addInfo(
          "No new job links found, trying to load more..."
        );
        const loadMoreBtn = this.findLoadMoreElement();

        if (loadMoreBtn) {
          // Final check before clicking
          if (this.applicationState.isApplicationInProgress) {
            this.log("Application became in progress, aborting navigation");
            return;
          }

          // Click the "More results" button and wait
          this.statusOverlay.addInfo('Clicking "More results" button');
          loadMoreBtn.click();

          // Set a timeout to check again after page loads
          // but only if we're not processing an application
          setTimeout(() => {
            if (!this.applicationState.isApplicationInProgress) {
              this.searchNext();
            }
          }, 3000);
        } else {
          // No more results and no unprocessed links - we're done!
          this.statusOverlay.addSuccess(
            "All jobs processed, search completed!"
          );
          this.safeSendPortMessage({ type: "SEARCH_TASK_DONE" });
        }
      }
    } catch (err) {
      this.log("Error in searchNext:", err);
      this.statusOverlay.addError("Error in search: " + err.message);

      // Reset application state on error
      this.applicationState.isApplicationInProgress = false;
      this.applicationState.applicationStartTime = null;
      if (this.sendCvPageNotRespondTimeout) {
        clearTimeout(this.sendCvPageNotRespondTimeout);
        this.sendCvPageNotRespondTimeout = null;
      }

      // Try again after a delay
      setTimeout(() => this.searchNext(), 5000);
    }
  }

  findAllLinksElements() {
    try {
      const domains = Array.isArray(this.searchData.domain)
        ? this.searchData.domain
        : [this.searchData.domain];

      if (!domains || domains.length === 0) {
        this.log("No domains specified for link search");
        return [];
      }

      this.log("Searching for links with domains:", domains);

      // Create a combined selector for all domains
      const selectors = domains.map((domain) => {
        // Handle missing protocol, clean domain
        const cleanDomain = domain
          .replace(/^https?:\/\//, "")
          .replace(/\/$/, "");
        return `#rso a[href*="${cleanDomain}"], #botstuff a[href*="${cleanDomain}"]`;
      });

      const selector = selectors.join(",");
      const links = document.querySelectorAll(selector);

      this.log(`Found ${links.length} matching links`);
      return Array.from(links);
    } catch (err) {
      this.log("Error finding links:", err);
      return [];
    }
  }

  findLoadMoreElement() {
    try {
      // If we're on the last page (prev button but no next button)
      if (
        document.getElementById("pnprev") &&
        !document.getElementById("pnnext")
      ) {
        return null;
      }

      // Method 1: Find "More results" button
      const moreResultsBtn = Array.from(document.querySelectorAll("a")).find(
        (a) => a.textContent.includes("More results")
      );

      if (moreResultsBtn) {
        return moreResultsBtn;
      }

      // Method 2: Look for "Next" button
      const nextBtn = document.getElementById("pnnext");
      if (nextBtn) {
        return nextBtn;
      }

      // Method 3: Try to find any navigation button at the bottom
      const navLinks = [
        ...document.querySelectorAll(
          "#botstuff table a[href^='/search?q=site:']"
        ),
      ];
      this.log(`Found ${navLinks.length} potential navigation links`);

      // Return the last one (typically "More results" or similar)
      return navLinks[navLinks.length - 1];
    } catch (err) {
      this.log("Error finding load more button:", err);
      return null;
    }
  }

  normalizeUrlFully(url) {
    try {
      if (!url) return "";

      // Handle URLs with or without protocol
      if (!url.startsWith("http")) {
        url = "https://" + url;
      }

      // Remove /apply suffix commonly found in Lever job URLs
      url = url.replace(/\/apply$/, "");

      const urlObj = new URL(url);
      // Remove trailing slashes and query parameters
      return (urlObj.origin + urlObj.pathname)
        .toLowerCase()
        .trim()
        .replace(/\/+$/, "");
    } catch (e) {
      this.log("Error normalizing URL:", e);
      return url.toLowerCase().trim();
    }
  }

  async startApplicationProcess() {
    try {
      console.log("📝 Starting application process");
      this.statusOverlay.addInfo("Starting application process");

      // FIXED: Comprehensive user profile validation and fetching
      if (!this.userProfile) {
        console.log(
          "⚠️ No user profile available, attempting multiple fetch strategies..."
        );

        // Strategy 1: Try session context
        if (this.sessionContext && this.sessionContext.userProfile) {
          this.userProfile = this.sessionContext.userProfile;
          console.log("✅ User profile loaded from session context");
        }

        // Strategy 2: Try user service if we have userId
        if (!this.userProfile && this.userId) {
          try {
            console.log("📡 Fetching user profile via user service");
            this.userProfile = await this.userService.getUserDetails();
            console.log("✅ User profile fetched via user service");
          } catch (error) {
            console.error("❌ User service fetch failed:", error);
          }
        }

        // Strategy 3: Try background script
        if (!this.userProfile) {
          console.log("📡 Requesting user profile from background script");
          await this.fetchSendCvTaskData();
        }

        // Final validation
        if (!this.userProfile) {
          this.statusOverlay.addError(
            "No user profile available - automation may fail"
          );
          console.error(
            "❌ Failed to obtain user profile through all strategies"
          );
        } else {
          this.statusOverlay.addSuccess("User profile loaded successfully");
          console.log("✅ User profile finally available:", {
            name: this.userProfile.name || this.userProfile.firstName,
            email: this.userProfile.email,
          });
        }
      } else {
        console.log("✅ Using existing user profile");
        this.statusOverlay.addSuccess("User profile already available");
      }

      // Check for success page first
      const applied = this.checkSubmissionSuccess();
      if (applied) {
        const jobId = this.extractJobIdFromUrl(window.location.href);
        this.safeSendPortMessage({
          type: "SEND_CV_TASK_DONE",
          data: {
            jobId: jobId,
            title: document.title || "Job on Lever",
            company:
              this.extractCompanyFromUrl(window.location.href) ||
              "Company on Lever",
            location: "Not specified",
            jobUrl: window.location.href,
            salary: "Not specified",
            workplace: "Not specified",
            postedDate: "Not specified",
            applicants: "Not specified",
          },
        });

        this.applicationState.isApplicationInProgress = false;
        this.statusOverlay.addSuccess("Application completed successfully");
        return;
      }

      // Proceed with application process
      await new Promise((resolve, reject) => {
        setTimeout(async () => {
          try {
            await this.apply();
            resolve();
          } catch (e) {
            reject(e);
          }
        }, 3000);
      });
    } catch (error) {
      this.reportError(error, { phase: "application" });
      if (error.name === "SendCvSkipError") {
        this.statusOverlay.addWarning("Application skipped: " + error.message);
        this.safeSendPortMessage({
          type: "SEND_CV_TASK_SKIP",
          data: error.message,
        });
      } else {
        this.statusOverlay.addError("Application error: " + error.message);
        this.safeSendPortMessage({
          type: "SEND_CV_TASK_ERROR",
          data: this.errorToString(error),
        });
      }
      this.applicationState.isApplicationInProgress = false;
    }
  }

  async fetchSendCvTaskData() {
    // Only fetch if we don't have user profile
    if (this.userProfile && this.hasSessionContext) {
      this.log("✅ User profile already available from session context");
      return;
    }

    this.log("📡 Fetching send CV task data from background");
    this.statusOverlay.addInfo("Fetching CV task data...");

    const success = this.safeSendPortMessage({ type: "GET_SEND_CV_TASK" });
    if (!success) {
      throw new Error("Failed to request send CV task data");
    }
  }

  processSendCvTaskData(data) {
    try {
      console.log("📊 Processing send CV task data:", {
        hasData: !!data,
        hasProfile: !!data?.profile,
        currentProfileStatus: !!this.userProfile,
      });

      if (!data) {
        console.warn("⚠️ No send CV task data provided");
        return;
      }

      // FIXED: Only update user profile if we don't have one or the new one is more complete
      if (data.profile) {
        if (!this.userProfile) {
          this.userProfile = data.profile;
          console.log("👤 User profile set from background response");
        } else {
          // Merge profiles, keeping non-null values
          const mergedProfile = { ...this.userProfile };
          Object.keys(data.profile).forEach((key) => {
            if (
              data.profile[key] &&
              (!mergedProfile[key] || mergedProfile[key] === "")
            ) {
              mergedProfile[key] = data.profile[key];
            }
          });
          this.userProfile = mergedProfile;
          console.log("👤 User profile merged with background response");
        }
      }

      // Update form handler
      if (this.formHandler && this.userProfile) {
        this.formHandler.userData = this.userProfile;
        console.log("📝 Form handler updated with user profile");
      }

      console.log("✅ CV task data processed successfully", {
        hasUserProfile: !!this.userProfile,
        profileName: this.userProfile?.name || this.userProfile?.firstName,
      });

      this.statusOverlay.addSuccess("Apply initialization complete");
    } catch (error) {
      console.error("❌ Error processing send CV task data:", error);
      this.statusOverlay.addError("Error processing CV data: " + error.message);
    }
  }

  async apply() {
    try {
      this.statusOverlay.addInfo("Starting application process");
      this.statusOverlay.updateStatus("applying");
      console.log("Starting application process");

      // FIXED: Validate all handlers are properly initialized
      if (!this.validateHandlers()) {
        throw new Error("Required handlers are not properly initialized");
      }

      // Check for page errors
      if (
        document.body.innerText.includes("Cannot GET") ||
        document.location.search.includes("not_found=true")
      ) {
        throw new Error("Cannot start send cv: Page error");
      }

      const jobId = this.extractJobIdFromUrl(window.location.href);
      console.log("Extracted job ID:", jobId);

      // Check if already applied
      const applied = this.checkSubmissionSuccess();
      if (applied) {
        this.safeSendPortMessage({
          type: "SEND_CV_TASK_DONE",
          data: {
            jobId: jobId,
            title: document.title || "Job on Lever",
            company:
              this.extractCompanyFromUrl(window.location.href) ||
              "Company on Lever",
            location: "Not specified",
            jobUrl: window.location.href,
            salary: "Not specified",
            workplace: "Not specified",
            postedDate: "Not specified",
            applicants: "Not specified",
          },
        });

        this.applicationState.isApplicationInProgress = false;
        this.statusOverlay.addSuccess("Application completed successfully");
        return true;
      }

      // Enhanced form detection
      const form = this.findApplicationForm();
      if (!form) {
        // Try waiting for dynamic content
        console.log(
          "No form found immediately, waiting for dynamic content..."
        );
        await this.wait(2000);

        const formAfterWait = this.findApplicationForm();
        if (!formAfterWait) {
          throw new Error("Cannot find application form");
        }
        return await this.processApplicationForm(formAfterWait);
      }

      return await this.processApplicationForm(form);
    } catch (e) {
      if (e.name === "SendCvSkipError") {
        throw e;
      } else {
        console.error("Error in apply:", e);
        throw new Error(
          "Error during application process: " + this.errorToString(e)
        );
      }
    }
  }

  findApplicationForm() {
    try {
      console.log("🔍 Searching for application form...");

      // Strategy 1: Lever-specific selectors
      const leverSelectors = [
        'form[action*="lever"]',
        'form[action*="apply"]',
        "form.application-form",
        "form#application-form",
        "form.lever-apply-form",
        'form[data-qa="application-form"]',
        ".posting-apply form",
        ".application-form form",
        ".apply-form form",
      ];

      for (const selector of leverSelectors) {
        const forms = document.querySelectorAll(selector);
        console.log(
          `Checking selector "${selector}": found ${forms.length} forms`
        );

        for (const form of forms) {
          if (this.isFormVisible(form) && this.isFormValid(form)) {
            console.log(`✅ Found valid Lever form with selector: ${selector}`);
            return form;
          }
        }
      }

      // Strategy 2: Look for forms with file inputs (common in job applications)
      const formsWithFiles = document.querySelectorAll("form");
      console.log(
        `Strategy 2: Checking ${formsWithFiles.length} forms for file inputs`
      );

      for (const form of formsWithFiles) {
        if (this.isFormVisible(form)) {
          const fileInputs = form.querySelectorAll('input[type="file"]');
          const textInputs = form.querySelectorAll(
            'input[type="text"], input[type="email"], textarea'
          );

          if (fileInputs.length > 0 && textInputs.length > 0) {
            console.log(
              `✅ Found form with ${fileInputs.length} file inputs and ${textInputs.length} text inputs`
            );
            return form;
          }
        }
      }

      // Strategy 3: Look for forms containing common job application fields
      const applicationKeywords = [
        "name",
        "email",
        "resume",
        "cv",
        "cover",
        "phone",
        "experience",
      ];

      for (const form of formsWithFiles) {
        if (this.isFormVisible(form)) {
          const formText = form.textContent.toLowerCase();
          const matchingKeywords = applicationKeywords.filter((keyword) =>
            formText.includes(keyword)
          );

          if (matchingKeywords.length >= 2) {
            console.log(
              `✅ Found form with application keywords: ${matchingKeywords.join(
                ", "
              )}`
            );
            return form;
          }
        }
      }

      // Strategy 4: Return the first visible form as fallback
      for (const form of formsWithFiles) {
        if (this.isFormVisible(form) && this.isFormValid(form)) {
          console.log("⚠️ Using first visible form as fallback");
          return form;
        }
      }

      console.log("❌ No suitable form found");
      return null;
    } catch (e) {
      console.error("Error finding application form:", e);
      return null;
    }
  }

  async processApplicationForm(form) {
    this.statusOverlay.addInfo("Found application form, beginning to fill out");
    console.log("📝 Processing application form");

    // Validate user profile
    if (!this.userProfile) {
      console.error("❌ No user profile available for form filling");
      this.statusOverlay.addError("No user profile available for form filling");
      throw new Error("User profile is required for form processing");
    }

    console.log("👤 Using user profile for form filling:", {
      name: this.userProfile.name || this.userProfile.firstName,
      email: this.userProfile.email,
      hasResumeUrl: !!this.userProfile.resumeUrl,
      resumeUrls: this.userProfile.resumeUrls?.length || 0,
    });

    // Extract job description for AI context
    const jobDescription = this.extractJobDescription();
    console.log("📄 Job description extracted:", !!jobDescription);

    // Update form handler with job description
    if (this.formHandler) {
      this.formHandler.jobDescription = jobDescription;
      this.formHandler.userData = this.userProfile;
    }

    // FIXED: Enhanced file upload handling with validation
    try {
      console.log("📎 Starting file upload process...");

      // Validate file handler exists
      if (!this.fileHandler) {
        console.error("❌ File handler not initialized!");
        this.statusOverlay.addError("File handler not available");
        throw new Error("File handler not initialized");
      }

      // Validate user profile has file URLs
      const hasResumeUrl = !!(
        this.userProfile.resumeUrl ||
        (this.userProfile.resumeUrl && this.userProfile.resumeUrl.length > 0)
      );
      console.log("📄 Resume availability check:", {
        hasResumeUrl,
        resumeUrl: this.userProfile.resumeUrl,
        resumeUrlsCount: this.userProfile.resumeUrl?.length || 0,
      });

      if (!hasResumeUrl) {
        this.statusOverlay.addWarning("No resume files available for upload");
        console.warn("⚠️ No resume files available in user profile");
      } else {
        this.statusOverlay.addInfo("Processing file uploads...");
        const fileUploadResult = await this.fileHandler.handleFileUploads(
          form,
          this.userProfile,
          jobDescription
        );

        if (fileUploadResult) {
          console.log("✅ File uploads completed successfully");
          this.statusOverlay.addSuccess("File uploads completed");
        } else {
          console.warn("⚠️ File uploads completed with issues");
          this.statusOverlay.addWarning(
            "File uploads completed with some issues"
          );
        }
      }
    } catch (error) {
      console.error("❌ File upload failed:", error);
      this.statusOverlay.addError("File upload failed: " + error.message);
      // Continue with form filling even if file upload fails
    }

    // Process form fields
    // try {
    //   console.log("📝 Filling form fields...");
    //   this.statusOverlay.addInfo("Filling form fields...");

    //   if (!this.formHandler) {
    //     console.error("❌ Form handler not initialized!");
    //     throw new Error("Form handler not initialized");
    //   }

    //   await this.formHandler.fillFormWithProfile(form, this.userProfile);
    //   console.log("✅ Form fields filled");
    //   this.statusOverlay.addSuccess("Form fields filled");
    // } catch (error) {
    //   console.error("⚠️ Form filling failed:", error);
    //   this.statusOverlay.addWarning("Form filling failed: " + error.message);
    // }

    // Find and click submit button
    const submitButton = this.findSubmitButton(form);
    if (!submitButton) {
      throw new Error("Cannot find submit button");
    }

    // Enable submit button if disabled
    if (submitButton.disabled) {
      submitButton.disabled = false;
      console.log("✅ Enabled disabled submit button");
    }

    // Submit the form
    return await this.submitForm(submitButton);
  }

  findSubmitButton(form) {
    console.log("🔍 Looking for submit button...");

    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button[data-qa="submit-application-button"]',
      'button[data-qa="btn-submit"]',
      'button[data-qa="submit"]',
      "button#btn-submit",
      "button.submit-app-btn",
      "button.submit-application",
      ".posting-btn-submit",
      "button.btn-primary:last-of-type",
    ];

    // Try specific selectors first
    for (const selector of submitSelectors) {
      try {
        const buttons = form.querySelectorAll(selector);
        console.log(
          `Checking selector "${selector}": found ${buttons.length} buttons`
        );

        for (const btn of buttons) {
          if (
            this.isElementVisible(btn) &&
            !btn.disabled &&
            !btn.classList.contains("disabled")
          ) {
            console.log(`✅ Found submit button with selector: ${selector}`);
            return btn;
          }
        }
      } catch (e) {
        console.warn(`Error checking selector ${selector}:`, e);
      }
    }

    // Look for buttons with submit-like text
    const allButtons = form.querySelectorAll(
      'button, input[type="button"], input[type="submit"]'
    );
    console.log(`Checking ${allButtons.length} buttons for submit text...`);

    for (const btn of allButtons) {
      if (
        !this.isElementVisible(btn) ||
        btn.disabled ||
        btn.classList.contains("disabled")
      ) {
        continue;
      }

      const text = (btn.textContent || btn.value || "").toLowerCase().trim();
      const submitTexts = [
        "submit",
        "apply",
        "send application",
        "send",
        "continue",
        "next",
      ];

      if (submitTexts.some((submitText) => text.includes(submitText))) {
        console.log(`✅ Found submit button with text: "${text}"`);
        return btn;
      }
    }

    // Last resort: return the last visible button in the form
    const visibleButtons = Array.from(allButtons).filter(
      (btn) =>
        this.isElementVisible(btn) &&
        !btn.disabled &&
        !btn.classList.contains("disabled")
    );

    if (visibleButtons.length > 0) {
      const lastButton = visibleButtons[visibleButtons.length - 1];
      console.log("⚠️ Using last visible button as submit button");
      return lastButton;
    }

    console.log("❌ No submit button found");
    return null;
  }

  async submitForm(submitButton) {
    this.statusOverlay.addInfo("Submitting application...");

    // Scroll to the button
    this.scrollToTargetAdjusted(submitButton, 300);
    await this.wait(600);

    try {
      this.log("Clicking submit button:", submitButton);
      submitButton.click();
      this.statusOverlay.addSuccess("Clicked submit button");
    } catch (e) {
      this.log("Standard click failed:", e);
    }
    return true;
  }

  checkSubmissionSuccess() {
    // Check if URL changed to a success/confirmation page
    if (
      window.location.href.includes("success") ||
      window.location.href.includes("confirmation") ||
      window.location.href.includes("thanks")
    ) {
      this.statusOverlay.addSuccess(
        "URL indicates success page - application submitted"
      );
      return true;
    }

    // Check for error messages
    const errorElements = document.querySelectorAll(
      ".error, .error-message, .form-error, .alert-error, .validation-error"
    );

    if (errorElements.length > 0) {
      const errorMessages = Array.from(errorElements)
        .map((el) => el.textContent.trim())
        .filter((text) => text.length > 0);

      if (errorMessages.length > 0) {
        this.statusOverlay.addError(
          "Form has validation errors: " + errorMessages.join(", ")
        );
        return false;
      }
    }

    // If we can't confirm success, report failure
    this.statusOverlay.addWarning(
      "Unable to confirm submission success - status uncertain"
    );
    return false; // Be cautious and report failure if we can't confirm success
  }

  extractJobIdFromUrl(url) {
    try {
      // Extract job ID from Lever URL format (e.g., jobs.lever.co/company/[JOB_ID])
      const matches = url.match(/\/([a-f0-9-]{36})\/?$/);
      if (matches && matches[1]) {
        return matches[1];
      }

      // Fallback to a timestamp-based ID if we can't find a UUID
      return "job-" + Date.now();
    } catch (error) {
      this.log("Error extracting job ID:", error);
      return "job-" + Date.now();
    }
  }

  extractCompanyFromUrl(url) {
    try {
      // Pattern: https://jobs.lever.co/[COMPANY]/...
      const matches = url.match(/\/\/jobs\.lever\.co\/([^\/]+)/);
      if (matches && matches[1]) {
        return matches[1].charAt(0).toUpperCase() + matches[1].slice(1); // Capitalize company name
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  extractJobDescription() {
    try {
      const descriptionElement = document.querySelector(
        ".posting-content, .posting-description, .job-description"
      );
      return descriptionElement ? descriptionElement.textContent.trim() : "";
    } catch (error) {
      this.log("⚠️ Error extracting job description", error);
      return "";
    }
  }

  scrollToTargetAdjusted(element, offset) {
    if (!element) {
      this.log("Warning: Attempted to scroll to null element");
      return;
    }

    try {
      // Handle case where element might be an array
      if (Array.isArray(element)) {
        this.log("Element is an array, using first element");
        if (element.length > 0) {
          element = element[0];
        } else {
          this.log("Empty array provided to scrollToTargetAdjusted");
          return;
        }
      }

      // Check if element has the necessary methods and properties
      if (
        !element.getBoundingClientRect ||
        typeof element.getBoundingClientRect !== "function"
      ) {
        this.log(`Cannot scroll to element: ${typeof element}, ${element}`);
        return;
      }

      const rect = element.getBoundingClientRect();
      const scrollTop =
        window.pageYOffset || document.documentElement.scrollTop;

      window.scrollTo({
        top: rect.top + scrollTop - offset,
        behavior: "smooth",
      });
    } catch (err) {
      this.log("Error scrolling to element:", err);
      // Continue execution even if scrolling fails
    }
  }

  errorToString(e) {
    if (!e) return "Unknown error (no details)";

    if (e instanceof Error) {
      return e.message + (e.stack ? `\n${e.stack}` : "");
    }

    return String(e);
  }

  wait(timeout) {
    return new Promise((resolve) => setTimeout(resolve, timeout));
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

      if (url.includes("google.com/search") || this.isLeverJobPage(url)) {
        await this.detectPageTypeAndStart();
        return;
      }

      await this.delay(1000);
    }

    throw new Error("Timeout waiting for valid page");
  }

  log(message, data = {}) {
    const sessionInfo = this.sessionId
      ? `[Session: ${this.sessionId.slice(-6)}]`
      : "[No Session]";
    const contextInfo = this.hasSessionContext
      ? "[Context: ✓]"
      : "[Context: ✗]";
    const profileInfo = this.userProfile ? "[Profile: ✓]" : "[Profile: ✗]";

    console.log(
      `🤖 [Lever${sessionInfo}${contextInfo}${profileInfo}] ${message}`,
      data
    );
  }

  cleanup() {
    super.cleanup();

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

    if (this.sendCvPageNotRespondTimeout) {
      clearTimeout(this.sendCvPageNotRespondTimeout);
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

    // Cleanup status overlay
    if (this.statusOverlay) {
      this.statusOverlay.destroy();
      this.statusOverlay = null;
    }

    // Reset state
    this.applicationState.isApplicationInProgress = false;
    this.applicationState.applicationStartTime = null;
    this.applicationState.applicationUrl = null;

    this.log("🧹 Lever platform cleanup completed");
  }

  // Required by base class
  async findJobs() {
    return this.findAllLinksElements();
  }

  async applyToJob(jobElement) {
    // This method is called by base class if needed
    return await this.apply();
  }
}
