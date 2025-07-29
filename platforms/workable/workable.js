// platforms/workable/workable.js
import BasePlatformAutomation from "../../shared/base/base-platform-automation.js";
import WorkableFormHandler from "./workable-form-handler.js";
import WorkableFileHandler from "./workable-file-handler.js";
import { UrlUtils, DomUtils } from "../../shared/utilities/index.js";
import {
  AIService,
  ApplicationTrackerService,
  UserService,
  StateManagerService,
} from "../../services/index.js";
import Utils from "../../utils/utils.js";

export default class WorkablePlatform extends BasePlatformAutomation {
  constructor(config) {
    super(config);
    this.platform = "workable";
    this.baseUrl = "https://apply.workable.com";

    // Initialize services using existing service classes
    this.aiService = new AIService({ apiHost: this.getApiHost() });
    this.applicationTracker = new ApplicationTrackerService({
      userId: this.userProfile.userId,
      apiHost: this.getApiHost(),
    });
    this.userService = new UserService({ userId: this.userProfile.userId });
    this.stateManager = new StateManagerService({
      sessionId: this.sessionId,
      storageKey: `workable_automation_${this.sessionId || "default"}`,
    });

    this.fileHandler = null;
    this.formHandler = null;
    this.cachedJobDescription = null;

    // Debounce timers for preventing rapid-fire calls
    this.debounceTimers = {};
  }

  // ========================================
  // REQUIRED ABSTRACT METHOD IMPLEMENTATIONS
  // ========================================

  getPlatformDomains() {
    return ["workable.com"];
  }

  getSearchLinkPattern() {
    return /^https:\/\/([\w-]+)\.workable\.com\/(j|jobs)\/([^\/]+)\/?.*$/;
  }

  isValidJobPage(url) {
    return /^https:\/\/apply\.workable\.com\/[^\/]+\/(j|jobs)\/([^\/]+)/.test(
      url
    );
  }

  isApplicationPage(url) {
    return url.includes("/apply/") || url.includes("/application");
  }

  getApiHost() {
    return this.sessionApiHost || this.sessionContext?.apiHost || this.config.apiHost;
  }

  getJobTaskMessageType() {
    return "START_APPLICATION";
  }

  /**
   * Platform-specific URL normalization using Utils
   */
  platformSpecificUrlNormalization(url) {
    // Use Utils.normalizeUrl and then remove /apply suffix
    const normalized = Utils.normalizeUrl(url);
    return normalized.replace(/\/apply\/?$/, "");
  }

  // ========================================
  // INITIALIZATION AND SETUP
  // ========================================

  async initialize() {
    await super.initialize(); // Handles all common initialization

    // Initialize Workable-specific handlers
    this.fileHandler = new WorkableFileHandler({
      statusService: this.statusOverlay,
      apiHost: this.getApiHost(),
    });

    this.formHandler = new WorkableFormHandler({
      logger: (message) => this.statusOverlay.addInfo(message),
      host: this.getApiHost(),
      userData: this.userProfile || {},
      jobDescription: "",
    });

    // Initialize state
    await this.stateManager.initializeState({
      userId: this.userId,
      sessionId: this.sessionId,
      platform: "workable",
      isProcessing: false,
    });

    this.statusOverlay.addSuccess("Workable-specific components initialized");
  }

  /**
   * Handle duplicate job detection
   */
  handleDuplicate(data) {
    try {
      this.log("Duplicate job detected:", data);

      // Reset application state using StateManager
      this.resetApplicationState();

      this.statusOverlay.addInfo(
        "Job already processed: " + (data?.url || "Unknown URL")
      );
      this.statusOverlay.updateStatus("ready");

      // Continue search after a short delay
      this.debounce("searchNext", () => this.searchNext(), 1000);
    } catch (error) {
      this.log("❌ Error handling duplicate:", error);
      this.statusOverlay.addError("Error handling duplicate: " + error.message);
    }
  }

  async start(params = {}) {
    try {
      this.isRunning = true;
      this.log("🚀 Starting Workable automation");
      this.statusOverlay.addInfo("Starting Workable automation");

      // Ensure user profile using UserService
      await this.ensureUserProfile();

      // Update config with parameters
      this.config = { ...this.config, ...params };

      // Wait for page to be ready
      await Utils.waitForElement("body", 5000);

      // Detect page type and start appropriate automation
      await this.detectPageTypeAndStart();
    } catch (error) {
      this.reportError(error, { phase: "start" });
    }
  }

  /**
   * Ensure user profile is available using UserService
   */
  async ensureUserProfile() {
    if (!this.userProfile && this.userId && this.userService) {
      try {
        this.log("🔄 Fetching user profile using UserService...");
        this.userProfile = await this.userService.getUserDetails();
        this.log("✅ User profile fetched via UserService");
        this.statusOverlay.addSuccess("User profile loaded");

        // Update form handler with profile
        if (this.formHandler && this.userProfile) {
          this.formHandler.userData = this.userProfile;
        }
      } catch (error) {
        console.error(
          "❌ Failed to fetch user profile via UserService:",
          error
        );
        this.statusOverlay.addWarning(
          "Failed to load user profile - automation may have limited functionality"
        );
      }
    }
  }

