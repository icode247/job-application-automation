// platforms/ziprecruiter/ziprecruiter.js - BUG FIXES APPLIED
import BasePlatformAutomation from "../../shared/base/base-platform-automation.js";
import { UrlUtils, DomUtils } from "../../shared/utilities/index.js";
import {
  AIService,
  ApplicationTrackerService,
  UserService,
} from "../../services/index.js";
import FormHandler from "./ziprecruiter-form-handler.js";

const ZIPRECRUITER_SELECTORS = {
  JOB_CARDS: [
    ".job_result_two_pane",
    ".job_result",
    "[data-testid='job-card']",
    ".job",
  ],
  JOB_TITLE: [
    "h2.font-bold.text-primary",
    ".job-title",
    "[data-testid='job-title']",
    "h2 a",
  ],
  COMPANY_NAME: [
    "[data-testid='job-card-company']",
    ".company-name",
    "a[aria-label*='company']",
  ],
  LOCATION: [
    "[data-testid='job-card-location']",
    ".location",
    "p.text-primary",
  ],
  SALARY: [
    "p.text-primary:contains('$')",
    ".salary",
    "[data-testid='salary']",
  ],
  APPLY_BUTTON: [
    "button[aria-label*='1-Click Apply']",
    "button[aria-label*='Quick Apply']",
    ".apply-button",
  ],
  APPLIED_INDICATOR: [
    "button[aria-label*='Applied']",
    ".applied-status",
  ],
  MODAL_CONTAINER: [
    ".ApplyFlowApp",
    ".application-modal",
    ".modal",
  ],
  MODAL_QUESTIONS: [
    ".question_form fieldset",
    "fieldset",
  ],
  CONTINUE_BUTTON: [
    "button[type='submit']",
    ".continue-button",
  ],
  NO_JOBS_FOUND: [
    ".jobs_not_found",
    ".no-results",
  ],
  NEXT_PAGE_BUTTON: [
    "a[title='Next Page']",
    ".next-page",
    ".pagination-next",
  ],
};

const ZIPRECRUITER_CONFIG = {
  PLATFORM: "ziprecruiter",
  URL_PATTERNS: {
    SEARCH_PAGE: /ziprecruiter\.com\/(jobs|search)/,
    JOB_PAGE: /ziprecruiter\.com\/job\//,
    APPLY_PAGE: /ziprecruiter\.com\/apply/,
  },
  TIMEOUTS: {
    STANDARD: 3000,
    EXTENDED: 8000,
    APPLICATION_TIMEOUT: 8 * 60 * 1000,
  },
  PLAN_LIMITS: {
    FREE: 5,
    STARTER: 50,
    PRO: 200,
  },
  DEBUG: true,
  BRAND_COLOR: "#4a90e2",
};

class ZipRecruiterJobParser {
  constructor() {
    this.targetClass = "job-description";
  }

  getElementText(element) {
    if (element.tagName === "UL" || element.tagName === "OL") {
      return Array.from(element.querySelectorAll("li"))
        .map((li) => `• ${li.textContent.trim()}`)
        .filter((text) => text !== "• ")
        .join("\n");
    }
    return element.textContent.trim();
  }

  processTextBlock(text) {
    return text
      ?.replace(/\s+/g, " ")
      .replace(/\n\s*\n/g, "\n")
      .trim() || "";
  }

  scrapeDescription(format = "string") {
    try {
      const container = document.querySelector(`.${this.targetClass}`) ||
        document.querySelector('.job-details') ||
        document.querySelector('.description');

      if (!container) return format === "string" ? "No description found" : { error: "Container not found" };

      let description = "";
      Array.from(container.children).forEach((element) => {
        const text = this.getElementText(element);
        if (text) description += `${text}\n\n`;
      });

      return format === "string" ? this.processTextBlock(description) : { description };
    } catch (error) {
      return format === "string" ? "Error extracting description" : { error: error.message };
    }
  }

  static extract(format = "string") {
    const parser = new ZipRecruiterJobParser();
    return parser.scrapeDescription(format);
  }
}

export default class ZipRecruiterPlatform extends BasePlatformAutomation {
  constructor(config) {
    super(config);
    this.platform = "ziprecruiter";
    this.baseUrl = "https://www.ziprecruiter.com";

    this.aiService = new AIService({ apiHost: this.getApiHost() });
    this.applicationTracker = new ApplicationTrackerService({
      userId: this.userId,
    });
    this.userService = new UserService({ userId: this.userId });

    this.state = {
      initialized: false,
      ready: false,
      isRunning: false,
      isApplicationInProgress: false,
      applicationStartTime: null,
      processedCards: new Set(),
      processedCount: 0,
      currentJobIndex: 0,
      lastProcessedCard: null,
      currentJobDetails: null,
      lastActivity: Date.now(),
      jobProcessingLock: false,
      currentPage: 1,
      totalPages: 0,
      noMorePages: false,
      formDetected: false,
    };

    this.formHandler = null;
    this.cachedJobDescription = null;
    this.processedJobCards = new Set();
    this.healthCheckTimer = null;
    this.answerCache = new Map();

    this.applicationState = {
      isApplicationInProgress: false,
      applicationStartTime: null,
      currentJobData: null,
      processedUrls: new Set(),
    };

    // Job queue management (following Glassdoor pattern)
    this.jobQueue = [];
    this.currentJobIndex = 0;
    this.queueInitialized = false;
    this.currentExpandedJob = null;

    // User data and job management
    this.userData = null;
    this.profile = null;

    // Prevent duplicate starts
    this.searchProcessStarted = false;

    this.healthCheckTimer = setInterval(() => this.checkHealth(), 30000);
    this.setupFormDetectionObserver();
  }

  // ========================================
  // INITIALIZATION & EVENT HANDLING (Fixed)
  // ========================================

