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

export default class LeverPlatform extends BasePlatform {
  constructor(config) {
    super(config);
    this.platform = "lever";
    this.baseUrl = "https://jobs.lever.co";

    // Session context from config
    this.sessionContext = config.sessionContext || null;

    // Initialize services
    this.aiService = new AIService({ apiHost: this.getApiHost() });
    this.applicationTracker = new ApplicationTrackerService({
      userId: this.userId,
    });
    this.userService = new UserService({ userId: this.userId });
    this.fileHandler = new LeverFileHandler({
      statusService: this.statusOverlay,
      apiHost: this.getApiHost(),
    });

    // Initialize status overlay
    this.statusOverlay = new StatusOverlay({
      id: 'lever-status-overlay',
      title: 'LEVER AUTOMATION',
      icon: '🤖',
      position: { top: '10px', right: '10px' }
    });

    // Communication state
    this.port = null;
    this.connectionRetries = 0;
    this.maxRetries = 3;
    this.hasSessionContext = false;

    // Application state (from working code)
    this.applicationState = {
      isApplicationInProgress: false,
      applicationStartTime: null,
      applicationUrl: null,
      processedUrls: new Set(),
      processedLinksCount: 0,
    };

    // Search data (will be populated from background)
    this.searchData = {
      limit: 0,
      current: 0,
      domain: ["lever.co"],
      submittedLinks: [],
      searchLinkPattern: null,
    };

    // Timers and intervals
    this.healthCheckTimer = null;
    this.keepAliveInterval = null;
    this.sendCvPageNotRespondTimeout = null;
    this.stuckStateTimer = null;
    this.stateVerificationInterval = null;

    this.markLinkAsColor = markLinkAsColor;
    // Initialize with session context if available
    if (this.sessionContext) {
      this.setSessionContext(this.sessionContext);
    }
  }