  async detectPageTypeAndStart() {
    const url = window.location.href;
    this.log(`🔍 Detecting page type for: ${url}`);

    if (url.includes("google.com/search")) {
      this.log("📊 Google search page detected");
      this.statusOverlay.addInfo("Google search page detected");
      await this.startSearchProcess();
    } else if (this.isApplicationPage(url)) {
      this.log("📋 Workable application page detected");
      this.statusOverlay.addInfo("Workable application page detected");
      await this.startApplicationProcess();
    } else if (this.isValidJobPage(url)) {
      this.log("📋 Workable job overview page detected");
      this.statusOverlay.addInfo(
        "Workable job page detected - navigating to application"
      );
      await this.navigateToApplicationAndStart();
    } else {
      this.log("❓ Unknown page type, skipping to next job");
      this.statusOverlay.addWarning("Unknown page type - skipping to next job");

      // Skip to next job instead of waiting
      if (window.location.href.includes("google.com/search")) {
        this.debounce("searchNext", () => this.searchNext(), 1000);
      } else {
        // If we're not on a search page, try to navigate back or signal completion
        this.safeSendPortMessage({
          type: "APPLICATION_SKIPPED",
          data: "Unknown page type: " + url,
        });
      }
    }
  }

  /**
   * Handle search next event with state management using StateManager
   */
  handleSearchNext(data) {
    try {
      this.log("Handling search next:", data);

      // Reset application state using StateManager
      this.resetApplicationState();

      // Increment processed count using StateManager
      if (this.searchData && this.stateManager) {
        this.stateManager.updateState({
          processedJobs: (this.searchData.current || 0) + 1,
        });
        this.searchData.current++;
      }

      // Acknowledge that we're ready for the next job
      this.safeSendPortMessage({ type: "SEARCH_NEXT_READY" });

      if (!data || !data.url) {
        this.log("No URL data in handleSearchNext");
        this.statusOverlay.addInfo("Job processed, searching next...");
        this.debounce("searchNext", () => this.searchNext(), 1000);
        return;
      }

      const url = data.url;

      // Update visual status based on result
      if (data.status === "SUCCESS") {
        this.statusOverlay.addSuccess("Successfully submitted: " + url);
      } else if (data.status === "ERROR") {
        this.statusOverlay.addError(
          "Error with: " + url + (data.message ? ` - ${data.message}` : "")
        );
      } else {
        this.statusOverlay.addInfo(
          "Skipped: " + url + (data.message ? ` - ${data.message}` : "")
        );
      }

      // Continue search after a delay to prevent rapid firing
      this.debounce("searchNext", () => this.searchNext(), 2000);
    } catch (error) {
      this.log("❌ Error handling search next:", error);
      this.statusOverlay.addError(
        "Error handling search next: " + error.message
      );

      // Reset application state and continue
      this.resetApplicationState();
      this.debounce("searchNext", () => this.searchNext(), 5000);
    }
  }

  /**
   * Reset application state using StateManager
   */
  async resetApplicationState() {
    try {
      // Update StateManager
      if (this.stateManager) {
        await this.stateManager.setProcessingStatus(false);
      }

      // Reset local state
      this.applicationState.isApplicationInProgress = false;
      this.applicationState.applicationStartTime = null;
    } catch (error) {
      console.error("Error resetting application state:", error);
    }
  }

  async navigateToApplicationAndStart() {
    try {
      // Extract job description from overview page first
      const jobDescription = await this.extractJobDescription();
      this.cachedJobDescription = jobDescription;

      // Navigate to Application tab
      const applicationTabNavigated = await this.navigateToApplicationTab();
      if (!applicationTabNavigated) {
        throw new Error("Cannot find or navigate to Application tab");
      }

      this.statusOverlay.addInfo("Successfully navigated to Application tab");

      // Wait for application page to load using Utils
      await Utils.delay(2000);

      // Start application process
      await this.startApplicationProcess();
    } catch (error) {
      this.reportError(error, { phase: "navigation" });
      this.handleApplicationError(error);
    }
  }