  async initialize() {
    await super.initialize();

    // Initialize on document ready (following Glassdoor pattern)  
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.init());
    } else {
      this.init();
    }

    try {
      this.formHandler = new FormHandler({
        enableDebug: true,
        logger: (message) => this.showUserMessage(message, "info"),
        host: this.getApiHost(),
        userData: this.userProfile || {},
        jobDescription: "",
        platform: "ziprecruiter",
      });

      this.showUserMessage("ZipRecruiter components initialized", "success");
    } catch (error) {
      this.log("⚠️ Could not load ZipRecruiter handlers:", error);
      this.showUserMessage("ZipRecruiter handlers not available", "warning");
    }

    this.state.initialized = true;
  }

  // ========================================
  // MESSAGE HANDLING (Following Glassdoor pattern) - FIXED
  // ========================================

  handlePortMessage(message) {
    try {
      const { type, data } = message || {};
      if (!type) {
        return;
      }

      this.log(`📨 Handling ZipRecruiter port message: ${type}`);

      switch (type) {
        case "CONNECTION_ESTABLISHED":
          this.log("✅ Port connection established");
          break;

        case "SEARCH_TASK_DATA":
          this.handleSearchTaskData(data);
          break;

        case "APPLICATION_TASK_DATA":
          this.handleApplicationTaskData(data);
          break;

        case "SUCCESS":
          this.handleSuccessMessage(data);
          break;

        case "ERROR":
          this.handleErrorMessage(data);
          break;

        case "KEEPALIVE_RESPONSE":
          // Acknowledge keepalive - no action needed
          this.log("📡 Keepalive acknowledged");
          break;

        case "DUPLICATE":
          this.showUserMessage("Job already processed", "warning");
          this.resetApplicationStateOnError();
          if (this.state.isRunning) {
            setTimeout(() => this.processNextJob(), 2000);
          }
          break;

        case "APPLICATION_STARTING":
          this.showUserMessage("Application request acknowledged", "info");
          break;

        case "SEARCH_NEXT":
          this.handleSearchNext(data);
          break;

        default:
          this.log(`❓ Unhandled ZipRecruiter message type: ${type}`);
          // Try to handle it with platform-specific handler
          this.handlePlatformSpecificMessage(type, data);
      }
    } catch (error) {
      this.log("❌ Error handling port message:", error);
      this.showUserMessage("Error handling message: " + error.message, "error");
    }
  }

  handleSearchTaskData(data) {
    try {
      if (!data) {
        this.showUserMessage("No search data provided", "warning");
        return;
      }

      this.searchData = {
        limit: data.limit || 10,
        current: data.current || 0,
        submittedLinks: data.submittedLinks || [],
        searchLinkPattern: data.searchLinkPattern
          ? new RegExp(data.searchLinkPattern.replace(/^\/|\/[gimy]*$/g, ""))
          : this.getSearchLinkPattern(),
      };

      // Only use profile from search data if we don't already have one
      if (data.profile && !this.userProfile) {
        this.userProfile = data.profile;
        this.profile = data.profile;
        this.showUserMessage("👤 User profile loaded from search data", "success");
        // Reinitialize FormHandler with profile data
        this.initializeFormHandler();
      }

      // Start the job processing flow
      setTimeout(() => this.startJobProcessing(), 1000);
    } catch (error) {
      this.showUserMessage(`Error processing search data: ${error.message}`, "error");
    }
  }

  handleApplicationTaskData(data) {
    try {
      this.log("📊 Processing ZipRecruiter application task data:", data);

      // Only use profile from application data if we don't already have one
      if (data?.profile && !this.userProfile) {
        this.userProfile = data.profile;
        this.profile = data.profile;
        this.showUserMessage("👤 User profile loaded from application task data", "success");

        // Update form handler
        if (this.formHandler) {
          this.formHandler.userData = this.userProfile;
        }
      }

      this.showUserMessage("Application initialization complete", "success");
    } catch (error) {
      this.showUserMessage("❌ Error processing application task data: " + error.message, "error");
    }
  }

  handleSuccessMessage(data) {
    if (data && data.submittedLinks !== undefined) {
      this.handleSearchTaskData(data);
    } else if (data && data.profile !== undefined && !this.userProfile) {
      this.handleApplicationTaskData(data);
    }
  }

  handleErrorMessage(data) {
    this.showUserMessage(`Error: ${data?.message || "Unknown error"}`, "error");
  }

  // ========================================
  // CHROME MESSAGE HANDLING (Fixed)
  // ========================================

  handleChromeMessage(message, sender, sendResponse) {
    try {
      const { action, type } = message;
      const messageType = action || type;

      switch (messageType) {
        case "startJobSearch":
        case "startAutomation":
          this.handleStartAutomation();
          sendResponse({ status: "processing" });
          break;

        case "stopAutomation":
          this.state.isRunning = false;
          this.showUserMessage("Automation stopped by user", "info");
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
              platform: "ziprecruiter",
            },
          });
          break;

        case "resetState":
          this.resetApplicationStateOnError();
          this.showUserMessage("State reset complete", "info");
          sendResponse({ success: true, message: "State reset" });
          break;

        // Handle platform-specific messages
        case "platformMessage":
          this.handlePortMessage(message);
          break;

        default:
          this.log(`❓ Unknown control action: ${messageType}`);
          sendResponse({
            success: false,
            message: `Unknown message type: ${messageType}`,
          });
      }
    } catch (error) {
      this.log(`❌ Error handling chrome message:`, error);
      sendResponse({ success: false, message: error.message });
    }

    return true;
  }

  // Handle automation start (following Glassdoor pattern)
  async handleStartAutomation() {
    try {
      if (this.isRunning) {
        return true;
      }

      const authCheck = await this.checkAuthenticationAndCaptcha();
      if (!authCheck.canProceed) {
        this.showUserMessage("❌ Cannot start automation: " + authCheck.message, "error");
        return false;
      }

      this.isRunning = true;
      this.state.isRunning = true;

      this.showUserMessage("Starting ZipRecruiter automation...", "info");

      if (!this.userProfile && this.userId) {
        try {
          this.showUserMessage("🔄 Attempting to fetch user profile during start...", "info");
          this.userProfile = await this.userService.getUserDetails();
          this.profile = this.userProfile;
          this.showUserMessage("✅ User profile fetched during start", "success");
        } catch (error) {
          this.showUserMessage("❌ Failed to fetch user profile during start: " + error.message, "warning");
          console.error("❌ Failed to fetch user profile during start:", error);
        }
      }

      await this.initializeFormHandler();

      await this.waitForPageLoad();
      await this.detectPageTypeAndStart();

      return true;
    } catch (error) {
      this.showUserMessage(`Error starting automation: ${error.message}`, "error");
      this.reportError(error, { action: "start" });
      this.isRunning = false;
      this.state.isRunning = false;
      return false;
    }
  }

  async initializeFormHandler() {
    const jobDescription = await this.getStoredJobData();

    this.formHandler = new FormHandler({
      platform: "ziprecruiter",
      userData: this.profile,
      enableDebug: this.config.debug,
      host: this.getApiHost(),
      jobDescription: jobDescription,
      logger: this.showUserMessage,
    });
  }

  // ========================================
  // AUTHENTICATION & CAPTCHA CHECK
  // ========================================

  async checkAuthenticationAndCaptcha() {
    try {
      const captchaCheck = this.checkForCaptcha();
      if (!captchaCheck.isValid) {
        this.showUserMessage(captchaCheck.message, "warning");
        return {
          canProceed: false,
          reason: "captcha",
          message: captchaCheck.message,
        };
      }

      const loginCheck = this.checkLoginStatus();
      if (!loginCheck.isLoggedIn) {
        this.showUserMessage(loginCheck.message, "warning");
        return {
          canProceed: false,
          reason: "login",
          message: loginCheck.message,
        };
      }

      this.showUserMessage("Authentication verified - ready to proceed!", "success");
      return {
        canProceed: true,
        reason: "authenticated",
        message: "Ready to start job search",
      };
    } catch (error) {
      const errorMessage = "❌ Error checking authentication status - please refresh and try again";
      this.showUserMessage(errorMessage, "error");
      return { canProceed: false, reason: "error", message: errorMessage };
    }
  }

  checkForCaptcha() {
    const captchaSelectors = [
      'p:contains("Please verify that you\'re a real person")',
      '[class*="captcha"]',
      '[id*="captcha"]',
      '[data-test*="captcha"]',
      ".g-recaptcha",
      "#recaptcha",
      ".h-captcha",
      "[data-ray]",
      ".cf-browser-verification",
      '[data-test="verification"]',
      ".verification-challenge",
    ];

    for (const selector of captchaSelectors) {
      let element;

      if (selector.includes(":contains")) {
        const text = selector.match(/contains\("(.+)"\)/)[1];
        element = Array.from(document.querySelectorAll("p")).find((p) =>
          p.textContent.includes(text)
        );
      } else {
        element = document.querySelector(selector);
      }

      if (element && this.isElementVisible(element)) {
        return {
          isValid: false,
          message: "🛡️ CAPTCHA verification required. Please complete the verification challenge before continuing.",
          element: element,
        };
      }
    }

    const protectionTexts = [
      "please verify that you're a real person",
      "verification required",
      "complete the challenge",
      "prove you're human",
    ];

    const bodyText = document.body.textContent.toLowerCase();
    for (const text of protectionTexts) {
      if (bodyText.includes(text)) {
        return {
          isValid: false,
          message: "🛡️ Verification challenge detected. Please complete the human verification before proceeding.",
          element: null,
        };
      }
    }

    return { isValid: true, message: "No CAPTCHA detected" };
  }

  checkLoginStatus() {
    const loginIndicators = {
      signInButtons: [
        'button[aria-label="sign in"]',
        'button:contains("Sign in")',
        'a:contains("Sign in")',
        '[data-test="sign-in"]',
        ".sign-in-button",
      ],

      loginPageElements: [
        '[data-test="login-form"]',
        "#LoginForm",
        ".login-container",
        'input[name="username"]',
        'input[name="password"]',
        'form[action*="login"]',
      ],

      userProfileElements: [
        '[data-test="user-menu"]',
        ".user-menu",
        '[data-test="profile-menu"]',
        ".profile-dropdown",
        '[aria-label*="profile"]',
        '[data-test="account-menu"]',
      ],
    };

    // Check for user profile elements first
    for (const selector of loginIndicators.userProfileElements) {
      let element;

      if (selector.includes(":contains")) {
        const text = selector.match(/contains\("(.+)"\)/)[1];
        element = Array.from(document.querySelectorAll("*")).find(
          (el) => el.textContent.trim() === text
        );
      } else {
        element = document.querySelector(selector);
      }

      if (element && this.isElementVisible(element)) {
        return {
          isLoggedIn: true,
          message: "✅ User is logged in",
          element: element,
        };
      }
    }

    // Check for sign-in buttons
    for (const selector of loginIndicators.signInButtons) {
      let element;

      if (selector.includes(":contains")) {
        const text = selector.match(/contains\("(.+)"\)/)[1];
        element = Array.from(document.querySelectorAll("button, a")).find(
          (el) =>
            el.textContent.trim().toLowerCase().includes(text.toLowerCase())
        );
      } else {
        element = document.querySelector(selector);
      }

      if (element && this.isElementVisible(element)) {
        return {
          isLoggedIn: false,
          message: "🔐 Please log in to your ZipRecruiter account before starting the job search automation.",
          element: element,
        };
      }
    }

    // Check for login form elements
    for (const selector of loginIndicators.loginPageElements) {
      const element = document.querySelector(selector);
      if (element && this.isElementVisible(element)) {
        return {
          isLoggedIn: false,
          message: "🔐 Login required. Please sign in to your ZipRecruiter account to continue.",
          element: element,
        };
      }
    }

    // Check URL patterns
    const currentUrl = window.location.href.toLowerCase();
    const loginUrlPatterns = ["/login", "/signin", "/auth", "/account/login"];

    for (const pattern of loginUrlPatterns) {
      if (currentUrl.includes(pattern)) {
        return {
          isLoggedIn: false,
          message: "🔐 You are on the login page. Please sign in to continue with job applications.",
          element: null,
        };
      }
    }

    return {
      isLoggedIn: true,
      message: "⚠️ Login status unclear - proceeding with caution. If you encounter issues, please ensure you're logged in.",
      element: null,
    };
  }

  // ========================================
  // JOB PROCESSING FLOW (Following Glassdoor pattern)
  // ========================================

  async startJobProcessing() {
    try {
      this.showUserMessage("Analyzing available jobs...", "searching");

      const { jobsFound, jobCount } = this.checkIfJobsFound();

      if (!jobsFound) {
        this.showUserMessage("No jobs found matching your criteria", "warning");
        this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
        return;
      }

      this.showUserMessage(
        `Found ${jobCount || "multiple"} jobs! Starting applications...`,
        "applying"
      );

      // Initialize state
      this.state.currentJobIndex = 0;
      this.state.processedCount = 0;
      this.state.lastActivity = Date.now();
      this.state.formDetected = false;
      this.state.isApplicationInProgress = false;
      this.state.applicationStartTime = null;

      // Process jobs
      await this.processNextJob();
    } catch (error) {
      this.showUserMessage(`Processing error: ${error.message}`, "error");
    }
  }

  async processNextJob() {
    try {
      if (!this.state.isRunning) {
        return;
      }

      if (this.state.isApplicationInProgress) {
        setTimeout(() => this.processNextJob(), 5000);
        return;
      }

      if (this.state.currentJobIndex === 0) {
        const { jobsFound } = this.checkIfJobsFound();
        if (!jobsFound) {
          this.showUserMessage("No more jobs found", "warning");
          this.state.isRunning = false;
          this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
          return;
        }
      }

      const jobCards = this.getUnprocessedJobCards();

      if (jobCards.length === 0) {
        if (await this.goToNextPage()) {
          this.showUserMessage("Loading next page...", "searching");
          setTimeout(() => this.processNextJob(), 3000);
        } else {
          this.showUserMessage("All jobs processed! 🎉", "completed");
          this.state.isRunning = false;
          this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
        }
        return;
      }

      const jobCard = jobCards[0];
      this.state.lastProcessedCard = jobCard;

      this.markJobCard(jobCard, "processing");

      const jobDetails = this.extractJobDetailsFromCard(jobCard);
      this.currentJobDetails = jobDetails;

      // Check if can apply to more jobs
      const canApply = await this.userService.canApplyMore();
      if (!canApply) {
        this.showUserMessage("Application limit reached", "warning");
        return;
      }

      // Click the job card to expand/view details
      const jobLink = jobCard.querySelector('a[href*="job"]');
      if (jobLink) {
        jobLink.click();
        await this.delay(ZIPRECRUITER_CONFIG.TIMEOUTS.STANDARD);
      }

      const applyButton = await this.findZipRecruiterApplyButton();

      if (!applyButton) {
        this.showUserMessage(`Skipping: ${jobDetails.title} (no Apply button)`, "info");
        this.markJobCard(jobCard, "skipped");
        this.state.processedCards.add(this.getJobCardId(jobCard));
        this.state.processedCount++;

        setTimeout(() => this.processNextJob(), 1000);
        return;
      }

      this.showUserMessage(`Applying to: ${jobDetails.title} 🚀`, "applying");

      this.state.isApplicationInProgress = true;
      this.state.applicationStartTime = Date.now();
      this.state.formDetected = false;

      this.state.processedCards.add(this.getJobCardId(jobCard));
      this.storeJobData();

      applyButton.click();
    } catch (error) {
      this.showUserMessage(`Error processing job: ${error.message}`, "error");
      this.resetApplicationStateOnError();
      setTimeout(() => this.processNextJob(), 3000);
    }
  }

  checkIfJobsFound() {
    try {
      const jobCards = this.getZipRecruiterJobCards();

      if (jobCards.length === 0) {
        // Check for "no results" messages
        for (const selector of ZIPRECRUITER_SELECTORS.NO_JOBS_FOUND) {
          if (document.querySelector(selector)) {
            return { jobsFound: false, jobCount: 0 };
          }
        }

        // Check page text for no results
        const pageText = document.body.textContent.toLowerCase();
        if (pageText.includes("no jobs found") ||
          pageText.includes("0 jobs") ||
          pageText.includes("no results")) {
          return { jobsFound: false, jobCount: 0 };
        }

        return { jobsFound: false, jobCount: 0 };
      }

      return {
        jobsFound: true,
        jobCount: jobCards.length
      };
    } catch (error) {
      return { jobsFound: true };
    }
  }

  async goToNextPage() {
    try {
      const nextButton = document.querySelector(
        ZIPRECRUITER_SELECTORS.NEXT_PAGE_BUTTON[0]
      );
      if (nextButton && this.isElementVisible(nextButton) && !nextButton.disabled) {
        nextButton.click();
        await this.delay(3000);

        const { jobsFound } = this.checkIfJobsFound();
        if (!jobsFound) {
          return false;
        }

        return true;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  // ========================================
  // JOB SEARCH METHODS (Following Glassdoor pattern)
  // ========================================

  async startSearchProcess() {
    try {
      if (this.searchProcessStarted) {
        return;
      }

      this.searchProcessStarted = true;
      this.showUserMessage("Searching for ZipRecruiter jobs...", "searching");

      // Get search task data from background
      await this.fetchSearchTaskData();
    } catch (error) {
      this.searchProcessStarted = false;
      this.showUserMessage(`Search error: ${error.message}`, "error");
      this.reportError(error, { phase: "jobListing" });
    }
  }

  async startJobSearchProcess() {
    try {
      this.showUserMessage("Starting job search on ZipRecruiter results page", "searching");
      await this.fetchSearchTaskData();
    } catch (error) {
      this.reportError(error, { phase: "jobSearch" });
    }
  }

  async fetchSearchTaskData() {
    this.log("📡 Fetching search task data from background");
    this.showUserMessage("Fetching search task data...", "info");

    const success = this.safeSendPortMessage({ type: "GET_SEARCH_TASK" });
    if (!success) {
      throw new Error("Failed to request search task data");
    }
  }

  // ========================================
  // JOB CARD METHODS
  // ========================================

  getZipRecruiterJobCards() {
    for (const selector of ZIPRECRUITER_SELECTORS.JOB_CARDS) {
      const cards = document.querySelectorAll(selector);
      if (cards.length > 0) {
        const visibleCards = Array.from(cards).filter((card) =>
          this.isElementVisible(card)
        );
        if (visibleCards.length > 0) {
          return visibleCards;
        }
      }
    }

    const fallbackCards = document.querySelectorAll(
      '[data-job], [class*="job"], [id*="job"]'
    );
    return Array.from(fallbackCards).filter(
      (card) => this.isElementVisible(card) && card.querySelector('a[href*="job"]')
    );
  }

  getUnprocessedJobCards() {
    const allCards = this.getZipRecruiterJobCards();
    return Array.from(allCards).filter((card) => {
      const cardId = this.getJobCardId(card);
      return !this.state.processedCards.has(cardId);
    });
  }

  getJobCardId(jobCard) {
    try {
      const dataId = jobCard.getAttribute("data-job-id") ||
        jobCard.getAttribute("data-id") ||
        jobCard.id;

      if (dataId) return dataId;

      const titleLink = jobCard.querySelector('a[href*="job"]');
      if (titleLink && titleLink.href) {
        return titleLink.href;
      }

      const title = this.getJobTitleFromCard(jobCard) || "";
      const company = this.getCompanyFromCard(jobCard) || "";
      const fallbackId = `${title}-${company}`
        .replace(/\s+/g, "")
        .toLowerCase();

      return fallbackId || `card-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    } catch (error) {
      return `card-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    }
  }

  getJobUrlFromCard(card) {
    const selectors = [
      'a[href*="ziprecruiter.com/jobs"]',
      'a[href*="job"]',
      "h2 a",
      "a",
    ];

    for (const selector of selectors) {
      const link = card.querySelector(selector);
      if (link && link.href && link.href.includes("ziprecruiter.com")) {
        return link.href;
      }
    }

    return null;
  }

  getJobTitleFromCard(card) {
    for (const selector of ZIPRECRUITER_SELECTORS.JOB_TITLE) {
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

  getCompanyFromCard(jobCard) {
    for (const selector of ZIPRECRUITER_SELECTORS.COMPANY_NAME) {
      const element = jobCard.querySelector(selector);
      if (element) {
        return element.textContent?.trim() || "";
      }
    }
    return "";
  }

  getLocationFromCard(jobCard) {
    for (const selector of ZIPRECRUITER_SELECTORS.LOCATION) {
      const element = jobCard.querySelector(selector);
      if (element) {
        return element.textContent?.trim() || "";
      }
    }
    return "";
  }

  getSalaryFromCard(jobCard) {
    for (const selector of ZIPRECRUITER_SELECTORS.SALARY) {
      const element = jobCard.querySelector(selector);
      if (element) {
        return element.textContent?.trim() || "";
      }
    }
    return "";
  }

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
        platform: "ziprecruiter",
        extractedAt: Date.now(),
        workplace: "Not specified",
        postedDate: this.extractPostedDate(jobCard),
        applicants: "Not specified",
      };
    } catch (error) {
      return {
        jobId: "",
        title: "Unknown Position",
        company: "Unknown Company",
        location: "Unknown Location",
        salary: "Not specified",
        jobUrl: window.location.href,
        platform: "ziprecruiter",
        extractedAt: Date.now(),
      };
    }
  }

  extractPostedDate(jobCard) {
    try {
      const elements = jobCard.querySelectorAll("p.text-primary, .date, .posted");
      for (const element of elements) {
        const text = element.textContent.trim();
        if (text && text.toLowerCase().includes("posted")) {
          return text;
        }
      }
      return "Not specified";
    } catch (error) {
      return "Not specified";
    }
  }

  markJobCard(jobCard, status) {
    try {
      const existingHighlight = jobCard.querySelector(".job-highlight");
      if (existingHighlight) {
        existingHighlight.remove();
      }

      const highlight = document.createElement("div");
      highlight.className = "job-highlight";

      let color, text;
      switch (status) {
        case "processing":
          color = "#2196F3";
          text = "Processing";
          break;
        case "applied":
          color = "#4CAF50";
          text = "Applied";
          break;
        case "already_applied":
          color = "#8BC34A";
          text = "Already Applied";
          break;
        case "skipped":
          color = "#FF9800";
          text = "Skipped";
          break;
        case "error":
          color = "#F44336";
          text = "Error";
          break;
        default:
          color = "#9E9E9E";
          text = "Unknown";
      }

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

      jobCard.style.border = `2px solid ${color}`;
      jobCard.style.position = "relative";
      jobCard.appendChild(highlight);
    } catch (error) {
      this.log("Error marking job card:", error);
    }
  }

  markLastJobCardIfAvailable(status) {
    if (this.state.lastProcessedCard) {
      this.markJobCard(this.state.lastProcessedCard, status);
    }
  }

  // ========================================
  // APPLICATION PROCESS (Following Glassdoor pattern)
  // ========================================

  async startApplicationProcess() {
    try {
      this.log("📝 Starting ZipRecruiter application process");
      this.showUserMessage("Processing application form...", "applying");

      if (!this.profile) {
        this.profile = await this.getProfileData();
      }

      if (this.checkApplicationSuccess()) {
        await this.handleAlreadyApplied();
        return;
      }

      if (this.profile) {
        await this.handleFormWithFormHandler();
      } else {
        this.showUserMessage("Error: No profile data available", "error");
      }
    } catch (error) {
      this.reportError(error, { phase: "application" });
      this.handleApplicationError(error);
    }
  }

  async handleJobListingPage() {
    try {
      this.showUserMessage("ZipRecruiter job listing page detected", "info");

      this.cachedJobDescription = await this.extractZipRecruiterJobDescription();

      const applyButton = await this.findZipRecruiterApplyButton();
      if (!applyButton) {
        throw new Error("Cannot find Apply button on ZipRecruiter job listing page");
      }

      applyButton.click();
      await this.waitForZipRecruiterApplicationPage();
      this.showUserMessage("Application page loaded successfully", "success");

      await this.startApplicationProcess();
    } catch (error) {
      this.reportError(error, { phase: "jobListing" });
      this.handleApplicationError(error);
    }
  }

  async handleFormWithFormHandler() {
    try {
      // Get the latest job description FIRST
      const latestJobDescription = await this.getStoredJobData();
      this.log(
        "Latest job description retrieved:",
        latestJobDescription
          ? latestJobDescription.substring(0, 100) + "..."
          : "EMPTY"
      );

      // Update FormHandler with latest job description and user data
      if (this.formHandler) {
        this.formHandler.userData = this.profile;
        this.formHandler.jobDescription = latestJobDescription;
      } else {
        this.formHandler = new FormHandler({
          platform: "ziprecruiter",
          userData: this.profile,
          enableDebug: this.config.debug,
          host: this.getApiHost(),
          jobDescription: latestJobDescription,
          logger: this.showUserMessage,
        });
      }

      // Now FormHandler has the correct job description
      const success = await this.formHandler.fillCompleteForm();

      if (success) {
        this.showUserMessage("Application submitted successfully! ✅", "success");
        if (this.currentJobDetails) {
          await this.trackApplication(this.currentJobDetails);
        }
        this.markLastJobCardIfAvailable("applied");
      } else {
        this.showUserMessage("Application failed", "error");
        this.markLastJobCardIfAvailable("error");
      }

      this.resetApplicationState();

      if (this.state.isRunning) {
        setTimeout(() => this.processNextJob(), 2000);
      }

      return success;
    } catch (error) {
      this.showUserMessage(`Form processing error: ${error.message}`, "error");
      this.markLastJobCardIfAvailable("error");
      this.resetApplicationState();

      if (this.state.isRunning) {
        setTimeout(() => this.processNextJob(), 2000);
      }
      return false;
    }
  }

  async handleDetectedForm() {
    try {
      const alreadyApplied = await this.checkZipRecruiterAlreadyApplied();
      if (alreadyApplied) {
        this.showUserMessage("Job already applied to, moving to next job", "info");
        this.resetApplicationState();
        if (this.state.isRunning) {
          setTimeout(() => this.processNextJob(), 2000);
        }
        return;
      }

      this.showUserMessage("Form detected, starting application process", "info");

      if (!this.userProfile) {
        this.userProfile = await this.getProfileData();
        this.profile = this.userProfile;
      }

      if (this.profile) {
        const success = await this.handleFormWithFormHandler();

        if (success) {
          this.showUserMessage("Application submitted successfully", "success");
          if (this.currentJobDetails) {
            await this.trackApplication(this.currentJobDetails);
          }
          this.markLastJobCardIfAvailable("applied");
        } else {
          this.showUserMessage("Failed to complete application", "error");
          this.markLastJobCardIfAvailable("error");
        }

        this.resetApplicationState();

        if (this.state.isRunning) {
          this.showUserMessage("Moving to next job...", "info");
          setTimeout(() => this.processNextJob(), 2000);
        }
      } else {
        this.showUserMessage("No profile data available for form filling", "error");
        this.resetApplicationState();

        if (this.state.isRunning) {
          setTimeout(() => this.processNextJob(), 2000);
        }
      }
    } catch (error) {
      this.showUserMessage("Error handling form: " + error.message, "error");
      this.resetApplicationState();

      if (this.state.isRunning) {
        setTimeout(() => this.processNextJob(), 2000);
      }
    }
  }

  // ========================================
  // UTILITY METHODS
  // ========================================

  storeJobData() {
    const jobData = {
      description: this.extractJobDescription(),
      timestamp: Date.now(),
    };
    chrome.storage.local.set({ currentJobData: jobData });
  }

  getStoredJobData() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["currentJobData"], (result) => {
        if (result.currentJobData) {
          const jobData = result.currentJobData;
          if (Date.now() - jobData.timestamp < 300000) {
            resolve(jobData.description);
            return;
          }
        }
        resolve("");
      });
    });
  }

  extractJobDescription() {
    try {
      const jobDescElement = document.querySelector(
        '.job-description, .description, [data-testid="job-description"]'
      );
      return jobDescElement ? jobDescElement.textContent.trim() : "";
    } catch (error) {
      return "";
    }
  }

  async findZipRecruiterApplyButton() {
    try {
      for (const selector of ZIPRECRUITER_SELECTORS.APPLY_BUTTON) {
        const button = document.querySelector(selector);
        if (button && this.isElementVisible(button) && !button.disabled) {
          this.showUserMessage("✅ Found Apply button", "success");
          return button;
        }
      }

      const allButtons = document.querySelectorAll("button, a");
      for (const button of allButtons) {
        const buttonText = button.textContent.toLowerCase();
        if (
          (buttonText.includes("apply") || buttonText.includes("1-click")) &&
          this.isElementVisible(button) &&
          !button.disabled
        ) {
          return button;
        }
      }

      this.showUserMessage("❌ No apply button found", "warning");
      return null;
    } catch (error) {
      this.showUserMessage("Error finding apply button: " + error.message, "error");
      return null;
    }
  }

  async trackApplication(jobDetails) {
    try {
      if (!this.userProfile || !this.userId) {
        return;
      }

      await this.applicationTracker.updateApplicationCount();
      await this.applicationTracker.saveAppliedJob({
        ...jobDetails,
        userId: this.userId,
        applicationPlatform: "ziprecruiter",
      });
    } catch (error) {
      this.log("Error tracking application:", error);
    }
  }

  async extractZipRecruiterJobDescription() {
    try {
      this.showUserMessage("Extracting job details...", "info");

      const jobDescription = {
        title: DomUtils.extractText([
          "h1",
          ".job-title",
          "[data-testid='job-title']",
        ]),
        company: DomUtils.extractText([
          ".company-name",
          "[data-testid='company-name']",
          ".hiring-company",
        ]),
        location: DomUtils.extractText([
          ".location",
          "[data-testid='location']",
          ".job-location",
        ]),
        salary: DomUtils.extractText([
          ".salary",
          "[data-testid='salary']",
          ".compensation",
        ]),
      };

      const fullDescriptionElement = document.querySelector(
        '.job-description, .description, [data-testid="job-description"]'
      );

      if (fullDescriptionElement) {
        jobDescription.fullDescription = fullDescriptionElement.textContent.trim();
      }

      return jobDescription;
    } catch (error) {
      this.log("❌ Error extracting ZipRecruiter job details:", error);
      return { title: document.title || "Job Position" };
    }
  }

  async getProfileData() {
    try {
      if (this.profile) {
        return this.profile;
      }

      if (this.userService && this.userId) {
        try {
          const profile = await this.userService.getUserDetails();
          this.profile = profile;
          this.userProfile = profile;
          return profile;
        } catch (error) {
          // Silently fail
        }
      }

      return this.getFallbackProfile();
    } catch (error) {
      return this.getFallbackProfile();
    }
  }

  getFallbackProfile() {
    return this.profile || this.userProfile || {};
  }

  checkApplicationSuccess() {
    const url = window.location.href;
    if (url.includes("success") || url.includes("confirmation") || url.includes("applied")) {
      this.showUserMessage("URL indicates success - application submitted", "success");
      return true;
    }

    const successSelectors = [
      ".application-success",
      ".success-message",
      ".confirmation",
      ".applied-status",
    ];

    for (const selector of successSelectors) {
      if (document.querySelector(selector)) {
        this.showUserMessage("Success message found - application submitted", "success");
        return true;
      }
    }

    const pageText = document.body.innerText.toLowerCase();
    return pageText.includes("application submitted") ||
      pageText.includes("successfully applied") ||
      pageText.includes("thank you for applying") ||
      pageText.includes("application complete");
  }

  async checkZipRecruiterAlreadyApplied() {
    try {
      const url = window.location.href;

      if (url.includes("ziprecruiter.com")) {
        const pageText = document.body.innerText;
        const alreadyAppliedText = "You've applied to this job";

        if (pageText.includes(alreadyAppliedText)) {
          this.showUserMessage("Found 'You've applied to this job' message - already applied", "info");
          return true;
        }
      }

      const appliedIndicators = [
        ".applied-status",
        ".application-submitted",
        ".already-applied",
      ];

      for (const selector of appliedIndicators) {
        if (document.querySelector(selector)) {
          this.showUserMessage("Found applied indicator - already applied", "info");
          return true;
        }
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  async handleAlreadyApplied() {
    const jobId = UrlUtils.extractJobId(window.location.href, "ziprecruiter");
    const jobDetails = await this.extractZipRecruiterJobDescription();

    this.safeSendPortMessage({
      type: "APPLICATION_SUCCESS",
      data: {
        jobId: jobId,
        title: jobDetails.title || "Job on ZipRecruiter",
        company: jobDetails.company || "Company on ZipRecruiter",
        location: jobDetails.location || "Not specified",
        jobUrl: window.location.href,
        platform: "ziprecruiter",
      },
    });

    this.resetApplicationState();
    this.showUserMessage("Application completed successfully", "success");
  }

  // ========================================
  // FORM DETECTION & PAGE CHECKS
  // ========================================

  setupFormDetectionObserver() {
    try {
      this.formObserver = new MutationObserver((mutations) => {
        if (this.state.isApplicationInProgress || this.isOnApplyPage()) {
          const hasForm = ZIPRECRUITER_SELECTORS.MODAL_CONTAINER.some((selector) => {
            const element = document.querySelector(selector);
            return element && this.isElementVisible(element);
          });

          if (hasForm && !this.state.formDetected) {
            this.state.formDetected = true;
            setTimeout(() => {
              this.handleDetectedForm();
            }, 1000);
          }
        }
      });

      this.formObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });
    } catch (error) {
      this.log("Error setting up form observer:", error);
    }
  }

  isOnApplyPage() {
    const url = window.location.href;
    return url.includes("ziprecruiter.com/apply") ||
      url.includes("ziprecruiter.com/job");
  }

  isZipRecruiterSearchPage(url) {
    return /ziprecruiter\.com\/(jobs|search)/.test(url);
  }

  isZipRecruiterJobPage(url) {
    return /ziprecruiter\.com\/job\//.test(url);
  }

  isZipRecruiterApplicationPage(url) {
    return /ziprecruiter\.com\/apply/.test(url);
  }

  async waitForZipRecruiterApplicationPage(timeout = 10000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (this.isZipRecruiterApplicationPage(window.location.href)) {
        const form = document.querySelector(ZIPRECRUITER_SELECTORS.MODAL_CONTAINER[0]);
        if (form) {
          return true;
        }
      }
      await this.wait(500);
    }

    throw new Error("Timeout waiting for ZipRecruiter application page to load");
  }

  // ========================================
  // EXISTING METHODS (keeping your implementations) - FIXED
  // ========================================

  getPlatformDomains() {
    return ["https://www.ziprecruiter.com"];
  }

  getSearchLinkPattern() {
    return /^https:\/\/(www\.)?ziprecruiter\.com\/(job|jobs|apply).*$/;
  }

  isValidJobPage(url) {
    return /^https:\/\/(www\.)?ziprecruiter\.com\/(job|jobs|apply)/.test(url);
  }

  getApiHost() {
    return this.sessionApiHost || this.sessionContext?.apiHost || this.config.apiHost;
  }

  isApplicationPage(url) {
    return url.includes("ziprecruiter.com/apply") ||
      url.includes("ziprecruiter.com/job");
  }

  getJobTaskMessageType() {
    return "openJobInNewTab";
  }

  platformSpecificUrlNormalization(url) {
    return url
      .replace(/[?&](utm_|source=|campaign=)[^&]*/g, "")
      .replace(/[?&]+$/, "");
  }

  async start(params = {}) {
    // This will be called by handleStartAutomation
    return await this.handleStartAutomation();
  }

  async detectPageTypeAndStart() {
    const url = window.location.href;
    this.log(`🔍 Detecting page type for: ${url}`);

    if (url.includes("google.com/search")) {
      this.showUserMessage("Google search page detected", "info");
      await this.startSearchProcess();
    } else if (this.isZipRecruiterApplicationPage(url)) {
      this.showUserMessage("ZipRecruiter application page detected", "info");
      await this.startApplicationProcess();
    } else if (this.isZipRecruiterJobPage(url)) {
      this.showUserMessage("ZipRecruiter job page detected", "info");
      await this.handleJobListingPage();
    } else if (this.isZipRecruiterSearchPage(url)) {
      this.showUserMessage("ZipRecruiter search page detected", "info");
      await this.startJobSearchProcess();
    } else {
      this.log("❓ Unknown page type, waiting for navigation");
      await this.waitForValidPage();
    }
  }

  // ========================================
  // INITIALIZATION (Following Glassdoor pattern) - FIXED
  // ========================================

  init() {
    try {
      const url = window.location.href;

      if (this.isZipRecruiterApplicationPage(url)) {
        this.state.initialized = true;
        this.state.ready = true;
        this.state.formDetected = true;

        setTimeout(async () => {
          await this.startApplicationProcess();
        }, 2000);

        return;
      }

      const isSearchPage = this.isZipRecruiterSearchPage(url);
      const isJobPage = this.isZipRecruiterJobPage(url);
      const isApplyPage = this.isZipRecruiterApplicationPage(url);

      if (isSearchPage) {
        const { jobsFound } = this.checkIfJobsFound();
        if (!jobsFound) {
          this.showUserMessage("No jobs found for your search", "warning");
          this.state.ready = true;
          this.state.initialized = true;
          return;
        }

        this.state.ready = true;
      } else if (isJobPage || isApplyPage) {
        // This will be handled by detectPageTypeAndStart
      }

      this.state.initialized = true;
    } catch (error) {
      this.showUserMessage(`Initialization error: ${error.message}`, "error");
    }
  }

  // ========================================
  // HEALTH CHECK & STATE MANAGEMENT - FIXED
  // ========================================

  checkHealth() {
    try {
      if (this.state.isApplicationInProgress && this.state.applicationStartTime) {
        const now = Date.now();
        const applicationTime = now - this.state.applicationStartTime;

        if (applicationTime > ZIPRECRUITER_CONFIG.TIMEOUTS.APPLICATION_TIMEOUT) {
          this.log("Application appears to be stuck, resetting state");
          this.markLastJobCardIfAvailable("error");

          this.resetApplicationState();

          this.showUserMessage("Application timeout detected - resetting state", "warning");

          if (this.state.isRunning) {
            setTimeout(() => this.processNextJob(), 2000);
          }
        }
      }

      if (this.state.isRunning) {
        const now = Date.now();
        const inactiveTime = now - this.state.lastActivity;

        if (inactiveTime > 120000) {
          this.log("Automation appears inactive, attempting recovery");

          if (this.state.isApplicationInProgress) {
            this.resetApplicationState();
          }

          this.state.lastActivity = now;
          this.processNextJob();
        }
      }
    } catch (error) {
      this.log("Error in health check:", error);
    }
  }

  resetApplicationState() {
    this.state.isApplicationInProgress = false;
    this.state.applicationStartTime = null;
    this.state.formDetected = false;
    this.state.lastProcessedCard = null;

    this.applicationState.isApplicationInProgress = false;
    this.applicationState.applicationStartTime = null;
    this.applicationState.currentJobData = null;
  }

  resetApplicationStateOnError() {
    this.resetApplicationState();
    this.showUserMessage("Application state reset - ready for next job", "info");
  }

  handleApplicationError(error) {
    if (error.name === "SendCvSkipError" || error.name === "ApplicationSkipError") {
      this.showUserMessage("Application skipped: " + error.message, "warning");
      this.safeSendPortMessage({
        type: "APPLICATION_SKIPPED",
        data: error.message,
      });
    } else {
      this.showUserMessage("Application error: " + error.message, "error");
      this.safeSendPortMessage({
        type: "APPLICATION_ERROR",
        data: this.errorToString(error),
      });
    }

    this.resetApplicationStateOnError();
  }

  // ========================================
  // USER MESSAGING (Following Glassdoor pattern) - FIXED
  // ========================================

  showUserMessage(message, type = "info") {
    if (this.statusOverlay) {
      switch (type) {
        case "success":
          this.statusOverlay.addSuccess(message);
          break;
        case "error":
          this.statusOverlay.addError(message);
          break;
        case "warning":
          this.statusOverlay.addWarning(message);
          break;
        case "searching":
          this.statusOverlay.addBotMessage(message, "searching");
          break;
        case "applying":
          this.statusOverlay.addBotMessage(message, "applying");
          break;
        case "completed":
          this.statusOverlay.addBotMessage(message, "completed");
          break;
        default:
          this.statusOverlay.addInfo(message);
      }
    }
  }

  // ========================================
  // UTILITY & HELPER METHODS - FIXED
  // ========================================

  isValidJobUrl(url) {
    if (!url || typeof url !== "string") return false;

    try {
      const urlObj = new URL(url);
      if (!urlObj.hostname.includes("ziprecruiter.com")) return false;
      if (!url.includes("job")) return false;
      return true;
    } catch (error) {
      return false;
    }
  }

  isElementVisible(element) {
    if (!element) return false;
    try {
      const style = window.getComputedStyle(element);
      if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
        return false;
      }
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch (error) {
      return false;
    }
  }

  async waitForPageLoad() {
    if (document.readyState !== "complete") {
      await new Promise((resolve) => {
        if (document.readyState === "complete") {
          resolve();
        } else {
          window.addEventListener("load", resolve, { once: true });
        }
      });
    }
    await this.delay(1000);
  }

  async waitForValidPage(timeout = 30000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const url = window.location.href;

      if (url.includes("google.com/search") || this.isValidJobPage(url) || this.isApplicationPage(url)) {
        await this.detectPageTypeAndStart();
        return;
      }

      await this.delay(1000);
    }

    throw new Error("Timeout waiting for valid page");
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ========================================
  // SESSION CONTEXT & CLEANUP - FIXED
  // ========================================

  async setSessionContext(sessionContext) {
    try {
      await super.setSessionContext(sessionContext);

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
          this.profile = sessionContext.userProfile;
        } else {
          // Merge profiles, preferring non-null values from session context
          this.userProfile = {
            ...this.userProfile,
            ...sessionContext.userProfile,
          };
          this.profile = this.userProfile;
        }
      }

      // Fetch user profile if still missing and we have a userId
      if (!this.userProfile && this.userId) {
        try {
          this.userProfile = await this.userService.getUserDetails();
          this.profile = this.userProfile;
        } catch (error) {
          console.error("❌ Failed to fetch user profile:", error);
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

      this.log("✅ ZipRecruiter session context set successfully", {
        hasUserProfile: !!this.userProfile,
        userId: this.userId,
        sessionId: this.sessionId,
        profileName: this.userProfile?.name || this.userProfile?.firstName,
        profileEmail: this.userProfile?.email,
      });
    } catch (error) {
      console.error("❌ Error setting ZipRecruiter session context:", error);
    }
  }

  cleanup() {
    if (this.statusOverlay) {
      this.statusOverlay.destroy();
      this.statusOverlay = null;
    }

    super.cleanup();

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    if (this.formObserver) {
      this.formObserver.disconnect();
      this.formObserver = null;
    }

    // Cleanup FormHandler
    if (this.formHandler) {
      this.formHandler = null;
    }

    // Reset job processing state
    this.jobQueue = [];
    this.currentJobIndex = 0;
    this.queueInitialized = false;
    this.searchProcessStarted = false;
    this.currentExpandedJob = null;

    // Reset application state
    this.applicationState = {
      isApplicationInProgress: false,
      currentJobInfo: null,
      processedUrls: new Set(),
    };

    // Reset main state
    this.state = {
      initialized: false,
      ready: false,
      isRunning: false,
      isApplicationInProgress: false,
      applicationStartTime: null,
      processedCards: new Set(),
      processedCount: 0,
      currentJobIndex: 0,
      lastProcessedCard: null,
      currentJobDetails: null,
      lastActivity: Date.now(),
      jobProcessingLock: false,
      currentPage: 1,
      totalPages: 0,
      noMorePages: false,
      formDetected: false,
    };

    // Clear cached data
    this.cachedJobDescription = null;
    this.processedJobCards.clear();
    this.answerCache.clear();

    this.log("🧹 ZipRecruiter platform cleanup completed");
  }

  // ========================================
  // ERROR HANDLING - FIXED
  // ========================================

  errorToString(e) {
    if (!e) return "Unknown error (no details)";
    if (e instanceof Error) {
      return e.message + (e.stack ? `\n${e.stack}` : "");
    }
    return String(e);
  }

  // ========================================
  // LEGACY COMPATIBILITY METHODS - FIXED
  // ========================================

  async processZipRecruiterJobCards() {
    // This method is called by the existing searchNext logic
    return await this.processNextJob();
  }

  async findValidUnprocessedJobCard(jobCards) {
    for (const card of jobCards) {
      try {
        const cardId = this.getJobCardId(card);

        if (this.state.processedCards.has(cardId)) {
          continue;
        }

        const jobUrl = this.getJobUrlFromCard(card);
        if (!jobUrl) {
          continue;
        }

        if (!this.isValidJobUrl(jobUrl)) {
          continue;
        }

        const normalizedUrl = this.normalizeUrlFully(jobUrl);

        if (this.isLinkProcessed(normalizedUrl)) {
          this.state.processedCards.add(cardId);
          continue;
        }

        const hasTitle = this.getJobTitleFromCard(card);
        if (!hasTitle || hasTitle === "Job Application") {
          continue;
        }

        return { card, url: jobUrl, cardId };
      } catch (error) {
        continue;
      }
    }

    return null;
  }

  async processZipRecruiterJobCard(jobData) {
    const { card, url, cardId } = jobData;

    try {
      this.showUserMessage("Found ZipRecruiter job to apply: " + url, "success");
      this.state.processedCards.add(cardId);

      if (this.state.isApplicationInProgress) {
        return;
      }

      const canApply = await this.userService.canApplyMore();
      if (!canApply) {
        this.showUserMessage("Application limit reached", "warning");
        return;
      }

      const jobDetails = this.extractJobDetailsFromCard(card);
      this.markJobCard(card, "processing");

      this.state.isApplicationInProgress = true;
      this.state.applicationStartTime = Date.now();
      this.state.lastProcessedCard = card;
      this.currentJobDetails = jobDetails;

      if (!this.applicationState.processedUrls) {
        this.applicationState.processedUrls = new Set();
      }
      this.applicationState.processedUrls.add(this.normalizeUrlFully(url));

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

  handleJobTaskError(error, url, card) {
    this.showUserMessage("Error processing job: " + error.message, "error");

    this.resetApplicationStateOnError();

    if (card) {
      card.style.border = "";
      card.style.backgroundColor = "";
      const indicator = card.querySelector(".processing-indicator");
      if (indicator) {
        indicator.remove();
      }
    }

    setTimeout(() => {
      if (!this.state.isApplicationInProgress) {
        this.processNextJob();
      }
    }, 3000);
  }

  async handleNoJobCardsFound() {
    this.showUserMessage("No job cards found, attempting to load more...", "info");

    window.scrollTo(0, document.body.scrollHeight);
    await this.wait(2000);

    const jobCardsAfterScroll = this.getZipRecruiterJobCards();
    if (jobCardsAfterScroll.length > 0) {
      this.showUserMessage("Found jobs after scrolling", "info");
      return await this.processNextJob();
    }

    const nextButton = document.querySelector(
      ZIPRECRUITER_SELECTORS.NEXT_PAGE_BUTTON[0]
    );

    if (nextButton && this.isElementVisible(nextButton) && !nextButton.disabled) {
      this.showUserMessage('Clicking "Next Page" button', "info");
      nextButton.click();
      await this.wait(3000);

      if (!this.state.isApplicationInProgress) {
        return this.processNextJob();
      }
    } else {
      this.showUserMessage("All ZipRecruiter jobs processed!", "success");
      this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
    }
  }

  async handleNoUnprocessedJobCards() {
    return await this.handleNoJobCardsFound();
  }

  // Methods needed by base class
  normalizeUrlFully(url) {
    try {
      if (!url) return "";

      if (!url.startsWith("http")) {
        url = "https://" + url;
      }

      // Remove tracking parameters
      url = this.platformSpecificUrlNormalization(url);

      const urlObj = new URL(url);
      return (urlObj.origin + urlObj.pathname)
        .toLowerCase()
        .trim()
        .replace(/\/+$/, "");
    } catch (e) {
      console.warn("⚠️ Error normalizing URL:", e);
      return url.toLowerCase().trim();
    }
  }

  isLinkProcessed(normalizedUrl) {
    if (!this.searchData || !this.searchData.submittedLinks) {
      return false;
    }

    return this.searchData.submittedLinks.some(link => {
      const linkUrl = this.normalizeUrlFully(link.url || link);
      return linkUrl === normalizedUrl;
    });
  }

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

  // ========================================
  // ADDITIONAL PORT MESSAGE HANDLING - FIXED
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

      case "SEARCH_NEXT":
        this.handleSearchNext(data);
        break;

      default:
        if (super.handlePlatformSpecificMessage) {
          super.handlePlatformSpecificMessage(type, data);
        }
    }
  }

  handleApplicationStatusResponse(data) {
    if (data && data.active === false && this.state.isApplicationInProgress) {
      this.log("⚠️ State mismatch detected! Resetting application progress flag");
      this.resetApplicationStateOnError();
      setTimeout(() => this.processNextJob(), 1000);
    }
  }

  handleJobTabStatus(data) {
    if (data && !data.isOpen && this.state.isApplicationInProgress) {
      this.log("⚠️ Job tab closed but application still in progress - resetting");
      this.resetApplicationStateOnError();
    }
  }

  handleSearchNextReady(data) {
    setTimeout(() => {
      if (!this.state.isApplicationInProgress) {
        this.processNextJob();
      }
    }, 1000);
  }

  handleSearchNext(data) {
    // Handle search next message from background script
    if (data) {
      this.log("📨 Received SEARCH_NEXT message:", data);

      // Update submitted links if provided
      if (data.submittedLinks) {
        this.searchData.submittedLinks = data.submittedLinks;
      }

      // Update current count if provided
      if (data.current !== undefined) {
        this.searchData.current = data.current;
      }
    }

    // Continue processing if not currently applying
    if (!this.state.isApplicationInProgress) {
      setTimeout(() => this.processNextJob(), 1000);
    }
  }

  async fetchSendCvTaskData() {
    if (this.userProfile && this.hasSessionContext) {
      return;
    }

    this.showUserMessage("Fetching CV task data...", "info");

    const success = this.safeSendPortMessage({ type: "GET_SEND_CV_TASK" });
    if (!success) {
      throw new Error("Failed to request send CV task data");
    }
  }

  processSendCvTaskData(data) {
    try {
      if (data?.profile && !this.userProfile) {
        this.userProfile = data.profile;
        this.profile = data.profile;
      }

      if (this.formHandler && this.userProfile) {
        this.formHandler.userData = this.userProfile;
      }

      this.showUserMessage("Apply initialization complete", "success");
    } catch (error) {
      this.showUserMessage("Error processing CV data: " + error.message, "error");
    }
  }

  // ========================================
  // ORIGINAL LEGACY METHODS (Keeping for compatibility) - FIXED
  // ========================================

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

      this.showUserMessage("Search initialization complete", "success");
      setTimeout(() => this.searchNext(), 1000);
    } catch (error) {
      this.showUserMessage("Error processing search task data: " + error.message, "error");
    }
  }

  async searchNext() {
    try {
      if (this.state.isApplicationInProgress) {
        this.log("Application in progress, checking status...");
        this.showUserMessage("Application in progress, waiting...", "info");

        const now = Date.now();
        const applicationDuration = now - (this.state.applicationStartTime || now);

        if (applicationDuration > ZIPRECRUITER_CONFIG.TIMEOUTS.APPLICATION_TIMEOUT) {
          this.log("Application timeout detected, resetting...");
          this.showUserMessage("Application timeout detected, resetting...", "warning");
          this.resetApplicationStateOnError();
        } else {
          this.safeSendPortMessage({ type: "CHECK_APPLICATION_STATUS" });
          return;
        }
      }

      this.showUserMessage("Searching for job cards...", "info");

      if (this.isZipRecruiterSearchPage(window.location.href)) {
        await this.processZipRecruiterJobCards();
      } else if (window.location.href.includes("google.com/search")) {
        await super.searchNext();
      } else {
        this.showUserMessage("Unknown page type for search", "warning");
        await this.waitForValidPage();
      }
    } catch (err) {
      this.showUserMessage("Error in search: " + err.message, "error");
      this.resetApplicationStateOnError();
      setTimeout(() => {
        if (!this.state.isApplicationInProgress) {
          this.searchNext();
        }
      }, 5000);
    }
  }

  async apply() {
    try {
      this.showUserMessage("Starting ZipRecruiter application process", "info");

      if (!this.validateHandlers()) {
        throw new Error("Required handlers are not properly initialized");
      }

      return await this.handleApplyForm();
    } catch (e) {
      throw new Error("Error during application process: " + this.errorToString(e));
    }
  }

  async handleApplyForm() {
    try {
      await this.sleep(1500);

      if (!this.formHandler) {
        this.showUserMessage("Form handler not available", "error");
        return false;
      }

      this.formHandler.jobDescription =
        this.cachedJobDescription || (await this.extractZipRecruiterJobDescription());
      this.formHandler.userData = this.userProfile;

      this.showUserMessage("Starting comprehensive form filling process", "info");

      const success = await this.formHandler.fillCompleteForm();

      if (success) {
        this.showUserMessage("Application submitted successfully!", "success");
        this.markLastJobCardIfAvailable("applied");
        await this.trackApplication(this.currentJobDetails);
      } else {
        this.showUserMessage("Application process completed but success not confirmed", "info");
      }

      return success;
    } catch (error) {
      this.showUserMessage("Form submission error: " + error.message, "error");
      this.markLastJobCardIfAvailable("error");
      return false;
    }
  }

  isOnApplyFormPage() {
    const url = window.location.href;

    if (url.includes("ziprecruiter.com/apply") || url.includes("ziprecruiter.com/job")) {
      return true;
    }

    const hasFormElements = ZIPRECRUITER_SELECTORS.MODAL_CONTAINER.some((selector) => {
      const element = document.querySelector(selector);
      return element && this.isElementVisible(element);
    });

    return hasFormElements;
  }

  extractJobIdFromUrl() {
    try {
      const url = window.location.href;
      const match = url.match(/\/job\/([^\/\?]+)/);
      return match ? match[1] : null;
    } catch (error) {
      return null;
    }
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

  // ========================================
  // ADDITIONAL COMPATIBILITY METHODS - FIXED
  // ========================================

  async startAutomation() {
    return await this.handleStartAutomation();
  }

  // Ensure compatibility with existing automation flow
  async startJobSearch() {
    return await this.handleStartAutomation();
  }

  // Handle job opening in new tab (legacy compatibility)
  async openJobInNewTab(jobData) {
    try {
      const { url, title, company, location } = jobData;

      this.showUserMessage(`Opening job: ${title} at ${company}`, "info");

      // Store job details for later use
      this.currentJobDetails = {
        title,
        company,
        location,
        jobUrl: url,
        platform: "ziprecruiter"
      };

      // Navigate to the job URL
      window.location.href = url;

      return true;
    } catch (error) {
      this.showUserMessage("Error opening job: " + error.message, "error");
      return false;
    }
  }

  // Enhanced error handling for specific error types
  handleJobProcessingError(error, context = {}) {
    this.log("❌ Job processing error:", error, context);

    if (error.name === "TimeoutError") {
      this.showUserMessage("Job processing timed out", "warning");
    } else if (error.name === "NavigationError") {
      this.showUserMessage("Navigation error occurred", "warning");
    } else {
      this.showUserMessage("Job processing error: " + error.message, "error");
    }

    this.resetApplicationStateOnError();

    // Continue with next job after delay
    if (this.state.isRunning) {
      setTimeout(() => this.processNextJob(), 3000);
    }
  }

  // Job queue management (for compatibility)
  addJobToQueue(jobData) {
    if (!this.jobQueue.includes(jobData)) {
      this.jobQueue.push(jobData);
    }
  }

  getNextJobFromQueue() {
    if (this.jobQueue.length > 0) {
      return this.jobQueue.shift();
    }
    return null;
  }

  // Enhanced state reporting
  getAutomationState() {
    return {
      initialized: this.state.initialized,
      ready: this.state.ready,
      isRunning: this.state.isRunning,
      isApplicationInProgress: this.state.isApplicationInProgress,
      processedCount: this.state.processedCount,
      currentJobIndex: this.state.currentJobIndex,
      platform: "ziprecruiter",
      hasUserProfile: !!this.userProfile,
      hasSessionContext: this.hasSessionContext,
      lastActivity: this.state.lastActivity,
      queueLength: this.jobQueue?.length || 0
    };
  }

  // Method to manually trigger job processing (for debugging)
  async debugProcessNextJob() {
    this.log("🔧 Debug: Manually triggering next job processing");
    this.showUserMessage("Debug: Processing next job", "info");

    try {
      await this.processNextJob();
    } catch (error) {
      this.log("❌ Debug: Error in processNextJob:", error);
      this.showUserMessage("Debug error: " + error.message, "error");
    }
  }

  // Enhanced logging with context
  log(message, data = {}) {
    const contextInfo = {
      platform: this.platform,
      sessionId: this.sessionId?.slice(-6),
      isRunning: this.state.isRunning,
      isApplicationInProgress: this.state.isApplicationInProgress,
      processedCount: this.state.processedCount
    };

    this.log(`🤖 [ZipRecruiter] ${message}`, { ...contextInfo, ...data });
  }

  // Method to reset all state (for debugging/recovery)
  resetAllState() {
    this.log("🔄 Resetting all ZipRecruiter automation state");

    this.state.isRunning = false;
    this.resetApplicationStateOnError();
    this.jobQueue = [];
    this.currentJobIndex = 0;
    this.searchProcessStarted = false;

    if (this.statusOverlay) {
      this.showUserMessage("All state reset - automation stopped", "warning");
    }
  }

  // Compatibility method for external state checks
  isAutomationActive() {
    return this.state.isRunning || this.state.isApplicationInProgress;
  }

  // Method to get current progress info
  getProgressInfo() {
    return {
      total: this.searchData?.limit || 0,
      completed: this.state.processedCount,
      current: this.currentJobDetails?.title || null,
      status: this.state.isApplicationInProgress ? "applying" :
        this.state.isRunning ? "searching" : "idle"
    };
  }
}