// platforms/linkedin/linkedin.js - Full code with LinkedIn-specific validation
import BasePlatform from '../base-platform.js';
import AIService from '../../services/ai-service.js';
import ApplicationTrackerService from '../../services/application-tracker-service.js';
import UserService from '../../services/user-service.js';
import StatusNotificationService from '../../services/status-notification-service.js';
import FileHandlerService from '../../services/file-handler-service.js';

export default class LinkedInPlatform extends BasePlatform {
  constructor(config) {
    super(config);
    this.platform = 'linkedin';
    this.baseUrl = 'https://www.linkedin.com';
    this.hasStarted = false;
    this.automationStarted = false;
    this.processedJobs = new Set();
    this.answerCache = new Map();
    
    // Initialize services with API host
    const apiHost = config.apiHost || config.config?.apiHost || 'https://api.yourdomain.com';
    this.HOST = apiHost;
    
    this.aiService = new AIService({ apiHost });
    this.appTracker = new ApplicationTrackerService({ apiHost, userId: config.userId });
    this.userService = new UserService({ apiHost, userId: config.userId });
    this.statusManager = new StatusNotificationService();
    this.fileHandler = new FileHandlerService({ apiHost });
    
    // Connect status manager to file handler for progress updates
    this.fileHandler.setStatusManager(this.statusManager);
    
    this.log(`🔧 Services initialized with API host: ${apiHost}`);
  }

