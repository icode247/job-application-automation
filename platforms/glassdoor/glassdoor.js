// platforms/glassdoor/glassdoor.js - Glassdoor Platform Automation
import BasePlatformAutomation from "../../shared/base/base-platform-automation.js";
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
        companyName: ".EmployerProfile_compactEmployerName__9MGcV, span.employer-name",
        location: ".JobCard_location__Ds1fM, div[data-test='emp-location']",
        salary: "[data-test='detailSalary'], .salaryEstimate",

        // Apply button selectors
        applyButton: "button[data-test='easyApply'], .EasyApplyButton_content__1cGPo, button.applyButton, a.applyButton",
        easyApplyButton: ".button_Button__MlD2g.button-base_Button__knLaX",

        // Job description
        jobDescription: ".jobDescriptionContent, [data-test='description'], [data-test='jobDescriptionText']",

        // Filters and pagination
        easyApplyFilter: "[data-test='EASY_APPLY-filter'], input[value='EASY_APPLY']",
        nextPage: "[data-test='pagination-next'], .nextButton",

        // External application indicators
        externalIndicators: [
          "[data-test='external-apply']",
          "a[target='_blank'][rel='nofollow']",
        ],

        // Form specific selectors
        formContainer: ".jobsOverlayModal, .modal-content, .applyButtonContainer",
        resumeUpload: "input[type=file]",
        formInput: "input:not([type=hidden]), textarea, select",
        continueButton: "button[type=submit], button.ia-continueButton",
        submitButton: "button:contains('Submit'), button:contains('Apply')",
        popupClose: ".popover-x-button-close",

        // SmartApply selectors
        smartApplyForm: "form",
        smartApplyContinue: "button[data-testid='aa288590cde54b4a3f778f52168e7b17f']",
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

    this.log("✅ Glassdoor automation initialized");
  }

  async start(params = {}) {
    try {
      if (this.isRunning) {
        this.log("⚠️ Automation already running, ignoring duplicate start");
        return true;
      }

      this.isRunning = true;
      this.state.isRunning = true;
      this.log("▶️ Starting Glassdoor automation");

      // Ensure user profile is available
      if (!this.userProfile && this.userId) {
        try {
          this.userProfile = await this.userService.getUserDetails();
          this.profile = this.userProfile;
          this.log("✅ User profile fetched during start");
        } catch (error) {
          this.log("❌ Failed to fetch user profile during start:", error);
        }
      }

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
      this.reportError(error, { action: "start" });
      this.isRunning = false;
      this.state.isRunning = false;
      return false;
    }
  }

  // ========================================
  // PAGE TYPE DETECTION
  // ========================================

  async detectPageTypeAndStart() {
    const url = window.location.href;
    this.log(`🔍 Detecting page type for: ${url}`);

    if (this.isGlassdoorJobListingPage(url)) {
      this.log("📊 Glassdoor job listing page detected");
      await this.startJobListingProcess();
    } else if (this.isSmartApplyPage(url)) {
      this.log("📋 SmartApply page detected");
      await this.startApplicationProcess();
    } else if (this.isGlassdoorFormPage(url)) {
      this.log("📝 Glassdoor form page detected");
      await this.handleGlassdoorFormPage();
    } else {
      this.log("❓ Unknown page type, waiting for navigation");
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
    return this.glassdoorConfig.urlPatterns.applyPage.test(url) ||
           document.querySelector(".jobsOverlayModal") ||
           document.querySelector(".modal-content form");
  }


  // ========================================
  // JOB LISTING PROCESS
  // ========================================

  async startJobListingProcess() {
    try {
      if (this.searchProcessStarted) {
        this.log("⚠️ Search process already started, ignoring duplicate");
        return;
      }

      this.searchProcessStarted = true;
      this.log("Starting Glassdoor job listing process...");

      // Get search task data from background
      await this.fetchSearchTaskData();
    } catch (error) {
      this.searchProcessStarted = false;
      this.reportError(error, { phase: "jobListing" });
    }
  }

  async fetchSearchTaskData() {
    this.log("📡 Fetching search task data from background");
    const success = this.safeSendPortMessage({ type: "GET_SEARCH_TASK" });
    if (!success) {
      throw new Error("Failed to request search task data");
    }
  }

  handleSearchTaskData(data) {
    try {
      this.log("📊 Processing search task data:", data);

      if (!data) {
        this.log("⚠️ No search task data provided");
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

      if (data.profile && !this.userProfile) {
        this.userProfile = data.profile;
        this.profile = data.profile;
        this.log("👤 User profile loaded from search task data");
      }

      this.log("✅ Search data initialized:", this.searchData);
      this.log("Search initialization complete");

      // Start the job processing flow
      setTimeout(() => this.startJobProcessing(), 1000);
    } catch (error) {
      this.log("❌ Error processing search task data:", error);
      this.log("Error processing search task data: " + error.message);
    }
  }

  // ========================================
  // JOB PROCESSING FLOW
  // ========================================

  async startJobProcessing() {
    try {
      this.log("🚀 Starting job processing flow");
      this.log("Processing jobs...");

      // Check if jobs were found before proceeding
      const { jobsFound, jobCount, searchQuery } = this.checkIfJobsFound();

      if (!jobsFound) {
        this.log(
          `No jobs found for search: ${searchQuery || "your search criteria"}`
        );
        this.updateStatusIndicator("completed", "No jobs found");
        this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
        return;
      }

      this.updateStatusIndicator("running");

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
      this.log("❌ Error in job processing:", error);
      this.log("Error in job processing: " + error.message);
    }
  }

  async processNextJob() {
    try {
      if (!this.state.isRunning) {
        this.log("Automation stopped");
        return;
      }

      // If there's a pending application, don't process the next job yet
      if (this.state.isApplicationInProgress || this.state.pendingApplication) {
        this.log(
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
          this.log(
            "No jobs found in search results, stopping automation"
          );
          this.updateStatusIndicator("completed", "No jobs found");
          this.state.isRunning = false;
          this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
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
          this.log("No more jobs to process");
          this.updateStatusIndicator("completed");
          this.state.isRunning = false;
          this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
        }
        return;
      }

      // Process the first unprocessed job card
      const jobCard = jobCards[0];
      this.state.lastClickedJobCard = jobCard;

      // Mark as processing
      this.markJobCard(jobCard, "processing");

      // Click the job card to show details
      this.log("Clicking job card to show details");
      jobCard.querySelector("a.JobCard_trackingLink__HMyun")?.click();

      // Wait for details to load
      await this.delay(this.glassdoorConfig.timeouts.standard);

      // Handle any popups
      this.handlePopups();

      // Extract job details before clicking apply
      const jobDetails = this.extractJobDetailsFromCard(jobCard);

      // Store job details for later tracking
      this.currentJobDetails = jobDetails;

      // Find the apply button in the details panel
      const applyButton = await this.findApplyButton();

      if (!applyButton) {
        this.log("No Easy Apply button found, skipping job");
        this.markJobCard(jobCard, "skipped");
        this.state.processedCards.add(this.getJobCardId(jobCard));
        this.state.processedCount++;

        // Move to next job
        setTimeout(() => this.processNextJob(), 1000);
        return;
      }

      // Found an Easy Apply button, start the application
      this.log("Found Easy Apply button, starting application");

      // Set application in progress
      this.state.isApplicationInProgress = true;
      this.state.applicationStartTime = Date.now();
      this.state.pendingApplication = true;
      this.state.formDetected = false;
      this.state.currentRedirectAttempts = 0;

      // Mark card as being processed
      this.state.processedCards.add(this.getJobCardId(jobCard));

      // Click the button - for Glassdoor this might open a modal or redirect
      applyButton.click();

      // Set up a check for Glassdoor modal forms
      this.checkForGlassdoorForm(0);
    } catch (error) {
      this.log("❌ Error processing job:", error);
      this.log("Error processing job: " + error.message);

      // Reset application state
      this.resetApplicationState();

      // Try to continue with next job
      setTimeout(() => this.processNextJob(), 3000);
    }
  }

  getUnprocessedJobCards() {
    let allCards;

    // Try to find the job list container first
    const jobListContainer = document.querySelector(
      "ul.JobsList_jobsList__lqjTr, ul[aria-label='Jobs List']"
    );
    if (jobListContainer) {
      allCards = jobListContainer.querySelectorAll(
        this.glassdoorConfig.selectors.jobCards
      );
    } else {
      allCards = document.querySelectorAll(this.glassdoorConfig.selectors.jobCards);
    }

    return Array.from(allCards).filter((card) => {
      const cardId = this.getJobCardId(card);
      return !this.state.processedCards.has(cardId);
    });
  }

  async goToNextPage() {
    try {
      const nextButton = document.querySelector(this.glassdoorConfig.selectors.nextPage);
      if (nextButton && this.isElementVisible(nextButton)) {
        this.log("Moving to next page of results");
        nextButton.click();

        // Wait for the page to load
        await this.delay(3000);

        // Check if the new page has jobs
        const { jobsFound } = this.checkIfJobsFound();
        if (!jobsFound) {
          this.log("No jobs found on next page");
          return false;
        }

        return true;
      }
      return false;
    } catch (error) {
      this.log("❌ Error going to next page:", error);
      return false;
    }
  }

  // ========================================
  // APPLICATION FORM HANDLING
  // ========================================

  async startApplicationProcess() {
    try {
      this.log("📋 Starting SmartApply application process");
      
      // Wait for profile data if needed
      if (!this.profile) {
        this.profile = await this.getProfileData();
      }

      if (this.profile) {
        // Handle SmartApply form
        await this.handleSmartApplyFlow(this.currentJobDetails || {});
      } else {
        this.log("❌ No profile data available for application");
      }
    } catch (error) {
      this.log("❌ Error in application process:", error);
      this.reportError(error, { phase: "application" });
    }
  }

  async handleGlassdoorFormPage() {
    try {
      this.log("📝 Handling Glassdoor form page");

      // Wait for profile data if needed
      if (!this.profile) {
        this.profile = await this.getProfileData();
      }

      if (this.profile) {
        // Set application in progress
        this.state.isApplicationInProgress = true;
        this.state.applicationStartTime = Date.now();
        this.state.formDetected = true;

        // Handle the form
        const success = await this.handleApplyForm();

        // Reset application state
        this.resetApplicationState();

        if (success) {
          this.log("Application completed successfully");
          this.updateStatusIndicator("success");
        } else {
          this.log("Failed to complete application");
          this.updateStatusIndicator("error");
        }
      } else {
        this.log("❌ No profile data available");
      }
    } catch (error) {
      this.log("❌ Error handling Glassdoor form page:", error);
      this.resetApplicationState();
    }
  }

  checkForGlassdoorForm(attempt) {
    // Check if we've been redirected to Indeed SmartApply
    const isIndeedSmartApply = window.location.href.includes(
      "smartapply.indeed.com/beta/indeedapply/form"
    );

    if (isIndeedSmartApply) {
      // We've been redirected from Glassdoor to Indeed SmartApply form
      this.log(
        "Detected redirect from Glassdoor to Indeed SmartApply form"
      );

      this.state.formDetected = true;

      // Handle the detected form
      setTimeout(async () => {
        await this.handleDetectedForm();
      }, 1000);

      return;
    }

    // Check for Glassdoor form in modal
    const hasGlassdoorForm =
      document.querySelector(".jobsOverlayModal") ||
      document.querySelector(".modal-content form");

    // Also check for standard form elements
    const hasStandardForm =
      document.querySelector("form") ||
      document.querySelector(".ia-ApplyFormScreen");

    // Check if URL changed to an apply page
    const isOnApplyPage = this.glassdoorConfig.urlPatterns.applyPage.test(
      window.location.href
    );

    if (hasGlassdoorForm || hasStandardForm || isOnApplyPage) {
      this.log(
        `Glassdoor form detected on attempt ${attempt + 1}`
      );
      this.state.formDetected = true;

      // Handle the detected form
      setTimeout(async () => {
        await this.handleDetectedForm();
      }, 1000);
    } else {
      // Check again after a delay
      setTimeout(() => {
        this.checkForGlassdoorForm(attempt + 1);
      }, 1000);
    }
  }

  async handleDetectedForm() {
    try {
      this.log("Form detected, starting application process");

      // Wait for profile data if needed
      if (!this.profile) {
        this.profile = await this.getProfileData();
      }

      if (this.profile) {
        // Handle application form
        const success = await this.handleApplyForm();

        // After form submission (success or failure), update status
        if (success) {
          this.log("Application submitted successfully");
          if (this.currentJobDetails) {
            await this.trackApplication(this.currentJobDetails);
          }
          this.markLastJobCardIfAvailable("applied");
        } else {
          this.log("Failed to complete application");
          this.markLastJobCardIfAvailable("error");
        }

        // Reset application state
        this.resetApplicationState();

        // Now we can move to the next job
        if (this.state.isRunning) {
          this.log("Moving to next job...");
          setTimeout(() => this.processNextJob(), 2000);
        }
      } else {
        this.log("❌ No profile data available for form filling");
        this.resetApplicationState();

        // Still move to next job if automation is running
        if (this.state.isRunning) {
          setTimeout(() => this.processNextJob(), 2000);
        }
      }
    } catch (error) {
      this.log("❌ Error handling detected form:", error);
      this.log("Error handling form: " + error.message);

      this.resetApplicationState();

      // Still try to move on if automation is running
      if (this.state.isRunning) {
        setTimeout(() => this.processNextJob(), 2000);
      }
    }
  }

  async handleApplyForm() {
    try {
      // Wait for the form to load completely
      await this.delay(1500);

      this.log("Form handler initialized, starting form filling process");

      // Use AI service for form filling if available
      if (this.aiService) {
        return await this.handleFormWithAI();
      } else {
        return await this.handleFormBasic();
      }
    } catch (error) {
      this.log("❌ Error handling application form:", error);
      this.log("Form submission error: " + error.message);
      this.markLastJobCardIfAvailable("error");
      return false;
    }
  }

  async handleFormWithAI() {
    try {
      // Get all form fields
      const fields = this.getAllFormFields();

      for (const field of fields) {
        await this.processFormFieldWithAI(field);
        await this.delay(this.glassdoorConfig.delays.formFilling);
      }

      // Submit the form
      const success = await this.submitForm();
      return success;
    } catch (error) {
      this.log("❌ Error in AI form handling:", error);
      return false;
    }
  }

  async handleFormBasic() {
    try {
      // Basic form handling without AI
      const fields = this.getAllFormFields();

      for (const field of fields) {
        await this.processFormField(field);
        await this.delay(this.glassdoorConfig.delays.formFilling);
      }

      // Submit the form
      const success = await this.submitForm();
      return success;
    } catch (error) {
      this.log("❌ Error in basic form handling:", error);
      return false;
    }
  }

  async submitForm() {
    try {
      // Look for submit button
      const submitButton = 
        document.querySelector(this.glassdoorConfig.selectors.submitButton) ||
        document.querySelector("button[type='submit']") ||
        this.findButtonByText("Submit") ||
        this.findButtonByText("Apply");

      if (submitButton && this.isElementVisible(submitButton)) {
        this.log("Submitting application form");
        await this.clickElementReliably(submitButton);
        await this.delay(5000);

        // Check for success
        return this.checkSubmissionSuccess();
      }

      return false;
    } catch (error) {
      this.log("❌ Error submitting form:", error);
      return false;
    }
  }

  // ========================================
  // SMARTAPPLY FLOW HANDLING
  // ========================================

  async handleSmartApplyFlow(jobInfo) {
    try {
      this.log("🔄 Processing SmartApply multi-step form");
      this.log("Processing SmartApply form...");

      let currentStep = 1;
      const maxSteps = 10;
      let applicationCompleted = false;

      while (currentStep <= maxSteps && !applicationCompleted) {
        this.log(`📄 Processing SmartApply step ${currentStep}`);
        this.log(`Processing step ${currentStep}...`);

        await this.delay(2000);

        // Check if application is completed
        if (this.checkSmartApplyCompletion()) {
          this.log("✅ SmartApply application completed successfully");
          applicationCompleted = true;
          break;
        }

        // Process current step
        const stepResult = await this.processSmartApplyStep();

        if (stepResult.completed) {
          applicationCompleted = true;
          break;
        } else if (stepResult.needsSubmit) {
          // Submit the application
          await this.submitSmartApplyApplication();
          applicationCompleted = true;
          break;
        } else if (stepResult.nextStep) {
          // Move to next step
          const nextButton = this.findSmartApplyNextButton();
          if (nextButton) {
            this.log("🔄 Moving to next SmartApply step");
            await this.clickElementReliably(nextButton);
            await this.delay(3000);
            currentStep++;
          } else {
            throw new Error("Cannot find next button to continue");
          }
        } else {
          throw new Error("Cannot process current step");
        }
      }

      if (applicationCompleted) {
        await this.handleSuccessfulApplication(jobInfo);
      } else {
        throw new Error("SmartApply process exceeded maximum steps");
      }
    } catch (error) {
      this.log("❌ SmartApply error:", error.message);
      throw error;
    }
  }

  async processSmartApplyStep() {
    try {
      // Determine step type and handle accordingly
      if (this.isResumeStep()) {
        return await this.handleResumeStep();
      } else if (this.isContactInfoStep()) {
        return await this.handleContactInfoStep();
      } else if (this.isQuestionsStep()) {
        return await this.handleQuestionsStep();
      } else if (this.isReviewStep()) {
        return await this.handleReviewStep();
      } else {
        return await this.handleGenericStep();
      }
    } catch (error) {
      this.log("❌ Error processing SmartApply step:", error.message);
      throw error;
    }
  }

  findSmartApplyNextButton() {
    // Use the configured selector
    const correctButton = document.querySelector(
      this.glassdoorConfig.selectors.smartApplyContinue
    );

    if (
      correctButton &&
      this.isElementVisible(correctButton) &&
      !correctButton.disabled
    ) {
      return correctButton;
    }

    // Fallback selectors
    const fallbackSelectors = [
      "button:contains('Continue')",
      "button:contains('Next')",
      "button[type='button']",
    ];

    for (const selector of fallbackSelectors) {
      if (selector.includes(":contains(")) {
        // Handle text-based selectors
        const buttons = document.querySelectorAll("button");
        for (const button of buttons) {
          const text = button.textContent?.toLowerCase() || "";
          if (text.includes("continue") || text.includes("next")) {
            if (this.isElementVisible(button) && !button.disabled) {
              return button;
            }
          }
        }
      } else {
        const button = document.querySelector(selector);
        if (button && this.isElementVisible(button) && !button.disabled) {
          return button;
        }
      }
    }

    return null;
  }

  async submitSmartApplyApplication() {
    const submitButton = document.querySelector(
      this.glassdoorConfig.selectors.submitButton
    );

    if (
      submitButton &&
      this.isElementVisible(submitButton) &&
      !submitButton.disabled
    ) {
      this.log("📤 Submitting SmartApply application");
      await this.clickElementReliably(submitButton);
      await this.delay(5000);
      return true;
    }

    throw new Error("Submit button not found");
  }

  checkSmartApplyCompletion() {
    const successIndicators = [
      "application submitted",
      "application complete",
      "thank you",
      "confirmation",
      "success",
    ];

    const pageText = document.body.textContent.toLowerCase();
    return successIndicators.some((indicator) => pageText.includes(indicator));
  }

  // ========================================
  // STEP HANDLERS
  // ========================================

  isResumeStep() {
    return (
      document.querySelector("input[type='file']") !== null ||
      document.body.textContent.toLowerCase().includes("resume")
    );
  }

  async handleResumeStep() {
    this.log("📄 Handling resume step");
    // Resume usually auto-detected
    return { nextStep: true };
  }

  isContactInfoStep() {
    const contactFields = [
      "input[name*='name']",
      "input[name*='email']",
      "input[name*='phone']",
      "input[type='email']",
      "input[type='tel']",
    ];

    return contactFields.some(
      (selector) => document.querySelector(selector) !== null
    );
  }

  async handleContactInfoStep() {
    this.log("👤 Handling contact information step");

    if (this.userProfile) {
      await this.fillFieldBySelectors(
        ["input[name*='firstName']", "input[placeholder*='First name']"],
        this.userProfile.firstName
      );

      await this.fillFieldBySelectors(
        ["input[name*='lastName']", "input[placeholder*='Last name']"],
        this.userProfile.lastName
      );

      await this.fillFieldBySelectors(
        ["input[type='email']", "input[name*='email']"],
        this.userProfile.email
      );

      await this.fillFieldBySelectors(
        ["input[type='tel']", "input[name*='phone']"],
        this.userProfile.phoneNumber
      );
    }

    return { nextStep: true };
  }

  isQuestionsStep() {
    return (
      document.querySelector("input[type='radio'], select, textarea") !== null
    );
  }

  async handleQuestionsStep() {
    this.log("❓ Handling questions step");

    const fields = this.getAllFormFields();
    for (const field of fields) {
      await this.processFormField(field);
      await this.delay(300);
    }

    return { nextStep: true };
  }

  isReviewStep() {
    return (
      document.body.textContent.toLowerCase().includes("review") ||
      document.body.textContent.toLowerCase().includes("submit")
    );
  }

  async handleReviewStep() {
    this.log("📋 Handling review step");
    return { needsSubmit: true };
  }

  async handleGenericStep() {
    this.log("📝 Handling generic step");

    const fields = this.getAllFormFields();
    for (const field of fields) {
      await this.processFormField(field);
    }

    return { nextStep: true };
  }

  // ========================================
  // FORM FIELD PROCESSING
  // ========================================

  getAllFormFields(container = document) {
    const fields = [];
    const elements = container.querySelectorAll("input, select, textarea");

    for (const element of elements) {
      if (element.type === "hidden" || element.disabled || element.readOnly) {
        continue;
      }

      const fieldInfo = this.getFieldInfo(element);
      if (fieldInfo.label) {
        fields.push({
          element: element,
          type: element.type || element.tagName.toLowerCase(),
          label: fieldInfo.label,
          name: element.name || "",
          required: element.required || fieldInfo.label.includes("*"),
        });
      }
    }

    return fields;
  }

  getFieldInfo(element) {
    const sources = [
      element.labels?.[0]?.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      element.closest("label")?.textContent,
    ];

    const label = sources.find((source) => source && source.trim()) || "";

    return {
      label: label.trim().replace(/\s+/g, " "),
      element: element,
    };
  }

  async processFormField(field) {
    try {
      this.log(`🔧 Processing field: ${field.label}`);

      const answer = await this.getAnswerForField(field);

      if (!answer && answer !== 0) {
        return;
      }

      switch (field.type) {
        case "text":
        case "email":
        case "tel":
        case "password":
        case "number":
          await this.fillTextInput(field.element, answer);
          break;
        case "textarea":
          await this.fillTextarea(field.element, answer);
          break;
        case "select-one":
          await this.fillSelect(field.element, answer);
          break;
        case "radio":
          await this.fillRadio(field.element, answer);
          break;
        case "checkbox":
          await this.fillCheckbox(field.element, answer);
          break;
      }
    } catch (error) {
      this.log(`❌ Error processing field:`, error);
    }
  }

  async processFormFieldWithAI(field) {
    try {
      this.log(`🤖 Processing field with AI: ${field.label}`);

      // Use AI service to get answer
      const answer = await this.aiService.getAnswer(field.label, [], {
        userData: this.userProfile,
        platform: "glassdoor",
      });

      if (!answer && answer !== 0) {
        // Fall back to basic answer
        const fallbackAnswer = this.getFallbackAnswer(field.label.toLowerCase());
        if (fallbackAnswer) {
          await this.fillFormFieldWithValue(field, fallbackAnswer);
        }
        return;
      }

      await this.fillFormFieldWithValue(field, answer);
    } catch (error) {
      this.log(`❌ Error processing field with AI:`, error);
      // Fall back to basic processing
      await this.processFormField(field);
    }
  }

  async fillFormFieldWithValue(field, value) {
    switch (field.type) {
      case "text":
      case "email":
      case "tel":
      case "password":
      case "number":
        await this.fillTextInput(field.element, value);
        break;
      case "textarea":
        await this.fillTextarea(field.element, value);
        break;
      case "select-one":
        await this.fillSelect(field.element, value);
        break;
      case "radio":
        await this.fillRadio(field.element, value);
        break;
      case "checkbox":
        await this.fillCheckbox(field.element, value);
        break;
    }
  }

  async getAnswerForField(field) {
    const normalizedLabel = field.label.toLowerCase().trim();

    // Try AI service first if available
    try {
      if (this.aiService) {
        const answer = await this.aiService.getAnswer(field.label, [], {
          userData: this.userProfile,
          platform: "glassdoor",
        });
        if (answer) return answer;
      }
    } catch (error) {
      // Fall back to manual mapping
    }

    return this.getFallbackAnswer(normalizedLabel);
  }

  getFallbackAnswer(normalizedLabel) {
    const fallbackAnswers = {
      "work authorization": "Yes",
      "authorized to work": "Yes",
      "require sponsorship": "No",
      "visa sponsorship": "No",
      experience: "Yes",
      available: "Immediately",
      salary: "Competitive",
      relocate: "Yes",
    };

    for (const [key, value] of Object.entries(fallbackAnswers)) {
      if (normalizedLabel.includes(key)) {
        return value;
      }
    }

    return "Yes";
  }

  // ========================================
  // FORM INPUT METHODS
  // ========================================

  async fillFieldBySelectors(selectors, value) {
    if (!value) return false;

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && this.isElementVisible(element)) {
        await this.fillTextInput(element, value);
        return true;
      }
    }
    return false;
  }

  async fillTextInput(element, value) {
    element.focus();
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.blur();
  }

  async fillTextarea(element, value) {
    element.focus();
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.blur();
  }

  async fillSelect(element, value) {
    const options = element.querySelectorAll("option");
    for (const option of options) {
      const optionText = option.textContent.toLowerCase();
      const searchValue = value.toString().toLowerCase();
      if (optionText.includes(searchValue)) {
        element.value = option.value;
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
    }
  }

  async fillRadio(element, value) {
    const radioGroup = document.querySelectorAll(
      `input[name="${element.name}"]`
    );
    for (const radio of radioGroup) {
      const radioLabel = this.getRadioLabel(radio);
      if (radioLabel.toLowerCase().includes(value.toString().toLowerCase())) {
        radio.checked = true;
        radio.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
    }
  }

  async fillCheckbox(element, value) {
    const shouldCheck =
      value && (value.toString().toLowerCase() === "yes" || value === true);
    element.checked = shouldCheck;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  getRadioLabel(radioElement) {
    const sources = [
      radioElement.labels?.[0]?.textContent,
      radioElement.getAttribute("aria-label"),
      radioElement.closest("label")?.textContent,
    ];
    return sources.find((source) => source && source.trim()) || "";
  }

  // ========================================
  // UTILITY METHODS
  // ========================================

  getJobCardId(jobCard) {
    // For Glassdoor - try to get the data-jobid attribute
    const jobId =
      jobCard.getAttribute("data-jobid") || jobCard.getAttribute("data-id");
    if (jobId) {
      return jobId;
    }

    // Also check for jobListingId in the card's link
    const jobLink = jobCard.querySelector(
      '.JobCard_trackingLink__HMyun, a[data-test="job-link"]'
    );
    if (jobLink && jobLink.href) {
      const match = jobLink.href.match(/jobListingId=(\d+)/);
      if (match && match[1]) {
        return match[1];
      }
    }

    // Try to get job ID from a title link
    const link =
      jobCard.querySelector(this.glassdoorConfig.selectors.jobTitle) ||
      jobCard.querySelector("a");
    if (link && link.href) {
      // Try different URL patterns for Glassdoor
      const jobListingMatch = link.href.match(/jobListingId=(\d+)/);
      if (jobListingMatch && jobListingMatch[1]) {
        return jobListingMatch[1];
      }

      // Try to match the JV_KO pattern in the URL
      const jvMatch = link.href.match(/JV_KO[^_]+_KE[^_]+_(\d+)\.htm/);
      if (jvMatch && jvMatch[1]) {
        return jvMatch[1];
      }
    }

    // Fallback to job title + company
    const title =
      jobCard.querySelector(this.glassdoorConfig.selectors.jobTitle)?.textContent || "";
    const company =
      jobCard.querySelector(this.glassdoorConfig.selectors.companyName)?.textContent ||
      "";
    return `${title}-${company}`.replace(/\s+/g, "").toLowerCase();
  }

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
      this.log("❌ Error marking job card:", error);
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

      // Get job ID from link
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
      this.log("❌ Error extracting job details:", error);
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

  async trackApplication(jobDetails) {
    try {
      // Skip if no user data
      if (!this.userId) {
        return;
      }

      // Use application tracker service
      await this.applicationTracker.recordApplication({
        ...jobDetails,
        userId: this.userId,
        applicationPlatform: this.platform,
      });

      this.log("✅ Application tracked successfully");
    } catch (error) {
      this.log("❌ Error tracking application:", error);
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

  async findApplyButton() {
    // For Glassdoor, check for buttons with EXACTLY "Easy Apply" text
    // Check all buttons for exact match "Easy Apply" text
    const allButtons = Array.from(
      document.querySelectorAll("button, a.applyButton")
    );

    for (const btn of allButtons) {
      if (this.isElementVisible(btn)) {
        const buttonText = btn.textContent.trim();

        // Check for EXACT "Easy Apply" match for Glassdoor
        if (buttonText === "Easy Apply") {
          this.log(
            "Found Glassdoor 'Easy Apply' button (exact match)"
          );
          return btn;
        }
      }
    }

    // If we didn't find an exact "Easy Apply" button, skip this job
    this.log(
      "No exact 'Easy Apply' button found for Glassdoor, skipping job"
    );
    return null;
  }

  checkIfJobsFound() {
    try {
      // Look for the search results header element
      const searchHeaderSelectors = [
        "[data-test='search-title']",
        ".count",
      ];

      // Try each selector until we find a match
      let searchHeader = null;
      for (const selector of searchHeaderSelectors) {
        searchHeader = document.querySelector(selector);
        if (searchHeader) break;
      }

      if (!searchHeader) {
        this.log("Could not find search results header");
        return { jobsFound: true }; // Default to true if we can't determine
      }

      // Parse the header text to extract the job count
      const headerText = searchHeader.textContent.trim();
      this.log(`Found search header: "${headerText}"`);

      const jobCountMatch = headerText.match(/^(\d+)\s+/);

      if (jobCountMatch) {
        const jobCount = parseInt(jobCountMatch[1], 10);
        this.log(`Found ${jobCount} jobs in search results`);
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
        this.log("No jobs found in search results");
        return { jobsFound: false, jobCount: 0 };
      }

      // If we couldn't parse the count but the header exists, check if there are any job cards
      const jobCards = document.querySelectorAll(this.glassdoorConfig.selectors.jobCards);
      if (jobCards.length === 0) {
        this.log("No job cards found in search results");
        return { jobsFound: false, jobCount: 0 };
      }

      return { jobsFound: true }; // Default to true if we can't determine for sure
    } catch (error) {
      this.log("❌ Error checking if jobs found:", error);
      return { jobsFound: true }; // Default to true on error to avoid blocking
    }
  }

  applySearchFilters() {
    try {
      this.log("Applying search filters...");

      // Check for Easy Apply filter
      const easyApplyFilter = document.querySelector(
        this.glassdoorConfig.selectors.easyApplyFilter
      );
      if (easyApplyFilter && !easyApplyFilter.checked) {
        this.log("Selecting Easy Apply filter");
        easyApplyFilter.click();
      }

      // Wait for filters to apply
      setTimeout(() => {
        this.log("Filters applied, checking for job results");

        // Check if any jobs were found
        const { jobsFound, jobCount } = this.checkIfJobsFound();

        if (!jobsFound) {
          this.log("No jobs found matching search criteria");
          this.updateStatusIndicator("completed", "No jobs found");
          this.state.ready = true;
          this.state.isRunning = false;
          this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
          return;
        }

        this.log(
          `Found ${jobCount || "multiple"} jobs, continuing automation`
        );
        this.state.ready = true;
      }, 2000);
    } catch (error) {
      this.log("❌ Error applying search filters:", error);
      this.log("Error applying filters: " + error.message);

      // Set ready anyway and try to continue
      this.state.ready = true;
    }
  }

  checkSubmissionSuccess() {
    // Check for success indicators
    const successSelectors = [
      ".ia-ApplicationMessage-successMessage",
      ".ia-JobActionConfirmation-container",
      ".ia-SuccessPage",
      ".ia-JobApplySuccess",
      'div:contains("Application submitted")',
      'div:contains("Your application has been submitted")',
      ".submitted-container",
      ".success-container",
    ];

    for (const selector of successSelectors) {
      try {
        const element = document.querySelector(selector);
        if (element && this.isElementVisible(element)) {
          return true;
        }
      } catch (e) {
        // Continue checking other selectors
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

  setupFormDetectionObserver() {
    try {
      // Create a new observer
      this.formObserver = new MutationObserver((mutations) => {
        // Check more frequently - not just when we're explicitly waiting for a form
        if (this.state.isApplicationInProgress || this.isOnApplyPage()) {
          // Check if form elements have appeared - improved selectors
          const hasForm =
            document.querySelector("form") ||
            document.querySelector(".modal-content form") ||
            document.querySelector(".jobsOverlayModal");

          if (hasForm && !this.state.formDetected) {
            this.log("📝 Form detected by mutation observer");
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

      this.log("👁️ Form detection observer set up");
    } catch (error) {
      this.log("❌ Error setting up form observer:", error);
    }
  }

  isOnApplyPage() {
    const url = window.location.href;
    return url.includes("glassdoor.com/apply");
  }

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
        if (applicationTime > this.glassdoorConfig.timeouts.applicationTimeout) {
          this.log("⚠️ Application appears to be stuck, resetting state");

          // Mark the last job card as error if available
          this.markLastJobCardIfAvailable("error");

          this.resetApplicationState();

          this.log(
            "Application timeout detected - resetting state"
          );
          this.updateStatusIndicator("error");

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
          this.log("⚠️ Automation appears inactive, attempting recovery");

          // Reset any stuck application state
          if (this.state.isApplicationInProgress) {
            this.resetApplicationState();
          }

          // Try to continue automation
          this.state.lastActivity = now;
          this.processNextJob();
        }
      }
    } catch (error) {
      this.log("❌ Error in health check:", error);
    }
  }

  resetApplicationState() {
    this.state.isApplicationInProgress = false;
    this.state.applicationStartTime = null;
    this.state.pendingApplication = false;
    this.state.formDetected = false;
    this.state.currentRedirectAttempts = 0;
  }

  updateStatusIndicator(status, details = "") {
    if (!this.statusIndicator) return;

    let statusText;
    let statusColor;
    let bgColor;

    switch (status) {
      case "initializing":
        statusText = "Initializing";
        statusColor = "#ff9800";
        bgColor = "rgba(255, 152, 0, 0.2)";
        break;
      case "ready":
        statusText = "Ready";
        statusColor = "#4caf50";
        bgColor = "rgba(76, 175, 80, 0.2)";
        break;
      case "running":
        statusText = "Running";
        statusColor = "#ff9800";
        bgColor = "rgba(255, 152, 0, 0.2)";
        break;
      case "applying":
        statusText = "Applying";
        statusColor = this.glassdoorConfig.brandColor;
        bgColor = `rgba(74, 144, 226, 0.2)`;
        break;
      case "success":
        statusText = "Success";
        statusColor = "#4caf50";
        bgColor = "rgba(76, 175, 80, 0.2)";
        break;
      case "error":
        statusText = "Error";
        statusColor = "#f44336";
        bgColor = "rgba(244, 67, 54, 0.2)";
        break;
      case "stopped":
        statusText = "Stopped";
        statusColor = "#9e9e9e";
        bgColor = "rgba(158, 158, 158, 0.2)";
        break;
      case "completed":
        statusText = "Completed";
        statusColor = "#4caf50";
        bgColor = "rgba(76, 175, 80, 0.2)";
        break;
      default:
        statusText = status.charAt(0).toUpperCase() + status.slice(1);
        statusColor = this.glassdoorConfig.brandColor;
        bgColor = `rgba(74, 144, 226, 0.2)`;
    }

    this.statusIndicator.textContent = details
      ? `${statusText}: ${details}`
      : statusText;
    this.statusIndicator.style.color = statusColor;
    this.statusIndicator.style.background = bgColor;
  }

  log(message) {
    if (!this.logContainer) return;

    const timestamp = new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const messageElement = document.createElement("div");
    messageElement.style.cssText = `
      padding: 4px 0;
      border-bottom: 1px solid rgba(255,255,255,0.08);
      animation: fastApplyFadeIn 0.3s ease-in;
    `;

    const timeSpan = document.createElement("span");
    timeSpan.textContent = timestamp;
    timeSpan.style.cssText = `
      color: rgba(255,255,255,0.5);
      margin-right: 8px;
      font-size: 11px;
    `;

    const messageSpan = document.createElement("span");
    messageSpan.textContent = message;

    messageElement.appendChild(timeSpan);
    messageElement.appendChild(messageSpan);

    this.logContainer.appendChild(messageElement);
    this.logContainer.scrollTop = this.logContainer.scrollHeight;

    // Keep only last 50 messages
    while (this.logContainer.children.length > 50) {
      this.logContainer.removeChild(this.logContainer.firstChild);
    }

    // Update last activity timestamp
    this.state.lastActivity = Date.now();
  }

  async getProfileData() {
    try {
      // Return cached profile if available
      if (this.profile) {
        return this.profile;
      }

      this.log("Fetching profile data");

      // Use user service if available
      if (this.userService && this.userId) {
        try {
          const profile = await this.userService.getUserDetails();
          this.profile = profile;
          this.userProfile = profile;
          this.log("Profile data fetched from user service");
          return profile;
        } catch (error) {
          this.log("❌ Error fetching profile from user service:", error);
        }
      }

      this.log("Using fallback profile data");
      return this.getFallbackProfile();
    } catch (error) {
      this.log("❌ Error getting profile data:", error);
      return this.getFallbackProfile();
    }
  }

  getFallbackProfile() {
    this.log("Using fallback profile data");
    return this.profile || {};
  }

  async clickElementReliably(element) {
    const strategies = [
      () => element.click(),
      () =>
        element.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        ),
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

  findButtonByText(text) {
    const allButtons = Array.from(document.querySelectorAll("button"));
    return allButtons.find(
      (button) =>
        button.textContent &&
        button.textContent.trim().toLowerCase().includes(text.toLowerCase())
    );
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
    }

    throw new Error("Timeout waiting for valid page");
  }

  getSearchLinkPattern() {
    return /^https:\/\/(www\.)?glassdoor\.com\/(job|Job|partner|apply).*$/;
  }

  getApiHost() {
    return (
      this.sessionApiHost ||
      this.sessionContext?.apiHost ||
      this.config.apiHost ||
      "http://localhost:3000"
    );
  }

  async handleSuccessfulApplication(jobInfo) {
    try {
      this.log(`✅ Application completed successfully for: ${jobInfo.title}`);

      // Record successful application
      this.recordSuccessfulApplication(jobInfo);

      // Update progress
      this.searchData.current++;
      this.updateProgress({
        completed: this.searchData.current,
        current: `Applied to: ${jobInfo.title}`,
      });

      // Send success to background
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

      this.log("Application completed successfully!");

      // Reset application state
      this.resetApplicationState();
    } catch (error) {
      this.log("❌ Error handling successful application:", error);
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
      this.log(`🔧 Initializing on URL: ${url}`);

      // Handle Glassdoor application form in modal
      if (this.isGlassdoorFormPage(url)) {
        this.log("📝 Glassdoor application form detected");
        this.state.initialized = true;
        this.state.ready = true;
        this.state.formDetected = true;

        // Allow the form to fully load
        setTimeout(async () => {
          await this.handleGlassdoorFormPage();
        }, 2000);

        return;
      }

      // Normal initialization for other pages
      const isSearchPage = this.glassdoorConfig.urlPatterns.searchPage.test(url);
      const isJobPage = this.glassdoorConfig.urlPatterns.jobPage.test(url);
      const isApplyPage = this.glassdoorConfig.urlPatterns.applyPage.test(url);

      if (isSearchPage) {
        this.log("Glassdoor search page detected");

        // Check if jobs are found before applying filters
        const { jobsFound } = this.checkIfJobsFound();
        if (!jobsFound) {
          this.log("No jobs found in search results");
          this.updateStatusIndicator("completed", "No jobs found");
          this.state.ready = true;
          this.state.initialized = true;
          return;
        }

        this.state.ready = true;
      } else if (isJobPage || isApplyPage) {
        this.log("Glassdoor job page detected");
        // This will be handled by detectPageTypeAndStart
      }

      this.state.initialized = true;
      this.log("✅ Glassdoor initialization completed");
    } catch (error) {
      this.log("❌ Error in init:", error);
      this.log("Initialization error: " + error.message);
    }
  }

  // ========================================
  // MESSAGE HANDLING
  // ========================================

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

        default:
          this.log(`❓ Unhandled message type: ${type}`);
      }
    } catch (error) {
      this.log("❌ Error handling port message:", error);
    }
  }

  handleApplicationTaskData(data) {
    try {
      this.log("📊 Processing application task data:", data);

      if (data?.profile && !this.userProfile) {
        this.userProfile = data.profile;
        this.profile = data.profile;
        this.log("👤 User profile loaded from application task data");
      }

      this.log("Application initialization complete");
    } catch (error) {
      this.log("❌ Error processing application task data:", error);
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
    this.log("❌ Received error message:", data);
    this.log("Error: " + (data?.message || "Unknown error"));
  }

  // ========================================
  // CLEANUP & SESSION MANAGEMENT
  // ========================================

  async setSessionContext(sessionContext) {
    await super.setSessionContext(sessionContext);
    this.log("✅ Glassdoor session context set successfully");
  }

  cleanup() {
    super.cleanup();

    // Clear health check timer
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    // Disconnect form observer
    if (this.formObserver) {
      this.formObserver.disconnect();
    }

    // Reset job queue and state
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

    // Reset state
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

    this.log("🧹 Glassdoor cleanup completed");
  }

  getPlatformDomains() {
    return "https://www.glassdoor.com/";
  }
}