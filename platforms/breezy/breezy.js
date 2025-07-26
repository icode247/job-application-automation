// platforms/breezy/breezy.js
import BasePlatformAutomation from "../../shared/base/base-platform-automation.js";
import { BreezyFormHandler } from "./breezy-form-handler.js";
import { BreezyFileHandler } from "./breezy-file-handler.js";
import { UrlUtils, DomUtils } from "../../shared/utilities/index.js";
import {
  AIService,
  ApplicationTrackerService,
  UserService,
} from "../../services/index.js";

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

export default class BreezyPlatform extends BasePlatformAutomation {
  constructor(config) {
    super(config);
    this.platform = "breezy";
    this.baseUrl = "https://breezy.hr";

    // Initialize Breezy-specific services
    this.aiService = new AIService({ apiHost: this.getApiHost() });
    this.applicationTracker = new ApplicationTrackerService({
      userId: this.userId,
    });
    this.userService = new UserService({ userId: this.userId });

    this.fileHandler = null;
    this.formHandler = null;
  }

  // ========================================
  // PLATFORM-SPECIFIC IMPLEMENTATIONS (Required by base class)
  // ========================================

  getPlatformDomains() {
    return ["breezy.hr", "app.breezy.hr"];
  }

  getSearchLinkPattern() {
    return /^https:\/\/([\w-]+\.breezy\.hr\/p\/|app\.breezy\.hr\/jobs\/)([^\/]+)\/?.*$/;
  }

  isValidJobPage(url) {
    return url.includes("breezy.hr/p/") || url.includes("app.breezy.hr/jobs/");
  }

