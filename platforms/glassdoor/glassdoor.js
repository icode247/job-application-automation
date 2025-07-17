// platforms/glassdoor/glassdoor.js - FIXED AND COMPLETE VERSION
import BasePlatformAutomation from "../../shared/base/base-platform-automation.js";
import {
  AIService,
  ApplicationTrackerService,
  UserService,
} from "../../services/index.js";

// Import utilities with fallback handling
let UrlUtils, DomUtils, FormUtils;
try {
  // This will be handled during initialization if needed
} catch (error) {
  console.warn("Utilities not available, using fallbacks");
}

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

    // Glassdoor-specific handlers
    this.formHandler = null;
    this.fileHandler = null;
    
    // State management
    this.cachedJobDescription = null;
    this.processedJobCards = new Set();
    this.modalObserver = null;
    this.currentJobData = null;
    this.lastCheckedUrl = null;
    
    // Glassdoor-specific configuration
    this.glassdoorConfig = {
      selectors: {
        jobCards: ".JobsList_jobListItem__wjTHv, li[data-test='jobListing']",
        jobTitle: ".JobCard_jobTitle__GLyJ1, a[data-test='job-title']",
        companyName: ".EmployerProfile_compactEmployerName__9MGcV, span.employer-name",
        location: ".JobCard_location__Ds1fM, div[data-test='emp-location']",
        salary: "[data-test='detailSalary'], .salaryEstimate",
        applyButton: "button[data-test='easyApply'], .EasyApplyButton_content__1cGPo, button.applyButton, a.applyButton",
        jobLink: '.JobCard_trackingLink__HMyun, a[data-test="job-link"]',
        nextPage: "[data-test='pagination-next'], .nextButton",
        form: ".jobsOverlayModal form, .modal-content form, .applyButtonContainer form",
        modal: ".jobsOverlayModal, .modal-content",
      },
      delays: {
        betweenJobs: 3000,
        formFilling: 1000,
        modalWait: 2000,
        pageLoad: 3000,
      }
    };
  }

  // ========================================
  // PLATFORM-SPECIFIC IMPLEMENTATIONS (Required by base class)
  // ========================================

  getPlatformDomains() {
    return ["https://www.glassdoor.com"];
  }

  getSearchLinkPattern() {
    return /^https:\/\/(www\.)?glassdoor\.com\/(job|Job|partner|apply).*$/;
  }

  isValidJobPage(url) {
    return /^https:\/\/(www\.)?glassdoor\.com\/(job|Job|partner|apply)/.test(url);
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
      url.includes("smart-apply-action=POST_APPLY") ||
      document.querySelector(this.glassdoorConfig.selectors.modal)
    );
  }

  getJobTaskMessageType() {
    return "SEND_CV_TASK";
  }

  platformSpecificUrlNormalization(url) {
    // Remove Glassdoor-specific parameters
    return url
      .replace(/[?&](jobListingId|pos|ao|s|guid|src|t|vt|ea|ei|ko)=[^&]*/g, "")
      .replace(/[?&]+$/, "");
  }

  // ========================================
  // INITIALIZATION AND SETUP
  // ========================================

  async initialize() {
    await super.initialize();

    // Try to import utilities if not already loaded
    await this.loadUtilities();

    try {
      // Import and initialize Glassdoor-specific handlers
      const { default: GlassdoorFormHandler } = await import("./glassdoor-form-handler.js");
      const { default: GlassdoorFileHandler } = await import("./glassdoor-file-handler.js");

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

      this.statusOverlay.addSuccess("Glassdoor handlers initialized successfully");
    } catch (error) {
      this.log("⚠️ Could not load Glassdoor handlers:", error);
      this.statusOverlay.addWarning("Some Glassdoor features may be limited");
    }

    // Set up modal observer for Glassdoor's modal-based applications
    this.setupModalObserver();
    
    // Set up DOM mutation observer for dynamic content
    this.setupDOMObserver();
  }

  async loadUtilities() {
    try {
      const utilities = await import("../../shared/utilities/index.js");
      UrlUtils = utilities.UrlUtils;
      DomUtils = utilities.DomUtils;
      FormUtils = utilities.FormUtils;
      this.log("✅ Utilities loaded successfully");
    } catch (error) {
      this.log("⚠️ Utilities not available, using fallbacks:", error);
      // Fallback methods are implemented in the class
    }
  }

  setupModalObserver() {
    if (this.modalObserver) {
      this.modalObserver.disconnect();
    }

    this.modalObserver = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
          for (const node of mutation.addedNodes) {
            if (node.nodeType === Node.ELEMENT_NODE) {
              // Check for Glassdoor application modal
              const modal = node.querySelector(this.glassdoorConfig.selectors.modal) ||
                           (node.classList?.contains("jobsOverlayModal") ? node : null);

              if (modal) {
                this.log("📋 Glassdoor application modal detected");
                this.statusOverlay.addInfo("Application modal opened");
                setTimeout(() => this.handleModalApplication(modal), this.glassdoorConfig.delays.modalWait);
              }

              // Check for Indeed SmartApply redirect
              if (window.location.href.includes("smartapply.indeed.com")) {
                this.log("🔄 Detected redirect to Indeed SmartApply");
                setTimeout(() => this.handleIndeedSmartApplyRedirect(), 1000);
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

  setupDOMObserver() {
    // Additional observer for job cards and pagination
    const jobCardsObserver = new MutationObserver((mutations) => {
      if (this.isRunning && this.automationState.isSearching) {
        this.debounceJobCardCheck();
      }
    });

    jobCardsObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
    });

    this.jobCardsObserver = jobCardsObserver;
  }

  debounceJobCardCheck() {
    if (this.jobCardCheckTimeout) {
      clearTimeout(this.jobCardCheckTimeout);
    }

    this.jobCardCheckTimeout = setTimeout(() => {
      if (this.isRunning && !this.applicationState.isApplicationInProgress) {
        this.searchNext();
      }
    }, 2000);
  }

  // ========================================
  // START AND PAGE TYPE DETECTION
  // ========================================

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
    } else if (this.isGlassdoorApplicationPage(url)) {
      this.statusOverlay.addInfo("Glassdoor application page detected");
      await this.startApplicationProcess();
    } else {
      this.log("❓ Unknown page type, waiting for navigation");
      await this.waitForValidPage();
    }
  }

  // ========================================
  // PAGE TYPE DETECTION METHODS
  // ========================================

  isGlassdoorJobPage(url) {
    return (
      /^https:\/\/(www\.)?glassdoor\.com\/(job|Job|partner)/.test(url) &&
      !url.includes("/jobs.htm") &&
      !url.includes("/apply")
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
      url.includes("smart-apply-action=POST_APPLY") ||
      url.includes("smartapply.indeed.com")
    );
  }

  // ========================================
  // SEARCH PROCESS IMPLEMENTATION
  // ========================================

  async startSearchProcess() {
    try {
      this.statusOverlay.addInfo("Starting job search process");
      this.statusOverlay.updateStatus("searching");
      this.automationState.isSearching = true;
      await this.fetchSearchTaskData();
    } catch (error) {
      this.reportError(error, { phase: "search" });
    }
  }

  async startJobSearchProcess() {
    try {
      this.statusOverlay.addInfo("Starting job search on Glassdoor results page");
      this.statusOverlay.updateStatus("searching");
      this.automationState.isSearching = true;
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
      this.statusOverlay.addError("Error processing search task data: " + error.message);
    }
  }

  // ========================================
  // ENHANCED SEARCH LOGIC FOR GLASSDOOR
  // ========================================

  async searchNext() {
    try {
      this.log("🔍 Executing Glassdoor searchNext");

      if (this.applicationState.isApplicationInProgress) {
        this.log("Application in progress, not searching for next job");
        this.statusOverlay.addInfo("Application in progress, waiting to complete...");
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
    const dataJobId = card.getAttribute("data-jobid") || card.getAttribute("data-id");
    if (dataJobId) return dataJobId;

    const link = card.querySelector(this.glassdoorConfig.selectors.jobLink);
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
      if (button && this.isElementVisible(button)) {
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

  // ========================================
  // JOB CARD VISUAL FEEDBACK METHODS
  // ========================================

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

    const nextButton = document.querySelector(this.glassdoorConfig.selectors.nextPage);
    if (nextButton && this.isElementVisible(nextButton) && !nextButton.disabled) {
      this.statusOverlay.addInfo('Clicking "Next" button');
      nextButton.click();
      setTimeout(() => {
        if (!this.applicationState.isApplicationInProgress) {
          this.searchNext();
        }
      }, this.glassdoorConfig.delays.pageLoad);
    } else {
      this.statusOverlay.addSuccess("All Glassdoor jobs processed!");
      this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
    }
  }

  async handleNoUnprocessedJobCards() {
    await this.handleNoJobCardsFound();
  }

  // ========================================
  // APPLICATION PROCESS IMPLEMENTATION
  // ========================================

  async startApplicationProcess() {
    try {
      this.log("📝 Starting Glassdoor application process");
      this.statusOverlay.addInfo("Starting application process");
      this.statusOverlay.updateStatus("applying");

      const currentUrl = window.location.href;
      this.log(`🌐 Current URL: ${currentUrl}`);

      if (!this.userProfile) {
        this.log("⚠️ No user profile available, attempting to fetch...");
        await this.fetchSendCvTaskData();
      }

      // Log page analysis
      this.analyzeCurrentPage();

      // Check for POST_APPLY page (indicates completed application)
      if (this.checkPostApplyPage()) {
        this.log("📄 Detected POST_APPLY page");
        await this.handlePostApplyPage();
        return;
      }

      // Check for success page first
      if (this.checkGlassdoorSubmissionSuccess()) {
        this.log("✅ Detected success page");
        await this.handleAlreadyApplied();
        return;
      }

      // Check for Indeed SmartApply redirect
      if (window.location.href.includes("smartapply.indeed.com")) {
        this.log("🔄 Detected Indeed SmartApply redirect");
        await this.handleIndeedSmartApplyRedirect();
        return;
      }

      // Start the application process
      await this.apply();
    } catch (error) {
      this.log("❌ Error in startApplicationProcess:", error);
      this.reportError(error, { phase: "application", url: window.location.href });
      this.handleApplicationError(error);
    }
  }

  analyzeCurrentPage() {
    const url = window.location.href;
    this.log("🔍 Analyzing current page...");
    this.log(`URL: ${url}`);
    this.log(`Title: ${document.title}`);
    
    // Check for key Glassdoor elements
    const elements = {
      'Easy Apply buttons': document.querySelectorAll('[data-test="easyApply"], .EasyApplyButton_content__1cGPo').length,
      'Forms': document.querySelectorAll('form').length,
      'Modals': document.querySelectorAll('.jobsOverlayModal, .modal-content').length,
      'Apply buttons': document.querySelectorAll('button:contains("Apply"), a:contains("Apply")').length,
      'Job cards': document.querySelectorAll('.JobsList_jobListItem__wjTHv').length
    };

    this.log("📊 Page elements found:", elements);

    // Check page type
    const pageTypes = {
      'Job listing page': this.isGlassdoorJobListingPage(url),
      'Search results page': this.isGlassdoorSearchPage(url), 
      'Application page': this.isGlassdoorApplicationPage(url),
      'POST_APPLY page': this.checkPostApplyPage()
    };

    this.log("📋 Page type analysis:", pageTypes);

    // Log any visible forms for debugging
    const forms = document.querySelectorAll('form');
    forms.forEach((form, index) => {
      if (DomUtils.isElementVisible(form)) {
        this.log(`📝 Visible form ${index + 1}:`, {
          action: form.action,
          method: form.method,
          inputs: form.querySelectorAll('input').length,
          textareas: form.querySelectorAll('textarea').length,
          selects: form.querySelectorAll('select').length
        });
      }
    });
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

  async handleIndeedSmartApplyRedirect() {
    try {
      this.log("🔄 Handling Indeed SmartApply redirect from Glassdoor");
      this.statusOverlay.addInfo("Detected redirect to Indeed SmartApply - processing...");

      if (this.formHandler && this.formHandler.processIndeedSmartApply) {
        const result = await this.formHandler.processIndeedSmartApply();
        
        if (result.success) {
          this.statusOverlay.addSuccess("Indeed SmartApply completed successfully");
          await this.handleSuccessfulApplication(result.jobTitle || "Job on Glassdoor");
        } else {
          throw new Error(result.error || "Indeed SmartApply processing failed");
        }
      } else {
        throw new Error("SmartApply handler not available");
      }
    } catch (error) {
      this.log("❌ Error handling Indeed SmartApply:", error);
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

      const currentUrl = window.location.href;
      this.log(`🔍 Applying on Glassdoor page: ${currentUrl}`);

      // Determine what type of Glassdoor page we're on
      if (this.isGlassdoorJobListingPage(currentUrl)) {
        // We're on a job listing page - need to click apply button first
        this.statusOverlay.addInfo("On job listing page - looking for apply button");
        await this.handleJobListingPage();
      } else if (this.isGlassdoorApplicationPage(currentUrl)) {
        // We're already on an application page
        this.statusOverlay.addInfo("Already on application page - looking for form");
        await this.waitForAndProcessForm();
      } else {
        // Unknown page type - try to find form anyway
        this.statusOverlay.addInfo("Unknown page type - searching for form");
        await this.waitForAndProcessForm();
      }

      return true;
    } catch (e) {
      this.log("Error in Glassdoor apply:", e);
      throw new Error("Error during application process: " + this.errorToString(e));
    }
  }

  async waitForAndProcessForm() {
    // Wait for modal or form to appear
    await this.wait(this.glassdoorConfig.delays.modalWait);

    let form = this.findGlassdoorApplicationForm();
    if (form) {
      this.statusOverlay.addSuccess("Found application form immediately");
      return await this.processApplicationForm(form);
    }

    // If no form found, wait longer for modal
    this.statusOverlay.addInfo("No form found immediately, waiting longer...");
    await this.wait(this.glassdoorConfig.delays.pageLoad);
    
    form = this.findGlassdoorApplicationForm();
    if (form) {
      this.statusOverlay.addSuccess("Found application form after waiting");
      return await this.processApplicationForm(form);
    }

    // Try alternative detection methods
    await this.tryAlternativeFormDetection();
  }

  async tryAlternativeFormDetection() {
    this.statusOverlay.addInfo("Trying alternative form detection methods...");

    // Method 1: Look for any visible form on the page
    const allForms = document.querySelectorAll("form");
    this.log(`Found ${allForms.length} forms on page`);
    
    for (const form of allForms) {
      if (this.isElementVisible(form)) {
        this.log("Found visible form, attempting to process");
        this.statusOverlay.addInfo("Found visible form - attempting to process");
        return await this.processApplicationForm(form);
      }
    }

    // Method 2: Check for specific Glassdoor elements that indicate we should wait
    const glassdoorIndicators = [
      ".jobsOverlayModal",
      ".modal-content", 
      ".applyButtonContainer",
      "[data-test='easyApply']",
      ".application-form"
    ];

    for (const selector of glassdoorIndicators) {
      const element = document.querySelector(selector);
      if (element) {
        this.log(`Found Glassdoor indicator: ${selector}`);
        this.statusOverlay.addInfo(`Found ${selector} - waiting for form to load`);
        await this.wait(3000);
        
        const form = this.findGlassdoorApplicationForm();
        if (form) {
          return await this.processApplicationForm(form);
        }
      }
    }

    // Method 3: Check if we need to click something to trigger the form
    await this.tryTriggerApplicationForm();
  }

  async tryTriggerApplicationForm() {
    this.statusOverlay.addInfo("Looking for apply button to trigger form...");

    const applySelectors = [
      'button[data-test="easyApply"]',
      ".EasyApplyButton_content__1cGPo", 
      "button.applyButton",
      "a.applyButton",
      '.apply-button'
    ];

    // First try specific selectors
    for (const selector of applySelectors) {
      const buttons = document.querySelectorAll(selector);
      for (const button of buttons) {
        if (this.isElementVisible(button) && !button.disabled) {
          const buttonText = button.textContent?.trim().toLowerCase();
          if (buttonText.includes("apply") && !buttonText.includes("applied")) {
            this.log(`Found apply button: ${buttonText}`);
            this.statusOverlay.addInfo(`Clicking apply button: ${buttonText}`);
            
            try {
              await this.clickElementReliably(button);
              await this.wait(3000);
              
              const form = this.findGlassdoorApplicationForm();
              if (form) {
                this.statusOverlay.addSuccess("Form appeared after clicking apply button");
                return await this.processApplicationForm(form);
              }
            } catch (error) {
              this.log(`Error clicking apply button: ${error.message}`);
            }
          }
        }
      }
    }

    // Then try finding buttons by text content
    const allButtons = document.querySelectorAll('button, a');
    for (const button of allButtons) {
      if (this.isElementVisible(button) && !button.disabled) {
        const buttonText = button.textContent?.trim().toLowerCase();
        if ((buttonText.includes("easy apply") || buttonText.includes("apply")) && 
            !buttonText.includes("applied")) {
          this.log(`Found apply button by text: ${buttonText}`);
          this.statusOverlay.addInfo(`Clicking apply button: ${buttonText}`);
          
          try {
            await this.clickElementReliably(button);
            await this.wait(3000);
            
            const form = this.findGlassdoorApplicationForm();
            if (form) {
              this.statusOverlay.addSuccess("Form appeared after clicking apply button");
              return await this.processApplicationForm(form);
            }
          } catch (error) {
            this.log(`Error clicking apply button: ${error.message}`);
          }
        }
      }
    }

    // Method 4: Check if this is actually a completed application or redirect
    await this.checkForAlternativeOutcomes();
  }

  async checkForAlternativeOutcomes() {
    this.log("🔍 Checking for alternative outcomes...");

    // Check if application was already submitted
    const pageText = document.body.textContent.toLowerCase();
    const alreadyAppliedIndicators = [
      "already applied",
      "application submitted", 
      "you have applied",
      "application sent",
      "thank you for applying"
    ];

    if (alreadyAppliedIndicators.some(indicator => pageText.includes(indicator))) {
      this.log("✅ Detected already applied status");
      this.statusOverlay.addSuccess("Application already submitted or completed");
      await this.handleAlreadyApplied();
      return;
    }

    // Check if we're being redirected
    if (pageText.includes("redirecting") || pageText.includes("loading")) {
      this.log("🔄 Page appears to be redirecting, waiting...");
      this.statusOverlay.addInfo("Page is redirecting, waiting...");
      await this.wait(5000);
      
      // Re-analyze after waiting
      const currentUrl = window.location.href;
      if (currentUrl !== this.lastCheckedUrl) {
        this.lastCheckedUrl = currentUrl;
        this.log("🔄 URL changed during redirect, restarting process");
        await this.startApplicationProcess();
        return;
      }
    }

    // Check if this is a job that requires external application
    const externalIndicators = [
      "apply on company website",
      "external application",
      "visit company website",
      "apply directly"
    ];

    if (externalIndicators.some(indicator => pageText.includes(indicator))) {
      this.log("🔗 Job requires external application");
      throw new Error("This job requires applying on the company website directly");
    }

    // If we still can't find anything, throw a detailed error
    await this.generateDetailedError();
  }

  async generateDetailedError() {
    const debugInfo = {
      url: window.location.href,
      title: document.title,
      pageText: document.body.textContent.substring(0, 500),
      forms: document.querySelectorAll('form').length,
      buttons: document.querySelectorAll('button').length,
      modals: document.querySelectorAll('.modal, .overlay').length,
      hasEasyApply: !!document.querySelector('[data-test="easyApply"]'),
      hasApplicationButton: this.findButtonsWithText('apply').length > 0,
      pageType: {
        isJobListing: this.isGlassdoorJobListingPage(window.location.href),
        isSearchPage: this.isGlassdoorSearchPage(window.location.href),
        isApplicationPage: this.isGlassdoorApplicationPage(window.location.href)
      }
    };

    this.log("🐛 Debug info for missing form:", debugInfo);
    
    const errorMessage = `Cannot find Glassdoor application form or modal after trying all detection methods.
    
Debug info:
- URL: ${debugInfo.url}
- Page type: ${JSON.stringify(debugInfo.pageType)}
- Forms found: ${debugInfo.forms}
- Buttons found: ${debugInfo.buttons}
- Has Easy Apply: ${debugInfo.hasEasyApply}
- Page text preview: ${debugInfo.pageText.substring(0, 200)}...

This might be because:
1. The page structure has changed
2. This job doesn't support Easy Apply
3. You may have already applied to this job
4. The page requires login or has other restrictions`;

    throw new Error(errorMessage);
  }

  findButtonsWithText(searchText) {
    const buttons = document.querySelectorAll('button, a');
    const matchingButtons = [];
    
    for (const button of buttons) {
      const text = button.textContent?.toLowerCase() || '';
      if (text.includes(searchText.toLowerCase())) {
        matchingButtons.push(button);
      }
    }
    
    return matchingButtons;
  }

  isElementVisible(element) {
    if (!element) return false;
    
    try {
      // Use DomUtils if available, otherwise use fallback
      if (typeof DomUtils !== 'undefined' && DomUtils.isElementVisible) {
        return DomUtils.isElementVisible(element);
      }
      
      // Fallback implementation
      const style = window.getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
        return false;
      }
      
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch (error) {
      return false;
    }
  }

  isGlassdoorJobListingPage(url) {
    return (
      /^https:\/\/(www\.)?glassdoor\.com\/(job|Job|partner)/.test(url) &&
      !url.includes("/jobs.htm") &&
      !url.includes("/apply")
    );
  }

  findGlassdoorApplicationForm() {
    // Enhanced form detection with more selectors and debugging
    const formSelectors = [
      ".jobsOverlayModal form",
      ".modal-content form", 
      'form[action*="glassdoor"]',
      'form[action*="apply"]',
      ".applyButtonContainer form",
      '[data-test="application-form"]',
      'form[class*="application"]',
      'form[class*="apply"]',
      ".application-modal form",
      "#application-form"
    ];

    this.log(`🔍 Searching for Glassdoor application form using ${formSelectors.length} selectors`);

    for (const selector of formSelectors) {
      const forms = document.querySelectorAll(selector);
      this.log(`Selector "${selector}" found ${forms.length} forms`);
      
      for (const form of forms) {
        if (this.isElementVisible(form)) {
          this.log(`✅ Found visible form with selector: ${selector}`);
          return form;
        }
      }
    }

    // Fallback: look for any form that might be an application form
    const allForms = document.querySelectorAll("form");
    this.log(`📋 Checking ${allForms.length} total forms as fallback`);
    
    for (const form of allForms) {
      if (this.isElementVisible(form)) {
        // Check if form contains application-related elements
        const hasApplicationElements = 
          form.querySelector('input[type="file"]') || // Resume upload
          form.querySelector('textarea') || // Cover letter
          form.querySelector('input[type="email"]') || // Email field
          form.querySelector('input[type="tel"]') || // Phone field
          form.querySelector('select') || // Dropdown fields
          form.textContent.toLowerCase().includes('apply') ||
          form.textContent.toLowerCase().includes('resume') ||
          form.textContent.toLowerCase().includes('cover letter');

        if (hasApplicationElements) {
          this.log(`✅ Found potential application form based on content`);
          return form;
        }
      }
    }

    this.log("❌ No application form found with any method");
    return null;
  }

  async handleJobListingPage() {
    this.statusOverlay.addInfo("Glassdoor job listing page detected - looking for Apply button");

    // Extract job details first
    this.currentJobData = await this.extractGlassdoorJobDescription();

    // Find and click the apply button
    const applyButton = this.findGlassdoorApplyButton();
    if (!applyButton) {
      throw new Error("Cannot find Apply button on Glassdoor job listing page");
    }

    this.log("🖱️ Clicking Apply button");
    this.statusOverlay.addInfo("Clicking Apply button...");
    
    try {
      await this.clickElementReliably(applyButton);
      this.statusOverlay.addSuccess("Apply button clicked successfully");
    } catch (error) {
      throw new Error(`Failed to click apply button: ${error.message}`);
    }

    // Wait for the application page/modal to load
    await this.waitForGlassdoorApplicationPage();
    this.statusOverlay.addSuccess("Application page loaded successfully");

    // Now process the form
    await this.waitForAndProcessForm();
  }

  findGlassdoorApplyButton() {
    const applySelectors = [
      'button[data-test="easyApply"]',
      ".EasyApplyButton_content__1cGPo",
      "button.applyButton", 
      "a.applyButton",
      'button[data-test="apply-button"]',
      '.jobsOverlayModal button[data-test="apply"]'
    ];

    this.log(`🔍 Searching for apply button using ${applySelectors.length} selectors`);

    for (const selector of applySelectors) {
      const elements = document.querySelectorAll(selector);
      this.log(`Selector "${selector}" found ${elements.length} elements`);
      
      for (const element of elements) {
        if (this.isElementVisible(element) && !element.disabled) {
          const text = element.textContent?.toLowerCase() || "";
          this.log(`Checking button text: "${text}"`);
          
          if (text.includes("apply") && !text.includes("applied")) {
            this.log(`✅ Found apply button with text: "${text}"`);
            return element;
          }
        }
      }
    }

    // Fallback: look for any button with "apply" text
    const allButtons = document.querySelectorAll("button, a");
    this.log(`📋 Checking ${allButtons.length} total buttons as fallback`);
    
    for (const button of allButtons) {
      if (this.isElementVisible(button) && !button.disabled) {
        const text = button.textContent?.toLowerCase() || "";
        if (text === "easy apply" || text === "apply now" || text === "apply") {
          this.log(`✅ Found apply button via fallback: "${text}"`);
          return button;
        }
      }
    }

    this.log("❌ No apply button found");
    return null;
  }

  async waitForGlassdoorApplicationPage(timeout = 15000) {
    const startTime = Date.now();
    this.log(`⏳ Waiting for Glassdoor application page (timeout: ${timeout}ms)`);

    while (Date.now() - startTime < timeout) {
      // Check if URL changed to application page
      if (this.isGlassdoorApplicationPage(window.location.href)) {
        this.log("✅ URL indicates we're on application page");
        const form = this.findGlassdoorApplicationForm();
        if (form) {
          this.log("✅ Application form found on new page");
          return true;
        }
      }

      // Check for modal appearing
      const modal = document.querySelector(this.glassdoorConfig.selectors.modal);
      if (modal && this.isElementVisible(modal)) {
        this.log("✅ Application modal appeared");
        return true;
      }

      // Check for form appearing
      const form = this.findGlassdoorApplicationForm();
      if (form) {
        this.log("✅ Application form appeared");
        return true;
      }

      // Check for Indeed SmartApply redirect
      if (window.location.href.includes("smartapply.indeed.com")) {
        this.log("✅ Redirected to Indeed SmartApply");
        return true;
      }

      await this.wait(500);
    }

    throw new Error("Timeout waiting for Glassdoor application page to load");
  }

  async clickElementReliably(element) {
    const strategies = [
      () => element.click(),
      () => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })),
      () => {
        element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      },
      () => {
        element.focus();
        element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      },
    ];

    // Scroll element into view first
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    await this.wait(500);

    for (const strategy of strategies) {
      try {
        strategy();
        await this.wait(1000);
        return true;
      } catch (error) {
        this.log(`Click strategy failed: ${error.message}`);
        continue;
      }
    }

    throw new Error("All click strategies failed");
  }

  async processApplicationForm(form) {
    this.statusOverlay.addInfo("Found Glassdoor application form, filling it out");

    const jobDescription = await this.extractGlassdoorJobDescription();

    if (this.formHandler) {
      this.formHandler.jobDescription = jobDescription;
      this.formHandler.userData = this.userProfile;
    }

    // Handle file uploads
    try {
      if (this.fileHandler && this.userProfile) {
        await this.fileHandler.handleFileUploads(form, this.userProfile, jobDescription);
      }
    } catch (error) {
      this.statusOverlay.addError("File upload failed: " + error.message);
    }

    // Fill form fields
    try {
      if (this.formHandler) {
        await this.formHandler.fillFormWithProfile(form, this.userProfile, jobDescription);
        this.statusOverlay.addSuccess("Form fields filled");
      }
    } catch (error) {
      this.statusOverlay.addWarning("Form filling failed: " + error.message);
    }

    const submitButton = this.findSubmitButton(form);
    if (!submitButton) {
      throw new Error("Cannot find submit button");
    }

    return await this.submitForm(submitButton);
  }

  findSubmitButton(form) {
    // Use FormUtils if available, otherwise use fallback
    if (typeof FormUtils !== 'undefined' && FormUtils.findSubmitButton) {
      return FormUtils.findSubmitButton(form);
    }
    
    // Fallback implementation
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]', 
      'button:contains("Submit")',
      'button:contains("Apply")',
      '.submit-button',
      '.apply-button'
    ];
    
    for (const selector of submitSelectors) {
      if (selector.includes(':contains(')) {
        // Handle text-based selectors manually
        const buttons = form.querySelectorAll('button');
        for (const button of buttons) {
          const text = button.textContent?.toLowerCase() || '';
          if (selector.includes('Submit') && text.includes('submit')) {
            return button;
          }
          if (selector.includes('Apply') && text.includes('apply')) {
            return button;
          }
        }
      } else {
        const element = form.querySelector(selector);
        if (element && this.isElementVisible(element)) {
          return element;
        }
      }
    }
    
    return null;
  }

  async submitForm(submitButton) {
    this.statusOverlay.addInfo("Submitting Glassdoor application...");

    this.scrollToElement(submitButton);
    await this.wait(600);

    try {
      submitButton.click();
      this.statusOverlay.addSuccess("Clicked submit button");
      
      // Wait for submission and check for success
      await this.wait(this.glassdoorConfig.delays.pageLoad);
      
      // Check if application was successful
      if (this.checkGlassdoorSubmissionSuccess()) {
        await this.handleSuccessfulApplication();
        return true;
      }
      
    } catch (e) {
      this.statusOverlay.addError("Failed to click submit button: " + e.message);
    }
    
    return true;
  }

  scrollToElement(element) {
    if (!element) return;
    
    try {
      // Use DomUtils if available, otherwise use fallback
      if (typeof DomUtils !== 'undefined' && DomUtils.scrollToElement) {
        DomUtils.scrollToElement(element);
      } else {
        // Fallback implementation
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    } catch (error) {
      // Fallback for older browsers
      try {
        element.scrollIntoView();
      } catch (e) {
        // If even basic scrollIntoView fails, continue without scrolling
      }
    }
  }

  // ========================================
  // JOB DATA EXTRACTION METHODS
  // ========================================

  async extractGlassdoorJobDescription() {
    try {
      this.log("🔍 Extracting Glassdoor job details...");
      this.statusOverlay.addInfo("Extracting job details...");

      const jobDescription = {
        title: this.extractText([
          ".jobDescriptionContent h2",
          '[data-test="job-title"]',
          ".JobCard_jobTitle__GLyJ1",
          "h1",
        ]),
        company: this.extractText([
          ".EmployerProfile_compactEmployerName__9MGcV",
          ".employer-name",
          '[data-test="employer-name"]',
          ".companyName",
        ]),
        location: this.extractText([
          ".JobCard_location__Ds1fM",
          'div[data-test="emp-location"]',
          ".location",
        ]),
        salary: this.extractText([
          '[data-test="detailSalary"]',
          ".salaryEstimate",
        ]),
      };

      const fullDescriptionElement = document.querySelector(
        '.jobDescriptionContent, [data-test="description"], [data-test="jobDescriptionText"]'
      );

      if (fullDescriptionElement) {
        jobDescription.fullDescription = fullDescriptionElement.textContent.trim();
      }

      this.log("✅ Glassdoor job details extracted:", jobDescription);
      this.currentJobData = jobDescription;
      return jobDescription;
    } catch (error) {
      this.log("❌ Error extracting Glassdoor job details:", error);
      return { title: document.title || "Job Position" };
    }
  }

  extractText(selectors) {
    // Use DomUtils if available, otherwise use fallback
    if (typeof DomUtils !== 'undefined' && DomUtils.extractText) {
      return DomUtils.extractText(selectors);
    }
    
    // Fallback implementation
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent) {
        return element.textContent.trim();
      }
    }
    return "";
  }

  // ========================================
  // SUCCESS AND ERROR HANDLING
  // ========================================

  checkGlassdoorSubmissionSuccess() {
    // Check URL for success indicators
    const url = window.location.href;
    if (url.includes("success") || url.includes("confirmation") || url.includes("applied")) {
      this.statusOverlay.addSuccess("URL indicates success - application submitted");
      return true;
    }

    // Check for success messages
    const successSelectors = [
      ".success-message",
      ".application-submitted",
      '[data-test="application-success"]',
      ".confirmation",
    ];

    for (const selector of successSelectors) {
      if (document.querySelector(selector)) {
        this.statusOverlay.addSuccess("Success message found - application submitted");
        return true;
      }
    }

    // Check for text indicators
    const pageText = document.body.textContent.toLowerCase();
    const successIndicators = [
      "application submitted",
      "application complete",
      "thank you for applying",
      "your application has been sent",
    ];

    if (successIndicators.some(indicator => pageText.includes(indicator))) {
      this.statusOverlay.addSuccess("Success text found - application submitted");
      return true;
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

    const jobId = this.extractJobId(window.location.href);
    const jobDetails = this.currentJobData || await this.extractGlassdoorJobDescription();

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
  }

  async handleAlreadyApplied() {
    const jobId = this.extractJobId(window.location.href);
    const jobDetails = this.currentJobData || await this.extractGlassdoorJobDescription();

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

  async handleSuccessfulApplication(jobTitle = null) {
    const jobDetails = this.currentJobData || await this.extractGlassdoorJobDescription();
    const finalTitle = jobTitle || jobDetails.title || "Job on Glassdoor";

    this.safeSendPortMessage({
      type: "SEND_CV_TASK_DONE",
      data: {
        jobId: this.extractJobId(window.location.href),
        title: finalTitle,
        company: jobDetails.company || "Company on Glassdoor",
        location: jobDetails.location || "Not specified",
        jobUrl: window.location.href,
        platform: "glassdoor",
      },
    });

    this.applicationState.isApplicationInProgress = false;
    this.statusOverlay.addSuccess("Application completed successfully");
  }

  extractJobId(url) {
    // Use UrlUtils if available, otherwise use fallback
    if (typeof UrlUtils !== 'undefined' && UrlUtils.extractJobId) {
      return UrlUtils.extractJobId(url, "glassdoor");
    }
    
    // Fallback implementation for Glassdoor
    try {
      const match = url.match(/jobListingId=(\d+)/);
      if (match && match[1]) {
        return match[1];
      }
      
      // Try alternative patterns
      const jvMatch = url.match(/JV_KO[^_]+_KE[^_]+_(\d+)\.htm/);
      if (jvMatch && jvMatch[1]) {
        return jvMatch[1];
      }
      
      return null;
    } catch (error) {
      return null;
    }
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
  // VALIDATION AND UTILITY METHODS
  // ========================================

  validateHandlers() {
    const issues = [];

    if (!this.statusOverlay) issues.push("Status overlay not initialized");
    if (!this.userProfile) issues.push("User profile not available");

    if (issues.length > 0) {
      this.statusOverlay?.addError("Initialization issues: " + issues.join(", "));
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

      case "JOB_TAB_STATUS":
        this.handleJobTabStatus(data);
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

    if (data && data.active === false && this.applicationState.isApplicationInProgress) {
      this.log("⚠️ State mismatch detected! Resetting application progress flag");
      this.applicationState.isApplicationInProgress = false;
      this.applicationState.applicationStartTime = null;
      this.statusOverlay.addWarning("Detected state mismatch - resetting flags");
      setTimeout(() => this.searchNext(), 1000);
    }
  }

  handleJobTabStatus(data) {
    this.log("📊 Job tab status:", data);
    
    if (data && !data.isOpen && this.applicationState.isApplicationInProgress) {
      this.log("⚠️ Job tab closed, resetting application state");
      this.applicationState.isApplicationInProgress = false;
      this.applicationState.applicationStartTime = null;
      setTimeout(() => this.searchNext(), 1000);
    }
  }

  // ========================================
  // UTILITY AND HELPER METHODS
  // ========================================

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

  resetApplicationStateOnError() {
    this.applicationState.isApplicationInProgress = false;
    this.applicationState.applicationStartTime = null;
    this.applicationState.currentJobUrl = null;
    this.applicationState.currentJobTabId = null;
  }

  setStuckDetectionTimeout() {
    if (this.stuckDetectionTimeout) {
      clearTimeout(this.stuckDetectionTimeout);
    }

    this.stuckDetectionTimeout = setTimeout(() => {
      if (this.applicationState.isApplicationInProgress) {
        this.log("⚠️ Application appears stuck, resetting state");
        this.statusOverlay.addWarning("Application timeout - resetting and continuing");
        this.resetApplicationStateOnError();
        setTimeout(() => this.searchNext(), 2000);
      }
    }, 300000); // 5 minute timeout
  }

  // ========================================
  // SESSION CONTEXT AND CLEANUP
  // ========================================

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
          this.userProfile = { ...this.userProfile, ...sessionContext.userProfile };
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
          this.statusOverlay?.addError("Failed to fetch user profile: " + error.message);
        }
      }

      if (this.userId && (!this.userService || this.userService.userId !== this.userId)) {
        this.applicationTracker = new ApplicationTrackerService({ userId: this.userId });
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
      this.statusOverlay?.addError("❌ Error setting session context: " + error.message);
    }
  }

  cleanup() {
    super.cleanup();
    
    // Glassdoor-specific cleanup
    this.processedJobCards.clear();
    this.cachedJobDescription = null;
    this.currentJobData = null;
    this.lastCheckedUrl = null;

    // Disconnect observers
    if (this.modalObserver) {
      this.modalObserver.disconnect();
      this.modalObserver = null;
    }

    if (this.jobCardsObserver) {
      this.jobCardsObserver.disconnect();
      this.jobCardsObserver = null;
    }

    // Clear timeouts
    if (this.jobCardCheckTimeout) {
      clearTimeout(this.jobCardCheckTimeout);
      this.jobCardCheckTimeout = null;
    }

    if (this.stuckDetectionTimeout) {
      clearTimeout(this.stuckDetectionTimeout);
      this.stuckDetectionTimeout = null;
    }

    this.log("🧹 Glassdoor-specific cleanup completed");
  }
}