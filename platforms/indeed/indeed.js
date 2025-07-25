import BasePlatformAutomation from "../../shared/base/base-platform-automation.js";
import { UrlUtils, DomUtils } from "../../shared/utilities/index.js";
import {
  AIService,
  ApplicationTrackerService,
  UserService,
} from "../../services/index.js";
import FormHandler from "../../shared/indeed_glassdoors/form-handler.js";
// 

const INDEED_SELECTORS = {
  JOB_CARDS: [
    ".job_seen_beacon",
    '[data-testid="job-tile"]',
    ".jobsearch-SerpJobCard",
    ".slider_container .slider_item",
    ".job",
    "[data-jk]",
    ".result",
  ],
  JOB_TITLE: [
    ".jcs-JobTitle span[id^='jobTitle-']",
    ".jobTitle a span[title]",
    '[data-testid="job-title"] a span',
    "h2 a span[title]",
    ".jobTitle",
    '[data-testid="job-title"]',
    "a[data-jk] span",
    ".jobTitle-color-purple",
    ".jobTitle a",
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
    MAX_TIMEOUT: 300000,
    APPLICATION_TIMEOUT: 3 * 60 * 1000,
    REDIRECT_TIMEOUT: 8000,
  },
  PLAN_LIMITS: {
    FREE: 10,
    STARTER: 50,
    PRO: 500,
  },
  DEBUG: true,
  BRAND_COLOR: "#4a90e2",
  MAX_APPLICATION_TIME: 300000,
  RETRY_DELAYS: [2000, 5000, 10000],
};

