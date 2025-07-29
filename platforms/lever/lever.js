// platforms/lever/lever.js - REFACTORED VERSION
import BasePlatformAutomation from "../../shared/base/base-platform-automation.js";
import LeverFormHandler from "./lever-form-handler.js";
import LeverFileHandler from "./lever-file-handler.js";
import { UrlUtils, DomUtils, FormUtils } from "../../shared/utilities/index.js";
import {
  AIService,
  ApplicationTrackerService,
  UserService,
} from "../../services/index.js";

export default class LeverPlatform extends BasePlatformAutomation {
  constructor(config) {
    super(config);
    this.platform = "lever";
    this.baseUrl = "https://jobs.lever.co";

    // Initialize Lever-specific services
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
  // PLATFORM-SPECIFIC IMPLEMENTATIONS
  // ========================================

  /**
   * Required abstract method implementations
   */
  getPlatformDomains() {
    return ["https://jobs.lever.co"];
  }

  getSearchLinkPattern() {
    return /^https:\/\/jobs\.(eu\.)?lever\.co\/([^\/]*)\/([^\/]*)\/?(.*)?$/;
  }

  isValidJobPage(url) {
    return /^https:\/\/jobs\.(eu\.)?lever\.co\/[^\/]+\/[^\/]+/.test(url);
  }

  getApiHost() {
    return this.sessionApiHost || this.sessionContext?.apiHost || this.config.apiHost;
  }

  isApplicationPage(url) {
    return url.includes("/apply") || url.includes("/application");
  }

  getJobTaskMessageType() {
    return "SEND_CV_TASK"; // Lever-specific message type
  }

  /**
   * Platform-specific URL normalization
   */
  platformSpecificUrlNormalization(url) {
    // Remove /apply suffix commonly found in Lever job URLs
    return url.replace(/\/apply$/, "");
  }

  // ========================================
  // LEVER-SPECIFIC INITIALIZATION
  // ========================================

  async start(params = {}) {
    try {
      this.isRunning = true;
      this.log("🚀 Starting Lever automation");
      this.statusOverlay.addInfo("Starting Lever automation");

      // ✅ FIX: Ensure user profile is available before starting
      if (!this.userProfile && this.userId) {
        try {
          this.log("🔄 Attempting to fetch user profile during start...");
          this.userProfile = await this.userService.getUserDetails();
          this.log("✅ User profile fetched during start");
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

  async detectPageTypeAndStart() {
    const url = window.location.href;
    this.log(`🔍 Detecting page type for: ${url}`);
    if (url.includes("google.com/search")) {
      this.log("📊 Google search page detected");
      await this.startSearchProcess();
    } else if (this.isLeverJobPage(url)) {
      this.log("📋 Lever job page detected");
      await this.startApplicationProcess();
    } else {
      await this.waitForValidPage();
    }
  }

  async initialize() {
    await super.initialize(); // Handles all common initialization

    // Initialize Lever-specific handlers
    this.fileHandler = new LeverFileHandler({
      statusService: this.statusOverlay,
      apiHost: this.getApiHost(),
    });

    this.formHandler = new LeverFormHandler({
      logger: (message) => this.statusOverlay.addInfo(message),
      host: this.getApiHost(),
      userData: this.userProfile || {},
      jobDescription: "",
    });
  }

  // ========================================
  // LEVER-SPECIFIC MESSAGE HANDLING
  // ========================================

  handlePlatformSpecificMessage(type, data) {
    switch (type) {
      case "APPLICATION_STATUS_RESPONSE":
        this.handleApplicationStatusResponse(data);
        break;

      case "SUCCESS":
        this.handleSuccessMessage(data);
        break;

      case "JOB_TAB_STATUS":
        this.handleJobTabStatus(data);
        break;

      default:
        super.handlePlatformSpecificMessage(type, data);
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
      } else if (data.profile !== undefined && !this.userProfile) {
        this.processSendCvTaskData(data);
      }
    }
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

  // ========================================
  // LEVER-SPECIFIC PAGE TYPE DETECTION
  // ========================================

  async detectPageTypeAndStart() {
    const url = window.location.href;
    this.log(`🔍 Detecting page type for: ${url}`);

    if (url.includes("google.com/search")) {
      this.log("📊 Google search page detected");
      this.statusOverlay.addInfo("Google search page detected");
      await this.startSearchProcess();
    } else if (this.isValidJobPage(url)) {
      this.log("📋 Lever job page detected");
      this.statusOverlay.addInfo("Lever job page detected");
      await this.startApplicationProcess();
    } else {
      this.log("❓ Unknown page type, waiting for navigation");
      await this.waitForValidPage();
    }
  }

  isLeverJobListingPage(url) {
    return /^https:\/\/jobs\.(eu\.)?lever\.co\/[^\/]+\/[^\/]+(?!\/apply)/.test(
      url
    );
  }

  isLeverApplicationPage(url) {
    return /^https:\/\/jobs\.(eu\.)?lever\.co\/[^\/]+\/[^\/]+\/apply/.test(url);
  }

  // ========================================
  // LEVER-SPECIFIC SEARCH LOGIC
  // ========================================

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

      setTimeout(() => this.searchNext(), 1000);
    } catch (error) {
      this.log("❌ Error processing search task data:", error);
      this.statusOverlay.addError(
        "Error processing search task data: " + error.message
      );
    }
  }

  // ========================================
  // LEVER-SPECIFIC APPLICATION LOGIC
  // ========================================

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

      // Update services with user context only if userId changed
      if (
        this.userId &&
        (!this.userService || this.userService.userId !== this.userId)
      ) {
        this.applicationTracker = new ApplicationTrackerService({
          userId: this.userId,
        });
        this.userService = new UserService({ userId: this.userId });
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

      this.log("✅ Lever session context set successfully", {
        hasUserProfile: !!this.userProfile,
        userId: this.userId,
        sessionId: this.sessionId,
        profileName: this.userProfile?.name || this.userProfile?.firstName,
        profileEmail: this.userProfile?.email,
      });
    } catch (error) {
      console.error("❌ Error setting Lever session context:", error);
      this.statusOverlay?.addError(
        "❌ Error setting session context: " + error.message
      );
    }
  }

  async startApplicationProcess() {
    try {
      this.log("📝 Starting application process");
      this.statusOverlay.addInfo("Starting application process");

      // Validate user profile (inherited validation logic)
      if (!this.userProfile) {
        this.log("⚠️ No user profile available, attempting to fetch...");
        await this.fetchSendCvTaskData();
      }

      // Check if we're on a job listing page and need to click Apply
      const currentUrl = window.location.href;
      if (this.isLeverJobListingPage(currentUrl)) {
        this.log("📋 On job listing page, need to click Apply button");
        await this.handleJobListingPage();
      }

      // Check for success page first
      const applied = this.checkSubmissionSuccess();
      if (applied) {
        await this.handleAlreadyApplied();
        return;
      }

      // Proceed with application process
      await this.apply();
    } catch (error) {
      this.reportError(error, { phase: "application" });
      this.handleApplicationError(error);
    }
  }

  async handleJobListingPage() {
    this.statusOverlay.addInfo(
      "Job listing page detected - clicking Apply button"
    );

    // Extract job description while on the listing page
    this.cachedJobDescription = await this.extractJobDescription();

    // Find and click the Apply button
    const applyButton = this.findApplyButton();
    if (!applyButton) {
      throw new Error("Cannot find Apply button on job listing page");
    }

    this.log("🖱️ Clicking Apply button");
    applyButton.click();

    // Wait for the application page to load
    await this.waitForApplicationPage();
    this.statusOverlay.addSuccess("Application page loaded successfully");
  }

  async handleAlreadyApplied() {
    const jobId = UrlUtils.extractJobId(window.location.href, "lever");
    const company = UrlUtils.extractCompanyFromUrl(
      window.location.href,
      "lever"
    );

    this.safeSendPortMessage({
      type: "SEND_CV_TASK_DONE",
      data: {
        jobId: jobId,
        title: document.title || "Job on Lever",
        company: company || "Company on Lever",
        location: "Not specified",
        jobUrl: window.location.href,
      },
    });

    this.applicationState.isApplicationInProgress = false;
    this.statusOverlay.addSuccess("Application completed successfully");
  }

  handleApplicationError(error) {
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

  // ========================================
  // LEVER-SPECIFIC FORM HANDLING
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
        throw new Error("Cannot start send cv: Page error");
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
    // Lever-specific form selectors
    const leverSelectors = [
      'form[action*="lever"]',
      'form[action*="apply"]',
      "form.application-form",
      "form#application-form",
      "form.lever-apply-form",
    ];

    return DomUtils.findForm(leverSelectors);
  }

  async processApplicationForm(form) {
    this.statusOverlay.addInfo("Found application form, beginning to fill out");

    // Extract job description for AI context
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

    // Submit the form
    return await this.formHandler.submitForm(form);
  }

  // ========================================
  // LEVER-SPECIFIC UTILITY METHODS
  // ========================================

  findApplyButton() {
    const applySelectors = [
      'a[href*="/apply"]',
      "a.postings-btn",
      'a.button[href*="/apply"]',
      'a.btn[href*="/apply"]',
      'a[data-qa="btn-apply"]',
    ];

    for (const selector of applySelectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        if (
          DomUtils.isElementVisible(element) &&
          (element.href?.includes("/apply") ||
            element.textContent.toLowerCase().includes("apply"))
        ) {
          return element;
        }
      }
    }

    return null;
  }

  async waitForApplicationPage(timeout = 10000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (window.location.href.includes("/apply")) {
        const form = this.findApplicationForm();
        if (form) {
          return true;
        }
      }
      await this.wait(500);
    }

    throw new Error("Timeout waiting for application page to load");
  }

