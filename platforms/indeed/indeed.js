// platforms/indeed/indeed.js - Adapted for BasePlatformAutomation
import BasePlatformAutomation from "../../shared/base/base-platform-automation.js";
import { UrlUtils, DomUtils } from "../../shared/utilities/index.js";
import {
  AIService,
  ApplicationTrackerService,
  UserService,
} from "../../services/index.js";
import FormHandler from "../../shared/indeed_glassdoors/form-handler.js";

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
    "[data-jk]", // Job cards with data-jk attribute
    ".result", // Results container
  ],
  JOB_TITLE: [
    ".jcs-JobTitle span[id^='jobTitle-']", // Original selector
    ".jobTitle a span[title]", // Title with title attribute
    '[data-testid="job-title"] a span', // Test ID span
    "h2 a span[title]", // H2 with title
    ".jobTitle", // Job title class
    '[data-testid="job-title"]', // Direct test ID
    "a[data-jk] span", // Job key link span
    ".jobTitle-color-purple", // Styled job title
    ".jobTitle a", // Job title link
  ],
  COMPANY_NAME: [
    "[data-testid='company-name']",
    ".companyName",
    ".jobsearch-InlineCompanyRating",
    'span[data-testid="company-name"]',
    'a[data-testid="company-name"]',
  ],
  LOCATION: [
    "[data-testid='text-location']",
    '[data-testid="job-location"]',
    ".companyLocation",
    ".jobsearch-JobLocation",
    ".locationsContainer",
  ],
  SALARY: ["[data-testid='salary-snippet']", ".salary-snippet", ".salaryText"],
  APPLY_BUTTON: [
    "#indeedApplyButton",
    ".jobsearch-IndeedApplyButton-newDesign",
    ".indeed-apply-button",
    ".indeedApplyButton",
  ],
  EXTERNAL_APPLY: [
    "#viewJobButtonLinkContainer button[href]",
    "#applyButtonLinkContainer button[href]",
    ".jobsearch-ApplyButton",
    'a[href*="/apply"]',
    ".indeed-apply-status-not-applied",
    ".indeed-apply-status-applied",
    ".indeed-apply-status-rejected",
  ],
  FORM: [
    'form[action*="indeed"]',
    'form[action*="apply"]',
    "form.ia-ApplyFormScreen",
    "form#ia-container form",
    ".indeed-apply-form",
    'form[data-testid="application-form"]',
    "form.indeed-apply-bd",
    "form",
    ".ia-ApplyFormScreen",
    "#ia-container",
    ".indeed-apply-bd",
  ],
  RESUME_UPLOAD: [
    'input[type="file"][accept=".pdf,.doc,.docx"]',
    'input[type="file"][name="resume"]',
    '[data-testid="resume-upload-input"]',
    ".ia-ResumeUpload-fileInput",
    'input[type="file"]',
  ],
  RESUME_SELECT: [
    ".ia-ResumeSelection-resume",
    '[data-testid="resume-select-card"]',
    ".css-zmmde0",
  ],
  RESUME_UPLOAD_BUTTON: [
    "button.ia-ResumeSearch-uploadButton",
    '[data-testid="resume-upload-button"]',
  ],
  SUBMIT_BUTTON: [
    'button[type="submit"]',
    'input[type="submit"]',
    'button[data-testid="submit-application"]',
    "button.submit-button",
    "button.apply-button",
    "#submit-application",
    ".ia-continueButton",
    "button.ia-continueButton",
  ],
  CONTINUE_BUTTON: ["button[type=submit]", "button.ia-continueButton"],
  EASY_APPLY_FILTER: ["#filter-epiccapplication"],
  NEXT_PAGE: [
    "[data-testid='pagination-page-next']",
    'a[aria-label="Next Page"]',
    ".np[aria-label='Next']",
    ".pn",
  ],
  POPUP_CLOSE: [".popover-x-button-close"],
};