export default class IndeedPlatform extends BasePlatformAutomation {
  constructor(config) {
    super(config);
    this.platform = "indeed";
    this.baseUrl = "https://www.indeed.com";

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
    this.cachedJobDescription = null;
    this.processedJobCards = new Set();
    this.healthCheckTimer = null;
    this.currentJobDetails = null;

    this.applicationState = {
      isApplicationInProgress: false,
      applicationStartTime: null,
      currentJobData: null,
      currentJobTabId: null,
      processedUrls: new Set(),
    };

    this.stuckDetectionTimeout = null;
    this.maxApplicationTime = INDEED_CONFIG.MAX_APPLICATION_TIME;

    this.healthCheckTimer = setInterval(() => this.checkHealth(), 30000);
    this.setupFormDetectionObserver();
  }

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
    return this.sessionApiHost || this.sessionContext?.apiHost || this.config.apiHost;
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
    return url
      .replace(/[?&](jk|tk|from|advn)=[^&]*/g, "")
      .replace(/[?&]+$/, "");
  }

  isIndeedJobPage(url) {
    return (
      /^https:\/\/(www\.)?indeed\.com\/(viewjob|job)/.test(url) ||
      /^https:\/\/smartapply\.indeed\.com\/beta\/indeedapply\/form/.test(url)
    );
  }

  isIndeedSearchPage(url) {
    return /^https:\/\/(www\.|[a-z]{2}\.)?indeed\.com\/jobs/.test(url);
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

  async initialize() {
    await super.initialize();

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

  getIndeedJobCards() {
    for (const selector of INDEED_SELECTORS.JOB_CARDS) {
      const cards = document.querySelectorAll(selector);
      if (cards.length > 0) {
        console.log(
          `Found ${cards.length} job cards using selector: ${selector}`
        );
        const visibleCards = Array.from(cards).filter((card) =>
          this.isElementVisible(card)
        );
        if (visibleCards.length > 0) {
          return visibleCards;
        }
      }
    }

    console.log("No job cards found with standard selectors, trying fallback");

    const fallbackCards = document.querySelectorAll(
      '[data-jk], [class*="job"], [id*="job"]'
    );
    return Array.from(fallbackCards).filter(
      (card) =>
        this.isElementVisible(card) && card.querySelector('a[href*="viewjob"]')
    );
  }

  getUnprocessedJobCards() {
    const allCards = this.getIndeedJobCards();

    return Array.from(allCards).filter((card) => {
      const cardId = this.getJobCardId(card);
      return !this.state.processedCards.has(cardId);
    });
  }

  getJobCardId(jobCard) {
    try {
      const dataJk = jobCard.getAttribute("data-jk");
      if (dataJk) return dataJk;

      const titleLink = jobCard.querySelector(
        'a[href*="viewjob?jk="], .jobTitle a, [data-testid="job-title"] a'
      );
      if (titleLink && titleLink.href) {
        const match = titleLink.href.match(/jk=([^&]+)/);
        if (match && match[1]) {
          return match[1];
        }
      }

      const anyLink = jobCard.querySelector('a[href*="jk="]');
      if (anyLink && anyLink.href) {
        const match = anyLink.href.match(/jk=([^&]+)/);
        if (match && match[1]) {
          return match[1];
        }
      }

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

  getJobUrlFromCard(card) {
    const selectors = [
      'a[href*="viewjob?jk="]',
      ".jobTitle a",
      '[data-testid="job-title"] a',
      "h2 a",
      "a[data-jk]",
      'a[href*="/viewjob/"]',
      'a[href*="indeed.com"]',
    ];

    for (const selector of selectors) {
      const link = card.querySelector(selector);
      if (link && link.href) {
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

  getCompanyFromCard(jobCard) {
    for (const selector of INDEED_SELECTORS.COMPANY_NAME) {
      const element = jobCard.querySelector(selector);
      if (element) {
        return element.textContent?.trim() || "";
      }
    }

    return "";
  }

  getLocationFromCard(jobCard) {
    for (const selector of INDEED_SELECTORS.LOCATION) {
      const element = jobCard.querySelector(selector);
      if (element) {
        return element.textContent?.trim() || "";
      }
    }

    return "";
  }

  getSalaryFromCard(jobCard) {
    for (const selector of INDEED_SELECTORS.SALARY) {
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
    if (this.state.lastClickedJobCard) {
      this.markJobCard(this.state.lastClickedJobCard, status);
    }
  }

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

  async searchNext() {
    try {
      this.log("Executing Indeed searchNext");

      if (this.state.isApplicationInProgress || this.state.pendingApplication) {
        this.log("Application in progress, checking status...");
        this.statusOverlay.addInfo(
          "Application in progress, waiting to complete..."
        );

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
          this.safeSendPortMessage({ type: "CHECK_APPLICATION_STATUS" });
          return;
        }
      }

      this.statusOverlay.addInfo("Searching for job cards...");

      if (this.isIndeedSearchPage(window.location.href)) {
        await this.processIndeedJobCards();
      } else if (window.location.href.includes("google.com/search")) {
        await super.searchNext();
      } else {
        this.statusOverlay.addWarning("Unknown page type for search");
        await this.waitForValidPage();
      }
    } catch (err) {
      console.error("Error in Indeed searchNext:", err);
      this.statusOverlay.addError("Error in search: " + err.message);
      this.resetApplicationStateOnError();

      setTimeout(() => {
        if (!this.state.isApplicationInProgress) {
          this.searchNext();
        }
      }, 5000);
    }
  }

  async processIndeedJobCards() {
    try {
      const jobCards = this.getIndeedJobCards();
      this.log(`Found ${jobCards.length} job cards on Indeed page`);

      if (jobCards.length === 0) {
        await this.handleNoJobCardsFound();
        return;
      }

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

  async findValidUnprocessedJobCard(jobCards) {
    for (const card of jobCards) {
      try {
        const cardId = this.getJobCardId(card);

        if (this.state.processedCards.has(cardId)) {
          continue;
        }

        const jobUrl = this.getJobUrlFromCard(card);
        if (!jobUrl) {
          this.log(`Skipping card ${cardId} - no valid URL found`);
          continue;
        }

        if (!this.isValidJobUrl(jobUrl)) {
          this.log(`Skipping card ${cardId} - invalid URL format: ${jobUrl}`);
          continue;
        }

        const normalizedUrl = this.normalizeUrlFully(jobUrl);

        if (this.isLinkProcessed(normalizedUrl)) {
          this.state.processedCards.add(cardId);
          this.log(`Skipping card ${cardId} - URL already processed`);
          continue;
        }

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

  isValidJobUrl(url) {
    if (!url || typeof url !== "string") return false;

    try {
      const urlObj = new URL(url);

      if (!urlObj.hostname.includes("indeed.com")) return false;

      if (!url.includes("viewjob") && !url.includes("jk=")) return false;

      if (url.includes("/apply/") || url.includes("smartapply")) return false;

      return true;
    } catch (error) {
      return false;
    }
  }

  async processIndeedJobCard(jobData) {
    const { card, url, cardId } = jobData;

    try {
      this.statusOverlay.addSuccess("Found Indeed job to apply: " + url);
      this.state.processedCards.add(cardId);

      if (this.state.isApplicationInProgress) {
        this.log("Application in progress, aborting new job processing");
        return;
      }

      const jobDetails = this.extractJobDetailsFromCard(card);

      this.markJobCard(card, "processing");

      this.state.isApplicationInProgress = true;
      this.state.applicationStartTime = Date.now();
      this.state.pendingApplication = true;
      this.state.formDetected = false;
      this.state.currentRedirectAttempts = 0;
      this.state.lastClickedJobCard = card;

      this.currentJobDetails = jobDetails;

      if (!this.applicationState.processedUrls) {
        this.applicationState.processedUrls = new Set();
      }
      this.applicationState.processedUrls.add(this.normalizeUrlFully(url));

      this.setStuckDetectionTimeout();

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

  async handleNoJobCardsFound() {
    this.statusOverlay.addInfo(
      "No job cards found, attempting to load more..."
    );

    window.scrollTo(0, document.body.scrollHeight);
    await this.wait(2000);

    const jobCardsAfterScroll = this.getIndeedJobCards();
    if (jobCardsAfterScroll.length > 0) {
      this.statusOverlay.addInfo("Found jobs after scrolling");
      return await this.processIndeedJobCards();
    }

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

      if (!this.state.isApplicationInProgress) {
        return this.searchNext();
      }
    } else {
      this.statusOverlay.addSuccess("All Indeed jobs processed!");
      this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
    }
  }

  async handleNoUnprocessedJobCards() {
    this.statusOverlay.addInfo("All visible job cards have been processed");
    await this.handleNoJobCardsFound();
  }

  async startApplicationProcess() {
    try {
      this.log("📝 Starting Indeed application process");
      this.statusOverlay.addInfo("Starting application process");

      if (!this.userProfile) {
        this.log("⚠️ No user profile available, attempting to fetch...");
        await this.fetchSendCvTaskData();
      }

      if (this.checkIndeedSubmissionSuccess()) {
        await this.handleAlreadyApplied();
        return;
      }

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

  async handleJobListingPage() {
    try {
      this.statusOverlay.addInfo(
        "Indeed job listing page detected - looking for Apply button"
      );

      this.cachedJobDescription = await this.extractIndeedJobDescription();

      const applyButton = await this.findIndeedApplyButton();
      if (!applyButton) {
        throw new Error("Cannot find Apply button on Indeed job listing page");
      }

      this.log("🖱️ Clicking Apply button");
      applyButton.click();

      await this.waitForIndeedApplicationPage();
      this.statusOverlay.addSuccess("Application page loaded successfully");

      await this.startApplicationProcess();
    } catch (error) {
      this.reportError(error, { phase: "jobListing" });
      this.handleApplicationError(error);
    }
  }

  async handleJobPage() {
    try {
      this.statusOverlay.addInfo("Processing Indeed job page");

      const isApplyPage = this.isOnApplyFormPage();
      this.log("Is on apply form page:", isApplyPage);

      if (isApplyPage) {
        this.statusOverlay.addInfo(
          "On Indeed application form page, starting application process"
        );

        if (!this.userProfile) {
          this.userProfile = await this.getProfileData();
        }

        if (this.userProfile) {
          this.statusOverlay.addInfo("Starting form completion process");
          this.state.isApplicationInProgress = true;
          this.state.applicationStartTime = Date.now();
          this.state.formDetected = true;

          const success = await this.handleApplyForm();

          this.state.isApplicationInProgress = false;
          this.state.applicationStartTime = null;
          this.state.formDetected = false;

          if (success) {
            this.statusOverlay.addSuccess("Application completed successfully");

            if (this.currentJobDetails) {
              this.trackApplication(this.currentJobDetails);
            }

            if (this.state.pendingApplication) {
              this.state.pendingApplication = false;
              this.statusOverlay.addInfo("Ready to process next job");
            }
          } else {
            this.statusOverlay.addError("Failed to complete application");

            if (this.state.pendingApplication) {
              this.state.pendingApplication = false;
            }
          }
        } else {
          this.statusOverlay.addError("No profile data available");
        }
      } else {
        this.statusOverlay.addInfo("Looking for Easy Apply button");

        let applyButton = await this.findIndeedApplyButton();

        if (applyButton) {
          this.statusOverlay.addInfo("Found apply button, clicking it");
          this.state.isApplicationInProgress = true;
          this.state.applicationStartTime = Date.now();
          this.state.pendingApplication = true;
          this.state.formDetected = false;
          this.state.currentRedirectAttempts = 0;

          applyButton.click();

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

      return await this.handleApplyForm();
    } catch (e) {
      this.log("Error in Indeed apply:", e);
      throw new Error(
        "Error during application process: " + this.errorToString(e)
      );
    }
  }

  async handleApplyForm() {
    try {
      await this.wait(1500);

      if (!this.formHandler) {
        this.statusOverlay.addError("Form handler not available");
        return false;
      }

      this.formHandler.jobDescription =
        this.cachedJobDescription || (await this.extractIndeedJobDescription());
      this.formHandler.userData = this.userProfile;

      this.statusOverlay.addInfo("Starting comprehensive form filling process");

      const success = await this.formHandler.fillCompleteForm();

      if (success) {
        this.statusOverlay.addSuccess("Application submitted successfully!");
        this.markLastJobCardIfAvailable("applied");
      } else {
        this.statusOverlay.addInfo(
          "Application process completed but success not confirmed"
        );
        this.markLastJobCardIfAvailable("error");
      }

      return success;
    } catch (error) {
      this.log("Error handling application form:", error);
      this.statusOverlay.addError("Form submission error: " + error.message);
      this.markLastJobCardIfAvailable("error");
      return false;
    }
  }

  async findIndeedApplyButton() {
    try {
      this.statusOverlay.addInfo("Looking for Indeed apply button...");

      for (const selector of INDEED_SELECTORS.APPLY_BUTTON) {
        const button = document.querySelector(selector);
        if (button && this.isElementVisible(button) && !button.disabled) {
          this.statusOverlay.addSuccess("✅ Found Easy Apply button");
          return button;
        }
      }

      for (const selector of INDEED_SELECTORS.EXTERNAL_APPLY) {
        const button = document.querySelector(selector);
        if (button && this.isElementVisible(button)) {
          this.statusOverlay.addWarning(
            "⚠️ Found External Apply button (redirects to company site)"
          );
          return null;
        }
      }

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

  isOnApplyFormPage() {
    const url = window.location.href;

    if (
      url.includes("smartapply.indeed.com/beta/indeedapply/form") ||
      url.includes("indeed.com/apply") ||
      url.includes("indeed.com/viewjob")
    ) {
      this.log("Detected Indeed application form page via URL");
      return true;
    }

    // Use FormHandler's form detection
    if (this.formHandler) {
      const formContainer = this.formHandler.findFormContainer();
      return formContainer !== null;
    }

    return false;
  }

  setupFormDetectionObserver() {
    try {
      this.formObserver = new MutationObserver((mutations) => {
        if (this.state.isApplicationInProgress || this.isOnApplyPage()) {
          // Use FormHandler for form detection
          if (this.formHandler) {
            const formContainer = this.formHandler.findFormContainer();
            const hasForm = formContainer !== null;

            if (hasForm && !this.state.formDetected) {
              this.log("Form detected by mutation observer");
              this.state.formDetected = true;

              setTimeout(() => {
                this.handleDetectedForm();
              }, 1000);
            }
          }
        }
      });

      this.formObserver.observe(document.documentElement, {
        childList: true,
        subtree: true,
      });

      this.log("Form detection observer set up");
    } catch (error) {
      this.log("Error setting up form observer:", error);
    }
  }

  isOnApplyPage() {
    const url = window.location.href;
    return (
      url.includes("smartapply.indeed.com") || url.includes("indeed.com/apply")
    );
  }

  async trackApplication(jobDetails) {
    try {
      if (!this.userProfile || !this.userId) {
        return;
      }

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

  extractJobIdFromUrl() {
    try {
      const url = window.location.href;
      const match = url.match(/jk=([^&]+)/);
      return match ? match[1] : null;
    } catch (error) {
      return null;
    }
  }

  async getProfileData() {
    try {
      if (this.userProfile) {
        return this.userProfile;
      }

      this.statusOverlay.addInfo("Fetching profile data");

      try {
        return new Promise((resolve, reject) => {
          chrome.runtime.sendMessage(
            { action: "getProfileData" },
            (response) => {
              if (chrome.runtime.lastError) {
                this.statusOverlay.addInfo(
                  "Error from background: " + chrome.runtime.lastError.message
                );
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

  getFallbackProfile() {
    this.statusOverlay.addInfo("Using fallback profile data");
    return this.userProfile;
  }

  checkIndeedSubmissionSuccess() {
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

    // Use FormHandler's success detection
    if (this.formHandler) {
      return this.formHandler.isSuccessPage();
    }

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

  async checkIndeedAlreadyApplied() {
    try {
      const url = window.location.href;

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

  isOnIndeedApplyFormPage() {
    const url = window.location.href;

    if (
      url.includes("smartapply.indeed.com/beta/indeedapply/form") ||
      url.includes("indeed.com/apply") ||
      url.includes("indeed.com/viewjob")
    ) {
      return true;
    }

    // Use FormHandler for form detection
    if (this.formHandler) {
      const formContainer = this.formHandler.findFormContainer();
      return formContainer !== null;
    }

    return false;
  }

  async waitForIndeedApplicationPage(timeout = 10000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (this.isIndeedApplicationPage(window.location.href)) {
        // Use FormHandler to check for form
        if (this.formHandler) {
          const form = this.formHandler.findFormContainer();
          if (form) {
            return true;
          }
        }
      }
      await this.wait(500);
    }

    throw new Error("Timeout waiting for Indeed application page to load");
  }

  async checkIfAlreadyApplied() {
    try {
      const isSmartApplyPage = window.location.href.includes(
        "smartapply.indeed.com/beta/indeedapply/form"
      );

      if (!isSmartApplyPage) {
        return false;
      }

      const pageText = document.body.innerText;
      const alreadyAppliedText = "You've applied to this job";

      if (pageText.includes(alreadyAppliedText)) {
        this.statusOverlay.addInfo(
          "Found 'You've applied to this job' message - already applied"
        );

        this.state.isApplicationInProgress = false;
        this.state.applicationStartTime = null;
        this.state.pendingApplication = false;
        this.state.formDetected = false;

        return true;
      }

      return false;
    } catch (error) {
      console.error("Error checking if already applied:", error);
      return false;
    }
  }

  async handleDetectedForm() {
    try {
      const alreadyApplied = await this.checkIfAlreadyApplied();
      if (alreadyApplied) {
        this.statusOverlay.addInfo(
          "Job already applied to, moving to next job"
        );
        if (this.state.isRunning) {
          setTimeout(() => this.processNextJob(), 2000);
        }
        return;
      }

      this.statusOverlay.addInfo("Form detected, starting application process");

      if (!this.userProfile) {
        this.userProfile = await this.getProfileData();
      }

      if (this.userProfile) {
        const success = await this.handleApplyForm();

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

        this.state.isApplicationInProgress = false;
        this.state.applicationStartTime = null;
        this.state.pendingApplication = false;
        this.state.formDetected = false;
        this.state.currentRedirectAttempts = 0;

        if (this.state.isRunning) {
          this.statusOverlay.addInfo("Moving to next job...");
          setTimeout(() => this.processNextJob(), 2000);
        }
      } else {
        this.statusOverlay.addError(
          "No profile data available for form filling"
        );
        this.state.isApplicationInProgress = false;
        this.state.applicationStartTime = null;
        this.state.pendingApplication = false;
        this.state.formDetected = false;

        if (this.state.isRunning) {
          setTimeout(() => this.processNextJob(), 2000);
        }
      }
    } catch (error) {
      this.log("Error handling detected form:", error);
      this.statusOverlay.addError("Error handling form: " + error.message);

      this.state.isApplicationInProgress = false;
      this.state.applicationStartTime = null;
      this.state.pendingApplication = false;
      this.state.formDetected = false;

      if (this.state.isRunning) {
        setTimeout(() => this.processNextJob(), 2000);
      }
    }
  }

  checkForRedirectOrForm() {
    if (this.state.currentRedirectAttempts >= this.state.maxRedirectAttempts) {
      this.statusOverlay.addError("Max redirect attempts reached, giving up");

      this.state.isApplicationInProgress = false;
      this.state.applicationStartTime = null;
      this.state.pendingApplication = false;
      this.state.formDetected = false;

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

    const isIndeedFormPage = currentUrl.includes(
      "smartapply.indeed.com/beta/indeedapply/form"
    );

    if (isIndeedFormPage) {
      const pageText = document.body.innerText;
      if (pageText.includes("You've applied to this job")) {
        this.statusOverlay.addInfo(
          "Found 'You've applied to this job' message - already applied"
        );

        this.state.isApplicationInProgress = false;
        this.state.applicationStartTime = null;
        this.state.pendingApplication = false;
        this.state.formDetected = false;

        if (this.state.isRunning) {
          setTimeout(() => this.processNextJob(), 2000);
        }

        return;
      }
    }

    // Use FormHandler for form detection
    let hasFormElements = false;
    if (this.formHandler) {
      const formContainer = this.formHandler.findFormContainer();
      hasFormElements = formContainer !== null;
    }

    if (isIndeedFormPage || hasFormElements) {
      this.statusOverlay.addInfo(
        "Successfully redirected to form page or form detected"
      );
      this.state.formDetected = true;

      setTimeout(async () => {
        await this.handleDetectedForm();
      }, 1000);
    } else {
      this.statusOverlay.addInfo("No form detected yet, waiting...");

      setTimeout(() => {
        this.checkForRedirectOrForm();
      }, INDEED_CONFIG.TIMEOUTS.STANDARD);
    }
  }

  applySearchFilters() {
    try {
      this.statusOverlay.addInfo("Applying search filters...");

      const easyApplyFilter = document.querySelector("#filter-epiccapplication");
      if (easyApplyFilter && !easyApplyFilter.checked) {
        this.statusOverlay.addInfo("Selecting Easy Apply filter");
        easyApplyFilter.click();
      }

      setTimeout(() => {
        this.statusOverlay.addInfo("Filters applied, checking for job results");

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

        if (!this.state.isRunning) {
          this.startAutomation();
        }
      }, 2000);
    } catch (error) {
      this.log("Error applying search filters:", error);
      this.statusOverlay.addError(error);

      this.state.ready = true;
      setTimeout(() => {
        if (!this.state.isRunning) {
          this.startAutomation();
        }
      }, 2000);
    }
  }

  checkIfJobsFound() {
    try {
      const searchHeaderSelectors = [
        ".jobsearch-JobCountAndSortPane-jobCount",
        ".count",
      ];

      let searchHeader = null;
      for (const selector of searchHeaderSelectors) {
        searchHeader = document.querySelector(selector);
        if (searchHeader) break;
      }

      if (!searchHeader) {
        this.statusOverlay.addInfo("Could not find search results header");
        return { jobsFound: true };
      }

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

      const jobCards = this.getIndeedJobCards();
      if (jobCards.length === 0) {
        this.statusOverlay.addInfo("No job cards found in search results");
        return { jobsFound: false, jobCount: 0 };
      }

      return { jobsFound: true };
    } catch (error) {
      this.log("Error checking if jobs found:", error);
      return { jobsFound: true };
    }
  }

  async startAutomation() {
    try {
      if (this.state.isRunning) {
        this.statusOverlay.addInfo("Automation already running");
        return;
      }

      this.statusOverlay.addInfo("Starting automation");

      const { jobsFound, jobCount, searchQuery } = this.checkIfJobsFound();

      if (!jobsFound) {
        this.statusOverlay.addInfo(
          `No jobs found for search: ${searchQuery || "your search criteria"}`
        );
        this.statusOverlay.updateStatus("completed");
        return;
      }

      this.statusOverlay.updateStatus("running");

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

      await this.processNextJob();
    } catch (error) {
      this.log("Error starting automation:", error);
      this.statusOverlay.addError(
        "Failed to start automation: " + error.message
      );
      this.state.isRunning = false;
    }
  }

  async processNextJob() {
    try {
      if (!this.state.isRunning) {
        this.statusOverlay.addInfo("Automation stopped");
        return;
      }

      if (this.state.isApplicationInProgress || this.state.pendingApplication) {
        this.statusOverlay.addInfo(
          "Application in progress, waiting before processing next job"
        );
        setTimeout(() => this.processNextJob(), 5000);
        return;
      }

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

      const jobCards = this.getUnprocessedJobCards();

      if (jobCards.length === 0) {
        if (await this.goToNextPage()) {
          setTimeout(() => this.processNextJob(), 3000);
        } else {
          this.statusOverlay.addInfo("No more jobs to process");
          this.statusOverlay.updateStatus("completed");
          this.state.isRunning = false;
        }
        return;
      }

      const jobCard = jobCards[0];
      this.state.lastClickedJobCard = jobCard;

      this.markJobCard(jobCard, "processing");

      this.statusOverlay.addInfo("Clicking job card to show details");
      jobCard.querySelector("a.jcs-JobTitle")?.click();

      await this.wait(INDEED_CONFIG.TIMEOUTS.STANDARD);

      this.handlePopups();

      const jobDetails = this.extractJobDetailsFromCard(jobCard);

      this.currentJobDetails = jobDetails;

      const applyButton = await this.findIndeedApplyButton();

      if (!applyButton) {
        this.statusOverlay.addInfo("No Easy Apply button found, skipping job");
        this.markJobCard(jobCard, "skipped");
        this.state.processedCards.add(this.getJobCardId(jobCard));
        this.state.processedCount++;

        setTimeout(() => this.processNextJob(), 1000);
        return;
      }

      this.statusOverlay.addInfo(
        "Found Easy Apply button, starting application"
      );

      this.state.isApplicationInProgress = true;
      this.state.applicationStartTime = Date.now();
      this.state.pendingApplication = true;
      this.state.formDetected = false;
      this.state.currentRedirectAttempts = 0;

      this.state.processedCards.add(this.getJobCardId(jobCard));

      applyButton.click();

      this.checkForRedirectOrForm();
    } catch (error) {
      this.log("Error processing job:", error);
      this.statusOverlay.addError("Error processing job: " + error.message);

      this.state.isApplicationInProgress = false;
      this.state.applicationStartTime = null;
      this.state.pendingApplication = false;
      this.state.formDetected = false;

      setTimeout(() => this.processNextJob(), 3000);
    }
  }

  async goToNextPage() {
    try {
      const nextButton = document.querySelector(INDEED_SELECTORS.NEXT_PAGE[0]);
      if (nextButton && this.isElementVisible(nextButton)) {
        this.statusOverlay.addInfo("Moving to next page of results");
        nextButton.click();

        await this.wait(3000);

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

  isExternalApplication() {
    for (const selector of INDEED_SELECTORS.EXTERNAL_APPLY) {
      const element = document.querySelector(selector);
      if (element && this.isElementVisible(element)) {
        return true;
      }
    }

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

  checkHealth() {
    try {
      if (
        this.state.isApplicationInProgress &&
        this.state.applicationStartTime
      ) {
        const now = Date.now();
        const applicationTime = now - this.state.applicationStartTime;

        if (applicationTime > INDEED_CONFIG.TIMEOUTS.APPLICATION_TIMEOUT) {
          this.log("Application appears to be stuck, resetting state");

          this.markLastJobCardIfAvailable("error");

          this.state.isApplicationInProgress = false;
          this.state.applicationStartTime = null;
          this.state.pendingApplication = false;
          this.state.formDetected = false;

          this.statusOverlay.addWarning(
            "Application timeout detected - resetting state"
          );
          this.statusOverlay.updateStatus("error");

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
            this.state.isApplicationInProgress = false;
            this.state.applicationStartTime = null;
            this.state.pendingApplication = false;
            this.state.formDetected = false;
          }

          this.state.lastActivity = now;
          this.processNextJob();
        }
      }
    } catch (error) {
      this.log("Error in health check:", error);
    }
  }

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

  handleJobTaskError(error, url, card) {
    console.error("Error processing Indeed job:", error);
    this.statusOverlay.addError("Error processing job: " + error.message);

    this.state.isApplicationInProgress = false;
    this.state.applicationStartTime = null;
    this.state.pendingApplication = false;
    this.state.formDetected = false;

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

    this.resetApplicationStateOnError();
  }

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

    if (this.stuckDetectionTimeout) {
      clearTimeout(this.stuckDetectionTimeout);
      this.stuckDetectionTimeout = null;
    }

    this.statusOverlay.addInfo("Application state reset - ready for next job");
  }

  setStuckDetectionTimeout() {
    if (this.stuckDetectionTimeout) {
      clearTimeout(this.stuckDetectionTimeout);
    }

    this.stuckDetectionTimeout = setTimeout(() => {
      this.log("Stuck detection triggered - application taking too long");
      this.statusOverlay.addWarning(
        "Application timeout detected, moving to next job"
      );
      this.resetApplicationStateOnError();

      setTimeout(() => {
        if (!this.state.isApplicationInProgress) {
          this.searchNext();
        }
      }, 2000);
    }, this.maxApplicationTime);
  }

  // Keep element visibility check as it's used throughout the platform
  isElementVisible(element) {
    if (!element) return false;
    try {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        rect.height > 0 &&
        rect.width > 0
      );
    } catch (error) {
      return false;
    }
  }

  // Utility method for waiting - used by platform-specific logic
  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

      if (
        url.includes("google.com/search") ||
        this.isValidJobPage(url) ||
        this.isApplicationPage(url)
      ) {
        await this.detectPageTypeAndStart();
        return;
      }

      await this.wait(1000);
    }

    throw new Error("Timeout waiting for valid page");
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

  cleanup() {
    super.cleanup();

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

  async performJobSearch() {
    return await this.safeExecute(async () => {
      const state = await this.getCurrentState();
      const preferences = state.preferences || {};

      const searchParams = new URLSearchParams();

      const searchQuery = Array.isArray(preferences.positions)
        ? preferences.positions[0]
        : "";
      searchParams.append("q", searchQuery);

      searchParams.append("l", preferences.location || "Lagos");

      let filterString = "0kf:";

      const jobTypeMap = {
        "Full-time": "4HKF7",
        "Part-time": "CPAHG",
        Contract: "5QWDV",
        Temporary: "CF3CP",
        Internship: "VDTG7",
      };

      if (
        Array.isArray(preferences.jobType) &&
        preferences.jobType.length > 0
      ) {
        const jobTypeFilters = preferences.jobType
          .filter((type) => jobTypeMap[type])
          .map((type) => jobTypeMap[type]);

        if (jobTypeFilters.length > 0) {
          filterString += `attr(${jobTypeFilters.join("|")},OR)`;
        }
      }

      filterString += "attr(DSQF7);";
      searchParams.append("sc", filterString);

      if (preferences.datePosted && preferences.datePosted.value) {
        searchParams.append("fromage", preferences.datePosted.value);
      }

      searchParams.append("from", "searchOnDesktopSerp");

      const searchUrl = `${this.getJobURL(
        state.userDetails.country
      )}/jobs?${searchParams.toString()}`;

      await this.stateManager.updateState({
        pendingSearch: true,
        lastActionTime: new Date().toISOString(),
      });

      window.location.href = searchUrl;
    }, "Error performing job search");
  }

  async getCurrentState() {
    return await this.safeExecute(async () => {
      const state = await this.stateManager.getState();
      if (!state?.userId) {
        throw new Error("No valid state found - please reinitialize");
      }
      return state;
    }, "Error getting current state");
  }

  async startAutomationFromSearch() {
    try {
      const canApply = await this.userService.canApplyMore();
      if (!canApply) {
        const userState = await this.userService.getUserState();
        this.sendStatusUpdate(
          "error",
          `Cannot apply: ${userState.userRole === "credit"
            ? `Insufficient credits (${userState.credits} remaining)`
            : `Daily limit reached`
          }`
        );
        return "limit_reached";
      }

      console.log("started automation");
      this.isRunning = true;
      this.jobsToApply = await this.getIndeedJobCards();

      if (this.jobsToApply.length === 0) {
        throw new Error("No jobs found to process");
      }

      const remainingApplications = await this.userService.getRemainingApplications();
      const maxJobs = Math.min(remainingApplications, this.jobsToApply.length);

      console.log(
        `Processing ${maxJobs} out of ${this.jobsToApply.length} jobs found`
      );

      for (let i = 0; i < maxJobs && this.isRunning; i++) {
        const job = this.jobsToApply[i];
        this.currentJobIndex = i;

        try {
          await this.processJobFromSearch(job);

          let completed = false;
          const startTime = Date.now();

          while (!completed && Date.now() - startTime < 300000) {
            const state = await this.getCurrentState();
            if (!state.pendingApplication) {
              completed = true;
              break;
            }
            await new Promise((resolve) => setTimeout(resolve, 2000));
          }

          if (!completed) {
            throw new Error("Application timeout");
          }

          if (i < maxJobs - 1) {
            const minDelay = 6000;
            const maxDelay = 8000;
            await new Promise((resolve) =>
              setTimeout(
                resolve,
                Math.floor(Math.random() * (maxDelay - minDelay) + minDelay)
              )
            );
          }
        } catch (error) {
          console.error(`Error processing job ${job.title}:`, error);
          await this.stateManager.updateState({ pendingApplication: false });

          if (
            error.message.includes("limit reached") ||
            error.message.includes("session expired")
          ) {
            throw error;
          }
          continue;
        }
      }
    } catch (error) {
      console.error("Error in automation:", error);
      this.sendStatusUpdate("error", error.message);
      throw error;
    } finally {
      this.isRunning = false;
    }
  }

  async processJobFromSearch(job) {
    let retryCount = 0;
    const maxRetries = 2;

    while (retryCount <= maxRetries) {
      try {
        const canApply = await this.userService.canApplyMore();
        if (!canApply) {
          throw new Error("Application limit reached");
        }

        if (this.currentJobIndex > 0) {
          const delay = Math.floor(Math.random() * (8000 - 6000) + 6000);
          await this.wait(delay);
        }

        const jobLink = job.element?.querySelector(".jcs-JobTitle") || job.querySelector?.(".jcs-JobTitle");
        if (!jobLink) {
          throw new Error("Job link not found");
        }

        jobLink.click();
        await this.wait(2000);

        await this.handlePopups();

        const applyButton = await this.findIndeedApplyButton();
        if (!applyButton) {
          throw new Error("Apply button not found");
        }

        if (this.isExternalApplication()) {
          console.log("Skipping external application");
          return;
        }

        await this.stateManager.updateState({
          currentJobIndex: this.currentJobIndex + 1,
          lastActionTime: new Date().toISOString(),
          currentJob: {
            id: job.id,
            title: job.title,
            company: job.company,
            location: job.location,
            url: job.url,
            description: job.description,
          },
          pendingApplication: true,
        });

        applyButton.click();
        await this.wait(2000);

        return;
      } catch (error) {
        console.error(`Attempt ${retryCount + 1} failed:`, error);
        retryCount++;

        if (
          error.message.includes("limit reached") ||
          error.message.includes("session expired")
        ) {
          throw error;
        }

        if (retryCount > maxRetries) {
          throw error;
        }

        await this.wait(3000 * retryCount);
      }
    }
  }

  async getJobURL(country) {
    const countryDomains = {
      US: "https://www.indeed.com",
      UK: "https://uk.indeed.com",
      CA: "https://ca.indeed.com",
      AU: "https://au.indeed.com"
    };
    return countryDomains[country] || "https://www.indeed.com";
  }

  async safeExecute(operation, errorMessage) {
    try {
      return await operation();
    } catch (error) {
      console.error(errorMessage, error);
      return null;
    }
  }

  sendStatusUpdate(status, data) {
    chrome.runtime.sendMessage({
      action: "statusUpdate",
      status,
      data,
      timestamp: new Date().toISOString(),
    });
  }
}