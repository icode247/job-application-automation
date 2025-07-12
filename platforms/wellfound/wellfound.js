// platforms/wellfound/wellfound.js
import BasePlatform from "../base-platform.js";
import AIService from "../../services/ai-service.js";
import ApplicationTrackerService from "../../services/application-tracker-service.js";
import UserService from "../../services/user-service.js";
import { StatusOverlay } from "../../services/index.js";
import FileHandlerService from "../../services/file-handler-service.js";
import { UrlUtils, DomUtils, FormUtils } from "../../shared/utilities/index.js";

export default class WellfoundPlatform extends BasePlatform {
  constructor(config) {
    super(config);
    this.platform = "wellfound";
    this.baseUrl = "https://wellfound.com";
    this.hasStarted = false;
    this.automationStarted = false;
    this.processedJobs = new Set();
    this.answerCache = new Map();

    // Initialize services with API host
    const apiHost =
      config.apiHost || config.config?.apiHost || "https://api.yourdomain.com";
    this.HOST = apiHost;

    this.aiService = new AIService({ apiHost });
    this.appTracker = new ApplicationTrackerService({
      apiHost,
      userId: config.userId,
    });
    this.userService = new UserService({ apiHost, userId: config.userId });

    this.statusOverlay = new StatusOverlay({
      id: "wellfound-status-overlay",
      title: "WELLFOUND AUTOMATION",
      icon: "🚀",
      position: { top: "10px", right: "10px" },
    });

    this.fileHandler = new FileHandlerService({ apiHost });
    this.fileHandler.setStatusManager(this.statusOverlay);

    this.log(`🔧 Services initialized with API host: ${apiHost}`);
  }

  // ===== WELLFOUND-SPECIFIC VALIDATION =====
  validateWellfoundPreferences(preferences) {
    const errors = [];
    const warnings = [];

    // Validate positions
    if (
      !preferences.positions ||
      !Array.isArray(preferences.positions) ||
      preferences.positions.length === 0
    ) {
      errors.push("At least one job position is required");
    }

    // Validate location
    if (preferences.location && Array.isArray(preferences.location)) {
      const supportedLocations = [
        "San Francisco Bay Area",
        "New York City",
        "Los Angeles",
        "Boston",
        "Chicago",
        "Seattle",
        "Austin",
        "Denver",
        "Atlanta",
        "Remote",
        "Global",
      ];

      const unsupportedLocations = preferences.location.filter(
        (loc) => loc !== "Remote" && !supportedLocations.includes(loc)
      );

      if (unsupportedLocations.length > 0) {
        warnings.push(
          `Some locations may not have optimal filtering: ${unsupportedLocations.join(
            ", "
          )}`
        );
      }
    }

    // Validate job types
    if (preferences.jobType && Array.isArray(preferences.jobType)) {
      const validJobTypes = [
        "Full-time",
        "Part-time",
        "Contract",
        "Internship",
      ];
      const invalidJobTypes = preferences.jobType.filter(
        (type) => !validJobTypes.includes(type)
      );

      if (invalidJobTypes.length > 0) {
        errors.push(
          `Invalid job types: ${invalidJobTypes.join(
            ", "
          )}. Valid types: ${validJobTypes.join(", ")}`
        );
      }
    }

    // Validate experience levels
    if (preferences.experience && Array.isArray(preferences.experience)) {
      const validExperience = [
        "Internship",
        "Entry level",
        "Mid level",
        "Senior level",
        "Executive",
      ];
      const invalidExperience = preferences.experience.filter(
        (exp) => !validExperience.includes(exp)
      );

      if (invalidExperience.length > 0) {
        errors.push(
          `Invalid experience levels: ${invalidExperience.join(
            ", "
          )}. Valid levels: ${validExperience.join(", ")}`
        );
      }
    }

    // Validate company stage
    if (preferences.companyStage && Array.isArray(preferences.companyStage)) {
      const validStages = [
        "Pre-Seed",
        "Seed",
        "Series A",
        "Series B",
        "Series C+",
        "Public",
      ];
      const invalidStages = preferences.companyStage.filter(
        (stage) => !validStages.includes(stage)
      );

      if (invalidStages.length > 0) {
        warnings.push(
          `Some company stages may not be supported: ${invalidStages.join(
            ", "
          )}`
        );
      }
    }

    // Validate salary range
    if (preferences.salary) {
      if (
        !Array.isArray(preferences.salary) ||
        preferences.salary.length !== 2
      ) {
        errors.push("Salary must be an array with exactly 2 values [min, max]");
      } else {
        const [min, max] = preferences.salary;
        if (typeof min !== "number" || typeof max !== "number") {
          errors.push("Salary values must be numbers");
        } else if (min < 0 || max < 0) {
          errors.push("Salary values must be positive");
        } else if (min >= max) {
          errors.push("Minimum salary must be less than maximum salary");
        }
      }
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
    };
  }

