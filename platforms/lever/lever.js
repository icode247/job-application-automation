import BasePlatform from "../base-platform.js";
import LeverFormHandler from "./lever-form-handler.js";
import LeverFileHandler from "./lever-file-handler.js";
import {
  AIService,
  ApplicationTrackerService,
  UserService,
  StatusNotificationService,
  FileHandlerService,
} from "../../services/index.js";

export default class LeverPlatform extends BasePlatform {
  constructor(config) {
    super(config);
    this.platform = "lever";
    this.baseUrl = "https://jobs.lever.co";

    // NEW: Session context from config
    this.sessionContext = config.sessionContext || null;

    // Initialize services
    this.aiService = new AIService({ apiHost: this.getApiHost() });
    this.applicationTracker = new ApplicationTrackerService({
      userId: this.userId,
    });
    this.userService = new UserService({ userId: this.userId });
    this.statusService = new StatusNotificationService();
    this.fileHandler = new LeverFileHandler({
      statusService: this.statusService,
      apiHost: this.getApiHost(),
    });

    // Communication state
    this.port = null;
    this.connectionRetries = 0;
    this.maxRetries = 3;
    this.hasSessionContext = false;

    // Application state
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

    this.healthCheckTimer = null;
    this.keepAliveInterval = null;

    // NEW: Initialize with session context if available
    if (this.sessionContext) {
      this.setSessionContext(this.sessionContext);
    }
  }

