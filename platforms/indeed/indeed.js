// platforms/indeed/indeed.js
import BasePlatformAutomation from "../../shared/base/base-platform-automation.js";
import { UrlUtils, DomUtils, FormUtils } from "../../shared/utilities/index.js";
import {
  AIService,
  ApplicationTrackerService,
  UserService,
} from "../../services/index.js";

export default class IndeedPlatform extends BasePlatformAutomation {
  constructor(config) {
    super(config);
    this.platform = "indeed";
    this.baseUrl = "https://www.indeed.com";

    // Initialize Indeed-specific services
    this.aiService = new AIService({ apiHost: this.getApiHost() });
    this.applicationTracker = new ApplicationTrackerService({
      userId: this.userId,
    });
    this.userService = new UserService({ userId: this.userId });

    this.formHandler = null;
    this.fileHandler = null;
    this.cachedJobDescription = null;
    this.processedJobCards = new Set();
  }

  // ========================================
  // PLATFORM-SPECIFIC IMPLEMENTATIONS
  // ========================================

  getPlatformDomains() {
    return ["https://www.indeed.com", "https://smartapply.indeed.com"];
  }

  getSearchLinkPattern() {
    return /^https:\/\/(www\.)?indeed\.com\/(viewjob|job|jobs|apply).*$/;
  }

  isValidJobPage(url) {
    return (
      /^https:\/\/(www\.)?indeed\.com\/(viewjob|job|jobs|apply)/.test(url) ||
      /^https:\/\/smartapply\.indeed\.com\/beta\/indeedapply\/form/.test(url)
    );
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
    return (
      url.includes("smartapply.indeed.com") ||
      url.includes("indeed.com/apply") ||
      url.includes("indeed.com/viewjob")
    );
  }

  getJobTaskMessageType() {
    return "openJobInNewTab";
  }

  platformSpecificUrlNormalization(url) {
    // Remove Indeed-specific parameters for consistent comparison
    return url
      .replace(/[?&](jk|tk|from|advn)=[^&]*/g, "")
      .replace(/[?&]+$/, "");
  }

  // ========================================
  // INDEED-SPECIFIC INITIALIZATION
  // ========================================

  async initialize() {
    await super.initialize();

    // Import Indeed-specific handlers
    try {
      const { default: IndeedFormHandler } = await import(
        "./indeed-form-handler.js"
      );
      const { default: IndeedFileHandler } = await import(
        "./indeed-file-handler.js"
      );

      this.formHandler = new IndeedFormHandler({
        logger: (message) => this.statusOverlay.addInfo(message),
        host: this.getApiHost(),
        userData: this.userProfile || {},
        jobDescription: "",
      });

      this.fileHandler = new IndeedFileHandler({
        statusService: this.statusOverlay,
        apiHost: this.getApiHost(),
      });

      this.statusOverlay.addSuccess("Indeed-specific components initialized");
    } catch (error) {
      this.log("⚠️ Could not load Indeed handlers:", error);
      this.statusOverlay.addWarning("Indeed handlers not available");
    }
  }

  async start(params = {}) {
    try {
      this.isRunning = true;
      this.log("🚀 Starting Indeed automation");
      this.statusOverlay.addInfo("Starting Indeed automation");

      // Ensure user profile is available
      if (!this.userProfile && this.userId) {
        try {
          this.userProfile = await this.userService.getUserDetails();
          this.statusOverlay.addSuccess("User profile loaded");

          if (this.formHandler && this.userProfile) {
            this.formHandler.userData = this.userProfile;
          }
        } catch (error) {
          this.statusOverlay.addWarning(
            "Failed to load user profile - automation may have limited functionality"
          );
        }
      }

      this.config = { ...this.config, ...params };
      await this.waitForPageLoad();
      await this.detectPageTypeAndStart();
    } catch (error) {
      this.reportError(error, { phase: "start" });
    }
  }

  async detectPageTypeAndStart() {
    const url = window.location.href;
    this.log(`🔍 Detecting page type for: ${url}`);

    if (url.includes("google.com/search")) {
      this.statusOverlay.addInfo("Google search page detected");
      await this.startSearchProcess();
    } else if (this.isIndeedJobPage(url)) {
      this.statusOverlay.addInfo("Indeed job page detected");
      await this.startApplicationProcess();
    } else if (this.isIndeedSearchPage(url)) {
      this.statusOverlay.addInfo("Indeed search page detected");
      await this.startJobSearchProcess();
    } else {
      this.log("❓ Unknown page type, waiting for navigation");
      await this.waitForValidPage();
    }
  }