  // ===== USER AUTHORIZATION & SERVICES =====
  async checkUserAuthorization() {
    try {
      this.statusOverlay.addInfo("Checking user authorization...");

      const canApply = await this.userService.canApplyMore();
      if (!canApply) {
        const remaining = await this.userService.getRemainingApplications();
        const userDetails = await this.userService.getUserDetails();

        const message =
          userDetails.userRole === "credit"
            ? `Insufficient credits (${userDetails.credits} remaining)`
            : `Daily limit reached (${remaining} applications remaining)`;

        this.statusOverlay.addWarning(`Cannot apply: ${message}`);
        throw new Error(`Cannot apply: ${message}`);
      }

      this.log("✅ User authorization check passed");
      this.statusOverlay.addSuccess("User authorization check passed");
    } catch (error) {
      this.log("❌ User authorization check failed:", error.message);
      this.statusOverlay.addError(
        "User authorization check failed: " + error.message
      );
      throw error;
    }
  }

  async initialize() {
    await super.initialize();
    this.log("🚀 Wellfound platform initialized");

    this.statusOverlay.create();
    this.statusOverlay.addSuccess("Wellfound automation initialized");
  }

  async start(params = {}) {
    if (this.hasStarted) {
      this.log(
        "⚠️ Wellfound automation already started, ignoring duplicate start request"
      );
      this.statusOverlay.addWarning("Wellfound automation already started");
      return;
    }

    this.hasStarted = true;
    this.isRunning = true;
    this.log("🚀 Starting Wellfound automation with user preferences");
    this.statusOverlay.addInfo(
      "Starting Wellfound automation with user preferences"
    );

    try {
      this.config = { ...this.config, ...params };

      // Validate Wellfound-specific preferences
      const validation = this.validateWellfoundPreferences(
        this.config.preferences || {}
      );

      if (!validation.isValid) {
        const errorMessage = `Invalid Wellfound preferences: ${validation.errors.join(
          ", "
        )}`;
        this.statusOverlay.addError(errorMessage);
        throw new Error(errorMessage);
      }

      if (validation.warnings.length > 0) {
        this.log("⚠️ Wellfound preference warnings:", validation.warnings);
        validation.warnings.forEach((warning) =>
          this.statusOverlay.addWarning(warning)
        );
      }

      // Update services with proper userId and config
      if (this.config.userId) {
        this.appTracker = new ApplicationTrackerService({
          apiHost: this.HOST,
          userId: this.config.userId,
        });
        this.userService = new UserService({
          apiHost: this.HOST,
          userId: this.config.userId,
        });
      }

      this.log("📋 Configuration loaded with validated preferences:", {
        jobsToApply: this.config.jobsToApply,
        preferences: this.config.preferences,
        userId: this.config.userId,
        validation: validation,
      });

      if (!this.config.jobsToApply || this.config.jobsToApply <= 0) {
        const errorMessage = "Invalid jobsToApply configuration";
        this.statusOverlay.addError(errorMessage);
        throw new Error(errorMessage);
      }

      // Check user authorization before starting
      await this.checkUserAuthorization();

      this.updateProgress({ total: this.config.jobsToApply });

      // Wait for basic page readiness first
      await this.waitForPageLoad();
      this.log("📄 Basic page loaded, current URL:", window.location.href);

      // Navigate to Wellfound Jobs with user preferences
      const currentUrl = window.location.href.toLowerCase();
      if (!currentUrl.includes("wellfound.com/jobs")) {
        this.log("📍 Navigating to Wellfound Jobs with user preferences");
        this.statusOverlay.addInfo(
          "Navigating to Wellfound Jobs with user preferences"
        );
        await this.navigateToWellfoundJobs();
      } else {
        this.log("✅ Already on Wellfound Jobs page");
        this.statusOverlay.addInfo("Already on Wellfound Jobs page");
        await this.applyAdditionalFilters();
      }

      // Wait for job search results to load
      await this.waitForSearchResultsLoad();

      // Start processing jobs
      this.automationStarted = true;
      this.statusOverlay.updateStatus("applying", "Processing jobs");
      await this.processJobs({ jobsToApply: this.config.jobsToApply });
    } catch (error) {
      this.hasStarted = false;
      this.reportError(error, { phase: "start" });
    }
  }

  async navigateToWellfoundJobs() {
    const searchUrl = await this.generateWellfoundSearchUrl(
      this.config.preferences || {}
    );
    this.log(`🔗 Navigating to: ${searchUrl}`);

    window.location.href = searchUrl;
    await this.delay(5000);
    await this.waitForPageLoad();
    this.log("✅ Navigation completed with user preferences applied");
    this.statusOverlay.addSuccess(
      "Navigation completed with user preferences applied"
    );
  }