  // NEW: Method to set/update session context
  async setSessionContext(sessionContext) {
    try {
      console.log("🔧 Setting session context:", sessionContext);

      this.sessionContext = sessionContext;
      this.hasSessionContext = true;

      // Update basic properties
      if (sessionContext.sessionId) this.sessionId = sessionContext.sessionId;
      if (sessionContext.platform) this.platform = sessionContext.platform;
      if (sessionContext.userId) this.userId = sessionContext.userId;

      // Set user profile if available
      if (sessionContext.userProfile) {
        this.userProfile = sessionContext.userProfile;
        console.log("👤 User profile set from session context");
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
        console.log("📝 Form handler updated with user profile");
      }

      // Store API host from session context
      if (sessionContext.apiHost) {
        this.sessionApiHost = sessionContext.apiHost;
      }

      console.log("✅ Session context applied successfully");
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
    this.log("🎯 Lever platform initialized");

    // Set up communication with background script
    this.initializePortConnection();

    // Set up health monitoring
    this.healthCheckTimer = setInterval(() => this.checkHealth(), 60000);

    // Initialize form handler with existing user data if available
    this.formHandler = new LeverFormHandler({
      logger: (message) => this.log(message),
      host: this.getApiHost(),
      userData: this.userProfile || null, // Use existing profile if available
      jobDescription: "",
    });

    console.log(
      "🔧 Form handler initialized with user data:",
      !!this.userProfile
    );
  }

  async start(params = {}) {
    try {
      this.isRunning = true;
      this.log("🚀 Starting Lever automation");

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
      this.statusService.show("Google search page detected", "info");
      await this.startSearchProcess();
    } else if (this.isLeverJobPage(url)) {
      this.log("📋 Lever job page detected");
      this.statusService.show("Lever job page detected", "info");
      await this.startApplicationProcess();
    } else {
      this.log("❓ Unknown page type, waiting for navigation");
      await this.waitForValidPage();
    }
  }

  async startSearchProcess() {
    try {
      this.statusService.show("Starting job search process", "info");
      this.updateProgress({ phase: "searching" });

      // Get search task data from background
      await this.fetchSearchTaskData();

      // Start job search loop
      await this.continueJobSearch();
    } catch (error) {
      this.reportError(error, { phase: "search" });
    }
  }

  async startApplicationProcess() {
    try {
      this.log("📝 Starting application process");
      this.statusService.show("Starting application process", "info");

      // Check if we have user profile from session context
      if (!this.userProfile && this.hasSessionContext) {
        this.log(
          "⚠️ No user profile in session context, requesting from background"
        );
        await this.fetchSendCvTaskData();
      } else if (this.userProfile) {
        this.log("✅ Using user profile from session context");
        this.statusService.show("User profile loaded from session", "success");
      } else {
        this.log("📡 Requesting user profile from background");
        await this.fetchSendCvTaskData();
      }

      // Extract job details
      const jobDetails = this.extractJobDetails();
      this.log("📋 Job details extracted", jobDetails);

      // Check if already applied
      const alreadyApplied =
        await this.applicationTracker.checkIfAlreadyApplied(jobDetails.jobId);
      if (alreadyApplied) {
        this.log("⚠️ Already applied to this job");
        await this.handleJobCompletion(
          jobDetails,
          "SKIPPED",
          "Already applied"
        );
        return;
      }

      // Apply for the job
      const success = await this.applyToJob(jobDetails);

      if (success) {
        await this.handleJobCompletion(jobDetails, "SUCCESS");
      } else {
        await this.handleJobCompletion(
          jobDetails,
          "FAILED",
          "Application failed"
        );
      }
    } catch (error) {
      this.reportError(error, { phase: "application" });
      await this.handleJobCompletion(null, "ERROR", error.message);
    }
  }

  async fetchSendCvTaskData() {
    // Only fetch if we don't have user profile
    if (this.userProfile && this.hasSessionContext) {
      this.log("✅ User profile already available from session context");
      return;
    }

    this.log("📡 Fetching send CV task data from background");
    this.statusService.show("Fetching CV task data...", "info");

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
        console.log("👤 User profile set from background response");
      }

      // Update form handler
      if (this.formHandler) {
        this.formHandler.userData = this.userProfile;
      }

      this.log("✅ CV task data processed successfully");
      this.statusService.show("Apply initialization complete", "success");
    } catch (error) {
      this.log("❌ Error processing send CV task data:", error);
      this.statusService.show(
        `Error processing CV data: ${error.message}`,
        "error"
      );
    }
  }

  async applyToJob(jobDetails) {
    try {
      this.statusService.show("Looking for application form", "info");

      // Ensure we have user profile
      if (!this.userProfile) {
        throw new Error("No user profile available for application");
      }

      // Look for apply button first
      const applyButton = this.findApplyButton();
      if (applyButton) {
        this.log("🔘 Found apply button, clicking it");
        applyButton.click();
        await this.delay(3000);
      }

      // Find application form
      const form = this.findApplicationForm();
      if (!form) {
        throw new Error("Cannot find application form");
      }

      this.log("📝 Found application form, processing");
      this.statusService.show("Found application form, filling out", "info");

      // Update form handler with job description
      this.formHandler.jobDescription = jobDetails.description;
      this.formHandler.userData = this.userProfile;

      // Process the form
      const success = await this.processApplicationForm(form, jobDetails);

      if (success) {
        this.statusService.show(
          "Application submitted successfully",
          "success"
        );
        this.log("✅ Application submitted successfully");
        return true;
      } else {
        this.statusService.show("Application submission failed", "error");
        this.log("❌ Application submission failed");
        return false;
      }
    } catch (error) {
      this.log(`❌ Error applying to job: ${error.message}`);
      this.statusService.show(`Application error: ${error.message}`, "error");
      return false;
    }
  }

  // Enhanced initialization to handle session context better
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
    } catch (error) {
      this.log("❌ Error initializing port connection:", error);
      if (this.connectionRetries < this.maxRetries) {
        this.connectionRetries++;
        setTimeout(() => this.initializePortConnection(), 5000);
      }
    }
  }

  handleSuccessMessage(data) {
    if (data) {
      if (data.submittedLinks !== undefined) {
        // This is search task data
        this.processSearchTaskData(data);
      } else if (data.profile !== undefined || data.session !== undefined) {
        // This is send CV task data - only process if we don't have user profile
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

  // Override the page detection to be more robust
  isLeverJobPage(url) {
    return /^https:\/\/jobs\.lever\.co\/[^\/]+\/[^\/]+\/?.*$/.test(url);
  }

  // Add debug information to help troubleshoot
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

  handlePortMessage(message) {
    try {
      this.log("📨 Received port message:", message);

      const { type, data } = message || {};
      if (!type) {
        this.log("⚠️ Received message without type, ignoring");
        return;
      }

      switch (type) {
        case "SUCCESS":
          this.handleSuccessMessage(data);
          break;

        case "SEARCH_NEXT":
          this.handleSearchNext(data);
          break;

        case "APPLICATION_STATUS_RESPONSE":
          this.handleApplicationStatusResponse(data);
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

  handleSuccessMessage(data) {
    if (data) {
      if (data.submittedLinks !== undefined) {
        // This is search task data
        this.processSearchTaskData(data);
      } else if (data.profile !== undefined) {
        // This is send CV task data
        this.processSendCvTaskData(data);
      }
    }
  }

  handleSearchNext(data) {
    this.log("🔄 Received search next notification", data);

    // Reset application state
    this.applicationState.isApplicationInProgress = false;
    this.applicationState.applicationUrl = null;
    this.applicationState.applicationStartTime = null;

    // Update processed links if URL provided
    if (data && data.url) {
      this.searchData.submittedLinks.push({
        url: data.url,
        status: data.status || "PROCESSED",
        message: data.message || "",
        timestamp: Date.now(),
      });

      // Update visual status of the link
      this.updateLinkStatus(data.url, data.status, data.message);
    }

    // Continue searching if running and haven't reached limit
    if (this.isRunning && this.searchData.current < this.searchData.limit) {
      this.log("🔄 Continuing job search...");
      setTimeout(() => this.continueJobSearch(), 2000);
    } else {
      this.log("🏁 Search completed or limit reached");
      this.reportComplete();
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
      this.statusService.show(
        "Detected state mismatch - resetting flags",
        "warning"
      );

      // Continue search after brief delay
      setTimeout(() => this.continueJobSearch(), 1000);
    }
  }

  handleJobTabStatus(data) {
    this.log("📊 Job tab status:", data);

    if (data.isOpen && data.isProcessing) {
      this.applicationState.isApplicationInProgress = true;
      this.statusService.show(
        "Job application in progress, waiting...",
        "info"
      );

      // Check again after delay
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
        this.statusService.show(
          "No active job application, resuming search",
          "info"
        );

        setTimeout(() => this.continueJobSearch(), 1000);
      }
    }
  }

  handleDuplicateJob(data) {
    this.log("⚠️ Duplicate job detected, resetting application state");
    this.applicationState.isApplicationInProgress = false;
    this.applicationState.applicationStartTime = null;
    this.statusService.show(
      `Job already processed: ${data?.url || "Unknown URL"}`,
      "warning"
    );

    // Continue to next job
    setTimeout(() => this.continueJobSearch(), 1000);
  }

  handleErrorMessage(data) {
    const errorMessage =
      data && data.message
        ? data.message
        : "Unknown error from background script";
    this.log("❌ Error from background script:", errorMessage);
    this.statusService.show(`Background error: ${errorMessage}`, "error");
  }

  async start(params = {}) {
    try {
      this.isRunning = true;
      this.log("🚀 Starting Lever automation");

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
      this.statusService.show("Google search page detected", "info");
      await this.startSearchProcess();
    } else if (this.isLeverJobPage(url)) {
      this.log("📋 Lever job page detected");
      this.statusService.show("Lever job page detected", "info");
      await this.startApplicationProcess();
    } else {
      this.log("❓ Unknown page type, waiting for navigation");
      await this.waitForValidPage();
    }
  }

  isLeverJobPage(url) {
    return /^https:\/\/jobs\.lever\.co\/[^\/]+\/[^\/]+\/?.*$/.test(url);
  }

  async startSearchProcess() {
    try {
      this.statusService.show("Starting job search process", "info");
      this.updateProgress({ phase: "searching" });

      // Get search task data from background
      await this.fetchSearchTaskData();

      // Start job search loop
      await this.continueJobSearch();
    } catch (error) {
      this.reportError(error, { phase: "search" });
    }
  }

  async fetchSearchTaskData() {
    this.log("📡 Fetching search task data from background");
    this.statusService.show("Fetching search task data...", "info");

    const success = this.safeSendPortMessage({ type: "GET_SEARCH_TASK" });
    if (!success) {
      throw new Error("Failed to request search task data");
    }

    // Data will be received via handlePortMessage
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
        domain: data.domain || ["lever.co"],
        submittedLinks: data.submittedLinks || [],
        searchLinkPattern: data.searchLinkPattern
          ? new RegExp(data.searchLinkPattern.replace(/^\/|\/[gimy]*$/g, ""))
          : /^https:\/\/jobs\.lever\.co\/[^\/]+\/[^\/]+\/?.*$/,
      };

      this.log("✅ Search data initialized:", this.searchData);
      this.statusService.show("Search initialization complete", "success");
    } catch (error) {
      this.log("❌ Error processing search task data:", error);
      this.statusService.show(
        `Error processing search data: ${error.message}`,
        "error"
      );
    }
  }

  async continueJobSearch() {
    while (this.isRunning && !this.isPaused) {
      try {
        // Check if we've reached the limit
        if (this.searchData.current >= this.searchData.limit) {
          this.log("✅ Reached application limit");
          this.reportComplete();
          return;
        }

        // Check if application is in progress
        if (this.applicationState.isApplicationInProgress) {
          this.log("⏳ Application in progress, waiting...");
          await this.delay(5000);
          continue;
        }

        // Find job links on current page
        const jobLinks = this.findJobLinks();
        this.log(`🔗 Found ${jobLinks.length} job links`);

        // Process each job link
        let processedAny = false;
        for (const link of jobLinks) {
          if (!this.isRunning || this.isPaused) break;

          if (this.applicationState.isApplicationInProgress) {
            this.log("⏳ Application started, stopping job search loop");
            return;
          }

          const processed = await this.processJobLink(link);
          if (processed) {
            processedAny = true;
            return; // Exit and wait for application completion
          }
        }

        // If no jobs were processed, try to load more results
        if (!processedAny) {
          const loadedMore = await this.loadMoreResults();
          if (!loadedMore) {
            this.log("🏁 No more results available");
            this.reportComplete();
            return;
          }
        }

        await this.delay(2000);
      } catch (error) {
        this.reportError(error, { phase: "job_processing" });
        await this.delay(5000);
      }
    }
  }

  findJobLinks() {
    const links = [];
    const selectors = ['a[href*="jobs.lever.co"]', 'a[href*="lever.co"]'];

    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        const url = element.href;
        if (this.isValidLeverJobLink(url) && !this.isUrlProcessed(url)) {
          links.push({
            element,
            url,
            title: this.extractJobTitle(element),
          });
        }
      }
    }

    return links;
  }

  isValidLeverJobLink(url) {
    if (!this.searchData.searchLinkPattern) return false;
    return this.searchData.searchLinkPattern.test(url);
  }

  isUrlProcessed(url) {
    const normalizedUrl = this.normalizeUrl(url);

    // Check local cache
    if (this.applicationState.processedUrls.has(normalizedUrl)) {
      return true;
    }

    // Check submitted links
    return this.searchData.submittedLinks.some((link) =>
      this.isUrlMatch(link.url, url)
    );
  }

  extractJobTitle(element) {
    return element.textContent?.trim() || "Job Application";
  }

  async processJobLink(jobLink) {
    try {
      this.log(`🎯 Processing job: ${jobLink.url}`);

      if (this.applicationState.isApplicationInProgress) {
        this.log("⚠️ Already processing a job, skipping");
        return false;
      }

      // Mark as processing
      this.markLinkAsProcessing(jobLink.element);
      this.applicationState.processedUrls.add(this.normalizeUrl(jobLink.url));

      // Check if we can apply more
      const canApply = await this.userService.canApplyMore();
      if (!canApply) {
        this.log("❌ Application limit reached");
        this.markLinkAsError(jobLink.element, "Limit reached");
        return false;
      }

      // Send request to background to open job in new tab
      const success = this.safeSendPortMessage({
        type: "SEND_CV_TASK",
        data: {
          url: jobLink.url,
          title: jobLink.title,
        },
      });

      if (success) {
        this.applicationState.isApplicationInProgress = true;
        this.applicationState.applicationUrl = jobLink.url;
        this.applicationState.applicationStartTime = Date.now();
        this.markLinkAsSuccess(jobLink.element);
        return true;
      } else {
        this.markLinkAsError(jobLink.element, "Failed to send job request");
        this.resetApplicationState();
        return false;
      }
    } catch (error) {
      this.log(`❌ Error processing job link: ${error.message}`);
      this.markLinkAsError(jobLink.element, error.message);
      this.resetApplicationState();
      return false;
    }
  }

  async loadMoreResults() {
    try {
      this.log("🔄 Attempting to load more results");

      const nextButton = this.findNextButton();
      if (nextButton) {
        this.log("⏭️ Found next button, clicking");
        nextButton.click();
        await this.delay(3000);
        return true;
      }

      this.log("❌ No more results button found");
      return false;
    } catch (error) {
      this.log(`❌ Error loading more results: ${error.message}`);
      return false;
    }
  }

  findNextButton() {
    const selectors = [
      "#pnnext",
      'a[aria-label="Next page"]',
      'a[id="pnnext"]',
      ".pnprev ~ a",
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && this.isElementVisible(element)) {
        return element;
      }
    }

    return null;
  }

  async startApplicationProcess() {
    try {
      this.log("📝 Starting application process");
      this.statusService.show("Starting application process", "info");

      // Get send CV task data from background
      await this.fetchSendCvTaskData();

      // Extract job details
      const jobDetails = this.extractJobDetails();
      this.log("📋 Job details extracted", jobDetails);

      // Check if already applied
      const alreadyApplied =
        await this.applicationTracker.checkIfAlreadyApplied(jobDetails.jobId);
      if (alreadyApplied) {
        this.log("⚠️ Already applied to this job");
        await this.handleJobCompletion(
          jobDetails,
          "SKIPPED",
          "Already applied"
        );
        return;
      }

      // Apply for the job
      const success = await this.applyToJob(jobDetails);

      if (success) {
        await this.handleJobCompletion(jobDetails, "SUCCESS");
      } else {
        await this.handleJobCompletion(
          jobDetails,
          "FAILED",
          "Application failed"
        );
      }
    } catch (error) {
      this.reportError(error, { phase: "application" });
      await this.handleJobCompletion(null, "ERROR", error.message);
    }
  }

  async fetchSendCvTaskData() {
    this.log("📡 Fetching send CV task data from background");
    this.statusService.show("Fetching CV task data...", "info");

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

      // Store user profile data
      this.userProfile = data.profile;

      // Update form handler
      if (this.formHandler) {
        this.formHandler.userData = this.userProfile;
      }

      this.log("✅ CV task data processed successfully");
      this.statusService.show("Apply initialization complete", "success");
    } catch (error) {
      this.log("❌ Error processing send CV task data:", error);
      this.statusService.show(
        `Error processing CV data: ${error.message}`,
        "error"
      );
    }
  }

  extractJobDetails() {
    const url = window.location.href;
    const urlParts = url.split("/");
    const jobId = urlParts[urlParts.length - 1] || "unknown";

    const title =
      this.extractText([
        'h2[data-qa="posting-name"]',
        ".posting-headline h2",
        "h1",
        ".job-title",
      ]) || document.title;

    const company =
      this.extractText([".main-header-text-logo", ".company-name", "h1 a"]) ||
      this.extractCompanyFromUrl(url);

    const location =
      this.extractText([
        ".posting-headline .posting-categories .location",
        ".location",
        '[data-qa="posting-location"]',
      ]) || "Not specified";

    const description = this.extractJobDescription();

    return {
      jobId,
      title,
      company,
      location,
      description,
      url,
      platform: "lever",
      extractedAt: Date.now(),
    };
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

  extractCompanyFromUrl(url) {
    try {
      const match = url.match(/\/\/jobs\.lever\.co\/([^\/]+)/);
      return match ? match[1].replace(/-/g, " ") : "Company";
    } catch (error) {
      return "Company";
    }
  }

  async applyToJob(jobDetails) {
    try {
      this.statusService.show("Looking for application form", "info");

      // Look for apply button first
      const applyButton = this.findApplyButton();
      if (applyButton) {
        this.log("🔘 Found apply button, clicking it");
        applyButton.click();
        await this.delay(3000);
      }

      // Find application form
      const form = this.findApplicationForm();
      if (!form) {
        throw new Error("Cannot find application form");
      }

      this.log("📝 Found application form, processing");
      this.statusService.show("Found application form, filling out", "info");

      // Update form handler with job description
      this.formHandler.jobDescription = jobDetails.description;
      this.formHandler.userData = this.userProfile;

      // Process the form
      const success = await this.processApplicationForm(form, jobDetails);

      if (success) {
        this.statusService.show(
          "Application submitted successfully",
          "success"
        );
        this.log("✅ Application submitted successfully");
        return true;
      } else {
        this.statusService.show("Application submission failed", "error");
        this.log("❌ Application submission failed");
        return false;
      }
    } catch (error) {
      this.log(`❌ Error applying to job: ${error.message}`);
      this.statusService.show(`Application error: ${error.message}`, "error");
      return false;
    }
  }

  findApplyButton() {
    const selectors = [
      ".posting-btn-submit",
      'a[data-qa="btn-apply"]',
      'button[data-qa="btn-apply"]',
      ".apply-button",
      'a[href*="apply"]',
      'button[class*="apply"]',
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && this.isElementVisible(element)) {
        return element;
      }
    }

    return null;
  }

  findApplicationForm() {
    const selectors = [
      'form[data-qa="posting-form"]',
      ".posting-form",
      "form.application-form",
      'form[action*="apply"]',
      'form[action*="lever"]',
      "form",
    ];

    for (const selector of selectors) {
      const forms = document.querySelectorAll(selector);
      for (const form of forms) {
        if (
          this.isElementVisible(form) &&
          form.querySelectorAll("input, select, textarea").length > 0
        ) {
          return form;
        }
      }
    }

    return null;
  }

  async processApplicationForm(form, jobDetails) {
    try {
      this.log("📝 Processing application form");

      // 1. Handle file uploads (resume, cover letter)
      await this.fileHandler.handleFileUploads(
        form,
        this.userProfile,
        jobDetails.description
      );

      // 2. Fill out form fields using AI
      await this.formHandler.fillFormWithProfile(form, this.userProfile);

      // 3. Handle required checkboxes and agreements
      await this.formHandler.handleRequiredCheckboxes(form);

      // 4. Submit the form
      const submitted = await this.formHandler.submitForm(form);

      if (submitted) {
        // Wait for submission to complete
        await this.waitForSubmissionComplete();
        return true;
      }

      return false;
    } catch (error) {
      this.log(`❌ Error processing application form: ${error.message}`);
      return false;
    }
  }

  async waitForSubmissionComplete(timeout = 15000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      // Check for success indicators
      const successSelectors = [
        ".posting-confirmation",
        ".thank-you",
        ".success-message",
        '[data-qa="confirmation"]',
      ];

      for (const selector of successSelectors) {
        const element = document.querySelector(selector);
        if (element && this.isElementVisible(element)) {
          this.log("✅ Application submission confirmed");
          return true;
        }
      }

      // Check if URL changed to confirmation page
      if (
        window.location.href.includes("thank") ||
        window.location.href.includes("success") ||
        window.location.href.includes("confirmation")
      ) {
        this.log("✅ Redirected to confirmation page");
        return true;
      }

      await this.delay(1000);
    }

    // Assume success if no error indicators found
    this.log("⏳ No confirmation found, assuming success");
    return true;
  }

  async handleJobCompletion(jobDetails, status, message = "") {
    try {
      this.log(`📊 Handling job completion: ${status}`);

      // Send completion message to background script
      const messageType =
        status === "SUCCESS"
          ? "SEND_CV_TASK_DONE"
          : status === "FAILED" || status === "ERROR"
          ? "SEND_CV_TASK_ERROR"
          : "SEND_CV_TASK_SKIP";

      const success = this.safeSendPortMessage({
        type: messageType,
        data: status === "SUCCESS" ? jobDetails : message,
      });

      if (!success) {
        this.log("⚠️ Failed to send completion message to background");
      }

      // Update application count if successful
      if (status === "SUCCESS" && jobDetails) {
        await this.userService.updateApplicationCount();
        await this.applicationTracker.saveAppliedJob({
          ...jobDetails,
          appliedAt: Date.now(),
          status: "applied",
        });

        this.reportApplicationSubmitted(jobDetails, {
          status: "applied",
          appliedAt: Date.now(),
        });
      }

      // Update progress
      if (status === "SUCCESS") {
        this.progress.completed++;
      } else if (status === "FAILED" || status === "ERROR") {
        this.progress.failed++;
      } else {
        this.progress.skipped++;
      }

      this.updateProgress(this.progress);

      // Reset application state
      this.resetApplicationState();
    } catch (error) {
      this.reportError(error, { phase: "job_completion" });
    }
  }

  // Update visual status of processed links
  updateLinkStatus(url, status, message) {
    try {
      const links = this.findJobLinks();
      for (const linkData of links) {
        if (this.isUrlMatch(linkData.url, url)) {
          if (status === "SUCCESS") {
            this.markLinkAsSuccess(linkData.element);
          } else if (status === "ERROR" || status === "FAILED") {
            this.markLinkAsError(linkData.element, message || "Failed");
          } else if (status === "SKIPPED") {
            this.markLinkAsSkipped(linkData.element, message || "Skipped");
          }
          break;
        }
      }
    } catch (error) {
      this.log(`⚠️ Error updating link status: ${error.message}`);
    }
  }

  // Utility methods
  extractText(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element.textContent?.trim() || "";
      }
    }
    return "";
  }

  isElementVisible(element) {
    if (!element) return false;

    const style = window.getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    );
  }

  normalizeUrl(url) {
    try {
      const urlObj = new URL(url);
      return (urlObj.origin + urlObj.pathname)
        .toLowerCase()
        .trim()
        .replace(/\/+$/, "");
    } catch (error) {
      return url.toLowerCase().trim();
    }
  }

  isUrlMatch(url1, url2) {
    if (!url1 || !url2) return false;
    return this.normalizeUrl(url1) === this.normalizeUrl(url2);
  }

  resetApplicationState() {
    this.applicationState.isApplicationInProgress = false;
    this.applicationState.applicationUrl = null;
    this.applicationState.applicationStartTime = null;
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
          // 5 minutes
          this.log("🚨 Application stuck for over 5 minutes, resetting");
          this.handleJobCompletion(null, "ERROR", "Application timeout");
        }
      }
    } catch (error) {
      this.log("❌ Health check error", error);
    }
  }

  markLinkAsProcessing(element) {
    this.markLinkWithColor(element, "#2196F3", "Processing");
  }

  markLinkAsSuccess(element) {
    this.markLinkWithColor(element, "#4CAF50", "Success");
  }

  markLinkAsSkipped(element, message) {
    this.markLinkWithColor(element, "#FF9800", `Skipped: ${message}`);
  }

  markLinkAsError(element, message) {
    this.markLinkWithColor(element, "#F44336", `Error: ${message}`);
  }

  markLinkWithColor(element, color, text) {
    try {
      if (!element || !element.parentElement) return;

      element.parentElement.style.border = `2px solid ${color}`;
      element.parentElement.style.backgroundColor = `${color}22`;

      // Add status badge
      const badge = document.createElement("span");
      badge.style.cssText = `
        position: absolute;
        top: -5px;
        right: -5px;
        background: ${color};
        color: white;
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 10px;
        font-weight: bold;
        z-index: 1000;
      `;
      badge.textContent = text;

      element.parentElement.style.position = "relative";
      element.parentElement.appendChild(badge);
    } catch (error) {
      // Ignore marking errors
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

      if (url.includes("google.com/search") || this.isLeverJobPage(url)) {
        await this.detectPageTypeAndStart();
        return;
      }

      await this.delay(1000);
    }

    throw new Error("Timeout waiting for valid page");
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

    // Disconnect port
    if (this.port) {
      try {
        this.port.disconnect();
      } catch (e) {
        // Ignore errors
      }
      this.port = null;
    }

    // Reset state
    this.resetApplicationState();

    this.log("🧹 Lever platform cleanup completed");
  }

  // Required by base class
  async findJobs() {
    return this.findJobLinks();
  }

  async applyToJob(jobElement) {
    // This method is called by base class if needed
    const jobDetails = this.extractJobDetails();
    return await this.applyToJob(jobDetails);
  }
}
