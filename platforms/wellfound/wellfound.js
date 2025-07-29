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
    this.searchProcessStarted = false;

    this.aiService = new AIService({ apiHost: this.getApiHost() });
    this.applicationTracker = new ApplicationTrackerService({
      userId: this.userProfile.userId,
      apiHost: this.getApiHost(),
    });
    this.userService = new UserService({ userId: this.userProfile.userId });

    this.filters = new WellfoundFilters();
    this.formHandler = null;

    this.searchData = {
      limit: 10,
      current: 0,
      domain: [],
      submittedLinks: [],
      searchLinkPattern: null,
    };

    this.applicationState = {
      isApplicationInProgress: false,
      applicationStartTime: null,
    };
  }

  getPlatformDomains() {
    return ["wellfound.com"];
  }

  getSearchLinkPattern() {
    return /^https:\/\/wellfound\.com\/jobs\/(\d+)/;
  }

  isValidJobPage(url) {
    return url && url.includes("wellfound.com/jobs/") && /\/jobs\/\d+/.test(url);
  }

  async setSessionContext(sessionContext) {
    try {
      if (!sessionContext) {
        this.log("⚠️ No session context provided");
        return;
      }

      this.sessionContext = sessionContext;
      this.hasSessionContext = true;

      if (sessionContext.sessionId) this.sessionId = sessionContext.sessionId;
      if (sessionContext.platform) this.platform = sessionContext.platform;
      if (sessionContext.userId) this.userId = sessionContext.userId;

      if (sessionContext.userProfile) {
        if (!this.userProfile || Object.keys(this.userProfile).length === 0) {
          this.userProfile = sessionContext.userProfile;
          this.log("👤 User profile loaded from session context");
        } else {
          this.userProfile = {
            ...this.userProfile,
            ...sessionContext.userProfile,
          };
          this.log("👤 User profile merged with session context");
        }
      }

      if (!this.userProfile && this.userId) {
        try {
          this.log("📡 Fetching user profile from user service...");
          this.userProfile = await this.userService.getUserDetails();
          this.log("✅ User profile fetched successfully");
        } catch (error) {
          console.error("❌ Failed to fetch user profile:", error);
        }
      }

      if (this.userProfile.userId) {
        this.applicationTracker = new ApplicationTrackerService({
          userId: this.userProfile.userId,
          apiHost: this.getApiHost(),
        });
        this.userService = new UserService({ userId: this.userProfile.userId });
      }

      if (sessionContext.apiHost) {
        this.sessionApiHost = sessionContext.apiHost;
      }

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
      if (this.isRunning) {
        this.log("⚠️ Automation already running, ignoring duplicate start");
        return true;
      }

      this.isRunning = true;
      this.log("▶️ Starting Wellfound automation");

      if (!this.userProfile && this.userId) {
        try {
          this.log("🔄 Attempting to fetch user profile during start...");
          this.userProfile = await this.userService.getUserDetails();
          this.log("✅ User profile fetched during start");
        } catch (error) {
          console.error("❌ Failed to fetch user profile during start:", error);
        }
      }

      this.config = { ...this.config, ...params };

      if (this.updateProgress) {
        this.updateProgress({
          total: params.jobsToApply || 0,
          completed: 0,
          current: "Starting automation...",
        });
      }

      await this.waitForPageLoad();
      await this.detectPageTypeAndStart();

      return true;
    } catch (error) {
      this.reportError(error, { action: "start" });
      this.isRunning = false;
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
    return this.jobQueue.slice(this.currentJobIndex);
  }

  getApiHost() {
    return this.sessionApiHost || this.sessionContext?.apiHost || this.config?.apiHost;
  }

  isApplicationPage(url) {
    return this.isValidJobPage(url);
  }

  getJobTaskMessageType() {
    return "START_APPLICATION";
  }

  async initialize() {
    await super.initialize();

    this.formHandler = new WellfoundFormHandler(
      this.aiService,
      this.userService,
      this
    );
  }

  async buildJobQueue() {
    try {
      this.log("🏗️ Building job queue from company cards...");

      this.jobQueue = [];
      this.currentJobIndex = 0;

      await this.waitForPageLoad();
      await this.delay(2000);

      const companyCards = document.querySelectorAll(
        ".styles_component__uTjje"
      );
      this.log(`🔍 Found ${companyCards.length} company cards on page`);

      for (const companyCard of companyCards) {
        try {
          const jobs = this.extractJobsFromCompanyCard(companyCard);

          const newJobs = jobs.filter((job) => {
            const normalizedUrl = this.normalizeUrl(job.url);
            return !this.searchData.submittedLinks.some(
              (link) => this.normalizeUrl(link.url) === normalizedUrl
            );
          });

          this.jobQueue.push(...newJobs);

          if (newJobs.length > 0) {
            this.log(
              `➕ Added ${newJobs.length} jobs from ${newJobs[0]?.company || "company"
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

      this.jobQueue.slice(0, 3).forEach((job, index) => {
        this.log(
          `📋 Job ${index + 1}: ${job.title} at ${job.company} (${job.location
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
      const jobListingsSection = companyCard.querySelector(
        ".styles_jobListingList__YGDNO"
      );

      if (jobListingsSection) {
        const jobLinksInCompany = jobListingsSection.querySelectorAll(
          "a.styles_component__UCLp3.styles_defaultLink__eZMqw.styles_jobLink__US40J"
        );

        for (const jobLink of jobLinksInCompany) {
          if (jobLink && jobLink.href) {
            const href = jobLink.href;

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
      queueIndex: this.jobQueue.length,
      extractedAt: Date.now(),
    };
  }

  async processNextJobFromQueue() {
    try {
      if (
        this.jobQueue.length - this.currentJobIndex <= 3 &&
        !this.isLoadingMore
      ) {
        this.log("🔄 Queue running low, attempting to load more jobs...");
        await this.loadMoreJobsIntoQueue();
      }

      if (this.searchData.current >= this.searchData.limit) {
        this.log("🏁 Reached job application limit");
        this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
        return;
      }

      if (this.currentJobIndex >= this.jobQueue.length) {
        this.log("📭 Job queue exhausted");
        this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
        return;
      }

      const nextJob = this.jobQueue[this.currentJobIndex];
      this.currentJobIndex++;
      this.log(
        `🎯 Processing job ${this.currentJobIndex}/${this.jobQueue.length}: ${nextJob.title}`
      );

      await this.delay(3000);

      const success = await this.processJobLink(nextJob);

      if (!success) {
        this.searchData.submittedLinks.push({
          url: nextJob.url,
          status: "FAILED",
          message: "Failed to process job link",
          timestamp: Date.now(),
        });

        this.log(`❌ Failed to process job, moving to next in queue`);
        setTimeout(() => this.processNextJobFromQueue(), 1000);
      }
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
      const loadedMore = await this.loadMoreJobs();

      if (loadedMore) {
        await this.delay(3000);

        const newCompanyCards = document.querySelectorAll(
          ".styles_component__uTjje"
        );

        const unseenCards = Array.from(newCompanyCards).slice(initialJobCount);

        for (const companyCard of unseenCards) {
          try {
            const jobs = this.extractJobsFromCompanyCard(companyCard);

            const newJobs = jobs.filter((job) => {
              const normalizedUrl = this.normalizeUrl(job.url);
              return !this.searchData.submittedLinks.some(
                (link) => this.normalizeUrl(link.url) === normalizedUrl
              );
            });

            this.jobQueue.push(...newJobs);

            if (newJobs.length > 0) {
              this.log(
                `➕ Added ${newJobs.length} new jobs from ${newJobs[0]?.company || "company"
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

  handlePlatformSpecificMessage(type, data) {
    if (!type) {
      this.log("⚠️ Received message without type, ignoring");
      return;
    }

    try {
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
          this.handleSuccessMessage(data);
          break;

        case "APPLICATION_STATUS_RESPONSE":
          this.handleApplicationStatusResponse(data);
          break;

        case "JOB_TAB_STATUS":
          this.handleJobTabStatus(data);
          break;

        default:
          if (super.handlePlatformSpecificMessage) {
            super.handlePlatformSpecificMessage(type, data);
          } else {
            this.log(`❓ Unhandled message type: ${type}`);
          }
      }
    } catch (error) {
      this.log(`❌ Error handling platform message ${type}:`, error);
    }
  }

  handleApplicationStatusResponse(data) {
    try {
      this.log("📊 Received application status response:", data);

      if (!data) {
        this.log("⚠️ No data in application status response");
        return;
      }

      if (data.status) {
        this.applicationState = {
          ...this.applicationState,
          ...data.status
        };
      }
    } catch (error) {
      this.log("❌ Error handling application status response:", error);
    }
  }

  handleJobTabStatus(data) {
    try {
      this.log("📊 Received job tab status:", data);

      if (!data) {
        this.log("⚠️ No data in job tab status");
        return;
      }

      if (data.tabId && data.status) {
        this.log(`Tab ${data.tabId} status: ${data.status}`);
      }
    } catch (error) {
      this.log("❌ Error handling job tab status:", error);
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
        submittedLinks: Array.isArray(data.submittedLinks)
          ? data.submittedLinks.map((link) => ({ ...link, tries: 0 }))
          : [],
        searchLinkPattern: data.searchLinkPattern
          ? new RegExp(data.searchLinkPattern.replace(/^\/|\/[gimy]*$/g, ""))
          : this.getSearchLinkPattern(),
      };

      if (data.profile && !this.userProfile) {
        this.userProfile = data.profile;
        this.log("👤 User profile loaded from search task data");
      }

      this.log("✅ Wellfound search data initialized:", this.searchData);

      setTimeout(() => this.startQueueBasedSearch(), 1000);
    } catch (error) {
      this.log("❌ Error processing search task data:", error);

      this.searchData = {
        limit: 10,
        current: 0,
        domain: this.getPlatformDomains(),
        submittedLinks: [],
        searchLinkPattern: this.getSearchLinkPattern(),
      };
    }
  }

  async startQueueBasedSearch() {
    try {
      this.log("🚀 Starting queue-based job search");

      const queueBuilt = await this.buildJobQueue();

      if (!queueBuilt || this.jobQueue.length === 0) {
        this.log("❌ No jobs found to process");
        this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
        return;
      }

      await this.processNextJobFromQueue();
    } catch (error) {
      this.log("❌ Error starting queue-based search:", error);
    }
  }

  handleSuccessMessage(data) {
    this.log("🔄 Handling legacy SUCCESS message with data:", data);

    if (data && Object.keys(data).length === 0) {
      this.log(
        "⚠️ Received empty SUCCESS data - this might indicate an issue with automation setup"
      );
      return;
    }

    if (data && data.submittedLinks !== undefined) {
      this.handleSearchTaskData(data);
    } else if (data && data.profile !== undefined && !this.userProfile) {
      this.handleApplicationTaskData(data);
    } else {
      this.log("⚠️ SUCCESS message with unrecognized data structure:", data);
    }
  }

  handleApplicationTaskData(data) {
    try {
      this.log("📊 Processing Wellfound application task data:", data);

      if (!data) {
        this.log("⚠️ No application task data provided");
        return;
      }

      if (data.profile && !this.userProfile) {
        this.userProfile = data.profile;
        this.log("👤 User profile loaded from application task data");
      }

      if (this.formHandler && this.userProfile) {
        this.formHandler.userData = this.userProfile;
      }

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

    if (data && data.inProgress && !this.applicationState.isApplicationInProgress) {
      this.applicationState.isApplicationInProgress = true;
      this.applicationState.applicationStartTime = Date.now();
    } else if (
      data && !data.inProgress &&
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

  handleDuplicateJob(data) {
    try {
      this.log("🔄 Handling duplicate job:", data);
      if (data && data.url) {
        this.log(`Skipping duplicate job: ${data.url}`);
      }
      setTimeout(() => this.processNextJobFromQueue(), 1000);
    } catch (error) {
      this.log("❌ Error handling duplicate job:", error);
    }
  }

  handleErrorMessage(data) {
    try {
      this.log("❌ Received error message:", data);
      if (data && data.error) {
        this.log(`Error details: ${data.error}`);
      }
    } catch (error) {
      this.log("❌ Error handling error message:", error);
    }
  }

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
        await this.waitForCaptchaResolution();
      } else {
        this.log("✅ No captcha detected, continuing");
      }
    } catch (error) {
      this.log("❌ Error checking captcha status:", error);
    }
  }

  async waitForCaptchaResolution() {
    const maxWaitTime = 10 * 60 * 1000;
    const checkInterval = 10000;
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
        await this.waitForUserLogin();
      } else {
        this.log("✅ User is logged in, continuing");
      }
    } catch (error) {
      this.log("❌ Error checking login status:", error);
    }
  }

  async waitForUserLogin() {
    const maxWaitTime = 15 * 60 * 1000;
    const checkInterval = 10000;
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
      if (this.searchProcessStarted) {
        this.log("⚠️ Search process already started, ignoring duplicate");
        return;
      }

      if (this.statusOverlay && this.statusOverlay.addMessage) {
        this.statusOverlay.addMessage(
          "Checking if you're signed in to Wellfound in this browser"
        );
      }

      await this.delay(2000);
      await this.checkLoginStatus();

      if (this.statusOverlay && this.statusOverlay.addMessage) {
        this.statusOverlay.addMessage(
          "Login confirmed! Opening the Wellfound job search filter."
        );
      }

      await this.delay(2000);
      await this.checkCaptchaStatus();

      this.searchProcessStarted = true;

      const preferences =
        this.sessionContext?.preferences || this.config?.preferences || {};

      const jobTitles = preferences.positions || ["Software Engineer"];
      const locations = preferences.location || ["United States"];

      if (this.statusOverlay && this.statusOverlay.addFormattedMessage) {
        this.statusOverlay.addFormattedMessage(`Looking for jobs matching your preferences:
        
        Job titles: ${jobTitles.join(", ")}
        Locations: ${locations.join(", ")}`);
      }

      await this.delay(2000);
      await this.filters.addJobTitles(jobTitles);
      await this.filters.addLocations(locations);

      if (this.statusOverlay && this.statusOverlay.addMessage) {
        this.statusOverlay.addMessage(
          "I have applied your job filters... I will now start applying to jobs."
        );
      }

      await this.fetchSearchTaskData();
    } catch (error) {
      this.searchProcessStarted = false;
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

  async processJobLink(jobInfo) {
    try {
      if (this.statusOverlay && this.statusOverlay.addFormattedMessage) {
        this.statusOverlay.addFormattedMessage(`I'm processing the job: 
        Title: ${jobInfo.title} 
        Location: ${jobInfo.location}
        Compensation: ${jobInfo.compensation}
        URL: ${jobInfo.url}
        `);
      }

      this.log(`🎯 Processing job: ${jobInfo.title} - ${jobInfo.url}`);

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

  async waitForPageLoad() {
    try {
      if (document.readyState !== "complete") {
        await new Promise((resolve) => {
          if (document.readyState === "complete") {
            resolve();
          } else {
            window.addEventListener("load", resolve, { once: true });
          }
        });
      }

      await this.waitForElementWithTimeout(".styles_component__uTjje", 15000);
      this.log("✅ Page load completed");
    } catch (error) {
      this.log("⚠️ Page load timeout, continuing anyway");
    }
  }

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

  async startApplicationProcess() {
    try {
      this.log("📝 Starting Wellfound application process");

      if (!this.userProfile) {
        this.log("⚠️ No user profile available, attempting to fetch...");
        await this.fetchApplicationTaskData();
      }

      if (!this.userProfile) {
        console.error("❌ Failed to obtain user profile");
      } else {
        this.log("✅ User profile available for Wellfound");
      }

      await this.delay(3000);
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
      if (this.statusOverlay) {
        this.statusOverlay.automationState = "searching";
      }

      if (this.statusOverlay && this.statusOverlay.addFormattedMessage) {
        this.statusOverlay.addFormattedMessage(
          "I'm starting the application process"
        );
      }

      const jobId = this.extractJobIdFromUrl(window.location.href);
      await this.delay(3000);

      const applyButton = await this.findApplyButton();
      if (!applyButton) {
        throw new Error("Cannot find Wellfound apply button");
      }

      await this.clickApplyButton(applyButton);
      await this.delay(2000);

      if (this.statusOverlay && this.statusOverlay.addFormattedMessage) {
        this.statusOverlay.addFormattedMessage(
          "I'm collecting the application fields and questions to answer them."
        );
      }

      await this.delay(2000);

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

  async findApplyButton() {
    try {
      const applyButton = await this.waitForElementWithTimeout(
        'button.styles_applyButton__7gnpI, button[data-test="Button"]:contains("Apply")',
        10000
      ).catch(() => null);

      if (applyButton) {
        return applyButton;
      }

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

  async clickApplyButton(button) {
    try {
      this.scrollToElement(button);
      await this.delay(500);

      if (button.disabled || button.classList.contains("disabled")) {
        throw new Error("Apply button is disabled");
      }

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
    const jobTitle =
      this.extractJobTitle() ||
      document.title.split(" - ")[0] ||
      "Job on Wellfound";
    const companyName = this.extractCompanyName() || "Company on Wellfound";
    const location = this.extractJobLocation() || "Not specified";

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

    this.applicationState.isApplicationInProgress = false;
    this.applicationState.applicationStartTime = null;

    this.log("Wellfound application completed successfully");
  }

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

  extractJobTitle() {
    return this.extractTextFromSelectors([
      "h1.inline.text-xl.font-semibold.text-black",
      "h1",
      ".job-title",
      ".styles_title__xpQDw",
    ]);
  }

  extractCompanyName() {
    return this.extractTextFromSelectors([
      'a[rel="noopener noreferrer"] span.text-sm.font-semibold.text-black',
      ".company-name",
      ".text-sm.font-semibold.text-black",
    ]);
  }

  extractJobLocation() {
    return this.extractTextFromSelectors([
      ".styles_location__O9Z62",
      ".location",
      "[data-testid='location']",
    ]);
  }

  extractSalary() {
    return this.extractTextFromSelectors([
      ".styles_compensation__3JnvU",
      ".compensation",
      ".salary",
    ]);
  }

  extractTextFromSelectors(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent) {
        return element.textContent.trim();
      }
    }
    return "";
  }

  extractJobIdFromUrl(url) {
    try {
      const match = url.match(/\/jobs\/(\d+)/);
      return match ? match[1] : null;
    } catch (error) {
      return null;
    }
  }

  async loadMoreJobs() {
    try {
      this.log("🔄 Attempting to load more jobs");

      const initialJobCount = document.querySelectorAll(
        ".styles_component__uTjje"
      ).length;

      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: "smooth",
      });

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
          await this.delay(4000);

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

  normalizeUrl(url) {
    try {
      if (!url) return "";

      return url
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/\/+$/, "")
        .trim();
    } catch (error) {
      return url;
    }
  }

  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async wait(ms) {
    return this.delay(ms);
  }

  scrollToElement(element) {
    if (!element) return;

    try {
      element.scrollIntoView({
        behavior: "smooth",
        block: "center",
        inline: "nearest",
      });
    } catch (error) {
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

  platformSpecificUrlNormalization(url) {
    try {
      const urlObj = new URL(url);
      const essentialParams = ["utm_source"];
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

  safeSendPortMessage(message) {
    try {
      if (this.port && this.port.postMessage) {
        this.port.postMessage(message);
        return true;
      } else {
        this.log("❌ Port not available for message:", message);
        return false;
      }
    } catch (error) {
      this.log("❌ Error sending port message:", error);
      return false;
    }
  }

  reportError(error, context = {}) {
    try {
      const errorData = {
        error: this.errorToString(error),
        context,
        timestamp: Date.now(),
        url: window.location.href,
        platform: this.platform,
      };

      this.log("❌ Reporting error:", errorData);

      this.safeSendPortMessage({
        type: "ERROR",
        data: errorData,
      });
    } catch (reportingError) {
      this.log("❌ Error while reporting error:", reportingError);
    }
  }

  cleanup() {
    if (super.cleanup) {
      super.cleanup();
    }

    this.jobQueue = [];
    this.currentJobIndex = 0;
    this.isLoadingMore = false;
    this.queueInitialized = false;
    this.searchProcessStarted = false;

    this.log("🧹 Wellfound-specific cleanup completed");
  }

  log(message, data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [WellfoundPlatform] ${message}`;

    if (data) {
      console.log(logMessage, data);
    } else {
      console.log(logMessage);
    }
  }
}