  async setSessionContext(sessionContext) {
    try {
      this.sessionContext = sessionContext;
      this.hasSessionContext = true;

      // Update basic properties
      if (sessionContext.sessionId) this.sessionId = sessionContext.sessionId;
      if (sessionContext.platform) this.platform = sessionContext.platform;
      if (sessionContext.userId) this.userId = sessionContext.userId;

      // Set user profile with priority handling - follow Recruitee pattern
      if (sessionContext.userProfile) {
        if (!this.userProfile || Object.keys(this.userProfile).length === 0) {
          this.userProfile = sessionContext.userProfile;
          this.log("👤 User profile loaded from session context");
        } else {
          // Merge profiles, preferring non-null values
          this.userProfile = {
            ...this.userProfile,
            ...sessionContext.userProfile,
          };
          this.log("👤 User profile merged with session context");
        }
      }

      // Fetch user profile if still missing
      if (!this.userProfile && this.userId) {
        try {
          this.log("📡 Fetching user profile from user service...");
          this.userProfile = await this.userService.getUserDetails();
          this.log("✅ User profile fetched successfully");
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

      // Update AI service with correct API host
      this.aiService = new AIService({ apiHost: this.getApiHost() });

      // Update form handler if it exists - follow Recruitee pattern
      if (this.formHandler && this.userProfile) {
        this.formHandler.userData = this.userProfile;
      }

      this.log("✅ Breezy session context set successfully", {
        hasUserProfile: !!this.userProfile,
        userId: this.userId,
        sessionId: this.sessionId,
        profileName: this.userProfile?.name || this.userProfile?.firstName,
        profileEmail: this.userProfile?.email,
      });
    } catch (error) {
      console.error("❌ Error setting Breezy session context:", error);
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
      this.log("▶️ Starting Breezy automation");

      // Ensure user profile is available before starting
      if (!this.userProfile && this.userId) {
        try {
          this.log("🔄 Attempting to fetch user profile during start...");
          this.userProfile = await this.userService.getUserDetails();
          this.log("✅ User profile fetched during start");
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
    return this.sessionApiHost || this.sessionContext?.apiHost || this.config.apiHost;
  }

  isApplicationPage(url) {
    return this.isValidJobPage(url);
  }

  getJobTaskMessageType() {
    return "SEND_CV_TASK";
  }

  // ========================================
  // BREEZY-SPECIFIC INITIALIZATION
  // ========================================

  async initialize() {
    await super.initialize(); // Handles all common initialization

    // Initialize Breezy-specific handlers
    this.fileHandler = new BreezyFileHandler({
      statusService: this.statusOverlay,
      apiHost: this.getApiHost(),
    });

    // Initialize form handler following Recruitee pattern
    this.formHandler = new BreezyFormHandler(
      this.aiService,
      this.userProfile || {},
      (message) => this.statusOverlay.addInfo(message)
    );

    this.statusOverlay.addSuccess("Breezy-specific components initialized");
  }

  // ========================================
  // BREEZY-SPECIFIC MESSAGE HANDLING
  // ========================================

  // ✅ FIX: Handle SUCCESS messages from background script
  handleSuccessMessage(data) {
    this.log("📊 Processing SUCCESS message:", data);

    // Determine message type based on data content
    if (data && data.submittedLinks !== undefined) {
      // This is search task data (has submittedLinks array)
      this.handleSearchTaskData(data);
    } else if (data && data.profile !== undefined) {
      // This is application task data (has profile object)
      this.handleApplicationTaskData(data);
    } else if (!data || Object.keys(data).length === 0) {
      // Empty response - automation session not ready yet

      // Don't retry immediately, just wait for the next attempt
      setTimeout(() => {
        if (window.location.href.includes("google.com/search")) {
          this.log("Retrying search initialization...");
          this.startSearchProcess();
        }
      }, 3000);
    } else {
      // Generic success acknowledgment
      this.statusOverlay.addInfo("Background operation completed successfully");
    }
  }

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

      default:
        super.handlePlatformSpecificMessage(type, data);
    }
  }

  // ✅ FIX: Simplified handleSearchTaskData following Recruitee pattern
  handleSearchTaskData(data) {
    try {
      this.log("📊 Processing Breezy search task data:", data);

      if (!data) {
        this.log("⚠️ No search task data provided");
        this.statusOverlay.addWarning("No search task data available");
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

        // Update form handler with user profile
        if (this.formHandler) {
          this.formHandler.userData = this.userProfile;
        }
      }

      this.log("✅ Breezy search data initialized:", this.searchData);
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
      this.log("📊 Processing Breezy application task data:", data);

      if (data?.profile && !this.userProfile) {
        this.userProfile = data.profile;
        this.log("👤 User profile loaded from application task data");
      }

      // Update form handler following Recruitee pattern
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
    this.log("🎯 Breezy application starting:", data);
    this.applicationState.isApplicationInProgress = true;
    this.applicationState.applicationStartTime = Date.now();
    this.statusOverlay.addInfo("Application starting...");
  }

  handleApplicationStatus(data) {
    this.log("📊 Breezy application status:", data);

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
  // BREEZY-SPECIFIC PAGE TYPE DETECTION
  // ========================================

  async detectPageTypeAndStart() {
    const url = window.location.href;
    this.log(`🔍 Detecting page type for: ${url}`);

    if (url.includes("google.com/search")) {
      this.log("📊 Google search page detected");
      await this.startSearchProcess();
    } else if (this.isValidJobPage(url)) {
      this.log("📋 Breezy job page detected");
      await this.startApplicationProcess();
    } else {
      this.log("❓ Unknown page type, waiting for navigation");
      await this.waitForValidPage();
    }
  }

  // ========================================
  // BREEZY-SPECIFIC SEARCH LOGIC
  // ========================================

  async startSearchProcess() {
    try {
      this.statusOverlay.addInfo("Starting job search process");
      this.statusOverlay.updateStatus("searching");

      // ✅ FIX: Add a small delay to ensure automation session is ready
      await this.wait(2000);

      // Get search task data from background
      await this.fetchSearchTaskData();
    } catch (error) {
      this.reportError(error, { phase: "search" });
    }
  }

  // ✅ FIX: Simplified fetchSearchTaskData following Recruitee pattern
  async fetchSearchTaskData() {
    this.log("📡 Fetching Breezy search task data from background");
    this.statusOverlay.addInfo("Fetching search task data...");

    const success = this.safeSendPortMessage({ type: "GET_SEARCH_TASK" });
    if (!success) {
      throw new Error("Failed to request search task data");
    }
  }

  // ========================================
  // BREEZY-SPECIFIC APPLICATION LOGIC
  // ========================================

  async startApplicationProcess() {
    try {
      this.log("📝 Starting Breezy application process");
      this.statusOverlay.addInfo("Starting application process");
      this.statusOverlay.updateStatus("applying");

      // Validate user profile - follow Recruitee pattern
      if (!this.userProfile) {
        this.log("⚠️ No user profile available, attempting to fetch...");
        await this.fetchApplicationTaskData();
      }

      if (!this.userProfile) {
        this.statusOverlay.addError(
          "No user profile available - automation may fail"
        );
        console.error("❌ Failed to obtain user profile");
      } else {
        this.statusOverlay.addSuccess("User profile loaded successfully");
        this.log("✅ User profile available for Breezy");
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
    this.log("📡 Fetching Breezy application task data from background");
    this.statusOverlay.addInfo("Fetching application data...");

    const success = this.safeSendPortMessage({ type: "GET_SEND_CV_TASK" });
    if (!success) {
      throw new Error("Failed to request application task data");
    }
  }

  // ========================================
  // BREEZY-SPECIFIC FORM HANDLING
  // ========================================

  async apply() {
    try {
      this.statusOverlay.addInfo("Starting to apply for Breezy job");

      // Check if page is valid
      if (this.hasPageErrors()) {
        throw new SkipApplicationError(
          "Cannot start application: Page error or job no longer available"
        );
      }

      // Extract job ID from URL (Breezy-specific)
      const jobId = UrlUtils.extractJobId(window.location.href, "breezy");
      this.log("Extracted Breezy job ID:", jobId);

      // Wait for page to fully load
      await this.wait(3000);

      // ✅ FIX: Only look for apply button if NOT already on application page
      const currentUrl = window.location.href;
      const isAlreadyOnApplicationPage =
        currentUrl.includes("/apply") &&
        (currentUrl.includes("/p/") || currentUrl.includes("/jobs/"));

      if (!isAlreadyOnApplicationPage) {
        // Check if we're on a job details page or application form page
        const applyButton = document.querySelector(
          'button[data-ui="submit-application"], button.btn-primary, a.apply-button, button.apply-button, a.apply, a.button.apply, a[href*="/apply"]:not([href*="linkedin"])'
        );
        if (applyButton) {
          this.statusOverlay.addInfo("Found apply button, clicking it");
          applyButton.click();
          await this.wait(3000);
        }
      }

      // Find application form
      const form = this.findApplicationForm();
      this.log("Found form:", form);
      if (!form) {
        throw new SkipApplicationError("Cannot find Breezy application form");
      }

      // Extract job description
      const jobDescription = this.extractJobDescription();
      this.log("Job description:", jobDescription);

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
        console.error("Error in Breezy apply:", error);
        throw new ApplicationError(
          "Error during application process: " + this.errorToString(error)
        );
      }
    }
  }

  async handleSuccessfulApplication(jobId) {
    // Get job details from page
    const jobTitle =
      DomUtils.extractText(["h1"]) ||
      document.title.split(" - ")[0] ||
      "Job on Breezy";
    const companyName =
      UrlUtils.extractCompanyFromUrl(window.location.href, "breezy") ||
      "Company on Breezy";
    const location =
      DomUtils.extractText([
        ".job-location",
        ".location",
        '[data-ui="location"]',
      ]) || "Not specified";

    // Send completion message using Breezy-specific message type
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

    this.statusOverlay.addSuccess("Application completed successfully");
    this.statusOverlay.updateStatus("success");
  }

  async processApplicationForm(form, profile, jobDescription) {
    this.statusOverlay.addInfo(
      "Found Breezy application form, beginning to fill out"
    );

    try {
      // ✅ FIX: Ensure form handler has current user data and job description
      if (!this.formHandler) {
        this.formHandler = new BreezyFormHandler(
          this.aiService,
          profile,
          (message) => this.statusOverlay.addInfo(message)
        );
      } else {
        // Update existing form handler with current data
        this.formHandler.userData = profile;
        this.formHandler.jobDescription = jobDescription;
      }

      // Handle file uploads (resume)
      await this.fileHandler.handleFileUploads(form, profile, jobDescription);

      // Fill out form fields using AI-enhanced BreezyFormHandler
      await this.formHandler.fillFormWithProfile(form, profile);

      // Handle required checkboxes
      await this.formHandler.handleRequiredCheckboxes(form);

      // Submit the form
      return await this.formHandler.submitForm(form);
    } catch (error) {
      console.error("Error processing Breezy application form:", error);
      this.statusOverlay.addError(
        "Error processing form: " + this.errorToString(error)
      );
      return false;
    }
  }

  // ========================================
  // BREEZY-SPECIFIC UTILITY METHODS
  // ========================================

  findApplicationForm() {
    // Breezy-specific form selectors
    const breezySelectors = [
      "form.application-form",
      "form#application-form",
      'form[action*="apply"]',
      'form[action*="positions"]',
      ".application-form form",
      "#application form",
    ];

    return DomUtils.findForm(breezySelectors);
  }

  extractJobDescription() {
    const breezyDescriptionSelectors = [
      ".job-description",
      ".description",
      ".position-description",
      "#job-description",
      ".job-details",
      ".position",
    ];

    let description = DomUtils.extractText(breezyDescriptionSelectors);

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
        UrlUtils.extractCompanyFromUrl(window.location.href, "breezy") || "";
      description = `Job: ${jobTitle} at ${companyName}`;
    }

    return description;
  }

  hasPageErrors() {
    return (
      document.body.innerText.includes("Cannot GET") ||
      document.body.innerText.includes("404 Not Found") ||
      document.body.innerText.includes("Job is no longer available") ||
      document.body.innerText.includes("Position Closed")
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

    throw new Error("Timeout waiting for valid Breezy page");
  }

  errorToString(e) {
    if (e instanceof Error) {
      return e.stack || e.message;
    }
    return String(e);
  }

  // Override URL normalization for Breezy-specific needs
  platformSpecificUrlNormalization(url) {
    // Remove /apply suffix for Breezy URLs
    return url.replace(/\/apply$/, "");
  }

  // ========================================
  // CLEANUP - Inherited from base class with Breezy-specific additions
  // ========================================

  cleanup() {
    // Base class handles most cleanup
    super.cleanup();

    // Breezy-specific cleanup if needed
    this.log("🧹 Breezy-specific cleanup completed");
  }
}