  // ===== LINKEDIN-SPECIFIC VALIDATION =====
  validateLinkedInPreferences(preferences) {
    const errors = [];
    const warnings = [];

    // Validate positions
    if (!preferences.positions || !Array.isArray(preferences.positions) || preferences.positions.length === 0) {
      errors.push("At least one job position is required");
    } else if (preferences.positions.some(pos => !pos || typeof pos !== 'string')) {
      errors.push("All positions must be non-empty strings");
    }

    // Validate location
    if (preferences.location && Array.isArray(preferences.location)) {
      const supportedCountries = [
        "Nigeria", "Netherlands", "United States", "United Kingdom", 
        "Canada", "Australia", "Germany", "France", "India", 
        "Singapore", "South Africa", "Ireland", "New Zealand"
      ];
      
      const unsupportedLocations = preferences.location.filter(
        loc => loc !== "Remote" && !supportedCountries.includes(loc)
      );
      
      if (unsupportedLocations.length > 0) {
        warnings.push(`Some locations may not have optimal filtering: ${unsupportedLocations.join(', ')}`);
      }
    }

    // Validate job types
    if (preferences.jobType && Array.isArray(preferences.jobType)) {
      const validJobTypes = ["Full-time", "Part-time", "Contract", "Temporary", "Internship", "Volunteer"];
      const invalidJobTypes = preferences.jobType.filter(type => !validJobTypes.includes(type));
      
      if (invalidJobTypes.length > 0) {
        errors.push(`Invalid job types: ${invalidJobTypes.join(', ')}. Valid types: ${validJobTypes.join(', ')}`);
      }
    }

    // Validate experience levels
    if (preferences.experience && Array.isArray(preferences.experience)) {
      const validExperience = ["Internship", "Entry level", "Associate", "Mid-Senior level", "Director", "Executive"];
      const invalidExperience = preferences.experience.filter(exp => !validExperience.includes(exp));
      
      if (invalidExperience.length > 0) {
        errors.push(`Invalid experience levels: ${invalidExperience.join(', ')}. Valid levels: ${validExperience.join(', ')}`);
      }
    }

    // Validate work modes
    if (preferences.workMode && Array.isArray(preferences.workMode)) {
      const validWorkModes = ["Remote", "Hybrid", "On-site"];
      const invalidWorkModes = preferences.workMode.filter(mode => !validWorkModes.includes(mode));
      
      if (invalidWorkModes.length > 0) {
        errors.push(`Invalid work modes: ${invalidWorkModes.join(', ')}. Valid modes: ${validWorkModes.join(', ')}`);
      }
    }

    // Validate date posted
    if (preferences.datePosted) {
      const validDateOptions = ["Any time", "Past month", "Past week", "Past 24 hours", "Few Minutes Ago"];
      if (!validDateOptions.includes(preferences.datePosted)) {
        errors.push(`Invalid date posted option: ${preferences.datePosted}. Valid options: ${validDateOptions.join(', ')}`);
      }
    }

    // Validate salary range
    if (preferences.salary) {
      if (!Array.isArray(preferences.salary) || preferences.salary.length !== 2) {
        errors.push("Salary must be an array with exactly 2 values [min, max]");
      } else {
        const [min, max] = preferences.salary;
        if (typeof min !== 'number' || typeof max !== 'number') {
          errors.push("Salary values must be numbers");
        } else if (min < 0 || max < 0) {
          errors.push("Salary values must be positive");
        } else if (min >= max) {
          errors.push("Minimum salary must be less than maximum salary");
        } else if (min > 500000 || max > 500000) {
          warnings.push("Very high salary ranges may not return many results");
        }
      }
    }

    // Validate company rating
    if (preferences.companyRating && preferences.companyRating !== "") {
      const validRatings = ["3.0", "3.5", "4.0", "4.5"];
      if (!validRatings.includes(preferences.companyRating)) {
        warnings.push(`Company rating ${preferences.companyRating} may not be supported. Supported ratings: ${validRatings.join(', ')}`);
      }
    }

    // Validate boolean fields
    if (preferences.remoteOnly !== undefined && typeof preferences.remoteOnly !== 'boolean') {
      errors.push("remoteOnly must be a boolean value");
    }

    if (preferences.useCustomResume !== undefined && typeof preferences.useCustomResume !== 'boolean') {
      errors.push("useCustomResume must be a boolean value");
    }

    // Check for conflicting preferences
    if (preferences.remoteOnly && preferences.workMode && !preferences.workMode.includes("Remote")) {
      warnings.push("remoteOnly is true but Remote is not in workMode array");
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  // ===== USER AUTHORIZATION & SERVICES =====
  async checkUserAuthorization() {
    try {
      this.statusManager.show("Checking user authorization...", "info");
      
      // Check if user can apply to more jobs
      const canApply = await this.userService.canApplyMore();
      if (!canApply) {
        const remaining = await this.userService.getRemainingApplications();
        const userDetails = await this.userService.getUserDetails();
        
        const message = userDetails.userRole === "credit"
          ? `Insufficient credits (${userDetails.credits} remaining)`
          : `Daily limit reached (${remaining} applications remaining)`;
          
        this.statusManager.show(`Cannot apply: ${message}`, "warning");
        throw new Error(`Cannot apply: ${message}`);
      }
      
      this.log('✅ User authorization check passed');
    } catch (error) {
      this.log('❌ User authorization check failed:', error.message);
      throw error;
    }
  }

  async initialize() {
    await super.initialize();
    this.log('🔗 LinkedIn platform initialized');
  }

  async start(params = {}) {
    if (this.hasStarted) {
      this.log('⚠️ LinkedIn automation already started, ignoring duplicate start request');
      return;
    }

    this.hasStarted = true;
    this.isRunning = true;
    this.log('🚀 Starting LinkedIn automation with user preferences');

    try {
      // Merge config properly - params contains the full config from orchestrator
      this.config = { ...this.config, ...params };
      
      // Validate LinkedIn-specific preferences
      const validation = this.validateLinkedInPreferences(this.config.preferences || {});
      
      if (!validation.isValid) {
        throw new Error(`Invalid LinkedIn preferences: ${validation.errors.join(', ')}`);
      }
      
      if (validation.warnings.length > 0) {
        this.log('⚠️ LinkedIn preference warnings:', validation.warnings);
      }
      
      // Update services with proper userId and config
      if (this.config.userId) {
        this.appTracker = new ApplicationTrackerService({ 
          apiHost: this.HOST, 
          userId: this.config.userId 
        });
        this.userService = new UserService({ 
          apiHost: this.HOST, 
          userId: this.config.userId 
        });
      }
      
      this.log('📋 Configuration loaded with validated preferences:', {
        jobsToApply: this.config.jobsToApply,
        preferences: this.config.preferences,
        userId: this.config.userId,
        validation: validation
      });

      if (!this.config.jobsToApply || this.config.jobsToApply <= 0) {
        throw new Error('Invalid jobsToApply configuration');
      }

      // Check user authorization before starting
      await this.checkUserAuthorization();

      this.updateProgress({ total: this.config.jobsToApply });

      // Wait for basic page readiness first
      await this.waitForPageLoad();
      this.log('📄 Basic page loaded, current URL:', window.location.href);

      // Navigate to LinkedIn Jobs with user preferences
      const currentUrl = window.location.href.toLowerCase();
      if (!currentUrl.includes('linkedin.com/jobs')) {
        this.log('📍 Navigating to LinkedIn Jobs with user preferences');
        await this.navigateToLinkedInJobs();
      } else {
        this.log('✅ Already on LinkedIn Jobs page');
        // If already on jobs page, apply additional filters if needed
        await this.applyAdditionalFilters();
      }

      // Wait for job search results to load
      await this.waitForSearchResultsLoad();

      // Start processing jobs
      this.automationStarted = true;
      await this.processJobs({ jobsToApply: this.config.jobsToApply });

    } catch (error) {
      this.hasStarted = false;
      this.reportError(error, { phase: 'start' });
    }
  }

  async navigateToLinkedInJobs() {
    const searchUrl = await this.generateComprehensiveSearchUrl(this.config.preferences || {});
    this.log(`🔗 Navigating to: ${searchUrl}`);
    
    window.location.href = searchUrl;
    await this.delay(5000);
    await this.waitForPageLoad();
    this.log('✅ Navigation completed with user preferences applied');
  }

  async generateComprehensiveSearchUrl(preferences) {
    const baseUrl = "https://www.linkedin.com/jobs/search/?";

    const joinWithOR = (arr) => (arr ? arr.join(" OR ") : "");

    const params = new URLSearchParams();
    params.append("f_AL", "true"); // Keep the Easy Apply filter

    // Handle positions
    if (preferences.positions?.length) {
      params.append("keywords", joinWithOR(preferences.positions));
    }

    // Handle location with GeoId mapping
    if (preferences.location?.length) {
      const location = preferences.location[0]; // Take first location
      
      // GeoId mapping for countries
      const geoIdMap = {
        Nigeria: "105365761",
        Netherlands: "102890719",
        "United States": "103644278",
        "United Kingdom": "101165590",
        Canada: "101174742",
        Australia: "101452733",
        Germany: "101282230",
        France: "105015875",
        India: "102713980",
        Singapore: "102454443",
        "South Africa": "104035573",
        Ireland: "104738515",
        "New Zealand": "105490917",
      };

      if (location === "Remote" || preferences.remoteOnly) {
        params.append("f_WT", "2");
      } else if (geoIdMap[location]) {
        params.append("geoId", geoIdMap[location]);
      } else {
        params.append("location", location);
      }
    }

    // Handle work mode
    const workModeMap = {
      Remote: "2",
      Hybrid: "3",
      "On-site": "1",
    };

    if (preferences.workMode?.length) {
      const workModeCodes = preferences.workMode
        .map((mode) => workModeMap[mode])
        .filter(Boolean);
      if (workModeCodes.length) {
        params.append("f_WT", workModeCodes.join(","));
      }
    } else if (preferences.remoteOnly) {
      params.append("f_WT", "2"); // Remote only
    }

    // Handle date posted
    const datePostedMap = {
      "Any time": "",
      "Past month": "r2592000",
      "Past week": "r604800",
      "Past 24 hours": "r86400",
      "Few Minutes Ago": "r3600",
    };

    if (preferences.datePosted) {
      const dateCode = datePostedMap[preferences.datePosted];
      if (dateCode) {
        params.append("f_TPR", dateCode);
      }
    }

    // Handle experience level
    const experienceLevelMap = {
      Internship: "1",
      "Entry level": "2",
      Associate: "3",
      "Mid-Senior level": "4",
      Director: "5",
      Executive: "6",
    };

    if (preferences.experience?.length) {
      const experienceCodes = preferences.experience
        .map((level) => experienceLevelMap[level])
        .filter(Boolean);
      if (experienceCodes.length) {
        params.append("f_E", experienceCodes.join(","));
      }
    }

    // Handle job type
    const jobTypeMap = {
      "Full-time": "F",
      "Part-time": "P",
      Contract: "C",
      Temporary: "T",
      Internship: "I",
      Volunteer: "V",
    };
    
    if (preferences.jobType?.length) {
      const jobTypeCodes = preferences.jobType
        .map((type) => jobTypeMap[type])
        .filter(Boolean);
      if (jobTypeCodes.length) {
        params.append("f_JT", jobTypeCodes.join(","));
      }
    }

    // Handle salary range
    if (preferences.salary?.length === 2) {
      const [min] = preferences.salary;
      const salaryBuckets = {
        40000: "1",
        60000: "2",
        80000: "3",
        100000: "4",
        120000: "5",
        140000: "6",
        160000: "7",
        180000: "8",
        200000: "9",
      };

      const bucketValue = Object.entries(salaryBuckets)
        .reverse()
        .find(([threshold]) => min >= parseInt(threshold))?.[1];

      if (bucketValue) {
        params.append("f_SB", bucketValue);
      }
    }

    // Sorting - use "R" for relevance or "DD" for date
    params.append("sortBy", "R");

    const finalUrl = baseUrl + params.toString();
    this.log('🔍 Generated search URL with preferences:', {
      url: finalUrl,
      preferences: preferences
    });

    return finalUrl;
  }

  async applyAdditionalFilters() {
    try {
      const preferences = this.config.preferences || {};
      
      // Apply company rating filter if specified (requires UI interaction)
      if (preferences.companyRating && preferences.companyRating !== "") {
        await this.applyCompanyRatingFilter(preferences.companyRating);
      }

      this.log('✅ Additional filters applied successfully');
    } catch (error) {
      this.log('⚠️ Failed to apply some additional filters:', error.message);
    }
  }

  async applyCompanyRatingFilter(minRating) {
    try {
      // This would require DOM manipulation to set company rating filter
      // Implementation depends on LinkedIn's current UI structure
      this.log(`🏢 Attempting to apply company rating filter: ${minRating}+`);
      
      // Company rating filter is typically in the "More" filters section
      const moreFiltersButton = await this.waitForElement(
        'button[aria-label*="Show more filters"], button[data-control-name="filter_show_more"]',
        5000
      );
      
      if (moreFiltersButton) {
        moreFiltersButton.click();
        await this.delay(1000);

        // Look for company rating options
        // This is a simplified implementation - actual selectors may vary
        const ratingSelector = `button[aria-label*="${minRating}"], input[value="${minRating}"]`;
        const ratingElement = await this.waitForElement(ratingSelector, 3000);
        
        if (ratingElement) {
          ratingElement.click();
          await this.delay(500);

          // Apply the filter
          const applyButton = await this.waitForElement(
            'button[data-control-name="filter_show_results"]',
            3000
          );
          
          if (applyButton) {
            applyButton.click();
            await this.delay(2000);
            this.log('✅ Company rating filter applied');
          }
        }
      }
    } catch (error) {
      this.log('Failed to apply company rating filter:', error.message);
    }
  }

  // Method to validate if a job matches user preferences (client-side filtering)
  doesJobMatchPreferences(jobDetails) {
    const preferences = this.config.preferences || {};
    
    // Check salary range if specified
    if (preferences.salary?.length === 2) {
      const [minSalary, maxSalary] = preferences.salary;
      const jobSalary = this.extractSalaryFromJobDetails(jobDetails);
      
      if (jobSalary && (jobSalary < minSalary || jobSalary > maxSalary)) {
        this.log(`❌ Job salary ${jobSalary} outside range ${minSalary}-${maxSalary}`);
        return false;
      }
    }

    // Check if positions match (basic keyword matching)
    if (preferences.positions?.length) {
      const jobTitle = jobDetails.title?.toLowerCase() || '';
      const hasMatchingPosition = preferences.positions.some(position => 
        jobTitle.includes(position.toLowerCase())
      );
      
      if (!hasMatchingPosition) {
        this.log(`❌ Job title "${jobDetails.title}" doesn't match required positions`);
        return false;
      }
    }

    // Check remote work preference
    if (preferences.remoteOnly) {
      const isRemote = this.isRemoteJob(jobDetails);
      if (!isRemote) {
        this.log(`❌ Job is not remote but remoteOnly is true`);
        return false;
      }
    }

    return true;
  }

  extractSalaryFromJobDetails(jobDetails) {
    // Extract salary information from job details
    // This would need to parse salary from job description or salary field
    const salaryText = jobDetails.salary || jobDetails.description || '';
    const salaryMatch = salaryText.match(/\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
    return salaryMatch ? parseInt(salaryMatch[1].replace(/,/g, '')) : null;
  }

  isRemoteJob(jobDetails) {
    const workplace = jobDetails.workplace?.toLowerCase() || '';
    const location = jobDetails.location?.toLowerCase() || '';
    const description = jobDetails.description?.toLowerCase() || '';
    
    const remoteKeywords = ['remote', 'work from home', 'wfh', 'telecommute'];
    
    return remoteKeywords.some(keyword => 
      workplace.includes(keyword) || 
      location.includes(keyword) || 
      description.includes(keyword)
    );
  }

  // ===== CORE LINKEDIN AUTOMATION METHODS =====
  async processJobs({ jobsToApply }) {
    let processedCount = 0;
    let appliedCount = 0;
    let skippedCount = 0;
    let processedJobs = new Set();
    let currentPage = 1;
    let noNewJobsCount = 0;
    const MAX_NO_NEW_JOBS = 3;

    try {
      this.log(`Starting to process jobs with user preferences. Target: ${jobsToApply} jobs`);
      this.log(`User preferences:`, this.config.preferences);

      // Initial scroll to trigger job loading
      await this.initialScroll();

      while (appliedCount < jobsToApply) {
        const jobCards = await this.getJobCards();
        console.log(`Found ${jobCards.length} job cards on page ${currentPage}`);

        if (jobCards.length === 0) {
          console.log("No job cards found, trying to scroll first before pagination");
          if (await this.scrollAndWaitForNewJobs()) {
            console.log("Scrolling loaded new jobs, continuing on same page");
            continue;
          }
          
          console.log("No new jobs after scrolling, checking pagination");
          const hasNextPage = await this.goToNextPage(currentPage);
          if (hasNextPage) {
            currentPage++;
            noNewJobsCount = 0;
            await this.waitForPageLoad();
            continue;
          } else {
            console.log("No more pages available");
            break;
          }
        }

        let newJobsFound = false;
        let newApplicableJobsFound = false;

        this.log(`Processing ${jobCards.length} job cards on page ${currentPage}`);

        for (const jobCard of jobCards) {
          if (appliedCount >= jobsToApply) {
            this.log(`Reached target of ${jobsToApply} jobs`);
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
              this.log(`Skipping job "${jobDetails.title}" - doesn't match preferences`);
              skippedCount++;
              continue;
            }

            // Find the Easy Apply button - if not found, this job is already applied
            const applyButton = await this.findEasyApplyButton();
            if (!applyButton) {
              console.log("No Easy Apply button found - job already applied");
              this.log(`Already applied to job ${jobId}, skipping.`);
              skippedCount++;
              continue;
            }

            // We found a job we can actually apply to
            newApplicableJobsFound = true;

            // Check if already applied using service
            const alreadyApplied = await this.appTracker.checkIfAlreadyApplied(jobId);
            if (alreadyApplied) {
              this.log(`Already applied to job ${jobId} (from database), skipping.`);
              skippedCount++;
              continue;
            }

            this.updateProgress({
              current: `Processing: ${jobDetails.title} (Page ${currentPage})`
            });

            this.statusManager.show(`Processing: ${jobDetails.title}`, "info");

            // Attempt to apply
            const success = await this.applyToJob(applyButton, jobDetails);

            if (success) {
              appliedCount++;
              this.progress.completed = appliedCount;
              this.updateProgress({ completed: appliedCount });
              
              // Update application count using user service
              await this.userService.updateApplicationCount();
              
              this.log(`Successfully applied to job ${appliedCount}/${jobsToApply} (${skippedCount} jobs skipped)`);

              this.reportApplicationSubmitted(jobDetails, { 
                method: 'Easy Apply',
                userId: this.config.userId || this.userId,
                matchedPreferences: true
              });
            } else {
              this.progress.failed++;
              this.updateProgress({ failed: this.progress.failed });
            }

            await this.sleep(2000);
          } catch (error) {
            this.log(`Error processing job ${jobId} on page ${currentPage}`);
            console.error(`Error processing job ${jobId}:`, error);
            continue;
          }
        }

        // Handle pagination logic
        if (!newApplicableJobsFound) {
          this.log(`No new applicable jobs found on page ${currentPage}, trying to scroll for more jobs...`);
          if (await this.scrollAndWaitForNewJobs()) {
            noNewJobsCount = 0;
            this.log(`Scrolling loaded new jobs on page ${currentPage}, continuing processing...`);
            continue;
          }

          this.log(`No more jobs loaded by scrolling on page ${currentPage}, moving to next page...`);
          const hasNextPage = await this.goToNextPage(currentPage);
          if (hasNextPage) {
            currentPage++;
            noNewJobsCount = 0;
            this.log(`Successfully moved to page ${currentPage}`);
            await this.waitForPageLoad();
          } else {
            noNewJobsCount++;
            if (noNewJobsCount >= MAX_NO_NEW_JOBS) {
              this.log(`No more applicable jobs to apply. Applied to ${appliedCount}/${jobsToApply} (${skippedCount} jobs)`);
              break;
            }
          }
        } else {
          noNewJobsCount = 0;
          this.log(`Found and processed applicable jobs on page ${currentPage}, continuing...`);
        }
      }

      const completionStatus = appliedCount >= jobsToApply ? "target_reached" : "no_more_jobs";
      const message = appliedCount >= jobsToApply
        ? `Successfully applied to target of ${appliedCount}/${jobsToApply} jobs (Processed ${processedCount} total across ${currentPage} pages)`
        : `Applied to ${appliedCount}/${jobsToApply} jobs - no more jobs available (Skipped ${skippedCount} jobs that didn't match preferences)`;

      this.log(message);
      this.reportComplete();

      return {
        status: completionStatus,
        message,
        appliedCount,
        processedCount,
        skippedCount,
        totalPages: currentPage,
        preferencesUsed: this.config.preferences
      };
    } catch (error) {
      console.error("Error in processJobs:", error);
      this.reportError(error, { phase: 'processJobs' });
      throw error;
    }
  }

  async applyToJob(applyButton, jobDetails) {
    try {
      // Start application
      applyButton.click();

      let currentStep = "initial";
      let attempts = 0;
      const maxAttempts = 20;
      
      while (currentStep !== "submitted" && attempts < maxAttempts) {
        await this.fillCurrentStep();
        currentStep = await this.moveToNextStep();
        attempts++;

        if (currentStep === "submitted") {
          await this.handlePostSubmissionModal();
        }
      }

      if (attempts >= maxAttempts) {
        await this.closeApplication();
        await this.sleep(1000);
        return false;
      }

      await this.saveAppliedJob(jobDetails);
      return true;
    } catch (error) {
      await this.handleErrorState();
      await this.sleep(1000);
      return false;
    }
  }

  // ===== LINKEDIN-SPECIFIC FORM HANDLING =====
  async fillCurrentStep() {
    // Handle file upload containers using file handler service
    const fileUploadContainers = document.querySelectorAll(".js-jobs-document-upload__container");
    if (fileUploadContainers.length) {
      this.statusManager.show("Uploading resume/cover letter...", "info");
      
      for (const container of fileUploadContainers) {
        try {
          const userDetails = await this.userService.getUserDetails();
          const jobDescription = this.scrapeJobDescription();
          const success = await this.fileHandler.handleFileUpload(container, userDetails, jobDescription);
          
          if (success) {
            this.log(`✅ File uploaded successfully for container`);
          } else {
            this.log(`⚠️ File upload failed for container`);
          }
        } catch (error) {
          this.log(`❌ File upload error: ${error.message}`);
        }
      }
    }

    // Handle regular form questions
    const questions = document.querySelectorAll(".fb-dash-form-element");
    for (const question of questions) {
      await this.handleQuestion(question);
    }
  }

  async handleQuestion(question) {
    if (question.classList.contains("js-jobs-document-upload__container") || 
        question.hasAttribute("data-processed")) {
      return;
    }

    const questionHandlers = {
      select: this.handleSelectQuestion,
      radio: this.handleRadioQuestion,
      text: this.handleTextQuestion,
      textarea: this.handleTextAreaQuestion,
      checkbox: this.handleCheckboxQuestion,
    };

    for (const [type, handler] of Object.entries(questionHandlers)) {
      const element = question.querySelector(this.getQuestionSelector(type));
      if (element) {
        await handler.call(this, element);
        question.setAttribute("data-processed", "true");
        return;
      }
    }
  }

  getQuestionSelector(type) {
    const selectors = {
      select: "select",
      radio: 'fieldset[data-test-form-builder-radio-button-form-component="true"]',
      text: "input[type='text']",
      textarea: "textarea",
      checkbox: "input[type='checkbox']",
    };
    return selectors[type];
  }

  async handleSelectQuestion(select) {
    const container = select.closest(".fb-dash-form-element");
    const labelElement = container.querySelector(".fb-dash-form-element__label");
    const label = labelElement?.textContent?.trim();

    const options = Array.from(select.options)
      .filter((opt) => opt.value !== "Select an option")
      .map((opt) => opt.text.trim());

    const answer = await this.getAnswer(label, options);
    select.value = answer;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async handleRadioQuestion(radio) {
    const label = this.getQuestionLabel(radio);
    const options = Array.from(radio.querySelectorAll('input[type="radio"]')).map((input) => {
      const labelElement = document.querySelector(`label[for="${input.id}"]`);
      return labelElement ? labelElement.textContent : "Unknown";
    });
    const answer = await this.getAnswer(label, options);

    const answerElement = Array.from(radio.querySelectorAll("label")).find(
      (el) => el.textContent.includes(answer)
    );
    if (answerElement) answerElement.click();
  }

  async handleTextQuestion(textInput) {
    const label = this.getQuestionLabel(textInput);
    const answer = await this.getAnswer(label);

    // Handle date fields
    const isDateField = textInput.getAttribute("placeholder") === "mm/dd/yyyy" ||
                       textInput.getAttribute("name") === "artdeco-date" ||
                       label.toLowerCase().includes("date");

    if (isDateField) {
      const formattedDate = this.formatDateForInput(answer);
      textInput.value = formattedDate;
      textInput.dispatchEvent(new Event("input", { bubbles: true }));
      textInput.dispatchEvent(new Event("blur", { bubbles: true }));
      return;
    }

    // Handle typeahead
    const isTypeahead = textInput.getAttribute("role") === "combobox";
    textInput.value = answer;
    textInput.dispatchEvent(new Event("input", { bubbles: true }));

    if (isTypeahead) {
      await this.sleep(1000);
      textInput.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      await this.sleep(500);
      textInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    }
  }

  async handleTextAreaQuestion(textArea) {
    const label = this.getQuestionLabel(textArea);
    const answer = await this.getAnswer(label);
    textArea.value = answer;
    textArea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async handleCheckboxQuestion(checkbox) {
    const label = this.getQuestionLabel(checkbox);
    const answer = (await this.getAnswer(label, ["Yes", "No"])) === "Yes";
    checkbox.checked = answer;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  }

  getQuestionLabel(element) {
    const container = element.closest(".fb-dash-form-element");
    if (!container) return "Unknown";

    const label = container.querySelector("label, legend, .fb-dash-form-element__label");
    if (!label) return "Unknown";

    return label.textContent.trim().replace(/\s+/g, " ");
  }

  async getAnswer(label, options = []) {
    const normalizedLabel = label?.toLowerCase()?.trim() || '';
    
    // Check cache first
    if (this.answerCache.has(normalizedLabel)) {
      return this.answerCache.get(normalizedLabel);
    }

    try {
      // Use AI service for smart answers
      const context = {
        platform: this.platform,
        userData: await this.userService.getUserDetails(),
        jobDescription: this.scrapeJobDescription()
      };
      
      const answer = await this.aiService.getAnswer(label, options, context);
      
      // Cache the answer
      this.answerCache.set(normalizedLabel, answer);
      return answer;
    } catch (error) {
      console.error("AI Answer Error:", error);
      
      // Fallback to simple default answers
      const defaultAnswers = {
        'work authorization': 'Yes',
        'authorized to work': 'Yes',
        'require sponsorship': 'No',
        'require visa': 'No',
        'experience': '2 years',
        'years of experience': '2 years',
        'phone': '555-0123',
        'salary': '80000'
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

  formatDateForInput(dateStr) {
    try {
      const date = new Date(dateStr);
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      const dd = String(date.getDate()).padStart(2, "0");
      const yyyy = date.getFullYear();
      return `${mm}/${dd}/${yyyy}`;
    } catch (error) {
      return dateStr;
    }
  }

  scrapeJobDescription() {
    const descriptionElement = document.querySelector(".jobs-description-content__text");
    if (!descriptionElement) return "No job description found";

    const cleanDescription = Array.from(descriptionElement.children)
      .map((element) => {
        if (element.tagName === "UL" || element.tagName === "OL") {
          return Array.from(element.children)
            .map((li) => `• ${li.textContent.trim()}`)
            .join("\n");
        }
        return element.textContent.trim();
      })
      .filter((text) => text)
      .join("\n\n");

    return cleanDescription;
  }

  async moveToNextStep() {
    try {
      const buttonSelectors = {
        next: 'button[aria-label="Continue to next step"]',
        preview: 'button[aria-label="Review your application"]',
        submit: 'button[aria-label="Submit application"]',
        dismiss: 'button[aria-label="Dismiss"]',
        done: 'button[aria-label="Done"]',
        close: 'button[aria-label="Close"]',
        continueApplying: 'button[aria-label*="Easy Apply"][aria-label*="Continue applying"]',
        continueTips: 'button[aria-label="I understand the tips and want to continue the apply process"]',
        saveJob: 'button[data-control-name="save_application_btn"]',
      };

      // Wait for any button to appear
      await this.waitForAnyElement(Object.values(buttonSelectors));

      // Check for each button in priority order
      if (await this.findAndClickButton(buttonSelectors.continueTips)) {
        await this.sleep(2000);
        return "continue";
      }

      if (await this.findAndClickButton(buttonSelectors.continueApplying)) {
        await this.sleep(2000);
        return "continue";
      }

      if (await this.findAndClickButton(buttonSelectors.saveJob)) {
        await this.sleep(2000);
        return "saved";
      }

      if (await this.findAndClickButton(buttonSelectors.submit)) {
        await this.sleep(2000);
        return "submitted";
      }

      if (await this.findAndClickButton(buttonSelectors.preview)) {
        await this.sleep(2000);
        return "preview";
      }

      if (await this.findAndClickButton(buttonSelectors.next)) {
        await this.sleep(2000);
        return "next";
      }

      if ((await this.findAndClickButton(buttonSelectors.dismiss)) ||
          (await this.findAndClickButton(buttonSelectors.done)) ||
          (await this.findAndClickButton(buttonSelectors.close))) {
        await this.sleep(2000);
        return "modal-closed";
      }
      return "error";
    } catch (error) {
      return "error";
    }
  }

  // ===== LINKEDIN-SPECIFIC NAVIGATION =====
  async goToNextPage(currentPage) {
    try {
      console.log(`Attempting to go to next page after page ${currentPage}`);

      // First try to find the next button
      const nextButton = document.querySelector("button.jobs-search-pagination__button--next");
      if (nextButton) {
        console.log("Found next button, clicking it");
        nextButton.click();
        await this.waitForPageLoad();
        return true;
      }

      // Try pagination container
      const paginationContainer = document.querySelector(".jobs-search-pagination__pages");
      if (!paginationContainer) {
        console.log("No pagination found");
        return false;
      }

      // Get current active page button
      const activeButton = paginationContainer.querySelector(".jobs-search-pagination__indicator-button--active");
      if (!activeButton) {
        console.log("No active page button found");
        return false;
      }

      const currentPageNum = parseInt(activeButton.querySelector("span").textContent);
      console.log(`Current page number: ${currentPageNum}`);

      // Find the next page button
      const pageIndicators = paginationContainer.querySelectorAll(".jobs-search-pagination__indicator");
      let nextPageButton = null;
      
      pageIndicators.forEach((indicator) => {
        const button = indicator.querySelector("button");
        const span = button.querySelector("span");
        const pageNum = span.textContent;

        if (pageNum !== "…" && parseInt(pageNum) === currentPageNum + 1) {
          nextPageButton = button;
        }
      });

      if (nextPageButton) {
        console.log(`Found next page button for page ${currentPageNum + 1}`);
        nextPageButton.click();
        await this.waitForPageLoad();
        return true;
      }

      console.log("No next page available");
      return false;
    } catch (error) {
      console.error("Error navigating to next page:", error);
      return false;
    }
  }

  async initialScroll() {
    const jobsList = document.querySelector(".job-card-list ");
    if (!jobsList) return;

    const totalHeight = jobsList.scrollHeight;
    const increment = Math.floor(totalHeight / 4);

    for (let i = 0; i <= totalHeight; i += increment) {
      jobsList.scrollTo(0, i);
      await this.sleep(500);
    }

    // Scroll back to top
    jobsList.scrollTo(0, 0);
    await this.sleep(1000);
  }

  async scrollAndWaitForNewJobs() {
    const jobsList = document.querySelector(".job-card-list ");
    if (!jobsList) return false;

    const previousHeight = jobsList.scrollHeight;
    const previousJobCount = document.querySelectorAll(".job-card-list  [data-occludable-job-id]").length;

    // Scroll in smaller increments to trigger job loading
    const currentScroll = jobsList.scrollTop;
    const targetScroll = currentScroll + window.innerHeight * 0.75;

    jobsList.scrollTo({ top: targetScroll, behavior: "smooth" });

    // Wait for potential loading
    await this.sleep(2000);

    // Check for new content
    const newHeight = jobsList.scrollHeight;
    const newJobCount = document.querySelectorAll(".job-card-list  [data-occludable-job-id]").length;

    console.log(`Scroll check - Previous jobs: ${previousJobCount}, New jobs: ${newJobCount}`);

    return newHeight > previousHeight || newJobCount > previousJobCount;
  }

  // ===== LINKEDIN-SPECIFIC ELEMENT FINDERS =====
  async waitForPageLoad() {
    try {
      // Wait for job list to be present
      await this.waitForElement(".job-card-list ");
      await this.sleep(2000);

      // Wait for any loading spinners to disappear
      const spinner = document.querySelector(".artdeco-loader");
      if (spinner) {
        await new Promise((resolve) => {
          const observer = new MutationObserver(() => {
            if (!document.contains(spinner)) {
              observer.disconnect();
              resolve();
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
        });
      }
    } catch (error) {
      console.error("Error waiting for page load:", error);
    }
  }

  async waitForSearchResultsLoad() {
    return new Promise((resolve) => {
      const checkSearchResults = () => {
        if (document.querySelector(".job-card-list ")) {
          console.log("Search results loaded");
          resolve();
        } else {
          setTimeout(checkSearchResults, 500);
        }
      };
      checkSearchResults();
    });
  }

  async getJobCards() {
    const jobCards = document.querySelectorAll(".scaffold-layout__list-item[data-occludable-job-id]");
    return jobCards;
  }

  getJobIdFromCard(jobCard) {
    // Try multiple ways to get job ID
    const jobLink = jobCard.querySelector("a[href*='jobs/view']");
    if (jobLink) {
      const href = jobLink.href;
      const match = href.match(/view\/(\d+)/);
      return match ? match[1] : null;
    }
    return jobCard.dataset.jobId || null;
  }

  async findEasyApplyButton() {
    try {
      const button = await this.waitForElement(".jobs-apply-button", 5000);
      return button;
    } catch (error) {
      console.log("Easy Apply button not found");
      return null;
    }
  }

  getJobProperties() {
    const company = document.querySelector(".job-details-jobs-unified-top-card__company-name")?.textContent || "N/A";
    const title = document.querySelector(".job-details-jobs-unified-top-card__job-title")?.textContent || "N/A";
    const urlParams = new URLSearchParams(window.location.search);
    const jobId = urlParams.get("currentJobId");
    
    const detailsContainer = document.querySelector(".job-details-jobs-unified-top-card__primary-description-container .t-black--light.mt2");
    const detailsText = detailsContainer ? detailsContainer.textContent : "";
    const location = detailsText.match(/^(.*?)\s·/)?.[1] || "Not specified";
    const postedDate = detailsText.match(/·\s(.*?)\s·/)?.[1] || "Not specified";
    const applications = detailsText.match(/·\s([^·]+)$/)?.[1] || "Not specified";
    
    const workplaceElem = document.querySelector(".job-details-preferences-and-skills__pill");
    const workplace = workplaceElem ? workplaceElem.textContent.trim() : "Not specified";

    return {
      title,
      jobId,
      company,
      location,
      postedDate,
      applications,
      workplace,
    };
  }

  async clickJobCard(jobCard) {
    try {
      const clickableElement = jobCard.querySelector("a[href*='jobs/view'], .job-card-list__title, .job-card-container__link");

      if (!clickableElement) {
        throw new Error("No clickable element found in job card");
      }

      console.log("Found clickable element:", clickableElement.tagName);

      const clickEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      });

      clickEvent.preventDefault();
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
      const element = await this.waitForElement(".job-details-jobs-unified-top-card__job-title", 10000);
      console.log("Job details title element found");
      await this.sleep(1000);
      return element;
    } catch (error) {
      console.error("Error waiting for job details:", error);
      throw new Error("Job details failed to load");
    }
  }

  // ===== UTILITY METHODS =====
  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }

    return element.offsetParent !== null;
  }

  isElementInViewport(element) {
    const rect = element.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
  }

  async findAndClickButton(selector) {
    const button = document.querySelector(selector);
    if (button && this.isElementVisible(button)) {
      try {
        button.click();
        return true;
      } catch (error) {
        return false;
      }
    }
    return false;
  }

  // ===== APPLICATION CLEANUP METHODS =====
  async handlePostSubmissionModal() {
    try {
      await this.sleep(2000);

      const modalSelectors = [
        'button[aria-label="Dismiss"]',
        'button[aria-label="Done"]',
        'button[aria-label="Close"]',
        ".artdeco-modal__dismiss",
        ".jobs-applied-modal__dismiss-btn",
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
      const closeButton = document.querySelector("button[data-test-modal-close-btn]");
      if (closeButton && this.isElementVisible(closeButton)) {
        closeButton.click();
        await this.sleep(1000);

        const discardButton = document.querySelector('button[data-control-name="discard_application_confirm_btn"]');
        if (discardButton && this.isElementVisible(discardButton)) {
          console.log("Found save dialog, clicking discard");
          discardButton.click();
          await this.sleep(1000);
        }
        return true;
      }

      const fallbackSelectors = [
        ".artdeco-modal__dismiss",
        'button[aria-label="Dismiss"]',
        'button[aria-label="Close"]',
      ];

      for (const selector of fallbackSelectors) {
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
      const closeButtons = [
        'button[aria-label="Dismiss"]',
        'button[aria-label="Close"]',
        ".artdeco-modal__dismiss",
        ".jobs-applied-modal__dismiss-btn",
      ];

      for (const selector of closeButtons) {
        const button = document.querySelector(selector);
        if (button && this.isElementVisible(button)) {
          button.click();
          await this.sleep(1000);
        }
      }
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
        jobUrl: window.location.href,
        salary: jobDetails.salary || "Not specified",
        workplace: jobDetails.workplace,
        postedDate: jobDetails.postedDate,
        applicants: jobDetails.applications,
        platform: this.platform
      });

      if (success) {
        // Update application count
        await this.appTracker.updateApplicationCount();
        this.log(`✅ Job application saved to database: ${jobDetails.title}`);
        this.statusManager.show(`Application saved: ${jobDetails.title}`, "success");
        return true;
      } else {
        this.log(`⚠️ Failed to save job application: ${jobDetails.title}`);
        return false;
      }
    } catch (error) {
      console.error("Error saving applied job:", error);
      this.log(`❌ Error saving job application: ${error.message}`);
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
    
    if (!newUrl.includes('linkedin.com/jobs') && this.automationStarted && this.isRunning) {
      this.log('⚠️ Navigated away from LinkedIn Jobs, attempting to return');
      setTimeout(() => {
        if (this.isRunning) {
          this.navigateToLinkedInJobs();
        }
      }, 3000);
    }
  }

  async pause() {
    await super.pause();
    this.log('⏸️ LinkedIn automation paused');
  }

  async resume() {
    await super.resume();
    this.log('▶️ LinkedIn automation resumed');
  }

  async stop() {
    await super.stop();
    this.hasStarted = false;
    this.automationStarted = false;
    this.log('⏹️ LinkedIn automation stopped');
  }

  cleanup() {
    super.cleanup();
    this.processedJobs.clear();
    this.answerCache.clear();
  }
}

// Add the missing isVisible method to Element prototype
if (typeof Element !== 'undefined' && !Element.prototype.isVisible) {
  Element.prototype.isVisible = function () {
    return (
      window.getComputedStyle(this).display !== "none" &&
      window.getComputedStyle(this).visibility !== "hidden" &&
      this.offsetParent !== null
    );
  };
}