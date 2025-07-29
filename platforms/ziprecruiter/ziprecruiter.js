// platforms/ziprecruiter/ziprecruiter.js - ZipRecruiter Platform Automation (Complete Clean Version)
import BasePlatformAutomation from "../../shared/base/base-platform-automation.js";
import FormHandler from "./ziprecruiter-form-handler.js";
import { UrlUtils, DomUtils } from "../../shared/utilities/index.js";
import {
  AIService,
  ApplicationTrackerService,
  UserService,
} from "../../services/index.js";

export default class ZipRecruiterPlatform extends BasePlatformAutomation {
  constructor(config) {
    super(config);
    this.platform = "ziprecruiter";
    this.baseUrl = "https://www.ziprecruiter.com";

    this.initializeServices();
    this.initializeState();
    this.initializeConfig();
    this.setupObservers();
  }

  // ========================================
  // INITIALIZATION
  // ========================================

  initializeServices() {
    this.aiService = new AIService({ apiHost: this.getApiHost() });
    this.applicationTracker = new ApplicationTrackerService({ userId: this.userProfile.userId, apiHost: this.getApiHost() });
    this.userService = new UserService({ userId: this.userProfile.userId });
  }

  initializeState() {
    // Consolidated state management
    this.state = {
      // Initialization
      initialized: false,
      ready: false,

      // Automation flow
      isRunning: false,
      currentPhase: 'idle', // 'idle', 'searching', 'applying', 'completed'

      // Job processing
      processedJobIds: new Set(),
      processedCount: 0,
      currentJobIndex: 0,
      currentJobDetails: null,
      lastClickedJobCard: null,

      // Application state
      isApplicationInProgress: false,
      applicationStartTime: null,
      formDetected: false,

      // Health monitoring
      lastActivity: Date.now(),
    };

    // Search configuration
    this.searchData = null;
    this.userProfile = null;
    this.formHandler = null;
    this.cachedJobDescription = null;
  }

  initializeConfig() {
    this.config = {
      selectors: {
        jobCards: [".job_result_two_pane", ".job_result", "[data-testid='job-card']", ".job"],
        jobTitle: ["h2.font-bold.text-primary", ".job-title", "[data-testid='job-title']", "h2 a"],
        companyName: ["[data-testid='job-card-company']", ".company-name", "a[aria-label*='company']"],
        location: ["[data-testid='job-card-location']", ".location", "p.text-primary"],
        applyButton: ["button[aria-label*='1-Click Apply']", "button[aria-label*='Quick Apply']", ".apply-button"],
        modalContainer: [".ApplyFlowApp", ".application-modal", ".modal"],
        noJobsFound: [".jobs_not_found", ".no-results"],
        nextPageButton: ["a[title='Next Page']", ".next-page", ".pagination-next"],
        jobDescription: [".job-description", ".description", "[data-testid='job-description']"],
      },
      timeouts: {
        standard: 3000,
        extended: 8000,
        applicationTimeout: 8 * 60 * 1000,
        pageLoad: 3000,
      },
      delays: {
        betweenJobs: 3000,
        formFilling: 1000,
        pageLoad: 3000,
      },
      urlPatterns: {
        searchPage: /ziprecruiter\.com\/(jobs|search)/,
        jobPage: /ziprecruiter\.com\/job\//,
        applyPage: /ziprecruiter\.com\/apply/,
      },
    };
  }

  setupObservers() {
    this.healthCheckTimer = setInterval(() => this.performHealthCheck(), 30000);
    this.setupFormDetectionObserver();
  }

