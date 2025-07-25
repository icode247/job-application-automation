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

  /**
   * Check if we're on the application page
   */
  isApplicationPage(url) {
    return url.includes("/application") || super.isApplicationPage(url);
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
      await this.startSearchProcess();
    } else if (this.isValidJobPage(url)) {
      await this.startApplicationProcess();
    } else {
      // Skip to next job instead of waiting for valid page
      this.log("⚠️ Not a valid job page, skipping to next job");
      this.skipToNextJob("Not a valid job page");
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
      this.statusOverlay.addInfo("Starting application process");
      this.statusOverlay.updateStatus("applying");

      // Validate user profile
      if (!this.userProfile) {
        await this.fetchApplicationTaskData();
      }

      if (!this.userProfile) {
        this.statusOverlay.addError(
          "No user profile available - automation may fail"
        );
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
      this.skipToNextJob(error.message);
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
  /**
   * Wait for URL to change and contain expected path
   */
  async waitForUrlChange(originalUrl, expectedPath, timeout = 10000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      await this.wait(500);

      const currentUrl = window.location.href;

      // Check if URL changed and contains expected path
      if (currentUrl !== originalUrl && currentUrl.includes(expectedPath)) {
        return true;
      }
    }

    console.warn(
      `⚠️ URL did not change to contain '${expectedPath}' within ${timeout}ms`
    );
    return false;
  }

  /**
   * Navigate to the Application tab
   */
  async navigateToApplicationTab() {
    try {
      // Find the Application tab using multiple selectors
      const applicationTab =
        document.querySelector("#job-application-form") ||
        document.querySelector('a[href*="/application"]') ||
        document
          .querySelector(".ashby-job-posting-right-pane-application-tab")
          ?.closest("a") ||
        Array.from(document.querySelectorAll('a[role="tab"]')).find((tab) =>
          tab.textContent.toLowerCase().includes("application")
        );

      if (!applicationTab) {
        return false;
      }

      // Get current URL to detect navigation
      const currentUrl = window.location.href;

      // Click the Application tab
      applicationTab.click();

      // Wait for navigation to complete
      const navigationSuccess = await this.waitForUrlChange(
        currentUrl,
        "/application",
        10000
      );

      if (!navigationSuccess) {
        // Give it a bit more time and continue
        await this.wait(2000);
      }

      return true;
    } catch (error) {
      console.error("Error navigating to Application tab:", error);
      return false;
    }
  }

  async apply() {
    try {
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

      // Extract job description from Overview tab (current page)
      const jobDescription = this.extractJobDescription();

      // Navigate to Application tab
      const applicationTabNavigated = await this.navigateToApplicationTab();
      if (!applicationTabNavigated) {
        throw new SkipApplicationError(
          "Cannot find or navigate to Application tab"
        );
      }

      this.statusOverlay.addInfo("Successfully navigated to Application tab");

      // Wait for application page to load
      await this.wait(2000);

      // Find application form
      const form = this.findApplicationForm();
      if (!form) {
        throw new SkipApplicationError("Cannot find Ashby application form");
      }

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

    const jobData = {
      jobId,
      title: jobTitle,
      company: companyName,
      location,
      jobUrl: window.location.href,
      salary: "Not specified",
      workplace: "Not specified",
      postedDate: "Not specified",
      applicants: "Not specified",
      platform: this.platform,
      appliedAt: new Date().toISOString(),
      status: "applied",
    };

    // Save job using ApplicationTrackerService
    try {
      await this.applicationTracker.saveJob(jobData);
      this.log("✅ Job saved to application tracker");
    } catch (error) {
      this.log("❌ Failed to save job to tracker:", error);
    }

    // Send completion message using Ashby-specific message type
    this.safeSendPortMessage({
      type: "SEND_CV_TASK_DONE",
      data: jobData,
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
      await this.formHandler.fillFormWithProfile(profile);

      // Submit the form
      const submitResult = await this.formHandler.submitAndVerify();

      // Check for success/error messages after submission
      await this.wait(2000); // Wait for any messages to appear

      const submissionStatus = this.checkSubmissionStatus();

      if (submissionStatus.isSuccess) {
        this.statusOverlay.addSuccess("Application submitted successfully!");
        return true;
      } else if (submissionStatus.hasErrors) {
        this.statusOverlay.addWarning(
          `Application submitted with errors: ${submissionStatus.errors.join(
            ", "
          )}`
        );
        // Still consider it a successful submission, just with warnings
        return true;
      } else if (submissionStatus.hasFailure) {
        this.statusOverlay.addError(
          `Application submission failed: ${submissionStatus.failureMessage}`
        );
        throw new SkipApplicationError(
          `Submission failed: ${submissionStatus.failureMessage}`
        );
      }

      return submitResult;
    } catch (error) {
      console.error("Error processing Ashby application form:", error);
      this.statusOverlay.addError(
        "Error processing form: " + this.errorToString(error)
      );
      return false;
    }
  }

  /**
   * Check for success/error messages after form submission
   */
  checkSubmissionStatus() {
    const status = {
      isSuccess: false,
      hasErrors: false,
      hasFailure: false,
      errors: [],
      failureMessage: "",
    };

    // Check for success message
    const successContainer = document.querySelector(
      ".ashby-application-form-success-container"
    );
    if (successContainer && this.isElementVisible(successContainer)) {
      status.isSuccess = true;
      this.log("✅ Found success message after form submission");
    }

    // Check for error list
    const errorsList = document.querySelector("ul._errors_oj0x8_78");
    if (errorsList && this.isElementVisible(errorsList)) {
      status.hasErrors = true;
      const errorItems = errorsList.querySelectorAll("li._error_oj0x8_78 p");
      status.errors = Array.from(errorItems).map((item) =>
        item.textContent.trim()
      );
      this.log("⚠️ Found error messages after form submission:", status.errors);
    }

    // Check for other failure indicators
    const failureSelectors = [
      ".error-message",
      ".submission-failed",
      ".form-error",
      '[data-testid="error"]',
    ];

    for (const selector of failureSelectors) {
      const failureElement = document.querySelector(selector);
      if (failureElement && this.isElementVisible(failureElement)) {
        status.hasFailure = true;
        status.failureMessage = failureElement.textContent.trim();
        this.log(
          "❌ Found failure message after form submission:",
          status.failureMessage
        );
        break;
      }
    }

    return status;
  }

  /**
   * Skip to next job with reason
   */
  skipToNextJob(reason) {
    this.log(`⏭️ Skipping to next job: ${reason}`);
    this.statusOverlay.addWarning(`Skipping job: ${reason}`);

    this.safeSendPortMessage({
      type: "SEND_CV_TASK_SKIP",
      data: reason,
    });

    // Reset application state
    this.applicationState.isApplicationInProgress = false;
    this.applicationState.applicationStartTime = null;
  }

  // ========================================
  // ASHBY-SPECIFIC UTILITY METHODS
  // ========================================

  /**
   * Check if element is visible - Ashby specific
   */
  isElementVisible(element) {
    if (!element) return false;

    try {
      const style = window.getComputedStyle(element);
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        element.offsetParent !== null
      );
    } catch (error) {
      return true; // Default to true on error
    }
  }

  /**
   * Find Ashby application form
   */
  findApplicationForm() {
    // Ashby-specific form selectors
    const ashbySelectors = [
      "._jobPostingForm_oj0x8_399",
      ".ashby-application-form-container",
      ".ashby-application-form",
      'form[class*="ashby"]',
      'div[class*="jobPostingForm"]',
    ];

    // Try Ashby-specific selectors first
    for (const selector of ashbySelectors) {
      const formContainer = document.querySelector(selector);
      if (formContainer && this.isElementVisible(formContainer)) {
        return formContainer;
      }
    }

    // Fallback to generic form detection
    return DomUtils.findForm([]);
  }

  /**
   * Enhanced job description extraction from Overview tab
   */
  extractJobDescription() {
    // Ashby-specific description selectors for Overview tab
    const ashbyDescriptionSelectors = [
      ".ashby-job-posting-overview",
      ".job-description",
      ".description",
      ".job-posting-description",
      '[data-testid="job-description"]',
      ".job-details",
      ".content",
      ".ashby-job-posting-content",
      // More specific Ashby selectors
      ".ashby-job-posting-overview-section",
      ".overview-content",
    ];

    let description = DomUtils.extractText(ashbyDescriptionSelectors);

    // If no description found with specific selectors, try broader approach
    if (!description) {
      // Look for the overview tab content specifically
      const overviewTab =
        document.querySelector("#overview") ||
        document
          .querySelector('[aria-controls="overview"]')
          ?.getAttribute("aria-controls");

      if (overviewTab) {
        const overviewContent = document.getElementById(overviewTab);
        if (overviewContent) {
          description = overviewContent.textContent.trim();
        }
      }
    }

    // Fallback to main content area
    if (!description) {
      const mainContent = document.querySelector(
        "main, #content, .content, .job-content, .ashby-job-posting"
      );
      if (mainContent) {
        description = mainContent.textContent.trim();
      }
    }

    // Final fallback using job title and company
    if (!description) {
      const jobTitle = document.title || "";
      const companyName =
        UrlUtils.extractCompanyFromUrl(window.location.href, "ashby") || "";
      description = `Job: ${jobTitle} at ${companyName}`;
    }

    console.log(
      `📋 Extracted job description (${description.length} characters)`
    );
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
