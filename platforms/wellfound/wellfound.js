// platforms/wellfound/wellfound.js
import BasePlatformAutomation from "../../shared/base/base-platform-automation.js";
import WellfoundFormHandler from "./wellfound-form-handler.js";
import {
  AIService,
  ApplicationTrackerService,
  UserService,
} from "../../services/index.js";
import { WellfoundFilters } from "./wellfound-filter-handler.js";

export default class WellfoundPlatform extends BasePlatformAutomation {
  constructor(config) {
    super(config);
    this.platform = "wellfound";
    this.baseUrl = "https://wellfound.com";

    this.jobQueue = [];
    this.currentJobIndex = 0;
    this.isLoadingMore = false;
    this.queueInitialized = false;

    // Initialize Wellfound-specific services
    this.aiService = new AIService({ apiHost: this.getApiHost() });
    this.applicationTracker = new ApplicationTrackerService({
      userId: this.userId,
    });
    this.userService = new UserService({ userId: this.userId });

    this.filters = new WellfoundFilters();

    this.formHandler = null;

    // Add flags to prevent duplicate starts
    this.searchProcessStarted = false;
  }

  // ========================================
  // PLATFORM-SPECIFIC IMPLEMENTATIONS (Required by base class)
  // ========================================

  getPlatformDomains() {
    return ["wellfound.com"];
  }

  getSearchLinkPattern() {
    return /^https:\/\/wellfound\.com\/jobs\/(\d+)/;
  }