  // ========================================
  // INDEED-SPECIFIC PAGE DETECTION
  // ========================================

  isIndeedJobPage(url) {
    return (
      /^https:\/\/(www\.)?indeed\.com\/(viewjob|job)/.test(url) ||
      /^https:\/\/smartapply\.indeed\.com\/beta\/indeedapply\/form/.test(url)
    );
  }

  isIndeedSearchPage(url) {
    return /^https:\/\/(www\.)?indeed\.com\/jobs/.test(url);
  }

  isIndeedApplicationPage(url) {
    return /^https:\/\/smartapply\.indeed\.com\/beta\/indeedapply\/form/.test(
      url
    );
  }

  // ========================================
  // INDEED-SPECIFIC SEARCH LOGIC
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

  async startJobSearchProcess() {
    try {
      this.statusOverlay.addInfo("Starting job search on Indeed results page");
      this.statusOverlay.updateStatus("searching");

      // Get search task data from background
      await this.fetchSearchTaskData();
    } catch (error) {
      this.reportError(error, { phase: "jobSearch" });
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

      setTimeout(() => this.searchNext(), 1000);
    } catch (error) {
      this.log("❌ Error processing search task data:", error);
      this.statusOverlay.addError(
        "Error processing search task data: " + error.message
      );
    }
  }

  // Override the base search logic for Indeed-specific job card handling
  async searchNext() {
    try {
      this.log("Executing Indeed searchNext");

      if (this.applicationState.isApplicationInProgress) {
        this.log("Application in progress, not searching for next job");
        this.statusOverlay.addInfo(
          "Application in progress, waiting to complete..."
        );
        this.safeSendPortMessage({ type: "CHECK_APPLICATION_STATUS" });
        return;
      }

      this.statusOverlay.addInfo("Searching for job cards...");

      // Check if we're on Indeed search results page
      if (this.isIndeedSearchPage(window.location.href)) {
        await this.processIndeedJobCards();
      } else {
        // Fall back to standard Google search link processing
        await super.searchNext();
      }
    } catch (err) {
      this.log("Error in Indeed searchNext:", err);
      this.statusOverlay.addError("Error in search: " + err.message);
      this.resetApplicationStateOnError();
      setTimeout(() => this.searchNext(), 5000);
    }
  }

  async processIndeedJobCards() {
    const jobCards = this.getIndeedJobCards();
    this.log(`Found ${jobCards.length} job cards on Indeed`);

    if (jobCards.length === 0) {
      await this.handleNoJobCardsFound();
      return;
    }

    // Find unprocessed job card
    const unprocessedCard = this.findUnprocessedJobCard(jobCards);

    if (unprocessedCard) {
      await this.processIndeedJobCard(unprocessedCard);
    } else {
      await this.handleNoUnprocessedJobCards();
    }
  }

  getIndeedJobCards() {
    const selectors = [
      ".job_seen_beacon",
      '[data-testid="job-tile"]',
      ".jobsearch-SerpJobCard",
      ".slider_container .slider_item",
    ];

    for (const selector of selectors) {
      const cards = document.querySelectorAll(selector);
      if (cards.length > 0) {
        return Array.from(cards);
      }
    }

    return [];
  }

  findUnprocessedJobCard(jobCards) {
    for (const card of jobCards) {
      const cardId = this.getJobCardId(card);

      if (this.processedJobCards.has(cardId)) {
        continue;
      }

      const jobUrl = this.getJobUrlFromCard(card);
      if (!jobUrl) continue;

      const normalizedUrl = this.normalizeUrlFully(jobUrl);

      // Check if already processed
      if (this.isLinkProcessed(normalizedUrl)) {
        this.processedJobCards.add(cardId);
        continue;
      }

      return { card, url: jobUrl, cardId };
    }

    return null;
  }

