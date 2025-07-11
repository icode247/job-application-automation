// platforms/ashby/ashby.js
import BasePlatformAutomation from "../../shared/base/base-platform-automation.js";
import { AshbyFormHandler } from "./ashby-form-handler.js";
import { AshbyFileHandler } from "./ashby-file-handler.js";
import { UrlUtils, DomUtils } from "../../shared/utilities/index.js";
import {
  AIService,
  ApplicationTrackerService,
  UserService,
} from "../../services/index.js";

// Custom error types for Ashby
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

export default class AshbyPlatform extends BasePlatformAutomation {
  constructor(config) {
    super(config);
    this.platform = "ashby";
    this.baseUrl = "https://ashbyhq.com";

    // Initialize Ashby-specific services
    this.aiService = new AIService({ apiHost: this.getApiHost() });
    this.applicationTracker = new ApplicationTrackerService({
      userId: this.userId,
    });
    this.userService = new UserService({ userId: this.userId });

    this.fileHandler = null;
    this.formHandler = null;

    // Add flags to prevent duplicate starts
    this.searchProcessStarted = false;
  }

  // ========================================
  // PLATFORM-SPECIFIC IMPLEMENTATIONS (Required by base class)
  // ========================================

  getPlatformDomains() {
    return ["ashbyhq.com", "jobs.ashbyhq.com"];
  }

  getSearchLinkPattern() {
    return /^https:\/\/(jobs\.ashbyhq\.com\/[^\/]+\/[^\/]+|[^\/]+\.ashbyhq\.com\/[^\/]+)\/?.*$/;
  }