  async setSessionContext(sessionContext) {
    try {
      this.log("🔧 Setting session context:", sessionContext);

      this.sessionContext = sessionContext;
      this.hasSessionContext = true;

      // Update basic properties
      if (sessionContext.sessionId) this.sessionId = sessionContext.sessionId;
      if (sessionContext.platform) this.platform = sessionContext.platform;
      if (sessionContext.userId) this.userId = sessionContext.userId;

      // Set user profile if available
      if (sessionContext.userProfile) {
        this.userProfile = sessionContext.userProfile;
        this.log("👤 User profile set from session context");
      }

      // Update services with user context
      if (this.userId) {
        this.applicationTracker = new ApplicationTrackerService({
          userId: this.userId,
        });
        this.userService = new UserService({ userId: this.userId });
      }

      // Update form handler if it exists
      if (this.formHandler && sessionContext.userProfile) {
        this.formHandler.userData = sessionContext.userProfile;
        this.log("📝 Form handler updated with user profile");
      }

      // Store API host from session context
      if (sessionContext.apiHost) {
        this.sessionApiHost = sessionContext.apiHost;
      }

      this.log("✅ Session context applied successfully");
    } catch (error) {
      this.log("❌ Error setting session context:", error);
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
    this.log("🎯 Lever platform initialized");

    // Create status overlay
    this.statusOverlay.create();

    // Set up communication with background script
    this.initializePortConnection();

    // Set up health monitoring
    this.startHealthCheck();

    // Set up state verification
    this.startStateVerification();

    // Initialize form handler
    this.formHandler = new LeverFormHandler({
      logger: (message) => this.statusOverlay.addInfo(message),
      host: this.getApiHost(),
      userData: this.userProfile || null,
      jobDescription: "",
    });

    this.log("🔧 Form handler initialized with user data:", !!this.userProfile);
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

      const sessionSuffix = this.sessionId ? `-${this.sessionId.slice(-6)}` : "";
      const timestamp = Date.now();
      const portName = isApplyPage
        ? `lever-apply-${timestamp}${sessionSuffix}`
        : `lever-search-${timestamp}${sessionSuffix}`;

      this.log(`🔌 Creating connection with port name: ${portName}`);

      // Create the connection
      this.port = chrome.runtime.connect({ name: portName });

      if (!this.port) {
        throw new Error("Failed to establish connection with background script");
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
          this.log(`🔄 Attempting to reconnect (${this.connectionRetries}/${this.maxRetries})...`);
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
        const applicationTime = now - this.applicationState.applicationStartTime;

        if (applicationTime > 5 * 60 * 1000) {
          this.log("🚨 Application stuck for over 5 minutes, forcing reset");
          this.applicationState.isApplicationInProgress = false;
          this.applicationState.applicationStartTime = null;
          this.statusOverlay.addWarning("Application timeout detected - resetting state");
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

    if (data && data.active === false && this.applicationState.isApplicationInProgress) {
      this.log("⚠️ State mismatch detected! Resetting application progress flag");
      this.applicationState.isApplicationInProgress = false;
      this.applicationState.applicationStartTime = null;
      this.statusOverlay.addWarning("Detected state mismatch - resetting flags");

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
          this.log("✅ User profile already available, skipping CV task data processing");
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
            "Error with: " + data.url + (data.message ? ` - ${data.message}` : "")
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
        this.statusOverlay.addInfo("No active job application, resuming search");

        setTimeout(() => this.searchNext(), 1000);
      }
    }
  }

  handleDuplicateJob(data) {
    this.log("⚠️ Duplicate job detected, resetting application state");
    this.applicationState.isApplicationInProgress = false;
    this.applicationState.applicationStartTime = null;
    this.statusOverlay.addWarning(`Job already processed: ${data?.url || "Unknown URL"}`);

    setTimeout(() => this.searchNext(), 1000);
  }

  handleErrorMessage(data) {
    const errorMessage =
      data && data.message ? data.message : "Unknown error from background script";
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
    return /^https:\/\/jobs\.(eu\.)?lever\.co\/([^\/]*)\/([^\/]*)\/?(.*)?$/.test(url);
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
      this.statusOverlay.addError("Error processing search task data: " + error.message);
    }
  }

  async searchNext() {
    try {
      this.log("Executing searchNext");

      // Critical: If an application is in progress, do not continue
      if (this.applicationState.isApplicationInProgress) {
        this.log("Application in progress, not searching for next link");
        this.statusOverlay.addInfo("Application in progress, waiting to complete...");

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
        const inLocalCache = this.applicationState.processedUrls && this.applicationState.processedUrls.has(url);

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
              ? new RegExp(this.searchData.searchLinkPattern.replace(/^\/|\/[gimy]*$/g, ""))
              : this.searchData.searchLinkPattern;

          if (!pattern.test(url)) {
            this.log(`Link ${url} does not match pattern`);
            this.markLinkAsColor(links[i], "red", "Invalid");

            // Add to processed URLs to avoid rechecking
            if (!this.applicationState.processedUrls) this.applicationState.processedUrls = new Set();
            this.applicationState.processedUrls.add(url);

            // Add to search data to maintain consistency
            this.searchData.submittedLinks.push({
              url,
              status: "SKIP",
              message: "Link does not match pattern",
            });

            this.statusOverlay.addWarning(`Skipping link that doesn't match pattern: ${url}`);
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
        const inLocalCache = this.applicationState.processedUrls && this.applicationState.processedUrls.has(url);

        if (alreadyProcessed || inLocalCache) {
          continue;
        }

        // Check if URL matches pattern
        if (this.searchData.searchLinkPattern) {
          const pattern =
            typeof this.searchData.searchLinkPattern === "string"
              ? new RegExp(this.searchData.searchLinkPattern.replace(/^\/|\/[gimy]*$/g, ""))
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
        if (!this.applicationState.processedUrls) this.applicationState.processedUrls = new Set();
        this.applicationState.processedUrls.add(url);

        // Set timeout for detecting stuck applications BEFORE sending message
        if (this.sendCvPageNotRespondTimeout) {
          clearTimeout(this.sendCvPageNotRespondTimeout);
        }

        this.sendCvPageNotRespondTimeout = setTimeout(() => {
          if (this.applicationState.isApplicationInProgress) {
            this.statusOverlay.addWarning("No response from job page, resuming search");
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
        this.statusOverlay.addInfo("No new job links found, trying to load more...");
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
          this.statusOverlay.addSuccess("All jobs processed, search completed!");
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
        const cleanDomain = domain.replace(/^https?:\/\//, "").replace(/\/$/, "");
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
      if (document.getElementById("pnprev") && !document.getElementById("pnnext")) {
        return null;
      }

      // Method 1: Find "More results" button
      const moreResultsBtn = Array.from(document.querySelectorAll("a")).find((a) =>
        a.textContent.includes("More results")
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
      const navLinks = [...document.querySelectorAll("#botstuff table a[href^='/search?q=site:']")];
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
      return (urlObj.origin + urlObj.pathname).toLowerCase().trim().replace(/\/+$/, "");
    } catch (e) {
      this.log("Error normalizing URL:", e);
      return url.toLowerCase().trim();
    }
  }

  async startApplicationProcess() {
    try {
      this.log("📝 Starting application process");
      this.statusOverlay.addInfo("Starting application process");
      console.log("this.userProfile", this.userProfile);
      console.log("this.hasSessionContext", this.hasSessionContext);
      
      // Check if we have user profile from session context
      if (!this.userProfile && this.hasSessionContext) {
        this.log("⚠️ No user profile in session context, requesting from background");
        await this.fetchSendCvTaskData();
      } else if (this.userProfile) {
        this.log("✅ Using user profile from session context");
        this.statusOverlay.addSuccess("User profile loaded from session");
      } else {
        this.log("📡 Requesting user profile from background");
        await this.fetchSendCvTaskData();
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
            company: this.extractCompanyFromUrl(window.location.href) || "Company on Lever",
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
        this.log("Application completed successfully");
        return;
      }

      // Proceed with application process
      await new Promise((resolve, reject) => {
        setTimeout(async () => {
          try {
            const applied = await this.apply();
            resolve();
          } catch (e) {
            reject(e);
          }
        }, 3000);
      });
    } catch (error) {
      this.reportError(error, { phase: "application" });
      if (error.name === "SendCvSkipError") {
        this.log("Application skipped:", error.message);
        this.statusOverlay.addWarning("Application skipped: " + error.message);
        this.safeSendPortMessage({ type: "SEND_CV_TASK_SKIP", data: error.message });
      } else {
        this.log("SEND CV ERROR", error);
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
      this.log("📊 Processing send CV task data:", data);

      if (!data) {
        this.log("⚠️ No send CV task data provided");
        return;
      }

      // Store user profile data (only if not already set from session context)
      if (!this.userProfile && data.profile) {
        this.userProfile = data.profile;
        this.log("👤 User profile set from background response");
      }

      // Update form handler
      if (this.formHandler) {
        this.formHandler.userData = this.userProfile;
      }

      this.log("✅ CV task data processed successfully");
      this.statusOverlay.addSuccess("Apply initialization complete");
    } catch (error) {
      this.log("❌ Error processing send CV task data:", error);
      this.statusOverlay.addError("Error processing CV data: " + error.message);
    }
  }

  async apply() {
    try {
      this.statusOverlay.addInfo("Starting application process");
      this.statusOverlay.updateStatus("applying");
      this.log("Starting application process");

      if (
        document.body.innerText.includes("Cannot GET") ||
        document.location.search.includes("not_found=true")
      ) {
        throw new Error("Cannot start send cv: Page error");
      }

      // Extract job ID from URL
      const jobId = this.extractJobIdFromUrl(window.location.href);
      this.log("Extracted job ID:", jobId);

      // Check if already applied
      const applied = this.checkSubmissionSuccess();
      if (applied) {
        this.safeSendPortMessage({
          type: "SEND_CV_TASK_DONE",
          data: {
            jobId: jobId,
            title: document.title || "Job on Lever",
            company: this.extractCompanyFromUrl(window.location.href) || "Company on Lever",
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
        this.log("Application completed successfully");
        return true;
      }

      // Find application form
      const form = this.findApplicationForm();
      if (!form) {
        throw new Error("Cannot find application form");
      }

      // Process the application form
      const result = await this.processApplicationForm(form);
      this.statusOverlay.addMessage("Form submission result: " + (result ? "SUCCESS" : "FAILED"), result ? "success" : "error");
      return result;
    } catch (e) {
      if (e.name === "SendCvSkipError") {
        throw e;
      } else {
        this.log("Error in apply:", e);
        throw new Error("Error during application process: " + this.errorToString(e));
      }
    }
  }

  findApplicationForm() {
    try {
      // Lever forms usually have specific patterns
      const formSelectors = [
        'form[action*="lever"]',
        "form.application-form",
        "form#application-form",
        "form.lever-apply-form",
        'form[data-qa="application-form"]',
        "form",
      ];

      for (const selector of formSelectors) {
        const forms = document.querySelectorAll(selector);
        if (forms.length > 0) {
          // Return the first visible form
          for (const form of forms) {
            if (form.offsetParent !== null) {
              return form;
            }
          }
        }
      }

      // No form found with selectors, look for form elements more deeply
      const allForms = document.querySelectorAll("form");
      if (allForms.length > 0) {
        // Return the first visible form
        for (const form of allForms) {
          if (form.offsetParent !== null) {
            return form;
          }
        }
      }

      return null;
    } catch (e) {
      this.log("Error finding application form:", e);
      return null;
    }
  }

  async processApplicationForm(form) {
    this.statusOverlay.addInfo("Found application form, beginning to fill out");

    // Extract profile data
    const profile = this.userProfile || {};

    // Handle file uploads
    await this.fileHandler.handleFileUploads(form, profile, this.extractJobDescription());

    // Process form fields using form handler
    await this.formHandler.fillFormWithProfile(form, profile);

    // Find submit button
    const submitButton = this.findSubmitButton(form);

    if (!submitButton) {
      throw new Error("Cannot find submit button");
    }

    // Enable the submit button if disabled
    if (submitButton.disabled) {
      submitButton.disabled = false;
    }

    // Submit the form
    const submitted = await this.submitForm(submitButton);
    return submitted;
  }

  findSubmitButton(form) {
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button[data-qa="submit-application-button"]',
      'button[data-qa="btn-submit"]',
      "button#btn-submit",
      "button.submit-app-btn",
      "button.submit-application",
    ];

    for (const selector of submitSelectors) {
      try {
        const btns = form.querySelectorAll(selector);
        if (btns.length > 0) {
          for (const btn of btns) {
            if (btn.offsetParent !== null && !btn.disabled && !btn.classList.contains("disabled")) {
              return btn;
            }
          }
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    // Try to find any button that looks like a submit button
    const allButtons = form.querySelectorAll('button, input[type="button"], input[type="submit"]');
    for (const btn of allButtons) {
      const text = btn.textContent.toLowerCase();
      if (
        (text.includes("submit") || text.includes("apply")) &&
        btn.offsetParent !== null &&
        !btn.disabled &&
        !btn.classList.contains("disabled")
      ) {
        return btn;
      }
    }

    // If no specific submit button found, return the last button in the form
    const buttons = form.querySelectorAll("button");
    if (buttons.length > 0) {
      return buttons[buttons.length - 1];
    }

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
      this.statusOverlay.addSuccess("URL indicates success page - application submitted");
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
        this.statusOverlay.addError("Form has validation errors: " + errorMessages.join(", "));
        return false;
      }
    }

    // If we can't confirm success, report failure
    this.statusOverlay.addWarning("Unable to confirm submission success - status uncertain");
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
      if (!element.getBoundingClientRect || typeof element.getBoundingClientRect !== "function") {
        this.log(`Cannot scroll to element: ${typeof element}, ${element}`);
        return;
      }

      const rect = element.getBoundingClientRect();
      const scrollTop = window.pageYOffset || document.documentElement.scrollTop;

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
    const sessionInfo = this.sessionId ? `[Session: ${this.sessionId.slice(-6)}]` : "[No Session]";
    const contextInfo = this.hasSessionContext ? "[Context: ✓]" : "[Context: ✗]";
    const profileInfo = this.userProfile ? "[Profile: ✓]" : "[Profile: ✗]";

    console.log(`🤖 [Lever${sessionInfo}${contextInfo}${profileInfo}] ${message}`, data);
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