// platforms/ziprecruiter/ziprecruiter.js
import BasePlatformAutomation from "../../shared/base/base-platform-automation.js";
import { UrlUtils, DomUtils } from "../../shared/utilities/index.js";
import {
  AIService,
  ApplicationTrackerService,
  UserService,
} from "../../services/index.js";
import FormHandler from "../../shared/ziprecruiter/form-handler.js";
import { AI_BASE_URL } from "../../services/constants.js";

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

    this.healthCheckTimer = setInterval(() => this.checkHealth(), 30000);
    this.setupFormDetectionObserver();
  }

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

  async initialize() {
    await super.initialize();

    try {
      this.formHandler = new FormHandler({
        enableDebug: true,
        logger: (message) => this.statusOverlay.addInfo(message),
        host: this.getApiHost(),
        userData: this.userProfile || {},
        jobDescription: "",
        platform: "ziprecruiter",
      });

      this.statusOverlay.addSuccess("ZipRecruiter components initialized");
    } catch (error) {
      this.log("⚠️ Could not load ZipRecruiter handlers:", error);
      this.statusOverlay.addWarning("ZipRecruiter handlers not available");
    }

    this.state.initialized = true;
  }

  async start(params = {}) {
    try {
      this.isRunning = true;
      this.state.isRunning = true;
      this.log("🚀 Starting ZipRecruiter automation");
      this.statusOverlay.addInfo("Starting ZipRecruiter automation");

      if (!this.userProfile && this.userId) {
        try {
          this.userProfile = await this.userService.getUserDetails();
          this.statusOverlay.addSuccess("User profile loaded");

          if (this.formHandler && this.userProfile) {
            this.formHandler.userData = this.userProfile;
          }
        } catch (error) {
          this.statusOverlay.addWarning("Failed to load user profile");
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
    } else if (this.isZipRecruiterApplicationPage(url)) {
      this.statusOverlay.addInfo("ZipRecruiter application page detected");
      await this.startApplicationProcess();
    } else if (this.isZipRecruiterJobPage(url)) {
      this.statusOverlay.addInfo("ZipRecruiter job page detected");
      await this.handleJobListingPage();
    } else if (this.isZipRecruiterSearchPage(url)) {
      this.statusOverlay.addInfo("ZipRecruiter search page detected");
      await this.startJobSearchProcess();
    } else {
      this.log("❓ Unknown page type, waiting for navigation");
      await this.waitForValidPage();
    }
  }

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
      this.statusOverlay.addInfo("Starting job search on ZipRecruiter results page");
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

      this.statusOverlay.addSuccess("Search initialization complete");
      setTimeout(() => this.searchNext(), 1000);
    } catch (error) {
      this.statusOverlay.addError("Error processing search task data: " + error.message);
    }
  }

  async searchNext() {
    try {
      if (this.state.isApplicationInProgress) {
        this.log("Application in progress, checking status...");
        this.statusOverlay.addInfo("Application in progress, waiting...");

        const now = Date.now();
        const applicationDuration = now - (this.state.applicationStartTime || now);

        if (applicationDuration > ZIPRECRUITER_CONFIG.TIMEOUTS.APPLICATION_TIMEOUT) {
          this.log("Application timeout detected, resetting...");
          this.statusOverlay.addWarning("Application timeout detected, resetting...");
          this.resetApplicationStateOnError();
        } else {
          this.safeSendPortMessage({ type: "CHECK_APPLICATION_STATUS" });
          return;
        }
      }

      this.statusOverlay.addInfo("Searching for job cards...");

      if (this.isZipRecruiterSearchPage(window.location.href)) {
        await this.processZipRecruiterJobCards();
      } else if (window.location.href.includes("google.com/search")) {
        await super.searchNext();
      } else {
        this.statusOverlay.addWarning("Unknown page type for search");
        await this.waitForValidPage();
      }
    } catch (err) {
      this.statusOverlay.addError("Error in search: " + err.message);
      this.resetApplicationStateOnError();
      setTimeout(() => {
        if (!this.state.isApplicationInProgress) {
          this.searchNext();
        }
      }, 5000);
    }
  }

  async processZipRecruiterJobCards() {
    try {
      const jobCards = this.getZipRecruiterJobCards();
      this.log(`Found ${jobCards.length} job cards on ZipRecruiter page`);

      if (jobCards.length === 0) {
        await this.handleNoJobCardsFound();
        return;
      }

      const unprocessedCard = await this.findValidUnprocessedJobCard(jobCards);

      if (unprocessedCard) {
        await this.processZipRecruiterJobCard(unprocessedCard);
      } else {
        await this.handleNoUnprocessedJobCards();
      }
    } catch (error) {
      this.statusOverlay.addError("Error processing job cards: " + error.message);
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

  async processZipRecruiterJobCard(jobData) {
    const { card, url, cardId } = jobData;

    try {
      this.statusOverlay.addSuccess("Found ZipRecruiter job to apply: " + url);
      this.state.processedCards.add(cardId);

      if (this.state.isApplicationInProgress) {
        return;
      }

      const canApply = await this.userService.canApplyMore();
      if (!canApply) {
        this.statusOverlay.addWarning("Application limit reached");
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

  async handleNoJobCardsFound() {
    this.statusOverlay.addInfo("No job cards found, attempting to load more...");

    window.scrollTo(0, document.body.scrollHeight);
    await this.wait(2000);

    const jobCardsAfterScroll = this.getZipRecruiterJobCards();
    if (jobCardsAfterScroll.length > 0) {
      this.statusOverlay.addInfo("Found jobs after scrolling");
      return await this.processZipRecruiterJobCards();
    }

    const nextButton = document.querySelector(
      ZIPRECRUITER_SELECTORS.NEXT_PAGE_BUTTON[0]
    );

    if (nextButton && this.isElementVisible(nextButton) && !nextButton.disabled) {
      this.statusOverlay.addInfo('Clicking "Next Page" button');
      nextButton.click();
      await this.wait(3000);

      if (!this.state.isApplicationInProgress) {
        return this.searchNext();
      }
    } else {
      this.statusOverlay.addSuccess("All ZipRecruiter jobs processed!");
      this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
    }
  }

  async startApplicationProcess() {
    try {
      this.log("📝 Starting ZipRecruiter application process");
      this.statusOverlay.addInfo("Starting application process");

      if (!this.userProfile) {
        await this.fetchSendCvTaskData();
      }

      if (this.checkApplicationSuccess()) {
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
      this.statusOverlay.addInfo("ZipRecruiter job listing page detected");

      this.cachedJobDescription = await this.extractZipRecruiterJobDescription();

      const applyButton = await this.findZipRecruiterApplyButton();
      if (!applyButton) {
        throw new Error("Cannot find Apply button on ZipRecruiter job listing page");
      }

      applyButton.click();
      await this.waitForZipRecruiterApplicationPage();
      this.statusOverlay.addSuccess("Application page loaded successfully");

      await this.startApplicationProcess();
    } catch (error) {
      this.reportError(error, { phase: "jobListing" });
      this.handleApplicationError(error);
    }
  }

  async apply() {
    try {
      this.statusOverlay.addInfo("Starting ZipRecruiter application process");
      this.statusOverlay.updateStatus("applying");

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
        this.statusOverlay.addError("Form handler not available");
        return false;
      }

      this.formHandler.jobDescription =
        this.cachedJobDescription || (await this.extractZipRecruiterJobDescription());
      this.formHandler.userData = this.userProfile;

      this.statusOverlay.addInfo("Starting comprehensive form filling process");

      const success = await this.formHandler.fillCompleteForm();

      if (success) {
        this.statusOverlay.addSuccess("Application submitted successfully!");
        this.markLastJobCardIfAvailable("applied");
        await this.trackApplication(this.currentJobDetails);
      } else {
        this.statusOverlay.addInfo("Application process completed but success not confirmed");
      }

      return success;
    } catch (error) {
      this.statusOverlay.addError("Form submission error: " + error.message);
      this.markLastJobCardIfAvailable("error");
      return false;
    }
  }

  async findZipRecruiterApplyButton() {
    try {
      for (const selector of ZIPRECRUITER_SELECTORS.APPLY_BUTTON) {
        const button = document.querySelector(selector);
        if (button && this.isElementVisible(button) && !button.disabled) {
          this.statusOverlay.addSuccess("✅ Found Apply button");
          return button;
        }
      }

      const allButtons = document.querySelectorAll("button, a");
      for (const button of allButtons) {
        if (
          button.textContent.toLowerCase().includes("apply") &&
          this.isElementVisible(button) &&
          !button.disabled
        ) {
          return button;
        }
      }

      this.statusOverlay.addWarning("❌ No apply button found");
      return null;
    } catch (error) {
      this.statusOverlay.addError("Error finding apply button: " + error.message);
      return null;
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
      this.statusOverlay.addInfo("Extracting job details...");

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

  extractJobIdFromUrl() {
    try {
      const url = window.location.href;
      const match = url.match(/\/job\/([^\/\?]+)/);
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
                this.statusOverlay.addInfo("Error from background: " + chrome.runtime.lastError.message);
                resolve(this.getFallbackProfile());
              } else if (response && response.success && response.data) {
                this.statusOverlay.addInfo("Got profile data from background script");
                resolve(response.data);
              } else {
                this.statusOverlay.addInfo("No valid profile data in response, using fallback");
                resolve(this.getFallbackProfile());
              }
            }
          );
        });
      } catch (err) {
        this.statusOverlay.addInfo("Error requesting profile data: " + err.message);
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

  checkApplicationSuccess() {
    const url = window.location.href;
    if (url.includes("success") || url.includes("confirmation") || url.includes("applied")) {
      this.statusOverlay.addSuccess("URL indicates success - application submitted");
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
        this.statusOverlay.addSuccess("Success message found - application submitted");
        return true;
      }
    }

    const pageText = document.body.innerText.toLowerCase();
    return pageText.includes("application submitted") ||
      pageText.includes("successfully applied") ||
      pageText.includes("thank you for applying") ||
      pageText.includes("application complete");
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

  async checkZipRecruiterAlreadyApplied() {
    try {
      const url = window.location.href;

      if (url.includes("ziprecruiter.com")) {
        const pageText = document.body.innerText;
        const alreadyAppliedText = "You've applied to this job";

        if (pageText.includes(alreadyAppliedText)) {
          this.statusOverlay.addInfo("Found 'You've applied to this job' message - already applied");
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
          this.statusOverlay.addInfo("Found applied indicator - already applied");
          return true;
        }
      }

      return false;
    } catch (error) {
      return false;
    }
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

  async handleDetectedForm() {
    try {
      const alreadyApplied = await this.checkZipRecruiterAlreadyApplied();
      if (alreadyApplied) {
        this.statusOverlay.addInfo("Job already applied to, moving to next job");
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
        this.state.formDetected = false;

        if (this.state.isRunning) {
          this.statusOverlay.addInfo("Moving to next job...");
          setTimeout(() => this.processNextJob(), 2000);
        }
      } else {
        this.statusOverlay.addError("No profile data available for form filling");
        this.state.isApplicationInProgress = false;
        this.state.applicationStartTime = null;
        this.state.formDetected = false;

        if (this.state.isRunning) {
          setTimeout(() => this.processNextJob(), 2000);
        }
      }
    } catch (error) {
      this.statusOverlay.addError("Error handling form: " + error.message);

      this.state.isApplicationInProgress = false;
      this.state.applicationStartTime = null;
      this.state.formDetected = false;

      if (this.state.isRunning) {
        setTimeout(() => this.processNextJob(), 2000);
      }
    }
  }

  checkHealth() {
    try {
      if (this.state.isApplicationInProgress && this.state.applicationStartTime) {
        const now = Date.now();
        const applicationTime = now - this.state.applicationStartTime;

        if (applicationTime > ZIPRECRUITER_CONFIG.TIMEOUTS.APPLICATION_TIMEOUT) {
          this.log("Application appears to be stuck, resetting state");
          this.markLastJobCardIfAvailable("error");

          this.state.isApplicationInProgress = false;
          this.state.applicationStartTime = null;
          this.state.formDetected = false;

          this.statusOverlay.addWarning("Application timeout detected - resetting state");
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
    if (data && data.active === false && this.state.isApplicationInProgress) {
      this.log("⚠️ State mismatch detected! Resetting application progress flag");
      this.state.isApplicationInProgress = false;
      this.state.applicationStartTime = null;
      this.statusOverlay.addWarning("Detected state mismatch - resetting flags");
      setTimeout(() => this.searchNext(), 1000);
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
        this.searchNext();
      }
    }, 1000);
  }

  async fetchSendCvTaskData() {
    if (this.userProfile && this.hasSessionContext) {
      return;
    }

    this.statusOverlay.addInfo("Fetching CV task data...");

    const success = this.safeSendPortMessage({ type: "GET_SEND_CV_TASK" });
    if (!success) {
      throw new Error("Failed to request send CV task data");
    }
  }

  processSendCvTaskData(data) {
    try {
      if (data?.profile && !this.userProfile) {
        this.userProfile = data.profile;
      }

      if (this.formHandler && this.userProfile) {
        this.formHandler.userData = this.userProfile;
      }

      this.statusOverlay.addSuccess("Apply initialization complete");
    } catch (error) {
      this.statusOverlay.addError("Error processing CV data: " + error.message);
    }
  }

  async handleAlreadyApplied() {
    const jobId = UrlUtils.extractJobId(window.location.href, "ziprecruiter");
    const jobDetails = await this.extractZipRecruiterJobDescription();

    this.safeSendPortMessage({
      type: "SEND_CV_TASK_DONE",
      data: {
        jobId: jobId,
        title: jobDetails.title || "Job on ZipRecruiter",
        company: jobDetails.company || "Company on ZipRecruiter",
        location: jobDetails.location || "Not specified",
        jobUrl: window.location.href,
        platform: "ziprecruiter",
      },
    });

    this.state.isApplicationInProgress = false;
    this.statusOverlay.addSuccess("Application completed successfully");
  }

  handleJobTaskError(error, url, card) {
    this.statusOverlay.addError("Error processing job: " + error.message);

    this.state.isApplicationInProgress = false;
    this.state.applicationStartTime = null;
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

    this.resetApplicationStateOnError();
  }

  resetApplicationStateOnError() {
    this.state.isApplicationInProgress = false;
    this.state.applicationStartTime = null;
    this.state.formDetected = false;
    this.state.lastProcessedCard = null;

    this.applicationState.isApplicationInProgress = false;
    this.applicationState.applicationStartTime = null;
    this.applicationState.currentJobData = null;

    this.statusOverlay.addInfo("Application state reset - ready for next job");
  }

  markLastJobCardIfAvailable(status) {
    if (this.state.lastProcessedCard) {
      this.markJobCard(this.state.lastProcessedCard, status);
    }
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

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async waitForValidPage(timeout = 30000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const url = window.location.href;

      if (url.includes("google.com/search") || this.isValidJobPage(url) || this.isApplicationPage(url)) {
        await this.detectPageTypeAndStart();
        return;
      }

      await this.sleep(1000);
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
        } else {
          this.userProfile = { ...this.userProfile, ...sessionContext.userProfile };
        }
      }

      if (!this.userProfile && this.userId) {
        try {
          this.userProfile = await this.userService.getUserDetails();
        } catch (error) {
          this.statusOverlay?.addError("Failed to fetch user profile: " + error.message);
        }
      }

      if (this.userId && (!this.userService || this.userService.userId !== this.userId)) {
        this.applicationTracker = new ApplicationTrackerService({ userId: this.userId });
        this.userService = new UserService({ userId: this.userId });
      }

      if (sessionContext.apiHost) {
        this.sessionApiHost = sessionContext.apiHost;
      }

      if (this.formHandler && this.userProfile) {
        this.formHandler.userData = this.userProfile;
      }
    } catch (error) {
      this.statusOverlay?.addError("❌ Error setting session context: " + error.message);
    }
  }

  cleanup() {
    super.cleanup();

    this.state.processedCards.clear();
    this.cachedJobDescription = null;
    this.currentJobDetails = null;

    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    if (this.formObserver) {
      this.formObserver.disconnect();
      this.formObserver = null;
    }

    this.resetApplicationStateOnError();
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
              platform: "ziprecruiter",
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
      sendResponse({ success: false, message: error.message });
    }

    return true;
  }

  errorToString(e) {
    if (!e) return "Unknown error (no details)";
    if (e instanceof Error) {
      return e.message + (e.stack ? `\n${e.stack}` : "");
    }
    return String(e);
  }
}