  /**
   * Navigate to application tab using Utils for element waiting
   */
  async navigateToApplicationTab() {
    try {
      this.statusOverlay.addInfo("Looking for Application tab...");

      // Use Utils.waitForElement to find the Application tab
      const applicationTab = await Utils.waitForElement(
        'a[data-ui="application-form-tab"], a[href*="/apply/"]',
        5000
      );

      if (!applicationTab) {
        // Try alternative selectors
        const alternativeTab = Array.from(document.querySelectorAll("a")).find(
          (tab) => tab.textContent.toLowerCase().includes("application")
        );

        if (!alternativeTab) {
          this.statusOverlay.addWarning("Application tab not found");
          return false;
        }
      }

      const tabToClick = applicationTab || alternativeTab;
      this.statusOverlay.addInfo("Found Application tab, clicking...");

      // Get current URL to detect navigation
      const currentUrl = window.location.href;

      // Click the Application tab
      tabToClick.click();

      // Wait for navigation to complete
      const navigationSuccess = await this.waitForUrlChange(
        currentUrl,
        "/apply/",
        10000
      );

      if (!navigationSuccess) {
        this.statusOverlay.addWarning(
          "URL did not change to application page, continuing anyway..."
        );
        // Give it a bit more time and continue
        await Utils.delay(2000);
      }

      return true;
    } catch (error) {
      console.error("Error navigating to Application tab:", error);
      this.statusOverlay.addError(
        "Error navigating to Application tab: " + error.message
      );
      return false;
    }
  }

  /**
   * Wait for URL change using Utils.delay
   */
  async waitForUrlChange(originalUrl, expectedPath, timeout = 10000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      await Utils.delay(500);

      const currentUrl = window.location.href;

      // Check if URL changed and contains expected path
      if (currentUrl !== originalUrl && currentUrl.includes(expectedPath)) {
        this.log(`✅ URL changed to: ${currentUrl}`);
        return true;
      }
    }