  isValidJobPage(url) {
    return (
      url.includes("ashbyhq.com") &&
      (url.includes("/jobs/") || url.match(/\/[a-f0-9-]{8,}/))
    );
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

      console.log("✅ Ashby session context set successfully", {
        hasUserProfile: !!this.userProfile,
        userId: this.userId,
        sessionId: this.sessionId,
        profileName: this.userProfile?.name || this.userProfile?.firstName,
        profileEmail: this.userProfile?.email,
      });
    } catch (error) {
      console.error("❌ Error setting Ashby session context:", error);
      this.statusOverlay?.addError(
        "❌ Error setting session context: " + error.message
      );
    }
  }

  async start(params = {}) {
    try {
      // Prevent duplicate starts
      if (this.isRunning) {
        this.log("⚠️ Automation already running, ignoring duplicate start");
        return true;
      }

      this.isRunning = true;
      this.log("▶️ Starting Ashby automation");

      // Ensure user profile is available before starting
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
      this.isRunning = false; // Reset on error
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
        case "CONNECTION_ESTABLISHED":
          this.log("✅ Port connection established with background script");
          this.statusOverlay?.addSuccess("Connection established");
          break;

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

        case "SUCCESS":
          this.handleSuccessMessage(data);
          break;

        default:
          this.log(`❓ Unhandled message type: ${type}`);
      }
    } catch (error) {
      this.log("❌ Error handling port message:", error);
    }
  }

  async findJobs() {
    return this.findAllLinksElements();
  }

  async applyToJob(jobElement) {
    return await this.apply();
  }

  getApiHost() {
    return (
      this.sessionApiHost ||
      this.sessionContext?.apiHost ||
      this.config.apiHost ||
      "http://localhost:3000"
    );
  }

  isApplicationPage(url) {
    return this.isValidJobPage(url);
  }

  getJobTaskMessageType() {
    return "SEND_CV_TASK";
  }

  // ========================================
  // ASHBY-SPECIFIC INITIALIZATION
  // ========================================

  async initialize() {
    await super.initialize(); // Handles all common initialization

    // Initialize Ashby-specific handlers
    this.fileHandler = new AshbyFileHandler({
      statusService: this.statusOverlay,
      apiHost: this.getApiHost(),
    });

    this.formHandler = new AshbyFormHandler({
      logger: (message) => this.statusOverlay.addInfo(message),
      host: this.getApiHost(),
      userData: this.userProfile || {},
      jobDescription: "",
    });

    this.statusOverlay.addSuccess("Ashby-specific components initialized");
  }

  // ========================================
  // ASHBY-SPECIFIC MESSAGE HANDLING
  // ========================================

  handlePlatformSpecificMessage(type, data) {
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

      case "SUCCESS":
        this.handleSuccessMessage(data);
        break;

      case "APPLICATION_STATUS_RESPONSE":
        this.handleApplicationStatusResponse(data);
        break;

      case "JOB_TAB_STATUS":
        this.handleJobTabStatus(data);
        break;

      default:
        super.handlePlatformSpecificMessage(type, data);
    }
  }

  handleSearchTaskData(data) {
    try {
      this.log("📊 Processing Ashby search task data:", data);

      if (!data) {
        this.log("⚠️ No search task data provided");
        return;
      }

      this.searchData = {
        limit: data.limit || 10,
        current: data.current || 0,
        domain: data.domain || this.getPlatformDomains(),
        submittedLinks: data.submittedLinks
          ? data.submittedLinks.map((link) => ({ ...link, tries: 0 }))
          : [],
        searchLinkPattern: data.searchLinkPattern
          ? new RegExp(data.searchLinkPattern.replace(/^\/|\/[gimy]*$/g, ""))
          : this.getSearchLinkPattern(),
      };

      // Include user profile if available
      if (data.profile && !this.userProfile) {
        this.userProfile = data.profile;
        this.log("👤 User profile loaded from search task data");
      }

      this.log("✅ Ashby search data initialized:", this.searchData);
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

  handleSuccessMessage(data) {
    if (data && data.submittedLinks !== undefined) {
      // This is search task data
      this.processSearchTaskData(data);
    } else if (data && data.profile !== undefined && !this.userProfile) {
      // This is application task data
      this.processSendCvTaskData(data);
    }
  }

  processSearchTaskData(data) {
    try {
      this.log("📊 Processing Ashby search task data:", data);

      if (!data) {
        this.log("⚠️ No search task data provided");
        return;
      }

      this.searchData = {
        tabId: data.tabId,
        limit: data.limit || 10,
        current: data.current || 0,
        domain: data.domain || this.getPlatformDomains(),
        submittedLinks: data.submittedLinks
          ? data.submittedLinks.map((link) => ({ ...link, tries: 0 }))
          : [],
        searchLinkPattern: data.searchLinkPattern
          ? new RegExp(data.searchLinkPattern.replace(/^\/|\/[gimy]*$/g, ""))
          : this.getSearchLinkPattern(),
      };

      this.log("✅ Ashby search data initialized:", this.searchData);
      this.statusOverlay.addSuccess("Search initialization complete");

      // Start the search process after initialization
      setTimeout(() => this.searchNext(), 1000);
    } catch (error) {
      this.log("❌ Error processing search task data:", error);
      this.statusOverlay.addError(
        "Error processing search task data: " + error.message
      );
    }
  }

  processSendCvTaskData(data) {
    try {
      console.log("📊 Processing send CV task data:", {
        hasData: !!data,
        hasProfile: !!data?.profile,
      });

      if (data?.profile && !this.userProfile) {
        this.userProfile = data.profile;
        console.log("👤 User profile set from background response");
      }

      // Update form handler
      if (this.formHandler && this.userProfile) {
        this.formHandler.userData = this.userProfile;
      }

      this.statusOverlay.addSuccess("Apply initialization complete");
    } catch (error) {
      console.error("❌ Error processing send CV task data:", error);
      this.statusOverlay.addError("Error processing CV data: " + error.message);
    }
  }

  handleApplicationTaskData(data) {
    try {
      this.log("📊 Processing Ashby application task data:", data);

      if (data?.profile && !this.userProfile) {
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
    this.log("🎯 Ashby application starting:", data);
    this.applicationState.isApplicationInProgress = true;
    this.applicationState.applicationStartTime = Date.now();
    this.statusOverlay.addInfo("Application starting...");
  }

  handleApplicationStatus(data) {
    this.log("📊 Ashby application status:", data);

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

  // ========================================
  // ASHBY-SPECIFIC PAGE TYPE DETECTION
  // ========================================

  async detectPageTypeAndStart() {
    const url = window.location.href;
    this.log(`🔍 Detecting page type for: ${url}`);

    if (url.includes("google.com/search")) {
      this.log("📊 Google search page detected");
      this.statusOverlay.addInfo("Google search page detected");
      await this.startSearchProcess();
    } else if (this.isValidJobPage(url)) {
      this.log("📋 Ashby job page detected");
      this.statusOverlay.addInfo("Ashby job page detected");
      await this.startApplicationProcess();
    } else {
      this.log("❓ Unknown page type, waiting for navigation");
      await this.waitForValidPage();
    }
  }

  // ========================================
  // ASHBY-SPECIFIC SEARCH LOGIC
  // ========================================

  async startSearchProcess() {
    try {
      // Prevent duplicate search process starts
      if (this.searchProcessStarted) {
        this.log("⚠️ Search process already started, ignoring duplicate");
        return;
      }

      this.searchProcessStarted = true;
      this.statusOverlay.addInfo("Starting job search process");
      this.statusOverlay.updateStatus("searching");

      // Get search task data from background
      await this.fetchSearchTaskData();
    } catch (error) {
      this.searchProcessStarted = false; // Reset on error
      this.reportError(error, { phase: "search" });
    }
  }

  async fetchSearchTaskData() {
    this.log("📡 Fetching Ashby search task data from background");
    this.statusOverlay.addInfo("Fetching search task data...");

    const success = this.safeSendPortMessage({ type: "GET_SEARCH_TASK" });
    if (!success) {
      throw new Error("Failed to request search task data");
    }
  }

  // ========================================
  // ASHBY-SPECIFIC APPLICATION LOGIC
  // ========================================

  async startApplicationProcess() {
    try {
      console.log("📝 Starting Ashby application process");
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
        console.log("✅ User profile available for Ashby");
      }

      // Wait for page to fully load
      await this.wait(3000);

      // Start application
      await this.apply();
    } catch (error) {
      this.reportError(error, { phase: "application" });
      this.handleApplicationError(error);
    }
  }

  handleApplicationError(error) {
    if (error.name === "SkipApplicationError") {
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

  async fetchApplicationTaskData() {
    this.log("📡 Fetching Ashby application task data from background");
    this.statusOverlay.addInfo("Fetching application data...");

    const success = this.safeSendPortMessage({ type: "GET_SEND_CV_TASK" });
    if (!success) {
      throw new Error("Failed to request application task data");
    }
  }

  // ========================================
  // ASHBY-SPECIFIC FORM HANDLING
  // ========================================

  async apply() {
    try {
      this.statusOverlay.addInfo("Starting to apply for Ashby job");

      // Check if page is valid
      if (this.hasPageErrors()) {
        throw new SkipApplicationError(
          "Cannot start application: Page error or job no longer available"
        );
      }

      // Extract job ID from URL (Ashby-specific)
      const jobId = UrlUtils.extractJobId(window.location.href, "ashby");
      console.log("Extracted Ashby job ID:", jobId);

      // Wait for page to fully load
      await this.wait(3000);

      // Check if we're on a job details page or application form page
      const applyButton = document.querySelector(
        'button[type="submit"], button.submit-button, .apply-button, [data-testid="apply-button"]'
      );
      if (applyButton) {
        this.statusOverlay.addInfo("Found apply button, clicking it");
        applyButton.click();
        await this.wait(3000);
      }

      // Find application form
      const form = this.findApplicationForm();
      if (!form) {
        throw new SkipApplicationError("Cannot find Ashby application form");
      }

      // Extract job description
      const jobDescription = this.extractJobDescription();

      // Process the form
      const result = await this.processApplicationForm(
        form,
        this.userProfile,
        jobDescription
      );

      if (result) {
        await this.handleSuccessfulApplication(jobId);
      }

      return result;
    } catch (error) {
      if (error instanceof SkipApplicationError) {
        throw error;
      } else {
        console.error("Error in Ashby apply:", error);
        throw new ApplicationError(
          "Error during application process: " + this.errorToString(error)
        );
      }
    }
  }

  async handleSuccessfulApplication(jobId) {
    // Get job details from page
    const jobTitle =
      DomUtils.extractText(["h1", ".job-title", "[data-testid='job-title']"]) ||
      document.title.split(" - ")[0] ||
      "Job on Ashby";
    const companyName =
      UrlUtils.extractCompanyFromUrl(window.location.href, "ashby") ||
      "Company on Ashby";
    const location =
      DomUtils.extractText([
        ".job-location",
        ".location",
        "[data-testid='location']",
      ]) || "Not specified";

    // Send completion message using Ashby-specific message type
    this.safeSendPortMessage({
      type: "SEND_CV_TASK_DONE",
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

    console.log("Ashby application completed successfully");
    this.statusOverlay.addSuccess("Application completed successfully");
    this.statusOverlay.updateStatus("success");
  }

  async processApplicationForm(form, profile, jobDescription) {
    this.statusOverlay.addInfo(
      "Found Ashby application form, beginning to fill out"
    );

    try {
      // Initialize/update form handler
      if (!this.formHandler) {
        this.formHandler = new AshbyFormHandler({
          logger: (message) => this.statusOverlay.addInfo(message),
          host: this.getApiHost(),
          userData: profile,
          jobDescription,
        });
      } else {
        this.formHandler.userData = profile;
        this.formHandler.jobDescription = jobDescription;
      }

      // Handle file uploads (resume)
      await this.fileHandler.handleFileUploads(form, profile, jobDescription);

      // Fill out form fields using AI-enhanced AshbyFormHandler
      await this.formHandler.fillFormWithProfile(form, profile);

      // Handle required checkboxes
      await this.formHandler.handleRequiredCheckboxes(form);

      // Submit the form
      return await this.formHandler.submitForm(form);
    } catch (error) {
      console.error("Error processing Ashby application form:", error);
      this.statusOverlay.addError(
        "Error processing form: " + this.errorToString(error)
      );
      return false;
    }
  }

  // ========================================
  // ASHBY-SPECIFIC UTILITY METHODS
  // ========================================

  findApplicationForm() {
    // Ashby-specific form selectors
    const ashbySelectors = [
      "form.application-form",
      "form#application-form",
      'form[data-testid="application-form"]',
      'form[action*="apply"]',
      ".application-form form",
      "form[role='form']",
    ];

    return DomUtils.findForm(ashbySelectors);
  }

  extractJobDescription() {
    const ashbyDescriptionSelectors = [
      ".job-description",
      ".description",
      ".job-posting-description",
      "[data-testid='job-description']",
      ".job-details",
      ".content",
    ];

    let description = DomUtils.extractText(ashbyDescriptionSelectors);

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
        UrlUtils.extractCompanyFromUrl(window.location.href, "ashby") || "";
      description = `Job: ${jobTitle} at ${companyName}`;
    }

    return description;
  }

  hasPageErrors() {
    return (
      document.body.innerText.includes("Cannot GET") ||
      document.body.innerText.includes("404 Not Found") ||
      document.body.innerText.includes("Job is no longer available") ||
      document.body.innerText.includes("Position Closed") ||
      document.body.innerText.includes("This job posting has expired")
    );
  }

  async waitForValidPage(timeout = 30000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const url = window.location.href;

      if (url.includes("google.com/search") || this.isValidJobPage(url)) {
        await this.detectPageTypeAndStart();
        return;
      }

      await this.delay(1000);
    }

    throw new Error("Timeout waiting for valid Ashby page");
  }

  errorToString(e) {
    if (e instanceof Error) {
      return e.stack || e.message;
    }
    return String(e);
  }

  // Override URL normalization for Ashby-specific needs
  platformSpecificUrlNormalization(url) {
    // Remove /apply suffix for Ashby URLs
    return url.replace(/\/apply$/, "");
  }

  // ========================================
  // CLEANUP - Inherited from base class with Ashby-specific additions
  // ========================================

  cleanup() {
    // Base class handles most cleanup
    super.cleanup();

    // Ashby-specific cleanup if needed
    this.log("🧹 Ashby-specific cleanup completed");
  }
}
