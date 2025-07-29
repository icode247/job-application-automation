// platforms/glassdoor/glassdoor.js - Glassdoor Platform Automation (CLEANED)
import BasePlatformAutomation from "../../shared/base/base-platform-automation.js";
import FormHandler from "../../shared/indeed_glassdoors/form-handler.js";
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

    // Job queue management
    this.jobQueue = [];
    this.currentJobIndex = 0;
    this.queueInitialized = false;
    this.currentExpandedJob = null;

    // Initialize services
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
      platform: "glassdoor",
      maxRedirectAttempts: 3,
      currentRedirectAttempts: 0,
      lastClickedJobCard: null,
      formDetectionAttempts: 0,
      maxFormDetectionAttempts: 5,
      currentJobDescription: "",
    };

    // Glassdoor-specific configuration
    this.glassdoorConfig = {
      selectors: {
        // Job card selectors
        jobCards: ".JobsList_jobListItem__wjTHv, li[data-test='jobListing']",
        jobTitle: ".JobCard_jobTitle__GLyJ1, a[data-test='job-title']",
        companyName:
          ".EmployerProfile_compactEmployerName__9MGcV, span.employer-name",
        location: ".JobCard_location__Ds1fM, div[data-test='emp-location']",
        salary: "[data-test='detailSalary'], .salaryEstimate",

        // Apply button selectors
        applyButton:
          "button[data-test='easyApply'], .EasyApplyButton_content__1cGPo, button.applyButton, a.applyButton",
        easyApplyButton: ".button_Button__MlD2g.button-base_Button__knLaX",

        // Job description
        jobDescription:
          ".JobDetails_jobDescription__uW_fK, [class*='jobDescription'], [data-test='description'], [data-test='jobDescriptionText']",

        // Filters and pagination
        easyApplyFilter:
          "[data-test='EASY_APPLY-filter'], input[value='EASY_APPLY']",
        nextPage: "[data-test='pagination-next'], .nextButton",

        // External application indicators
        externalIndicators: [
          "[data-test='external-apply']",
          "a[target='_blank'][rel='nofollow']",
        ],

        popupClose: ".popover-x-button-close",
      },
      timeouts: {
        standard: 2000,
        extended: 5000,
        maxTimeout: 300000, // 5 minutes
        applicationTimeout: 3 * 60 * 1000, // 3 minutes,
        redirectTimeout: 8000, // Longer timeout for redirects
      },
      delays: {
        betweenJobs: 3000,
        formFilling: 1000,
        pageLoad: 3000,
        jobCardExpansion: 2000,
      },
      brandColor: "#4a90e2", // FastApply brand blue
      // URL patterns for detecting Glassdoor platform
      urlPatterns: {
        searchPage: /glassdoor\.com\/(Job|Search)/,
        jobPage: /glassdoor\.com\/job\/|glassdoor\.com\/Job\//,
        applyPage: /glassdoor\.com\/apply\//,
      },
    };

    // Application state
    this.applicationState = {
      isApplicationInProgress: false,
      currentJobInfo: null,
      processedUrls: new Set(),
    };

    // User data and job management
    this.userData = null;
    this.profile = null;

    // Prevent duplicate starts
    this.searchProcessStarted = false;

    // Initialize FormHandler
    this.formHandler = null;

    // Set up health check timer
    this.healthCheckTimer = setInterval(() => this.checkHealth(), 30000);

    // Set up mutation observer to detect form elements appearing
    this.setupFormDetectionObserver();
  }

  // ========================================
  // INITIALIZATION
  // ========================================

  async initialize() {
    await super.initialize();

    // Initialize on document ready
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () => this.init());
    } else {
      this.init();
    }
  }

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

      this.showUserMessage(
        "Authentication verified - ready to proceed!",
        "success"
      );
      return {
        canProceed: true,
        reason: "authenticated",
        message: "Ready to start job search",
      };
    } catch (error) {
      const errorMessage =
        "❌ Error checking authentication status - please refresh and try again";
      return { canProceed: false, reason: "error", message: errorMessage };
    }
  }

  checkForCaptcha() {
    const captchaSelectors = [
      'p:contains("Please help us protect Glassdoor by verifying that you\'re a real person")',
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
          message:
            "🛡️ CAPTCHA verification required. Please complete the verification challenge before continuing.",
          element: element,
        };
      }
    }

    const protectionTexts = [
      "please help us protect glassdoor",
      "verify that you're a real person",
      "verification required",
      "complete the challenge",
      "prove you're human",
    ];

    const bodyText = document.body.textContent.toLowerCase();
    for (const text of protectionTexts) {
      if (bodyText.includes(text)) {
        return {
          isValid: false,
          message:
            "🛡️ Verification challenge detected. Please complete the human verification before proceeding.",
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
        "button.Qjj2Q_nVhoQ0W7y9NvKF",
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
          message:
            "🔐 Please log in to your Glassdoor account before starting the job search automation.",
          element: element,
        };
      }
    }

    for (const selector of loginIndicators.loginPageElements) {
      const element = document.querySelector(selector);
      if (element && this.isElementVisible(element)) {
        return {
          isLoggedIn: false,
          message:
            "🔐 Login required. Please sign in to your Glassdoor account to continue.",
          element: element,
        };
      }
    }

    const currentUrl = window.location.href.toLowerCase();
    const loginUrlPatterns = ["/login", "/signin", "/auth", "/account/login"];

    for (const pattern of loginUrlPatterns) {
      if (currentUrl.includes(pattern)) {
        return {
          isLoggedIn: false,
          message:
            "🔐 You are on the login page. Please sign in to continue with job applications.",
          element: null,
        };
      }
    }

    return {
      isLoggedIn: true,
      message:
        "⚠️ Login status unclear - proceeding with caution. If you encounter issues, please ensure you're logged in.",
      element: null,
    };
  }

  async start(params = {}) {
    try {
      if (this.isRunning) {
        return true;
      }

      const authCheck = await this.checkAuthenticationAndCaptcha();
      if (!authCheck.canProceed) {
        this.showUserMessage(
          "❌ Cannot start automation: " + authCheck.message,
          "error"
        );
        return false;
      }

      this.isRunning = true;
      this.state.isRunning = true;

      if (!this.userProfile && this.userId) {
        try {
          this.showUserMessage(
            "🔄 Attempting to fetch user profile during start...",
            "info"
          );
          this.userProfile = await this.userService.getUserDetails();
          this.profile = this.userProfile;
          this.showUserMessage(
            "✅ User profile fetched during start",
            "success"
          );
        } catch (error) {
          this.showUserMessage(
            "❌ Failed to fetch user profile during start: " + error.message,
            "warning"
          );
          console.error("❌ Failed to fetch user profile during start:", error);
        }
      }

      await this.initializeFormHandler();

      this.config = { ...this.config, ...params };

      this.updateProgress({
        total: params.jobsToApply || 0,
        completed: 0,
        current: "Starting Glassdoor automation...",
      });

      await this.waitForPageLoad();
      await this.detectPageTypeAndStart();

      return true;
    } catch (error) {
      this.showUserMessage(
        `Error starting automation: ${error.message}`,
        "error"
      );
      this.reportError(error, { action: "start" });
      this.isRunning = false;
      this.state.isRunning = false;
      return false;
    }
  }

  async initializeFormHandler() {
    const jobDescription = await this.getStoredJobData();

    this.formHandler = new FormHandler({
      platform: "glassdoor",
      userData: this.profile,
      enableDebug: this.config.debug,
      host: this.getApiHost(),
      jobDescription: jobDescription,
      logger: this.showUserMessage,
    });
  }

  // ========================================
  // PAGE TYPE DETECTION
  // ========================================

  async detectPageTypeAndStart() {
    const url = window.location.href;

    if (this.isGlassdoorJobListingPage(url)) {
      await this.startJobListingProcess();
    } else if (this.isSmartApplyPage(url)) {
      await this.startApplicationProcess();
    } else if (this.isGlassdoorFormPage(url)) {
      this.showUserMessage(
        "I have started the gathering and filling of the form, please wait...",
        "info"
      );
      await this.handleGlassdoorFormPage();
    } else {
      this.showUserMessage("Waiting for job page to load...", "info");
      await this.waitForValidPage();
    }
  }

  isGlassdoorJobListingPage(url) {
    return this.glassdoorConfig.urlPatterns.searchPage.test(url);
  }

  isSmartApplyPage(url) {
    return url.includes("smartapply.indeed.com");
  }

  isGlassdoorFormPage(url) {
    return (
      this.glassdoorConfig.urlPatterns.applyPage.test(url) ||
      document.querySelector(".jobsOverlayModal") ||
      document.querySelector(".modal-content form")
    );
  }

  // ========================================
  // JOB LISTING PROCESS
  // ========================================

  async startJobListingProcess() {
    try {
      if (this.searchProcessStarted) {
        return;
      }

      this.searchProcessStarted = true;
      // Get search task data from background
      await this.fetchSearchTaskData();
    } catch (error) {
      this.searchProcessStarted = false;
      this.showUserMessage(`Search error: ${error.message}`, "error");
      this.reportError(error, { phase: "jobListing" });
    }
  }

  async fetchSearchTaskData() {
    const success = this.safeSendPortMessage({ type: "GET_SEARCH_TASK" });
    if (!success) {
      throw new Error("Failed to request search task data");
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
        this.showUserMessage(
          "👤 User profile loaded from search data",
          "success"
        );
        // Reinitialize FormHandler with profile data
        this.initializeFormHandler();
      }
      // Start the job processing flow
      setTimeout(() => this.startJobProcessing(), 1000);
    } catch (error) {
      this.showUserMessage(
        `Error processing search data: ${error.message}`,
        "error"
      );
    }
  }

  // ========================================
  // JOB PROCESSING FLOW
  // ========================================

  async startJobProcessing() {
    try {
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
      this.state.pendingApplication = false;
      this.state.applicationStartTime = null;
      this.state.currentRedirectAttempts = 0;
      this.state.lastClickedJobCard = null;

      // Apply search filters first
      await this.applySearchFilters();

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

      if (this.state.isApplicationInProgress || this.state.pendingApplication) {
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
      this.state.lastClickedJobCard = jobCard;

      this.markJobCard(jobCard, "processing");

      const jobDetails = this.extractJobDetailsFromCard(jobCard);
      this.currentJobDetails = jobDetails;
      this.state.currentJobDescription = this.extractJobDescription();

      jobCard.querySelector("a.JobCard_trackingLink__HMyun")?.click();
      await this.delay(this.glassdoorConfig.timeouts.standard);

      this.handlePopups();

      const applyButton = await this.findApplyButton();

      if (!applyButton) {
        this.showUserMessage(
          `Skipping: ${jobDetails.title} (no Easy Apply)`,
          "info"
        );
        this.markJobCard(jobCard, "skipped");
        this.state.processedCards.add(this.getJobCardId(jobCard));
        this.state.processedCount++;

        setTimeout(() => this.processNextJob(), 1000);
        return;
      }

      this.showUserMessage(`Applying to: ${jobDetails.title} 🚀`, "applying");

      this.state.isApplicationInProgress = true;
      this.state.applicationStartTime = Date.now();
      this.state.pendingApplication = true;
      this.state.formDetected = false;
      this.state.currentRedirectAttempts = 0;

      this.state.processedCards.add(this.getJobCardId(jobCard));
      this.storeJobData();

      applyButton.click();
    } catch (error) {
      this.showUserMessage(`Error processing job: ${error.message}`, "error");
      this.resetApplicationState();
      setTimeout(() => this.processNextJob(), 3000);
    }
  }

  // ========================================
  // APPLICATION FORM HANDLING (USING FORMHANDLER)
  // ========================================

  async startApplicationProcess() {
    try {
      this.showUserMessage("Processing SmartApply form...", "applying");

      if (!this.profile) {
        this.profile = await this.getProfileData();
      }

      if (this.profile) {
        await this.handleFormWithFormHandler();
      } else {
        this.showUserMessage("Error: No profile data available", "error");
      }
    } catch (error) {
      this.showUserMessage(`Application error: ${error.message}`, "error");
      this.reportError(error, { phase: "application" });
    }
  }

  async handleGlassdoorFormPage() {
    try {
      this.showUserMessage("Filling application form...", "applying");

      if (!this.profile) {
        this.profile = await this.getProfileData();
      }

      if (this.profile) {
        this.state.isApplicationInProgress = true;
        this.state.applicationStartTime = Date.now();
        this.state.formDetected = true;

        const success = await this.handleFormWithFormHandler();

        this.resetApplicationState();

        if (success) {
          this.showUserMessage(
            "Application submitted successfully! ✅",
            "success"
          );
        } else {
          this.showUserMessage("Failed to complete application", "error");
        }
      } else {
        this.showUserMessage("Error: No profile data available", "error");
      }
    } catch (error) {
      this.showUserMessage(`Form error: ${error.message}`, "error");
      this.resetApplicationState();
    }
  }

  async handleDetectedForm() {
    try {
      this.showUserMessage("Processing application form...", "applying");

      if (!this.profile) {
        this.profile = await this.getProfileData();
      }

      if (this.profile) {
        const success = await this.handleFormWithFormHandler();

        if (success) {
          this.showUserMessage(
            "Application submitted successfully! ✅",
            "success"
          );
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
      } else {
        this.showUserMessage("Error: No profile data available", "error");
        this.resetApplicationState();

        if (this.state.isRunning) {
          setTimeout(() => this.processNextJob(), 2000);
        }
      }
    } catch (error) {
      this.showUserMessage(`Form processing error: ${error.message}`, "error");
      this.resetApplicationState();

      if (this.state.isRunning) {
        setTimeout(() => this.processNextJob(), 2000);
      }
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
          platform: "glassdoor",
          userData: this.profile,
          enableDebug: this.config.debug,
          host: this.getApiHost(),
          jobDescription: latestJobDescription,
          logger: this.showUserMessage,
        });
      }

      // Now FormHandler has the correct job description
      const success = await this.formHandler.fillCompleteForm();
      return success;
    } catch (error) {
      this.markLastJobCardIfAvailable("error");
      return false;
    }
  }

  // ========================================
  // JOB DISCOVERY UTILITIES
  // ========================================

  getUnprocessedJobCards() {
    let allCards;

    const jobListContainer = document.querySelector(
      "ul.JobsList_jobsList__lqjTr, ul[aria-label='Jobs List']"
    );
    if (jobListContainer) {
      allCards = jobListContainer.querySelectorAll(
        this.glassdoorConfig.selectors.jobCards
      );
    } else {
      allCards = document.querySelectorAll(
        this.glassdoorConfig.selectors.jobCards
      );
    }

    return Array.from(allCards).filter((card) => {
      const cardId = this.getJobCardId(card);
      return !this.state.processedCards.has(cardId);
    });
  }

  async goToNextPage() {
    try {
      const nextButton = document.querySelector(
        this.glassdoorConfig.selectors.nextPage
      );
      if (nextButton && this.isElementVisible(nextButton)) {
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
        this.glassdoorConfig.selectors.jobDescription
      );
      return jobDescElement ? jobDescElement.textContent.trim() : "";
    } catch (error) {
      return "";
    }
  }

  async findApplyButton() {
    const allButtons = Array.from(
      document.querySelectorAll("button, a.applyButton")
    );

    for (const btn of allButtons) {
      if (this.isElementVisible(btn)) {
        const buttonText = btn.textContent.trim();
        if (buttonText === "Easy Apply") {
          return btn;
        }
      }
    }

    return null;
  }

  // ========================================
  // JOB CARD MANAGEMENT
  // ========================================

  getJobCardId(jobCard) {
    const jobId =
      jobCard.getAttribute("data-jobid") || jobCard.getAttribute("data-id");
    if (jobId) {
      return jobId;
    }

    const jobLink = jobCard.querySelector(
      '.JobCard_trackingLink__HMyun, a[data-test="job-link"]'
    );
    if (jobLink && jobLink.href) {
      const match = jobLink.href.match(/jobListingId=(\d+)/);
      if (match && match[1]) {
        return match[1];
      }
    }

    const link =
      jobCard.querySelector(this.glassdoorConfig.selectors.jobTitle) ||
      jobCard.querySelector("a");
    if (link && link.href) {
      const jobListingMatch = link.href.match(/jobListingId=(\d+)/);
      if (jobListingMatch && jobListingMatch[1]) {
        return jobListingMatch[1];
      }

      const jvMatch = link.href.match(/JV_KO[^_]+_KE[^_]+_(\d+)\.htm/);
      if (jvMatch && jvMatch[1]) {
        return jvMatch[1];
      }
    }

    const title =
      jobCard.querySelector(this.glassdoorConfig.selectors.jobTitle)
        ?.textContent || "";
    const company =
      jobCard.querySelector(this.glassdoorConfig.selectors.companyName)
        ?.textContent || "";
    return `${title}-${company}`.replace(/\s+/g, "").toLowerCase();
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
      // Silently fail
    }
  }

  markLastJobCardIfAvailable(status) {
    if (this.state.lastClickedJobCard) {
      this.markJobCard(this.state.lastClickedJobCard, status);
    }
  }

  extractJobDetailsFromCard(jobCard) {
    try {
      const title =
        jobCard
          .querySelector(this.glassdoorConfig.selectors.jobTitle)
          ?.textContent?.trim() || "Unknown Position";
      const company =
        jobCard
          .querySelector(this.glassdoorConfig.selectors.companyName)
          ?.textContent?.trim() || "Unknown Company";
      const location =
        jobCard
          .querySelector(this.glassdoorConfig.selectors.location)
          ?.textContent?.trim() || "Unknown Location";
      const salary =
        jobCard
          .querySelector(this.glassdoorConfig.selectors.salary)
          ?.textContent?.trim() || "Not specified";

      let jobId = "";
      const link =
        jobCard.querySelector(this.glassdoorConfig.selectors.jobTitle) ||
        jobCard.querySelector("a");
      if (link && link.href) {
        const match = link.href.match(/jobListingId=(\d+)/);
        if (match && match[1]) {
          jobId = match[1];
        }
      }

      return {
        jobId,
        title,
        company,
        location,
        salary,
        jobUrl: link?.href || window.location.href,
        workplace: "Not specified",
        postedDate: "Not specified",
        applicants: "Not specified",
        platform: this.platform,
      };
    } catch (error) {
      return {
        jobId: "",
        title: "Unknown Position",
        company: "Unknown Company",
        location: "Unknown Location",
        jobUrl: window.location.href,
        platform: this.platform,
      };
    }
  }

  // ========================================
  // UTILITY METHODS
  // ========================================

  checkIfJobsFound() {
    try {
      const searchHeaderSelectors = ["[data-test='search-title']", ".count"];

      let searchHeader = null;
      for (const selector of searchHeaderSelectors) {
        searchHeader = document.querySelector(selector);
        if (searchHeader) break;
      }

      if (!searchHeader) {
        return { jobsFound: true };
      }

      const headerText = searchHeader.textContent.trim();
      const jobCountMatch = headerText.match(/^(\d+)\s+/);

      if (jobCountMatch) {
        const jobCount = parseInt(jobCountMatch[1], 10);
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
        return { jobsFound: false, jobCount: 0 };
      }

      const jobCards = document.querySelectorAll(
        this.glassdoorConfig.selectors.jobCards
      );
      if (jobCards.length === 0) {
        return { jobsFound: false, jobCount: 0 };
      }

      return { jobsFound: true };
    } catch (error) {
      return { jobsFound: true };
    }
  }

  applySearchFilters() {
    try {
      const easyApplyFilter = document.querySelector(
        this.glassdoorConfig.selectors.easyApplyFilter
      );
      if (easyApplyFilter && !easyApplyFilter.checked) {
        this.showUserMessage("Applying Easy Apply filter...", "searching");
        easyApplyFilter.click();
      }

      setTimeout(() => {
        const { jobsFound, jobCount } = this.checkIfJobsFound();

        if (!jobsFound) {
          this.showUserMessage("No Easy Apply jobs found", "warning");
          this.state.ready = true;
          this.state.isRunning = false;
          this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
          return;
        }

        this.state.ready = true;
      }, 2000);
    } catch (error) {
      this.state.ready = true;
    }
  }

  async trackApplication(jobDetails) {
    try {
      if (!this.userId) {
        return;
      }

      await this.applicationTracker.recordApplication({
        ...jobDetails,
        userId: this.userId,
        applicationPlatform: this.platform,
      });
    } catch (error) {
      // Silently fail
    }
  }

  handlePopups() {
    try {
      const closeButton = document.querySelector(
        this.glassdoorConfig.selectors.popupClose
      );
      if (closeButton && this.isElementVisible(closeButton)) {
        closeButton.click();
      }
    } catch (error) {
      // Ignore errors with popups
    }
  }

  checkHealth() {
    try {
      if (
        this.state.isApplicationInProgress &&
        this.state.applicationStartTime
      ) {
        const now = Date.now();
        const applicationTime = now - this.state.applicationStartTime;

        if (
          applicationTime > this.glassdoorConfig.timeouts.applicationTimeout
        ) {
          this.showUserMessage(
            "Application timeout, moving to next job",
            "warning"
          );

          this.markLastJobCardIfAvailable("error");
          this.resetApplicationState();

          if (this.state.isRunning) {
            setTimeout(() => this.processNextJob(), 2000);
          }
        }
      }

      if (this.state.isRunning) {
        const now = Date.now();
        const inactiveTime = now - this.state.lastActivity;

        if (inactiveTime > 120000) {
          this.showUserMessage("Recovering from inactivity...", "info");

          if (this.state.isApplicationInProgress) {
            this.resetApplicationState();
          }

          this.state.lastActivity = now;
          this.processNextJob();
        }
      }
    } catch (error) {
      // Silently fail
    }
  }

  resetApplicationState() {
    this.state.isApplicationInProgress = false;
    this.state.applicationStartTime = null;
    this.state.pendingApplication = false;
    this.state.formDetected = false;
    this.state.currentRedirectAttempts = 0;
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
    return this.profile || {};
  }

  setupFormDetectionObserver() {
    try {
      this.formObserver = new MutationObserver((mutations) => {
        if (this.state.isApplicationInProgress || this.isOnApplyPage()) {
          const hasForm =
            document.querySelector("form") ||
            document.querySelector(".modal-content form") ||
            document.querySelector(".jobsOverlayModal");

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
      // Silently fail
    }
  }

  isOnApplyPage() {
    const url = window.location.href;
    return url.includes("glassdoor.com/apply");
  }

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

      if (this.isGlassdoorJobListingPage(url) || this.isSmartApplyPage(url)) {
        await this.detectPageTypeAndStart();
        return;
      }

      await this.delay(1000);

      this.safeSendPortMessage({
        type: "SEND_CV_TASK_SKIP",
        data: {
          reason: "Invalid page - no search, job page, or application elements found",
          url: window.location.href
        }
      });

      this.applicationState.isApplicationInProgress = false;
      this.applicationState.applicationStartTime = null;
    }

    throw new Error("Timeout waiting for valid page");
  }

  getSearchLinkPattern() {
    return /^https:\/\/(www\.)?glassdoor\.com\/(job|Job|partner|apply).*$/;
  }

  getApiHost() {
    return this.sessionApiHost || this.sessionContext?.apiHost || this.config.apiHost;
  }

  async handleSuccessfulApplication(jobInfo) {
    try {
      this.showUserMessage(
        `✅ Successfully applied to: ${jobInfo.title}`,
        "success"
      );

      this.recordSuccessfulApplication(jobInfo);

      this.searchData.current++;
      this.updateProgress({
        completed: this.searchData.current,
        current: `Applied to: ${jobInfo.title}`,
      });

      this.safeSendPortMessage({
        type: "APPLICATION_SUCCESS",
        data: {
          jobId: this.extractJobIdFromUrl(jobInfo.url),
          title: jobInfo.title,
          company: jobInfo.company,
          location: jobInfo.location,
          jobUrl: jobInfo.url,
          platform: "glassdoor",
        },
      });

      this.resetApplicationState();
    } catch (error) {
      // Silently fail
    }
  }

  recordSuccessfulApplication(jobInfo) {
    this.searchData.submittedLinks.push({
      url: jobInfo.url,
      status: "SUCCESS",
      title: jobInfo.title,
      company: jobInfo.company,
      timestamp: Date.now(),
    });
  }

  extractJobIdFromUrl(url) {
    try {
      const match = url.match(/JV_IC(\d+)/) || url.match(/jobListingId=(\d+)/);
      return match ? match[1] : null;
    } catch (error) {
      return null;
    }
  }

  // ========================================
  // INITIALIZATION & MAIN FLOW
  // ========================================

  init() {
    try {
      const url = window.location.href;

      if (this.isGlassdoorFormPage(url)) {
        this.state.initialized = true;
        this.state.ready = true;
        this.state.formDetected = true;

        setTimeout(async () => {
          await this.handleGlassdoorFormPage();
        }, 2000);

        return;
      }

      const isSearchPage =
        this.glassdoorConfig.urlPatterns.searchPage.test(url);
      const isJobPage = this.glassdoorConfig.urlPatterns.jobPage.test(url);
      const isApplyPage = this.glassdoorConfig.urlPatterns.applyPage.test(url);

      if (isSearchPage) {
        const { jobsFound } = this.checkIfJobsFound();
        if (!jobsFound) {
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
  // MESSAGE HANDLING
  // ========================================

  handlePortMessage(message) {
    try {
      const { type, data } = message || {};
      if (!type) {
        return;
      }

      switch (type) {
        case "CONNECTION_ESTABLISHED":
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
      }
    } catch (error) {
      // Silently fail
    }
  }

  handleApplicationTaskData(data) {
    try {
      this.log("📊 Processing Glassdoor application task data:", data);

      // Only use profile from application data if we don't already have one
      if (data?.profile && !this.userProfile) {
        this.userProfile = data.profile;
        this.profile = data.profile;
        this.showUserMessage(
          "👤 User profile loaded from application task data",
          "success"
        );

        // Update form handler
        if (this.formHandler) {
          this.formHandler.userData = this.userProfile;
        }
      }

      this.showUserMessage("Application initialization complete", "success");
    } catch (error) {
      this.showUserMessage(
        "❌ Error processing application task data: " + error.message,
        "error"
      );
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
    this.log(`Error: ${data?.message || "Unknown error"}`, "error");
  }

  // ========================================
  // USER MESSAGING
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
  // CLEANUP & SESSION MANAGEMENT
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

      this.log("✅ Glassdoor session context set successfully", {
        hasUserProfile: !!this.userProfile,
        userId: this.userId,
        sessionId: this.sessionId,
        profileName: this.userProfile?.name || this.userProfile?.firstName,
        profileEmail: this.userProfile?.email,
      });
    } catch (error) {
      console.error("❌ Error setting Glassdoor session context:", error);
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
    }

    if (this.formObserver) {
      this.formObserver.disconnect();
    }

    // Cleanup FormHandler
    if (this.formHandler) {
      this.formHandler = null;
    }

    this.jobQueue = [];
    this.currentJobIndex = 0;
    this.queueInitialized = false;
    this.searchProcessStarted = false;
    this.currentExpandedJob = null;

    this.applicationState = {
      isApplicationInProgress: false,
      currentJobInfo: null,
      processedUrls: new Set(),
    };

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
      platform: "glassdoor",
      maxRedirectAttempts: 3,
      currentRedirectAttempts: 0,
      lastClickedJobCard: null,
      formDetectionAttempts: 0,
      maxFormDetectionAttempts: 5,
      currentJobDescription: "",
    };
  }

  getPlatformDomains() {
    return "https://www.glassdoor.com/";
  }
}