  async generateWellfoundSearchUrl(preferences) {
    const baseUrl = "https://wellfound.com/jobs?";
    const params = new URLSearchParams();

    // Handle job positions/roles
    if (preferences.positions?.length) {
      params.set("role", preferences.positions.join(","));
    }

    // Handle location
    if (preferences.location?.length) {
      const location = preferences.location[0];
      if (location === "Remote") {
        params.set("remote", "true");
      } else {
        params.set("location", location);
      }
    }

    // Handle remote work preference
    if (preferences.remoteOnly) {
      params.set("remote", "true");
    }

    // Handle experience level
    if (preferences.experience?.length) {
      const experienceMap = {
        Internship: "intern",
        "Entry level": "junior",
        "Mid level": "mid",
        "Senior level": "senior",
        Executive: "lead",
      };

      const wellfoundExperience = preferences.experience
        .map((exp) => experienceMap[exp])
        .filter(Boolean);

      if (wellfoundExperience.length) {
        params.set("experience", wellfoundExperience.join(","));
      }
    }

    // Handle job type
    if (preferences.jobType?.length) {
      const jobTypeMap = {
        "Full-time": "full-time",
        "Part-time": "part-time",
        Contract: "contract",
        Internship: "internship",
      };

      const wellfoundJobTypes = preferences.jobType
        .map((type) => jobTypeMap[type])
        .filter(Boolean);

      if (wellfoundJobTypes.length) {
        params.set("jobType", wellfoundJobTypes.join(","));
      }
    }

    // Handle company stage
    if (preferences.companyStage?.length) {
      const stageMap = {
        "Pre-Seed": "pre-seed",
        Seed: "seed",
        "Series A": "series-a",
        "Series B": "series-b",
        "Series C+": "series-c",
        Public: "public",
      };

      const wellfoundStages = preferences.companyStage
        .map((stage) => stageMap[stage])
        .filter(Boolean);

      if (wellfoundStages.length) {
        params.set("stage", wellfoundStages.join(","));
      }
    }

    // Handle salary range
    if (preferences.salary?.length === 2) {
      const [minSalary, maxSalary] = preferences.salary;
      if (minSalary > 0) {
        params.set("minSalary", minSalary.toString());
      }
      if (maxSalary > 0) {
        params.set("maxSalary", maxSalary.toString());
      }
    }

    const finalUrl = baseUrl + params.toString();
    this.log("🔍 Generated Wellfound search URL:", {
      url: finalUrl,
      preferences: preferences,
    });

    return finalUrl;
  }

  async applyAdditionalFilters() {
    try {
      this.log("✅ Additional filters applied successfully");
      this.statusOverlay.addSuccess("Additional filters applied successfully");
    } catch (error) {
      this.log("⚠️ Failed to apply some additional filters:", error.message);
      this.statusOverlay.addWarning(
        "Failed to apply some additional filters: " + error.message
      );
    }
  }