  isValidJobPage(url) {
    return url.includes("wellfound.com/jobs/") && /\/jobs\/\d+/.test(url);
  }

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
          this.log("👤 User profile loaded from session context");
        } else {
          // Merge profiles, preferring non-null values
          this.userProfile = {
            ...this.userProfile,
            ...sessionContext.userProfile,
          };
          this.log("👤 User profile merged with session context");
        }
      }

      // Fetch user profile if still missing
      if (!this.userProfile && this.userId) {
        try {
          this.log("📡 Fetching user profile from user service...");
          this.userProfile = await this.userService.getUserDetails();
          this.log("✅ User profile fetched successfully");
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

      this.log("✅ Wellfound session context set successfully", {
        hasUserProfile: !!this.userProfile,
        userId: this.userId,
        sessionId: this.sessionId,
        profileName: this.userProfile?.name || this.userProfile?.firstName,
        profileEmail: this.userProfile?.email,
      });
    } catch (error) {
      console.error("❌ Error setting Wellfound session context:", error);
    }
  }

  async start(params = {}) {
    try {
      // Prevent duplicate starts
      if (this.isRunning) {
        this.log("⚠️ Automation already running, ignoring duplicate start");
        return true;
      }

      this.isRunning = true;
      this.log("▶️ Starting Wellfound automation");

      // Ensure user profile is available before starting
      if (!this.userProfile && this.userId) {
        try {
          this.log("🔄 Attempting to fetch user profile during start...");
          this.userProfile = await this.userService.getUserDetails();
          this.log("✅ User profile fetched during start");
        } catch (error) {
          console.error("❌ Failed to fetch user profile during start:", error);
        }
      }

      // Update config with parameters
      this.config = { ...this.config, ...params };

      // Update progress
      this.updateProgress({
        total: params.jobsToApply || 0,
        completed: 0,
        current: "Starting automation...",
      });

      // Wait for page to be ready
      await this.waitForPageLoad();

      // Detect page type and start appropriate automation
      await this.detectPageTypeAndStart();

      return true;
    } catch (error) {
      this.reportError(error, { action: "start" });
      this.isRunning = false; // Reset on error
      return false;
    }
  }

  handlePortMessage(message) {
    try {
      this.log("📨 Received port message:", message);

      const { type, data } = message || {};
      if (!type) {
        this.log("⚠️ Received message without type, ignoring");
        return;
      }

      switch (type) {
        case "CONNECTION_ESTABLISHED":
          this.log("✅ Port connection established with background script");
          break;

        case "SEARCH_TASK_DATA":
          this.handleSearchTaskData(data);
          break;

        case "APPLICATION_TASK_DATA":
          this.handleApplicationTaskData(data);
          break;

        case "APPLICATION_STARTING":
          this.handleApplicationStarting(data);
          break;

        case "APPLICATION_STATUS":
          this.handleApplicationStatus(data);
          break;

        case "SEARCH_NEXT":
          this.handleSearchNext(data);
          break;

        case "DUPLICATE":
          this.handleDuplicateJob(data);
          break;

        case "ERROR":
          this.handleErrorMessage(data);
          break;

        case "KEEPALIVE_RESPONSE":
          // Just acknowledge keepalive
          break;

        case "SUCCESS":
          this.handleSuccessMessage(data);
          break;

        default:
          this.log(`❓ Unhandled message type: ${type}`);
      }
    } catch (error) {
      this.log("❌ Error handling port message:", error);
    }
  }

  async findJobs() {
    // ✅ UPDATED: Return jobs from queue instead of DOM search
    return this.jobQueue.slice(this.currentJobIndex);
  }

  getApiHost() {
    return this.sessionApiHost || this.sessionContext?.apiHost || this.config.apiHost;
  }

  /**
   * Check if we're on the application page
   */
  isApplicationPage(url) {
    return this.isValidJobPage(url);
  }

  getJobTaskMessageType() {
    return "START_APPLICATION";
  }

  // ========================================
  // WELLFOUND-SPECIFIC INITIALIZATION
  // ========================================

  async initialize() {
    await super.initialize(); // Handles all common initialization

    // Initialize Wellfound-specific handlers
    this.formHandler = new WellfoundFormHandler(
      this.aiService,
      this.userService,
      this
    );
  }

  // ========================================
  // QUEUE-BASED JOB MANAGEMENT
  // ========================================

  async buildJobQueue() {
    try {
      this.log("🏗️ Building job queue from company cards...");

      // Reset queue
      this.jobQueue = [];
      this.currentJobIndex = 0;

      // Wait for company cards to load
      await this.waitForPageLoad();
      await this.delay(2000); // Give extra time for dynamic content

      // Get all company cards currently visible
      const companyCards = document.querySelectorAll(
        ".styles_component__uTjje"
      );
      this.log(`🔍 Found ${companyCards.length} company cards on page`);

      for (const companyCard of companyCards) {
        try {
          const jobs = this.extractJobsFromCompanyCard(companyCard);

          // Filter out already processed jobs
          const newJobs = jobs.filter((job) => {
            const normalizedUrl = this.normalizeUrl(job.url);
            return !this.searchData.submittedLinks.some(
              (link) => this.normalizeUrl(link.url) === normalizedUrl
            );
          });

          this.jobQueue.push(...newJobs);

          if (newJobs.length > 0) {
            this.log(
              `➕ Added ${newJobs.length} jobs from ${
                newJobs[0]?.company || "company"
              }`
            );
          }
        } catch (error) {
          this.log(`❌ Error processing company card:`, error);
          continue;
        }
      }

      this.queueInitialized = true;
      this.log(`✅ Job queue built with ${this.jobQueue.length} jobs`);

      // Log some sample jobs for debugging
      this.jobQueue.slice(0, 3).forEach((job, index) => {
        this.log(
          `📋 Job ${index + 1}: ${job.title} at ${job.company} (${
            job.location
          })`
        );
      });

      return this.jobQueue.length > 0;
    } catch (error) {
      this.log("❌ Error building job queue:", error);
      return false;
    }
  }

  extractJobsFromCompanyCard(companyCard) {
    const jobs = [];

    try {
      // Method 1: Jobs within job listing sections
      const jobListingsSection = companyCard.querySelector(
        ".styles_jobListingList__YGDNO"
      );

      if (jobListingsSection) {
        // Find all job links within this company's listings
        const jobLinksInCompany = jobListingsSection.querySelectorAll(
          "a.styles_component__UCLp3.styles_defaultLink__eZMqw.styles_jobLink__US40J"
        );

        for (const jobLink of jobLinksInCompany) {
          if (jobLink && jobLink.href) {
            const href = jobLink.href;

            // Validate the URL matches Wellfound job pattern
            if (this.getSearchLinkPattern().test(href)) {
              const jobInfo = this.createJobInfoFromLink(jobLink, companyCard);
              jobs.push(jobInfo);
              this.log(
                `📋 Found job: ${jobInfo.title} at ${jobInfo.company} (${jobInfo.location})`
              );
            } else {
              this.log(`⚠️ Job URL doesn't match pattern: ${href}`);
            }
          }
        }
      } else {
        // Method 2: Direct job links in company cards
        const directJobLink = companyCard.querySelector(
          "a.styles_component__UCLp3.styles_defaultLink__eZMqw.styles_jobLink__US40J"
        );
        if (
          directJobLink &&
          directJobLink.href &&
          this.getSearchLinkPattern().test(directJobLink.href)
        ) {
          const jobInfo = this.createJobInfoFromLink(
            directJobLink,
            companyCard
          );
          jobs.push(jobInfo);
          this.log(
            `📋 Found direct job: ${jobInfo.title} at ${jobInfo.company}`
          );
        }
      }
    } catch (error) {
      this.log(`❌ Error extracting jobs from company card:`, error);
    }

    return jobs;
  }

  createJobInfoFromLink(jobLink, companyCard) {
    const jobContainer = jobLink.closest(".styles_component__Ey28k") || jobLink;
    const titleElement = jobContainer.querySelector(".styles_title__xpQDw");
    const locationElement = jobContainer.querySelector(
      ".styles_location__O9Z62"
    );
    const compensationElement = jobContainer.querySelector(
      ".styles_compensation__3JnvU"
    );

    // Also get company info from the parent company card
    const companyNameElement = companyCard.querySelector(
      "h2.inline.text-md.font-semibold"
    );

    return {
      url: jobLink.href,
      title: titleElement?.textContent?.trim() || "Unknown Title",
      location: locationElement?.textContent?.trim() || "Unknown Location",
      compensation: compensationElement?.textContent?.trim() || "Not specified",
      company: companyNameElement?.textContent?.trim() || "Unknown Company",
      element: jobLink,
      originalElement: jobContainer,
      companyCard: companyCard,
      queueIndex: this.jobQueue.length, // For debugging
      extractedAt: Date.now(),
    };
  }

  async processNextJobFromQueue() {
    try {
      // Check if we need to load more jobs (when only 2-3 jobs left)
      if (
        this.jobQueue.length - this.currentJobIndex <= 3 &&
        !this.isLoadingMore
      ) {
        this.log("🔄 Queue running low, attempting to load more jobs...");
        await this.loadMoreJobsIntoQueue();
      }

      // Check if we've reached the application limit
      if (this.searchData.current >= this.searchData.limit) {
        this.log("🏁 Reached job application limit");
        this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
        return;
      }

      // Check if queue is empty
      if (this.currentJobIndex >= this.jobQueue.length) {
        this.log("📭 Job queue exhausted");
        this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
        return;
      }

      // Get next job from queue
      const nextJob = this.jobQueue[this.currentJobIndex];
      this.currentJobIndex++;
      this.log(
        `🎯 Processing job ${this.currentJobIndex}/${this.jobQueue.length}: ${nextJob.title}`
      );

      await this.delay(3000);
      // Send job to background for processing in new tab
      const success = await this.processJobLink(nextJob);

      if (!success) {
        // If processing failed, mark as failed and try next
        this.searchData.submittedLinks.push({
          url: nextJob.url,
          status: "FAILED",
          message: "Failed to process job link",
          timestamp: Date.now(),
        });

        this.log(`❌ Failed to process job, moving to next in queue`);

        // Move to next job immediately
        setTimeout(() => this.processNextJobFromQueue(), 1000);
      }

      // If success, the background script will send SEARCH_NEXT when done
    } catch (error) {
      this.log("❌ Error in processNextJobFromQueue:", error);
      this.reportError(error, { action: "processNextJobFromQueue" });
    }
  }

  async loadMoreJobsIntoQueue() {
    if (this.isLoadingMore) {
      this.log("⚠️ Already loading more jobs, skipping duplicate request");
      return false;
    }

    this.isLoadingMore = true;

    try {
      this.log("🔄 Loading more jobs into queue...");

      const initialJobCount = this.jobQueue.length;

      // Use existing scroll/pagination logic to load more content
      const loadedMore = await this.loadMoreJobs();

      if (loadedMore) {
        // Wait for new content to load
        await this.delay(3000);

        // Extract jobs from new company cards
        const newCompanyCards = document.querySelectorAll(
          ".styles_component__uTjje"
        );

        // Only process cards we haven't seen before
        const unseenCards = Array.from(newCompanyCards).slice(initialJobCount);

        for (const companyCard of unseenCards) {
          try {
            const jobs = this.extractJobsFromCompanyCard(companyCard);

            // Filter out already processed jobs
            const newJobs = jobs.filter((job) => {
              const normalizedUrl = this.normalizeUrl(job.url);
              return !this.searchData.submittedLinks.some(
                (link) => this.normalizeUrl(link.url) === normalizedUrl
              );
            });

            this.jobQueue.push(...newJobs);

            if (newJobs.length > 0) {
              this.log(
                `➕ Added ${newJobs.length} new jobs from ${
                  newJobs[0]?.company || "company"
                }`
              );
            }
          } catch (error) {
            this.log(`❌ Error processing new company card:`, error);
          }
        }

        const newJobCount = this.jobQueue.length - initialJobCount;
        this.log(
          `✅ Added ${newJobCount} new jobs to queue (total: ${this.jobQueue.length})`
        );

        return newJobCount > 0;
      } else {
        this.log("❌ No more jobs available to load");
        return false;
      }
    } catch (error) {
      this.log("❌ Error loading more jobs:", error);
      return false;
    } finally {
      this.isLoadingMore = false;
    }
  }

  // ========================================
  // WELLFOUND-SPECIFIC MESSAGE HANDLING
  // ========================================

  handlePlatformSpecificMessage(type, data) {
    switch (type) {
      case "SEARCH_TASK_DATA":
        this.handleSearchTaskData(data);
        break;

      case "APPLICATION_TASK_DATA":
        this.handleApplicationTaskData(data);
        break;

      case "APPLICATION_STARTING":
        this.handleApplicationStarting(data);
        break;

      case "APPLICATION_STATUS":
        this.handleApplicationStatus(data);
        break;

      case "SUCCESS":
        // Handle legacy SUCCESS messages
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

  handleSearchTaskData(data) {
    try {
      this.log("📊 Processing Wellfound search task data:", data);

      if (!data) {
        this.log("⚠️ No search task data provided");
        return;
      }

      this.searchData = {
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

      // Include user profile if available
      if (data.profile && !this.userProfile) {
        this.userProfile = data.profile;
        this.log("👤 User profile loaded from search task data");
      }

      this.log("✅ Wellfound search data initialized:", this.searchData);

      // ✅ NEW: Start building job queue and processing
      setTimeout(() => this.startQueueBasedSearch(), 1000);
    } catch (error) {
      this.log("❌ Error processing search task data:", error);
    }
  }

  async startQueueBasedSearch() {
    try {
      this.log("🚀 Starting queue-based job search");

      // Build initial job queue
      const queueBuilt = await this.buildJobQueue();

      if (!queueBuilt || this.jobQueue.length === 0) {
        this.log("❌ No jobs found to process");
        this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
        return;
      }

      // Start processing jobs from queue
      await this.processNextJobFromQueue();
    } catch (error) {
      this.log("❌ Error starting queue-based search:", error);
    }
  }

  handleSuccessMessage(data) {
    // Legacy handler for backward compatibility
    this.log("🔄 Handling legacy SUCCESS message with data:", data);

    if (data && Object.keys(data).length === 0) {
      this.log(
        "⚠️ Received empty SUCCESS data - this might indicate an issue with automation setup"
      );
      return;
    }

    if (data && data.submittedLinks !== undefined) {
      // This is search task data
      this.handleSearchTaskData(data);
    } else if (data && data.profile !== undefined && !this.userProfile) {
      // This is application task data
      this.handleApplicationTaskData(data);
    } else {
      this.log("⚠️ SUCCESS message with unrecognized data structure:", data);
    }
  }

  handleApplicationTaskData(data) {
    try {
      this.log("📊 Processing Wellfound application task data:", data);

      if (data?.profile && !this.userProfile) {
        this.userProfile = data.profile;
        this.log("👤 User profile loaded from application task data");
      }

      // Update form handler
      if (this.formHandler && this.userProfile) {
        this.formHandler.userData = this.userProfile;
      }

      // Start application process
      setTimeout(() => this.startApplicationProcess(), 1000);
    } catch (error) {
      this.log("❌ Error processing application task data:", error);
    }
  }

  handleApplicationStarting(data) {
    this.log("🎯 Wellfound application starting:", data);
    this.applicationState.isApplicationInProgress = true;
    this.applicationState.applicationStartTime = Date.now();
  }

  handleApplicationStatus(data) {
    this.log("📊 Wellfound application status:", data);

    if (data.inProgress && !this.applicationState.isApplicationInProgress) {
      this.applicationState.isApplicationInProgress = true;
      this.applicationState.applicationStartTime = Date.now();
    } else if (
      !data.inProgress &&
      this.applicationState.isApplicationInProgress
    ) {
      this.applicationState.isApplicationInProgress = false;
      this.applicationState.applicationStartTime = null;
      setTimeout(() => this.processNextJobFromQueue(), 1000);
    }
  }

  handleSearchNext(data) {
    try {
      this.log("🔄 Received search next signal:", data);

      // Update local data with completed job info
      if (data && data.submittedLinks) {
        this.searchData.submittedLinks = data.submittedLinks;
        this.log(
          `📊 Updated submitted links: ${data.submittedLinks.length} jobs processed`
        );
      }
      if (data && data.current !== undefined) {
        this.searchData.current = data.current;
        this.log(`📊 Updated current count: ${data.current}`);
      }

      setTimeout(() => this.processNextJobFromQueue(), 1000);
    } catch (error) {
      this.log("❌ Error handling search next:", error);
    }
  }

  // ========================================
  // WELLFOUND-SPECIFIC PAGE TYPE DETECTION
  // ========================================

  async detectPageTypeAndStart() {
    const url = window.location.href;
    this.log(`🔍 Detecting page type for: ${url}`);

    if (url.includes("wellfound.com/jobs") && !this.isValidJobPage(url)) {
      this.log("📊 Wellfound jobs search page detected");

      await this.startSearchProcess();
    } else if (this.isValidJobPage(url)) {
      this.log("📋 Wellfound job page detected");

      await this.startApplicationProcess();
    } else {
      this.log("❓ Unknown page type, waiting for navigation");
      await this.waitForValidPage();
    }
  }

  // ========================================
  // WELLFOUND-SPECIFIC SEARCH LOGIC
  // ========================================

  /**
   * Check for captcha/verification blocks and pause automation until resolved
   */
  async checkCaptchaStatus() {
    try {
      this.log("🔍 Checking for captcha/verification blocks");

      const captchaSelectors = [
        'p[data-dd-captcha-human-title=""]',
        "p.captcha__human__title",
        'p[data-dd-captcha-human-title*="Verification Required"]',
      ];

      const captchaFound = captchaSelectors.some((selector) => {
        const element = document.querySelector(selector);
        return (
          element &&
          (element.textContent.includes("Access blocked") ||
            element.textContent.includes("Verification Required"))
        );
      });

      if (captchaFound) {
        this.log("🚫 Captcha/verification detected, pausing automation");

        // Pause automation and wait for user to solve captcha
        await this.waitForCaptchaResolution();
      } else {
        this.log("✅ No captcha detected, continuing");
      }
    } catch (error) {
      this.log("❌ Error checking captcha status:", error);
    }
  }

  /**
   * Wait for captcha to be resolved by user
   */
  async waitForCaptchaResolution() {
    const maxWaitTime = 10 * 60 * 1000; // 10 minutes max wait
    const checkInterval = 10000; // Check every 10 seconds
    let waitTime = 0;

    while (waitTime < maxWaitTime) {
      await this.delay(checkInterval);
      waitTime += checkInterval;

      const captchaSelectors = [
        'p[data-dd-captcha-human-title=""]',
        "p.captcha__human__title",
        'p[data-dd-captcha-human-title*="Verification Required"]',
      ];

      const captchaStillPresent = captchaSelectors.some((selector) => {
        const element = document.querySelector(selector);
        return (
          element &&
          (element.textContent.includes("Access blocked") ||
            element.textContent.includes("Verification Required"))
        );
      });

      if (!captchaStillPresent) {
        this.log("✅ Captcha resolved, continuing automation");

        return;
      }

      this.log(
        `⏳ Waiting for captcha resolution... (${Math.floor(waitTime / 1000)}s)`
      );
    }

    throw new Error(
      "Captcha resolution timeout - please refresh and try again"
    );
  }

  /**
   * Check if user is logged in by looking for login/signup buttons
   */
  async checkLoginStatus() {
    try {
      this.log("🔍 Checking user login status");

      const loginButton = document.querySelector(
        "button[onclick=\"window.location.href='/login'\"]"
      );
      const signupButton = document.querySelector(
        'button[onclick*="/jobs/signup"]'
      );

      if (loginButton || signupButton) {
        this.log("🚫 User not logged in, pausing automation");

        // Wait for user to log in
        await this.waitForUserLogin();
      } else {
        this.log("✅ User is logged in, continuing");
      }
    } catch (error) {
      this.log("❌ Error checking login status:", error);
    }
  }

  /**
   * Wait for user to log in
   */
  async waitForUserLogin() {
    const maxWaitTime = 15 * 60 * 1000; // 15 minutes max wait
    const checkInterval = 10000; // Check every 10 seconds
    let waitTime = 0;

    while (waitTime < maxWaitTime) {
      await this.delay(checkInterval);
      waitTime += checkInterval;

      const loginButton = document.querySelector(
        "button[onclick=\"window.location.href='/login'\"]"
      );
      const signupButton = document.querySelector(
        'button[onclick*="/jobs/signup"]'
      );

      if (!loginButton && !signupButton) {
        this.log("✅ User logged in, continuing automation");

        return;
      }

      this.log(
        `⏳ Waiting for user login... (${Math.floor(waitTime / 1000)}s)`
      );
    }

    throw new Error("Login timeout - please refresh and try again");
  }

  async startSearchProcess() {
    try {
      // Prevent duplicate search process starts
      if (this.searchProcessStarted) {
        this.log("⚠️ Search process already started, ignoring duplicate");
        return;
      }

      this.statusOverlay.addMessage(
        "Checking if you're signed in to Wellfound in this browser"
      );

      await this.delay(2000);
      // Check if user is logged in
      await this.checkLoginStatus();

      this.statusOverlay.addMessage(
        "Login confirmed! Opening the Wellfound job search filter."
      );

      await this.delay(2000);
      // Check for captcha/verification blocks
      await this.checkCaptchaStatus();

      this.searchProcessStarted = true;

      // Get user preferences
      const preferences =
        this.sessionContext?.preferences || this.config.preferences || {};

      // Add job titles from user preferences
      const jobTitles = preferences.positions || ["Software Engineer"];
      const locations = preferences.location || ["United States"];
      this.statusOverlay
        .addFormattedMessage(`Looking for jobs matching your preferences:
        
        Job titles: ${jobTitles.join(", ")}
        Locations: ${locations.join(", ")}`);
      //wait
      await this.delay(2000);
      await this.filters.addJobTitles(jobTitles);

      // Add locations from user preferences
      await this.filters.addLocations(locations);

      this.statusOverlay.addMessage(
        "I have applied your job filters... I will now start applying to jobs."
      );

      // Get search task data from background
      await this.fetchSearchTaskData();
    } catch (error) {
      this.searchProcessStarted = false; // Reset on error
      this.reportError(error, { phase: "search" });
    }
  }

  async fetchSearchTaskData() {
    this.log("📡 Fetching Wellfound search task data from background");

    const success = this.safeSendPortMessage({ type: "GET_SEARCH_TASK" });
    if (!success) {
      throw new Error("Failed to request search task data");
    }
  }

  /**
   * Send job to background for processing in new tab
   */
  async processJobLink(jobInfo) {
    try {
      this.statusOverlay.addFormattedMessage(`I'm processing the job: 
        Title: ${jobInfo.title} 
        Location: ${jobInfo.location}
        Compensation: ${jobInfo.compensation}
        URL: ${jobInfo.url}
        `);

      this.log(`🎯 Processing job: ${jobInfo.title} - ${jobInfo.url}`);

      // Send to background script to open in new tab
      const success = this.safeSendPortMessage({
        type: "START_APPLICATION",
        data: {
          url: jobInfo.url,
          title: jobInfo.title,
          location: jobInfo.location,
          compensation: jobInfo.compensation,
        },
      });

      if (!success) {
        throw new Error("Failed to send job to background script");
      }

      return true;
    } catch (error) {
      this.log(`❌ Error processing job link: ${error.message}`);

      return false;
    }
  }

  /**
   * Wait for page elements to load
   */
  async waitForPageLoad() {
    try {
      // Wait for initial page load
      if (document.readyState !== "complete") {
        await new Promise((resolve) => {
          if (document.readyState === "complete") {
            resolve();
          } else {
            window.addEventListener("load", resolve, { once: true });
          }
        });
      }

      // Wait for company cards to appear
      await this.waitForElementWithTimeout(".styles_component__uTjje", 15000);

      this.log("✅ Page load completed");
    } catch (error) {
      this.log("⚠️ Page load timeout, continuing anyway");
    }
  }

  /**
   * Wait for element with timeout (utility method)
   */
  async waitForElementWithTimeout(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      const observer = new MutationObserver((mutations) => {
        const element = document.querySelector(selector);
        if (element) {
          observer.disconnect();
          resolve(element);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Element ${selector} not found within ${timeout}ms`));
      }, timeout);
    });
  }

  // ========================================
  // WELLFOUND-SPECIFIC APPLICATION LOGIC
  // ========================================

  async startApplicationProcess() {
    try {
      this.log("📝 Starting Wellfound application process");
      // Validate user profile
      if (!this.userProfile) {
        this.log("⚠️ No user profile available, attempting to fetch...");
        await this.fetchApplicationTaskData();
      }

      if (!this.userProfile) {
        console.error("❌ Failed to obtain user profile");
      } else {
        this.log("✅ User profile available for Wellfound");
      }

      // Wait for page to fully load
      await this.delay(3000);

      // Start application
      await this.apply();
    } catch (error) {
      this.reportError(error, { phase: "application" });
      this.handleApplicationError(error);
    }
  }

  handleApplicationError(error) {
    this.safeSendPortMessage({
      type: "APPLICATION_ERROR",
      data: this.errorToString(error),
    });
    this.applicationState.isApplicationInProgress = false;
  }

  async fetchApplicationTaskData() {
    this.log("📡 Fetching Wellfound application task data from background");

    const success = this.safeSendPortMessage({ type: "GET_SEND_CV_TASK" });
    if (!success) {
      throw new Error("Failed to request application task data");
    }
  }

  async apply() {
    try {
      this.statusOverlay.automationState = "searching";

      // Show what we're about to do
      this.statusOverlay.addFormattedMessage(
        "I'm starting the application process"
      );
      // Extract job ID from URL
      const jobId = this.extractJobIdFromUrl(window.location.href);

      // Wait for page to fully load
      await this.delay(3000);

      // Find and click the apply button
      const applyButton = await this.findApplyButton();
      if (!applyButton) {
        throw new Error("Cannot find Wellfound apply button");
      }

      await this.clickApplyButton(applyButton);

      // Wait for application modal/form to appear
      await this.delay(2000);

      this.statusOverlay.addFormattedMessage(
        "I'm collecting the application fields and questions to answer them."
      );
      await this.delay(2000);
      // Process the application form using the form handler
      const result = await this.formHandler.processApplicationForm();

      if (result.success) {
        await this.handleSuccessfulApplication(jobId);
        return true;
      } else {
        throw new Error(result.error || "Application form processing failed");
      }
    } catch (error) {
      console.error("Error in Wellfound apply:", error);
      throw error;
    }
  }

  /**
   * Find the Wellfound apply button
   */
  async findApplyButton() {
    try {
      // Wait for the apply button to appear
      const applyButton = await this.waitForElementWithTimeout(
        'button.styles_applyButton__7gnpI, button[data-test="Button"]:contains("Apply")',
        10000
      ).catch(() => null);

      if (applyButton) {
        return applyButton;
      }

      // Fallback: look for any button with "Apply" text
      const allButtons = document.querySelectorAll("button");
      for (const button of allButtons) {
        if (
          button.textContent?.toLowerCase().includes("apply") &&
          !button.textContent?.toLowerCase().includes("applied")
        ) {
          return button;
        }
      }

      return null;
    } catch (error) {
      this.log("❌ Error finding apply button:", error);
      return null;
    }
  }

  /**
   * Click the apply button with multiple strategies
   */
  async clickApplyButton(button) {
    try {
      this.scrollToElement(button);
      await this.delay(500);

      // Check if button is clickable
      if (button.disabled || button.classList.contains("disabled")) {
        throw new Error("Apply button is disabled");
      }

      // Try multiple click strategies
      const clickStrategies = [
        () => button.click(),
        () =>
          button.dispatchEvent(
            new MouseEvent("click", { bubbles: true, cancelable: true })
          ),
        () => {
          button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
          button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
          button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        },
      ];

      for (const strategy of clickStrategies) {
        try {
          strategy();
          await this.delay(1000);

          // Check if modal appeared
          const modal = document.querySelector(
            'div[data-test="JobApplication-Modal"]'
          );
          if (modal) {
            this.log("✅ Apply button clicked successfully, modal appeared");
            return true;
          }
        } catch (error) {
          continue;
        }
      }

      throw new Error("All click strategies failed");
    } catch (error) {
      this.log("❌ Error clicking apply button:", error);
      throw error;
    }
  }

  async handleSuccessfulApplication(jobId) {
    // Get job details from page
    const jobTitle =
      this.extractJobTitle() ||
      document.title.split(" - ")[0] ||
      "Job on Wellfound";
    const companyName = this.extractCompanyName() || "Company on Wellfound";
    const location = this.extractJobLocation() || "Not specified";

    // Send completion message
    this.safeSendPortMessage({
      type: "APPLICATION_SUCCESS",
      data: {
        jobId,
        title: jobTitle,
        company: companyName,
        location,
        jobUrl: window.location.href,
        salary: this.extractSalary() || "Not specified",
        workplace: location,
        postedDate: "Not specified",
        applicants: "Not specified",
      },
    });

    // Reset application state
    this.applicationState.isApplicationInProgress = false;
    this.applicationState.applicationStartTime = null;

    this.log("Wellfound application completed successfully");
  }

  // ========================================
  // JOB DATA EXTRACTION METHODS
  // ========================================

  /**
   * Extract job description from Wellfound job page
   */
  extractJobDescription() {
    const descriptionSelectors = [
      ".styles_description__xjvTf",
      '[data-test*="job-description"]',
      ".job-description",
      ".description",
      '[class*="description"]',
    ];

    let description = this.extractTextFromSelectors(descriptionSelectors);

    if (!description) {
      // Fallback to main content
      const mainContent = document.querySelector(
        "main, .content, [role='main']"
      );
      if (mainContent) {
        description = mainContent.textContent.trim();
      }
    }

    this.log(
      `📋 Extracted job description (${description.length} characters)`
    );
    return description || "No description available";
  }

  /**
   * Extract job title from page
   */
  extractJobTitle() {
    return this.extractTextFromSelectors([
      "h1.inline.text-xl.font-semibold.text-black",
      "h1",
      ".job-title",
      ".styles_title__xpQDw",
    ]);
  }

  /**
   * Extract company name from page
   */
  extractCompanyName() {
    return this.extractTextFromSelectors([
      'a[rel="noopener noreferrer"] span.text-sm.font-semibold.text-black',
      ".company-name",
      ".text-sm.font-semibold.text-black",
    ]);
  }

  /**
   * Extract job location from page
   */
  extractJobLocation() {
    return this.extractTextFromSelectors([
      ".styles_location__O9Z62",
      ".location",
      "[data-testid='location']",
    ]);
  }

  /**
   * Extract salary information
   */
  extractSalary() {
    return this.extractTextFromSelectors([
      ".styles_compensation__3JnvU",
      ".compensation",
      ".salary",
    ]);
  }

  /**
   * Utility method to extract text from multiple selectors
   */
  extractTextFromSelectors(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent) {
        return element.textContent.trim();
      }
    }
    return "";
  }

  /**
   * Extract job ID from Wellfound URL
   */
  extractJobIdFromUrl(url) {
    try {
      const match = url.match(/\/jobs\/(\d+)/);
      return match ? match[1] : null;
    } catch (error) {
      return null;
    }
  }

  // ========================================
  // PAGINATION AND LOADING UTILITIES
  // ========================================

  /**
   * Try to load more jobs by scrolling or pagination
   */
  async loadMoreJobs() {
    try {
      this.log("🔄 Attempting to load more jobs");

      // Method 1: Scroll to bottom to trigger infinite scroll
      const initialJobCount = document.querySelectorAll(
        ".styles_component__uTjje"
      ).length;

      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: "smooth",
      });

      // Wait for potential new jobs to load
      await this.delay(3000);

      const newJobCount = document.querySelectorAll(
        ".styles_component__uTjje"
      ).length;

      if (newJobCount > initialJobCount) {
        this.log(
          `✅ Loaded ${newJobCount - initialJobCount} more jobs via scroll`
        );
        return true;
      }

      // Method 2: Look for "Load More" or "Show More" buttons
      const loadMoreSelectors = [
        'button[data-test*="load-more"]',
        'button[data-test*="show-more"]',
        'button:contains("Load More")',
        'button:contains("Show More")',
        'button:contains("See More")',
        ".load-more-button",
        ".show-more-button",
      ];

      for (const selector of loadMoreSelectors) {
        const buttons = document.querySelectorAll(selector);
        for (const button of buttons) {
          if (button && !button.disabled && this.isElementVisible(button)) {
            this.log("🔘 Found load more button, clicking");
            await this.clickElementReliably(button);
            await this.delay(3000);

            const finalJobCount = document.querySelectorAll(
              ".styles_component__uTjje"
            ).length;
            if (finalJobCount > newJobCount) {
              this.log(
                `✅ Load more button added ${finalJobCount - newJobCount} jobs`
              );
              return true;
            }
          }
        }
      }

      // Method 3: Look for pagination
      const nextPageSelectors = [
        'a[aria-label="Next"]',
        'a[data-test*="next"]',
        'button[aria-label="Next"]',
        ".pagination .next:not(.disabled)",
        'a[rel="next"]',
      ];

      for (const selector of nextPageSelectors) {
        const nextButton = document.querySelector(selector);
        if (
          nextButton &&
          !nextButton.disabled &&
          !nextButton.classList.contains("disabled")
        ) {
          this.log("🔘 Found next page button, clicking");
          await this.clickElementReliably(nextButton);
          await this.delay(4000); // Wait longer for page navigation

          const pageJobCount = document.querySelectorAll(
            ".styles_component__uTjje"
          ).length;
          if (pageJobCount > 0) {
            this.log(`✅ Next page loaded with ${pageJobCount} jobs`);
            return true;
          }
        }
      }

      this.log("❌ No more jobs available to load");
      return false;
    } catch (error) {
      this.log("❌ Error loading more jobs:", error);
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
   * Enhanced click element method with multiple strategies
   */
  async clickElementReliably(element) {
    const strategies = [
      () => element.click(),
      () =>
        element.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        ),
      () => {
        element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      },
      () => {
        element.focus();
        element.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
        );
      },
    ];

    element.scrollIntoView({ behavior: "smooth", block: "center" });
    await this.delay(500);

    for (const strategy of strategies) {
      try {
        strategy();
        await this.delay(1000);
        return true;
      } catch (error) {
        continue;
      }
    }

    throw new Error("All click strategies failed");
  }

  // ========================================
  // UTILITY METHODS
  // ========================================

  /**
   * Normalize URL for comparison
   */
  normalizeUrl(url) {
    try {
      if (!url) return "";

      // Remove protocol and trailing slashes for comparison
      return url
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/\/+$/, "")
        .trim();
    } catch (error) {
      return url;
    }
  }

  /**
   * Delay utility method
   */
  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Wait utility method alias
   */
  async wait(ms) {
    return this.delay(ms);
  }

  /**
   * Scroll element into view
   */
  scrollToElement(element) {
    if (!element) return;

    try {
      element.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
      });
    } catch (error) {
      // Fallback for older browsers
      element.scrollIntoView();
    }
  }

  async waitForValidPage(timeout = 30000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const url = window.location.href;

      if (url.includes("wellfound.com/jobs")) {
        await this.detectPageTypeAndStart();
        return;
      }

      await this.delay(1000);
    }

    throw new Error("Timeout waiting for valid Wellfound page");
  }

  errorToString(e) {
    if (e instanceof Error) {
      return e.stack || e.message;
    }
    return String(e);
  }

  // Override URL normalization for Wellfound-specific needs
  platformSpecificUrlNormalization(url) {
    // Remove any query parameters that aren't essential
    try {
      const urlObj = new URL(url);
      // Keep only essential parameters
      const essentialParams = ["utm_source"]; // Add any params you want to keep
      const newSearchParams = new URLSearchParams();

      for (const param of essentialParams) {
        if (urlObj.searchParams.has(param)) {
          newSearchParams.set(param, urlObj.searchParams.get(param));
        }
      }

      urlObj.search = newSearchParams.toString();
      return urlObj.toString();
    } catch (error) {
      return url;
    }
  }

  // ========================================
  // CLEANUP - Inherited from base class with Wellfound-specific additions
  // ========================================

  cleanup() {
    // Base class handles most cleanup
    super.cleanup();

    // Wellfound-specific cleanup
    this.jobQueue = [];
    this.currentJobIndex = 0;
    this.isLoadingMore = false;
    this.queueInitialized = false;
    this.searchProcessStarted = false;

    this.log("🧹 Wellfound-specific cleanup completed");
  }
}
