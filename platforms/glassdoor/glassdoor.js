// platforms/glassdoor/glassdoor.js - FIXED VERSION following correct flow
import BasePlatformAutomation from "../../shared/base/base-platform-automation.js";
import {
  AIService,
  ApplicationTrackerService,
  UserService,
} from "../../services/index.js";
//❌ No jobs found on this page
//no Easy Apply button found
export default class GlassdoorPlatform extends BasePlatformAutomation {
  constructor(config) {
    super(config);
    this.platform = "glassdoor";
    this.baseUrl = "https://www.glassdoor.com";

    // Job queue management (like Wellfound)
    this.jobQueue = [];
    this.currentJobIndex = 0;
    this.isLoadingMore = false;
    this.queueInitialized = false;

    // Initialize services
    this.aiService = new AIService({ apiHost: this.getApiHost() });
    this.applicationTracker = new ApplicationTrackerService({
      userId: this.userId,
    });
    this.userService = new UserService({ userId: this.userId });

    // Glassdoor-specific configuration with CORRECT selectors
    this.glassdoorConfig = {
      selectors: {
        // Updated selectors based on your description
        jobCards: ".JobCard_jobCardWrapper__vX29z", // Correct job card selector
        easyApplyButton: ".button_Button__MlD2g.button-base_Button__knLaX", // Correct Easy Apply button
        jobTitle: ".JobCard_jobTitle__UF81I",
        companyName: ".EmployerProfile_compactEmployerName__9MGcV",
        location: ".JobCard_location__kxKP4",
        salary: ".JobCard_salaryEstimate__ZqNZU",
        // Indeed SmartApply selectors
        smartApplyForm: "form", // Generic form selector for SmartApply
        continueButton:
          "button[data-testid='aa288590cde54b4a3f778f52168e7b17f']",
        submitButton: "button[type='submit']",
        nextButton: ".aba5bff612c96e760268ff66780c44f60",
      },
      delays: {
        betweenJobs: 3000,
        formFilling: 1000,
        pageLoad: 3000,
      },
    };

    // Prevent duplicate starts
    this.searchProcessStarted = false;
  }

  // ========================================
  // PLATFORM-SPECIFIC IMPLEMENTATIONS
  // ========================================

  getPlatformDomains() {
    return ["https://www.glassdoor.com"];
  }

  getSearchLinkPattern() {
    return /^https:\/\/(www\.)?glassdoor\.com\/(job|Job|partner|apply).*$/;
  }

