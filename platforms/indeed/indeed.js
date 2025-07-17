// platforms/indeed/indeed.js - COMPLETE UPDATED VERSION
import BasePlatformAutomation from "../../shared/base/base-platform-automation.js";
import { UrlUtils, DomUtils, FormUtils } from "../../shared/utilities/index.js";
import {
  AIService,
  ApplicationTrackerService,
  UserService,
} from "../../services/index.js";

// ========================================
// INDEED-SPECIFIC CONSTANTS AND SELECTORS
// ========================================

const INDEED_SELECTORS = {
  JOB_CARDS: [
    ".job_seen_beacon", // Main Indeed job card selector
    '[data-testid="job-tile"]', // Alternative job tile
    ".jobsearch-SerpJobCard", // Search result card
    ".slider_container .slider_item", // Slider items
    ".job", // Generic job class
    '[data-jk]', // Job cards with data-jk attribute
    '.result' // Results container
  ],
  JOB_TITLE: [
    ".jobTitle a span[title]", // Title with title attribute
    '[data-testid="job-title"] a span', // Test ID span
    "h2 a span[title]", // H2 with title
    ".jobTitle", // Job title class
    '[data-testid="job-title"]', // Direct test ID
    'a[data-jk] span', // Job key link span
    '.jobTitle-color-purple', // Styled job title
    '.jobTitle a' // Job title link
  ],
  COMPANY_NAME: [
    '[data-testid="company-name"]',
    '.companyName',
    '.jobsearch-InlineCompanyRating',
    'span[data-testid="company-name"]',
    'a[data-testid="company-name"]'
  ],
  LOCATION: [
    '[data-testid="job-location"]',
    '.companyLocation',
    '.jobsearch-JobLocation',
    '.locationsContainer'
  ],
  SALARY: [
    '[data-testid="salary-snippet"]',
    '.salary-snippet',
    '.salaryText'
  ],
  APPLY_BUTTON: [
    '#indeedApplyButton',
    '.jobsearch-IndeedApplyButton-newDesign',
    '.indeed-apply-button',
    '.indeedApplyButton'
  ],
  EXTERNAL_APPLY: [
    '#viewJobButtonLinkContainer button[href]',
    '#applyButtonLinkContainer button[href]',
    '.jobsearch-ApplyButton',
    'a[href*="/apply"]'
  ],
  FORM: [
    'form[action*="indeed"]',
    'form[action*="apply"]',
    'form.ia-ApplyFormScreen',
    'form#ia-container form',
    '.indeed-apply-form',
    'form[data-testid="application-form"]',
    'form.indeed-apply-bd'
  ],
  RESUME_UPLOAD: [
    'input[type="file"][accept=".pdf,.doc,.docx"]',
    'input[type="file"][name="resume"]',
    '[data-testid="resume-upload-input"]',
    '.ia-ResumeUpload-fileInput',
    'input[type="file"]'
  ],
  SUBMIT_BUTTON: [
    'button[type="submit"]',
    'input[type="submit"]',
    'button[data-testid="submit-application"]',
    'button.submit-button',
    'button.apply-button',
    '#submit-application',
    '.ia-continueButton'
  ]
};