  // ===== CORE WELLFOUND AUTOMATION METHODS =====
  async processJobs({ jobsToApply }) {
    let processedCount = 0;
    let appliedCount = 0;
    let skippedCount = 0;
    let processedJobs = new Set();
    let currentPage = 1;
    let noNewJobsCount = 0;
    const MAX_NO_NEW_JOBS = 3;

    try {
      this.log(
        `Starting to process jobs with user preferences. Target: ${jobsToApply} jobs`
      );
      this.log(`User preferences:`, this.config.preferences);
      this.statusOverlay.addInfo(
        `Starting to process ${jobsToApply} jobs with user preferences`
      );

      // Initial scroll to trigger job loading
      await this.initialScroll();

      while (appliedCount < jobsToApply) {
        const jobCards = await this.getJobCards();
        console.log(
          `Found ${jobCards.length} job cards on page ${currentPage}`
        );

        if (jobCards.length === 0) {
          console.log("No job cards found, trying to load more jobs");
          this.statusOverlay.addInfo("No job cards found, trying to load more");

          if (await this.scrollAndWaitForNewJobs()) {
            console.log("Scrolling loaded new jobs, continuing on same page");
            continue;
          }

          console.log("No new jobs after scrolling, checking next page");
          const hasNextPage = await this.goToNextPage(currentPage);
          if (hasNextPage) {
            currentPage++;
            noNewJobsCount = 0;
            await this.waitForPageLoad();
            continue;
          } else {
            console.log("No more pages available");
            this.statusOverlay.addWarning("No more pages available");
            break;
          }
        }

        let newJobsFound = false;
        let newApplicableJobsFound = false;

        this.log(
          `Processing ${jobCards.length} job cards on page ${currentPage}`
        );
        this.statusOverlay.addInfo(
          `Processing ${jobCards.length} job cards on page ${currentPage}`
        );

        for (const jobCard of jobCards) {
          if (appliedCount >= jobsToApply) {
            this.log(`Reached target of ${jobsToApply} jobs`);
            this.statusOverlay.addSuccess(
              `Reached target of ${jobsToApply} jobs`
            );
            break;
          }

          const jobId = this.getJobIdFromCard(jobCard);

          if (!jobId || processedJobs.has(jobId)) {
            continue;
          }

          processedJobs.add(jobId);
          newJobsFound = true;
          processedCount++;

          try {
            // Check if the job card is in view, if not, scroll to it
            if (!this.isElementInViewport(jobCard)) {
              jobCard.scrollIntoView({ behavior: "smooth", block: "center" });
              await this.sleep(1000);
            }

            // Click and wait for job details
            await this.clickJobCard(jobCard);
            await this.waitForJobDetailsLoad();

            // Get job details for preference matching
            const jobDetails = this.getJobProperties();

            // Check if job matches user preferences
            if (!this.doesJobMatchPreferences(jobDetails)) {
              this.log(
                `Skipping job "${jobDetails.title}" - doesn't match preferences`
              );
              this.statusOverlay.addWarning(
                `Skipping job "${jobDetails.title}" - doesn't match preferences`
              );
              skippedCount++;
              continue;
            }

            // Find the apply button
            const applyButton = await this.findApplyButton();
            if (!applyButton) {
              console.log(
                "No apply button found - job already applied or not available"
              );
              this.log(`No apply button found for job ${jobId}, skipping.`);
              skippedCount++;
              continue;
            }

            // Check if already applied using service
            const alreadyApplied = await this.appTracker.checkIfAlreadyApplied(
              jobId
            );
            if (alreadyApplied) {
              this.log(
                `Already applied to job ${jobId} (from database), skipping.`
              );
              skippedCount++;
              continue;
            }

            newApplicableJobsFound = true;

            this.updateProgress({
              current: `Processing: ${jobDetails.title} (Page ${currentPage})`,
            });

            this.statusOverlay.addInfo(`Processing: ${jobDetails.title}`);

            // Attempt to apply
            const success = await this.applyToJob(applyButton, jobDetails);

            if (success) {
              appliedCount++;
              this.progress.completed = appliedCount;
              this.updateProgress({ completed: appliedCount });

              // Update application count using user service
              await this.userService.updateApplicationCount();

              this.log(
                `Successfully applied to job ${appliedCount}/${jobsToApply} (${skippedCount} jobs skipped)`
              );
              this.statusOverlay.addSuccess(
                `Applied to job ${appliedCount}/${jobsToApply}`
              );

              this.reportApplicationSubmitted(jobDetails, {
                method: "Wellfound Apply",
                userId: this.config.userId || this.userId,
                matchedPreferences: true,
              });
            } else {
              this.progress.failed++;
              this.updateProgress({ failed: this.progress.failed });
              this.statusOverlay.addError(
                `Failed to apply to job: ${jobDetails.title}`
              );
            }

            await this.sleep(2000);
          } catch (error) {
            this.log(`Error processing job ${jobId} on page ${currentPage}`);
            this.statusOverlay.addError(
              `Error processing job ${jobId}: ${error.message}`
            );
            console.error(`Error processing job ${jobId}:`, error);
            continue;
          }
        }

        // Handle pagination logic
        if (!newApplicableJobsFound) {
          this.log(
            `No new applicable jobs found on page ${currentPage}, trying to scroll for more jobs...`
          );
          if (await this.scrollAndWaitForNewJobs()) {
            noNewJobsCount = 0;
            this.log(
              `Scrolling loaded new jobs on page ${currentPage}, continuing processing...`
            );
            continue;
          }

          this.log(
            `No more jobs loaded by scrolling on page ${currentPage}, moving to next page...`
          );
          const hasNextPage = await this.goToNextPage(currentPage);
          if (hasNextPage) {
            currentPage++;
            noNewJobsCount = 0;
            this.log(`Successfully moved to page ${currentPage}`);
            this.statusOverlay.addInfo(`Moving to page ${currentPage}`);
            await this.waitForPageLoad();
          } else {
            noNewJobsCount++;
            if (noNewJobsCount >= MAX_NO_NEW_JOBS) {
              this.log(
                `No more applicable jobs to apply. Applied to ${appliedCount}/${jobsToApply} (${skippedCount} jobs)`
              );
              this.statusOverlay.addWarning(
                `No more applicable jobs available. Applied to ${appliedCount}/${jobsToApply}`
              );
              break;
            }
          }
        } else {
          noNewJobsCount = 0;
          this.log(
            `Found and processed applicable jobs on page ${currentPage}, continuing...`
          );
        }
      }

      const completionStatus =
        appliedCount >= jobsToApply ? "target_reached" : "no_more_jobs";
      const message =
        appliedCount >= jobsToApply
          ? `Successfully applied to target of ${appliedCount}/${jobsToApply} jobs (Processed ${processedCount} total across ${currentPage} pages)`
          : `Applied to ${appliedCount}/${jobsToApply} jobs - no more jobs available (Skipped ${skippedCount} jobs that didn't match preferences)`;

      this.log(message);
      this.statusOverlay.addSuccess(message);
      this.reportComplete();

      return {
        status: completionStatus,
        message,
        appliedCount,
        processedCount,
        skippedCount,
        totalPages: currentPage,
        preferencesUsed: this.config.preferences,
      };
    } catch (error) {
      console.error("Error in processJobs:", error);
      this.statusOverlay.addError("Error in processJobs: " + error.message);
      this.reportError(error, { phase: "processJobs" });
      throw error;
    }
  }