  getJobCardId(card) {
    const dataJk = card.getAttribute("data-jk");
    if (dataJk) return dataJk;

    const link = card.querySelector('a[href*="viewjob?jk="]');
    if (link) {
      const match = link.href.match(/jk=([^&]+)/);
      if (match) return match[1];
    }

    // Fallback to position in DOM
    const allCards = this.getIndeedJobCards();
    return `card-${Array.from(allCards).indexOf(card)}`;
  }

  getJobUrlFromCard(card) {
    const selectors = [
      'a[href*="viewjob?jk="]',
      ".jobTitle a",
      '[data-testid="job-title"] a',
      "h2 a",
    ];

    for (const selector of selectors) {
      const link = card.querySelector(selector);
      if (link && link.href) {
        return link.href;
      }
    }

    return null;
  }

  async processIndeedJobCard(jobData) {
    const { card, url, cardId } = jobData;

    this.statusOverlay.addSuccess("Found Indeed job to apply: " + url);
    this.processedJobCards.add(cardId);

    if (this.applicationState.isApplicationInProgress) {
      this.log("Application became in progress, aborting new task");
      return;
    }

    // Visual feedback
    this.markJobCardAsProcessing(card);

    // Set application state
    this.applicationState.isApplicationInProgress = true;
    this.applicationState.applicationStartTime = Date.now();

    if (!this.applicationState.processedUrls) {
      this.applicationState.processedUrls = new Set();
    }
    this.applicationState.processedUrls.add(this.normalizeUrlFully(url));

    this.setStuckDetectionTimeout();

    try {
      this.safeSendPortMessage({
        type: this.getJobTaskMessageType(),
        data: {
          url,
          title: this.getJobTitleFromCard(card) || "Job Application",
        },
      });
    } catch (err) {
      this.handleJobTaskError(err, url, card);
    }
  }

  markJobCardAsProcessing(card) {
    try {
      card.style.border = "2px solid #4CAF50";
      card.style.backgroundColor = "rgba(76, 175, 80, 0.1)";

      const indicator = document.createElement("div");
      indicator.className = "processing-indicator";
      indicator.style.cssText = `
        position: absolute;
        top: 5px;
        right: 5px;
        background: #4CAF50;
        color: white;
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 11px;
        z-index: 10;
      `;
      indicator.textContent = "Processing...";

      card.style.position = "relative";
      card.appendChild(indicator);
    } catch (error) {
      this.log("Error marking job card:", error);
    }
  }

  getJobTitleFromCard(card) {
    const selectors = [
      ".jobTitle a span[title]",
      '[data-testid="job-title"] a span',
      "h2 a span[title]",
      ".jobTitle",
    ];

    for (const selector of selectors) {
      const element = card.querySelector(selector);
      if (element) {
        return element.getAttribute("title") || element.textContent?.trim();
      }
    }

    return "Job Application";
  }

  async handleNoJobCardsFound() {
    this.statusOverlay.addInfo("No job cards found, trying to load more...");

    const nextButton = document.querySelector('a[aria-label="Next Page"]');
    if (nextButton && !nextButton.getAttribute("aria-disabled")) {
      this.statusOverlay.addInfo('Clicking "Next Page" button');
      nextButton.click();
      setTimeout(() => {
        if (!this.applicationState.isApplicationInProgress) {
          this.searchNext();
        }
      }, 3000);
    } else {
      this.statusOverlay.addSuccess("All Indeed jobs processed!");
      this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
    }
  }

  async handleNoUnprocessedJobCards() {
    await this.handleNoJobCardsFound();
  }

  // ========================================
  // INDEED-SPECIFIC APPLICATION LOGIC
  // ========================================

  async startApplicationProcess() {
    try {
      this.log("📝 Starting Indeed application process");
      this.statusOverlay.addInfo("Starting application process");

      if (!this.userProfile) {
        this.log("⚠️ No user profile available, attempting to fetch...");
        await this.fetchSendCvTaskData();
      }

      // Check for success page first
      if (this.checkIndeedSubmissionSuccess()) {
        await this.handleAlreadyApplied();
        return;
      }

      // Check if already applied
      if (this.checkAlreadyApplied()) {
        await this.handleAlreadyApplied();
        return;
      }

      await this.apply();
    } catch (error) {
      this.reportError(error, { phase: "application" });
      this.handleApplicationError(error);
    }
  }