  async initialize() {
    await super.initialize();

    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.initializePage());
    } else {
      this.initializePage();
    }

    this.state.initialized = true;
  }

  // ========================================
  // PAGE TYPE DETECTION & ROUTING
  // ========================================

  async initializePage() {
    try {
      const pageType = this.detectPageType();
      this.log(`🔍 Page type detected: ${pageType}`);

      switch (pageType) {
        case 'google_search':
          await this.handleGoogleSearchPage();
          break;
        case 'ziprecruiter_search':
          await this.handleZipRecruiterSearchPage();
          break;
        case 'ziprecruiter_job':
          await this.handleZipRecruiterJobPage();
          break;
        case 'ziprecruiter_apply':
          await this.handleZipRecruiterApplicationPage();
          break;
        default:
          await this.waitForValidPage();
      }

      this.state.ready = true;
    } catch (error) {
      this.handleError('Page initialization failed', error);
    }
  }

  detectPageType() {
    const url = window.location.href;

    if (url.includes("google.com/search")) return 'google_search';
    if (this.config.urlPatterns.applyPage.test(url)) return 'ziprecruiter_apply';
    if (this.config.urlPatterns.jobPage.test(url)) return 'ziprecruiter_job';
    if (this.config.urlPatterns.searchPage.test(url)) return 'ziprecruiter_search';

    return 'unknown';
  }

  // ========================================
  // PAGE HANDLERS
  // ========================================

  async handleGoogleSearchPage() {
    this.showUserMessage("Google search page detected", "info");
    this.state.currentPhase = 'searching';
    await this.requestSearchTaskData();
  }

  async handleZipRecruiterSearchPage() {
    this.showUserMessage("ZipRecruiter search page detected", "info");
    this.state.currentPhase = 'searching';

    const { jobsFound, jobCount } = this.checkIfJobsFound();
    if (!jobsFound) {
      this.showUserMessage("No jobs found for your search", "warning");
      return;
    }

    this.showUserMessage(`Found ${jobCount || "multiple"} jobs`, "success");
    await this.requestSearchTaskData();
  }

  async handleZipRecruiterJobPage() {
    this.showUserMessage("ZipRecruiter job page detected", "info");
    this.state.currentPhase = 'applying';
    this.cachedJobDescription = await this.extractJobDescription();
    await this.requestApplicationTaskData();
  }

  async handleZipRecruiterApplicationPage() {
    this.showUserMessage("ZipRecruiter application page detected", "info");
    this.state.currentPhase = 'applying';
    this.state.formDetected = true;
    await this.requestApplicationTaskData();
  }

  // ========================================
  // MAIN AUTOMATION FLOW
  // ========================================

  async start(params = {}) {
    try {
      if (this.state.isRunning) return true;

      const validationResult = await this.validatePreconditions();
      if (!validationResult.isValid) {
        this.showUserMessage(`❌ Cannot start: ${validationResult.message}`, "error");
        return false;
      }

      this.state.isRunning = true;
      this.showUserMessage("Starting ZipRecruiter automation...", "info");

      await this.loadUserProfile();
      await this.initializeFormHandler();

      this.config = { ...this.config, ...params };
      this.updateProgress({
        total: params.jobsToApply || 0,
        completed: 0,
        current: "Starting automation...",
      });

      await this.waitForPageLoad();

      // Route based on current page type
      const pageType = this.detectPageType();
      if (pageType === 'ziprecruiter_search') {
        await this.startJobProcessing();
      } else if (pageType === 'ziprecruiter_apply' || pageType === 'ziprecruiter_job') {
        await this.processCurrentApplication();
      }

      return true;
    } catch (error) {
      this.handleError('Failed to start automation', error);
      this.state.isRunning = false;
      return false;
    }
  }

  // ========================================
  // VALIDATION & AUTHENTICATION
  // ========================================

  async validatePreconditions() {
    try {
      // Check for CAPTCHA
      const captchaCheck = this.checkForInterference('captcha');
      if (!captchaCheck.isValid) {
        return { isValid: false, message: captchaCheck.message };
      }

      // Check login status
      const loginCheck = this.checkForInterference('login');
      if (!loginCheck.isValid) {
        return { isValid: false, message: loginCheck.message };
      }

      this.showUserMessage("Validation passed - ready to proceed!", "success");
      return { isValid: true, message: "Ready to start" };
    } catch (error) {
      return {
        isValid: false,
        message: "Validation failed - please refresh and try again"
      };
    }
  }

  checkForInterference(type) {
    if (type === 'captcha') {
      return this.checkForCaptcha();
    } else if (type === 'login') {
      return this.checkLoginStatus();
    }
    return { isValid: true };
  }

  checkForCaptcha() {
    const captchaIndicators = [
      'p:contains("Please verify that you\'re a real person")',
      '[class*="captcha"]', '[id*="captcha"]',
      '.g-recaptcha', '.h-captcha',
      '[data-ray]', '.cf-browser-verification'
    ];

    for (const indicator of captchaIndicators) {
      const element = this.findElementByIndicator(indicator);
      if (element && this.isElementVisible(element)) {
        return {
          isValid: false,
          message: "🛡️ CAPTCHA verification required. Please complete before continuing."
        };
      }
    }

    return { isValid: true };
  }

  checkLoginStatus() {
    const profileSelectors = ['.user-menu', '[data-test="profile-menu"]', '.profile-dropdown'];
    const signInSelectors = ['button[aria-label="sign in"]', 'button:contains("Sign in")'];

    // Check for user profile elements (logged in)
    for (const selector of profileSelectors) {
      if (this.querySelector(selector)) {
        return { isValid: true, message: "✅ User is logged in" };
      }
    }

    // Check for sign-in buttons (not logged in)
    for (const selector of signInSelectors) {
      if (this.findElementByIndicator(selector)) {
        return {
          isValid: false,
          message: "🔐 Please log in to your ZipRecruiter account first."
        };
      }
    }

    return { isValid: true, message: "Login status verified" };
  }

  // ========================================
  // JOB PROCESSING PIPELINE
  // ========================================

  async startJobProcessing() {
    try {
      this.state.currentPhase = 'searching';
      this.showUserMessage("Analyzing available jobs...", "searching");

      const { jobsFound, jobCount } = this.checkIfJobsFound();
      if (!jobsFound) {
        this.showUserMessage("No jobs found matching criteria", "warning");
        this.completeAutomation();
        return;
      }

      this.showUserMessage(`Found ${jobCount} jobs! Starting applications...`, "applying");
      this.resetJobProcessingState();
      await this.processJobQueue();
    } catch (error) {
      this.handleError('Job processing failed', error);
    }
  }

  async processJobQueue() {
    while (this.state.isRunning && !this.state.isApplicationInProgress) {
      try {
        const jobCard = await this.getNextJobCard();

        if (!jobCard) {
          // Try to go to next page
          if (await this.goToNextPage()) {
            this.showUserMessage("Loading next page...", "searching");
            await this.delay(this.config.delays.pageLoad);
            continue;
          } else {
            // No more jobs
            this.completeAutomation();
            break;
          }
        }

        await this.processJobApplication(jobCard);
        await this.delay(this.config.delays.betweenJobs);

      } catch (error) {
        this.handleError('Job processing error', error);
        await this.delay(this.config.delays.betweenJobs);
      }
    }
  }

  async getNextJobCard() {
    const allJobCards = this.getJobCards();

    for (const jobCard of allJobCards) {
      const jobId = this.extractJobId(jobCard);
      if (!this.state.processedJobIds.has(jobId)) {
        return jobCard;
      }
    }

    return null;
  }

  async processJobApplication(jobCard) {
    const jobDetails = this.extractJobDetails(jobCard);
    const jobId = jobDetails.jobId;

    this.state.processedJobIds.add(jobId);
    this.state.currentJobDetails = jobDetails;
    this.state.lastClickedJobCard = jobCard;

    this.markJobCard(jobCard, 'processing');

    // Check application limit
    const canApply = await this.userService.canApplyMore();
    if (!canApply) {
      this.showUserMessage("Application limit reached", "warning");
      this.completeAutomation();
      return;
    }

    // Expand job details if needed
    await this.expandJobDetails(jobCard);

    // Find and validate apply button
    const applyButton = await this.findApplyButton();
    if (!applyButton) {
      this.showUserMessage(`Skipping: ${jobDetails.title} (no Apply button)`, "info");
      this.markJobCard(jobCard, 'skipped');
      this.state.processedCount++;
      return;
    }

    // Start application process
    this.showUserMessage(`Applying to: ${jobDetails.title} 🚀`, "applying");
    this.prepareForApplication();
    this.clickElement(applyButton);

    // Wait for application to complete
    await this.waitForApplicationCompletion();
  }

  async expandJobDetails(jobCard) {
    const clickableElement = this.findClickableJobElement(jobCard);
    if (clickableElement) {
      this.log('Expanding job details');
      this.clickElement(clickableElement);
      await this.delay(this.config.timeouts.standard);
    }
  }

  prepareForApplication() {
    this.state.isApplicationInProgress = true;
    this.state.applicationStartTime = Date.now();
    this.state.formDetected = false;
    this.storeJobData();
  }

  async waitForApplicationCompletion() {
    const timeout = this.config.timeouts.applicationTimeout;
    const startTime = Date.now();

    while (this.state.isApplicationInProgress && (Date.now() - startTime) < timeout) {
      await this.delay(1000);

      // Check if application completed
      if (this.checkApplicationSuccess()) {
        this.handleApplicationSuccess();
        break;
      }

      // Check if already applied
      if (await this.checkAlreadyApplied()) {
        this.handleAlreadyApplied();
        break;
      }
    }

    if (this.state.isApplicationInProgress && (Date.now() - startTime) >= timeout) {
      this.handleApplicationTimeout();
    }
  }

  // ========================================
  // APPLICATION FORM PROCESSING
  // ========================================

  async processCurrentApplication() {
    try {
      this.log("📝 Processing current application");
      this.showUserMessage("Processing application form...", "applying");

      if (!this.userProfile) {
        await this.loadUserProfile();
      }

      if (this.checkApplicationSuccess()) {
        await this.handleApplicationSuccess();
        return;
      }

      if (await this.checkAlreadyApplied()) {
        await this.handleAlreadyApplied();
        return;
      }

      await this.processApplicationForm();
    } catch (error) {
      this.handleError('Application processing failed', error);
    }
  }

  async processApplicationForm() {
    if (!this.userProfile) {
      this.showUserMessage("Error: No profile data available", "error");
      return;
    }

    try {
      await this.initializeFormHandler();
      const success = await this.formHandler.fillCompleteForm();

      if (success) {
        this.handleApplicationSuccess();
      } else {
        this.handleApplicationFailure();
      }
    } catch (error) {
      this.handleError('Form processing failed', error);
    }
  }

  async initializeFormHandler() {
    if (this.formHandler && this.userProfile) {
      this.formHandler.userData = this.userProfile;
      this.formHandler.jobDescription = this.cachedJobDescription || await this.getStoredJobData();
      return;
    }

    const jobDescription = this.cachedJobDescription || await this.getStoredJobData();

    this.formHandler = new FormHandler({
      enableDebug: this.config.debug || true,
      logger: (message) => this.showUserMessage(message, "info"),
      host: this.getApiHost(),
      userData: this.userProfile || {},
      jobDescription: jobDescription,
      platform: "ziprecruiter",
    });

    this.showUserMessage("Form handler initialized", "success");
  }

  // ========================================
  // JOB CARD UTILITIES
  // ========================================

  getJobCards() {
    for (const selector of this.config.selectors.jobCards) {
      const cards = document.querySelectorAll(selector);
      if (cards.length > 0) {
        const visibleCards = Array.from(cards).filter(card => this.isElementVisible(card));
        if (visibleCards.length > 0) return visibleCards;
      }
    }

    // Fallback
    const fallbackCards = document.querySelectorAll('[data-job], [class*="job"], [id*="job"]');
    return Array.from(fallbackCards).filter(card =>
      this.isElementVisible(card) && card.querySelector('a[href*="job"]')
    );
  }

  extractJobId(jobCard) {
    const dataId = jobCard.getAttribute("data-job-id") ||
      jobCard.getAttribute("data-id") ||
      jobCard.id;

    if (dataId) return dataId;

    const titleLink = jobCard.querySelector('a[href*="job"]');
    if (titleLink?.href) return titleLink.href;

    const title = this.extractTextFromCard(jobCard, this.config.selectors.jobTitle);
    const company = this.extractTextFromCard(jobCard, this.config.selectors.companyName);

    return `${title}-${company}`.replace(/\s+/g, "").toLowerCase() ||
      `card-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  extractJobDetails(jobCard) {
    try {
      return {
        jobId: this.extractJobId(jobCard),
        title: this.extractTextFromCard(jobCard, this.config.selectors.jobTitle) || "Unknown Position",
        company: this.extractTextFromCard(jobCard, this.config.selectors.companyName) || "Unknown Company",
        location: this.extractTextFromCard(jobCard, this.config.selectors.location) || "Unknown Location",
        salary: this.extractTextFromCard(jobCard, [".salary", "[data-testid='salary']"]) || "Not specified",
        jobUrl: this.extractJobUrl(jobCard) || window.location.href,
        platform: "ziprecruiter",
        extractedAt: Date.now(),
        postedDate: this.extractPostedDate(jobCard),
      };
    } catch (error) {
      return {
        jobId: this.extractJobId(jobCard),
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

  extractTextFromCard(card, selectors) {
    for (const selector of selectors) {
      const element = card.querySelector(selector);
      if (element) {
        const text = element.getAttribute("title") || element.textContent?.trim();
        if (text && text.length > 0) return text;
      }
    }
    return "";
  }

  extractJobUrl(jobCard) {
    const link = jobCard.querySelector('a[href*="job"]');
    return link?.href || "";
  }

  extractPostedDate(jobCard) {
    const elements = jobCard.querySelectorAll("p.text-primary, .date, .posted");
    for (const element of elements) {
      const text = element.textContent?.trim();
      if (text?.toLowerCase().includes("posted")) return text;
    }
    return "Not specified";
  }

  markJobCard(jobCard, status) {
    try {
      // Remove existing highlight
      const existingHighlight = jobCard.querySelector(".job-highlight");
      if (existingHighlight) existingHighlight.remove();

      const statusConfig = {
        processing: { color: "#2196F3", text: "Processing" },
        applied: { color: "#4CAF50", text: "Applied" },
        already_applied: { color: "#8BC34A", text: "Already Applied" },
        skipped: { color: "#FF9800", text: "Skipped" },
        error: { color: "#F44336", text: "Error" },
      };

      const config = statusConfig[status] || { color: "#9E9E9E", text: "Unknown" };

      const highlight = document.createElement("div");
      highlight.className = "job-highlight";
      highlight.style.cssText = `
        position: absolute; top: 0; right: 0;
        background-color: ${config.color}; color: white;
        padding: 3px 8px; font-size: 12px; font-weight: bold;
        border-radius: 0 0 0 5px; z-index: 999;
      `;
      highlight.textContent = config.text;

      jobCard.style.border = `2px solid ${config.color}`;
      jobCard.style.position = "relative";
      jobCard.appendChild(highlight);
    } catch (error) {
      this.log("Error marking job card:", error);
    }
  }

  // ========================================
  // APPLY BUTTON & INTERACTION
  // ========================================

  async findApplyButton() {
    // Try configured selectors first
    for (const selector of this.config.selectors.applyButton) {
      const button = this.querySelector(selector);
      if (button && !button.disabled) {
        return button;
      }
    }

    // Search by button text
    const applyTexts = ["1-click apply", "quick apply", "apply now", "continue application"];
    const buttons = document.querySelectorAll("button, a");

    for (const button of buttons) {
      const buttonText = button.textContent?.toLowerCase() || "";

      if (applyTexts.some(text => buttonText.includes(text)) &&
        this.isElementVisible(button) && !button.disabled) {
        return button;
      }
    }

    return null;
  }

  findClickableJobElement(jobCard) {
    const selectors = [
      'h2 a', 'h1 a', '.job-title a', 'a[data-testid="job-title"]',
      '.JobCard_trackingLink__HMyun', 'h2 button'
    ];

    for (const selector of selectors) {
      const element = jobCard.querySelector(selector);
      if (element && this.isElementVisible(element)) {
        return element;
      }
    }

    // Fallback to job card itself or any visible link
    if (this.isElementVisible(jobCard)) {
      return jobCard;
    }

    const links = jobCard.querySelectorAll('a[href], button');
    for (const link of links) {
      if (this.isElementVisible(link) && !link.href?.includes('/jobseeker/home')) {
        return link;
      }
    }

    return null;
  }

  clickElement(element) {
    try {
      if (!element) return false;

      // Scroll into view
      element.scrollIntoView({ behavior: 'smooth', block: 'center' });

      // Create realistic click events
      const rect = element.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;

      const events = [
        new MouseEvent('mousedown', {
          bubbles: true, cancelable: true, view: window,
          button: 0, buttons: 1, clientX: centerX, clientY: centerY
        }),
        new MouseEvent('mouseup', {
          bubbles: true, cancelable: true, view: window,
          button: 0, buttons: 0, clientX: centerX, clientY: centerY
        }),
        new MouseEvent('click', {
          bubbles: true, cancelable: true, view: window,
          button: 0, buttons: 0, clientX: centerX, clientY: centerY
        })
      ];

      if (element.focus) element.focus();
      events.forEach(event => element.dispatchEvent(event));
      element.click(); // Fallback

      return true;
    } catch (error) {
      this.log("❌ Error clicking element:", error);
      return false;
    }
  }

  // ========================================
  // APPLICATION STATUS & COMPLETION
  // ========================================

  checkApplicationSuccess() {
    const url = window.location.href;
    if (url.includes("success") || url.includes("confirmation") || url.includes("applied")) {
      return true;
    }

    const successSelectors = [".application-success", ".success-message", ".confirmation"];
    if (successSelectors.some(selector => this.querySelector(selector))) {
      return true;
    }

    const pageText = document.body.innerText?.toLowerCase() || "";
    return pageText.includes("application submitted") ||
      pageText.includes("successfully applied") ||
      pageText.includes("thank you for applying") ||
      pageText.includes("application complete");
  }

  async checkAlreadyApplied() {
    const pageText = document.body.innerText?.toLowerCase() || "";

    if (pageText.includes("you've applied to this job") ||
      pageText.includes("already applied")) {
      return true;
    }

    const appliedSelectors = [".applied-status", ".application-submitted", ".already-applied"];
    return appliedSelectors.some(selector => this.querySelector(selector));
  }

  handleApplicationSuccess() {
    this.showUserMessage("Application submitted successfully! ✅", "success");

    if (this.state.currentJobDetails) {
      this.trackApplication(this.state.currentJobDetails);
    }

    if (this.state.lastClickedJobCard) {
      this.markJobCard(this.state.lastClickedJobCard, "applied");
    }

    this.completeCurrentApplication();
  }

  handleApplicationFailure() {
    this.showUserMessage("Application failed", "error");

    if (this.state.lastClickedJobCard) {
      this.markJobCard(this.state.lastClickedJobCard, "error");
    }

    this.completeCurrentApplication();
  }

  handleAlreadyApplied() {
    this.showUserMessage("Job already applied to", "info");

    if (this.state.lastClickedJobCard) {
      this.markJobCard(this.state.lastClickedJobCard, "already_applied");
    }

    this.completeCurrentApplication();
  }

  handleApplicationTimeout() {
    this.showUserMessage("Application timeout - moving to next job", "warning");

    if (this.state.lastClickedJobCard) {
      this.markJobCard(this.state.lastClickedJobCard, "error");
    }

    this.completeCurrentApplication();
  }

  completeCurrentApplication() {
    this.state.isApplicationInProgress = false;
    this.state.applicationStartTime = null;
    this.state.formDetected = false;
    this.state.processedCount++;
    this.state.lastActivity = Date.now();
  }

  completeAutomation() {
    this.showUserMessage("All jobs processed! 🎉", "completed");
    this.state.isRunning = false;
    this.state.currentPhase = 'completed';
    this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
  }

  // ========================================
  // PAGE NAVIGATION
  // ========================================

  async goToNextPage() {
    try {
      const nextButton = this.querySelector(this.config.selectors.nextPageButton[0]);
      if (nextButton && !nextButton.disabled) {
        this.clickElement(nextButton);
        await this.delay(this.config.delays.pageLoad);

        const { jobsFound } = this.checkIfJobsFound();
        return jobsFound;
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  checkIfJobsFound() {
    const jobCards = this.getJobCards();

    if (jobCards.length === 0) {
      // Check for explicit "no results" indicators
      const noResultsFound = this.config.selectors.noJobsFound.some(selector =>
        this.querySelector(selector)
      );

      if (noResultsFound) {
        return { jobsFound: false, jobCount: 0 };
      }

      // Check page text
      const pageText = document.body.textContent?.toLowerCase() || "";
      if (pageText.includes("no jobs found") ||
        pageText.includes("0 jobs") ||
        pageText.includes("no results")) {
        return { jobsFound: false, jobCount: 0 };
      }
    }

    return { jobsFound: jobCards.length > 0, jobCount: jobCards.length };
  }

  // ========================================
  // DATA MANAGEMENT
  // ========================================

  async loadUserProfile() {
    if (this.userProfile) return;

    try {
      this.showUserMessage("🔄 Loading user profile...", "info");
      this.userProfile = await this.userService.getUserDetails();
      this.showUserMessage("✅ User profile loaded", "success");
    } catch (error) {
      this.showUserMessage("❌ Failed to load user profile", "warning");
      this.log("Failed to load user profile:", error);
    }
  }

  storeJobData() {
    const jobData = {
      description: this.extractJobDescriptionText(),
      timestamp: Date.now(),
    };
    chrome.storage.local.set({ currentJobData: jobData });
  }

  async getStoredJobData() {
    return new Promise((resolve) => {
      chrome.storage.local.get(["currentJobData"], (result) => {
        if (result.currentJobData) {
          const jobData = result.currentJobData;
          if (Date.now() - jobData.timestamp < 300000) { // 5 minutes
            resolve(jobData.description);
            return;
          }
        }
        resolve("");
      });
    });
  }

  extractJobDescriptionText() {
    try {
      const descElement = this.querySelector(this.config.selectors.jobDescription.join(', '));
      return descElement?.textContent?.trim() || "";
    } catch (error) {
      return "";
    }
  }

  async extractJobDescription() {
    try {
      this.showUserMessage("Extracting job details...", "info");

      const jobDescription = {
        title: DomUtils.extractText(["h1", ".job-title", "[data-testid='job-title']"]),
        company: DomUtils.extractText([".company-name", "[data-testid='company-name']"]),
        location: DomUtils.extractText([".location", "[data-testid='location']"]),
        salary: DomUtils.extractText([".salary", "[data-testid='salary']"]),
      };

      const fullDescElement = this.querySelector(this.config.selectors.jobDescription.join(', '));
      if (fullDescElement) {
        jobDescription.fullDescription = fullDescElement.textContent?.trim();
      }

      return jobDescription;
    } catch (error) {
      this.log("❌ Error extracting job details:", error);
      return { title: document.title || "Job Position" };
    }
  }

  async trackApplication(jobDetails) {
    try {
      if (!this.userProfile) return;
      console.log(this.userProfile)
      await this.applicationTracker.updateApplicationCount();
      await this.applicationTracker.saveAppliedJob({
        ...jobDetails,
        userId: this.userProfile.userId,
        applicationPlatform: "ziprecruiter",
      });
    } catch (error) {
      this.log("Error tracking application:", error);
    }
  }

  // ========================================
  // TASK DATA MANAGEMENT
  // ========================================

  async requestSearchTaskData() {
    this.log("📡 Requesting search task data");
    this.showUserMessage("Fetching search configuration...", "info");

    const success = this.safeSendPortMessage({ type: "GET_SEARCH_TASK" });
    if (!success) {
      throw new Error("Failed to request search task data");
    }
  }

  async requestApplicationTaskData() {
    this.log("📡 Requesting application task data");
    this.showUserMessage("Fetching application configuration...", "info");

    const success = this.safeSendPortMessage({ type: "GET_APPLICATION_TASK" });
    if (!success) {
      throw new Error("Failed to request application task data");
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
          : this.getDefaultSearchPattern(),
      };

      if (data.profile && !this.userProfile) {
        this.userProfile = data.profile;
        this.showUserMessage("👤 User profile loaded", "success");
      }

      // Start processing after data is loaded
      setTimeout(() => this.startJobProcessing(), 1000);
    } catch (error) {
      this.handleError('Error processing search data', error);
    }
  }

  handleApplicationTaskData(data) {
    try {
      this.log("📊 Processing application task data");

      if (data?.profile && !this.userProfile) {
        this.userProfile = data.profile;
        this.showUserMessage("👤 User profile loaded", "success");
      }

      // Start application processing
      setTimeout(() => this.processCurrentApplication(), 1000);
    } catch (error) {
      this.handleError('Error processing application data', error);
    }
  }

  // ========================================
  // FORM DETECTION OBSERVER
  // ========================================

  setupFormDetectionObserver() {
    try {
      this.formObserver = new MutationObserver(async (mutations) => {
        // Only process if we're in an application process
        if (this.state.isApplicationInProgress) {

          // Check for form modal first
          const hasForm = this.config.selectors.modalContainer.some(selector => {
            const element = this.querySelector(selector);
            return element && this.isElementVisible(element);
          });

          if (hasForm && !this.state.formDetected) {
            this.state.formDetected = true;
            this.log("Form detected via observer");
            setTimeout(() => this.processApplicationForm(), 1000);
            return; // Exit early if form is found
          }

          // If no form detected and we've been waiting for a bit, check for instant success
          if (!this.state.formDetected && this.state.applicationStartTime) {
            const waitTime = Date.now() - this.state.applicationStartTime;

            // After 8 seconds of no form, check for instant success indicators
            if (waitTime > 8000) {
              const instantSuccess = await this.checkForInstantSuccess();

              if (instantSuccess) {
                this.log("Instant application success detected");
                this.handleApplicationSuccess();
                return;
              }

              // After 8 seconds, check for "already applied" status
              if (waitTime > 8000) {
                const alreadyApplied = await this.checkAlreadyApplied();

                if (alreadyApplied) {
                  this.log("Already applied status detected");
                  this.handleAlreadyApplied();
                  return;
                }
              }
            }
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

  async checkForInstantSuccess() {
    try {
      // Method 1: Check for "Applied" button
      const appliedSelectors = [
        'button[aria-label*="Applied"]',
        'button:contains("Applied")',
        '.apply-button:contains("Applied")'
      ];

      for (const selector of appliedSelectors) {
        let element;
        if (selector.includes(':contains')) {
          // Handle :contains selector manually
          const buttons = document.querySelectorAll('button');
          element = Array.from(buttons).find(btn =>
            (btn.textContent || btn.innerText || '').includes('Applied')
          );
        } else {
          element = document.querySelector(selector);
        }

        if (element && this.isElementVisible(element)) {
          return true;
        }
      }

      // Method 2: Check for success messages in page content
      const pageText = document.body.innerText?.toLowerCase() || '';
      const successPhrases = [
        'application submitted',
        'successfully applied',
        'thank you for applying',
        'application complete',
        'application received',
        'your application has been submitted'
      ];

      if (successPhrases.some(phrase => pageText.includes(phrase))) {
        return true;
      }

      // Method 3: Check URL for success indicators
      const url = window.location.href.toLowerCase();
      if (url.includes('success') || url.includes('confirmation') || url.includes('applied')) {
        return true;
      }

      // Method 4: Check for success elements
      const successSelectors = [
        '.application-success',
        '.success-message',
        '.confirmation',
        '[data-testid*="success"]',
        '[class*="success"]'
      ];

      for (const selector of successSelectors) {
        const element = document.querySelector(selector);
        if (element && this.isElementVisible(element)) {
          return true;
        }
      }

      return false;
    } catch (error) {
      this.log("Error checking for instant success:", error);
      return false;
    }
  }

  isOnApplicationPage() {
    const url = window.location.href;
    return this.config.urlPatterns.applyPage.test(url) ||
      this.config.urlPatterns.jobPage.test(url);
  }

  // ========================================
  // HEALTH MONITORING
  // ========================================

  performHealthCheck() {
    try {
      // Check for stuck applications
      if (this.state.isApplicationInProgress && this.state.applicationStartTime) {
        const applicationTime = Date.now() - this.state.applicationStartTime;

        if (applicationTime > this.config.timeouts.applicationTimeout) {
          this.log("Application timeout detected - resetting");
          this.handleApplicationTimeout();
        }
      }

      // Check for inactive automation
      if (this.state.isRunning) {
        const inactiveTime = Date.now() - this.state.lastActivity;

        if (inactiveTime > 120000) { // 2 minutes
          this.log("Automation inactive - attempting recovery");
          this.recoverFromInactivity();
        }
      }
    } catch (error) {
      this.log("Error in health check:", error);
    }
  }

  recoverFromInactivity() {
    if (this.state.isApplicationInProgress) {
      this.completeCurrentApplication();
    }

    this.state.lastActivity = Date.now();

    if (this.state.currentPhase === 'searching') {
      this.processJobQueue();
    }
  }

  // ========================================
  // UTILITY METHODS
  // ========================================

  resetJobProcessingState() {
    this.state.currentJobIndex = 0;
    this.state.processedCount = 0;
    this.state.lastActivity = Date.now();
    this.state.currentJobDetails = null;
    this.state.lastClickedJobCard = null;
  }

  querySelector(selector) {
    const element = document.querySelector(selector);
    return element && this.isElementVisible(element) ? element : null;
  }

  findElementByIndicator(indicator) {
    if (indicator.includes(":contains")) {
      const text = indicator.match(/contains\("(.+)"\)/)?.[1];
      if (text) {
        const elements = document.querySelectorAll("*");
        return Array.from(elements).find(el =>
          el.textContent?.includes(text) && this.isElementVisible(el)
        );
      }
    }
    return this.querySelector(indicator);
  }

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

  getSearchLinkPattern() {
    return /^https:\/\/(www\.)?ziprecruiter\.com\/(job|Job|partner|apply).*$/;
  }

  async waitForPageLoad() {
    if (document.readyState !== "complete") {
      await new Promise(resolve => {
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
      const pageType = this.detectPageType();

      if (pageType !== 'unknown') {
        await this.initializePage();
        return;
      }

      await this.delay(1000);
    }

    throw new Error("Timeout waiting for valid page");
  }

  delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ========================================
  // MESSAGE HANDLING
  // ========================================

  handlePortMessage(message) {
    try {
      const { type, data } = message || {};
      if (!type) return;

      this.log(`📨 Handling message: ${type}`);

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
          this.log("📡 Keepalive acknowledged");
          break;

        case "DUPLICATE":
          this.showUserMessage("Job already processed", "warning");
          this.completeCurrentApplication();
          break;

        case "SEARCH_NEXT":
          this.handleSearchNext(data);
          break;

        default:
          this.log(`❓ Unhandled message type: ${type}`);
      }
    } catch (error) {
      this.handleError('Error handling message', error);
    }
  }

  handleSuccessMessage(data) {
    if (data?.submittedLinks !== undefined) {
      this.handleSearchTaskData(data);
    } else if (data?.profile !== undefined && !this.userProfile) {
      this.handleApplicationTaskData(data);
    }
  }

  handleErrorMessage(data) {
    this.showUserMessage(`Error: ${data?.message || "Unknown error"}`, "error");
  }

  handleSearchNext(data) {
    if (data) {
      this.log("📨 Received SEARCH_NEXT:", data);

      if (data.submittedLinks) {
        this.searchData.submittedLinks = data.submittedLinks;
      }

      if (data.current !== undefined) {
        this.searchData.current = data.current;
      }
    }

    if (!this.state.isApplicationInProgress) {
      setTimeout(() => this.processJobQueue(), 1000);
    }
  }

  // ========================================
  // ERROR HANDLING
  // ========================================

  handleError(message, error) {
    this.log(`❌ ${message}:`, error);
    this.showUserMessage(`${message}: ${error.message}`, "error");
    this.reportError(error, { action: message });
  }

  // ========================================
  // USER MESSAGING
  // ========================================

  showUserMessage(message, type = "info") {
    if (this.statusOverlay) {
      const messageMap = {
        success: () => this.statusOverlay.addSuccess(message),
        error: () => this.statusOverlay.addError(message),
        warning: () => this.statusOverlay.addWarning(message),
        searching: () => this.statusOverlay.addBotMessage(message, "searching"),
        applying: () => this.statusOverlay.addBotMessage(message, "applying"),
        completed: () => this.statusOverlay.addBotMessage(message, "completed"),
      };

      const handler = messageMap[type] || (() => this.statusOverlay.addInfo(message));
      handler();
    }
  }

  // ========================================
  // SESSION MANAGEMENT
  // ========================================

  async setSessionContext(sessionContext) {
    try {
      await super.setSessionContext(sessionContext);

      this.sessionContext = sessionContext;

      // Set basic properties
      if (sessionContext.sessionId) this.sessionId = sessionContext.sessionId;
      if (sessionContext.platform) this.platform = sessionContext.platform;
      if (sessionContext.userId) this.userId = sessionContext.userId;
      if (sessionContext.apiHost) this.sessionApiHost = sessionContext.apiHost;

      // Set user profile
      if (sessionContext.userProfile) {
        this.userProfile = this.userProfile
          ? { ...this.userProfile, ...sessionContext.userProfile }
          : sessionContext.userProfile;
      }

      // Update form handler if it exists
      if (this.formHandler && this.userProfile) {
        this.formHandler.userData = this.userProfile;
      }

      this.log("✅ Session context set successfully", {
        hasUserProfile: !!this.userProfile,
        userId: this.userId,
        sessionId: this.sessionId?.slice(-6),
      });
    } catch (error) {
      this.log("❌ Error setting session context:", error);
    }
  }

  // ========================================
  // PLATFORM-SPECIFIC UTILITIES
  // ========================================

  getPlatformDomains() {
    return ["https://www.ziprecruiter.com"];
  }

  getDefaultSearchPattern() {
    return /^https:\/\/(www\.)?ziprecruiter\.com\/(job|jobs|apply).*$/;
  }

  getApiHost() {
    return this.sessionApiHost ||
      this.sessionContext?.apiHost ||
      this.config.apiHost;
  }

  platformSpecificUrlNormalization(url) {
    return url
      .replace(/[?&](utm_|source=|campaign=)[^&]*/g, "")
      .replace(/[?&]+$/, "");
  }

  // ========================================
  // CLEANUP
  // ========================================

  cleanup() {
    // Clear timers
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // Disconnect observers
    if (this.formObserver) {
      this.formObserver.disconnect();
      this.formObserver = null;
    }

    // Clear references
    this.formHandler = null;
    this.cachedJobDescription = null;

    // Reset state
    if (this.state.processedJobIds) {
      this.state.processedJobIds.clear();
    }
    this.resetJobProcessingState();

    // Call parent cleanup
    super.cleanup();

    this.log("🧹 Cleanup completed");
  }

  // ========================================
  // LOGGING
  // ========================================

  log(message, data = {}) {
    const contextInfo = {
      platform: this.platform,
      sessionId: this.sessionId?.slice(-6),
      phase: this.state.currentPhase,
      isRunning: this.state.isRunning,
      isApplicationInProgress: this.state.isApplicationInProgress,
      processedCount: this.state.processedCount
    };

    console.log(`🤖 [ZipRecruiter] ${message}`, { ...contextInfo, ...data });
  }
}