const INDEED_CONFIG = {
  PLATFORM: "indeed",
  URL_PATTERNS: {
    SEARCH_PAGE: /(?:[\w-]+\.)?indeed\.com\/jobs/,
    JOB_PAGE: /indeed\.com\/(viewjob|job)/,
    APPLY_PAGE: /indeed\.com\/apply|smartapply\.indeed\.com\/beta\/indeedapply\/form/,
  },
  MAX_APPLICATION_TIME: 300000, // 5 minutes
  RETRY_DELAYS: [2000, 5000, 10000], // Progressive retry delays
};

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
    
    // ✅ ADD: Application state tracking
    this.applicationState = {
      isApplicationInProgress: false,
      applicationStartTime: null,
      currentJobData: null,
      currentJobTabId: null,
      processedUrls: new Set()
    };
    
    // ✅ ADD: Error tracking and timeouts
    this.stuckDetectionTimeout = null;
    this.maxApplicationTime = INDEED_CONFIG.MAX_APPLICATION_TIME;
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

  isIndeedJobListingPage(url) {
    return (
      /^https:\/\/(www\.)?indeed\.com\/viewjob/.test(url) &&
      !url.includes("indeed.com/apply")
    );
  }

  // ========================================
  // INITIALIZATION AND SETUP
  // ========================================

  async initialize() {
    await super.initialize();

    // ✅ ADD: Initialize Indeed-specific file handler
    try {
      const { default: IndeedFileHandler } = await import(
        "./indeed-file-handler.js"
      );
      this.fileHandler = new IndeedFileHandler({
        statusService: this.statusOverlay,
        apiHost: this.getApiHost(),
      });
    } catch (error) {
      this.log("⚠️ Could not load Indeed file handler:", error);
    }

    // Initialize Indeed-specific handlers
    try {
      const { default: IndeedFormHandler } = await import(
        "./indeed-form-handler.js"
      );

      this.formHandler = new IndeedFormHandler({
        logger: (message) => this.statusOverlay.addInfo(message),
        host: this.getApiHost(),
        userData: this.userProfile || {},
        jobDescription: "",
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
    } else if (this.isIndeedApplicationPage(url)) {
      this.statusOverlay.addInfo("Indeed application page detected");
      await this.startApplicationProcess();
    } else if (this.isIndeedJobListingPage(url)) {
      this.statusOverlay.addInfo("Indeed job page detected");
      await this.handleJobListingPage();
    } else if (this.isIndeedSearchPage(url)) {
      this.statusOverlay.addInfo("Indeed search page detected");
      await this.startJobSearchProcess();
    } else {
      this.log("❓ Unknown page type, waiting for navigation");
      await this.waitForValidPage();
    }
  }

  // ========================================
  // JOB CARD PROCESSING METHODS
  // ========================================

  /**
   * Enhanced Indeed job card detection with multiple selectors
   */
  getIndeedJobCards() {
    for (const selector of INDEED_SELECTORS.JOB_CARDS) {
      const cards = document.querySelectorAll(selector);
      if (cards.length > 0) {
        console.log(`Found ${cards.length} job cards using selector: ${selector}`);
        // Filter out non-visible cards
        const visibleCards = Array.from(cards).filter(card => this.isElementVisible(card));
        if (visibleCards.length > 0) {
          return visibleCards;
        }
      }
    }

    console.log("No job cards found with standard selectors, trying fallback");
    
    // Fallback: Look for any element with job-related attributes
    const fallbackCards = document.querySelectorAll('[data-jk], [class*="job"], [id*="job"]');
    return Array.from(fallbackCards).filter(card => 
      this.isElementVisible(card) && 
      card.querySelector('a[href*="viewjob"]')
    );
  }

  /**
   * Enhanced job card ID extraction matching the background handler
   */
  getJobCardId(jobCard) {
    try {
      // Method 1: Try to get job ID from data attribute
      const dataJk = jobCard.getAttribute("data-jk");
      if (dataJk) return dataJk;

      // Method 2: Extract from title link href
      const titleLink = jobCard.querySelector(
        'a[href*="viewjob?jk="], .jobTitle a, [data-testid="job-title"] a'
      );
      if (titleLink && titleLink.href) {
        const match = titleLink.href.match(/jk=([^&]+)/);
        if (match && match[1]) {
          return match[1];
        }
      }

      // Method 3: Extract from any link in the card
      const anyLink = jobCard.querySelector('a[href*="jk="]');
      if (anyLink && anyLink.href) {
        const match = anyLink.href.match(/jk=([^&]+)/);
        if (match && match[1]) {
          return match[1];
        }
      }

      // Method 4: Fallback to title + company hash
      const title = this.getJobTitleFromCard(jobCard) || "";
      const company = this.getCompanyFromCard(jobCard) || "";
      const fallbackId = `${title}-${company}`.replace(/\s+/g, "").toLowerCase();
      
      return fallbackId || `card-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    } catch (error) {
      console.error("Error extracting job card ID:", error);
      return `card-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
  }

  /**
   * Enhanced job URL extraction with multiple strategies
   */
  getJobUrlFromCard(card) {
    const selectors = [
      'a[href*="viewjob?jk="]', // Primary Indeed job link
      ".jobTitle a", // Job title link
      '[data-testid="job-title"] a', // Job title test ID
      'h2 a', // Header link
      'a[data-jk]', // Link with job key
      'a[href*="/viewjob/"]', // Alternative viewjob format
      'a[href*="indeed.com"]' // Any Indeed link
    ];

    for (const selector of selectors) {
      const link = card.querySelector(selector);
      if (link && link.href) {
        // Validate it's a proper Indeed job URL
        if (link.href.includes('indeed.com') && 
            (link.href.includes('viewjob') || link.href.includes('jk='))) {
          return link.href;
        }
      }
    }

    return null;
  }

  /**
   * Enhanced job title extraction
   */
  getJobTitleFromCard(card) {
    for (const selector of INDEED_SELECTORS.JOB_TITLE) {
      const element = card.querySelector(selector);
      if (element) {
        const title = element.getAttribute("title") || element.textContent?.trim();
        if (title && title.length > 0) {
          return title;
        }
      }
    }

    return "Job Application";
  }

  /**
   * Extract company name from job card
   */
  getCompanyFromCard(jobCard) {
    for (const selector of INDEED_SELECTORS.COMPANY_NAME) {
      const element = jobCard.querySelector(selector);
      if (element) {
        return element.textContent?.trim() || "";
      }
    }

    return "";
  }

  /**
   * Get location from job card
   */
  getLocationFromCard(jobCard) {
    for (const selector of INDEED_SELECTORS.LOCATION) {
      const element = jobCard.querySelector(selector);
      if (element) {
        return element.textContent?.trim() || "";
      }
    }

    return "";
  }

  /**
   * Get salary from job card
   */
  getSalaryFromCard(jobCard) {
    for (const selector of INDEED_SELECTORS.SALARY) {
      const element = jobCard.querySelector(selector);
      if (element) {
        return element.textContent?.trim() || "";
      }
    }

    return "";
  }

  /**
   * Enhanced job details extraction matching background handler
   */
  extractJobDetailsFromCard(jobCard) {
    try {
      const title = this.getJobTitleFromCard(jobCard) || "Unknown Position";
      const company = this.getCompanyFromCard(jobCard) || "Unknown Company";
      const location = this.getLocationFromCard(jobCard) || "Unknown Location";
      const salary = this.getSalaryFromCard(jobCard) || "Not specified";
      const jobUrl = this.getJobUrlFromCard(jobCard) || window.location.href;
      const jobId = this.getJobCardId(jobCard);

      return {
        jobId,
        title,
        company,
        location,
        salary,
        jobUrl,
        platform: "indeed",
        extractedAt: Date.now(),
      };
    } catch (error) {
      console.error("Error extracting Indeed job details:", error);
      return {
        jobId: "",
        title: "Unknown Position",
        company: "Unknown Company",
        location: "Unknown Location",
        salary: "Not specified",
        jobUrl: window.location.href,
        platform: "indeed",
        extractedAt: Date.now(),
      };
    }
  }

  // ========================================
  // SEARCH PROCESSING METHODS
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

  /**
   * Enhanced search next with better error handling and retry logic
   */
  async searchNext() {
    try {
      this.log("Executing Indeed searchNext");

      // Check if application is in progress
      if (this.applicationState.isApplicationInProgress) {
        this.log("Application in progress, checking status...");
        this.statusOverlay.addInfo("Application in progress, waiting to complete...");
        
        // Check how long the application has been running
        const now = Date.now();
        const applicationDuration = now - (this.applicationState.applicationStartTime || now);
        
        if (applicationDuration > this.maxApplicationTime) {
          this.log("Application has been running for too long, resetting state");
          this.statusOverlay.addWarning("Application timeout detected, resetting...");
          this.resetApplicationStateOnError();
        } else {
          // Continue checking status
          this.safeSendPortMessage({ type: "CHECK_APPLICATION_STATUS" });
          return;
        }
      }

      this.statusOverlay.addInfo("Searching for job cards...");

      // Determine search method based on current page
      if (this.isIndeedSearchPage(window.location.href)) {
        await this.processIndeedJobCards();
      } else if (window.location.href.includes("google.com/search")) {
        await super.searchNext(); // Use base class Google search logic
      } else {
        this.statusOverlay.addWarning("Unknown page type for search");
        await this.waitForValidPage();
      }

    } catch (err) {
      console.error("Error in Indeed searchNext:", err);
      this.statusOverlay.addError("Error in search: " + err.message);
      this.resetApplicationStateOnError();
      
      // Retry after delay
      setTimeout(() => {
        if (!this.applicationState.isApplicationInProgress) {
          this.searchNext();
        }
      }, 5000);
    }
  }

  /**
   * Enhanced Indeed job cards processing with better validation
   */
  async processIndeedJobCards() {
    try {
      const jobCards = this.getIndeedJobCards();
      this.log(`Found ${jobCards.length} job cards on Indeed page`);

      if (jobCards.length === 0) {
        await this.handleNoJobCardsFound();
        return;
      }

      // Find unprocessed job card with validation
      const unprocessedCard = await this.findValidUnprocessedJobCard(jobCards);

      if (unprocessedCard) {
        await this.processIndeedJobCard(unprocessedCard);
      } else {
        await this.handleNoUnprocessedJobCards();
      }
    } catch (error) {
      console.error("Error processing Indeed job cards:", error);
      this.statusOverlay.addError("Error processing job cards: " + error.message);
      throw error;
    }
  }

  /**
   * Enhanced unprocessed job card finder with validation
   */
  async findValidUnprocessedJobCard(jobCards) {
    for (const card of jobCards) {
      try {
        const cardId = this.getJobCardId(card);

        // Skip if already processed
        if (this.processedJobCards.has(cardId)) {
          continue;
        }

        const jobUrl = this.getJobUrlFromCard(card);
        if (!jobUrl) {
          this.log(`Skipping card ${cardId} - no valid URL found`);
          continue;
        }

        // Validate URL format
        if (!this.isValidJobUrl(jobUrl)) {
          this.log(`Skipping card ${cardId} - invalid URL format: ${jobUrl}`);
          continue;
        }

        const normalizedUrl = this.normalizeUrlFully(jobUrl);

        // Check if already processed
        if (this.isLinkProcessed(normalizedUrl)) {
          this.processedJobCards.add(cardId);
          this.log(`Skipping card ${cardId} - URL already processed`);
          continue;
        }

        // Additional validation: Check if card has required elements
        const hasTitle = this.getJobTitleFromCard(card);
        if (!hasTitle || hasTitle === "Job Application") {
          this.log(`Skipping card ${cardId} - no valid title found`);
          continue;
        }

        this.log(`Found valid unprocessed job card: ${cardId}`);
        return { card, url: jobUrl, cardId };

      } catch (error) {
        console.error(`Error validating job card:`, error);
        continue;
      }
    }

    return null;
  }

  /**
   * Enhanced URL validation
   */
  isValidJobUrl(url) {
    if (!url || typeof url !== 'string') return false;
    
    try {
      const urlObj = new URL(url);
      
      // Must be Indeed domain
      if (!urlObj.hostname.includes('indeed.com')) return false;
      
      // Must have job identifier
      if (!url.includes('viewjob') && !url.includes('jk=')) return false;
      
      // Should not be apply page (we want job listing page)
      if (url.includes('/apply/') || url.includes('smartapply')) return false;
      
      return true;
    } catch (error) {
      return false;
    }
  }

  /**
   * Updated job card processing with enhanced error handling
   */
  async processIndeedJobCard(jobData) {
    const { card, url, cardId } = jobData;

    try {
      this.statusOverlay.addSuccess("Found Indeed job to apply: " + url);
      this.processedJobCards.add(cardId);

      if (this.applicationState.isApplicationInProgress) {
        this.log("Application in progress, aborting new job processing");
        return;
      }

      // Extract full job details
      const jobDetails = this.extractJobDetailsFromCard(card);
      
      // Visual feedback
      this.markJobCardAsProcessing(card);

      // Set application state
      this.applicationState.isApplicationInProgress = true;
      this.applicationState.applicationStartTime = Date.now();
      this.applicationState.currentJobData = jobDetails;

      if (!this.applicationState.processedUrls) {
        this.applicationState.processedUrls = new Set();
      }
      this.applicationState.processedUrls.add(this.normalizeUrlFully(url));

      this.setStuckDetectionTimeout();

      // Send job task message to background
      this.safeSendPortMessage({
        type: this.getJobTaskMessageType(),
        data: {
          url,
          title: jobDetails.title,
          company: jobDetails.company,
          location: jobDetails.location,
        },
      });

    } catch (err) {
      this.handleJobTaskError(err, url, card);
    }
  }

  /**
   * Mark job card as being processed
   */
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

  /**
   * Enhanced no job cards handling with retry logic
   */
  async handleNoJobCardsFound() {
    this.statusOverlay.addInfo("No job cards found, attempting to load more...");

    // Try scrolling to load more jobs
    window.scrollTo(0, document.body.scrollHeight);
    await this.wait(2000);

    // Check if more jobs loaded
    const jobCardsAfterScroll = this.getIndeedJobCards();
    if (jobCardsAfterScroll.length > 0) {
      this.statusOverlay.addInfo("Found jobs after scrolling");
      return await this.processIndeedJobCards();
    }

    // Try clicking next page
    const nextButton = document.querySelector(
      'a[aria-label="Next Page"], .np[aria-label="Next"], .pn'
    );
    
    if (nextButton && this.isElementVisible(nextButton) && !nextButton.getAttribute("aria-disabled")) {
      this.statusOverlay.addInfo('Clicking "Next Page" button');
      nextButton.click();
      
      await this.wait(3000);
      
      // Check if we're still processing
      if (!this.applicationState.isApplicationInProgress) {
        return this.searchNext();
      }
    } else {
      this.statusOverlay.addSuccess("All Indeed jobs processed!");
      this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
    }
  }

  /**
   * Handle no unprocessed job cards
   */
  async handleNoUnprocessedJobCards() {
    this.statusOverlay.addInfo("All visible job cards have been processed");
    await this.handleNoJobCardsFound();
  }

  // ========================================
  // APPLICATION PROCESSING METHODS
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

  /**
   * Handle job listing page
   */
  async handleJobListingPage() {
    try {
      this.statusOverlay.addInfo("Indeed job listing page detected - looking for Apply button");

      // Extract job description from listing page
      this.cachedJobDescription = await this.extractIndeedJobDescription();

      // Find and click apply button
      const applyButton = await this.findIndeedApplyButton();
      if (!applyButton) {
        throw new Error("Cannot find Apply button on Indeed job listing page");
      }

      this.log("🖱️ Clicking Apply button");
      applyButton.click();

      // Wait for application page to load
      await this.waitForIndeedApplicationPage();
      this.statusOverlay.addSuccess("Application page loaded successfully");
      
      // Start application process
      await this.startApplicationProcess();
    } catch (error) {
      this.reportError(error, { phase: "jobListing" });
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

  /**
   * Enhanced form detection for Indeed applications
   */
  findIndeedApplicationForm() {
    for (const selector of INDEED_SELECTORS.FORM) {
      const form = document.querySelector(selector);
      if (form && this.isElementVisible(form)) {
        return form;
      }
    }

    // Fallback to any visible form
    const allForms = document.querySelectorAll('form');
    for (const form of allForms) {
      if (this.isElementVisible(form) && form.elements.length > 0) {
        return form;
      }
    }

    return null;
  }

  /**
   * Enhanced application form processing with better error handling
   */
  async processApplicationForm(form) {
    try {
      this.statusOverlay.addInfo("Found Indeed application form, filling it out");

      // Extract job description for AI context
      const jobDescription = this.cachedJobDescription || 
                            await this.extractIndeedJobDescription();

      // Update form handler with job description and user profile
      if (this.formHandler) {
        this.formHandler.jobDescription = jobDescription;
        this.formHandler.userData = this.userProfile;
      }

      // Step 1: Handle resume upload first
      try {
        if (this.userProfile && this.userProfile.resumeUrl) {
          this.statusOverlay.addInfo("Handling resume upload...");
          await this.handleIndeedResumeUpload();
        }
      } catch (error) {
        this.statusOverlay.addWarning("Resume upload failed: " + error.message);
        // Continue with form filling even if resume upload fails
      }

      // Step 2: Handle file uploads via file handler
      try {
        if (this.fileHandler && this.userProfile) {
          await this.fileHandler.handleFileUploads(
            form,
            this.userProfile,
            jobDescription
          );
        }
      } catch (error) {
        this.statusOverlay.addWarning("File upload failed: " + error.message);
        // Continue with form filling
      }

      // Step 3: Fill form fields via form handler
      try {
        if (this.formHandler && this.userProfile) {
          await this.formHandler.fillFormWithProfile(
            form,
            this.userProfile,
            jobDescription
          );
          this.statusOverlay.addSuccess("Form fields filled");
        }
      } catch (error) {
        this.statusOverlay.addWarning("Form filling failed: " + error.message);
        // Continue to submission
      }

      // Step 4: Find and click submit button
      const submitButton = this.findSubmitButton(form);
      if (!submitButton) {
        throw new Error("Cannot find submit button");
      }

      return await this.submitIndeedForm(submitButton);

    } catch (error) {
      console.error("Error processing Indeed application form:", error);
      throw error;
    }
  }

  /**
   * Enhanced submit button detection
   */
  findSubmitButton(form) {
    // Try specific selectors first
    for (const selector of INDEED_SELECTORS.SUBMIT_BUTTON) {
      const button = form.querySelector(selector);
      if (button && this.isElementVisible(button) && !button.disabled) {
        return button;
      }
    }

    // Look for buttons with submit-related text
    const allButtons = form.querySelectorAll('button');
    for (const button of allButtons) {
      if (!this.isElementVisible(button) || button.disabled) continue;
      
      const text = button.textContent.toLowerCase().trim();
      if (text.includes('submit') || 
          text.includes('apply') || 
          text.includes('send application') ||
          text.includes('continue')) {
        return button;
      }
    }

    return null;
  }

  /**
   * Enhanced form submission with confirmation handling
   */
  async submitIndeedForm(submitButton) {
    try {
      this.statusOverlay.addInfo("Submitting Indeed application...");

      // Scroll submit button into view
      submitButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await this.wait(600);

      // Check for any blocking modals or overlays
      await this.handleBlockingModals();

      // Click submit button
      try {
        submitButton.click();
        this.statusOverlay.addSuccess("Clicked submit button");
      } catch (e) {
        this.statusOverlay.addError("Failed to click submit button: " + e.message);
        return false;
      }

      // Wait for submission to process
      await this.wait(2000);

      // Check for confirmation or errors
      const submissionResult = await this.waitForSubmissionResult();
      
      if (submissionResult.success) {
        this.statusOverlay.addSuccess("Application submitted successfully!");
        await this.handleSuccessfulSubmission();
        return true;
      } else if (submissionResult.error) {
        this.statusOverlay.addError("Submission failed: " + submissionResult.error);
        return false;
      } else {
        // Assume success if no clear error
        this.statusOverlay.addSuccess("Application likely submitted");
        await this.handleSuccessfulSubmission();
        return true;
      }

    } catch (error) {
      console.error("Error submitting Indeed form:", error);
      this.statusOverlay.addError("Form submission error: " + error.message);
      return false;
    }
  }

  /**
   * Handle blocking modals or overlays
   */
  async handleBlockingModals() {
    // Look for common blocking elements
    const blockingSelectors = [
      '.modal-backdrop',
      '.overlay',
      '.popup',
      '[role="dialog"]',
      '.notification-banner'
    ];

    for (const selector of blockingSelectors) {
      const element = document.querySelector(selector);
      if (element && this.isElementVisible(element)) {
        // Try to close it
        const closeButton = element.querySelector(
          '.close, .dismiss, [aria-label="close"], [aria-label="dismiss"]'
        );
        if (closeButton) {
          closeButton.click();
          await this.wait(500);
        }
      }
    }
  }

  /**
   * Wait for submission result with timeout
   */
  async waitForSubmissionResult(timeout = 10000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      // Check for success indicators
      if (this.checkIndeedSubmissionSuccess()) {
        return { success: true };
      }

      // Check for error messages
      const errorMessage = this.checkForSubmissionErrors();
      if (errorMessage) {
        return { success: false, error: errorMessage };
      }

      // Check if URL changed to indicate success
      if (window.location.href.includes('confirmation') || 
          window.location.href.includes('success')) {
        return { success: true };
      }

      await this.wait(500);
    }

    // Timeout reached - assume success if no errors found
    return { success: true };
  }

  /**
   * Check for submission errors
   */
  checkForSubmissionErrors() {
    const errorSelectors = [
      '.error-message',
      '.validation-error',
      '.form-error',
      '.alert-error',
      '[role="alert"]'
    ];

    for (const selector of errorSelectors) {
      const errorElement = document.querySelector(selector);
      if (errorElement && this.isElementVisible(errorElement)) {
        const errorText = errorElement.textContent.trim();
        if (errorText.length > 0) {
          return errorText;
        }
      }
    }

    return null;
  }

  /**
   * Handle successful submission
   */
  async handleSuccessfulSubmission() {
    // Extract job details for reporting
    const jobDetails = this.applicationState.currentJobData || 
                      await this.extractIndeedJobDescription();

    // Report success to background
    this.safeSendPortMessage({
      type: "SEND_CV_TASK_DONE",
      data: {
        jobId: jobDetails.jobId || this.extractJobIdFromUrl(),
        title: jobDetails.title || "Job on Indeed",
        company: jobDetails.company || "Company on Indeed",
        location: jobDetails.location || "Not specified",
        jobUrl: window.location.href,
        platform: "indeed",
        submittedAt: Date.now()
      },
    });

    // Reset application state
    this.applicationState.isApplicationInProgress = false;
    this.applicationState.currentJobData = null;
    this.applicationState.applicationStartTime = null;
  }

  // ========================================
  // APPLY BUTTON AND FORM DETECTION
  // ========================================

  /**
   * Enhanced apply button detection
   */
  async findIndeedApplyButton() {
    try {
      this.statusOverlay.addInfo("Looking for Indeed apply button...");

      // Method 1: Look for Easy Apply button
      for (const selector of INDEED_SELECTORS.APPLY_BUTTON) {
        const button = document.querySelector(selector);
        if (button && this.isElementVisible(button) && !button.disabled) {
          this.statusOverlay.addSuccess("✅ Found Easy Apply button");
          return button;
        }
      }

      // Method 2: Look for external apply buttons
      for (const selector of INDEED_SELECTORS.EXTERNAL_APPLY) {
        const button = document.querySelector(selector);
        if (button && this.isElementVisible(button)) {
          this.statusOverlay.addWarning("⚠️ Found External Apply button (redirects to company site)");
          return null; // We don't want to handle external applications
        }
      }

      // Method 3: Look for any button with "apply" text
      const allButtons = document.querySelectorAll('button, a');
      for (const button of allButtons) {
        if (button.textContent.toLowerCase().includes('apply') && 
            this.isElementVisible(button) && 
            !button.disabled) {
          this.statusOverlay.addInfo("Found generic apply button");
          return button;
        }
      }

      this.statusOverlay.addWarning("❌ No apply button found");
      return null;
    } catch (error) {
      console.error("Error finding apply button:", error);
      this.statusOverlay.addError("Error finding apply button: " + error.message);
      return null;
    }
  }

  // ========================================
  // FILE AND RESUME HANDLING
  // ========================================

  /**
   * Enhanced resume upload handling for Indeed
   */
  async handleIndeedResumeUpload() {
    try {
      this.statusOverlay.addInfo("Checking for Indeed resume upload option");

      // Wait for elements to be fully loaded
      await this.wait(2000);

      // Check if there's already a resume preview
      const resumePreview = document.querySelector(
        '[data-testid="ResumeThumbnail"], .css-1qsu1np, [aria-roledescription="document"]'
      );

      if (resumePreview) {
        this.statusOverlay.addInfo("Resume already uploaded and showing in preview");
        
        // Look for continue button
        const continueButton = document.querySelector(
          '[data-testid="IndeedApplyButton"], button[type="submit"]'
        ) || this.findButtonByText("Continue") || this.findButtonByText("Next");

        if (continueButton && this.isElementVisible(continueButton)) {
          this.statusOverlay.addInfo("Clicking continue button after resume preview");
          continueButton.click();
          await this.wait(2000);
          return true;
        }
        return true;
      }

      // Check for upload resume button
      const uploadResumeButton = this.findButtonByText("Upload resume") ||
                                this.findButtonByText("Upload Resume") ||
                                document.querySelector('[data-testid="resume-upload-button"]');

      if (uploadResumeButton && this.isElementVisible(uploadResumeButton)) {
        this.statusOverlay.addInfo("Found upload resume button, clicking it");
        uploadResumeButton.click();
        await this.wait(1500);
      }

      // Check for existing resume selection
      const resumeSelectionItems = document.querySelectorAll(
        '[data-testid="resume-select-card"], .css-zmmde0, .ia-ResumeSelection-resume'
      );

      if (resumeSelectionItems && resumeSelectionItems.length > 0) {
        this.statusOverlay.addInfo(`Found ${resumeSelectionItems.length} existing resumes, selecting first one`);
        
        resumeSelectionItems[0].click();
        await this.wait(1000);

        const continueAfterSelect = document.querySelector('button[data-testid="continue-button"]') ||
                                   this.findButtonByText("Continue") ||
                                   document.querySelector('button[type="submit"]');

        if (continueAfterSelect && this.isElementVisible(continueAfterSelect)) {
          this.statusOverlay.addInfo("Clicking continue after selecting resume");
          continueAfterSelect.click();
          await this.wait(2000);
        }
        return true;
      }

      // Look for file input elements
      const fileInputs = INDEED_SELECTORS.RESUME_UPLOAD
        .map(selector => document.querySelector(selector))
        .filter(input => input !== null && this.isInputEnabled(input));

      if (fileInputs.length === 0) {
        this.statusOverlay.addInfo("No resume upload field found on Indeed");
        return false;
      }

      const fileInput = fileInputs[0];
      this.statusOverlay.addInfo(`Found file input: ${fileInput.name || "unnamed input"}`);

      // Upload resume using file handler
      if (!this.userProfile?.resumeUrl) {
        this.statusOverlay.addWarning("No resume URL in profile");
        return false;
      }

      this.statusOverlay.addInfo("Uploading resume to Indeed");
      const uploaded = await this.fileHandler.handleResumeUpload(
        this.userProfile, 
        { querySelector: () => fileInput }
      );

      if (uploaded) {
        this.statusOverlay.addSuccess("Resume uploaded successfully to Indeed");
        await this.wait(3000);

        const continueAfterUpload = document.querySelector('button[type="submit"]') ||
                                   this.findButtonByText("Continue") ||
                                   this.findButtonByText("Next") ||
                                   document.querySelector('[data-testid="continue-button"]');

        if (continueAfterUpload && this.isElementVisible(continueAfterUpload)) {
          this.statusOverlay.addInfo("Clicking continue after resume upload");
          continueAfterUpload.click();
          await this.wait(2000);
        }
        return true;
      } else {
        this.statusOverlay.addError("Resume upload to Indeed failed");
        return false;
      }
    } catch (error) {
      console.error("Error during Indeed resume upload:", error);
      this.statusOverlay.addError("Error during Indeed resume upload: " + error.message);
      return false;
    }
  }

  // ========================================
  // JOB DESCRIPTION AND DATA EXTRACTION
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

  /**
   * Extract job ID from current URL
   */
  extractJobIdFromUrl() {
    try {
      const url = window.location.href;
      const match = url.match(/jk=([^&]+)/);
      return match ? match[1] : null;
    } catch (error) {
      return null;
    }
  }

  // ========================================
  // STATUS AND SUCCESS CHECKING
  // ========================================

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

  /**
   * Check if already applied to Indeed job
   */
  async checkIndeedAlreadyApplied() {
    try {
      const url = window.location.href;
      
      // Check URL for applied indicators
      if (url.includes("smartapply.indeed.com/beta/indeedapply/form")) {
        const pageText = document.body.innerText;
        const alreadyAppliedText = "You've applied to this job";

        if (pageText.includes(alreadyAppliedText)) {
          this.statusOverlay.addInfo("Found 'You've applied to this job' message - already applied");
          return true;
        }
      }

      // Check for other applied indicators
      const appliedIndicators = [
        ".indeed-apply-status-applied",
        ".application-submitted",
        ".already-applied"
      ];

      for (const selector of appliedIndicators) {
        if (document.querySelector(selector)) {
          this.statusOverlay.addInfo("Found applied indicator - already applied");
          return true;
        }
      }

      return false;
    } catch (error) {
      console.error("Error checking if already applied:", error);
      return false;
    }
  }

  /**
   * Check if on Indeed SmartApply form page
   */
  isOnIndeedApplyFormPage() {
    const url = window.location.href;
    
    // Check URL patterns
    if (url.includes("smartapply.indeed.com/beta/indeedapply/form") ||
        url.includes("indeed.com/apply") ||
        url.includes("indeed.com/viewjob")) {
      return true;
    }

    // Check for form elements
    const hasFormElements = document.querySelector("form") ||
                           document.querySelector(".ia-ApplyFormScreen") ||
                           document.querySelector("#ia-container") ||
                           document.querySelector(".indeed-apply-bd") ||
                           document.querySelector(".indeed-apply-form");

    return !!hasFormElements;
  }

  /**
   * Wait for Indeed application page to load
   */
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

      case "NEXT_READY_ACKNOWLEDGED":
        this.handleSearchNextReady(data);
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

  handleJobTabStatus(data) {
    this.log("📊 Job tab status:", data);
    
    if (data && !data.isOpen && this.applicationState.isApplicationInProgress) {
      this.log("⚠️ Job tab closed but application still in progress - resetting");
      this.resetApplicationStateOnError();
    }
  }

  handleSearchNextReady(data) {
    this.log("🔄 Search next ready acknowledged");
    // Continue with next search iteration
    setTimeout(() => {
      if (!this.applicationState.isApplicationInProgress) {
        this.searchNext();
      }
    }, 1000);
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

  // ========================================
  // ERROR HANDLING AND RECOVERY
  // ========================================

  /**
   * Enhanced error handling for job processing
   */
  handleJobTaskError(error, url, card) {
    console.error("Error processing Indeed job:", error);
    this.statusOverlay.addError("Error processing job: " + error.message);
    
    // Reset application state
    this.applicationState.isApplicationInProgress = false;
    this.applicationState.applicationStartTime = null;
    this.applicationState.currentJobData = null;
    
    // Remove processing visual indicators
    if (card) {
      card.style.border = "";
      card.style.backgroundColor = "";
      const indicator = card.querySelector('.processing-indicator');
      if (indicator) {
        indicator.remove();
      }
    }
    
    // Continue to next job after delay
    setTimeout(() => {
      if (!this.applicationState.isApplicationInProgress) {
        this.searchNext();
      }
    }, 3000);
  }

  handleApplicationError(error) {
    if (error.name === "SendCvSkipError" || error.name === "ApplicationSkipError") {
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
    
    // Reset application state
    this.resetApplicationStateOnError();
  }

  /**
   * Enhanced error state reset
   */
  resetApplicationStateOnError() {
    this.log("Resetting application state due to error");
    
    this.applicationState.isApplicationInProgress = false;
    this.applicationState.applicationStartTime = null;
    this.applicationState.currentJobData = null;
    this.applicationState.currentJobTabId = null;
    
    // Clear any stuck detection timeouts
    if (this.stuckDetectionTimeout) {
      clearTimeout(this.stuckDetectionTimeout);
      this.stuckDetectionTimeout = null;
    }
    
    this.statusOverlay.addInfo("Application state reset - ready for next job");
  }

  /**
   * Enhanced stuck detection with recovery
   */
  setStuckDetectionTimeout() {
    // Clear any existing timeout
    if (this.stuckDetectionTimeout) {
      clearTimeout(this.stuckDetectionTimeout);
    }
    
    this.stuckDetectionTimeout = setTimeout(() => {
      this.log("Stuck detection triggered - application taking too long");
      this.statusOverlay.addWarning("Application timeout detected, moving to next job");
      this.resetApplicationStateOnError();
      
      // Continue to next job
      setTimeout(() => {
        if (!this.applicationState.isApplicationInProgress) {
          this.searchNext();
        }
      }, 2000);
    }, this.maxApplicationTime);
  }

  // ========================================
  // UTILITY AND HELPER METHODS
  // ========================================

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

  /**
   * Find button by text content
   */
  findButtonByText(text) {
    const allButtons = Array.from(document.querySelectorAll("button"));
    return allButtons.find(button =>
      button.textContent && 
      button.textContent.trim().toLowerCase().includes(text.toLowerCase()) &&
      this.isElementVisible(button)
    );
  }

  /**
   * Check if input is enabled and accessible
   */
  isInputEnabled(input) {
    if (!input) return false;
    try {
      return !input.disabled && 
             !input.readOnly && 
             this.isElementVisible(input) &&
             getComputedStyle(input).display !== "none" &&
             getComputedStyle(input).visibility !== "hidden";
    } catch (error) {
      return false;
    }
  }

  /**
   * Check if element is visible
   */
  isElementVisible(element) {
    if (!element) return false;
    try {
      const style = window.getComputedStyle(element);
      if (style.display === "none" || 
          style.visibility === "hidden" || 
          style.opacity === "0") {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch (error) {
      return false;
    }
  }

  errorToString(e) {
    if (!e) return "Unknown error (no details)";
    if (e instanceof Error) {
      return e.message + (e.stack ? `\n${e.stack}` : "");
    }
    return String(e);
  }

  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

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

  // ========================================
  // SESSION CONTEXT AND USER PROFILE
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

  // ========================================
  // CLEANUP
  // ========================================

  cleanup() {
    super.cleanup();
    
    // Clear Indeed-specific state
    this.processedJobCards.clear();
    this.cachedJobDescription = null;
    
    if (this.stuckDetectionTimeout) {
      clearTimeout(this.stuckDetectionTimeout);
      this.stuckDetectionTimeout = null;
    }
    
    this.resetApplicationStateOnError();
    this.log("🧹 Indeed-specific cleanup completed");
  }
}