  async apply() {
    try {
      this.statusOverlay.addInfo("Starting Indeed application process");
      this.statusOverlay.updateStatus("applying");

      if (!this.validateHandlers()) {
        throw new Error("Required handlers are not properly initialized");
      }

      if (this.hasPageErrors()) {
        throw new Error("Cannot start application: Page error detected");
      }

      const form = this.findIndeedApplicationForm();
      if (!form) {
        await this.wait(2000);
        const formAfterWait = this.findIndeedApplicationForm();
        if (!formAfterWait) {
          throw new Error("Cannot find Indeed application form");
        }
        return await this.processApplicationForm(formAfterWait);
      }

      return await this.processApplicationForm(form);
    } catch (e) {
      this.log("Error in Indeed apply:", e);
      throw new Error(
        "Error during application process: " + this.errorToString(e)
      );
    }
  }

  findIndeedApplicationForm() {
    const indeedSelectors = [
      'form[action*="indeed"]',
      'form[action*="apply"]',
      "form.ia-ApplyFormScreen",
      "form#ia-container form",
      ".indeed-apply-form",
      'form[data-testid="application-form"]',
    ];

    return DomUtils.findForm(indeedSelectors);
  }

  async processApplicationForm(form) {
    this.statusOverlay.addInfo("Found Indeed application form, filling it out");

    const jobDescription = await this.extractIndeedJobDescription();

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

    const submitButton = FormUtils.findSubmitButton(form);
    if (!submitButton) {
      throw new Error("Cannot find submit button");
    }

    return await this.submitForm(submitButton);
  }

  async submitForm(submitButton) {
    this.statusOverlay.addInfo("Submitting Indeed application...");

    DomUtils.scrollToElement(submitButton);
    await this.wait(600);

    try {
      submitButton.click();
      this.statusOverlay.addSuccess("Clicked submit button");
    } catch (e) {
      this.statusOverlay.addError(
        "Failed to click submit button: " + e.message
      );
    }
    return true;
  }

  // ========================================
  // INDEED-SPECIFIC UTILITY METHODS
  // ========================================

  async extractIndeedJobDescription() {
    try {
      this.log("🔍 Extracting Indeed job details...");
      this.statusOverlay.addInfo("Extracting job details...");

      const jobDescription = {
        title: DomUtils.extractText([
          ".jobsearch-JobInfoHeader-title",
          '[data-testid="job-title"]',
          "h1",
        ]),
        company: DomUtils.extractText([
          ".jobsearch-InlineCompanyRating",
          '[data-testid="company-name"]',
          ".companyName",
        ]),
        location: DomUtils.extractText([
          ".jobsearch-JobLocationDropdown",
          '[data-testid="job-location"]',
          ".locationsContainer",
        ]),
        salary: DomUtils.extractText([
          ".salary-snippet",
          '[data-testid="salary-snippet"]',
        ]),
      };

      const fullDescriptionElement = document.querySelector(
        '#jobDescriptionText, .jobsearch-jobDescriptionText, [data-testid="job-description"]'
      );

      if (fullDescriptionElement) {
        jobDescription.fullDescription =
          fullDescriptionElement.textContent.trim();
      }

      this.log("✅ Indeed job details extracted:", jobDescription);
      return jobDescription;
    } catch (error) {
      this.log("❌ Error extracting Indeed job details:", error);
      return { title: document.title || "Job Position" };
    }
  }

  checkIndeedSubmissionSuccess() {
    // Check URL for success indicators
    const url = window.location.href;
    if (
      url.includes("success") ||
      url.includes("confirmation") ||
      url.includes("applied")
    ) {
      this.statusOverlay.addSuccess(
        "URL indicates success - application submitted"
      );
      return true;
    }

    // Check for success messages
    const successSelectors = [
      ".ia-ApplicationMessage-successMessage",
      ".ia-JobActionConfirmation-container",
      ".jobsearch-ApplyComplete",
    ];

    for (const selector of successSelectors) {
      if (document.querySelector(selector)) {
        this.statusOverlay.addSuccess(
          "Success message found - application submitted"
        );
        return true;
      }
    }

    return false;
  }

  checkAlreadyApplied() {
    const pageText = document.body.innerText.toLowerCase();

    const alreadyAppliedTexts = [
      "you've applied to this job",
      "already applied",
      "application submitted",
      "you applied",
    ];

    return alreadyAppliedTexts.some((text) => pageText.includes(text));
  }

