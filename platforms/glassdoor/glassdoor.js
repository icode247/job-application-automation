// platforms/glassdoor/glassdoor.js
import BasePlatformAutomation from "../../shared/base/base-platform-automation.js";
import { UrlUtils, DomUtils, FormUtils } from "../../shared/utilities/index.js";
import {
  AIService,
  ApplicationTrackerService,
  UserService,
} from "../../services/index.js";

export default class GlassdoorPlatform extends BasePlatformAutomation {
  constructor(config) {
    super(config);
    this.platform = "glassdoor";
    this.baseUrl = "https://www.glassdoor.com";

    // Initialize Glassdoor-specific services
    this.aiService = new AIService({ apiHost: this.getApiHost() });
    this.applicationTracker = new ApplicationTrackerService({
      userId: this.userId,
    });
    this.userService = new UserService({ userId: this.userId });

    this.formHandler = null;
    this.fileHandler = null;
    this.cachedJobDescription = null;
    this.processedJobCards = new Set();
    this.modalObserver = null;
  }

  // ========================================
  // PLATFORM-SPECIFIC IMPLEMENTATIONS
  // ========================================

  getPlatformDomains() {
    return ["https://www.glassdoor.com"];
  }

  getSearchLinkPattern() {
    return /^https:\/\/(www\.)?glassdoor\.com\/(job|Job|partner|apply).*$/;
  }

  isValidJobPage(url) {
    return /^https:\/\/(www\.)?glassdoor\.com\/(job|Job|partner|apply)/.test(
      url
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
      url.includes("glassdoor.com/apply") ||
      url.includes("glassdoor.com/job/apply") ||
      document.querySelector(".jobsOverlayModal, .modal-content form")
    );
  }

  getJobTaskMessageType() {
    return "openJobInNewTab";
  }

  platformSpecificUrlNormalization(url) {
    // Remove Glassdoor-specific parameters
    return url
      .replace(/[?&](jobListingId|pos|ao|s|guid|src|t|vt|ea|ei|ko)=[^&]*/g, "")
      .replace(/[?&]+$/, "");
  }

  // ========================================
  // GLASSDOOR-SPECIFIC INITIALIZATION
  // ========================================

  async initialize() {
    await super.initialize();

    // Import Glassdoor-specific handlers
    try {
      const { default: GlassdoorFormHandler } = await import(
        "./glassdoor-form-handler.js"
      );
      const { default: GlassdoorFileHandler } = await import(
        "./glassdoor-file-handler.js"
      );

      this.formHandler = new GlassdoorFormHandler({
        logger: (message) => this.statusOverlay.addInfo(message),
        host: this.getApiHost(),
        userData: this.userProfile || {},
        jobDescription: "",
      });

      this.fileHandler = new GlassdoorFileHandler({
        statusService: this.statusOverlay,
        apiHost: this.getApiHost(),
      });

      this.statusOverlay.addSuccess(
        "Glassdoor-specific components initialized"
      );
    } catch (error) {
      this.log("⚠️ Could not load Glassdoor handlers:", error);
      this.statusOverlay.addWarning("Glassdoor handlers not available");
    }

    // Set up modal observer for Glassdoor's modal-based applications
    this.setupModalObserver();
  }