  async extractJobDescription() {
    try {
      this.log("🔍 Extracting job details...");
      this.statusOverlay.addInfo("Extracting job details...");

      let jobDescription = {
        title: DomUtils.extractText([
          ".posting-header h2",
          ".section h2",
          "h2",
        ]),
        location: DomUtils.extractText([
          ".posting-category.location",
          ".location",
        ]),
        department: DomUtils.extractText([
          ".posting-category.department",
          ".department",
        ]),
        commitment: DomUtils.extractText([
          ".posting-category.commitment",
          ".commitment",
        ]),
        workplaceType: DomUtils.extractText([
          ".posting-category.workplaceTypes",
          ".workplaceTypes",
        ]),
      };

      // Extract company name from URL
      jobDescription.company = UrlUtils.extractCompanyFromUrl(
        window.location.href,
        "lever"
      );

      // Extract full job description text
      const fullDescriptionElement = document.querySelector(
        ".posting-content, .posting-description, .job-description, .section-wrapper"
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
        return false;
      }
    }

    this.statusOverlay.addWarning(
      "Unable to confirm submission success - status uncertain"
    );
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
      document.location.search.includes("not_found=true")
    );
  }

  async fetchSendCvTaskData() {
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
      this.log("📊 Processing send CV task data:", {
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

      this.statusOverlay.addSuccess("Apply initialization complete");
    } catch (error) {
      console.error("❌ Error processing send CV task data:", error);
      this.statusOverlay.addError("Error processing CV data: " + error.message);
    }
  }

  async waitForValidPage(timeout = 30000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const url = window.location.href;

      if (this.isLeverJobListingPage(url) || this.isLeverApplicationPage(url)) {
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

    throw new Error("Timeout waiting for valid page");
  }

  errorToString(e) {
    if (!e) return "Unknown error (no details)";
    if (e instanceof Error) {
      return e.message + (e.stack ? `\n${e.stack}` : "");
    }
    return String(e);
  }

  // ========================================
  // CLEANUP - Inherited from base class
  // ========================================

  cleanup() {
    // Base class handles most cleanup
    super.cleanup();

    // Lever-specific cleanup
    this.cachedJobDescription = null;
    this.log("🧹 Lever-specific cleanup completed");
  }
}