  async applyToJob(applyButton, jobDetails) {
    try {
      this.statusOverlay.addInfo(
        `Starting application for: ${jobDetails.title}`
      );

      // Start application
      applyButton.click();
      await this.sleep(2000);

      // Handle application flow
      let currentStep = "initial";
      let attempts = 0;
      const maxAttempts = 15;

      while (currentStep !== "submitted" && attempts < maxAttempts) {
        await this.fillCurrentStep();
        currentStep = await this.moveToNextStep();
        attempts++;

        if (currentStep === "submitted") {
          await this.handlePostSubmissionModal();
        }
      }

      if (attempts >= maxAttempts) {
        this.statusOverlay.addError("Application took too many steps, closing");
        await this.closeApplication();
        await this.sleep(1000);
        return false;
      }

      await this.saveAppliedJob(jobDetails);
      this.statusOverlay.addSuccess(
        `Successfully applied to: ${jobDetails.title}`
      );
      return true;
    } catch (error) {
      this.statusOverlay.addError(`Application failed: ${error.message}`);
      await this.handleErrorState();
      await this.sleep(1000);
      return false;
    }
  }

  // ===== WELLFOUND-SPECIFIC SELECTORS AND METHODS =====
  async getJobCards() {
    // Wellfound job cards selector - adjust based on actual HTML structure
    const jobCards = document.querySelectorAll(
      '[data-test="StartupResult"], .job-listing, .startup-link'
    );
    return Array.from(jobCards);
  }

  getJobIdFromCard(jobCard) {
    // Extract job ID from Wellfound job card
    const jobLink = jobCard.querySelector('a[href*="/jobs/"]');
    if (jobLink) {
      const href = jobLink.href;
      const match = href.match(/\/jobs\/(\d+)/);
      return match ? match[1] : null;
    }

    // Fallback to data attributes
    return jobCard.dataset.jobId || jobCard.dataset.id || null;
  }

  async findApplyButton() {
    try {
      // Wellfound-specific apply button selectors
      const selectors = [
        '[data-test="apply-button"]',
        ".apply-button",
        'button[data-test="apply"]',
        'a[href*="/apply"]',
        'button:contains("Apply")',
      ];

      for (const selector of selectors) {
        const button = await this.waitForElement(selector, 2000);
        if (button && this.isElementVisible(button)) {
          return button;
        }
      }

      return null;
    } catch (error) {
      console.log("Apply button not found");
      return null;
    }
  }

  getJobProperties() {
    // Extract job details specific to Wellfound structure
    const title = DomUtils.extractText([
      '[data-test="startup-name"]',
      ".startup-name",
      "h1",
      ".job-title",
    ]);

    const company = DomUtils.extractText([
      '[data-test="company-name"]',
      ".company-name",
      ".startup-link",
    ]);

    const location = DomUtils.extractText([
      '[data-test="startup-location"]',
      ".location",
      ".job-location",
    ]);

    // Extract job ID from URL
    const jobId = UrlUtils.extractJobId(window.location.href, "wellfound");

    return {
      title: title || "Job Application",
      jobId,
      company: company || "Unknown Company",
      location: location || "Not specified",
      url: window.location.href,
      platform: this.platform,
    };
  }

  async clickJobCard(jobCard) {
    try {
      const clickableElement = jobCard.querySelector(
        'a[href*="/jobs/"], .job-title a, .startup-link'
      );

      if (!clickableElement) {
        throw new Error("No clickable element found in job card");
      }

      console.log("Found clickable element:", clickableElement.tagName);

      const clickEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      });

      clickableElement.dispatchEvent(clickEvent);
      console.log("Click event dispatched");

      await this.waitForJobDetailsLoad();
      console.log("Job details loaded successfully");