  validateHandlers() {
    const issues = [];

    if (!this.statusOverlay) issues.push("Status overlay not initialized");
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
      document.body.innerText.includes("Page not found") ||
      document.body.innerText.includes("Error") ||
      window.location.href.includes("error")
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
      this.log("📊 Processing send CV task data:", data);

      if (data?.profile && !this.userProfile) {
        this.userProfile = data.profile;
        this.log("👤 User profile set from background response");
      }

      if (this.formHandler && this.userProfile) {
        this.formHandler.userData = this.userProfile;
      }

      this.statusOverlay.addSuccess("Apply initialization complete");
    } catch (error) {
      this.log("❌ Error processing send CV task data:", error);
      this.statusOverlay.addError("Error processing CV data: " + error.message);
    }
  }

  // ========================================
  // MESSAGE HANDLING
  // ========================================

  handlePlatformSpecificMessage(type, data) {
    switch (type) {
      case "SUCCESS":
        this.handleSuccessMessage(data);
        break;

      case "APPLICATION_STATUS_RESPONSE":
        this.handleApplicationStatusResponse(data);
        break;

      default:
        super.handlePlatformSpecificMessage(type, data);
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

  errorToString(e) {
    if (!e) return "Unknown error (no details)";
    if (e instanceof Error) {
      return e.message + (e.stack ? `\n${e.stack}` : "");
    }
    return String(e);
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

    throw new Error("Timeout waiting for valid page");
  }

  cleanup() {
    super.cleanup();
    this.processedJobCards.clear();
    this.cachedJobDescription = null;
    this.log("🧹 Indeed-specific cleanup completed");
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

      // Update services with user context only if userId changed
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

      console.log("✅ Indeed session context set successfully", {
        hasUserProfile: !!this.userProfile,
        userId: this.userId,
        sessionId: this.sessionId,
        profileName: this.userProfile?.name || this.userProfile?.firstName,
        profileEmail: this.userProfile?.email,
      });
    } catch (error) {
      console.error("❌ Error setting Indeed session context:", error);
      this.statusOverlay?.addError(
        "❌ Error setting session context: " + error.message
      );
    }
  }

  isIndeedJobListingPage(url) {
    return (
      /^https:\/\/(www\.)?indeed\.com\/viewjob/.test(url) &&
      !url.includes("indeed.com/apply")
    );
  }

  isIndeedApplicationPage(url) {
    return (
      /^https:\/\/smartapply\.indeed\.com\/beta\/indeedapply\/form/.test(url) ||
      url.includes("indeed.com/apply")
    );
  }

  async handleJobListingPage() {
    this.statusOverlay.addInfo(
      "Indeed job listing page detected - clicking Apply button"
    );

    this.cachedJobDescription = await this.extractIndeedJobDescription();

    const applyButton = this.findIndeedApplyButton();
    if (!applyButton) {
      throw new Error("Cannot find Apply button on Indeed job listing page");
    }

    console.log("🖱️ Clicking Apply button");
    applyButton.click();

    await this.waitForIndeedApplicationPage();
    this.statusOverlay.addSuccess("Application page loaded successfully");
  }

  findIndeedApplyButton() {
    const applySelectors = [
      'a[href*="/apply"]',
      ".indeed-apply-button",
      ".indeedApplyButton",
      "a[data-jk]",
      ".jobsearch-SerpJobCard .result .indeedApplyButton",
      ".jobsearch-IndeedApplyButton-buttonWrapper a",
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

  async waitForIndeedApplicationPage(timeout = 10000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (this.isIndeedApplicationPage(window.location.href)) {
        const form = this.findIndeedApplicationForm();
        if (form) {
          return true;
        }
      }
      await this.wait(500);
    }

    throw new Error("Timeout waiting for Indeed application page to load");
  }

  async handleAlreadyApplied() {
    const jobId = UrlUtils.extractJobId(window.location.href, "indeed");
    const jobDetails = await this.extractIndeedJobDescription();

    this.safeSendPortMessage({
      type: "SEND_CV_TASK_DONE",
      data: {
        jobId: jobId,
        title: jobDetails.title || "Job on Indeed",
        company: jobDetails.company || "Company on Indeed",
        location: jobDetails.location || "Not specified",
        jobUrl: window.location.href,
        platform: "indeed",
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
}
