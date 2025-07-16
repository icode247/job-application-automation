// platforms/workable/workable.js - FIXED VERSION
import BasePlatformAutomation from "../../shared/base/base-platform-automation.js";
import WorkableFormHandler from "./workable-form-handler.js";
import WorkableFileHandler from "./workable-file-handler.js";
import { UrlUtils, DomUtils, FormUtils } from "../../shared/utilities/index.js";
import {
  AIService,
  ApplicationTrackerService,
  UserService,
} from "../../services/index.js";
//Application error: Error during application process: DomUtils is not defined ReferenceError: DomUtils is not defined at
// FormUtils.findSubmitButton (chrome-extension://bjohmhedpgcadjaeakhcaei
//   fijjbdefi/shared/utilities/form-utils.js:487:21) at
//   WorkablePlatform.processApplication
export default class WorkablePlatform extends BasePlatformAutomation {
  constructor(config) {
    super(config);
    this.platform = "workable";
    this.baseUrl = "https://apply.workable.com";

    // Initialize Workable-specific services
    this.aiService = new AIService({ apiHost: this.getApiHost() });
    this.applicationTracker = new ApplicationTrackerService({
      userId: this.userId,
    });
    this.userService = new UserService({ userId: this.userId });

    this.fileHandler = null;
    this.formHandler = null;
    this.cachedJobDescription = null;
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

  // ✅ FIXED: Updated to handle both job overview pages and application pages
  isValidJobPage(url) {
    return /^https:\/\/apply\.workable\.com\/[^\/]+\/(j|jobs)\/([^\/]+)/.test(
      url
    );
  }

  // ✅ ADDED: Method to detect application pages specifically
  isApplicationPage(url) {
    return url.includes("/apply/") || url.includes("/application");
  }

  getApiHost() {
    return (
      this.sessionApiHost ||
      this.sessionContext?.apiHost ||
      this.config.apiHost ||
      "http://localhost:3000"
    );
  }

  getJobTaskMessageType() {
    return "START_APPLICATION";
  }

  /**
   * Platform-specific URL normalization
   */
  platformSpecificUrlNormalization(url) {
    // Remove /apply suffix and normalize Workable URLs
    return url.replace(/\/apply\/?$/, "");
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

    this.statusOverlay.addSuccess("Workable-specific components initialized");
  }

  async start(params = {}) {
    try {
      this.isRunning = true;
      this.log("🚀 Starting Workable automation");
      this.statusOverlay.addInfo("Starting Workable automation");

      // Ensure user profile is available before starting
      if (!this.userProfile && this.userId) {
        try {
          console.log("🔄 Attempting to fetch user profile during start...");
          this.userProfile = await this.userService.getUserDetails();
          console.log("✅ User profile fetched during start");
          this.statusOverlay.addSuccess("User profile loaded");

          // Update form handler with profile
          if (this.formHandler && this.userProfile) {
            this.formHandler.userData = this.userProfile;
          }
        } catch (error) {
          console.error("❌ Failed to fetch user profile during start:", error);
          this.statusOverlay.addWarning(
            "Failed to load user profile - automation may have limited functionality"
          );
        }
      }

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

  // ✅ FIXED: Updated page detection logic
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
      this.log("❓ Unknown page type, waiting for navigation");
      await this.waitForValidPage();
    }
  }

  // ✅ ADDED: Method to navigate to application tab and start
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

      // Wait for application page to load
      await this.wait(2000);

      // Start application process
      await this.startApplicationProcess();
    } catch (error) {
      this.reportError(error, { phase: "navigation" });
      this.handleApplicationError(error);
    }
  }

  // ✅ ADDED: Method to navigate to application tab (similar to Ashby)
  async navigateToApplicationTab() {
    try {
      this.statusOverlay.addInfo("Looking for Application tab...");

      // Find the Application tab using Workable-specific selectors
      const applicationTab =
        document.querySelector('a[data-ui="application-form-tab"]') ||
        document.querySelector('a[href*="/apply/"]') ||
        Array.from(document.querySelectorAll("a")).find((tab) =>
          tab.textContent.toLowerCase().includes("application")
        );

      if (!applicationTab) {
        this.statusOverlay.addWarning("Application tab not found");
        return false;
      }

      this.statusOverlay.addInfo("Found Application tab, clicking...");

      // Get current URL to detect navigation
      const currentUrl = window.location.href;

      // Click the Application tab
      applicationTab.click();

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
        await this.wait(2000);
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

  // ✅ ADDED: Method to wait for URL change (from Ashby)
  async waitForUrlChange(originalUrl, expectedPath, timeout = 10000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      await this.wait(500);

      const currentUrl = window.location.href;

      // Check if URL changed and contains expected path
      if (currentUrl !== originalUrl && currentUrl.includes(expectedPath)) {
        console.log(`✅ URL changed to: ${currentUrl}`);
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

      case "PROFILE_DATA":
        this.handleProfileData(data);
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

  handleSearchTaskData(data) {
    this.processSearchTaskData(data);
  }

  handleApplicationTaskData(data) {
    this.processApplicationTaskData(data);
  }

  handleApplicationStarting(data) {
    try {
      this.log("Application starting confirmation received:", data);
      this.applicationState.isApplicationInProgress = true;
      this.applicationState.applicationStartTime = Date.now();
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
      console.log("📝 Starting application process");
      this.statusOverlay.addInfo("Starting application process");

      // Validate user profile
      if (!this.userProfile) {
        console.log("⚠️ No user profile available, attempting to fetch...");
        await this.fetchApplicationTaskData();
      }

      // Check for success page first
      // const applied = this.checkSubmissionSuccess();
      // if (applied) {
      //   await this.handleAlreadyApplied();
      //   return;
      // }

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
      console.log("📊 Processing application task data:", {
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

      this.statusOverlay.addSuccess("Application initialization complete");
    } catch (error) {
      console.error("❌ Error processing application task data:", error);
      this.statusOverlay.addError(
        "Error processing application data: " + error.message
      );
    }
  }

  async handleAlreadyApplied() {
    const jobId = UrlUtils.extractJobId(window.location.href, "workable");
    const company = UrlUtils.extractCompanyFromUrl(
      window.location.href,
      "workable"
    );

    this.safeSendPortMessage({
      type: "APPLICATION_COMPLETED",
      data: {
        jobId: jobId,
        title: document.title || "Job on Workable",
        company: company || "Company on Workable",
        location: "Not specified",
        jobUrl: window.location.href,
      },
    });

    this.applicationState.isApplicationInProgress = false;
    this.statusOverlay.addSuccess("Application completed successfully");
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
    this.applicationState.isApplicationInProgress = false;
  }

  // ========================================
  // APPLICATION LOGIC
  // ========================================

  async apply() {
    try {
      this.statusOverlay.addInfo("Starting application process");
      this.statusOverlay.updateStatus("applying");

      // Validate handlers
      if (!this.validateHandlers()) {
        throw new Error("Required handlers are not properly initialized");
      }

      // Check for page errors
      if (this.hasPageErrors()) {
        throw new Error("Cannot start application: Page error");
      }

      // Find application form
      const form = this.findApplicationForm();
      if (!form) {
        await this.wait(2000);
        const formAfterWait = this.findApplicationForm();
        if (!formAfterWait) {
          throw new Error("Cannot find application form");
        }
        return await this.processApplicationForm(formAfterWait);
      }

      return await this.processApplicationForm(form);
    } catch (e) {
      if (e.name === "ApplicationSkipError") {
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
    // Workable-specific form selectors
    const workableSelectors = [
      'form[action*="workable"]',
      'form[action*="apply"]',
      "form.application-form",
      "form#application-form",
      "form.whr-form",
    ];

    return DomUtils.findForm(workableSelectors);
  }

  async processApplicationForm(form) {
    this.statusOverlay.addInfo("Found application form, beginning to fill out");

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
      this.statusOverlay.addError("File upload failed: " + error.message);
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
      this.statusOverlay.addWarning("Form filling failed: " + error.message);
    }

    // 6. Find submit button
    const submitButton = this.formHandler.findSubmitButton(form);
    if (!submitButton) {
      throw new ApplicationError("Cannot find submit button");
    }

    // 7. Submit the form
    const submitted = await this.formHandler.submitForm(form, {
      dryRun: true,
    });
    return submitted;
  }

  // ========================================
  // UTILITY METHODS
  // ========================================

  async extractJobDescription() {
    try {
      console.log("🔍 Extracting job details...");
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

      // Extract company name from URL
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

      console.log("✅ Job details extracted successfully:", {
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
      window.location.href.includes("thanks")
    ) {
      this.statusOverlay.addSuccess(
        "URL indicates success page - application submitted"
      );
      return true;
    }

    // Check for success messages
    const successElements = document.querySelectorAll(
      ".application-confirmation, .success-message, h1.success-message, div[class*='success'], div.thank-you, div[class*='thankyou']"
    );

    if (successElements.length > 0) {
      this.statusOverlay.addSuccess(
        "Success message found - application submitted"
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

    return false;
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

  // ✅ FIXED: Updated to handle both search and job pages
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
    }

    throw new Error("Timeout waiting for valid page");
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
      if (
        this.userId &&
        (!this.userService || this.userService.userId !== this.userId)
      ) {
        this.applicationTracker = new ApplicationTrackerService({
          userId: this.userId,
        });
        this.userService = new UserService({ userId: this.userId });
        console.log("📋 Updated services with new userId:", this.userId);
      }

      // Store API host from session context
      if (sessionContext.apiHost) {
        this.sessionApiHost = sessionContext.apiHost;
      }

      // Update form handler if it exists
      if (this.formHandler && this.userProfile) {
        this.formHandler.userData = this.userProfile;
      }

      console.log("✅ Workable session context set successfully", {
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
    if (e instanceof Error) {
      return e.message + (e.stack ? `\n${e.stack}` : "");
    }
    return String(e);
  }

  // ========================================
  // CLEANUP
  // ========================================

  cleanup() {
    // Base class handles most cleanup
    super.cleanup();

    // Workable-specific cleanup
    this.cachedJobDescription = null;
    this.log("🧹 Workable-specific cleanup completed");
  }
}
