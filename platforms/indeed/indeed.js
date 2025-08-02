import BasePlatformAutomation from "../../shared/base/base-platform-automation.js";
import { UrlUtils, DomUtils } from "../../shared/utilities/index.js";
import {
  AIService,
  ApplicationTrackerService,
  UserService,
} from "../../services/index.js";
import FormHandler from "../../shared/indeed_glassdoors/form-handler.js";

/**
 * Selectors for Indeed platform elements
 */
const SELECTORS = {
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
  LOGIN_INDICATORS: [
    'span#signInMobile',
    'li.link-signin a#signIn[href*="account/login"]',
    'a[href*="account/login"]',
    'button[data-testid="signin-button"]',
  ],
  CLOUDFLARE_INDICATORS: [
    'main.error h1#heading',
    'p#paragraph[id*="Ray ID"]',
    'input[name="cf-turnstile-response"]',
    'div.core-msg.spacer',
  ],
};

/**
 * Configuration constants for Indeed automation
 */
const CONFIG = {
  PLATFORM: "indeed",
  BASE_URL: "https://www.indeed.com",
  TIMEOUTS: {
    STANDARD: 2000,
    EXTENDED: 5000,
    PAGE_LOAD: 10000,
    APPLICATION: 300000, // 5 minutes
    LOGIN_WAIT: 900000, // 15 minutes
    CLOUDFLARE_WAIT: 600000, // 10 minutes
  },
  RETRY: {
    MAX_ATTEMPTS: 3,
    DELAYS: [2000, 5000, 10000],
  },
  URL_PATTERNS: {
    SEARCH: /(?:[\w-]+\.)?indeed\.com\/jobs/,
    JOB_PAGE: /indeed\.com\/(viewjob|job)/,
    APPLICATION: /indeed\.com\/apply|smartapply\.indeed\.com\/beta\/indeedapply\/form/,
  },
};

/**
 * State management class for Indeed automation
 */
class AutomationState {
  constructor() {
    this.reset();
  }

  reset() {
    this.status = 'idle'; // idle, running, applying, paused, completed, error
    this.currentJobIndex = 0;
    this.processedJobIds = new Set();
    this.isApplicationInProgress = false;
    this.applicationStartTime = null;
    this.currentJobData = null;
    this.lastActivity = Date.now();
    this.retryCount = 0;
  }

  updateStatus(status, data = {}) {
    this.status = status;
    this.lastActivity = Date.now();
    Object.assign(this, data);
  }

  isRunning() {
    return ['running', 'applying'].includes(this.status);
  }

  canProcessJobs() {
    return this.status === 'running' && !this.isApplicationInProgress;
  }

  startApplication(jobData) {
    this.isApplicationInProgress = true;
    this.applicationStartTime = Date.now();
    this.currentJobData = jobData;
    this.updateStatus('applying');
  }

  completeApplication() {
    this.isApplicationInProgress = false;
    this.applicationStartTime = null;
    this.currentJobData = null;
    this.updateStatus('running');
  }

  addProcessedJob(jobId) {
    this.processedJobIds.add(jobId);
  }

  isJobProcessed(jobId) {
    return this.processedJobIds.has(jobId);
  }
}

/**
 * Page detector utility class
 */
class PageDetector {
  static detectPageType(url = window.location.href) {
    if (url.includes("google.com/search")) return 'google_search';
    if (CONFIG.URL_PATTERNS.APPLICATION.test(url)) return 'application';
    if (CONFIG.URL_PATTERNS.JOB_PAGE.test(url)) return 'job_page';
    if (CONFIG.URL_PATTERNS.SEARCH.test(url)) return 'job_search';
    return 'unknown';
  }

  static isCloudflareBlocked() {
    return SELECTORS.CLOUDFLARE_INDICATORS.some(selector => {
      const element = document.querySelector(selector);
      return element && PageDetector.isElementVisible(element);
    });
  }