const INDEED_CONFIG = {
  PLATFORM: "indeed",
  URL_PATTERNS: {
    SEARCH_PAGE: /(?:[\w-]+\.)?indeed\.com\/jobs/,
    JOB_PAGE: /indeed\.com\/(viewjob|job)/,
    APPLY_PAGE:
      /indeed\.com\/apply|smartapply\.indeed\.com\/beta\/indeedapply\/form/,
  },
  TIMEOUTS: {
    STANDARD: 2000,
    EXTENDED: 5000,
    MAX_TIMEOUT: 300000, // 5 minutes
    APPLICATION_TIMEOUT: 3 * 60 * 1000, // 3 minutes,
    REDIRECT_TIMEOUT: 8000, // Longer timeout for redirects
  },
  PLAN_LIMITS: {
    FREE: 10,
    STARTER: 50,
    PRO: 500,
  },
  DEBUG: true,
  BRAND_COLOR: "#4a90e2", // FastApply brand blue
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

    // State tracking
    this.state = {
      initialized: false,
      ready: false,
      isRunning: false,
      isApplicationInProgress: false,
      applicationStartTime: null,
      processedCards: new Set(),
      processedCount: 0,
      countDown: null,
      lastActivity: Date.now(),
      debounceTimers: {},
      currentJobIndex: 0,
      pendingApplication: false,
      maxRedirectAttempts: 3,
      currentRedirectAttempts: 0,
      lastClickedJobCard: null,
      formDetectionAttempts: 0,
      maxFormDetectionAttempts: 5,
      currentJobDescription: "",
      formDetected: false,
    };

    this.formHandler = null;
    this.fileHandler = null;
    this.cachedJobDescription = null;
    this.processedJobCards = new Set();
    this.healthCheckTimer = null;
    this.currentJobDetails = null;

    // Application state tracking
    this.applicationState = {
      isApplicationInProgress: false,
      applicationStartTime: null,
      currentJobData: null,
      currentJobTabId: null,
      processedUrls: new Set(),
    };

    // Error tracking and timeouts
    this.stuckDetectionTimeout = null;
    this.maxApplicationTime = INDEED_CONFIG.MAX_APPLICATION_TIME;

    // Set up health check timer
    this.healthCheckTimer = setInterval(() => this.checkHealth(), 30000);

    // Set up mutation observer to detect form elements appearing
    this.setupFormDetectionObserver();
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

    // Initialize Indeed-specific handlers
    try {
      this.formHandler = new FormHandler({
        enableDebug: true,
        logger: (message) => this.statusOverlay.addInfo(message),
        host: this.getApiHost(),
        userData: this.userProfile || {},
        jobDescription: "",
        platform: "indeed",
      });

      this.statusOverlay.addSuccess("Indeed-specific components initialized");
    } catch (error) {
      this.log("⚠️ Could not load Indeed handlers:", error);
      this.statusOverlay.addWarning("Indeed handlers not available");
    }

    this.state.initialized = true;
  }

  async start(params = {}) {
    try {
      this.isRunning = true;
      this.state.isRunning = true;
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
        console.log(
          `Found ${cards.length} job cards using selector: ${selector}`
        );
        // Filter out non-visible cards
        const visibleCards = Array.from(cards).filter((card) =>
          this.isElementVisible(card)
        );
        if (visibleCards.length > 0) {
          return visibleCards;
        }
      }
    }

    console.log("No job cards found with standard selectors, trying fallback");

    // Fallback: Look for any element with job-related attributes
    const fallbackCards = document.querySelectorAll(
      '[data-jk], [class*="job"], [id*="job"]'
    );
    return Array.from(fallbackCards).filter(
      (card) =>
        this.isElementVisible(card) && card.querySelector('a[href*="viewjob"]')
    );
  }

  /**
   * Get job cards that haven't been processed yet
   */
  getUnprocessedJobCards() {
    const allCards = this.getIndeedJobCards();

    return Array.from(allCards).filter((card) => {
      const cardId = this.getJobCardId(card);
      return !this.state.processedCards.has(cardId);
    });
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
      const fallbackId = `${title}-${company}`
        .replace(/\s+/g, "")
        .toLowerCase();

      return (
        fallbackId ||
        `card-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`
      );
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
      "h2 a", // Header link
      "a[data-jk]", // Link with job key
      'a[href*="/viewjob/"]', // Alternative viewjob format
      'a[href*="indeed.com"]', // Any Indeed link
    ];

    for (const selector of selectors) {
      const link = card.querySelector(selector);
      if (link && link.href) {
        // Validate it's a proper Indeed job URL
        if (
          link.href.includes("indeed.com") &&
          (link.href.includes("viewjob") || link.href.includes("jk="))
        ) {
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
        const title =
          element.getAttribute("title") || element.textContent?.trim();
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
        workplace: "Not specified",
        postedDate: "Not specified",
        applicants: "Not specified",
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
        workplace: "Not specified",
        postedDate: "Not specified",
        applicants: "Not specified",
      };
    }
  }

  /**
   * Mark a job card visually
   */
  markJobCard(jobCard, status) {
    try {
      // Remove any existing highlights
      const existingHighlight = jobCard.querySelector(".job-highlight");
      if (existingHighlight) {
        existingHighlight.remove();
      }

      // Create highlight element
      const highlight = document.createElement("div");
      highlight.className = "job-highlight";

      // Status-specific styling
      let color, text;
      switch (status) {
        case "processing":
          color = "#2196F3"; // Blue
          text = "Processing";
          break;
        case "applied":
          color = "#4CAF50"; // Green
          text = "Applied";
          break;
        case "skipped":
          color = "#FF9800"; // Orange
          text = "Skipped";
          break;
        case "error":
          color = "#F44336"; // Red
          text = "Error";
          break;
        default:
          color = "#9E9E9E"; // Gray
          text = "Unknown";
      }

      // Style the highlight
      highlight.style.cssText = `
        position: absolute;
        top: 0;
        right: 0;
        background-color: ${color};
        color: white;
        padding: 3px 8px;
        font-size: 12px;
        font-weight: bold;
        border-radius: 0 0 0 5px;
        z-index: 999;
      `;
      highlight.textContent = text;

      // Add border to the job card
      jobCard.style.border = `2px solid ${color}`;
      jobCard.style.position = "relative";

      // Add the highlight
      jobCard.appendChild(highlight);
    } catch (error) {
      this.log("Error marking job card:", error);
    }
  }

  /**
   * Mark the last clicked job card if available
   */
  markLastJobCardIfAvailable(status) {
    if (this.state.lastClickedJobCard) {
      this.markJobCard(this.state.lastClickedJobCard, status);
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
      if (this.state.isApplicationInProgress || this.state.pendingApplication) {
        this.log("Application in progress, checking status...");
        this.statusOverlay.addInfo(
          "Application in progress, waiting to complete..."
        );

        // Check how long the application has been running
        const now = Date.now();
        const applicationDuration =
          now - (this.state.applicationStartTime || now);

        if (applicationDuration > this.maxApplicationTime) {
          this.log(
            "Application has been running for too long, resetting state"
          );
          this.statusOverlay.addWarning(
            "Application timeout detected, resetting..."
          );
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
        if (!this.state.isApplicationInProgress) {
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
      this.statusOverlay.addError(
        "Error processing job cards: " + error.message
      );
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
        if (this.state.processedCards.has(cardId)) {
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
          this.state.processedCards.add(cardId);
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
    if (!url || typeof url !== "string") return false;

    try {
      const urlObj = new URL(url);

      // Must be Indeed domain
      if (!urlObj.hostname.includes("indeed.com")) return false;

      // Must have job identifier
      if (!url.includes("viewjob") && !url.includes("jk=")) return false;

      // Should not be apply page (we want job listing page)
      if (url.includes("/apply/") || url.includes("smartapply")) return false;

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
      this.state.processedCards.add(cardId);

      if (this.state.isApplicationInProgress) {
        this.log("Application in progress, aborting new job processing");
        return;
      }

      // Extract full job details
      const jobDetails = this.extractJobDetailsFromCard(card);

      // Visual feedback
      this.markJobCard(card, "processing");

      // Set application state
      this.state.isApplicationInProgress = true;
      this.state.applicationStartTime = Date.now();
      this.state.pendingApplication = true;
      this.state.formDetected = false;
      this.state.currentRedirectAttempts = 0;
      this.state.lastClickedJobCard = card;

      // Store job details for later tracking
      this.currentJobDetails = jobDetails;

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
   * Enhanced no job cards handling with retry logic
   */
  async handleNoJobCardsFound() {
    this.statusOverlay.addInfo(
      "No job cards found, attempting to load more..."
    );

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

    if (
      nextButton &&
      this.isElementVisible(nextButton) &&
      !nextButton.getAttribute("aria-disabled")
    ) {
      this.statusOverlay.addInfo('Clicking "Next Page" button');
      nextButton.click();

      await this.wait(3000);

      // Check if we're still processing
      if (!this.state.isApplicationInProgress) {
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
      this.statusOverlay.addInfo(
        "Indeed job listing page detected - looking for Apply button"
      );

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

  /**
   * Handle individual job page
   */
  async handleJobPage() {
    try {
      this.statusOverlay.addInfo("Processing Indeed job page");

      // Check if we're already on the application form page
      const isApplyPage = this.isOnApplyFormPage();
      this.log("Is on apply form page:", isApplyPage);

      if (isApplyPage) {
        // We're already on the form page, so let's fill it out
        this.statusOverlay.addInfo(
          "On Indeed application form page, starting application process"
        );

        // Wait for profile data
        if (!this.userProfile) {
          this.userProfile = await this.getProfileData();
        }

        if (this.userProfile) {
          // Start applying directly since we're already on the form page
          this.statusOverlay.addInfo("Starting form completion process");
          this.state.isApplicationInProgress = true;
          this.state.applicationStartTime = Date.now();
          this.state.formDetected = true;

          // Handle application form
          const success = await this.handleApplyForm();

          // Reset application state
          this.state.isApplicationInProgress = false;
          this.state.applicationStartTime = null;
          this.state.formDetected = false;

          if (success) {
            this.statusOverlay.addSuccess("Application completed successfully");

            // Track application if we have job details
            if (this.currentJobDetails) {
              this.trackApplication(this.currentJobDetails);
            }

            // After successful form submission, inform that we're ready to process next job
            if (this.state.pendingApplication) {
              this.state.pendingApplication = false;
              this.statusOverlay.addInfo("Ready to process next job");
            }
          } else {
            this.statusOverlay.addError("Failed to complete application");

            // Still mark as ready for next job
            if (this.state.pendingApplication) {
              this.state.pendingApplication = false;
            }
          }
        } else {
          this.statusOverlay.addError("No profile data available");
        }
      } else {
        // We're on a job details page, look for the apply button
        this.statusOverlay.addInfo("Looking for Easy Apply button");

        let applyButton = await this.findIndeedApplyButton();

        if (applyButton) {
          this.statusOverlay.addInfo("Found apply button, clicking it");
          // Set application in progress
          this.state.isApplicationInProgress = true;
          this.state.applicationStartTime = Date.now();
          this.state.pendingApplication = true;
          this.state.formDetected = false;
          this.state.currentRedirectAttempts = 0;

          // For Indeed, click and expect a redirect
          applyButton.click();

          // Check for redirection after a delay
          this.checkForRedirectOrForm();
        } else {
          this.statusOverlay.addInfo(
            "No apply button found or not an Easy Apply job"
          );
        }
      }
    } catch (error) {
      this.log("Error handling job page:", error);
      this.statusOverlay.addError(error);

      // Reset application state
      this.state.isApplicationInProgress = false;
      this.state.applicationStartTime = null;
      this.state.pendingApplication = false;
      this.state.formDetected = false;
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

      // Use the comprehensive form handler instead of manual form processing
      return await this.handleApplyForm();
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
    const allForms = document.querySelectorAll("form");
    for (const form of allForms) {
      if (this.isElementVisible(form) && form.elements.length > 0) {
        return form;
      }
    }

    return null;
  }

  /**
   * Handle application form
   */
  async handleApplyForm() {
    try {
      // Wait for the form to load completely
      await this.sleep(1500);

      if (!this.formHandler) {
        this.statusOverlay.addError("Form handler not available");
        return false;
      }

      // Update form handler with current job description and user profile
      this.formHandler.jobDescription =
        this.cachedJobDescription || (await this.extractIndeedJobDescription());
      this.formHandler.userData = this.userProfile;

      this.statusOverlay.addInfo("Starting comprehensive form filling process");

      // Use the comprehensive form handler
      const success = await this.formHandler.fillCompleteForm();

      // Update UI based on result
      if (success) {
        this.statusOverlay.addSuccess("Application submitted successfully!");
        this.markLastJobCardIfAvailable("applied");
      } else {
        this.statusOverlay.addInfo(
          "Application process completed but success not confirmed"
        );
      }

      return success;
    } catch (error) {
      this.log("Error handling application form:", error);
      this.statusOverlay.addError("Form submission error: " + error.message);
      this.markLastJobCardIfAvailable("error");
      return false;
    }
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
          this.statusOverlay.addWarning(
            "⚠️ Found External Apply button (redirects to company site)"
          );
          return null; // We don't want to handle external applications
        }
      }

      // Method 3: Look for any button with "apply" text
      const allButtons = document.querySelectorAll("button, a");
      for (const button of allButtons) {
        if (
          button.textContent.toLowerCase().includes("apply") &&
          this.isElementVisible(button) &&
          !button.disabled
        ) {
          this.statusOverlay.addInfo("Found generic apply button");
          return button;
        }
      }

      this.statusOverlay.addWarning("❌ No apply button found");
      return null;
    } catch (error) {
      console.error("Error finding apply button:", error);
      this.statusOverlay.addError(
        "Error finding apply button: " + error.message
      );
      return null;
    }
  }

  /**
   * Check if we're on an application form page
   */
  isOnApplyFormPage() {
    // Check URL patterns
    const url = window.location.href;

    // For Indeed
    if (
      url.includes("smartapply.indeed.com/beta/indeedapply/form") ||
      url.includes("indeed.com/apply") ||
      url.includes("indeed.com/viewjob")
    ) {
      this.log("Detected Indeed application form page via URL");
      return true;
    }

    // Check for form elements
    this.log("Checking for form elements on page");

    const hasIndeedFormElements = INDEED_SELECTORS.FORM.some((selector) => {
      const element = document.querySelector(selector);
      return element && this.isElementVisible(element);
    });

    if (hasIndeedFormElements) {
      this.log("Detected form elements on page");
    }

    return hasIndeedFormElements;
  }

  /**
   * Set up a mutation observer to detect form elements appearing on the page
   */
  setupFormDetectionObserver() {
    try {
      // Create a new observer
      this.formObserver = new MutationObserver((mutations) => {
        // Check more frequently - not just when we're explicitly waiting for a form
        if (this.state.isApplicationInProgress || this.isOnApplyPage()) {
          // Check if form elements have appeared
          const hasForm = INDEED_SELECTORS.FORM.some((selector) => {
            const element = document.querySelector(selector);
            return element && this.isElementVisible(element);
          });

          if (hasForm && !this.state.formDetected) {
            this.log("Form detected by mutation observer");
            this.state.formDetected = true;

            // Handle the form after a short delay to let it fully load
            setTimeout(() => {
              this.handleDetectedForm();
            }, 1000);
          }
        }
      });

      // Start observing the document with the configured parameters
      this.formObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });

      this.log("Form detection observer set up");
    } catch (error) {
      this.log("Error setting up form observer:", error);
    }
  }

  /**
   * Helper method to check if we're on an application page by URL
   */
  isOnApplyPage() {
    const url = window.location.href;
    return (
      url.includes("smartapply.indeed.com") || url.includes("indeed.com/apply")
    );
  }

  // ========================================
  // JOB DESCRIPTION AND DATA EXTRACTION
  // ========================================

  /**
   * Track a successful application on the server
   */
  async trackApplication(jobDetails) {
    try {
      // Skip if no user data
      if (!this.userProfile || !this.userId) {
        return;
      }

      // Update application count
      const updateResponse = await fetch(
        `${this.getApiHost()}/api/applications`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userId: this.userId,
          }),
        }
      );

      // Add job to applied jobs
      await fetch(`${this.getApiHost()}/api/applied-jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          ...jobDetails,
          userId: this.userId,
          applicationPlatform: "indeed",
        }),
      });
    } catch (error) {
      this.log("Error tracking application:", error);
    }
  }

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

  /**
   * Get profile data
   */
  async getProfileData() {
    try {
      // Return cached profile if available
      if (this.userProfile) {
        return this.userProfile;
      }

      this.statusOverlay.addInfo("Fetching profile data");

      // Try to get data from background script
      try {
        return new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            { action: "getProfileData" },
            (response) => {
              if (chrome.runtime.lastError) {
                this.statusOverlay.addInfo(
                  "Error from background: " + chrome.runtime.lastError.message
                );
                // Use fallback profile instead of rejecting
                resolve(this.getFallbackProfile());
              } else if (response && response.success && response.data) {
                console.log(
                  "Got profile data from background script",
                  response.data
                );
                this.statusOverlay.addInfo(
                  "Got profile data from background script"
                );
                resolve(response.data);
              } else {
                this.statusOverlay.addInfo(
                  "No valid profile data in response, using fallback"
                );
                resolve(this.getFallbackProfile());
              }
            }
          );
        });
      } catch (err) {
        this.statusOverlay.addInfo(
          "Error requesting profile data: " + err.message
        );
        return this.getFallbackProfile();
      }
    } catch (error) {
      this.log("Error getting profile data:", error);
      return this.getFallbackProfile();
    }
  }

  /**
   * Get a fallback profile for testing or when API fails
   */
  getFallbackProfile() {
    this.statusOverlay.addInfo("Using fallback profile data");
    return this.userProfile;
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
      ".ia-SuccessPage",
      ".ia-JobApplySuccess",
      'div:contains("Application submitted")',
      'div:contains("Your application has been submitted")',
      ".submitted-container",
      ".success-container",
    ];

    for (const selector of successSelectors) {
      if (document.querySelector(selector)) {
        this.statusOverlay.addSuccess(
          "Success message found - application submitted"
        );
        return true;
      }
    }

    // Check page text
    const pageText = document.body.innerText.toLowerCase();
    return (
      pageText.includes("application submitted") ||
      pageText.includes("successfully applied") ||
      pageText.includes("thank you for applying") ||
      pageText.includes("successfully submitted") ||
      pageText.includes("application complete")
    );
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
          this.statusOverlay.addInfo(
            "Found 'You've applied to this job' message - already applied"
          );
          return true;
        }
      }

      // Check for other applied indicators
      const appliedIndicators = [
        ".indeed-apply-status-applied",
        ".application-submitted",
        ".already-applied",
      ];

      for (const selector of appliedIndicators) {
        if (document.querySelector(selector)) {
          this.statusOverlay.addInfo(
            "Found applied indicator - already applied"
          );
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
    if (
      url.includes("smartapply.indeed.com/beta/indeedapply/form") ||
      url.includes("indeed.com/apply") ||
      url.includes("indeed.com/viewjob")
    ) {
      return true;
    }

    // Check for form elements
    const hasFormElements = INDEED_SELECTORS.FORM.some((selector) => {
      const element = document.querySelector(selector);
      return element && this.isElementVisible(element);
    });

    return hasFormElements;
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

  /**
   * Check if we've already applied to this job on SmartApply
   */
  async checkIfAlreadyApplied() {
    try {
      // Check if we're on the Indeed SmartApply form page
      const isSmartApplyPage = window.location.href.includes(
        "smartapply.indeed.com/beta/indeedapply/form"
      );

      if (!isSmartApplyPage) {
        return false; // Not on SmartApply page
      }

      // Look for "You've applied to this job" text
      const pageText = document.body.innerText;
      const alreadyAppliedText = "You've applied to this job";

      if (pageText.includes(alreadyAppliedText)) {
        this.statusOverlay.addInfo(
          "Found 'You've applied to this job' message - already applied"
        );

        // Reset application state
        this.state.isApplicationInProgress = false;
        this.state.applicationStartTime = null;
        this.state.pendingApplication = false;
        this.state.formDetected = false;

        return true;
      }

      return false; // Not already applied
    } catch (error) {
      console.error("Error checking if already applied:", error);
      return false;
    }
  }

  /**
   * Enhanced handleDetectedForm method with already-applied check
   */
  async handleDetectedForm() {
    try {
      // First check if we've already applied to this job
      const alreadyApplied = await this.checkIfAlreadyApplied();
      if (alreadyApplied) {
        this.statusOverlay.addInfo(
          "Job already applied to, moving to next job"
        );
        // Move to next job if automation is running
        if (this.state.isRunning) {
          setTimeout(() => this.processNextJob(), 2000);
        }
        return;
      }

      this.statusOverlay.addInfo("Form detected, starting application process");

      // Wait for profile data if needed
      if (!this.userProfile) {
        this.userProfile = await this.getProfileData();
      }

      if (this.userProfile) {
        // Handle application form
        const success = await this.handleApplyForm();

        // After form submission (success or failure), update status
        if (success) {
          this.statusOverlay.addSuccess("Application submitted successfully");
          if (this.currentJobDetails) {
            this.trackApplication(this.currentJobDetails);
          }
          this.markLastJobCardIfAvailable("applied");
        } else {
          this.statusOverlay.addInfo("Failed to complete application");
          this.markLastJobCardIfAvailable("error");
        }

        // Reset application state
        this.state.isApplicationInProgress = false;
        this.state.applicationStartTime = null;
        this.state.pendingApplication = false;
        this.state.formDetected = false;
        this.state.currentRedirectAttempts = 0;

        // Now we can move to the next job
        if (this.state.isRunning) {
          this.statusOverlay.addInfo("Moving to next job...");
          setTimeout(() => this.processNextJob(), 2000);
        }
      } else {
        this.statusOverlay.addError(
          "No profile data available for form filling"
        );
        // Reset application state
        this.state.isApplicationInProgress = false;
        this.state.applicationStartTime = null;
        this.state.pendingApplication = false;
        this.state.formDetected = false;

        // Still move to next job if automation is running
        if (this.state.isRunning) {
          setTimeout(() => this.processNextJob(), 2000);
        }
      }
    } catch (error) {
      this.log("Error handling detected form:", error);
      this.statusOverlay.addError("Error handling form: " + error.message);

      // Reset application state
      this.state.isApplicationInProgress = false;
      this.state.applicationStartTime = null;
      this.state.pendingApplication = false;
      this.state.formDetected = false;

      // Still try to move on if automation is running
      if (this.state.isRunning) {
        setTimeout(() => this.processNextJob(), 2000);
      }
    }
  }

  /**
   * Check for redirect or form appearance
   */
  checkForRedirectOrForm() {
    // Check if we've reached max redirect attempts
    if (this.state.currentRedirectAttempts >= this.state.maxRedirectAttempts) {
      this.statusOverlay.addError("Max redirect attempts reached, giving up");

      // Reset application state
      this.state.isApplicationInProgress = false;
      this.state.applicationStartTime = null;
      this.state.pendingApplication = false;
      this.state.formDetected = false;

      // Continue with next job if running automation
      if (this.state.isRunning) {
        setTimeout(() => this.processNextJob(), 2000);
      }

      return;
    }

    this.state.currentRedirectAttempts++;
    this.statusOverlay.addInfo(
      `Checking for redirect or form (attempt ${this.state.currentRedirectAttempts})`
    );

    const currentUrl = window.location.href;

    // Check if we're on an Indeed form page by URL
    const isIndeedFormPage = currentUrl.includes(
      "smartapply.indeed.com/beta/indeedapply/form"
    );

    // If we're on Indeed SmartApply, check if we've already applied
    if (isIndeedFormPage) {
      // Look for "You've applied to this job" text
      const pageText = document.body.innerText;
      if (pageText.includes("You've applied to this job")) {
        this.statusOverlay.addInfo(
          "Found 'You've applied to this job' message - already applied"
        );

        // Reset application state
        this.state.isApplicationInProgress = false;
        this.state.applicationStartTime = null;
        this.state.pendingApplication = false;
        this.state.formDetected = false;

        // Move to next job if automation is running
        if (this.state.isRunning) {
          setTimeout(() => this.processNextJob(), 2000);
        }

        return;
      }
    }

    // Check for form elements
    const hasFormElements = INDEED_SELECTORS.FORM.some((selector) => {
      const element = document.querySelector(selector);
      return element && this.isElementVisible(element);
    });

    if (isIndeedFormPage || hasFormElements) {
      this.statusOverlay.addInfo(
        "Successfully redirected to form page or form detected"
      );
      this.state.formDetected = true;

      // Handle the detected form
      setTimeout(async () => {
        await this.handleDetectedForm();
      }, 1000);
    } else {
      // Schedule another check after a delay
      this.statusOverlay.addInfo("No form detected yet, waiting...");

      setTimeout(() => {
        this.checkForRedirectOrForm();
      }, INDEED_CONFIG.TIMEOUTS.STANDARD);
    }
  }

  /**
   * Apply search filters to narrow down results
   */
  applySearchFilters() {
    try {
      this.statusOverlay.addInfo("Applying search filters...");

      // Check for Easy Apply filter
      const easyApplyFilter = document.querySelector(
        INDEED_SELECTORS.EASY_APPLY_FILTER[0]
      );
      if (easyApplyFilter && !easyApplyFilter.checked) {
        this.statusOverlay.addInfo("Selecting Easy Apply filter");
        easyApplyFilter.click();
      }

      // Wait for filters to apply
      setTimeout(() => {
        this.statusOverlay.addInfo("Filters applied, checking for job results");

        // Check if any jobs were found
        const { jobsFound, jobCount } = this.checkIfJobsFound();

        if (!jobsFound) {
          this.statusOverlay.addInfo("No jobs found matching search criteria");
          this.statusOverlay.updateStatus("completed");
          this.state.ready = true;
          this.state.isRunning = false;
          return;
        }

        this.statusOverlay.addInfo(
          `Found ${jobCount || "multiple"} jobs, starting automation`
        );
        this.state.ready = true;

        // Automatically start automation once filters are applied and jobs are found
        if (!this.state.isRunning) {
          this.startAutomation();
        }
      }, 2000);
    } catch (error) {
      this.log("Error applying search filters:", error);
      this.statusOverlay.addError(error);

      // Set ready anyway and try to start
      this.state.ready = true;
      setTimeout(() => {
        if (!this.state.isRunning) {
          this.startAutomation();
        }
      }, 2000);
    }
  }

  /**
   * Check if jobs are found in search results
   */
  checkIfJobsFound() {
    try {
      // Look for the search results header element
      const searchHeaderSelectors = [
        ".jobsearch-JobCountAndSortPane-jobCount",
        ".count",
      ];

      // Try each selector until we find a match
      let searchHeader = null;
      for (const selector of searchHeaderSelectors) {
        searchHeader = document.querySelector(selector);
        if (searchHeader) break;
      }

      if (!searchHeader) {
        this.statusOverlay.addInfo("Could not find search results header");
        return { jobsFound: true }; // Default to true if we can't determine
      }

      // Parse the header text to extract the job count
      const headerText = searchHeader.textContent.trim();
      this.statusOverlay.addInfo(`Found search header: "${headerText}"`);

      const jobCountMatch = headerText.match(/^(\d+)\s+/);

      if (jobCountMatch) {
        const jobCount = parseInt(jobCountMatch[1], 10);
        this.statusOverlay.addInfo(`Found ${jobCount} jobs in search results`);
        return {
          jobsFound: jobCount > 0,
          jobCount: jobCount,
          searchQuery: headerText.replace(jobCountMatch[0], "").trim(),
        };
      } else if (
        headerText.toLowerCase().includes("no jobs found") ||
        headerText.toLowerCase().includes("0 jobs") ||
        headerText.toLowerCase().includes("found 0")
      ) {
        this.statusOverlay.addInfo("No jobs found in search results");
        return { jobsFound: false, jobCount: 0 };
      }

      // If we couldn't parse the count but the header exists, check if there are any job cards
      const jobCards = this.getIndeedJobCards();
      if (jobCards.length === 0) {
        this.statusOverlay.addInfo("No job cards found in search results");
        return { jobsFound: false, jobCount: 0 };
      }

      return { jobsFound: true }; // Default to true if we can't determine for sure
    } catch (error) {
      this.log("Error checking if jobs found:", error);
      return { jobsFound: true }; // Default to true on error to avoid blocking
    }
  }

  /**
   * Start the automation process
   */
  async startAutomation() {
    try {
      if (this.state.isRunning) {
        this.statusOverlay.addInfo("Automation already running");
        return;
      }

      this.statusOverlay.addInfo("Starting automation");

      // Check if jobs were found before proceeding
      const { jobsFound, jobCount, searchQuery } = this.checkIfJobsFound();

      if (!jobsFound) {
        this.statusOverlay.addInfo(
          `No jobs found for search: ${searchQuery || "your search criteria"}`
        );
        this.statusOverlay.updateStatus("completed");
        return; // Don't start automation if no jobs found
      }

      this.statusOverlay.updateStatus("running");

      // Initialize state
      this.state.isRunning = true;
      this.state.currentJobIndex = 0;
      this.state.processedCount = 0;
      this.state.lastActivity = Date.now();
      this.state.formDetected = false;
      this.state.isApplicationInProgress = false;
      this.state.pendingApplication = false;
      this.state.applicationStartTime = null;
      this.state.currentRedirectAttempts = 0;
      this.state.lastClickedJobCard = null;

      // Process first job
      await this.processNextJob();
    } catch (error) {
      this.log("Error starting automation:", error);
      this.statusOverlay.addError(
        "Failed to start automation: " + error.message
      );
      this.state.isRunning = false;
    }
  }

  /**
   * Process the next job
   */
  async processNextJob() {
    try {
      if (!this.state.isRunning) {
        this.statusOverlay.addInfo("Automation stopped");
        return;
      }

      // If there's a pending application, don't process the next job yet
      if (this.state.isApplicationInProgress || this.state.pendingApplication) {
        this.statusOverlay.addInfo(
          "Application in progress, waiting before processing next job"
        );
        // Check again after a delay
        setTimeout(() => this.processNextJob(), 5000);
        return;
      }

      // Double check if we're on a results page with 0 jobs
      if (this.state.currentJobIndex === 0) {
        const { jobsFound } = this.checkIfJobsFound();
        if (!jobsFound) {
          this.statusOverlay.addInfo(
            "No jobs found in search results, stopping automation"
          );
          this.statusOverlay.updateStatus("completed");
          this.state.isRunning = false;
          return;
        }
      }

      // Get all job cards that haven't been processed yet
      const jobCards = this.getUnprocessedJobCards();

      if (jobCards.length === 0) {
        // Try to load more jobs
        if (await this.goToNextPage()) {
          // Wait for page to load and try again
          setTimeout(() => this.processNextJob(), 3000);
        } else {
          this.statusOverlay.addInfo("No more jobs to process");
          this.statusOverlay.updateStatus("completed");
          this.state.isRunning = false;
        }
        return;
      }

      // Process the first unprocessed job card
      const jobCard = jobCards[0];
      this.state.lastClickedJobCard = jobCard;

      // Mark as processing
      this.markJobCard(jobCard, "processing");

      // Click the job card to show details
      this.statusOverlay.addInfo("Clicking job card to show details");
      jobCard.querySelector("a.jcs-JobTitle")?.click();

      // Wait for details to load
      await this.sleep(INDEED_CONFIG.TIMEOUTS.STANDARD);

      // Handle any popups
      this.handlePopups();

      // Extract job details before clicking apply
      const jobDetails = this.extractJobDetailsFromCard(jobCard);

      // Store job details for later tracking
      this.currentJobDetails = jobDetails;

      // Find the apply button in the details panel
      const applyButton = await this.findIndeedApplyButton();

      if (!applyButton) {
        this.statusOverlay.addInfo("No Easy Apply button found, skipping job");
        this.markJobCard(jobCard, "skipped");
        this.state.processedCards.add(this.getJobCardId(jobCard));
        this.state.processedCount++;

        // Move to next job
        setTimeout(() => this.processNextJob(), 1000);
        return;
      }

      // Found an Easy Apply button, start the application
      this.statusOverlay.addInfo(
        "Found Easy Apply button, starting application"
      );

      // Set application in progress
      this.state.isApplicationInProgress = true;
      this.state.applicationStartTime = Date.now();
      this.state.pendingApplication = true;
      this.state.formDetected = false;
      this.state.currentRedirectAttempts = 0;

      // Mark card as being processed
      this.state.processedCards.add(this.getJobCardId(jobCard));

      // For Indeed, click and expect a redirect
      applyButton.click();

      // Check for redirection after a delay
      this.checkForRedirectOrForm();
    } catch (error) {
      this.log("Error processing job:", error);
      this.statusOverlay.addError("Error processing job: " + error.message);

      // Reset application state
      this.state.isApplicationInProgress = false;
      this.state.applicationStartTime = null;
      this.state.pendingApplication = false;
      this.state.formDetected = false;

      // Try to continue with next job
      setTimeout(() => this.processNextJob(), 3000);
    }
  }

  /**
   * Go to next page of jobs
   */
  async goToNextPage() {
    try {
      const nextButton = document.querySelector(INDEED_SELECTORS.NEXT_PAGE[0]);
      if (nextButton && this.isElementVisible(nextButton)) {
        this.statusOverlay.addInfo("Moving to next page of results");
        nextButton.click();

        // Wait for the page to load
        await this.sleep(3000);

        // Check if the new page has jobs
        const { jobsFound } = this.checkIfJobsFound();
        if (!jobsFound) {
          this.statusOverlay.addInfo("No jobs found on next page");
          return false;
        }

        return true;
      }
      return false;
    } catch (error) {
      this.log("Error going to next page:", error);
      return false;
    }
  }

  /**
   * Handle popups that might appear
   */
  handlePopups() {
    try {
      const closeButton = document.querySelector(
        INDEED_SELECTORS.POPUP_CLOSE[0]
      );
      if (closeButton && this.isElementVisible(closeButton)) {
        closeButton.click();
      }
    } catch (error) {
      // Ignore errors with popups
    }
  }

  /**
   * Check if this is an external application
   */
  isExternalApplication() {
    // Check if any external indicators are visible
    for (const selector of INDEED_SELECTORS.EXTERNAL_APPLY) {
      const element = document.querySelector(selector);
      if (element && this.isElementVisible(element)) {
        return true;
      }
    }

    // Check for text indicating external application
    const jobContainer = document.querySelector(".jobsearch-JobComponent");
    if (jobContainer) {
      const containerText = jobContainer.textContent.toLowerCase();
      if (
        containerText.includes("apply on company site") ||
        containerText.includes("apply externally") ||
        containerText.includes("apply on the company website")
      ) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check health of automation and recover if needed
   */
  checkHealth() {
    try {
      // Check for stuck application
      if (
        this.state.isApplicationInProgress &&
        this.state.applicationStartTime
      ) {
        const now = Date.now();
        const applicationTime = now - this.state.applicationStartTime;

        // If application has been active for over timeout threshold, it's probably stuck
        if (applicationTime > INDEED_CONFIG.TIMEOUTS.APPLICATION_TIMEOUT) {
          this.log("Application appears to be stuck, resetting state");

          // Mark the last job card as error if available
          this.markLastJobCardIfAvailable("error");

          this.state.isApplicationInProgress = false;
          this.state.applicationStartTime = null;
          this.state.pendingApplication = false;
          this.state.formDetected = false;

          this.statusOverlay.addWarning(
            "Application timeout detected - resetting state"
          );
          this.statusOverlay.updateStatus("error");

          // Continue with next job if automation is running
          if (this.state.isRunning) {
            setTimeout(() => this.processNextJob(), 2000);
          }
        }
      }

      // Check for automation inactivity
      if (this.state.isRunning) {
        const now = Date.now();
        const inactiveTime = now - this.state.lastActivity;

        if (inactiveTime > 120000) {
          // 2 minutes inactivity
          this.log("Automation appears inactive, attempting recovery");

          // Reset any stuck application state
          if (this.state.isApplicationInProgress) {
            this.state.isApplicationInProgress = false;
            this.state.applicationStartTime = null;
            this.state.pendingApplication = false;
            this.state.formDetected = false;
          }

          // Try to continue automation
          this.state.lastActivity = now;
          this.processNextJob();
        }
      }
    } catch (error) {
      this.log("Error in health check:", error);
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

    if (data && data.active === false && this.state.isApplicationInProgress) {
      this.log(
        "⚠️ State mismatch detected! Resetting application progress flag"
      );
      this.state.isApplicationInProgress = false;
      this.state.applicationStartTime = null;
      this.statusOverlay.addWarning(
        "Detected state mismatch - resetting flags"
      );
      setTimeout(() => this.searchNext(), 1000);
    }
  }

  handleJobTabStatus(data) {
    this.log("📊 Job tab status:", data);

    if (data && !data.isOpen && this.state.isApplicationInProgress) {
      this.log(
        "⚠️ Job tab closed but application still in progress - resetting"
      );
      this.resetApplicationStateOnError();
    }
  }

  handleSearchNextReady(data) {
    this.log("🔄 Search next ready acknowledged");
    // Continue with next search iteration
    setTimeout(() => {
      if (!this.state.isApplicationInProgress) {
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

    this.state.isApplicationInProgress = false;
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
    this.state.isApplicationInProgress = false;
    this.state.applicationStartTime = null;
    this.state.pendingApplication = false;
    this.state.formDetected = false;

    // Remove processing visual indicators
    if (card) {
      card.style.border = "";
      card.style.backgroundColor = "";
      const indicator = card.querySelector(".processing-indicator");
      if (indicator) {
        indicator.remove();
      }
    }

    // Continue to next job after delay
    setTimeout(() => {
      if (!this.state.isApplicationInProgress) {
        this.searchNext();
      }
    }, 3000);
  }

  handleApplicationError(error) {
    if (
      error.name === "SendCvSkipError" ||
      error.name === "ApplicationSkipError"
    ) {
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

    this.state.isApplicationInProgress = false;
    this.state.applicationStartTime = null;
    this.state.pendingApplication = false;
    this.state.formDetected = false;
    this.state.currentRedirectAttempts = 0;
    this.state.lastClickedJobCard = null;

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
      this.statusOverlay.addWarning(
        "Application timeout detected, moving to next job"
      );
      this.resetApplicationStateOnError();

      // Continue to next job
      setTimeout(() => {
        if (!this.state.isApplicationInProgress) {
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
    return allButtons.find(
      (button) =>
        button.textContent &&
        button.textContent.trim().toLowerCase().includes(text.toLowerCase()) &&
        this.isElementVisible(button)
    );
  }

  /**
   * Helper method to find a link by its text content
   */
  findLinkByText(text) {
    const allLinks = Array.from(document.querySelectorAll("a"));
    return allLinks.find(
      (link) =>
        link.textContent &&
        link.textContent.trim().toLowerCase().includes(text.toLowerCase())
    );
  }

  /**
   * Check if input is enabled and accessible
   */
  isInputEnabled(input) {
    if (!input) return false;
    try {
      return (
        !input.disabled &&
        !input.readOnly &&
        this.isElementVisible(input) &&
        getComputedStyle(input).display !== "none" &&
        getComputedStyle(input).visibility !== "hidden"
      );
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
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      ) {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch (error) {
      return false;
    }
  }

  /**
   * Sleep for the specified milliseconds
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Debounce a function call
   */
  debounce(key, fn, delay) {
    // Clear existing timer
    if (this.state.debounceTimers[key]) {
      clearTimeout(this.state.debounceTimers[key]);
    }

    // Set new timer
    this.state.debounceTimers[key] = setTimeout(() => {
      delete this.state.debounceTimers[key];
      fn();
    }, delay);
  }

  errorToString(e) {
    if (!e) return "Unknown error (no details)";
    if (e instanceof Error) {
      return e.message + (e.stack ? `\n${e.stack}` : "");
    }
    return String(e);
  }

  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

      await this.sleep(1000);
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
    this.state.processedCards.clear();
    this.cachedJobDescription = null;
    this.currentJobDetails = null;

    if (this.stuckDetectionTimeout) {
      clearTimeout(this.stuckDetectionTimeout);
      this.stuckDetectionTimeout = null;
    }

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    if (this.formObserver) {
      this.formObserver.disconnect();
      this.formObserver = null;
    }

    this.resetApplicationStateOnError();
    this.log("🧹 Indeed-specific cleanup completed");
  }

  // ========================================
  // LEGACY CHROME EXTENSION METHODS
  // ========================================

  /**
   * Legacy method for Chrome extension message handling
   */
  handleChromeMessage(message, sender, sendResponse) {
    try {
      const { action, type } = message;
      const messageType = action || type;

      switch (messageType) {
        case "startJobSearch":
        case "startAutomation":
          this.startAutomation();
          sendResponse({ status: "processing" });
          break;

        case "stopAutomation":
          this.state.isRunning = false;
          this.statusOverlay.addInfo("Automation stopped by user");
          this.statusOverlay.updateStatus("stopped");
          sendResponse({ status: "stopped" });
          break;

        case "checkStatus":
          sendResponse({
            success: true,
            data: {
              initialized: this.state.initialized,
              isApplicationInProgress: this.state.isApplicationInProgress,
              processedCount: this.state.processedCount,
              isRunning: this.state.isRunning,
              platform: "indeed",
            },
          });
          break;

        case "resetState":
          this.resetApplicationStateOnError();
          this.statusOverlay.updateStatus("ready");
          this.statusOverlay.addInfo("State reset complete");
          sendResponse({ success: true, message: "State reset" });
          break;

        default:
          sendResponse({
            success: false,
            message: `Unknown message type: ${messageType}`,
          });
      }
    } catch (error) {
      console.error("Error handling message:", error);
      sendResponse({ success: false, message: error.message });
    }

    return true;
  }
}
