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

    this.aiService = new AIService({ apiHost: this.getApiHost() });
    this.applicationTracker = new ApplicationTrackerService({
      userId: this.userProfile?.userId,
      apiHost: this.getApiHost(),
    });
    this.userService = new UserService({ userId: this.userProfile?.userId });

    this.fileHandler = null;
    this.formHandler = null;
    this.searchProcessStarted = false;
  }

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

  /**
   * Extract just the UUID job ID from Ashby URLs
   * @param {string} url - The full URL
   * @returns {string|null} - The extracted job ID or null if not found
   */
  extractAshbyJobId(url) {
    try {
      // Match UUID pattern in Ashby URLs
      // Pattern: 8-4-4-4-12 hexadecimal characters separated by hyphens
      const uuidPattern = /\/([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i;
      const match = url.match(uuidPattern);

      if (match && match[1]) {
        this.log(`✅ Extracted Ashby job ID: ${match[1]} from URL: ${url}`);
        return match[1];
      }

      // Fallback: try to use the existing UrlUtils method
      const fallbackId = UrlUtils.extractJobId(url, "ashby");
      if (fallbackId && fallbackId !== url) {
        this.log(`✅ Extracted job ID using fallback method: ${fallbackId}`);
        return fallbackId;
      }

      this.log(`⚠️ Could not extract job ID from URL: ${url}`);
      return null;
    } catch (error) {
      this.log(`❌ Error extracting job ID from URL ${url}:`, error);
      return null;
    }
  }

  async setSessionContext(sessionContext) {
    try {
      this.sessionContext = sessionContext;
      this.hasSessionContext = true;

      if (sessionContext.sessionId) this.sessionId = sessionContext.sessionId;
      if (sessionContext.platform) this.platform = sessionContext.platform;
      if (sessionContext.userId) this.userId = sessionContext.userId;

      if (sessionContext.userProfile) {
        if (!this.userProfile || Object.keys(this.userProfile).length === 0) {
          this.userProfile = sessionContext.userProfile;
          this.log("👤 User profile loaded from session context");
        } else {
          this.userProfile = {
            ...this.userProfile,
            ...sessionContext.userProfile,
          };
          this.log("👤 User profile merged with session context");
        }
      }

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

      if (this.userProfile?.userId) {
        this.applicationTracker = new ApplicationTrackerService({
          userId: this.userProfile.userId,
          apiHost: this.getApiHost(),
        });
        this.userService = new UserService({ userId: this.userProfile.userId });
      }

      if (sessionContext.apiHost) {
        this.sessionApiHost = sessionContext.apiHost;
      }

      if (this.formHandler && this.userProfile) {
        this.formHandler.userData = this.userProfile;
      }

      this.log("✅ Ashby session context set successfully", {
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
      if (this.isRunning) {
        this.log("⚠️ Automation already running, ignoring duplicate start");
        return true;
      }

      this.isRunning = true;
      this.log("▶️ Starting Ashby automation");

      if (!this.userProfile && this.userId) {
        try {
          this.log("🔄 Attempting to fetch user profile during start...");
          this.userProfile = await this.userService.getUserDetails();
          this.log("✅ User profile fetched during start");
        } catch (error) {
          console.error("❌ Failed to fetch user profile during start:", error);
        }
      }

      this.config = { ...this.config, ...params };

      this.updateProgress({
        total: params.jobsToApply || 0,
        completed: 0,
        current: "Starting automation...",
      });

      await this.waitForPageLoad();
      await this.detectPageTypeAndStart();

      return true;
    } catch (error) {
      this.reportError(error, { action: "start" });
      this.isRunning = false;
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
    return url.includes("/application") || super.isApplicationPage(url);
  }

  getJobTaskMessageType() {
    return "SEND_CV_TASK";
  }

  async initialize() {
    await super.initialize();

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

      if (data.profile && !this.userProfile) {
        this.userProfile = data.profile;
        this.log("👤 User profile loaded from search task data");
      }

      this.log("✅ Ashby search data initialized:", this.searchData);
      this.statusOverlay.addSuccess("Search initialization complete");

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
      this.processSearchTaskData(data);
    } else if (data && data.profile !== undefined && !this.userProfile) {
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
      this.log("📊 Processing send CV task data:", {
        hasData: !!data,
        hasProfile: !!data?.profile,
      });

      if (data?.profile && !this.userProfile) {
        this.userProfile = data.profile;
        this.log("👤 User profile set from background response");
      }

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

      if (this.formHandler && this.userProfile) {
        this.formHandler.userData = this.userProfile;
      }

      this.statusOverlay.addSuccess("Application initialization complete");

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

  async detectPageTypeAndStart() {
    const url = window.location.href;
    this.log(`🔍 Detecting page type for: ${url}`);

    if (url.includes("google.com/search")) {
      await this.startSearchProcess();
    } else if (this.isValidJobPage(url)) {
      await this.startApplicationProcess();
    } else {
      this.log("⚠️ Not a valid job page, skipping to next job");
      this.skipToNextJob("Not a valid job page");
    }
  }

  async startSearchProcess() {
    try {
      if (this.searchProcessStarted) {
        this.log("⚠️ Search process already started, ignoring duplicate");
        return;
      }

      this.searchProcessStarted = true;
      this.statusOverlay.addInfo("Starting job search process");
      this.statusOverlay.updateStatus("searching");

      await this.fetchSearchTaskData();
    } catch (error) {
      this.searchProcessStarted = false;
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

  async startApplicationProcess() {
    try {
      this.statusOverlay.addInfo("Starting application process");
      this.statusOverlay.updateStatus("applying");

      if (!this.userProfile) {
        await this.fetchApplicationTaskData();
      }

      if (!this.userProfile) {
        this.statusOverlay.addError(
          "No user profile available - automation may fail"
        );
      }

      await this.wait(3000);
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

      this.closeCurrentTabAndMoveToNext("Application error occurred");
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

  async waitForUrlChange(originalUrl, expectedPath, timeout = 10000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      await this.wait(500);

      const currentUrl = window.location.href;

      if (currentUrl !== originalUrl && currentUrl.includes(expectedPath)) {
        return true;
      }
    }

    console.warn(
      `⚠️ URL did not change to contain '${expectedPath}' within ${timeout}ms`
    );
    return false;
  }

  async navigateToApplicationTab() {
    try {
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

      const currentUrl = window.location.href;

      applicationTab.click();

      const navigationSuccess = await this.waitForUrlChange(
        currentUrl,
        "/application",
        10000
      );

      if (!navigationSuccess) {
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
      if (this.hasPageErrors()) {
        throw new SkipApplicationError(
          "Cannot start application: Page error or job no longer available"
        );
      }

      // Use the new method to extract just the UUID job ID
      const jobId = this.extractAshbyJobId(window.location.href);
      if (!jobId) {
        throw new SkipApplicationError(
          "Could not extract valid job ID from URL"
        );
      }

      this.log("✅ Extracted Ashby job ID:", jobId);

      try {
        const existingApplication = await this.applicationTracker.checkIfAlreadyApplied(
          window.location.href,
          this.platform
        );

        if (existingApplication) {
          this.log("✅ Job already applied to, skipping");
          throw new SkipApplicationError(
            `Already applied to this job on ${new Date(existingApplication.appliedAt).toLocaleDateString()}`
          );
        }
      } catch (error) {
        this.log("⚠️ Could not check application status:", error.message);
      }

      await this.wait(3000);

      const jobDescription = this.extractJobDescription();

      const applicationTabNavigated = await this.navigateToApplicationTab();
      if (!applicationTabNavigated) {
        throw new SkipApplicationError(
          "Cannot find or navigate to Application tab"
        );
      }

      this.statusOverlay.addInfo("Successfully navigated to Application tab");

      await this.wait(2000);

      const form = this.findApplicationForm();
      if (!form) {
        throw new SkipApplicationError("Cannot find Ashby application form");
      }

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
      jobId, // This will now be just the UUID (e.g., "2ec11991-e231-4532-9064-abf610c2edc5")
      title: jobTitle,
      company: companyName,
      location,
      jobUrl: window.location.href, // This will be the full URL
      salary: "Not specified",
      workplace: "Not specified",
      postedDate: "Not specified",
      applicants: "Not specified",
      platform: this.platform,
      appliedAt: new Date().toISOString(),
      status: "applied",
    };

    try {
      await this.applicationTracker.saveJob(jobData);
      this.log("✅ Job saved to application tracker with ID:", jobId);

      this.updateApplicationCount();
    } catch (error) {
      this.log("❌ Failed to save job to tracker:", error);
    }

    this.safeSendPortMessage({
      type: "SEND_CV_TASK_DONE",
      data: jobData,
    });

    this.closeCurrentTabAndMoveToNext("Application completed successfully");

    this.log("Ashby application completed successfully");
    this.statusOverlay.addSuccess("Application completed successfully");
    this.statusOverlay.updateStatus("success");
  }

  async processApplicationForm(form, profile, jobDescription) {
    this.statusOverlay.addInfo(
      "Found Ashby application form, beginning to fill out"
    );

    try {
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

      await this.fileHandler.handleFileUploads(form, profile, jobDescription);

      await this.formHandler.fillFormWithProfile(profile);

      const submitResult = await this.formHandler.submitAndVerify();

      await this.wait(2000);

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

  checkSubmissionStatus() {
    const status = {
      isSuccess: false,
      hasErrors: false,
      hasFailure: false,
      errors: [],
      failureMessage: "",
    };

    const successContainer = document.querySelector(
      ".ashby-application-form-success-container"
    );
    if (successContainer && this.isElementVisible(successContainer)) {
      status.isSuccess = true;
      this.log("✅ Found success message after form submission");
    }

    const errorsList = document.querySelector("ul._errors_oj0x8_78");
    if (errorsList && this.isElementVisible(errorsList)) {
      status.hasErrors = true;
      const errorItems = errorsList.querySelectorAll("li._error_oj0x8_78 p");
      status.errors = Array.from(errorItems).map((item) =>
        item.textContent.trim()
      );
      this.log("⚠️ Found error messages after form submission:", status.errors);
    }

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

  closeCurrentTabAndMoveToNext(reason) {
    this.log(`🔄 Closing current tab and moving to next job: ${reason}`);

    this.applicationState.isApplicationInProgress = false;
    this.applicationState.applicationStartTime = null;

    if (window.location.href.includes("/application") || window.location.href.includes("/apply")) {
      try {
        window.close();
      } catch (error) {
        this.log("Could not close tab automatically:", error);
      }
    }

    setTimeout(() => {
      this.moveToNextJob();
    }, 1000);
  }

  moveToNextJob() {
    this.log("🎯 Moving to next job");

    this.safeSendPortMessage({
      type: "SEARCH_NEXT_READY",
      data: { status: "ready" }
    });
  }

  skipToNextJob(reason) {
    this.log(`⏭️ Skipping to next job: ${reason}`);
    this.statusOverlay.addWarning(`Skipping job: ${reason}`);

    this.safeSendPortMessage({
      type: "SEND_CV_TASK_SKIP",
      data: reason,
    });

    this.closeCurrentTabAndMoveToNext(`Skipped: ${reason}`);
  }

  updateApplicationCount() {
    if (this.searchData) {
      this.searchData.current++;
      this.updateProgress({
        total: this.searchData.limit,
        completed: this.searchData.current,
        current: `Applied to ${this.searchData.current} jobs`,
      });
    }
  }

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
      return true;
    }
  }

  findApplicationForm() {
    const ashbySelectors = [
      "._jobPostingForm_oj0x8_399",
      ".ashby-application-form-container",
      ".ashby-application-form",
      'form[class*="ashby"]',
      'div[class*="jobPostingForm"]',
    ];

    for (const selector of ashbySelectors) {
      const formContainer = document.querySelector(selector);
      if (formContainer && this.isElementVisible(formContainer)) {
        return formContainer;
      }
    }

    return DomUtils.findForm([]);
  }

  extractJobDescription() {
    const ashbyDescriptionSelectors = [
      ".ashby-job-posting-overview",
      ".job-description",
      ".description",
      ".job-posting-description",
      '[data-testid="job-description"]',
      ".job-details",
      ".content",
      ".ashby-job-posting-content",
      ".ashby-job-posting-overview-section",
      ".overview-content",
    ];

    let description = DomUtils.extractText(ashbyDescriptionSelectors);

    if (!description) {
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

    if (!description) {
      const mainContent = document.querySelector(
        "main, #content, .content, .job-content, .ashby-job-posting"
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

    this.log(
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

  platformSpecificUrlNormalization(url) {
    return url.replace(/\/apply$/, "");
  }

  cleanup() {
    super.cleanup();
    this.log("🧹 Ashby-specific cleanup completed");
  }
}