  static isLoggedOut() {
    return SELECTORS.LOGIN_INDICATORS.some(selector => {
      const element = document.querySelector(selector);
      return element && PageDetector.isElementVisible(element);
    });
  }

  static isElementVisible(element) {
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
    } catch {
      return false;
    }
  }
}

/**
 * Job extraction utility class
 */
class JobExtractor {
  static extractJobCards() {
    for (const selector of SELECTORS.JOB_CARDS) {
      const cards = Array.from(document.querySelectorAll(selector));
      const visibleCards = cards.filter(card => PageDetector.isElementVisible(card));
      if (visibleCards.length > 0) {
        return visibleCards;
      }
    }
    return [];
  }

  static extractJobId(jobCard) {
    // Try data-jk attribute first
    const dataJk = jobCard.getAttribute("data-jk");
    if (dataJk) return dataJk;

    // Try to extract from job URL
    const titleLink = jobCard.querySelector('a[href*="viewjob?jk="], .jobTitle a, [data-testid="job-title"] a');
    if (titleLink?.href) {
      const match = titleLink.href.match(/jk=([^&]+)/);
      if (match?.[1]) return match[1];
    }

    // Fallback to content-based ID
    const title = JobExtractor.extractText(jobCard, SELECTORS.JOB_TITLE);
    const company = JobExtractor.extractText(jobCard, SELECTORS.COMPANY_NAME);
    return `${title}-${company}`.replace(/\s+/g, "").toLowerCase() || 
           `card-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  static extractJobUrl(jobCard) {
    const selectors = [
      'a[href*="viewjob?jk="]',
      ".jobTitle a",
      '[data-testid="job-title"] a',
      "h2 a",
      "a[data-jk]",
    ];

    for (const selector of selectors) {
      const link = jobCard.querySelector(selector);
      if (link?.href && link.href.includes("indeed.com") && 
          (link.href.includes("viewjob") || link.href.includes("jk="))) {
        return link.href;
      }
    }
    return null;
  }

  static extractJobDetails(jobCard) {
    return {
      jobId: JobExtractor.extractJobId(jobCard),
      title: JobExtractor.extractText(jobCard, SELECTORS.JOB_TITLE) || "Unknown Position",
      company: JobExtractor.extractText(jobCard, SELECTORS.COMPANY_NAME) || "Unknown Company",
      location: JobExtractor.extractText(jobCard, SELECTORS.LOCATION) || "Unknown Location",
      salary: JobExtractor.extractText(jobCard, SELECTORS.SALARY) || "Not specified",
      jobUrl: JobExtractor.extractJobUrl(jobCard) || window.location.href,
      platform: "indeed",
      extractedAt: Date.now(),
    };
  }

  static extractText(container, selectors) {
    for (const selector of selectors) {
      const element = container.querySelector(selector);
      if (element) {
        const text = element.getAttribute("title") || element.textContent?.trim();
        if (text && text.length > 0) return text;
      }
    }
    return "";
  }

  static extractJobDescription() {
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
      jobDescription.fullDescription = fullDescriptionElement.textContent.trim();
    }

    return jobDescription;
  }
}

/**
 * Main Indeed Platform Automation class
 */
export default class IndeedPlatform extends BasePlatformAutomation {
  constructor(config) {
    super(config);
    this.platform = "indeed";
    this.baseUrl = CONFIG.BASE_URL;
    
    // Initialize services
    this.aiService = new AIService({ apiHost: this.getApiHost() });
    this.applicationTracker = new ApplicationTrackerService({ userId: this.userId });
    this.userService = new UserService({ userId: this.userId });
    
    // Initialize state management
    this.state = new AutomationState();
    
    // Initialize form handler
    this.formHandler = null;
    this.currentJobDescription = null;
    
    // Setup monitoring
    this.setupHealthMonitoring();
  }

  // =============================================================================
  // INITIALIZATION AND SETUP
  // =============================================================================

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

      this.statusOverlay.addSuccess("Indeed automation initialized successfully");
    } catch (error) {
      this.log("⚠️ Could not initialize form handler:", error);
      this.statusOverlay.addWarning("Form handler initialization failed");
    }
  }

  async setSessionContext(sessionContext) {
    try {
      await super.setSessionContext?.(sessionContext);
      
      this.sessionContext = sessionContext;
      
      if (sessionContext.userId) this.userId = sessionContext.userId;
      if (sessionContext.userProfile && !this.userProfile) {
        this.userProfile = sessionContext.userProfile;
      }
      if (sessionContext.apiHost) {
        this.sessionApiHost = sessionContext.apiHost;
      }

      // Update services with new context
      if (this.userId) {
        this.applicationTracker = new ApplicationTrackerService({ 
          userId: this.userId,
          apiHost: this.getApiHost() 
        });
        this.userService = new UserService({ userId: this.userId });
      }

      // Update form handler
      if (this.formHandler && this.userProfile) {
        this.formHandler.userData = this.userProfile;
      }

      this.log("✅ Session context updated successfully");
    } catch (error) {
      this.log("❌ Error setting session context:", error);
      throw error;
    }
  }

  setupHealthMonitoring() {
    // Health check every 30 seconds
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 30000);
  }

  // =============================================================================
  // MAIN AUTOMATION FLOW
  // =============================================================================

  async start(params = {}) {
    try {
      this.log("🚀 Starting Indeed automation");
      this.statusOverlay.addInfo("Starting Indeed automation");
      
      this.config = { ...this.config, ...params };
      this.state.reset();
      this.state.updateStatus('running');

      // Load user profile if needed
      await this.ensureUserProfile();
      
      // Wait for page to be ready
      await this.waitForPageReady();
      
      // Start main automation loop
      await this.runAutomationLoop();
      
    } catch (error) {
      this.handleError(error, "start");
    }
  }

  async runAutomationLoop() {
    while (this.state.isRunning()) {
      try {
        const pageType = PageDetector.detectPageType();
        this.log(`📄 Current page type: ${pageType}`);
        
        switch (pageType) {
          case 'google_search':
            await this.handleGoogleSearchPage();
            break;
          case 'job_search':
            await this.handleJobSearchPage();
            break;
          case 'job_page':
            await this.handleJobPage();
            break;
          case 'application':
            await this.handleApplicationPage();
            break;
          default:
            await this.handleUnknownPage();
        }
        
        // Add delay between iterations
        await this.wait(CONFIG.TIMEOUTS.STANDARD);
        
      } catch (error) {
        this.handleError(error, "automation_loop");
        
        // Reset application state on error and continue
        if (this.state.isApplicationInProgress) {
          this.state.completeApplication();
        }
        
        await this.wait(CONFIG.TIMEOUTS.EXTENDED);
      }
    }
  }

  // =============================================================================
  // PAGE HANDLERS
  // =============================================================================

  async handleGoogleSearchPage() {
    this.statusOverlay.addInfo("Processing Google search results");
    await super.searchNext?.() || this.handleFallbackSearch();
  }

  async handleJobSearchPage() {
    this.statusOverlay.addInfo("Processing Indeed job search page");
    
    // Check for prerequisites
    await this.checkPrerequisites();
    
    // Process job cards
    const jobCards = JobExtractor.extractJobCards();
    this.log(`📋 Found ${jobCards.length} job cards`);
    
    if (jobCards.length === 0) {
      await this.handleNoJobsFound();
      return;
    }

    // Find next unprocessed job
    const unprocessedJob = this.findNextUnprocessedJob(jobCards);
    
    if (unprocessedJob) {
      await this.processJob(unprocessedJob.card, unprocessedJob.details);
    } else {
      await this.handleAllJobsProcessed();
    }
  }

  async handleJobPage() {
    this.statusOverlay.addInfo("Processing Indeed job page");
    
    // Extract job description for form filling
    this.currentJobDescription = JobExtractor.extractJobDescription();
    
    // Look for apply button
    const applyButton = this.findApplyButton();
    
    if (!applyButton) {
      this.statusOverlay.addWarning("No Easy Apply button found");
      this.state.updateStatus('running');
      return;
    }

    if (this.isExternalApplication()) {
      this.statusOverlay.addInfo("External application detected, skipping");
      this.state.updateStatus('running');
      return;
    }

    // Click apply button and wait for form
    this.statusOverlay.addInfo("Clicking Apply button");
    applyButton.click();
    
    await this.waitForApplicationPage();
  }

  async handleApplicationPage() {
    this.statusOverlay.addInfo("Processing Indeed application page");
    
    // Check if already applied
    if (this.checkAlreadyApplied()) {
      this.statusOverlay.addInfo("Already applied to this job");
      await this.handleApplicationComplete(true);
      return;
    }

    // Check if form is ready
    if (!this.formHandler || !this.formHandler.findFormContainer()) {
      this.statusOverlay.addWarning("Application form not ready");
      await this.wait(CONFIG.TIMEOUTS.STANDARD);
      return;
    }

    // Fill and submit form
    await this.fillApplicationForm();
  }

  async handleUnknownPage() {
    this.statusOverlay.addInfo("Unknown page type, waiting for navigation");
    await this.waitForValidPage();
  }

  // =============================================================================
  // JOB PROCESSING
  // =============================================================================

  findNextUnprocessedJob(jobCards) {
    for (const card of jobCards) {
      const jobDetails = JobExtractor.extractJobDetails(card);
      
      // Skip if already processed
      if (this.state.isJobProcessed(jobDetails.jobId)) {
        continue;
      }
      
      // Skip if no valid URL
      if (!jobDetails.jobUrl || !this.isValidJobUrl(jobDetails.jobUrl)) {
        this.state.addProcessedJob(jobDetails.jobId);
        continue;
      }
      
      return { card, details: jobDetails };
    }
    
    return null;
  }

  async processJob(jobCard, jobDetails) {
    try {
      this.log(`🎯 Processing job: ${jobDetails.title} at ${jobDetails.company}`);
      this.statusOverlay.addInfo(`Processing: ${jobDetails.title}`);
      
      this.state.startApplication(jobDetails);
      this.state.addProcessedJob(jobDetails.jobId);
      
      // Mark job card as processing
      this.markJobCard(jobCard, 'processing');
      
      // Click job card to view details
      const jobLink = jobCard.querySelector('.jcs-JobTitle a, [data-testid="job-title"] a, .jobTitle a');
      if (jobLink) {
        jobLink.click();
        await this.wait(CONFIG.TIMEOUTS.STANDARD);
      }
      
    } catch (error) {
      this.markJobCard(jobCard, 'error');
      this.state.completeApplication();
      throw error;
    }
  }

  async fillApplicationForm() {
    try {
      this.statusOverlay.addInfo("Filling application form");
      
      // Update form handler with current job description
      if (this.formHandler && this.currentJobDescription) {
        this.formHandler.jobDescription = this.currentJobDescription;
      }
      
      // Fill and submit form
      const success = await this.formHandler.fillCompleteForm();
      
      if (success) {
        this.statusOverlay.addSuccess("Application submitted successfully");
        await this.trackApplication();
        await this.handleApplicationComplete(true);
      } else {
        this.statusOverlay.addError("Failed to submit application");
        await this.handleApplicationComplete(false);
      }
      
    } catch (error) {
      this.statusOverlay.addError(`Form submission error: ${error.message}`);
      await this.handleApplicationComplete(false);
      throw error;
    }
  }

  async handleApplicationComplete(success) {
    if (success) {
      this.markCurrentJobCard('applied');
      await this.trackApplication();
    } else {
      this.markCurrentJobCard('error');
    }
    
    this.state.completeApplication();
    this.currentJobDescription = null;
    
    // Add delay before next job
    await this.wait(CONFIG.TIMEOUTS.EXTENDED);
  }

  // =============================================================================
  // UTILITY METHODS
  // =============================================================================

  async checkPrerequisites() {
    // Check for Cloudflare blocks
    if (PageDetector.isCloudflareBlocked()) {
      this.statusOverlay.addWarning("Cloudflare verification required");
      await this.waitForCloudflareResolution();
    }
    
    // Check login status
    if (PageDetector.isLoggedOut()) {
      this.statusOverlay.addWarning("Please sign in to Indeed");
      await this.waitForLogin();
    }
  }

  async waitForCloudflareResolution() {
    const maxWait = CONFIG.TIMEOUTS.CLOUDFLARE_WAIT;
    const checkInterval = 5000;
    let waited = 0;
    
    while (waited < maxWait && PageDetector.isCloudflareBlocked()) {
      await this.wait(checkInterval);
      waited += checkInterval;
      this.statusOverlay.addInfo(`Waiting for Cloudflare verification... (${Math.floor(waited / 1000)}s)`);
    }
    
    if (PageDetector.isCloudflareBlocked()) {
      throw new Error("Cloudflare verification timeout");
    }
  }

  async waitForLogin() {
    const maxWait = CONFIG.TIMEOUTS.LOGIN_WAIT;
    const checkInterval = 10000;
    let waited = 0;
    
    while (waited < maxWait && PageDetector.isLoggedOut()) {
      await this.wait(checkInterval);
      waited += checkInterval;
      this.statusOverlay.addInfo(`Waiting for login... (${Math.floor(waited / 1000)}s)`);
    }
    
    if (PageDetector.isLoggedOut()) {
      throw new Error("Login timeout");
    }
  }

  async waitForPageReady() {
    await this.wait(CONFIG.TIMEOUTS.STANDARD);
    
    // Wait for basic page elements to load
    const maxWait = CONFIG.TIMEOUTS.PAGE_LOAD;
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
      if (document.readyState === 'complete' && document.body) {
        return;
      }
      await this.wait(500);
    }
  }

  async waitForApplicationPage() {
    const maxWait = CONFIG.TIMEOUTS.PAGE_LOAD;
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
      const pageType = PageDetector.detectPageType();
      if (pageType === 'application') {
        return;
      }
      await this.wait(1000);
    }
    
    throw new Error("Timeout waiting for application page");
  }

  async waitForValidPage() {
    const maxWait = CONFIG.TIMEOUTS.PAGE_LOAD;
    const startTime = Date.now();
    
    while (Date.now() - startTime < maxWait) {
      const pageType = PageDetector.detectPageType();
      if (pageType !== 'unknown') {
        return;
      }
      await this.wait(1000);
    }
    
    throw new Error("Timeout waiting for valid page");
  }

  findApplyButton() {
    for (const selector of SELECTORS.APPLY_BUTTON) {
      const button = document.querySelector(selector);
      if (button && PageDetector.isElementVisible(button) && !button.disabled) {
        return button;
      }
    }
    return null;
  }

  isExternalApplication() {
    return SELECTORS.EXTERNAL_APPLY.some(selector => {
      const element = document.querySelector(selector);
      return element && PageDetector.isElementVisible(element);
    });
  }

  checkAlreadyApplied() {
    const pageText = document.body.innerText.toLowerCase();
    const indicators = [
      "you've applied to this job",
      "already applied",
      "application submitted",
      "you applied",
    ];
    return indicators.some(text => pageText.includes(text));
  }

  isValidJobUrl(url) {
    if (!url || typeof url !== "string") return false;
    
    try {
      const urlObj = new URL(url);
      return urlObj.hostname.includes("indeed.com") && 
             (url.includes("viewjob") || url.includes("jk=")) &&
             !url.includes("/apply/") && 
             !url.includes("smartapply");
    } catch {
      return false;
    }
  }

  markJobCard(jobCard, status) {
    try {
      // Remove existing highlight
      const existing = jobCard.querySelector(".job-highlight");
      if (existing) existing.remove();
      
      // Create new highlight
      const highlight = document.createElement("div");
      highlight.className = "job-highlight";
      
      const colors = {
        processing: "#2196F3",
        applied: "#4CAF50",
        skipped: "#FF9800",
        error: "#F44336"
      };
      
      const color = colors[status] || "#9E9E9E";
      
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
      
      highlight.textContent = status.charAt(0).toUpperCase() + status.slice(1);
      
      jobCard.style.border = `2px solid ${color}`;
      jobCard.style.position = "relative";
      jobCard.appendChild(highlight);
      
    } catch (error) {
      this.log("Error marking job card:", error);
    }
  }

  markCurrentJobCard(status) {
    if (this.state.currentJobData) {
      // Find the job card by ID and mark it
      const jobCards = JobExtractor.extractJobCards();
      for (const card of jobCards) {
        const cardId = JobExtractor.extractJobId(card);
        if (cardId === this.state.currentJobData.jobId) {
          this.markJobCard(card, status);
          break;
        }
      }
    }
  }

  async handleNoJobsFound() {
    this.statusOverlay.addInfo("No job cards found, trying to load more");
    
    // Try scrolling to load more jobs
    window.scrollTo(0, document.body.scrollHeight);
    await this.wait(CONFIG.TIMEOUTS.STANDARD);
    
    const jobCardsAfterScroll = JobExtractor.extractJobCards();
    if (jobCardsAfterScroll.length > 0) {
      return; // Will be processed in next iteration
    }
    
    // Try next page
    const nextButton = document.querySelector(SELECTORS.NEXT_PAGE[0]);
    if (nextButton && PageDetector.isElementVisible(nextButton)) {
      this.statusOverlay.addInfo("Moving to next page");
      nextButton.click();
      await this.wait(CONFIG.TIMEOUTS.EXTENDED);
    } else {
      this.statusOverlay.addSuccess("All jobs processed!");
      this.state.updateStatus('completed');
    }
  }

  async handleAllJobsProcessed() {
    this.statusOverlay.addInfo("All visible jobs processed");
    await this.handleNoJobsFound();
  }

  async handleFallbackSearch() {
    this.statusOverlay.addInfo("Fallback search not implemented");
    // Implement fallback search logic if needed
  }

  async ensureUserProfile() {
    if (this.userProfile) return;
    
    try {
      if (this.userId) {
        this.userProfile = await this.userService.getUserDetails();
        this.statusOverlay.addSuccess("User profile loaded");
        
        if (this.formHandler) {
          this.formHandler.userData = this.userProfile;
        }
      }
    } catch (error) {
      this.statusOverlay.addWarning("Failed to load user profile");
      this.log("Error loading user profile:", error);
    }
  }

  async trackApplication() {
    if (!this.state.currentJobData || !this.userId) return;
    
    try {
      await this.applicationTracker.trackApplication({
        ...this.state.currentJobData,
        userId: this.userId,
        applicationPlatform: "indeed",
      });
    } catch (error) {
      this.log("Error tracking application:", error);
    }
  }

  performHealthCheck() {
    try {
      const now = Date.now();
      
      // Check for stuck applications
      if (this.state.isApplicationInProgress && this.state.applicationStartTime) {
        const applicationTime = now - this.state.applicationStartTime;
        if (applicationTime > CONFIG.TIMEOUTS.APPLICATION) {
          this.log("Application timeout detected, resetting state");
          this.statusOverlay.addWarning("Application timeout - resetting");
          this.state.completeApplication();
        }
      }
      
      // Check for general inactivity
      const inactiveTime = now - this.state.lastActivity;
      if (inactiveTime > 120000 && this.state.isRunning()) { // 2 minutes
        this.log("Inactivity detected, refreshing automation");
        this.state.lastActivity = now;
      }
      
    } catch (error) {
      this.log("Error in health check:", error);
    }
  }

  handleError(error, context = "") {
    this.log(`❌ Error in ${context}:`, error);
    this.statusOverlay.addError(`Error: ${error.message}`);
    
    // Reset application state on error
    if (this.state.isApplicationInProgress) {
      this.state.completeApplication();
      this.markCurrentJobCard('error');
    }
    
    // Don't stop automation for recoverable errors
    if (!this.isRecoverableError(error)) {
      this.state.updateStatus('error');
    }
  }

  isRecoverableError(error) {
    const recoverableErrors = [
      'timeout',
      'network',
      'element not found',
      'page load',
    ];
    
    return recoverableErrors.some(errorType => 
      error.message.toLowerCase().includes(errorType)
    );
  }

  // =============================================================================
  // PLATFORM-SPECIFIC INTERFACE METHODS
  // =============================================================================

  getPlatformDomains() {
    return ["https://www.indeed.com", "https://smartapply.indeed.com"];
  }

  getSearchLinkPattern() {
    return /^https:\/\/(www\.)?indeed\.com\/(viewjob|job|jobs|apply).*$/;
  }

  isValidJobPage(url) {
    return CONFIG.URL_PATTERNS.JOB_PAGE.test(url) || 
           CONFIG.URL_PATTERNS.APPLICATION.test(url);
  }

  isApplicationPage(url) {
    return CONFIG.URL_PATTERNS.APPLICATION.test(url);
  }

  getApiHost() {
    return this.sessionApiHost || this.sessionContext?.apiHost || this.config.apiHost;
  }

  getJobTaskMessageType() {
    return "openJobInNewTab";
  }

  platformSpecificUrlNormalization(url) {
    return url
      .replace(/[?&](jk|tk|from|advn)=[^&]*/g, "")
      .replace(/[?&]+$/, "");
  }

  // =============================================================================
  // MESSAGE HANDLING
  // =============================================================================

  handlePlatformSpecificMessage(type, data) {
    switch (type) {
      case "START_AUTOMATION":
        this.start(data);
        break;
        
      case "STOP_AUTOMATION":
        this.stop();
        break;
        
      case "GET_STATUS":
        return this.getStatus();
        
      case "RESET_STATE":
        this.resetState();
        break;
        
      case "SEARCH_TASK_DATA":
        this.processSearchTaskData(data);
        break;
        
      case "SEND_CV_TASK_DATA":
        this.processSendCvTaskData(data);
        break;
        
      default:
        super.handlePlatformSpecificMessage?.(type, data);
    }
  }

  processSearchTaskData(data) {
    try {
      this.log("📊 Processing search task data:", data);
      
      this.searchData = {
        tabId: data.tabId,
        limit: data.limit || 10,
        current: data.current || 0,
        domain: data.domain || this.getPlatformDomains(),
        submittedLinks: data.submittedLinks || [],
        searchLinkPattern: data.searchLinkPattern 
          ? new RegExp(data.searchLinkPattern.replace(/^\/|\/[gimy]*$/g, ""))
          : this.getSearchLinkPattern(),
      };
      
      this.statusOverlay.addSuccess("Search data initialized");
    } catch (error) {
      this.log("❌ Error processing search task data:", error);
      this.statusOverlay.addError("Error processing search data: " + error.message);
    }
  }

  processSendCvTaskData(data) {
    try {
      this.log("📊 Processing CV task data:", data);
      
      if (data?.profile && !this.userProfile) {
        this.userProfile = data.profile;
        this.log("👤 User profile set from task data");
        
        if (this.formHandler) {
          this.formHandler.userData = this.userProfile;
        }
      }
      
      this.statusOverlay.addSuccess("CV task data processed");
    } catch (error) {
      this.log("❌ Error processing CV task data:", error);
      this.statusOverlay.addError("Error processing CV data: " + error.message);
    }
  }

  // =============================================================================
  // CHROME MESSAGE HANDLER
  // =============================================================================

  handleChromeMessage(message, sender, sendResponse) {
    try {
      const { action, type } = message;
      const messageType = action || type;

      switch (messageType) {
        case "startJobSearch":
        case "startAutomation":
          this.start();
          sendResponse({ status: "started" });
          break;

        case "stopAutomation":
          this.stop();
          sendResponse({ status: "stopped" });
          break;

        case "checkStatus":
          sendResponse({
            success: true,
            data: this.getStatus()
          });
          break;

        case "resetState":
          this.resetState();
          sendResponse({ success: true, message: "State reset" });
          break;

        default:
          sendResponse({
            success: false,
            message: `Unknown message type: ${messageType}`,
          });
      }
    } catch (error) {
      this.log("Error handling Chrome message:", error);
      sendResponse({ success: false, message: error.message });
    }

    return true;
  }

  // =============================================================================
  // CONTROL METHODS
  // =============================================================================

  stop() {
    this.log("🛑 Stopping Indeed automation");
    this.state.updateStatus('stopped');
    this.statusOverlay.addInfo("Automation stopped");
  }

  resetState() {
    this.log("🔄 Resetting automation state");
    this.state.reset();
    this.currentJobDescription = null;
    this.statusOverlay.addInfo("State reset complete");
    this.statusOverlay.updateStatus("ready");
  }

  getStatus() {
    return {
      platform: "indeed",
      status: this.state.status,
      isRunning: this.state.isRunning(),
      isApplicationInProgress: this.state.isApplicationInProgress,
      currentJobIndex: this.state.currentJobIndex,
      processedJobsCount: this.state.processedJobIds.size,
      lastActivity: this.state.lastActivity,
      currentJob: this.state.currentJobData,
    };
  }

  // =============================================================================
  // CLEANUP
  // =============================================================================

  cleanup() {
    this.log("🧹 Cleaning up Indeed automation");
    
    // Clear intervals
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = null;
    }
    
    // Reset state
    this.state.reset();
    this.currentJobDescription = null;
    
    // Call parent cleanup
    super.cleanup?.();
    
    this.log("✅ Cleanup completed");
  }

  // =============================================================================
  // UTILITY METHODS
  // =============================================================================

  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  log(message, ...args) {
    console.log(`[IndeedPlatform] ${message}`, ...args);
  }

  // Safe message sending with error handling
  safeSendPortMessage(message) {
    try {
      if (this.port && this.port.postMessage) {
        this.port.postMessage(message);
        return true;
      }
      return false;
    } catch (error) {
      this.log("Error sending port message:", error);
      return false;
    }
  }

  // Normalize URL for comparison
  normalizeUrlFully(url) {
    try {
      const urlObj = new URL(url);
      // Remove Indeed-specific tracking parameters
      ['jk', 'tk', 'from', 'advn', 'pp', 'sp', 'rsltid'].forEach(param => {
        urlObj.searchParams.delete(param);
      });
      return urlObj.toString();
    } catch {
      return url;
    }
  }

  // Check if link has been processed (using searchData if available)
  isLinkProcessed(url) {
    if (!this.searchData?.submittedLinks) return false;
    
    const normalizedUrl = this.normalizeUrlFully(url);
    return this.searchData.submittedLinks.some(link => 
      this.normalizeUrlFully(link.url) === normalizedUrl
    );
  }

  // Extract job ID from URL
  extractJobIdFromUrl(url = window.location.href) {
    try {
      const match = url.match(/jk=([^&]+)/);
      return match ? match[1] : null;
    } catch {
      return null;
    }
  }
}