      return true;
    } catch (error) {
      console.error("Error clicking job card:", error);
      throw error;
    }
  }

  async waitForJobDetailsLoad() {
    try {
      console.log("Waiting for job details to load");
      const element = await this.waitForElement(
        '[data-test="startup-name"], .job-title, h1',
        10000
      );
      console.log("Job details element found");
      await this.sleep(1000);
      return element;
    } catch (error) {
      console.error("Error waiting for job details:", error);
      throw new Error("Job details failed to load");
    }
  }

  doesJobMatchPreferences(jobDetails) {
    const preferences = this.config.preferences || {};

    // Check if positions match
    if (preferences.positions?.length) {
      const jobTitle = jobDetails.title?.toLowerCase() || "";
      const hasMatchingPosition = preferences.positions.some((position) =>
        jobTitle.includes(position.toLowerCase())
      );

      if (!hasMatchingPosition) {
        this.log(
          `❌ Job title "${jobDetails.title}" doesn't match required positions`
        );
        return false;
      }
    }

    // Add more specific matching logic as needed
    return true;
  }

  // ===== FORM HANDLING =====
  async fillCurrentStep() {
    // Handle file uploads
    const fileInputs = document.querySelectorAll('input[type="file"]');
    if (fileInputs.length) {
      this.statusOverlay.addInfo("Uploading resume/cover letter...");

      for (const fileInput of fileInputs) {
        try {
          const userDetails = await this.userService.getUserDetails();
          const jobDescription = this.scrapeJobDescription();
          const success = await this.fileHandler.handleFileUpload(
            fileInput.closest(".file-upload-container, .form-group") ||
              fileInput.parentElement,
            userDetails,
            jobDescription
          );

          if (success) {
            this.log(`✅ File uploaded successfully`);
            this.statusOverlay.addSuccess("File uploaded successfully");
          } else {
            this.log(`⚠️ File upload failed`);
            this.statusOverlay.addWarning("File upload failed");
          }
        } catch (error) {
          this.log(`❌ File upload error: ${error.message}`);
          this.statusOverlay.addError("File upload error: " + error.message);
        }
      }
    }

    // Handle form fields
    const form = document.querySelector("form");
    if (form) {
      const fields = FormUtils.getAllFormFields(form);

      for (const field of fields) {
        if (field.type === "file") continue; // Already handled above

        try {
          const answer = await this.getAnswer(
            field.label,
            this.getFieldOptions(field)
          );
          if (answer) {
            await FormUtils.fillField(field.element, answer, field.type);
          }
        } catch (error) {
          this.log(`Error filling field ${field.label}:`, error);
        }
      }

      // Handle required checkboxes
      await FormUtils.handleRequiredCheckboxes(form);
    }
  }

  getFieldOptions(field) {
    if (field.type === "select") {
      return Array.from(field.element.options)
        .filter((opt) => opt.value && opt.value !== "")
        .map((opt) => opt.textContent.trim());
    }

    if (field.type === "radio") {
      const radioGroup = document.querySelectorAll(
        `input[name="${field.element.name}"]`
      );
      return Array.from(radioGroup).map((radio) => {
        const label = FormUtils.getFieldLabel(radio);
        return label || radio.value;
      });
    }

    return [];
  }

  async getAnswer(label, options = []) {
    const normalizedLabel = label?.toLowerCase()?.trim() || "";

    // Check cache first
    if (this.answerCache.has(normalizedLabel)) {
      return this.answerCache.get(normalizedLabel);
    }

    try {
      // Use AI service for smart answers
      const context = {
        platform: this.platform,
        userData: await this.userService.getUserDetails(),
        jobDescription: this.scrapeJobDescription(),
      };

      const answer = await this.aiService.getAnswer(label, options, context);

      // Cache the answer
      this.answerCache.set(normalizedLabel, answer);
      return answer;
    } catch (error) {
      console.error("AI Answer Error:", error);
      this.statusOverlay.addWarning("Using fallback answer for: " + label);

      // Fallback to simple default answers
      const defaultAnswers = {
        "work authorization": "Yes",
        "authorized to work": "Yes",
        "require sponsorship": "No",
        "require visa": "No",
        experience: "2 years",
        "years of experience": "2 years",
        phone: "555-0123",
        salary: "80000",
      };

      for (const [key, value] of Object.entries(defaultAnswers)) {
        if (normalizedLabel.includes(key)) {
          return value;
        }
      }

      // Return first option if available
      return options.length > 0 ? options[0] : "Yes";
    }
  }

  scrapeJobDescription() {
    const descriptionSelectors = [
      '[data-test="job-description"]',
      ".job-description",
      ".description",
      ".job-details",
    ];

    for (const selector of descriptionSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element.textContent.trim();
      }
    }

    return "No job description found";
  }

  async moveToNextStep() {
    try {
      const buttonSelectors = {
        submit: 'button[type="submit"], input[type="submit"]',
        next: 'button:contains("Next"), button:contains("Continue")',
        apply:
          'button:contains("Apply"), button:contains("Submit Application")',
        close: 'button:contains("Close"), button:contains("Done")',
      };

      // Wait for any button to appear
      await this.waitForAnyElement(Object.values(buttonSelectors));

      // Check for submit/apply buttons first
      if (await this.findAndClickButton(buttonSelectors.apply)) {
        this.statusOverlay.addInfo("Submitting application...");
        await this.sleep(2000);
        return "submitted";
      }

      if (await this.findAndClickButton(buttonSelectors.submit)) {
        this.statusOverlay.addInfo("Submitting application...");
        await this.sleep(2000);
        return "submitted";
      }

      if (await this.findAndClickButton(buttonSelectors.next)) {
        await this.sleep(2000);
        return "next";
      }

      if (await this.findAndClickButton(buttonSelectors.close)) {
        await this.sleep(2000);
        return "closed";
      }

      return "error";
    } catch (error) {
      return "error";
    }
  }

  // ===== UTILITY METHODS =====
  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async delay(ms) {
    return this.sleep(ms);
  }

  async waitForElement(selector, timeout = 10000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const element = document.querySelector(selector);
      if (element) return element;
      await this.sleep(100);
    }
    throw new Error(`Element not found: ${selector}`);
  }

  async waitForAnyElement(selectors, timeout = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element && this.isElementVisible(element)) {
          return element;
        }
      }
      await this.sleep(100);
    }
    throw new Error(`None of the elements found: ${selectors.join(", ")}`);
  }

  isElementVisible(element) {
    if (!element) return false;

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
  }

  isElementInViewport(element) {
    const rect = element.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <=
        (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
  }

  async findAndClickButton(selector) {
    const button = document.querySelector(selector);
    if (button && this.isElementVisible(button) && !button.disabled) {
      try {
        button.click();
        return true;
      } catch (error) {
        return false;
      }
    }
    return false;
  }

  // ===== NAVIGATION METHODS =====
  async initialScroll() {
    window.scrollTo(0, 0);
    await this.sleep(1000);

    // Scroll down to load more jobs
    for (let i = 0; i < 3; i++) {
      window.scrollBy(0, window.innerHeight);
      await this.sleep(1000);
    }

    window.scrollTo(0, 0);
    await this.sleep(1000);
  }

  async scrollAndWaitForNewJobs() {
    const previousJobCount = document.querySelectorAll(
      '[data-test="StartupResult"], .job-listing, .startup-link'
    ).length;

    window.scrollBy(0, window.innerHeight * 0.75);
    await this.sleep(2000);

    const newJobCount = document.querySelectorAll(
      '[data-test="StartupResult"], .job-listing, .startup-link'
    ).length;

    console.log(
      `Scroll check - Previous jobs: ${previousJobCount}, New jobs: ${newJobCount}`
    );

    return newJobCount > previousJobCount;
  }

  async goToNextPage(currentPage) {
    try {
      console.log(`Attempting to go to next page after page ${currentPage}`);

      // Look for next button
      const nextButton = document.querySelector(
        'button:contains("Next"), a:contains("Next"), .pagination-next'
      );

      if (
        nextButton &&
        this.isElementVisible(nextButton) &&
        !nextButton.disabled
      ) {
        console.log("Found next button, clicking it");
        this.statusOverlay.addInfo("Moving to next page...");
        nextButton.click();
        await this.waitForPageLoad();
        return true;
      }

      // Look for page numbers
      const pageButtons = document.querySelectorAll(
        ".pagination button, .pagination a"
      );
      for (const button of pageButtons) {
        const pageText = button.textContent.trim();
        if (pageText === String(currentPage + 1)) {
          console.log(`Found next page button for page ${currentPage + 1}`);
          this.statusOverlay.addInfo(`Moving to page ${currentPage + 1}`);
          button.click();
          await this.waitForPageLoad();
          return true;
        }
      }

      console.log("No next page available");
      return false;
    } catch (error) {
      console.error("Error navigating to next page:", error);
      this.statusOverlay.addError(
        "Error navigating to next page: " + error.message
      );
      return false;
    }
  }

  async waitForPageLoad() {
    try {
      // Wait for job listings to be present
      await this.waitForElement(
        '[data-test="StartupResult"], .job-listing, .startup-link',
        10000
      );
      await this.sleep(2000);

      // Wait for loading indicators to disappear
      const loadingIndicators = document.querySelectorAll(".loading, .spinner");
      for (const indicator of loadingIndicators) {
        if (this.isElementVisible(indicator)) {
          await new Promise((resolve) => {
            const observer = new MutationObserver(() => {
              if (!this.isElementVisible(indicator)) {
                observer.disconnect();
                resolve();
              }
            });
            observer.observe(document.body, { childList: true, subtree: true });
            setTimeout(() => {
              observer.disconnect();
              resolve();
            }, 10000);
          });
        }
      }
    } catch (error) {
      console.error("Error waiting for page load:", error);
    }
  }

  async waitForSearchResultsLoad() {
    return new Promise((resolve) => {
      const checkSearchResults = () => {
        const results = document.querySelectorAll(
          '[data-test="StartupResult"], .job-listing, .startup-link'
        );
        if (results.length > 0) {
          console.log("Search results loaded");
          this.statusOverlay.addSuccess("Search results loaded");
          resolve();
        } else {
          setTimeout(checkSearchResults, 500);
        }
      };
      checkSearchResults();
    });
  }

  // ===== APPLICATION CLEANUP METHODS =====
  async handlePostSubmissionModal() {
    try {
      await this.sleep(2000);

      const modalSelectors = [
        'button:contains("Close")',
        'button:contains("Done")',
        'button:contains("OK")',
        ".modal-close",
        ".close-button",
      ];

      for (const selector of modalSelectors) {
        const button = document.querySelector(selector);
        if (button && this.isElementVisible(button)) {
          button.click();
          await this.sleep(1000);
          return true;
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async closeApplication() {
    try {
      const closeSelectors = [
        'button:contains("Cancel")',
        'button:contains("Close")',
        ".modal-close",
        ".close-button",
      ];

      for (const selector of closeSelectors) {
        const button = document.querySelector(selector);
        if (button && this.isElementVisible(button)) {
          button.click();
          await this.sleep(1000);
          return true;
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async handleErrorState() {
    try {
      await this.closeApplication();
    } catch (error) {
      console.error("Error handling error state:", error);
    }
  }

  async saveAppliedJob(jobDetails) {
    try {
      // Use application tracker service
      const success = await this.appTracker.saveAppliedJob({
        jobId: jobDetails.jobId,
        title: jobDetails.title,
        company: jobDetails.company,
        location: jobDetails.location,
        jobUrl: jobDetails.url,
        platform: this.platform,
      });

      if (success) {
        await this.appTracker.updateApplicationCount();
        this.log(`✅ Job application saved to database: ${jobDetails.title}`);
        this.statusOverlay.addSuccess(`Application saved: ${jobDetails.title}`);
        return true;
      } else {
        this.log(`⚠️ Failed to save job application: ${jobDetails.title}`);
        this.statusOverlay.addWarning(
          `Failed to save job application: ${jobDetails.title}`
        );
        return false;
      }
    } catch (error) {
      console.error("Error saving applied job:", error);
      this.log(`❌ Error saving job application: ${error.message}`);
      this.statusOverlay.addError(
        `Error saving job application: ${error.message}`
      );
      return false;
    }
  }

  // ===== NAVIGATION EVENT HANDLERS =====
  onDOMChange() {
    if (this.automationStarted && this.isRunning && !this.isPaused) {
      // Don't automatically reload, let the main loop handle it
    }
  }

  onNavigation(oldUrl, newUrl) {
    this.log(`🔄 Navigation detected: ${oldUrl} → ${newUrl}`);
    this.statusOverlay.addInfo(`Navigation detected: ${newUrl}`);

    if (
      !newUrl.includes("wellfound.com/jobs") &&
      this.automationStarted &&
      this.isRunning
    ) {
      this.log("⚠️ Navigated away from Wellfound Jobs, attempting to return");
      this.statusOverlay.addWarning(
        "Navigated away from Wellfound Jobs, attempting to return"
      );
      setTimeout(() => {
        if (this.isRunning) {
          this.navigateToWellfoundJobs();
        }
      }, 3000);
    }
  }

  async pause() {
    await super.pause();
    this.log("⏸️ Wellfound automation paused");
    this.statusOverlay.addWarning("Wellfound automation paused");
  }

  async resume() {
    await super.resume();
    this.log("▶️ Wellfound automation resumed");
    this.statusOverlay.addSuccess("Wellfound automation resumed");
  }

  async stop() {
    await super.stop();
    this.hasStarted = false;
    this.automationStarted = false;
    this.log("⏹️ Wellfound automation stopped");
    this.statusOverlay.addWarning("Wellfound automation stopped");
  }

  cleanup() {
    super.cleanup();
    this.processedJobs.clear();
    this.answerCache.clear();

    // Cleanup status overlay
    if (this.statusOverlay) {
      this.statusOverlay.destroy();
      this.statusOverlay = null;
    }

    this.log("🧹 Wellfound platform cleanup completed");
  }
}