  setupModalObserver() {
    this.modalObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check for Glassdoor application modal
              const modal =
                node.querySelector(".jobsOverlayModal, .modal-content form") ||
                (node.classList?.contains("jobsOverlayModal") ? node : null);

              if (modal) {
                this.log("📋 Glassdoor application modal detected");
                this.statusOverlay.addInfo("Application modal opened");
                setTimeout(() => this.handleModalApplication(modal), 1000);
              }
            }
          }
        }
      }
    });

    this.modalObserver.observe(document.body, {
      childList: true,
      subtree: true,
    });
  }

  async start(params = {}) {
    try {
      this.isRunning = true;
      this.log("🚀 Starting Glassdoor automation");
      this.statusOverlay.addInfo("Starting Glassdoor automation");

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
    } else if (this.isGlassdoorJobPage(url)) {
      this.statusOverlay.addInfo("Glassdoor job page detected");
      await this.startApplicationProcess();
    } else if (this.isGlassdoorSearchPage(url)) {
      this.statusOverlay.addInfo("Glassdoor search page detected");
      await this.startJobSearchProcess();
    } else {
      this.log("❓ Unknown page type, waiting for navigation");
      await this.waitForValidPage();
    }
  }

  // ========================================
  // GLASSDOOR-SPECIFIC PAGE DETECTION
  // ========================================

  isGlassdoorJobPage(url) {
    return (
      /^https:\/\/(www\.)?glassdoor\.com\/(job|Job|partner)/.test(url) &&
      !url.includes("/jobs.htm")
    );
  }

  isGlassdoorSearchPage(url) {
    return (
      /^https:\/\/(www\.)?glassdoor\.com\/(Job\/|job\/)/.test(url) ||
      url.includes("glassdoor.com/Job/jobs.htm")
    );
  }

  isGlassdoorApplicationPage(url) {
    return (
      url.includes("glassdoor.com/apply") ||
      url.includes("smart-apply-action=POST_APPLY")
    );
  }

  // ========================================
  // GLASSDOOR-SPECIFIC SEARCH LOGIC
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
      this.statusOverlay.addInfo(
        "Starting job search on Glassdoor results page"
      );
      this.statusOverlay.updateStatus("searching");

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

  // Override the base search logic for Glassdoor-specific job card handling
  async searchNext() {
    try {
      this.log("Executing Glassdoor searchNext");

      if (this.applicationState.isApplicationInProgress) {
        this.log("Application in progress, not searching for next job");
        this.statusOverlay.addInfo(
          "Application in progress, waiting to complete..."
        );
        this.safeSendPortMessage({ type: "CHECK_APPLICATION_STATUS" });
        return;
      }

      this.statusOverlay.addInfo("Searching for job cards...");

      // Check if we're on Glassdoor search results page
      if (this.isGlassdoorSearchPage(window.location.href)) {
        await this.processGlassdoorJobCards();
      } else {
        // Fall back to standard Google search link processing
        await super.searchNext();
      }
    } catch (err) {
      this.log("Error in Glassdoor searchNext:", err);
      this.statusOverlay.addError("Error in search: " + err.message);
      this.resetApplicationStateOnError();
      setTimeout(() => this.searchNext(), 5000);
    }
  }

  async processGlassdoorJobCards() {
    const jobCards = this.getGlassdoorJobCards();
    this.log(`Found ${jobCards.length} job cards on Glassdoor`);

    if (jobCards.length === 0) {
      await this.handleNoJobCardsFound();
      return;
    }

    // Find unprocessed job card
    const unprocessedCard = this.findUnprocessedJobCard(jobCards);

    if (unprocessedCard) {
      await this.processGlassdoorJobCard(unprocessedCard);
    } else {
      await this.handleNoUnprocessedJobCards();
    }
  }

  getGlassdoorJobCards() {
    const selectors = [
      ".JobsList_jobListItem__wjTHv",
      'li[data-test="jobListing"]',
      ".react-job-listing",
      ".job-search-card",
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

      // Check for Easy Apply only
      if (!this.hasEasyApply(card)) {
        this.processedJobCards.add(cardId);
        this.markJobCardAsSkipped(card, "No Easy Apply");
        continue;
      }

      return { card, url: jobUrl, cardId };
    }

    return null;
  }

  getJobCardId(card) {
    const dataJobId =
      card.getAttribute("data-jobid") || card.getAttribute("data-id");
    if (dataJobId) return dataJobId;

    const link = card.querySelector(
      'a[data-test="job-link"], a.JobCard_trackingLink__HMyun'
    );
    if (link && link.href) {
      const match = link.href.match(/jobListingId=(\d+)/);
      if (match) return match[1];
    }

    // Fallback to position in DOM
    const allCards = this.getGlassdoorJobCards();
    return `card-${Array.from(allCards).indexOf(card)}`;
  }

  getJobUrlFromCard(card) {
    const selectors = [
      'a[data-test="job-link"]',
      ".JobCard_trackingLink__HMyun",
      'a[data-test="job-title"]',
      ".react-job-listing a",
    ];

    for (const selector of selectors) {
      const link = card.querySelector(selector);
      if (link && link.href) {
        return link.href;
      }
    }

    return null;
  }

  hasEasyApply(card) {
    const easyApplySelectors = [
      'button[data-test="easyApply"]',
      ".EasyApplyButton_content__1cGPo",
      "button.applyButton",
      "a.applyButton",
    ];

    for (const selector of easyApplySelectors) {
      const button = card.querySelector(selector);
      if (button && DomUtils.isElementVisible(button)) {
        const buttonText = button.textContent?.trim().toLowerCase();
        if (buttonText === "easy apply") {
          return true;
        }
      }
    }

    return false;
  }

  async processGlassdoorJobCard(jobData) {
    const { card, url, cardId } = jobData;

    this.statusOverlay.addSuccess("Found Glassdoor job to apply: " + url);
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

  markJobCardAsSkipped(card, reason) {
    try {
      card.style.border = "2px solid #FF9800";
      card.style.backgroundColor = "rgba(255, 152, 0, 0.1)";

      const indicator = document.createElement("div");
      indicator.className = "skipped-indicator";
      indicator.style.cssText = `
        position: absolute;
        top: 5px;
        right: 5px;
        background: #FF9800;
        color: white;
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 11px;
        z-index: 10;
      `;
      indicator.textContent = reason;

      card.style.position = "relative";
      card.appendChild(indicator);
    } catch (error) {
      this.log("Error marking job card as skipped:", error);
    }
  }

  getJobTitleFromCard(card) {
    const selectors = [
      ".JobCard_jobTitle__GLyJ1",
      'a[data-test="job-title"]',
      '[data-test="job-link"] span',
      ".react-job-listing h3",
    ];

    for (const selector of selectors) {
      const element = card.querySelector(selector);
      if (element) {
        return element.textContent?.trim();
      }
    }

    return "Job Application";
  }

  async handleNoJobCardsFound() {
    this.statusOverlay.addInfo("No job cards found, trying to load more...");

    const nextButton = document.querySelector(
      '[data-test="pagination-next"], .nextButton'
    );
    if (
      nextButton &&
      DomUtils.isElementVisible(nextButton) &&
      !nextButton.disabled
    ) {
      this.statusOverlay.addInfo('Clicking "Next" button');
      nextButton.click();
      setTimeout(() => {
        if (!this.applicationState.isApplicationInProgress) {
          this.searchNext();
        }
      }, 3000);
    } else {
      this.statusOverlay.addSuccess("All Glassdoor jobs processed!");
      this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
    }
  }

  async handleNoUnprocessedJobCards() {
    await this.handleNoJobCardsFound();
  }

  // ========================================
  // GLASSDOOR-SPECIFIC APPLICATION LOGIC
  // ========================================

  async startApplicationProcess() {
    try {
      this.log("📝 Starting Glassdoor application process");
      this.statusOverlay.addInfo("Starting application process");

      if (!this.userProfile) {
        this.log("⚠️ No user profile available, attempting to fetch...");
        await this.fetchSendCvTaskData();
      }

      // Check for POST_APPLY page (indicates completed application)
      if (this.checkPostApplyPage()) {
        await this.handlePostApplyPage();
        return;
      }

      // Check for success page first
      if (this.checkGlassdoorSubmissionSuccess()) {
        await this.handleAlreadyApplied();
        return;
      }

      await this.apply();
    } catch (error) {
      this.reportError(error, { phase: "application" });
      this.handleApplicationError(error);
    }
  }

  async handleModalApplication(modal) {
    try {
      this.log("📋 Handling Glassdoor modal application");
      this.statusOverlay.addInfo("Processing modal application form");

      const form = modal.querySelector("form");
      if (form) {
        await this.processApplicationForm(form);
      } else {
        this.statusOverlay.addWarning("No form found in modal");
      }
    } catch (error) {
      this.log("❌ Error handling modal application:", error);
      this.handleApplicationError(error);
    }
  }

  async apply() {
    try {
      this.statusOverlay.addInfo("Starting Glassdoor application process");
      this.statusOverlay.updateStatus("applying");

      if (!this.validateHandlers()) {
        throw new Error("Required handlers are not properly initialized");
      }

      if (this.hasPageErrors()) {
        throw new Error("Cannot start application: Page error detected");
      }

      // Wait for modal or form to appear
      await this.wait(2000);

      const form = this.findGlassdoorApplicationForm();
      if (form) {
        return await this.processApplicationForm(form);
      }

      // If no form found, wait longer for modal
      await this.wait(3000);
      const formAfterWait = this.findGlassdoorApplicationForm();
      if (formAfterWait) {
        return await this.processApplicationForm(formAfterWait);
      }

      throw new Error("Cannot find Glassdoor application form or modal");
    } catch (e) {
      this.log("Error in Glassdoor apply:", e);
      throw new Error(
        "Error during application process: " + this.errorToString(e)
      );
    }
  }

  findGlassdoorApplicationForm() {
    const glassdoorSelectors = [
      ".jobsOverlayModal form",
      ".modal-content form",
      'form[action*="glassdoor"]',
      'form[action*="apply"]',
      ".applyButtonContainer form",
      '[data-test="application-form"]',
    ];

    return DomUtils.findForm(glassdoorSelectors);
  }

  async processApplicationForm(form) {
    this.statusOverlay.addInfo(
      "Found Glassdoor application form, filling it out"
    );

    const jobDescription = await this.extractGlassdoorJobDescription();

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
    this.statusOverlay.addInfo("Submitting Glassdoor application...");

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
  // GLASSDOOR-SPECIFIC UTILITY METHODS
  // ========================================

  async extractGlassdoorJobDescription() {
    try {
      this.log("🔍 Extracting Glassdoor job details...");
      this.statusOverlay.addInfo("Extracting job details...");

      const jobDescription = {
        title: DomUtils.extractText([
          ".jobDescriptionContent h2",
          '[data-test="job-title"]',
          ".JobCard_jobTitle__GLyJ1",
          "h1",
        ]),
        company: DomUtils.extractText([
          ".EmployerProfile_compactEmployerName__9MGcV",
          ".employer-name",
          '[data-test="employer-name"]',
          ".companyName",
        ]),
        location: DomUtils.extractText([
          ".JobCard_location__Ds1fM",
          'div[data-test="emp-location"]',
          ".location",
        ]),
        salary: DomUtils.extractText([
          '[data-test="detailSalary"]',
          ".salaryEstimate",
        ]),
      };

      const fullDescriptionElement = document.querySelector(
        '.jobDescriptionContent, [data-test="description"], [data-test="jobDescriptionText"]'
      );

      if (fullDescriptionElement) {
        jobDescription.fullDescription =
          fullDescriptionElement.textContent.trim();
      }

      this.log("✅ Glassdoor job details extracted:", jobDescription);
      return jobDescription;
    } catch (error) {
      this.log("❌ Error extracting Glassdoor job details:", error);
      return { title: document.title || "Job Position" };
    }
  }

  checkGlassdoorSubmissionSuccess() {
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
      ".success-message",
      ".application-submitted",
      '[data-test="application-success"]',
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

  checkPostApplyPage() {
    const url = window.location.href;
    return url.includes("smart-apply-action=POST_APPLY");
  }

  async handlePostApplyPage() {
    this.log("📄 Detected POST_APPLY page - application completed");
    this.statusOverlay.addSuccess("Application completed via POST_APPLY page");

    const jobId = UrlUtils.extractJobId(window.location.href, "glassdoor");
    const jobDetails = await this.extractGlassdoorJobDescription();

    this.safeSendPortMessage({
      type: "applicationCompleted",
      data: {
        jobId: jobId,
        title: jobDetails.title || "Job on Glassdoor",
        company: jobDetails.company || "Company on Glassdoor",
        location: jobDetails.location || "Not specified",
        jobUrl: window.location.href,
        platform: "glassdoor",
      },
    });

    this.applicationState.isApplicationInProgress = false;
  }

  async handleAlreadyApplied() {
    const jobId = UrlUtils.extractJobId(window.location.href, "glassdoor");
    const jobDetails = await this.extractGlassdoorJobDescription();

    this.safeSendPortMessage({
      type: "applicationCompleted",
      data: {
        jobId: jobId,
        title: jobDetails.title || "Job on Glassdoor",
        company: jobDetails.company || "Company on Glassdoor",
        location: jobDetails.location || "Not specified",
        jobUrl: window.location.href,
        platform: "glassdoor",
      },
    });

    this.applicationState.isApplicationInProgress = false;
    this.statusOverlay.addSuccess("Application completed successfully");
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

    // Disconnect modal observer
    if (this.modalObserver) {
      this.modalObserver.disconnect();
      this.modalObserver = null;
    }

    this.log("🧹 Glassdoor-specific cleanup completed");
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
          console.log("👤 User profile loaded from session context");
        } else {
          this.userProfile = {
            ...this.userProfile,
            ...sessionContext.userProfile,
          };
          console.log("👤 User profile merged with session context");
        }
      }

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

      if (sessionContext.apiHost) {
        this.sessionApiHost = sessionContext.apiHost;
      }
      if (this.formHandler && this.userProfile) {
        this.formHandler.userData = this.userProfile;
      }

      console.log("✅ Glassdoor session context set successfully", {
        hasUserProfile: !!this.userProfile,
        userId: this.userId,
        sessionId: this.sessionId,
        profileName: this.userProfile?.name || this.userProfile?.firstName,
        profileEmail: this.userProfile?.email,
      });
    } catch (error) {
      console.error("❌ Error setting Glassdoor session context:", error);
      this.statusOverlay?.addError(
        "❌ Error setting session context: " + error.message
      );
    }
  }

  isGlassdoorJobListingPage(url) {
    return (
      /^https:\/\/(www\.)?glassdoor\.com\/(job|Job|partner)/.test(url) &&
      !url.includes("/jobs.htm") &&
      !url.includes("/apply")
    );
  }

  async handleJobListingPage() {
    this.statusOverlay.addInfo(
      "Glassdoor job listing page detected - clicking Apply button"
    );

    this.cachedJobDescription = await this.extractGlassdoorJobDescription();

    const applyButton = this.findGlassdoorApplyButton();
    if (!applyButton) {
      throw new Error("Cannot find Apply button on Glassdoor job listing page");
    }

    console.log("🖱️ Clicking Apply button");
    applyButton.click();

    // Wait for the application page to load
    await this.waitForGlassdoorApplicationPage();
    this.statusOverlay.addSuccess("Application page loaded successfully");
  }

  findGlassdoorApplyButton() {
    const applySelectors = [
      'button[data-test="easyApply"]',
      ".EasyApplyButton_content__1cGPo",
      "button.applyButton",
      "a.applyButton",
      'button[data-test="apply-button"]',
      '.jobsOverlayModal button[data-test="apply"]',
    ];

    for (const selector of applySelectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        if (
          DomUtils.isElementVisible(element) &&
          element.textContent.toLowerCase().includes("apply")
        ) {
          return element;
        }
      }
    }

    return null;
  }

  async waitForGlassdoorApplicationPage(timeout = 10000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (this.isGlassdoorApplicationPage(window.location.href)) {
        const form = this.findGlassdoorApplicationForm();
        if (form) {
          return true;
        }
      }
      const modal = document.querySelector(
        ".jobsOverlayModal, .modal-content form"
      );
      if (modal) {
        return true;
      }
      await this.wait(500);
    }

    throw new Error("Timeout waiting for Glassdoor application page to load");
  }

  async handleAlreadyApplied() {
    const jobId = UrlUtils.extractJobId(window.location.href, "glassdoor");
    const jobDetails = await this.extractGlassdoorJobDescription();

    this.safeSendPortMessage({
      type: "SEND_CV_TASK_DONE",
      data: {
        jobId: jobId,
        title: jobDetails.title || "Job on Glassdoor",
        company: jobDetails.company || "Company on Glassdoor",
        location: jobDetails.location || "Not specified",
        jobUrl: window.location.href,
        platform: "glassdoor",
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

  getJobTaskMessageType() {
    return "SEND_CV_TASK";
  }
}
