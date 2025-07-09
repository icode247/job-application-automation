// platforms/recruitee/recruitee.js
import BasePlatform from "../base-platform.js";
import { RecruiteeFormHandler } from "./recruitee-form-handler.js";
import { RecruiteeFileHandler } from "./recruitee-file-handler.js";
import {
  AIService,
  ApplicationTrackerService,
  UserService,
  StatusOverlay,
} from "../../services/index.js";
import { markLinkAsColor } from "../../utils/mark-links.js";
import { API_HOST_URL } from "../../services/constants.js";

// Custom error types
class ApplicationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "ApplicationError";
    this.details = details;
  }
}

class SkipApplicationError extends ApplicationError {
  constructor(message) {
    super(message);
    this.name = "SkipApplicationError";
  }
}

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
      domain: ["recruitee.com"],
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

      // Update form handler if it exists
      if (this.formHandler && this.userProfile) {
        this.formHandler.userData = this.userProfile;
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

  async initialize() {
    await super.initialize();

    // Create status overlay FIRST
    this.statusOverlay.create();

    // Initialize file handler
    this.fileHandler = new RecruiteeFileHandler({
      statusService: this.statusOverlay,
      apiHost: this.getApiHost(),
    });

    // Set up communication with background script
    this.initializePortConnection();

    // Set up health monitoring
    this.startHealthCheck();
    this.startStateVerification();

    // Initialize form handler
    this.formHandler = new RecruiteeFormHandler({
      logger: (message) => this.statusOverlay.addInfo(message),
      host: this.getApiHost(),
      userData: this.userProfile || {},
      jobDescription: "",
    });

    this.statusOverlay.addSuccess("Recruitee automation initialized");
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
        case "SEARCH_TASK_DATA":
          this.handleSearchTaskData(data);
          break;

        case "APPLICATION_TASK_DATA":
          this.handleApplicationTaskData(data);
          break;

        case "APPLICATION_STARTING":
          this.handleApplicationStarting(data);
          break;

        case "APPLICATION_STATUS":
          this.handleApplicationStatus(data);
          break;

        case "SEARCH_NEXT":
          this.handleSearchNext(data);
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
        submittedLinks: data.submittedLinks
          ? data.submittedLinks.map((link) => ({ ...link, tries: 0 }))
          : [],
        searchLinkPattern: data.searchLinkPattern
          ? new RegExp(data.searchLinkPattern.replace(/^\/|\/[gimy]*$/g, ""))
          : /^https:\/\/.*\.recruitee\.com\/(o|career)\/([^\/]+)\/?.*$/,
      };

      // Include user profile if available
      if (data.profile && !this.userProfile) {
        this.userProfile = data.profile;
        this.log("👤 User profile loaded from search task data");
      }

      this.log("✅ Search data initialized:", this.searchData);
      this.statusOverlay.addSuccess("Search initialization complete");

      // Start search process
      setTimeout(() => this.searchNext(), 1000);
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

      // Update form handler
      if (this.formHandler && this.userProfile) {
        this.formHandler.userData = this.userProfile;
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

  handleApplicationStarting(data) {
    this.log("🎯 Application starting:", data);
    this.applicationState.isApplicationInProgress = true;
    this.applicationState.applicationStartTime = Date.now();
    this.statusOverlay.addInfo("Application starting...");
  }

  handleApplicationStatus(data) {
    this.log("📊 Application status:", data);

    if (data.inProgress && !this.applicationState.isApplicationInProgress) {
      this.applicationState.isApplicationInProgress = true;
      this.applicationState.applicationStartTime = Date.now();
      this.statusOverlay.addInfo("Application in progress, waiting...");
    } else if (
      !data.inProgress &&
      this.applicationState.isApplicationInProgress
    ) {
      this.applicationState.isApplicationInProgress = false;
      this.applicationState.applicationStartTime = null;
      this.statusOverlay.addInfo("No active application, resuming search");
      setTimeout(() => this.searchNext(), 1000);
    }
  }

  handleSearchNext(data) {
    this.log("🔄 Received search next notification", data);

    // Reset application state
    this.applicationState.isApplicationInProgress = false;
    this.applicationState.applicationStartTime = null;
    this.applicationState.processedLinksCount++;

    // Clear timeout
    if (this.sendCvPageNotRespondTimeout) {
      clearTimeout(this.sendCvPageNotRespondTimeout);
      this.sendCvPageNotRespondTimeout = null;
    }

    if (!data || !data.url) {
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
          this.markLinkAsColor(links[i], "orange", "Completed");
          this.statusOverlay.addSuccess("Successfully submitted: " + data.url);
        } else if (data.status === "ERROR") {
          this.markLinkAsColor(links[i], "red", "Error");
          this.statusOverlay.addError(
            "Error with: " +
              data.url +
              (data.message ? ` - ${data.message}` : "")
          );
        } else {
          this.markLinkAsColor(links[i], "orange", "Skipped");
          this.statusOverlay.addWarning(
            "Skipped: " + data.url + (data.message ? ` - ${data.message}` : "")
          );
        }

        linkFound = true;
        break;
      }
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
      this.log("▶️ Starting Recruitee automation");

      // FIXED: Ensure user profile is available before starting
      if (!this.userProfile && this.userId) {
        try {
          console.log("🔄 Attempting to fetch user profile during start...");
          this.userProfile = await this.userService.getUserDetails();
          console.log("✅ User profile fetched during start");
        } catch (error) {
          console.error("❌ Failed to fetch user profile during start:", error);
        }
      }

      // Update config with parameters
      this.config = { ...this.config, ...params };

      // Update progress
      this.updateProgress({
        total: params.jobsToApply || 0,
        completed: 0,
        current: "Starting automation...",
      });

      // Wait for page to be ready
      await this.waitForPageLoad();

      // Detect page type and start appropriate automation
      await this.detectPageTypeAndStart();

      return true;
    } catch (error) {
      this.reportError(error, { action: "start" });
      return false;
    }
  }

  async detectPageTypeAndStart() {
    const url = window.location.href;
    this.log(`🔍 Detecting page type for: ${url}`);

    if (url.includes("google.com/search")) {
      this.log("📊 Google search page detected");
      this.statusOverlay.addInfo("Google search page detected");
      await this.startSearchProcess();
    } else if (this.isRecruiteeJobPage(url)) {
      this.log("📋 Recruitee job page detected");
      this.statusOverlay.addInfo("Recruitee job page detected");
      await this.startApplicationProcess();
    } else {
      this.log("❓ Unknown page type, waiting for navigation");
      await this.waitForValidPage();
    }
  }

  isRecruiteeJobPage(url) {
    return /recruitee\.com\/(o|career)\//.test(url);
  }

  async startSearchProcess() {
    try {
      this.statusOverlay.addInfo("Starting job search process");
      this.statusOverlay.updateStatus("searching");

      // Get search task data from background
      await this.fetchSearchTaskData();
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
        this.safeSendPortMessage({ type: "CHECK_APPLICATION_STATUS" });
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
          this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
          this.log("Search task completed");
          return;
        }
      }

      // Process links one by one
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
          // Mark as already processed
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

        // Set timeout for detecting stuck applications
        if (this.sendCvPageNotRespondTimeout) {
          clearTimeout(this.sendCvPageNotRespondTimeout);
        }

        this.sendCvPageNotRespondTimeout = setTimeout(() => {
          if (this.applicationState.isApplicationInProgress) {
            this.statusOverlay.addWarning(
              "No response from job page, resuming search"
            );
            this.applicationState.isApplicationInProgress = false;
            this.applicationState.applicationStartTime = null;
            setTimeout(() => this.searchNext(), 2000);
          }
        }, 180000);

        // Send message to the background script
        try {
          this.safeSendPortMessage({
            type: "START_APPLICATION",
            data: {
              url,
              title: links[i].textContent.trim() || "Job Application",
            },
          });
        } catch (err) {
          this.log(`Error sending application task for ${url}:`, err);
          this.statusOverlay.addError(
            "Error sending application task: " + err.message
          );

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
          this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
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
      this.statusOverlay.updateStatus("applying");

      // Validate user profile
      if (!this.userProfile) {
        console.log("⚠️ No user profile available, attempting to fetch...");
        await this.fetchApplicationTaskData();
      }

      if (!this.userProfile) {
        this.statusOverlay.addError(
          "No user profile available - automation may fail"
        );
        console.error("❌ Failed to obtain user profile");
      } else {
        this.statusOverlay.addSuccess("User profile loaded successfully");
        console.log("✅ User profile available:", {
          name: this.userProfile.name || this.userProfile.firstName,
          email: this.userProfile.email,
        });
      }

      // Wait for page to fully load
      await this.wait(3000);

      // Start application
      await this.apply();
    } catch (error) {
      this.reportError(error, { phase: "application" });
      if (error.name === "SkipApplicationError") {
        this.statusOverlay.addWarning("Application skipped: " + error.message);
        this.safeSendPortMessage({
          type: "APPLICATION_SKIPPED",
          data: error.message,
        });
      } else {
        this.statusOverlay.addError("Application error: " + error.message);
        this.safeSendPortMessage({
          type: "APPLICATION_ERROR",
          data: this.errorToString(error),
        });
      }
      this.applicationState.isApplicationInProgress = false;
    }
  }

  async fetchApplicationTaskData() {
    this.log("📡 Fetching application task data from background");
    this.statusOverlay.addInfo("Fetching application data...");

    const success = this.safeSendPortMessage({ type: "GET_APPLICATION_TASK" });
    if (!success) {
      throw new Error("Failed to request application task data");
    }
  }

  async apply() {
    try {
      this.statusOverlay.addInfo("Starting to apply for job");

      // Check if page is valid
      if (
        document.body.innerText.includes("Cannot GET") ||
        document.body.innerText.includes("404 Not Found") ||
        document.body.innerText.includes("No longer available")
      ) {
        throw new SkipApplicationError(
          "Cannot start application: Page error or job no longer available"
        );
      }

      // Extract job ID from URL
      const urlParts = window.location.pathname.split("/");
      const jobId = urlParts[urlParts.length - 1] || "unknown";
      console.log("Extracted job ID:", jobId);

      // Wait a moment for page to fully load
      await this.wait(3000);

      // Check if we're on a job details page or application form page
      const applyButton = document.querySelector(
        "a.c-button--primary, a.c-button--apply, a.cta-button, button.c-button--apply"
      );
      if (applyButton) {
        this.statusOverlay.addInfo("Found apply button, clicking it");
        applyButton.click();
        await this.wait(3000);
      }

      // Check if we're on an apply page by looking for form
      const form = this.findApplicationForm();
      if (!form) {
        throw new SkipApplicationError("Cannot find application form");
      }

      // Extract job description
      const jobDescription = this.extractJobDescription();

      // Process the form
      const result = await this.processApplicationForm(
        form,
        this.userProfile,
        jobDescription
      );

      this.statusOverlay.addInfo(
        "Form submission result: " + (result ? "SUCCESS" : "FAILED")
      );

      if (result) {
        // Get job details from page
        const jobTitle =
          document.querySelector("h1")?.textContent.trim() ||
          document.title.split(" - ")[0] ||
          document.title ||
          "Job on Recruitee";

        // Extract company name from URL or page
        const companyName =
          this.extractCompanyFromUrl(window.location.href) ||
          document.querySelector('meta[property="og:site_name"]')?.content ||
          "Company on Recruitee";

        // Try to extract location from the page
        let location = "Not specified";
        const locationEl = document.querySelector(
          '.job-location, .c-job__info-item, [data-ui="location"]'
        );
        if (locationEl) {
          location = locationEl.textContent.trim();
        }

        // Send completion message
        this.safeSendPortMessage({
          type: "APPLICATION_COMPLETED",
          data: {
            jobId,
            title: jobTitle,
            company: companyName,
            location,
            jobUrl: window.location.href,
            salary: "Not specified",
            workplace: "Not specified",
            postedDate: "Not specified",
            applicants: "Not specified",
          },
        });

        // Reset application state
        this.applicationState.isApplicationInProgress = false;
        this.applicationState.applicationStartTime = null;

        console.log("Application completed successfully");
        this.statusOverlay.addSuccess("Application completed successfully");
        this.statusOverlay.updateStatus("success");
      }

      return result;
    } catch (error) {
      if (error instanceof SkipApplicationError) {
        throw error;
      } else {
        console.error("Error in apply:", error);
        throw new ApplicationError(
          "Error during application process: " + this.errorToString(error)
        );
      }
    }
  }

  async processApplicationForm(form, profile, jobDescription) {
    this.statusOverlay.addInfo("Found application form, beginning to fill out");

    try {
      // Get the API host
      const aiApiHost = this.getApiHost();

      // Initialize/update form handler
      if (!this.formHandler) {
        this.formHandler = new RecruiteeFormHandler({
          logger: (message) => this.statusOverlay.addInfo(message),
          host: aiApiHost,
          userData: profile,
          jobDescription,
        });
      } else {
        this.formHandler.userData = profile;
        this.formHandler.jobDescription = jobDescription;
      }

      // Handle multi-step form if present
      const isMultiStep = form.querySelector(".c-step, .steps-indicator");

      if (isMultiStep) {
        return await this.handleMultiStepForm(form, profile, jobDescription);
      }

      // Handle file uploads (resume)
      await this.fileHandler.handleResumeUpload(profile, form);

      // Fill out form fields using AI-enhanced RecruiteeFormHandler
      await this.formHandler.fillFormWithProfile(form, profile);

      // Handle required checkboxes
      await this.formHandler.handleRequiredCheckboxes(form);

      // Submit the form
      return await this.formHandler.submitForm(form);
    } catch (error) {
      console.error("Error processing application form:", error);
      this.statusOverlay.addError(
        "Error processing form: " + this.errorToString(error)
      );
      return false;
    }
  }

  async handleMultiStepForm(form, profile, jobDescription) {
    this.statusOverlay.addInfo("Detected multi-step application form");

    try {
      // Handle resume upload - typically on first step
      await this.fileHandler.handleResumeUpload(profile, form);

      // Process each step until we reach the end
      let isComplete = false;
      let stepCount = 0;
      const maxSteps = 10; // Safety limit

      while (!isComplete && stepCount < maxSteps) {
        stepCount++;
        this.statusOverlay.addInfo(`Processing form step ${stepCount}`);

        // Fill out visible form fields
        await this.formHandler.fillFormWithProfile(form, profile);

        // Handle required checkboxes
        await this.formHandler.handleRequiredCheckboxes(form);

        // Find next/submit button
        const nextButton = this.formHandler.findSubmitButton(form);
        if (!nextButton) {
          throw new ApplicationError(
            `Cannot find next/submit button on step ${stepCount}`
          );
        }

        // Click the button
        this.statusOverlay.addInfo(
          `Clicking next/submit button on step ${stepCount}`
        );
        nextButton.click();

        // Wait for page to update
        await this.wait(3000);

        // Check if we're done
        const successMessage = document.querySelector(
          "div.application-confirmation, div.success-message, h1.success-message, div[class*='success'], div.thank-you, div[class*='thankyou'], div.c-application__done"
        );
        if (successMessage) {
          this.statusOverlay.addInfo(
            "Found success message, application complete"
          );
          isComplete = true;
          return true;
        }

        // Check if there was an error
        const errorMessage = document.querySelector(
          ".error-message, .field_with_errors, .invalid-feedback"
        );
        if (errorMessage) {
          this.statusOverlay.addInfo(
            `Error on step ${stepCount}: ${errorMessage.textContent.trim()}`
          );
          // Try to fix the error and continue
        }

        // Find form again (might have changed)
        form = this.findApplicationForm();
        if (!form) {
          this.statusOverlay.addInfo(
            "Form no longer found, checking if application completed"
          );
          // Check alternative success indicators
          if (
            document.body.textContent.includes("Thank you") ||
            document.body.textContent.includes("Successfully")
          ) {
            isComplete = true;
            return true;
          } else {
            throw new ApplicationError(
              "Form disappeared without success message"
            );
          }
        }
      }

      if (stepCount >= maxSteps) {
        throw new ApplicationError("Exceeded maximum number of form steps");
      }

      return isComplete;
    } catch (error) {
      console.error("Error in multi-step form:", error);
      throw error;
    }
  }

  findApplicationForm() {
    const formSelectors = [
      "form.c-form",
      "form#new_job_application",
      "form.careers-form",
      "form.application-form",
    ];

    for (const selector of formSelectors) {
      const forms = document.querySelectorAll(selector);
      if (forms.length) {
        for (const form of forms) {
          if (this.isElementVisible(form)) {
            return form;
          }
        }
      }
    }

    const allForms = document.querySelectorAll("form");
    for (const form of allForms) {
      if (
        this.isElementVisible(form) &&
        form.querySelectorAll("input, select, textarea").length > 0
      ) {
        return form;
      }
    }

    return null;
  }

  extractJobDescription() {
    let description = "";

    const descriptionSelectors = [
      ".c-job__description",
      ".job-description",
      ".description",
      '[data-ui="job-description"]',
      ".vacancy-description",
      "#job-details",
    ];

    for (const selector of descriptionSelectors) {
      const descElement = document.querySelector(selector);
      if (descElement) {
        description = descElement.textContent.trim();
        break;
      }
    }

    if (!description) {
      const mainContent = document.querySelector(
        "main, #content, .content, .job-content"
      );
      if (mainContent) {
        description = mainContent.textContent.trim();
      }
    }

    if (!description) {
      const jobTitle = document.title || "";
      const companyName =
        this.extractCompanyFromUrl(window.location.href) || "";
      description = `Job: ${jobTitle} at ${companyName}`;
    }

    return description;
  }

  extractCompanyFromUrl(url) {
    try {
      const matches = url.match(/\/\/(.+?)\.recruitee\.com\//);
      if (matches && matches[1]) {
        return (
          matches[1].charAt(0).toUpperCase() +
          matches[1].slice(1).replace(/-/g, " ")
        );
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  isElementVisible(element) {
    try {
      if (!element) return false;

      const style = window.getComputedStyle(element);

      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      ) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return false;
      }

      return true;
    } catch (error) {
      return true;
    }
  }

  errorToString(e) {
    if (e instanceof Error) {
      if (e.stack) {
        return e.stack;
      }
      return e.message;
    }
    return String(e);
  }

  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

      if (url.includes("google.com/search") || this.isRecruiteeJobPage(url)) {
        await this.detectPageTypeAndStart();
        return;
      }

      await this.delay(1000);
    }

    throw new Error("Timeout waiting for valid page");
  }

  // Rest of the utility methods...
  getApiHost() {
    return (
      this.sessionApiHost ||
      this.sessionContext?.apiHost ||
      this.config.apiHost ||
      API_HOST_URL ||
      "http://localhost:3000"
    );
  }

  async findJobs() {
    return this.findAllLinksElements();
  }

  async applyToJob(jobElement) {
    return await this.apply();
  }

  onDOMChange() {
    // Handle DOM changes if needed
  }

  onNavigation(oldUrl, newUrl) {
    // Handle navigation changes if needed
  }

  async pause() {
    await super.pause();
  }

  async resume() {
    await super.resume();
  }

  async stop() {
    await super.stop();
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
      `🤖 [Recruitee${sessionInfo}${contextInfo}${profileInfo}] ${message}`,
      data
    );
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

    super.cleanup();
    this.log("🧹 Recruitee platform cleanup completed");
  }
}