  isValidJobPage(url) {
    return (
      /^https:\/\/(www\.)?glassdoor\.com\/(job|Job|partner)/.test(url) ||
      url.includes("smartapply.indeed.com")
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
    return url.includes("smartapply.indeed.com") || this.isValidJobPage(url);
  }

  getJobTaskMessageType() {
    return "START_APPLICATION";
  }

  // ========================================
  // INITIALIZATION
  // ========================================

  async initialize() {
    await super.initialize();
    this.log("✅ Glassdoor automation initialized with correct selectors");
  }

  async start(params = {}) {
    try {
      if (this.isRunning) {
        this.log("⚠️ Automation already running, ignoring duplicate start");
        return true;
      }

      this.isRunning = true;
      this.log("▶️ Starting Glassdoor automation");

      // Ensure user profile is available
      if (!this.userProfile && this.userId) {
        try {
          this.userProfile = await this.userService.getUserDetails();
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
      return false;
    }
  }

  // ========================================
  // PAGE TYPE DETECTION AND ROUTING
  // ========================================

  async detectPageTypeAndStart() {
    const url = window.location.href;
    this.log(`🔍 Detecting Glassdoor page type for: ${url}`);

    if (url.includes("glassdoor.com/Job/") && url.includes("-jobs-")) {
      this.log("📊 Glassdoor search results page detected");
      await this.startSearchProcess();
    } else if (url.includes("smartapply.indeed.com")) {
      this.log("📋 Indeed SmartApply page detected");
      await this.startApplicationProcess();
    } else if (this.isGlassdoorJobPage(url)) {
      this.log("📋 Individual Glassdoor job page detected");
      await this.startApplicationProcess();
    } else {
      this.log("❓ Unknown page type, waiting for navigation");
      await this.waitForValidPage();
    }
  }

  isGlassdoorJobPage(url) {
    return (
      /^https:\/\/(www\.)?glassdoor\.com\/(job|Job|partner)/.test(url) &&
      !url.includes("/Job/") &&
      !url.includes("-jobs-")
    );
  }

  // ========================================
  // SEARCH PROCESS (Queue-based like Wellfound)
  // ========================================

  async startSearchProcess() {
    try {
      if (this.searchProcessStarted) {
        this.log("⚠️ Search process already started, ignoring duplicate");
        return;
      }

      this.searchProcessStarted = true;
      this.statusOverlay.addMessage("Starting Glassdoor job search...");

      // Get search task data from background
      await this.fetchSearchTaskData();
    } catch (error) {
      this.searchProcessStarted = false;
      this.reportError(error, { phase: "search" });
    }
  }

  async fetchSearchTaskData() {
    this.log("📡 Fetching Glassdoor search task data from background");
    this.statusOverlay.addMessage("Getting search task data...");

    const success = this.safeSendPortMessage({ type: "GET_SEARCH_TASK" });
    if (!success) {
      throw new Error("Failed to request search task data");
    }
  }

  // Handle search task data from background (like Wellfound)
  handleSearchTaskData(data) {
    try {
      this.log("📊 Processing Glassdoor search task data:", data);

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

      if (data.profile && !this.userProfile) {
        this.userProfile = data.profile;
        this.log("👤 User profile loaded from search task data");
      }

      this.log("✅ Glassdoor search data initialized:", this.searchData);
      this.statusOverlay.addSuccess("Search initialization complete");

      // Start building job queue and processing
      setTimeout(() => this.startQueueBasedSearch(), 1000);
    } catch (error) {
      this.log("❌ Error processing search task data:", error);
      this.statusOverlay.addError(
        "Error processing search task data: " + error.message
      );
    }
  }

  async startQueueBasedSearch() {
    try {
      this.log("🚀 Starting queue-based Glassdoor job search");
      this.statusOverlay.addMessage(
        "Building job queue from Glassdoor page..."
      );

      // Build initial job queue
      const queueBuilt = await this.buildJobQueue();

      if (!queueBuilt || this.jobQueue.length === 0) {
        this.log("❌ No jobs found to process");
        this.statusOverlay.addError("No jobs found on this page");
        this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
        return;
      }

      this.statusOverlay.addSuccess(
        `Found ${this.jobQueue.length} jobs to process`
      );

      // Start processing jobs from queue
      await this.processNextJobFromQueue();
    } catch (error) {
      this.log("❌ Error starting queue-based search:", error);
    }
  }

  // ========================================
  // JOB QUEUE MANAGEMENT (Following Wellfound pattern)
  // ========================================

  async buildJobQueue() {
    try {
      this.log("🏗️ Building job queue from Glassdoor job cards...");

      this.jobQueue = [];
      this.currentJobIndex = 0;

      await this.waitForPageLoad();
      await this.delay(2000);

      // Get job cards using CORRECT selector
      const jobCards = document.querySelectorAll(
        this.glassdoorConfig.selectors.jobCards
      );
      console.log(jobCards);
      this.log(`🔍 Found ${jobCards.length} job cards on Glassdoor page`);

      for (const jobCard of jobCards) {
        try {
          const jobInfo = this.extractJobInfoFromCard(jobCard);
          console.log(jobInfo);
          if (jobInfo && !this.isJobAlreadyProcessed(jobInfo.url)) {
            this.jobQueue.push(jobInfo);
            this.log(`➕ Added job: ${jobInfo.title} at ${jobInfo.company}`);
          }
        } catch (error) {
          this.log(`❌ Error processing job card:`, error);
          continue;
        }
      }

      this.queueInitialized = true;
      this.log(
        `✅ Glassdoor job queue built with ${this.jobQueue.length} jobs`
      );

      return this.jobQueue.length > 0;
    } catch (error) {
      this.log("❌ Error building job queue:", error);
      return false;
    }
  }

  extractJobInfoFromCard(jobCard) {
    try {
      const jobTitleElement = jobCard.querySelector(
        this.glassdoorConfig.selectors.jobTitle
      );
      const companyElement = jobCard.querySelector(
        this.glassdoorConfig.selectors.companyName
      );
      const locationElement = jobCard.querySelector(
        this.glassdoorConfig.selectors.location
      );
      const salaryElement = jobCard.querySelector(
        this.glassdoorConfig.selectors.salary
      );

      // Check for Easy Apply button with CORRECT selector
      const easyApplyButton = jobCard.querySelector(
        this.glassdoorConfig.selectors.easyApplyButton
      );

      if (!easyApplyButton) {
        this.log(`⏭️ Skipping job - no Easy Apply button found`);
        return null;
      }

      // Get job URL - this might be in the job title link or card itself
      let jobUrl = null;
      const jobLink =
        jobCard.querySelector("a[href*='/job/']") ||
        jobCard.querySelector("a[href*='/partner/']") ||
        jobTitleElement?.closest("a");

      if (jobLink && jobLink.href) {
        jobUrl = jobLink.href;
      } else {
        this.log(`⏭️ Skipping job - no job URL found`);
        return null;
      }

      return {
        url: jobUrl,
        title: jobTitleElement?.textContent?.trim() || "Unknown Title",
        company: companyElement?.textContent?.trim() || "Unknown Company",
        location: locationElement?.textContent?.trim() || "Unknown Location",
        salary: salaryElement?.textContent?.trim() || "Not specified",
        element: jobCard,
        easyApplyButton: easyApplyButton,
        extractedAt: Date.now(),
      };
    } catch (error) {
      this.log(`❌ Error extracting job info:`, error);
      return null;
    }
  }

  isJobAlreadyProcessed(url) {
    const normalizedUrl = this.normalizeUrl(url);
    return this.searchData.submittedLinks.some(
      (link) => this.normalizeUrl(link.url) === normalizedUrl
    );
  }

  async processNextJobFromQueue() {
    try {
      // Check application limit
      if (this.searchData.current >= this.searchData.limit) {
        this.log("🏁 Reached job application limit");
        this.statusOverlay.addSuccess("Reached application limit");
        this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
        return;
      }

      // Check if queue is empty
      if (this.currentJobIndex >= this.jobQueue.length) {
        this.log("📭 Job queue exhausted");
        this.statusOverlay.addSuccess("All jobs processed");
        this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
        return;
      }

      // Get next job from queue
      const nextJob = this.jobQueue[this.currentJobIndex];
      this.currentJobIndex++;

      this.log(
        `🎯 Processing job ${this.currentJobIndex}/${this.jobQueue.length}: ${nextJob.title}`
      );
      this.statusOverlay.addMessage(
        `Processing: ${nextJob.title} at ${nextJob.company}`
      );

      await this.delay(this.glassdoorConfig.delays.betweenJobs);

      // Send job to background for processing in new tab (like Wellfound)
      const success = await this.processJobFromQueue(nextJob);

      if (!success) {
        this.searchData.submittedLinks.push({
          url: nextJob.url,
          status: "FAILED",
          message: "Failed to process job",
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

  async processJobFromQueue(jobInfo) {
    try {
      this.log(
        `🎯 Sending job to background: ${jobInfo.title} - ${jobInfo.url}`
      );

      // Send to background script to open in new tab (like Wellfound pattern)
      const success = this.safeSendPortMessage({
        type: "START_APPLICATION",
        data: {
          url: jobInfo.url,
          title: jobInfo.title,
          company: jobInfo.company,
          location: jobInfo.location,
          salary: jobInfo.salary,
        },
      });

      if (!success) {
        throw new Error("Failed to send job to background script");
      }

      return true;
    } catch (error) {
      this.log(`❌ Error processing job: ${error.message}`);
      return false;
    }
  }

  // ========================================
  // APPLICATION PROCESS (Indeed SmartApply)
  // ========================================

  async startApplicationProcess() {
    try {
      this.log("📝 Starting Glassdoor/SmartApply application process");
      this.statusOverlay.addMessage("Starting application process...");

      // Validate user profile
      if (!this.userProfile) {
        this.log("⚠️ No user profile available, attempting to fetch...");
        await this.fetchApplicationTaskData();
      }

      // Wait for page to load
      await this.delay(3000);

      // Determine if this is SmartApply or regular Glassdoor
      if (window.location.href.includes("smartapply.indeed.com")) {
        await this.handleSmartApplyFlow();
      } else {
        await this.handleRegularGlassdoorFlow();
      }
    } catch (error) {
      this.reportError(error, { phase: "application" });
      this.handleApplicationError(error);
    }
  }

  async handleSmartApplyFlow() {
    try {
      this.log("🔄 Processing Indeed SmartApply multi-step form");
      this.statusOverlay.addMessage("Processing SmartApply form...");

      // Wait for form to load
      await this.waitForElementWithTimeout("form", 15000);

      let currentStep = 1;
      const maxSteps = 10; // Safety limit
      let applicationCompleted = false;

      while (currentStep <= maxSteps && !applicationCompleted) {
        this.log(`📄 Processing SmartApply step ${currentStep}`);
        this.statusOverlay.addMessage(`Processing step ${currentStep}...`);

        // Wait for page content to load
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
        } else if (stepResult.nextStep) {
          // Find and click next/continue button
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
        await this.handleSuccessfulApplication();
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
      // Check for different step types
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

  isResumeStep() {
    return (
      document.querySelector("input[type='file']") !== null ||
      document.body.textContent.toLowerCase().includes("resume")
    );
  }

  async handleResumeStep() {
    this.log("📄 Handling resume upload step");
    // Most SmartApply forms auto-detect resume, so just continue
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

    try {
      // Fill basic contact info using user profile
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

      this.log("✅ Contact information filled");
      return { nextStep: true };
    } catch (error) {
      this.log("⚠️ Contact info error:", error.message);
      return { nextStep: true }; // Continue anyway
    }
  }

  isQuestionsStep() {
    return (
      document.querySelector("input[type='radio'], select, textarea") !==
        null || document.body.textContent.toLowerCase().includes("question")
    );
  }

  async handleQuestionsStep() {
    this.log("❓ Handling questions step");

    try {
      // Get all form fields and process them
      const fields = this.getAllFormFields();

      for (const field of fields) {
        await this.processFormField(field);
        await this.delay(300);
      }

      this.log("✅ Questions processed");
      return { nextStep: true };
    } catch (error) {
      this.log("⚠️ Questions error:", error.message);
      return { nextStep: true };
    }
  }

  isReviewStep() {
    return (
      document.body.textContent.toLowerCase().includes("review") ||
      document.body.textContent.toLowerCase().includes("submit") ||
      document.querySelector("button[type='submit']") !== null
    );
  }

  async handleReviewStep() {
    this.log("📋 Handling review/submit step");

    const submitButton = this.findSmartApplySubmitButton();
    if (submitButton) {
      this.log("📤 Found submit button, submitting application");
      await this.clickElementReliably(submitButton);
      await this.delay(5000);

      if (this.checkSmartApplyCompletion()) {
        return { completed: true };
      }
    }

    return { nextStep: true };
  }

  async handleGenericStep() {
    this.log("📝 Handling generic form step");

    try {
      const fields = this.getAllFormFields();
      for (const field of fields) {
        await this.processFormField(field);
      }
      return { nextStep: true };
    } catch (error) {
      this.log("⚠️ Generic step error:", error.message);
      return { nextStep: true };
    }
  }

  // ========================================
  // FORM HANDLING UTILITIES
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
          id: element.id || "",
          required: element.required || fieldInfo.label.includes("*"),
          placeholder: element.placeholder || "",
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
      element.closest(".form-group, .field")?.querySelector("label")
        ?.textContent,
    ];

    const label = sources.find((source) => source && source.trim()) || "";

    return {
      label: label.trim().replace(/\s+/g, " "),
      element: element,
    };
  }

  async processFormField(field) {
    try {
      this.log(`🔧 Processing field: ${field.label} (${field.type})`);

      const answer = await this.getAnswerForField(field);

      if (!answer && answer !== 0) {
        this.log(`⏭️ No answer for field: ${field.label}`);
        return;
      }

      // Fill the field based on its type
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
          await this.fillRadio(field.element, answer, field.label);
          break;

        case "checkbox":
          await this.fillCheckbox(field.element, answer);
          break;

        default:
          this.log(`❓ Unknown field type: ${field.type}`);
      }

      this.log(`✅ Filled field: ${field.label} = ${answer}`);
    } catch (error) {
      this.log(`❌ Error processing field ${field.label}:`, error.message);
    }
  }

  async getAnswerForField(field) {
    const normalizedLabel = field.label.toLowerCase().trim();

    // Get answer from AI service or fallback
    try {
      if (this.aiService) {
        const answer = await this.aiService.getAnswer(field.label, [], {
          userData: this.userProfile,
          platform: "glassdoor",
        });
        return answer;
      }
    } catch (error) {
      this.log("⚠️ AI service error:", error.message);
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
      "start date": "Immediately",
      "notice period": "2 weeks",
      salary: "Competitive",
      relocate: "Yes",
    };

    for (const [key, value] of Object.entries(fallbackAnswers)) {
      if (normalizedLabel.includes(key)) {
        return value;
      }
    }

    return "Yes"; // Default fallback
  }

  // ========================================
  // UTILITY METHODS
  // ========================================

  findSmartApplyNextButton() {
    // Use the CORRECT selector from your description
    const correctButton = document.querySelector(
      this.glassdoorConfig.selectors.continueButton
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
      ".aba5bff612c96e760268ff66780c44f60", // From your description
      "button[type='submit']",
    ];

    for (const selector of fallbackSelectors) {
      const button = document.querySelector(selector);
      if (button && this.isElementVisible(button) && !button.disabled) {
        return button;
      }
    }

    return null;
  }

  findSmartApplySubmitButton() {
    const selectors = [
      "button:contains('Submit')",
      "button:contains('Apply')",
      "button[type='submit']",
      ".submit-btn",
    ];

    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button && this.isElementVisible(button) && !button.disabled) {
        return button;
      }
    }

    return null;
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
    const hasSuccessText = successIndicators.some((indicator) =>
      pageText.includes(indicator)
    );

    const url = window.location.href.toLowerCase();
    const hasSuccessUrl =
      url.includes("success") ||
      url.includes("confirmation") ||
      url.includes("complete");

    return hasSuccessText || hasSuccessUrl;
  }

  // ========================================
  // MESSAGE HANDLING (Following Wellfound pattern)
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
          this.log("✅ Port connection established with background script");
          break;

        case "SEARCH_TASK_DATA":
          this.handleSearchTaskData(data);
          break;

        case "APPLICATION_TASK_DATA":
          this.handleApplicationTaskData(data);
          break;

        case "SEARCH_NEXT":
          this.handleSearchNext(data);
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
      this.log("📊 Processing Glassdoor application task data:", data);

      if (data?.profile && !this.userProfile) {
        this.userProfile = data.profile;
        this.log("👤 User profile loaded from application task data");
      }

      this.statusOverlay.addSuccess("Application initialization complete");
    } catch (error) {
      this.log("❌ Error processing application task data:", error);
    }
  }

  handleSearchNext(data) {
    try {
      this.log("🔄 Received search next signal:", data);

      if (data && data.submittedLinks) {
        this.searchData.submittedLinks = data.submittedLinks;
      }
      if (data && data.current !== undefined) {
        this.searchData.current = data.current;
      }

      setTimeout(() => this.processNextJobFromQueue(), 1000);
    } catch (error) {
      this.log("❌ Error handling search next:", error);
    }
  }

  handleSuccessMessage(data) {
    if (data && data.submittedLinks !== undefined) {
      this.handleSearchTaskData(data);
    } else if (data && data.profile !== undefined && !this.userProfile) {
      this.handleApplicationTaskData(data);
    }
  }

  async fetchApplicationTaskData() {
    this.log("📡 Fetching Glassdoor application task data from background");
    const success = this.safeSendPortMessage({ type: "GET_SEND_CV_TASK" });
    if (!success) {
      throw new Error("Failed to request application task data");
    }
  }

  async handleSuccessfulApplication() {
    const jobTitle = this.extractJobTitle() || "Job on Glassdoor";
    const jobId = this.extractJobIdFromUrl(window.location.href);

    this.safeSendPortMessage({
      type: "APPLICATION_SUCCESS",
      data: {
        jobId,
        title: jobTitle,
        company: "Company on Glassdoor",
        location: "Not specified",
        jobUrl: window.location.href,
        platform: "glassdoor",
      },
    });

    this.statusOverlay.addSuccess("Application completed successfully!");
    this.applicationState.isApplicationInProgress = false;
  }

  handleApplicationError(error) {
    this.safeSendPortMessage({
      type: "APPLICATION_ERROR",
      data: this.errorToString(error),
    });
    this.applicationState.isApplicationInProgress = false;
  }

  // ========================================
  // HELPER UTILITIES
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

      if (
        optionText.includes(searchValue) ||
        searchValue.includes(optionText)
      ) {
        element.value = option.value;
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
    }
  }

  async fillRadio(element, value, fieldLabel) {
    const radioGroup = document.querySelectorAll(
      `input[name="${element.name}"]`
    );

    for (const radio of radioGroup) {
      const radioLabel = this.getRadioLabel(radio);
      const searchValue = value.toString().toLowerCase();

      if (radioLabel.toLowerCase().includes(searchValue)) {
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
      radioElement.nextElementSibling?.textContent,
    ];

    return sources.find((source) => source && source.trim()) || "";
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

  extractJobTitle() {
    const selectors = ["h1", ".job-title", "[data-testid='job-title']"];
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element.textContent?.trim();
      }
    }
    return "";
  }

  extractJobIdFromUrl(url) {
    try {
      const match = url.match(/JV_IC(\d+)/) || url.match(/jobListingId=(\d+)/);
      return match ? match[1] : null;
    } catch (error) {
      return null;
    }
  }

  normalizeUrl(url) {
    try {
      if (!url) return "";
      return url.toLowerCase().replace(/\/+$/, "").trim();
    } catch (error) {
      return url;
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

      if (
        url.includes("glassdoor.com") ||
        url.includes("smartapply.indeed.com")
      ) {
        await this.detectPageTypeAndStart();
        return;
      }

      await this.delay(1000);
    }

    throw new Error("Timeout waiting for valid Glassdoor page");
  }

  errorToString(e) {
    if (e instanceof Error) {
      return e.stack || e.message;
    }
    return String(e);
  }

  async setSessionContext(sessionContext) {
    await super.setSessionContext(sessionContext);
    this.log("✅ Glassdoor session context set successfully");
  }

  cleanup() {
    super.cleanup();

    // Glassdoor-specific cleanup
    this.jobQueue = [];
    this.currentJobIndex = 0;
    this.isLoadingMore = false;
    this.queueInitialized = false;
    this.searchProcessStarted = false;

    this.log("🧹 Glassdoor-specific cleanup completed");
  }

  //_+++++++++++++++++++++++++++++++++++

  /**
   * Enhanced process job card - clicks card first to reveal details
   */
  async processGlassdoorJobCard(jobData) {
    const { card, url, cardId } = jobData;

    this.statusOverlay.addInfo("Found Glassdoor job card - loading details...");
    this.processedJobCards.add(cardId);

    if (this.applicationState.isApplicationInProgress) {
      this.log("Application became in progress, aborting new task");
      return;
    }

    // Step 1: Click the job card first to expand details
    this.markJobCardAsProcessing(card);

    try {
      this.statusOverlay.addInfo("Clicking job card to load details...");
      await this.clickJobCardToExpandDetails(card);

      // Step 2: Wait for job details to load
      this.statusOverlay.addInfo("Waiting for job details to load...");
      await this.waitForJobDetailsToLoad();

      // Step 3: Check for Easy Apply after details are loaded
      const hasEasyApplyNow = await this.checkForEasyApplyAfterExpansion();

      if (!hasEasyApplyNow) {
        this.statusOverlay.addWarning(
          "No Easy Apply available for this job - skipping"
        );
        this.markJobCardAsSkipped(card, "No Easy Apply");
        return;
      }

      // Step 4: Now proceed with application
      this.statusOverlay.addSuccess(
        "Easy Apply found - proceeding with application! 🎯"
      );
      await this.proceedWithJobApplication(card, url, cardId);
    } catch (error) {
      this.log("Error processing Glassdoor job card:", error);
      this.handleJobCardError(card, error);
    }
  }

  /**
   * Click job card to expand and show details
   */
  async clickJobCardToExpandDetails(card) {
    // Find the clickable area of the job card
    const clickableSelectors = [
      'a[data-test="job-link"]', // Main job link
      ".JobCard_trackingLink__HMyun", // Glassdoor job card link
      ".JobCard_jobTitle__GLyJ1 a", // Job title link
      ".job-title a", // Generic job title
      "h3 a", // Heading link
      ".jobTitle a", // Alternative job title
    ];

    let clickableElement = null;

    // Try to find a clickable element within the card
    for (const selector of clickableSelectors) {
      const element = card.querySelector(selector);
      if (element && this.isElementVisible(element)) {
        clickableElement = element;
        break;
      }
    }

    // If no specific link found, try clicking the card itself
    if (!clickableElement) {
      clickableElement = card;
    }

    this.log(
      `Clicking job card element: ${clickableElement.tagName}${
        clickableElement.className ? "." + clickableElement.className : ""
      }`
    );

    try {
      // Scroll element into view
      clickableElement.scrollIntoView({ behavior: "smooth", block: "center" });
      await this.delay(500);

      // Try multiple click strategies
      await this.clickElementReliably(clickableElement);

      this.log("✅ Job card clicked successfully");
      return true;
    } catch (error) {
      throw new Error(`Failed to click job card: ${error.message}`);
    }
  }

  /**
   * Wait for job details to load after clicking card
   */
  async waitForJobDetailsToLoad(timeout = 10000) {
    const startTime = Date.now();

    this.log("⏳ Waiting for job details to load...");

    while (Date.now() - startTime < timeout) {
      // Check for various indicators that job details have loaded
      const detailsLoaded = await this.checkIfJobDetailsLoaded();

      if (detailsLoaded) {
        this.log("✅ Job details loaded successfully");
        return true;
      }

      await this.delay(500);
    }

    throw new Error("Timeout waiting for job details to load");
  }

  /**
   * Check if job details have loaded
   */
  async checkIfJobDetailsLoaded() {
    // Check for indicators that job details are now visible
    const detailIndicators = [
      'button[data-test="easyApply"]', // Easy Apply button
      ".EasyApplyButton_content__1cGPo", // Easy Apply button content
      ".jobDescriptionContent", // Job description
      '[data-test="jobDescriptionText"]', // Job description text
      ".JobDetails_jobDescription__uW_fK", // Job details description
      ".applyButton", // Apply button
      ".job-description", // Generic job description
      '[data-test="detailSalary"]', // Salary details
      ".JobCard_salaryEstimate__QpbTW", // Salary estimate
    ];

    for (const selector of detailIndicators) {
      const element = document.querySelector(selector);
      if (element && this.isElementVisible(element)) {
        this.log(`✅ Job details loaded - found: ${selector}`);
        return true;
      }
    }

    // Check if any new content appeared in the main content area
    const mainContent = document.querySelector(
      ".MainCol, .job-details, .jobsOverlayModal"
    );
    if (mainContent) {
      const hasSignificantContent = mainContent.textContent.length > 500; // Arbitrary threshold
      if (hasSignificantContent) {
        this.log("✅ Job details loaded - significant content detected");
        return true;
      }
    }

    return false;
  }

  /**
   * Check for Easy Apply button after job details expansion
   */
  async checkForEasyApplyAfterExpansion() {
    const easyApplySelectors = [
      'button[data-test="easyApply"]',
      ".EasyApplyButton_content__1cGPo",
      "button.applyButton",
      '.apply-button[data-test="apply"]',
      'button:contains("Easy Apply")',
      'button:contains("Apply")',
    ];

    this.log("🔍 Checking for Easy Apply button after expansion...");

    for (const selector of easyApplySelectors) {
      // Handle text-based selectors
      if (selector.includes(":contains(")) {
        const text = selector.includes("Easy Apply") ? "easy apply" : "apply";
        const buttons = document.querySelectorAll("button");

        for (const button of buttons) {
          if (this.isElementVisible(button) && !button.disabled) {
            const buttonText = button.textContent?.toLowerCase().trim();
            if (
              buttonText === text ||
              (text === "apply" && buttonText === "apply now")
            ) {
              this.log(`✅ Found Easy Apply button with text: "${buttonText}"`);
              return true;
            }
          }
        }
      } else {
        const elements = document.querySelectorAll(selector);
        for (const element of elements) {
          if (this.isElementVisible(element) && !element.disabled) {
            this.log(`✅ Found Easy Apply button with selector: ${selector}`);
            return true;
          }
        }
      }
    }

    this.log("❌ No Easy Apply button found after expansion");
    return false;
  }

  /**
   * Proceed with job application after confirming Easy Apply is available
   */
  async proceedWithJobApplication(card, url, cardId) {
    // Set application state
    this.applicationState.isApplicationInProgress = true;
    this.applicationState.applicationStartTime = Date.now();

    if (!this.applicationState.processedUrls) {
      this.applicationState.processedUrls = new Set();
    }
    this.applicationState.processedUrls.add(this.normalizeUrlFully(url));

    this.setStuckDetectionTimeout();

    try {
      // Extract job title from the expanded details
      const jobTitle =
        this.extractJobTitleFromExpandedDetails() ||
        this.getJobTitleFromCard(card) ||
        "Job Application";

      this.statusOverlay.addSuccess(`Applying to: ${jobTitle}`);

      this.safeSendPortMessage({
        type: this.getJobTaskMessageType(),
        data: {
          url,
          title: jobTitle,
        },
      });
    } catch (err) {
      this.handleJobTaskError(err, url, card);
    }
  }

  /**
   * Extract job title from expanded job details
   */
  extractJobTitleFromExpandedDetails() {
    const titleSelectors = [
      'h1[data-test="job-title"]',
      ".JobDetails_jobTitle__GLyJ1",
      ".jobDescriptionContent h1",
      ".jobDescriptionContent h2",
      '[data-test="jobTitle"]',
      ".job-title h1",
      ".job-title h2",
    ];

    for (const selector of titleSelectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent) {
        const title = element.textContent.trim();
        if (title.length > 0) {
          this.log(`📋 Extracted job title: ${title}`);
          return title;
        }
      }
    }

    return null;
  }

  /**
   * Handle job card processing errors
   */
  handleJobCardError(card, error) {
    this.log(`❌ Error processing job card: ${error.message}`);
    this.markJobCardAsSkipped(card, "Error");
    this.statusOverlay.addError(`Error processing job: ${error.message}`);

    // Reset application state
    this.resetApplicationStateOnError();
  }

  /**
   * Enhanced hasEasyApply method - checks both card and expanded state
   */
  hasEasyApply(card) {
    // First check if Easy Apply is visible on the card itself (sometimes it is)
    const cardEasyApply = this.hasEasyApplyOnCard(card);
    if (cardEasyApply) {
      return true;
    }

    // If not found on card, we'll need to click and check
    // This will be handled in the main processing flow
    return true; // Assume it might have Easy Apply, will verify after clicking
  }

  /**
   * Check for Easy Apply button specifically on the job card (before expansion)
   */
  hasEasyApplyOnCard(card) {
    const easyApplySelectors = [
      'button[data-test="easyApply"]',
      ".EasyApplyButton_content__1cGPo",
      "button.applyButton",
      "a.applyButton",
    ];

    for (const selector of easyApplySelectors) {
      const button = card.querySelector(selector);
      if (button && this.isElementVisible(button)) {
        const buttonText = button.textContent?.trim().toLowerCase();
        if (buttonText.includes("easy apply") || buttonText.includes("apply")) {
          return true;
        }
      }
    }

    return false;
  }

  /**
   * Enhanced findUnprocessedJobCard to use the new click-first logic
   */
  findUnprocessedJobCard(jobCards) {
    for (const card of jobCards) {
      const cardId = this.getJobCardId(card);

      if (this.processedJobCards.has(cardId)) {
        continue;
      }

      const jobUrl = this.getJobUrlFromCard(card);
      if (!jobUrl) continue;

      const normalizedUrl = this.normalizeUrlFully(jobUrl);

      // Check if already processed
      if (this.isLinkProcessed(normalizedUrl)) {
        this.processedJobCards.add(cardId);
        continue;
      }

      // For Glassdoor, we'll assume the job might have Easy Apply
      // We'll verify this after clicking the card
      return { card, url: jobUrl, cardId };
    }

    return null;
  }

  /**
   * Updated processGlassdoorJobCards method
   */
  async processGlassdoorJobCards() {
    const jobCards = this.getGlassdoorJobCards();
    this.log(`Found ${jobCards.length} job cards on Glassdoor`);

    if (jobCards.length === 0) {
      await this.handleNoJobCardsFound();
      return;
    }

    // Find unprocessed job card
    const unprocessedCard = this.findUnprocessedJobCard(jobCards);

    if (unprocessedCard) {
      // Use the new enhanced processing method
      await this.processGlassdoorJobCard(unprocessedCard);
    } else {
      await this.handleNoUnprocessedJobCards();
    }
  }

  /**
   * Updated searchNext method to work with the new job card logic
   */
  async searchNext() {
    try {
      // Check if automation is paused
      if (this.isPaused) {
        this.log("Automation is paused, not searching");
        return;
      }

      this.log("🔍 Executing Glassdoor searchNext");

      if (this.applicationState.isApplicationInProgress) {
        this.log("Application in progress, not searching for next job");
        this.statusOverlay.addInfo(
          "Application in progress, waiting to complete..."
        );
        this.safeSendPortMessage({ type: "CHECK_APPLICATION_STATUS" });
        return;
      }

      this.statusOverlay.addInfo("Searching for job cards...");

      // Check if we're on Glassdoor search results page
      if (this.isGlassdoorSearchPage(window.location.href)) {
        await this.processGlassdoorJobCards();
      } else if (this.isGlassdoorJobPage(window.location.href)) {
        // If we're on a specific job page (possibly after clicking a card)
        this.statusOverlay.addInfo(
          "On Glassdoor job page - processing application"
        );
        await this.startApplicationProcess();
      } else {
        // Fall back to standard Google search link processing
        await super.searchNext();
      }
    } catch (err) {
      this.log("Error in Glassdoor searchNext:", err);
      this.statusOverlay.addError("Error in search: " + err.message);
      this.resetApplicationStateOnError();
      setTimeout(() => {
        if (!this.isPaused) {
          this.searchNext();
        }
      }, 5000);
    }
  }

  /**
   * Enhanced visual feedback methods
   */
  markJobCardAsProcessing(card) {
    try {
      card.style.border = "2px solid #2196F3";
      card.style.backgroundColor = "rgba(33, 150, 243, 0.1)";
      card.style.transform = "scale(1.02)";
      card.style.transition = "all 0.3s ease";

      const indicator = document.createElement("div");
      indicator.className = "processing-indicator";
      indicator.style.cssText = `
      position: absolute;
      top: 8px;
      right: 8px;
      background: linear-gradient(135deg, #2196F3, #1976D2);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      z-index: 10;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
      animation: pulse 2s infinite;
    `;
      indicator.textContent = "Loading...";

      // Add pulse animation
      const style = document.createElement("style");
      style.textContent = `
      @keyframes pulse {
        0% { opacity: 1; }
        50% { opacity: 0.7; }
        100% { opacity: 1; }
      }
    `;
      document.head.appendChild(style);

      card.style.position = "relative";
      card.appendChild(indicator);
    } catch (error) {
      this.log("Error marking job card as processing:", error);
    }
  }

  markJobCardAsSkipped(card, reason) {
    try {
      card.style.border = "2px solid #FF9800";
      card.style.backgroundColor = "rgba(255, 152, 0, 0.1)";
      card.style.opacity = "0.7";
      card.style.transform = "scale(0.98)";

      // Remove any existing indicators
      const existingIndicator = card.querySelector(
        ".processing-indicator, .skipped-indicator"
      );
      if (existingIndicator) {
        existingIndicator.remove();
      }

      const indicator = document.createElement("div");
      indicator.className = "skipped-indicator";
      indicator.style.cssText = `
      position: absolute;
      top: 8px;
      right: 8px;
      background: linear-gradient(135deg, #FF9800, #F57C00);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      z-index: 10;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    `;
      indicator.textContent = reason;

      card.style.position = "relative";
      card.appendChild(indicator);
    } catch (error) {
      this.log("Error marking job card as skipped:", error);
    }
  }

  markJobCardAsSuccess(card) {
    try {
      card.style.border = "2px solid #4CAF50";
      card.style.backgroundColor = "rgba(76, 175, 80, 0.1)";
      card.style.transform = "scale(1.0)";

      // Remove any existing indicators
      const existingIndicator = card.querySelector(
        ".processing-indicator, .skipped-indicator"
      );
      if (existingIndicator) {
        existingIndicator.remove();
      }

      const indicator = document.createElement("div");
      indicator.className = "success-indicator";
      indicator.style.cssText = `
      position: absolute;
      top: 8px;
      right: 8px;
      background: linear-gradient(135deg, #4CAF50, #388E3C);
      color: white;
      padding: 4px 8px;
      border-radius: 4px;
      font-size: 11px;
      font-weight: 600;
      z-index: 10;
      box-shadow: 0 2px 4px rgba(0,0,0,0.2);
    `;
      indicator.textContent = "✓ Applied";

      card.style.position = "relative";
      card.appendChild(indicator);
    } catch (error) {
      this.log("Error marking job card as success:", error);
    }
  }

  /**
   * Enhanced handleSearchNext to mark cards appropriately
   */
  handleSearchNext(data) {
    this.log("🔄 Received search next notification", data);

    // Clear timeout first
    if (this.sendCvPageNotRespondTimeout) {
      clearTimeout(this.sendCvPageNotRespondTimeout);
      this.sendCvPageNotRespondTimeout = null;
    }

    // Find and mark the job card based on the URL
    if (data && data.url) {
      const normalizedUrl = this.normalizeUrlFully(data.url);
      const jobCards = this.getGlassdoorJobCards();

      for (const card of jobCards) {
        const cardUrl = this.getJobUrlFromCard(card);
        if (cardUrl && this.normalizeUrlFully(cardUrl) === normalizedUrl) {
          if (data.status === "SUCCESS") {
            this.markJobCardAsSuccess(card);
            this.statusOverlay.addSuccess(
              "Application completed successfully! 🎉"
            );
          } else if (data.status === "ERROR") {
            this.markJobCardAsSkipped(card, "Error");
            this.statusOverlay.addError(
              "Application failed - continuing with next job"
            );
          } else {
            this.markJobCardAsSkipped(card, "Skipped");
            this.statusOverlay.addWarning("Job skipped - moving to next one");
          }
          break;
        }
      }
    }

    // Reset application state
    this.applicationState.isApplicationInProgress = false;
    this.applicationState.applicationStartTime = null;
    this.applicationState.processedLinksCount++;

    // Notify background we're ready for next job
    this.safeSendPortMessage({ type: "SEARCH_NEXT_READY" });

    this.updateLinkStatus(data);
    this.recordSubmission(data);

    setTimeout(() => {
      if (!this.isPaused) {
        this.searchNext();
      }
    }, 2500);
  }

  /**
   * Helper method to check if we're on a Glassdoor job listing page (after clicking a card)
   */
  isGlassdoorJobListingPage(url) {
    return (
      /^https:\/\/(www\.)?glassdoor\.com\/(job|Job|partner)/.test(url) &&
      !url.includes("/jobs.htm") &&
      !url.includes("/apply") &&
      (url.includes("jobListingId=") || url.match(/\/(job|Job)\/[^\/]+/))
    );
  }

  /**
   * Enhanced URL detection for different Glassdoor page types
   */
  detectPageTypeAndStart() {
    const url = window.location.href;
    this.log(`🔍 Detecting page type for: ${url}`);

    if (url.includes("google.com/search")) {
      this.statusOverlay.addInfo("Google search page detected");
      return this.startSearchProcess();
    } else if (this.isGlassdoorJobListingPage(url)) {
      this.statusOverlay.addInfo("Glassdoor job listing page detected");
      return this.startApplicationProcess();
    } else if (this.isGlassdoorSearchPage(url)) {
      this.statusOverlay.addInfo("Glassdoor search results page detected");
      return this.startJobSearchProcess();
    } else if (this.isGlassdoorApplicationPage(url)) {
      this.statusOverlay.addInfo("Glassdoor application page detected");
      return this.startApplicationProcess();
    } else {
      this.log("❓ Unknown page type, waiting for navigation");
      return this.waitForValidPage();
    }
  }
}