    console.warn(
      `⚠️ URL did not change to contain '${expectedPath}' within ${timeout}ms`
    );
    return false;
  }

  // ========================================
  // MESSAGE HANDLING
  // ========================================

  handlePlatformSpecificMessage(type, data) {
    switch (type) {
      case "SUCCESS":
        this.handleSuccessMessage(data);
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

      case "PROFILE_DATA":
        this.handleProfileData(data);
        break;

      case "DUPLICATE":
        this.handleDuplicate(data);
        break;

      case "SEARCH_NEXT":
        this.handleSearchNext(data);
        break;

      case "ERROR":
        this.handleError(data);
        break;

      case "CONNECTION_ESTABLISHED":
        this.log("✅ Port connection established");
        break;

      default:
        this.log(`❓ Unhandled Workable message type: ${type}`);
    }
  }

  handleSuccessMessage(data) {
    if (data) {
      if (data.submittedLinks !== undefined) {
        this.processSearchTaskData(data);
      } else if (data.profile !== undefined && !this.userProfile) {
        this.processApplicationTaskData(data);
      }
    }
  }

  /**
   * Handle error messages with automatic recovery
   */
  handleError(message) {
    const errorMessage =
      message.message || "Unknown error from background script";
    this.log("❌ Error from background script:", errorMessage);
    this.statusOverlay.addError("Background error: " + errorMessage);

    // If we're on a search page, continue after a delay
    if (window.location.href.includes("google.com/search")) {
      this.debounce("searchNext", () => this.searchNext(), 5000);
    }
  }

  handleSearchTaskData(data) {
    this.processSearchTaskData(data);
  }

  handleApplicationTaskData(data) {
    this.processApplicationTaskData(data);
  }

  /**
   * Handle application status synchronization using StateManager
   */
  async handleApplicationStatus(data) {
    try {
      this.log("Application status received:", data);

      // Sync with StateManager
      if (this.stateManager && data.inProgress !== undefined) {
        await this.stateManager.setProcessingStatus(data.inProgress);
      }

      // Update local state based on background state
      if (data.inProgress !== this.applicationState.isApplicationInProgress) {
        this.log("Synchronizing application state with background");
        this.applicationState.isApplicationInProgress = data.inProgress;

        if (data.inProgress) {
          this.applicationState.applicationStartTime = Date.now();
          this.statusOverlay.addInfo(
            "Application is in progress according to background"
          );
          this.statusOverlay.updateStatus("applying");
        } else {
          this.applicationState.applicationStartTime = null;
          this.statusOverlay.addInfo(
            "No application in progress according to background"
          );
          this.statusOverlay.updateStatus("ready");

          // Continue search if we're on a search page
          if (window.location.href.includes("google.com/search")) {
            this.debounce("searchNext", () => this.searchNext(), 1000);
          }
        }
      }
    } catch (error) {
      this.log("❌ Error handling application status:", error);
      this.statusOverlay.addError(
        "Error handling application status: " + error.message
      );
    }
  }

  handleApplicationStarting(data) {
    try {
      this.log("Application starting confirmation received:", data);
      this.applicationState.isApplicationInProgress = true;
      this.applicationState.applicationStartTime = Date.now();

      // Update StateManager
      if (this.stateManager) {
        this.stateManager.setProcessingStatus(true);
      }

      this.statusOverlay.addInfo(
        "Application starting for: " + (data?.url || "unknown URL")
      );
    } catch (error) {
      this.log("❌ Error handling application starting:", error);
    }
  }

  handleProfileData(data) {
    try {
      this.log("Profile data received");
      if (data && !this.userProfile) {
        this.userProfile = data;
        if (this.formHandler) {
          this.formHandler.userData = this.userProfile;
        }
      }
    } catch (error) {
      this.log("❌ Error handling profile data:", error);
    }
  }

  // ========================================
  // SEARCH PROCESS
  // ========================================

  async startSearchProcess() {
    try {
      this.statusOverlay.addInfo("Starting job search process");
      this.statusOverlay.updateStatus("searching");
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
        domain: data.domain || this.getPlatformDomains(),
        submittedLinks: data.submittedLinks
          ? data.submittedLinks.map((link) => ({ ...link, tries: 0 }))
          : [],
        searchLinkPattern: data.searchLinkPattern
          ? new RegExp(data.searchLinkPattern.replace(/^\/|\/[gimy]*$/g, ""))
          : this.getSearchLinkPattern(),
      };

      this.log("✅ Search data initialized:", this.searchData);
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

  // ========================================
  // APPLICATION PROCESS
  // ========================================

  async startApplicationProcess() {
    try {
      this.log("📝 Starting application process");
      this.statusOverlay.addInfo("Starting application process");

      // Ensure user profile is available
      await this.ensureUserProfile();

      // Set processing state using StateManager
      if (this.stateManager) {
        await this.stateManager.setProcessingStatus(true);
      }

      // Proceed with application process
      await this.apply();
    } catch (error) {
      this.reportError(error, { phase: "application" });
      this.handleApplicationError(error);
    }
  }

  async fetchApplicationTaskData() {
    if (this.userProfile && this.hasSessionContext) {
      this.log("✅ User profile already available from session context");
      return;
    }

    this.log("📡 Fetching application task data from background");
    this.statusOverlay.addInfo("Fetching application task data...");

    const success = this.safeSendPortMessage({ type: "GET_APPLICATION_TASK" });
    if (!success) {
      throw new Error("Failed to request application task data");
    }
  }

  processApplicationTaskData(data) {
    try {
      this.log("📊 Processing application task data:", {
        hasData: !!data,
        hasProfile: !!data?.profile,
      });

      if (data?.profile && !this.userProfile) {
        this.userProfile = data.profile;
        this.log("👤 User profile set from background response");
      }

      // Update form handler
      if (this.formHandler && this.userProfile) {
        this.formHandler.userData = this.userProfile;
      }

      this.statusOverlay.addSuccess("Application initialization complete");
    } catch (error) {
      console.error("❌ Error processing application task data:", error);
      this.statusOverlay.addError(
        "Error processing application data: " + error.message
      );
    }
  }

  /**
   * Handle already applied using ApplicationTrackerService
   */
  async handleAlreadyApplied() {
    try {
      const jobData = await this.extractJobDataForSubmission();

      // Track using ApplicationTrackerService
      if (this.applicationTracker) {
        await this.applicationTracker.saveAppliedJob(jobData);
        await this.applicationTracker.updateApplicationCount();
      }

      // Update StateManager
      if (this.stateManager) {
        await this.stateManager.incrementApplicationsUsed();
      }

      // Notify background script
      this.safeSendPortMessage({
        type: "APPLICATION_COMPLETED",
        data: jobData,
      });

      await this.resetApplicationState();
      this.statusOverlay.addSuccess(
        "Application already completed successfully"
      );
    } catch (error) {
      console.error("Error handling already applied:", error);
      this.statusOverlay.addError(
        "Error processing completed application: " + error.message
      );
    }
  }

  handleApplicationError(error) {
    if (error.name === "ApplicationSkipError") {
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

    this.resetApplicationState();
  }

  // ========================================
  // APPLICATION LOGIC
  // ========================================

  async apply() {
    try {
      this.statusOverlay.addInfo("Starting application process");
      this.statusOverlay.updateStatus("applying");

      // First check if we're already on a success/completion page
      const successCheck = this.checkSubmissionSuccess();
      if (successCheck) {
        await this.handleAlreadyApplied();
        return true;
      }

      // Validate handlers
      if (!this.validateHandlers()) {
        throw new Error("Required handlers are not properly initialized");
      }

      // Check for page errors
      if (this.hasPageErrors()) {
        throw new Error("Cannot start application: Page error");
      }

      // Find application form using Utils
      const form = await this.findApplicationForm();
      if (!form) {
        await Utils.delay(2000);
        const formAfterWait = await this.findApplicationForm();
        if (!formAfterWait) {
          throw new Error("Cannot find application form");
        }
        return await this.processApplicationForm(formAfterWait);
      }

      return await this.processApplicationForm(form);
    } catch (e) {
      // Better error handling for DOMExceptions and other errors
      let errorMessage = "Unknown error during application process";

      if (e instanceof DOMException) {
        errorMessage = `DOM Error: ${e.name} - ${e.message}`;
        console.error("DOMException in apply:", e.name, e.message, e.code);
      } else if (e.name === "ApplicationSkipError") {
        throw e; // Re-throw application skip errors
      } else if (e instanceof Error) {
        errorMessage = e.message;
        console.error("Error in apply:", e.message, e.stack);
      } else {
        errorMessage = String(e);
        console.error("Unknown error in apply:", e);
      }

      throw new Error(errorMessage);
    }
  }

  /**
   * Find application form using Utils
   */
  async findApplicationForm() {
    // Workable-specific form selectors
    const workableSelectors = [
      'form[action*="workable"]',
      'form[action*="apply"]',
      "form.application-form",
      "form#application-form",
      "form.whr-form",
    ];

    // Try each selector with Utils.waitForElement
    for (const selector of workableSelectors) {
      const form = await Utils.waitForElement(selector, 2000);
      if (form) {
        return form;
      }
    }

    // Fallback to DomUtils if available
    return DomUtils.findForm ? DomUtils.findForm(workableSelectors) : null;
  }

  async processApplicationForm(form) {
    this.statusOverlay.addInfo("Found application form, beginning to fill out");

    try {
      // Extract job description for AI context (use cached if available)
      const jobDescription =
        this.cachedJobDescription || (await this.extractJobDescription());

      // Update form handler with job description
      if (this.formHandler) {
        this.formHandler.jobDescription = jobDescription;
        this.formHandler.userData = this.userProfile;
      }

      // Handle file uploads
      try {
        if (this.fileHandler && this.userProfile) {
          await this.fileHandler.handleFileUploads(
            form,
            this.userProfile,
            jobDescription
          );
        }
      } catch (error) {
        console.warn("File upload failed:", error);
        this.statusOverlay.addWarning("File upload failed: " + error.message);
      }

      // Fill form fields
      try {
        if (this.formHandler) {
          await this.formHandler.handlePhoneInputWithCountryCode(
            form,
            this.userProfile
          );
          await this.formHandler.handleCustomSelectWithModal(
            form,
            this.userProfile
          );
          await this.formHandler.fillFormWithProfile(
            form,
            this.userProfile,
            jobDescription
          );

          this.statusOverlay.addSuccess("Form fields filled");
        }
      } catch (error) {
        console.warn("Form filling failed:", error);
        this.statusOverlay.addWarning("Form filling failed: " + error.message);
      }

      // Find submit button
      const submitButton = this.formHandler?.findSubmitButton(form);
      if (!submitButton) {
        throw Utils.createError(
          "Cannot find submit button",
          "SUBMIT_BUTTON_NOT_FOUND"
        );
      }

      // Submit the form with better error handling
      let submitted = false;
      try {
        submitted = await this.formHandler.submitForm(form, { dryRun: false });
      } catch (submitError) {
        console.error("Form submission error:", submitError);

        if (submitError instanceof DOMException) {
          this.statusOverlay.addError(
            `Form submission DOM error: ${submitError.name}`
          );
          throw new Error(
            `Form submission failed: ${submitError.name} - ${submitError.message}`
          );
        } else {
          this.statusOverlay.addError(
            "Form submission failed: " + submitError.message
          );
          throw submitError;
        }
      }

      if (submitted) {
        // Wait for page to process submission and check for success/error
        await this.waitForSubmissionResult();
      } else {
        throw new Error("Form submission returned false");
      }

      return submitted;
    } catch (error) {
      console.error("Error in processApplicationForm:", error);

      // Better error handling for different error types
      if (error instanceof DOMException) {
        throw new Error(
          `DOM Error in form processing: ${error.name} - ${error.message}`
        );
      } else if (error.name === "SUBMIT_BUTTON_NOT_FOUND") {
        throw error; // Re-throw specific errors
      } else {
        throw new Error(
          `Form processing failed: ${error.message || String(error)}`
        );
      }
    }
  }

  /**
   * Wait for the submit button to stop showing "Submitting..."
   */
  async waitForButtonToFinishSubmitting(timeout = 10000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const submitButton = document.querySelector('button[type="submit"]'); // or whatever your exact button selector is

      if (submitButton && !submitButton.textContent.includes("Submitting")) {
        this.statusOverlay.addInfo("Button finished submitting");
        return;
      }

      await Utils.delay(500);
    }

    this.statusOverlay.addWarning("Button state check timeout");
  }

  /**
   * Wait for submission result and handle accordingly
   */
  async waitForSubmissionResult(timeout = 15000) {
    const startTime = Date.now();
    this.statusOverlay.addInfo("Waiting for submission result...");

    await this.waitForButtonToFinishSubmitting(timeout);

    while (Date.now() - startTime < timeout) {
      await Utils.delay(1000);

      // Check for success
      const success = this.checkSubmissionSuccess();
      if (success) {
        this.statusOverlay.addSuccess("Application submitted successfully!");
        await this.handleSuccessfulSubmission();
        return;
      }

      // Check for errors
      const error = this.checkSubmissionErrors();
      if (error) {
        this.statusOverlay.addError("Application submission failed: " + error);
        await this.handleFailedSubmission(error);
        return;
      }

      // Check if URL changed (might indicate navigation to success page)
      if (
        window.location.href.includes("success") ||
        window.location.href.includes("confirmation") ||
        window.location.href.includes("thank")
      ) {
        this.statusOverlay.addSuccess("Redirected to success page!");
        await this.handleSuccessfulSubmission();
        return;
      }
    }

    // Timeout - treat as error
    this.statusOverlay.addWarning("Submission timeout - treating as error");
    await this.handleFailedSubmission("Submission timeout");
  }

  /**
   * Handle successful submission
   */
  async handleSuccessfulSubmission() {
    try {
      const jobData = await this.extractJobDataForSubmission();

      // Track using ApplicationTrackerService
      if (this.applicationTracker) {
        await this.applicationTracker.saveAppliedJob(jobData);
        await this.applicationTracker.updateApplicationCount();
      }

      // Update StateManager
      if (this.stateManager) {
        await this.stateManager.incrementApplicationsUsed();
      }

      // Notify background script
      this.safeSendPortMessage({
        type: "APPLICATION_COMPLETED",
        data: jobData,
      });

      await this.resetApplicationState();
      this.statusOverlay.addSuccess("Application completed and saved!");
    } catch (error) {
      console.error("Error handling successful submission:", error);
      this.statusOverlay.addError("Error saving application: " + error.message);
    }
  }

  /**
   * Handle failed submission
   */
  async handleFailedSubmission(errorMessage) {
    try {
      // Notify background script
      this.safeSendPortMessage({
        type: "APPLICATION_ERROR",
        data: errorMessage,
      });

      await this.resetApplicationState();
      this.statusOverlay.addError("Application failed: " + errorMessage);
    } catch (error) {
      console.error("Error handling failed submission:", error);
    }
  }

  /**
   * Extract job data for submission tracking
   */
  async extractJobDataForSubmission() {
    const jobDescription =
      this.cachedJobDescription || (await this.extractJobDescription());

    return {
      jobId:
        UrlUtils.extractJobId(window.location.href, "workable") ||
        Utils.generateId("workable_"),
      title: jobDescription.title || document.title || "Job on Workable",
      company: jobDescription.company || "Company on Workable",
      location: jobDescription.location || "Not specified",
      jobUrl: this.platformSpecificUrlNormalization(window.location.href),
      platform: "Workable",
      workplace: jobDescription.workplace,
      department: jobDescription.department,
      appliedAt: Date.now(),
    };
  }

  // ========================================
  // UTILITY METHODS
  // ========================================

  /**
   * Extract job description using DomUtils
   */
  async extractJobDescription() {
    try {
      this.log("🔍 Extracting job details...");
      this.statusOverlay.addInfo("Extracting job details...");

      let jobDescription = {
        title: DomUtils.extractText([
          'h1[data-ui="job-title"]',
          ".posting-header h2",
          "h1",
        ]),
        location: DomUtils.extractText([
          'div[data-ui="job-location"]',
          ".location",
        ]),
        department: DomUtils.extractText([
          'span[data-ui="job-department"]',
          ".department",
        ]),
        workplace: DomUtils.extractText([
          'span[data-ui="job-workplace"]',
          ".workplace",
        ]),
      };

      // Extract company name from URL using UrlUtils
      jobDescription.company = UrlUtils.extractCompanyFromUrl(
        window.location.href,
        "workable"
      );

      // Extract full job description text
      const fullDescriptionElement = document.querySelector(
        ".job-description, .posting-content, .description"
      );
      if (fullDescriptionElement) {
        jobDescription.fullDescription =
          fullDescriptionElement.textContent.trim();
      }

      this.log("✅ Job details extracted successfully:", {
        title: jobDescription.title,
        company: jobDescription.company,
        location: jobDescription.location,
      });

      return jobDescription;
    } catch (error) {
      console.error("❌ Error extracting job details:", error);
      return { title: document.title || "Job Position" };
    }
  }

  checkSubmissionSuccess() {
    // Check if URL indicates success
    if (
      window.location.href.includes("success") ||
      window.location.href.includes("confirmation") ||
      window.location.href.includes("thanks") ||
      window.location.href.includes("thank")
    ) {
      this.statusOverlay.addSuccess(
        "URL indicates success page - application submitted"
      );
      return true;
    }

    // Check for Workable-specific success messages based on your HTML
    const workableSuccessSelectors = [
      '[data-ui="successful-submit"]',
      '.styles--1kLCz[data-ui="successful-submit"]',
    ];

    for (const selector of workableSuccessSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        this.statusOverlay.addSuccess(
          "Success message found - application submitted"
        );
        return true;
      }
    }

    const h3Elements = document.querySelectorAll("h3");
    for (const h3 of h3Elements) {
      const text = h3.textContent.trim();
      if (
        text.includes("Thank you!") ||
        text.includes("Your application has been submitted successfully")
      ) {
        this.statusOverlay.addSuccess(
          "Success message found - application submitted"
        );
        return true;
      }
    }

    // Check for generic success messages
    const successElements = document.querySelectorAll(
      ".application-confirmation, .success-message, h1.success-message, div[class*='success'], div.thank-you, div[class*='thankyou'], div[class*='submitted']"
    );

    if (successElements.length > 0) {
      // Check if any contain success-related text
      for (const el of successElements) {
        const text = el.textContent.toLowerCase();
        if (
          text.includes("thank") ||
          text.includes("success") ||
          text.includes("submitted") ||
          text.includes("received") ||
          text.includes("application")
        ) {
          this.statusOverlay.addSuccess(
            "Success message found - application submitted"
          );
          return true;
        }
      }
    }

    // Check for success text in the page
    const bodyText = document.body.textContent.toLowerCase();
    if (
      bodyText.includes("your application has been submitted") ||
      bodyText.includes("application submitted successfully") ||
      bodyText.includes("thank you for your application")
    ) {
      this.statusOverlay.addSuccess(
        "Success text found in page - application submitted"
      );
      return true;
    }

    return false;
  }

  /**
   * Check for submission errors
   */
  checkSubmissionErrors() {
    // Check for error messages
    const errorElements = document.querySelectorAll(
      ".error, .error-message, .form-error, .alert-error, .validation-error, .field-error, [class*='error'], [class*='invalid']"
    );

    if (errorElements.length > 0) {
      const errorMessages = Array.from(errorElements)
        .map((el) => el.textContent.trim())
        .filter(
          (text) => text.length > 0 && !text.toLowerCase().includes("password")
        )
        .slice(0, 3); // Limit to first 3 errors

      if (errorMessages.length > 0) {
        return errorMessages.join(", ");
      }
    }

    // Check for Workable-specific error indicators
    const workableErrorSelectors = [
      '[data-ui="error"]',
      '[role="alert"]',
      ".validation-error",
      ".field-validation-error",
    ];

    for (const selector of workableErrorSelectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent.trim()) {
        return element.textContent.trim();
      }
    }

    // Check for generic error text
    const bodyText = document.body.textContent.toLowerCase();
    if (
      bodyText.includes("please fill") ||
      bodyText.includes("required field") ||
      bodyText.includes("invalid") ||
      bodyText.includes("error occurred")
    ) {
      return "Form validation errors detected";
    }

    return null;
  }

  validateHandlers() {
    const issues = [];

    if (!this.statusOverlay) issues.push("Status overlay not initialized");
    if (!this.fileHandler) issues.push("File handler not initialized");
    if (!this.formHandler) issues.push("Form handler not initialized");
    if (!this.userProfile) issues.push("User profile not available");

    if (issues.length > 0) {
      this.statusOverlay?.addError(
        "Initialization issues: " + issues.join(", ")
      );
      return false;
    }

    return true;
  }

  hasPageErrors() {
    return (
      document.body.innerText.includes("Cannot GET") ||
      document.location.search.includes("not_found=true") ||
      document.body.innerText.includes("Job is no longer available")
    );
  }

  /**
   * Wait for valid page using Utils.delay
   */
  async waitForValidPage(timeout = 30000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const url = window.location.href;

      if (
        url.includes("google.com/search") ||
        this.isValidJobPage(url) ||
        this.isApplicationPage(url)
      ) {
        await this.detectPageTypeAndStart();
        return;
      }

      await this.delay(1000);

      this.safeSendPortMessage({
        type: "SEND_CV_TASK_SKIP",
        data: {
          reason: "Invalid page - no search, job page, or application elements found",
          url: window.location.href
        }
      });

      this.applicationState.isApplicationInProgress = false;
      this.applicationState.applicationStartTime = null;
    }

    throw Utils.createError("Timeout waiting for valid page", "PAGE_TIMEOUT");
  }

  /**
   * Set session context with improved error handling using Utils
   */
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
          this.log("👤 User profile loaded from session context");
        } else {
          this.userProfile = Utils.deepMerge(
            this.userProfile,
            sessionContext.userProfile
          );
          this.log("👤 User profile merged with session context");
        }
      }

      // Fetch user profile if still missing using UserService
      if (!this.userProfile && this.userId) {
        await this.ensureUserProfile();
      }

      // Update services with user context
      if (this.userId) {
        if (!this.userService || this.userService.userId !== this.userId) {
          this.userService = new UserService({ userId: this.userId });
        }

        if (
          !this.applicationTracker ||
          this.applicationTracker.userId !== this.userId
        ) {
          this.applicationTracker = new ApplicationTrackerService({
            userId: this.userProfile.userId,
            apiHost: this.getApiHost(),
          });
        }

        if (!this.stateManager) {
          this.stateManager = new StateManagerService({
            sessionId: this.sessionId,
            storageKey: `workable_automation_${this.sessionId || "default"}`,
          });
        }

        this.log("📋 Updated services with new userId:", this.userId);
      }

      // Store API host from session context
      if (sessionContext.apiHost) {
        this.sessionApiHost = sessionContext.apiHost;
      }

      // Update form handler if it exists
      if (this.formHandler && this.userProfile) {
        this.formHandler.userData = this.userProfile;
      }

      this.log("✅ Workable session context set successfully", {
        hasUserProfile: !!this.userProfile,
        userId: this.userId,
        sessionId: this.sessionId,
        profileName: this.userProfile?.name || this.userProfile?.firstName,
        profileEmail: this.userProfile?.email,
      });
    } catch (error) {
      console.error("❌ Error setting Workable session context:", error);
      this.statusOverlay?.addError(
        "❌ Error setting session context: " + error.message
      );
    }
  }

  errorToString(e) {
    if (!e) return "Unknown error (no details)";

    // Handle DOMException specifically
    if (e instanceof DOMException) {
      return `DOMException: ${e.name} - ${e.message} (code: ${e.code})`;
    }

    if (e instanceof Error) {
      return e.message + (e.stack ? `\n${e.stack}` : "");
    }

    // Handle objects that might be stringified incorrectly
    if (typeof e === "object") {
      try {
        return JSON.stringify(e, null, 2);
      } catch (jsonError) {
        return `Object error: ${Object.prototype.toString.call(e)}`;
      }
    }

    return String(e);
  }

  /**
   * Verify application status with background script using StateManager
   */
  async verifyApplicationStatus() {
    return new Promise(async (resolve) => {
      if (!this.port) {
        await this.resetApplicationState();
        resolve(false);
        return;
      }

      // Check StateManager first
      if (this.stateManager) {
        try {
          const state = await this.stateManager.getState();
          if (state && state.isProcessing !== undefined) {
            resolve(state.isProcessing);
            return;
          }
        } catch (error) {
          console.warn("Error checking StateManager status:", error);
        }
      }

      const requestId = "status_" + Date.now();
      let resolved = false;

      // Set timeout to prevent hanging
      const timeoutId = setTimeout(async () => {
        if (!resolved) {
          resolved = true;
          await this.resetApplicationState();
          resolve(false);
        }
      }, 3000);

      // Store resolver for response handling
      this.pendingStatusRequests = this.pendingStatusRequests || {};
      this.pendingStatusRequests[requestId] = {
        resolve: async (result) => {
          if (!resolved) {
            resolved = true;
            clearTimeout(timeoutId);
            resolve(result);
          }
        },
      };

      // Send the status check request
      this.safeSendPortMessage({
        type: "CHECK_APPLICATION_STATUS",
        requestId,
      });
    });
  }

  // ========================================
  // CLEANUP
  // ========================================

  cleanup() {
    // Clear debounce timers
    Object.values(this.debounceTimers).forEach((timerId) => {
      clearTimeout(timerId);
    });
    this.debounceTimers = {};

    // Clear cached data
    this.cachedJobDescription = null;

    // Reset StateManager if available
    if (this.stateManager) {
      this.stateManager.setProcessingStatus(false);
    }

    // Base class handles most cleanup
    super.cleanup();

    this.log("🧹 Workable-specific cleanup completed");
  }

  /**
   * Enhanced health check with recovery mechanisms using StateManager
   */
  async checkHealth() {
    try {
      // Verify application state with StateManager
      if (
        this.stateManager &&
        window.location.href.includes("google.com/search")
      ) {
        const state = await this.stateManager.getState();

        // Sync local state with StateManager
        if (
          state &&
          state.isProcessing !== this.applicationState.isApplicationInProgress
        ) {
          this.applicationState.isApplicationInProgress = state.isProcessing;

          if (!state.isProcessing) {
            this.applicationState.applicationStartTime = null;
          }
        }
      }

      // Check for stuck application
      if (
        this.applicationState.isApplicationInProgress &&
        this.applicationState.applicationStartTime
      ) {
        const now = Date.now();
        const applicationTime =
          now - this.applicationState.applicationStartTime;

        // If application has been active for over 5 minutes, it's probably stuck
        if (applicationTime > 5 * 60 * 1000) {
          this.log(
            "Application appears to be stuck for over 5 minutes, resetting state"
          );

          await this.resetApplicationState();

          this.statusOverlay.addWarning(
            "Application timeout detected - resetting state"
          );
          this.statusOverlay.updateStatus("error");

          if (window.location.href.includes("google.com/search")) {
            // Continue search on search page
            this.debounce("searchNext", () => this.searchNext(), 2000);
          }
        }
      }
    } catch (error) {
      this.log("❌ Error in health check:", error);
    }
  }

  /**
   * Debounce function using Utils for preventing rapid-fire calls
   */
  debounce(key, fn, delay) {
    // Clear existing timer
    if (this.debounceTimers[key]) {
      clearTimeout(this.debounceTimers[key]);
    }

    // Set new timer
    this.debounceTimers[key] = setTimeout(() => {
      delete this.debounceTimers[key];
      fn();
    }, delay);
  }
}
