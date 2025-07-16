// platforms/recruitee/recruitee.js
import BasePlatformAutomation from "../../shared/base/base-platform-automation.js";
import { RecruiteeFormHandler } from "./recruitee-form-handler.js";
import { RecruiteeFileHandler } from "./recruitee-file-handler.js";
import { UrlUtils, DomUtils } from "../../shared/utilities/index.js";
import {
  AIService,
  ApplicationTrackerService,
  UserService,
} from "../../services/index.js";

// Custom error types for Recruitee
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

export default class RecruiteePlatform extends BasePlatformAutomation {
  constructor(config) {
    super(config);
    this.platform = "recruitee";
    this.baseUrl = "https://jobs.recruitee.co";

    // Initialize Recruitee-specific services
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
    return ["recruitee.com"];
  }

  getSearchLinkPattern() {
    return /^https:\/\/.*\.recruitee\.com\/(o|career)\/([^\/]+)\/?.*$/;
  }

  isValidJobPage(url) {
    return /\/(o|career)\//.test(url);
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

  async start(params = {}) {
    try {
      this.isRunning = true;
      this.log("▶️ Starting Recruitee automation");

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
          // Handle connection established message
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
    return "START_APPLICATION";
  }

  // ========================================
  // RECRUITEE-SPECIFIC INITIALIZATION
  // ========================================

  async initialize() {
    await super.initialize(); // Handles all common initialization
  
    // Initialize Recruitee-specific handlers
    this.fileHandler = new RecruiteeFileHandler({
      statusService: this.statusOverlay,
      apiHost: this.getApiHost(),
    });

    this.formHandler = new RecruiteeFormHandler({
      logger: (message) => this.statusOverlay.addInfo(message),
      host: this.getApiHost(),
      userData: this.userProfile || {},
      jobDescription: "",
    });

    this.statusOverlay.addSuccess("Recruitee-specific components initialized");
  }

  // ========================================
  // RECRUITEE-SPECIFIC MESSAGE HANDLING
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

      default:
        super.handlePlatformSpecificMessage(type, data);
    }
  }

  handleSearchTaskData(data) {
    try {
      this.log("📊 Processing Recruitee search task data:", data);

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

      this.log("✅ Recruitee search data initialized:", this.searchData);
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
      this.log("📊 Processing Recruitee application task data:", data);

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
    this.log("🎯 Recruitee application starting:", data);
    this.applicationState.isApplicationInProgress = true;
    this.applicationState.applicationStartTime = Date.now();
    this.statusOverlay.addInfo("Application starting...");
  }

  handleApplicationStatus(data) {
    this.log("📊 Recruitee application status:", data);

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
  // RECRUITEE-SPECIFIC PAGE TYPE DETECTION
  // ========================================

  async detectPageTypeAndStart() {
    const url = window.location.href;
    this.log(`🔍 Detecting page type for: ${url}`);

    if (url.includes("google.com/search")) {
      this.log("📊 Google search page detected");
      this.statusOverlay.addInfo("Google search page detected");
      await this.startSearchProcess();
    } else if (this.isValidJobPage(url)) {
      this.log("📋 Recruitee job page detected");
      this.statusOverlay.addInfo("Recruitee job page detected");
      await this.startApplicationProcess();
    } else {
      this.log("❓ Unknown page type, waiting for navigation");
      await this.waitForValidPage();
    }
  }

  // ========================================
  // RECRUITEE-SPECIFIC SEARCH LOGIC
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
    this.log("📡 Fetching Recruitee search task data from background");
    this.statusOverlay.addInfo("Fetching search task data...");

    const success = this.safeSendPortMessage({ type: "GET_SEARCH_TASK" });
    if (!success) {
      throw new Error("Failed to request search task data");
    }
  }

  // ========================================
  // RECRUITEE-SPECIFIC APPLICATION LOGIC
  // ========================================

  async startApplicationProcess() {
    try {
      console.log("📝 Starting Recruitee application process");
      this.statusOverlay.addInfo("Starting application process");
      this.statusOverlay.updateStatus("applying");

      // Validate user profile (inherited validation logic)
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
        console.log("✅ User profile available for Recruitee");
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

  async fetchApplicationTaskData() {
    this.log("📡 Fetching Recruitee application task data from background");
    this.statusOverlay.addInfo("Fetching application data...");

    const success = this.safeSendPortMessage({ type: "GET_APPLICATION_TASK" });
    if (!success) {
      throw new Error("Failed to request application task data");
    }
  }

  // ========================================
  // RECRUITEE-SPECIFIC FORM HANDLING
  // ========================================

  async apply() {
    try {
      this.statusOverlay.addInfo("Starting to apply for Recruitee job");

      // Check if page is valid
      if (this.hasPageErrors()) {
        throw new SkipApplicationError(
          "Cannot start application: Page error or job no longer available"
        );
      }

      // Extract job ID from URL (Recruitee-specific)
      const urlParts = window.location.pathname.split("/");
      const jobId = urlParts[urlParts.length - 1] || "unknown";
      console.log("Extracted Recruitee job ID:", jobId);

      // Extract job description
      const jobDescription = this.extractJobDescription();

      console.log("Job description:", jobDescription);

      // Wait for page to fully load
      await this.wait(3000);

      // Check if we're on a job details page or application form page
      const applyButton = document.querySelector(
        'button[data-testid="header-tab-apply-button"], button[data-cy="apply-button-nav"], a.c-button--primary, a.c-button--apply, a.cta-button, button.c-button--apply'
      );
      if (applyButton) {
        this.statusOverlay.addInfo("Found apply button, clicking it");
        applyButton.click();
        await this.wait(3000);
      }

      // Find application form
      const form = this.findApplicationForm();
      if (!form) {
        throw new SkipApplicationError(
          "Cannot find Recruitee application form"
        );
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
        console.error("Error in Recruitee apply:", error);
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
      "Job on Recruitee";
    const companyName =
      UrlUtils.extractCompanyFromUrl(window.location.href, "recruitee") ||
      "Company on Recruitee";
    const location =
      DomUtils.extractText([
        ".job-location",
        ".c-job__info-item",
        '[data-ui="location"]',
      ]) || "Not specified";

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

    console.log("Recruitee application completed successfully");
    this.statusOverlay.addSuccess("Application completed successfully");
    this.statusOverlay.updateStatus("success");
  }

  async processApplicationForm(form, profile, jobDescription) {
    this.statusOverlay.addInfo(
      "Found Recruitee application form, beginning to fill out"
    );

    try {
      const isMultiStep = form.querySelector(".c-step, .steps-indicator");
      if (isMultiStep) {
        return await this.handleMultiStepForm(form, profile, jobDescription);
      }

      // Handle file uploads (resume) - do this first
      this.statusOverlay.addInfo("Handling file uploads...");
      await this.fileHandler.handleFileUploads(form, profile, jobDescription);

      // Use the new form handler's main method
      this.statusOverlay.addInfo("Processing form fields...");
      const result = await this.formHandler.processApplicationForm();

      if (result.success) {
        this.statusOverlay.addSuccess(
          "Successfully filled and submitted application form"
        );
        return true;
      } else {
        this.statusOverlay.addError(`Form processing failed: ${result.reason}`);
        return false;
      }
    } catch (error) {
      console.error("Error processing Recruitee application form:", error);
      this.statusOverlay.addError(
        "Error processing form: " + this.errorToString(error)
      );
      return false;
    }
  }

  async handleMultiStepForm(form, profile, jobDescription) {
    this.statusOverlay.addInfo(
      "Detected multi-step Recruitee application form"
    );

    try {
      // Handle resume upload - typically on first step
      await this.fileHandler.handleResumeUpload(profile, form);

      // Process each step until we reach the end
      let isComplete = false;
      let stepCount = 0;
      const maxSteps = 10; // Safety limit

      while (!isComplete && stepCount < maxSteps) {
        stepCount++;
        this.statusOverlay.addInfo(
          `Processing Recruitee form step ${stepCount}`
        );

        // Fill out visible form fields
        await this.formHandler.fillFormWithProfile(form, profile);

        // Handle required checkboxes
        await this.formHandler.handleRequiredCheckboxes(form);

        // Find next/submit button
        const nextButton = this.formHandler.findSubmitButton(form);
        if (!nextButton) {
          throw new ApplicationError(
            `Cannot find next/submit button on Recruitee step ${stepCount}`
          );
        }

        // Click the button
        this.statusOverlay.addInfo(
          `Clicking next/submit button on step ${stepCount}`
        );
        nextButton.click();

        // Wait for page to update
        await this.wait(3000);

        // Check if we're done (Recruitee-specific success indicators)
        const successMessage = document.querySelector(
          "div.application-confirmation, div.success-message, h1.success-message, div[class*='success'], div.thank-you, div[class*='thankyou'], div.c-application__done"
        );
        if (successMessage) {
          this.statusOverlay.addInfo(
            "Found success message, Recruitee application complete"
          );
          isComplete = true;
          return true;
        }

        // Check for errors
        const errorMessage = document.querySelector(
          ".error-message, .field_with_errors, .invalid-feedback"
        );
        if (errorMessage) {
          this.statusOverlay.addInfo(
            `Error on Recruitee step ${stepCount}: ${errorMessage.textContent.trim()}`
          );
        }

        // Find form again (might have changed)
        form = this.findApplicationForm();
        if (!form) {
          this.statusOverlay.addInfo(
            "Form no longer found, checking if Recruitee application completed"
          );

          if (
            document.body.textContent.includes("Thank you") ||
            document.body.textContent.includes("Successfully")
          ) {
            isComplete = true;
            return true;
          } else {
            throw new ApplicationError(
              "Recruitee form disappeared without success message"
            );
          }
        }
      }

      if (stepCount >= maxSteps) {
        throw new ApplicationError(
          "Exceeded maximum number of Recruitee form steps"
        );
      }

      return isComplete;
    } catch (error) {
      console.error("Error in Recruitee multi-step form:", error);
      throw error;
    }
  }

  // ========================================
  // RECRUITEE-SPECIFIC UTILITY METHODS
  // ========================================

  findApplicationForm() {
    // Recruitee-specific form selectors
    const recruiteeSelectors = [
      "form.c-form",
      "form#new_job_application",
      "form.careers-form",
      "form.application-form",
    ];

    return DomUtils.findForm(recruiteeSelectors);
  }

  extractJobDescription() {
    const recruiteeDescriptionSelectors = [
      ".c-job__description",
      ".job-description",
      ".description",
      '[data-ui="job-description"]',
      ".vacancy-description",
      "#job-details",
    ];

    let description = DomUtils.extractText(recruiteeDescriptionSelectors);

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
        UrlUtils.extractCompanyFromUrl(window.location.href, "recruitee") || "";
      description = `Job: ${jobTitle} at ${companyName}`;
    }

    return description;
  }

  hasPageErrors() {
    return (
      document.body.innerText.includes("Cannot GET") ||
      document.body.innerText.includes("404 Not Found") ||
      document.body.innerText.includes("No longer available")
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

    throw new Error("Timeout waiting for valid Recruitee page");
  }

  errorToString(e) {
    if (e instanceof Error) {
      return e.stack || e.message;
    }
    return String(e);
  }

  // ========================================
  // CLEANUP - Inherited from base class with Recruitee-specific additions
  // ========================================

  cleanup() {
    // Base class handles most cleanup
    super.cleanup();

    // Recruitee-specific cleanup if needed
    this.log("🧹 Recruitee-specific cleanup completed");
  }
}
