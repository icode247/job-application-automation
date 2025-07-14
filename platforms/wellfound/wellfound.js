// platforms/wellfound/wellfound.js - FIXED VERSION
import BasePlatform from "../base-platform.js";
import AIService from "../../services/ai-service.js";
import ApplicationTrackerService from "../../services/application-tracker-service.js";
import UserService from "../../services/user-service.js";
import { StatusOverlay } from "../../services/index.js";

export default class WellfoundPlatform extends BasePlatform {
  constructor(config) {
    super(config);
    this.platform = "wellfound";
    this.baseUrl = "https://wellfound.com";
    this.hasStarted = false;
    this.automationStarted = false;
    this.processedJobs = new Set();
    this.currentJobDetails = null;
    this.currentJobIndex = 0;

    // Initialize services with proper API host from config
    const apiHost = config.apiHost || 
                   config.config?.apiHost || 
                   config.sessionContext?.apiHost ||
                   "http://localhost:3000";
    this.HOST = apiHost;

    this.aiService = new AIService({ apiHost });
    this.appTracker = new ApplicationTrackerService({
      apiHost,
      userId: config.userId,
    });
    this.userService = new UserService({ apiHost, userId: config.userId });

    this.statusOverlay = new StatusOverlay({
      id: "wellfound-chatbot-overlay",
      platform: "WELLFOUND",
      icon: "🚀",
      position: { top: "10px", right: "10px" },
    });

    this.log(`🔧 Wellfound services initialized with API host: ${apiHost}`);
  }

  async initialize() {
    await super.initialize();
    this.log("🚀 Wellfound platform initialized");
    this.statusOverlay.create();
  }

  async start(params = {}) {
    if (this.hasStarted) {
      this.log("⚠️ Wellfound automation already started, ignoring duplicate start request");
      this.statusOverlay.addWarning("Hey! I'm already working on finding you jobs. Let me finish this round first! 😊");
      return;
    }

    this.hasStarted = true;
    this.isRunning = true;
    this.log("🚀 Starting Wellfound automation with user preferences");
    this.statusOverlay.addInfo("Alright, let's get you some amazing job opportunities on Wellfound! Let me start searching based on your preferences...");

    try {
      // Setup configuration
      this.config = { 
        ...this.config, 
        ...params,
        jobsToApply: params.jobsToApply || this.config.jobsToApply || 10,
        userId: params.userId || this.config.userId || this.userId,
        preferences: params.preferences || this.config.preferences || {},
        apiHost: params.apiHost || this.config.apiHost || this.HOST
      };

      // Check user authorization
      await this.checkUserAuthorization();
      this.updateProgress({ total: this.config.jobsToApply });

      // STEP 1: Navigate to jobs page if needed
      await this.ensureOnJobsPage();

      // STEP 2: Open filter panel
      await this.openFilterPanel();

      // STEP 3: Apply user filters
      await this.applyUserFilters();

      // STEP 4: Show results
      await this.showJobResults();

      // STEP 5: Process jobs sequentially
      this.automationStarted = true;
      this.statusOverlay.updateStatus("applying", "Finding perfect matches for you");
      await this.processJobsSequentially();

    } catch (error) {
      this.hasStarted = false;
      this.reportError(error, { phase: "start" });
    }
  }

  async ensureOnJobsPage() {
    const currentUrl = window.location.href.toLowerCase();
    if (!currentUrl.includes("wellfound.com/jobs")) {
      this.log("📍 Navigating to Wellfound Jobs");
      this.statusOverlay.addInfo("Let me take you to the Wellfound jobs page! ✨");
      window.location.href = "https://wellfound.com/jobs";
      await this.delay(3000);
      await this.waitForPageLoad();
    } else {
      this.log("✅ Already on Wellfound Jobs page");
      this.statusOverlay.addSuccess("Great! We're already on Wellfound Jobs.");
    }
  }

  async openFilterPanel() {
    try {
      this.statusOverlay.addInfo("Opening the filter panel...");
      
      // Check if already open
      if (await this.isFilterPanelOpen()) {
        this.log("✅ Filter panel is already open!");
        this.statusOverlay.addSuccess("Filter panel is ready!");
        return true;
      }

      // Find and click the filters button
      const filtersButton = await this.findFiltersButton();
      if (!filtersButton) {
        throw new Error("Could not find filters button");
      }

      // Click with multiple strategies
      await this.clickElementReliably(filtersButton);
      await this.delay(2000);

      // Verify panel opened
      if (await this.isFilterPanelOpen()) {
        this.log("✅ Filter panel opened successfully!");
        this.statusOverlay.addSuccess("Filter panel opened!");
        return true;
      } else {
        throw new Error("Filter panel did not open after clicking");
      }
    } catch (error) {
      this.log("⚠️ Failed to open filter panel:", error.message);
      this.statusOverlay.addWarning("Couldn't open filter panel, but continuing...");
      return false;
    }
  }

  async findFiltersButton() {
    const strategies = [
      () => document.querySelector('button[data-test="SearchBar-FiltersButton"]'),
      () => document.querySelector('.styles_filtersIcon__WhlNp')?.closest('button'),
      () => Array.from(document.querySelectorAll('button')).find(btn => 
        btn.textContent?.toLowerCase().includes('filters')),
      () => Array.from(document.querySelectorAll('[role="button"]')).find(btn => 
        btn.textContent?.toLowerCase().includes('filters'))
    ];

    for (const strategy of strategies) {
      const button = strategy();
      if (button && button.offsetParent !== null) {
        this.log("🎯 Found filters button via strategy");
        return button;
      }
    }
    return null;
  }

  async applyUserFilters() {
    try {
      this.statusOverlay.addInfo("Applying your job preferences...");
      const preferences = this.config.preferences || {};
      
      await this.applyPositionFilters(preferences.positions);
      await this.applyLocationFilters(preferences.location, preferences.remoteOnly);
      await this.applySalaryFilters(preferences.salary);
      await this.applyJobTypeFilters(preferences.jobType);
      await this.applyExperienceFilters(preferences.experience);

      this.log("✅ All filters applied successfully");
      this.statusOverlay.addSuccess("All your filters are applied!");
    } catch (error) {
      this.log("⚠️ Failed to apply some filters:", error.message);
      this.statusOverlay.addWarning("Had trouble with some filters, but main search is working!");
    }
  }

  async showJobResults() {
    try {
      this.statusOverlay.addInfo("Loading your job matches...");
      
      // Look for View Results button
      const viewResultsButton = await this.findViewResultsButton();
      if (viewResultsButton) {
        await this.clickElementReliably(viewResultsButton);
        await this.delay(3000);
      }

      // Wait for job cards to load
      await this.waitForJobCards();
      
      const jobCards = document.querySelectorAll('.styles_component__uTjje');
      this.log(`✅ Found ${jobCards.length} job cards`);
      this.statusOverlay.addSuccess(`Perfect! Found ${jobCards.length} job opportunities!`);
      
      return jobCards.length > 0;
    } catch (error) {
      this.log("❌ Failed to show job results:", error.message);
      this.statusOverlay.addError("Had trouble loading job results");
      throw error;
    }
  }

  async findViewResultsButton() {
    const strategies = [
      () => document.querySelector('button[data-test="SearchBar-ViewResultsButton"]'),
      () => Array.from(document.querySelectorAll('button')).find(btn => 
        btn.textContent?.toLowerCase().includes('view results')),
      () => Array.from(document.querySelectorAll('button')).find(btn => 
        /\d+\s*results?/i.test(btn.textContent))
    ];

    for (const strategy of strategies) {
      const button = strategy();
      if (button && button.offsetParent !== null) {
        return button;
      }
    }
    return null;
  }

  // MAIN SEQUENTIAL PROCESSING METHOD
  async processJobsSequentially() {
    let appliedCount = 0;
    let processedCount = 0;
    const targetJobs = this.config.jobsToApply;

    try {
      this.log(`🎯 Starting sequential job processing. Target: ${targetJobs} jobs`);
      this.statusOverlay.addInfo(`Processing ${targetJobs} jobs sequentially...`);

      while (appliedCount < targetJobs && this.isRunning) {
        // Get current job cards
        const jobCards = await this.getCurrentJobCards();
        
        if (jobCards.length === 0) {
          this.statusOverlay.addWarning("No more job cards found!");
          break;
        }

        // Process each job card in sequence
        for (let i = this.currentJobIndex; i < jobCards.length && appliedCount < targetJobs; i++) {
          if (!this.isRunning) break;

          const jobCard = jobCards[i];
          this.currentJobIndex = i;

          try {
            this.log(`📋 Processing job ${i + 1}/${jobCards.length}`);
            this.statusOverlay.addInfo(`Checking job ${processedCount + 1}...`);

            // STEP 5A: Open job details
            const jobOpened = await this.openJobDetails(jobCard);
            if (!jobOpened) {
              this.log("⚠️ Could not open job details, skipping");
              continue;
            }

            // STEP 5B: Extract job description and details
            const jobDetails = await this.extractCompleteJobDetails();
            if (!jobDetails) {
              this.log("⚠️ Could not extract job details, skipping");
              await this.returnToJobsList();
              continue;
            }

            processedCount++;

            // STEP 5C: Check if job matches preferences
            if (!this.doesJobMatchPreferences(jobDetails)) {
              this.log(`❌ Job "${jobDetails.title}" doesn't match preferences`);
              this.statusOverlay.addInfo(`Skipping "${jobDetails.title}" - doesn't match preferences`);
              await this.returnToJobsList();
              continue;
            }

            // STEP 5D: Check if already applied
            const alreadyApplied = await this.appTracker.checkIfAlreadyApplied(jobDetails.jobId);
            if (alreadyApplied) {
              this.log(`⚠️ Already applied to "${jobDetails.title}"`);
              await this.returnToJobsList();
              continue;
            }

            // STEP 5E: Extract form fields and apply
            const applicationSuccess = await this.applyToJobWithFormHandling(jobDetails);
            
            if (applicationSuccess) {
              appliedCount++;
              this.progress.completed = appliedCount;
              this.updateProgress({ completed: appliedCount });

              await this.userService.updateApplicationCount();
              await this.saveAppliedJob(jobDetails);

              this.log(`✅ Successfully applied to job ${appliedCount}/${targetJobs}`);
              this.statusOverlay.addSuccess(
                `Applied to "${jobDetails.title}"! (${appliedCount}/${targetJobs})`
              );

              this.reportApplicationSubmitted(jobDetails, {
                method: "Wellfound Application",
                userId: this.config.userId,
                matchedPreferences: true,
              });
            } else {
              this.progress.failed++;
              this.updateProgress({ failed: this.progress.failed });
              this.statusOverlay.addError(`Failed to apply to "${jobDetails.title}"`);
            }

            // STEP 5F: Return to jobs list for next iteration
            await this.returnToJobsList();
            await this.delay(2000); // Delay between applications

          } catch (error) {
            this.log(`❌ Error processing job ${i + 1}:`, error.message);
            await this.returnToJobsList();
            continue;
          }
        }

        // Try to load more jobs if we need more and haven't reached target
        if (appliedCount < targetJobs) {
          const hasMore = await this.loadMoreJobs();
          if (!hasMore) {
            this.statusOverlay.addInfo("No more jobs available for your criteria");
            break;
          }
          this.currentJobIndex = 0; // Reset index for new batch
        }
      }

      // Complete the process
      const message = appliedCount >= targetJobs
        ? `🎉 Successfully applied to all ${appliedCount} target jobs!`
        : `Applied to ${appliedCount} out of ${targetJobs} jobs. No more suitable matches found.`;

      this.log(message);
      this.statusOverlay.addSuccess(message);
      this.reportComplete();

      return {
        status: appliedCount >= targetJobs ? "target_reached" : "no_more_jobs",
        appliedCount,
        processedCount,
      };

    } catch (error) {
      this.log("❌ Error in sequential job processing:", error.message);
      this.statusOverlay.addError("Error during job processing");
      this.reportError(error, { phase: "processJobsSequentially" });
      throw error;
    }
  }

  async getCurrentJobCards() {
    await this.waitForElement('.styles_component__uTjje', 5000);
    return Array.from(document.querySelectorAll('.styles_component__uTjje'));
  }

  async openJobDetails(jobCard) {
    try {
      // Find the Learn More button or job link
      const learnMoreButton = jobCard.querySelector('button[data-test="LearnMoreButton"]') ||
                             jobCard.querySelector('a[href*="/jobs/"]') ||
                             jobCard.querySelector('.learn-more');

      if (!learnMoreButton) {
        this.log("❌ No Learn More button found in job card");
        return false;
      }

      // Click to open job details
      await this.clickElementReliably(learnMoreButton);
      await this.delay(2000);

      // Wait for job details page to load
      await this.waitForElement('.styles_description__xjvTf, .job-description', 8000);
      
      this.log("✅ Job details page opened");
      return true;
    } catch (error) {
      this.log("❌ Failed to open job details:", error.message);
      return false;
    }
  }

  async extractCompleteJobDetails() {
    try {
      await this.delay(1000); // Ensure page is fully loaded

      // Extract comprehensive job details
      const jobDetails = {
        jobId: this.extractJobIdFromUrl(window.location.href),
        title: this.extractText([
          'h1.inline.text-xl.font-semibold.text-black',
          'h1',
          '.job-title'
        ]),
        company: this.extractText([
          'a[rel="noopener noreferrer"] span.text-sm.font-semibold.text-black',
          '.company-name',
          '.text-sm.font-semibold.text-black'
        ]),
        location: this.extractLocationInfo(),
        jobType: this.extractJobTypeInfo(),
        description: this.extractJobDescription(),
        requirements: this.extractJobRequirements(),
        salary: this.extractSalaryInfo(),
        benefits: this.extractBenefits(),
        applicationFormFields: await this.extractApplicationFormFields(),
        url: window.location.href,
        platform: this.platform,
        extractedAt: Date.now(),
      };

      // Generate job ID if not found
      if (!jobDetails.jobId) {
        jobDetails.jobId = `${jobDetails.company}-${jobDetails.title}`
          .replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      }

      this.currentJobDetails = jobDetails;
      this.log("📋 Complete job details extracted:", {
        title: jobDetails.title,
        company: jobDetails.company,
        hasFormFields: !!jobDetails.applicationFormFields
      });

      return jobDetails;
    } catch (error) {
      this.log("❌ Failed to extract complete job details:", error.message);
      return null;
    }
  }

  extractLocationInfo() {
    try {
      const locationElements = document.querySelectorAll('ul.block.text-md.text-black li');
      for (const element of locationElements) {
        const text = element.textContent.trim();
        if (text.includes('Remote') || text.includes('Location')) {
          return text.split('|')[0].trim();
        }
      }
      return "Not specified";
    } catch (error) {
      return "Not specified";
    }
  }

  extractJobTypeInfo() {
    try {
      const typeElements = document.querySelectorAll('ul.block.text-md.text-black li');
      for (const element of typeElements) {
        const text = element.textContent.trim();
        if (text.includes('Full Time') || text.includes('Part Time') || text.includes('Contract')) {
          return text.split('|').pop().trim();
        }
      }
      return "Not specified";
    } catch (error) {
      return "Not specified";
    }
  }

  extractJobDescription() {
    const descriptionElement = document.querySelector('.styles_description__xjvTf') ||
                              document.querySelector('#job-description') ||
                              document.querySelector('.description');
    return descriptionElement ? descriptionElement.textContent.trim() : "No description available";
  }

  extractJobRequirements() {
    try {
      // Look for requirements section
      const requirementsSection = Array.from(document.querySelectorAll('h3, h4, strong')).find(el =>
        el.textContent.toLowerCase().includes('requirement') ||
        el.textContent.toLowerCase().includes('qualification')
      );

      if (requirementsSection) {
        const nextSibling = requirementsSection.nextElementSibling;
        if (nextSibling) {
          return nextSibling.textContent.trim();
        }
      }

      return "";
    } catch (error) {
      return "";
    }
  }

  extractSalaryInfo() {
    try {
      const salaryElements = document.querySelectorAll('span, div, p');
      for (const element of salaryElements) {
        const text = element.textContent;
        if (text && /\$[\d,]+/.test(text)) {
          return text.trim();
        }
      }
      return "Not specified";
    } catch (error) {
      return "Not specified";
    }
  }

  extractBenefits() {
    try {
      // Look for benefits section
      const benefitsSection = Array.from(document.querySelectorAll('h3, h4, strong')).find(el =>
        el.textContent.toLowerCase().includes('benefit') ||
        el.textContent.toLowerCase().includes('perk')
      );

      if (benefitsSection) {
        const nextSibling = benefitsSection.nextElementSibling;
        if (nextSibling) {
          return nextSibling.textContent.trim();
        }
      }

      return "";
    } catch (error) {
      return "";
    }
  }

  // CRITICAL: Extract application form fields
  async extractApplicationFormFields() {
    try {
      // Look for apply buttons first to see if there's a form
      const applyButtons = document.querySelectorAll(
        'button:contains("Apply"), a:contains("Apply"), [class*="apply"]'
      );

      if (applyButtons.length === 0) {
        return null;
      }

      // Click apply button to reveal form (if not external)
      const applyButton = Array.from(applyButtons).find(btn => 
        !btn.href && !btn.textContent.includes('website')
      );

      if (!applyButton) {
        return { type: 'external', fields: [] };
      }

      // Click apply to reveal form
      await this.clickElementReliably(applyButton);
      await this.delay(2000);

      // Extract form fields
      const formFields = [];
      const form = document.querySelector('form') || document.querySelector('[role="dialog"]');

      if (form) {
        const inputs = form.querySelectorAll('input, textarea, select');
        
        for (const input of inputs) {
          if (input.type === 'hidden' || input.type === 'submit') continue;

          const fieldInfo = {
            name: input.name || input.id || input.placeholder,
            type: input.type || input.tagName.toLowerCase(),
            placeholder: input.placeholder,
            required: input.required,
            selector: this.generateSelector(input)
          };

          formFields.push(fieldInfo);
        }
      }

      return {
        type: 'form',
        fields: formFields,
        formSelector: form ? this.generateSelector(form) : null
      };

    } catch (error) {
      this.log("❌ Failed to extract form fields:", error.message);
      return null;
    }
  }

  // MAIN APPLICATION METHOD WITH FORM HANDLING
  async applyToJobWithFormHandling(jobDetails) {
    try {
      this.statusOverlay.addInfo(`Applying to "${jobDetails.title}"...`);

      // If we already extracted form fields, use them
      if (jobDetails.applicationFormFields) {
        if (jobDetails.applicationFormFields.type === 'external') {
          this.statusOverlay.addInfo(`"${jobDetails.title}" requires external application`);
          await this.saveExternalJob(jobDetails);
          return false; // Don't count as automated application
        }

        // Fill and submit the form
        const success = await this.fillAndSubmitApplicationForm(
          jobDetails.applicationFormFields, 
          jobDetails
        );

        if (success) {
          // Verify application success
          const verified = await this.verifyApplicationSuccess();
          if (verified) {
            this.statusOverlay.addSuccess(`Successfully applied to "${jobDetails.title}"!`);
            return true;
          }
        }
      }

      // Fallback: try to find and click apply button
      const applyButton = await this.findApplyButton();
      if (applyButton) {
        const isExternal = applyButton.href || 
                          applyButton.textContent.includes('website') ||
                          applyButton.textContent.includes('external');

        if (isExternal) {
          await this.saveExternalJob(jobDetails);
          return false;
        }

        await this.clickElementReliably(applyButton);
        await this.delay(2000);

        // Try to handle any form that appears
        const formHandled = await this.handleDynamicApplicationForm(jobDetails);
        if (formHandled) {
          const verified = await this.verifyApplicationSuccess();
          return verified;
        }
      }

      this.statusOverlay.addWarning(`No applicable form found for "${jobDetails.title}"`);
      return false;

    } catch (error) {
      this.log("❌ Failed to apply to job:", error.message);
      this.statusOverlay.addError(`Error applying to "${jobDetails.title}"`);
      return false;
    }
  }

  async fillAndSubmitApplicationForm(formInfo, jobDetails) {
    try {
      if (!formInfo || !formInfo.fields || formInfo.fields.length === 0) {
        return false;
      }

      // Get user details for form filling
      const userDetails = await this.userService.getUserDetails();
      if (!userDetails) {
        this.log("❌ No user details available for form filling");
        return false;
      }

      const form = document.querySelector(formInfo.formSelector);
      if (!form) {
        this.log("❌ Application form not found");
        return false;
      }

      // Fill each field
      for (const fieldInfo of formInfo.fields) {
        await this.fillFormField(fieldInfo, userDetails, jobDetails);
        await this.delay(300); // Small delay between fields
      }

      // Submit the form
      const submitButton = form.querySelector('button[type="submit"], .submit-btn, button:contains("Submit")');
      if (submitButton) {
        await this.clickElementReliably(submitButton);
        await this.delay(3000);
        return true;
      } else {
        this.log("❌ No submit button found");
        return false;
      }

    } catch (error) {
      this.log("❌ Error filling and submitting form:", error.message);
      return false;
    }
  }

  async fillFormField(fieldInfo, userDetails, jobDetails) {
    try {
      const field = document.querySelector(fieldInfo.selector);
      if (!field) return;

      let value = "";

      // Map field to user data
      const fieldName = (fieldInfo.name || fieldInfo.placeholder || "").toLowerCase();
      
      if (fieldName.includes('name') && !fieldName.includes('company')) {
        value = `${userDetails.firstName} ${userDetails.lastName}`;
      } else if (fieldName.includes('first') || fieldName.includes('fname')) {
        value = userDetails.firstName;
      } else if (fieldName.includes('last') || fieldName.includes('lname')) {
        value = userDetails.lastName;
      } else if (fieldName.includes('email')) {
        value = userDetails.email;
      } else if (fieldName.includes('phone')) {
        value = userDetails.phoneNumber;
      } else if (fieldName.includes('linkedin')) {
        value = userDetails.linkedIn;
      } else if (fieldName.includes('website') || fieldName.includes('portfolio')) {
        value = userDetails.website;
      } else if (fieldName.includes('github')) {
        value = userDetails.github;
      } else if (fieldName.includes('cover') || fieldName.includes('letter')) {
        value = this.generateCoverLetter(userDetails, jobDetails);
      } else if (fieldName.includes('resume') || fieldName.includes('cv')) {
        // Handle file upload separately
        return;
      }

      if (value) {
        field.value = value;
        field.dispatchEvent(new Event('input', { bubbles: true }));
        field.dispatchEvent(new Event('change', { bubbles: true }));
      }

    } catch (error) {
      this.log("❌ Error filling field:", error.message);
    }
  }

  async handleDynamicApplicationForm(jobDetails) {
    try {
      // Wait for form to appear
      await this.delay(2000);
      
      const form = document.querySelector('form') || 
                  document.querySelector('[role="dialog"] form') ||
                  document.querySelector('.application-form');

      if (!form) return false;

      // Get user details
      const userDetails = await this.userService.getUserDetails();
      if (!userDetails) return false;

      // Fill common fields
      const fieldMappings = {
        'input[name*="name"], input[placeholder*="name"]': `${userDetails.firstName} ${userDetails.lastName}`,
        'input[name*="email"], input[placeholder*="email"]': userDetails.email,
        'input[name*="phone"], input[placeholder*="phone"]': userDetails.phoneNumber,
        'textarea[name*="cover"], textarea[placeholder*="cover"]': this.generateCoverLetter(userDetails, jobDetails)
      };

      for (const [selector, value] of Object.entries(fieldMappings)) {
        const field = form.querySelector(selector);
        if (field && value) {
          field.value = value;
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new Event('change', { bubbles: true }));
          await this.delay(300);
        }
      }

      // Submit form
      const submitButton = form.querySelector('button[type="submit"], .submit');
      if (submitButton) {
        await this.clickElementReliably(submitButton);
        await this.delay(3000);
        return true;
      }

      return false;
    } catch (error) {
      this.log("❌ Error handling dynamic form:", error.message);
      return false;
    }
  }

  async verifyApplicationSuccess() {
    try {
      await this.delay(2000);

      // Look for success indicators
      const successSelectors = [
        '.success',
        '.confirmation',
        '[class*="success"]',
        '[class*="confirm"]'
      ];

      for (const selector of successSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          this.log("✅ Application success verified");
          return true;
        }
      }

      // Look for success text
      const successTexts = [
        'application submitted',
        'thank you',
        'successfully applied',
        'application received'
      ];

      const bodyText = document.body.textContent.toLowerCase();
      for (const text of successTexts) {
        if (bodyText.includes(text)) {
          this.log("✅ Application success verified by text");
          return true;
        }
      }

      // If no explicit success, assume success if no error
      this.log("⚠️ Could not verify success, assuming success");
      return true;

    } catch (error) {
      this.log("❌ Error verifying application success:", error.message);
      return false;
    }
  }

  async returnToJobsList() {
    try {
      // Try browser back button first
      window.history.back();
      await this.delay(2000);

      // Verify we're back on jobs list
      const jobCards = document.querySelectorAll('.styles_component__uTjje');
      if (jobCards.length > 0) {
        this.log("✅ Successfully returned to jobs list");
        return true;
      }

      // Fallback: navigate directly to jobs page
      window.location.href = "https://wellfound.com/jobs";
      await this.delay(3000);
      await this.waitForJobCards();
      
      return true;
    } catch (error) {
      this.log("❌ Error returning to jobs list:", error.message);
      return false;
    }
  }

  // Utility methods
  async clickElementReliably(element) {
    const strategies = [
      () => element.click(),
      () => element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
      () => {
        element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
        element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
        element.dispatchEvent(new MouseEvent('click', { bubbles: true }));
      },
      () => {
        element.focus();
        element.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      }
    ];

    element.scrollIntoView({ behavior: 'smooth', block: 'center' });
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

  generateSelector(element) {
    if (element.id) return `#${element.id}`;
    if (element.name) return `[name="${element.name}"]`;
    if (element.className) return `.${element.className.split(' ')[0]}`;
    return element.tagName.toLowerCase();
  }

  generateCoverLetter(userDetails, jobDetails) {
    return `Dear ${jobDetails.company} team,

I am excited to apply for the ${jobDetails.title} position at ${jobDetails.company}. With my background in software development and passion for innovative solutions, I believe I would be a valuable addition to your team.

${userDetails.coverLetter || 'I am eager to contribute to your organization and would welcome the opportunity to discuss how my skills align with your needs.'}

Best regards,
${userDetails.firstName} ${userDetails.lastName}`;
  }

  extractText(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent) {
        return element.textContent.trim();
      }
    }
    return "";
  }

  // UNCHANGED METHODS FROM ORIGINAL IMPLEMENTATION

  async isFilterPanelOpen() {
    try {
      // Check for filter panel indicators
      const filterPanelSelectors = [
        '.styles_component__Har6x.styles_filterControlPanel__oOSuu', // From the DOM structure
        '[class*="filterControlPanel"]',
        '[class*="filter"][class*="panel"]',
        '.styles_row__yDVEM', // Filter sections
        'input[placeholder="Minimum salary"]', // Salary filter
        'input[value="full_time"]', // Job type filters
        '.styles_component__t6wv_' // Filter components
      ];

      for (const selector of filterPanelSelectors) {
        const element = document.querySelector(selector);
        if (element && element.offsetParent !== null) { // Check if visible
          this.log(`✅ Filter panel detected via selector: ${selector}`);
          return true;
        }
      }

      this.log("❌ Filter panel not detected");
      return false;
    } catch (error) {
      this.log("Error checking filter panel:", error.message);
      return false;
    }
  }

  async applyPositionFilters(positions) {
    if (!positions?.length) return;

    try {
      // Find and click the role selection button from the DOM structure
      const roleButton = document.querySelector('button[data-test="SearchBar-RoleSelect-FocusButton"]');
      if (roleButton) {
        roleButton.click();
        await this.delay(1000);

        // Look for the search input that appears after clicking
        const searchInput = document.querySelector('input[placeholder*="search" i], input[data-test*="role" i]');
        if (searchInput) {
          searchInput.value = positions.join(", ");
          searchInput.dispatchEvent(new Event('input', { bubbles: true }));
          searchInput.dispatchEvent(new Event('change', { bubbles: true }));
          await this.delay(500);
          
          // Press Enter to confirm
          searchInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
          await this.delay(500);
        }
      }
    } catch (error) {
      this.log("Failed to apply position filters:", error.message);
    }
  }

  async applyLocationFilters(location, remoteOnly) {
    try {
      if (remoteOnly || (location?.includes("Remote"))) {
        // Click the remote toggle button that shows "Africa" in the provided DOM
        const remoteButton = document.querySelector('button[class*="remoteOpen"]');
        if (remoteButton) {
          remoteButton.click();
          await this.delay(1000);
          
          // Select the appropriate region - looking for "Africa" as shown in DOM
          const regionOptions = document.querySelectorAll('button[class*="component"] .flex .label');
          for (const option of regionOptions) {
            if (option.textContent.includes('Africa') || option.textContent.includes('Remote')) {
              option.closest('button').click();
              await this.delay(500);
              break;
            }
          }
        }
      } else if (location?.length) {
        // Handle specific location selection
        const locationButton = document.querySelector('button[class*="locationField"]');
        if (locationButton) {
          locationButton.click();
          await this.delay(1000);
          
          // Select the appropriate location
          const locationOptions = document.querySelectorAll('span[class*="label"]');
          for (const option of locationOptions) {
            if (option.textContent.includes(location[0])) {
              option.closest('button').click();
              await this.delay(500);
              break;
            }
          }
        }
      }
    } catch (error) {
      this.log("Failed to apply location filters:", error.message);
    }
  }

  async applySalaryFilters(salary) {
    if (!salary || salary.length !== 2) return;

    try {
      const [minSalary, maxSalary] = salary;
      
      // Based on the DOM structure, find the active salary filter section
      const salarySection = document.querySelector('.styles_component__t6wv_.styles_active__dGRaC');
      if (salarySection && salarySection.querySelector('h5')?.textContent?.includes('Salary')) {
        
        // Find salary input fields within this section
        const minSalaryInput = salarySection.querySelector('input[placeholder="Minimum salary"]');
        const maxSalaryInput = salarySection.querySelector('input[placeholder="Maximum (optional)"]');
        
        if (minSalaryInput && minSalary > 0) {
          minSalaryInput.value = minSalary.toString();
          minSalaryInput.dispatchEvent(new Event('input', { bubbles: true }));
          minSalaryInput.dispatchEvent(new Event('change', { bubbles: true }));
          await this.delay(300);
        }
        
        if (maxSalaryInput && maxSalary > 0) {
          maxSalaryInput.value = maxSalary.toString();
          maxSalaryInput.dispatchEvent(new Event('input', { bubbles: true }));
          maxSalaryInput.dispatchEvent(new Event('change', { bubbles: true }));
          await this.delay(300);
        }
      }
    } catch (error) {
      this.log("Failed to apply salary filters:", error.message);
    }
  }

  async applyJobTypeFilters(jobTypes) {
    if (!jobTypes?.length) return;

    try {
      // Find the Job Types section in the filter panel
      const jobTypesSection = document.querySelector('.styles_component__t6wv_.styles_active__dGRaC');
      if (jobTypesSection && jobTypesSection.querySelector('h5')?.textContent?.includes('Job Types')) {
        
        // Map user job types to the available checkboxes
        const jobTypeMap = {
          "Full-time": "full_time",
          "Part-time": "part_time", 
          "Contract": "contract",
          "Internship": "internship",
          "Temporary": "cofounder" // This might map differently in Wellfound
        };

        for (const jobType of jobTypes) {
          const mappedType = jobTypeMap[jobType];
          if (mappedType) {
            const checkbox = jobTypesSection.querySelector(`input[value="${mappedType}"]`);
            if (checkbox && !checkbox.checked) {
              checkbox.click();
              await this.delay(300);
            }
          }
        }
      }
    } catch (error) {
      this.log("Failed to apply job type filters:", error.message);
    }
  }

  async applyExperienceFilters(experience) {
    if (!experience?.length) return;

    try {
      // Experience levels are already selected (Full Time, Contract, Internship are checked)
      // We can keep the existing selections or modify based on user preferences
      this.log("Experience filters applied based on default selections");
    } catch (error) {
      this.log("Failed to apply experience filters:", error.message);
    }
  }

  async waitForJobCards() {
    try {
      await this.waitForElement('.styles_component__uTjje', 10000);
      await this.delay(2000); // Additional wait for cards to fully load
      this.log("✅ Job cards loaded");
    } catch (error) {
      this.log("⚠️ Timeout waiting for job cards");
      throw new Error("Job cards failed to load");
    }
  }

  doesJobMatchPreferences(jobDetails) {
    const preferences = this.config.preferences || {};

    // Check if positions match (basic keyword matching)
    if (preferences.positions?.length) {
      const jobTitle = jobDetails.title?.toLowerCase() || "";
      const hasMatchingPosition = preferences.positions.some((position) =>
        jobTitle.includes(position.toLowerCase())
      );

      if (!hasMatchingPosition) {
        this.log(`❌ Job title "${jobDetails.title}" doesn't match required positions`);
        return false;
      }
    }

    // Check remote preference
    if (preferences.remoteOnly) {
      const isRemote = jobDetails.location?.toLowerCase().includes('remote') || 
                      jobDetails.location?.toLowerCase().includes('anywhere') ||
                      jobDetails.description?.toLowerCase().includes('remote');
      
      if (!isRemote) {
        this.log(`❌ Job "${jobDetails.title}" is not remote`);
        return false;
      }
    }

    return true;
  }

  extractJobIdFromUrl(url) {
    try {
      // Try to extract job ID from Wellfound URL patterns
      const patterns = [
        /\/jobs\/(\d+)/,
        /jobId=(\d+)/,
        /job[_-](\d+)/
      ];
      
      for (const pattern of patterns) {
        const match = url.match(pattern);
        if (match) {
          return match[1];
        }
      }
      
      return null;
    } catch (error) {
      return null;
    }
  }

  async loadMoreJobs() {
    try {
      // Try to scroll to load more jobs
      window.scrollTo(0, document.body.scrollHeight);
      await this.delay(3000);
      
      // Check if new job cards loaded
      const newJobCards = document.querySelectorAll('.styles_component__uTjje');
      return newJobCards.length > 0;
    } catch (error) {
      this.log("Failed to load more jobs:", error.message);
      return false;
    }
  }

  async checkUserAuthorization() {
    try {
      this.statusOverlay.addInfo("Let me check if you're all set to apply...");

      const canApply = await this.userService.canApplyMore();
      if (!canApply) {
        const remaining = await this.userService.getRemainingApplications();
        const userDetails = await this.userService.getUserDetails();

        const message =
          userDetails.userRole === "credit"
            ? `Looks like you're running low on credits (${userDetails.credits} left). Time to top up! 💳`
            : `You've hit your daily limit! Don't worry, you have ${remaining} applications left overall. 📊`;

        this.statusOverlay.addWarning(message);
        throw new Error(`Cannot apply: ${message}`);
      }

      this.log("✅ User authorization check passed");
      this.statusOverlay.addSuccess("Perfect! You're all authorized and ready to go!");
    } catch (error) {
      this.log("❌ User authorization check failed:", error.message);
      this.statusOverlay.addError("Hmm, there's an issue with your account permissions. " + error.message);
      throw error;
    }
  }

  async findApplyButton() {
    const selectors = [
      'button:contains("Apply")',
      'a:contains("Apply")',
      'button[class*="apply"]',
      'a[class*="apply"]',
      '.apply-button',
      '.apply-btn'
    ];

    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button) return button;
    }
    return null;
  }

  async saveExternalJob(jobDetails) {
    try {
      // Save external job for potential future processing or user reference
      const externalJobData = {
        ...jobDetails,
        applyType: "external",
        dateFound: new Date().toISOString(),
        needsManualApplication: true,
      };

      this.log(`📝 External job saved: ${jobDetails.title} at ${jobDetails.company}`);
      this.statusOverlay.addInfo(`I saved "${jobDetails.title}" for you to apply to manually later! 📌`);

      // You could extend this to save to your tracking system
      // await this.appTracker.saveExternalJob(externalJobData);

      return true;
    } catch (error) {
      console.error("Error saving external job:", error);
      this.log(`❌ Error saving external job: ${error.message}`);
      return false;
    }
  }

  async saveAppliedJob(jobDetails) {
    try {
      const success = await this.appTracker.saveAppliedJob({
        jobId: jobDetails.jobId,
        title: jobDetails.title,
        company: jobDetails.company,
        location: jobDetails.location,
        jobUrl: jobDetails.url,
        description: jobDetails.description,
        platform: this.platform,
      });

      if (success) {
        await this.appTracker.updateApplicationCount();
        this.log(`✅ Job application saved to database: ${jobDetails.title}`);
        this.statusOverlay.addSuccess(`I've saved "${jobDetails.title}" to your application history! 📝`);
        return true;
      } else {
        this.log(`⚠️ Failed to save job application: ${jobDetails.title}`);
        return false;
      }
    } catch (error) {
      this.log(`❌ Error saving job application: ${error.message}`);
      return false;
    }
  }

  // Utility methods
  async waitForPageLoad() {
    try {
      await this.waitForElement('body', 10000);
      await this.delay(2000);
    } catch (error) {
      console.error("Error waiting for page load:", error);
    }
  }

  async waitForElement(selector, timeout = 10000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const element = document.querySelector(selector);
      if (element) return element;
      await this.delay(100);
    }
    throw new Error(`Element not found: ${selector}`);
  }

  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Navigation event handlers
  onDOMChange() {
    if (this.automationStarted && this.isRunning && !this.isPaused) {
      // Handle DOM changes if needed
    }
  }

  onNavigation(oldUrl, newUrl) {
    this.log(`🔄 Navigation detected: ${oldUrl} → ${newUrl}`);
    this.statusOverlay.addInfo("I noticed we moved to a different page...");

    if (!newUrl.includes("wellfound.com/jobs") && this.automationStarted && this.isRunning) {
      this.log("⚠️ Navigated away from Wellfound Jobs, attempting to return");
      this.statusOverlay.addWarning("Looks like we went off-track! Let me get us back to the jobs page...");
      setTimeout(() => {
        if (this.isRunning) {
          this.navigateToWellfoundJobs();
        }
      }, 3000);
    }
  }

  async navigateToWellfoundJobs() {
    window.location.href = "https://wellfound.com/jobs";
    await this.delay(3000);
    await this.waitForPageLoad();
    this.log("✅ Navigation to Wellfound Jobs completed");
    this.statusOverlay.addSuccess("Perfect! Now I'm setting up the search with all your preferences.");
  }

  async pause() {
    await super.pause();
    this.log("⏸️ Wellfound automation paused");
    this.statusOverlay.addWarning("Taking a little break! I'll be here when you're ready to continue. ⏸️");
  }

  async resume() {
    await super.resume();
    this.log("▶️ Wellfound automation resumed");
    this.statusOverlay.addSuccess("I'm back! Let's continue finding you some great opportunities! 🚀");
  }

  async stop() {
    await super.stop();
    this.hasStarted = false;
    this.automationStarted = false;
    this.log("⏹️ Wellfound automation stopped");
    this.statusOverlay.addWarning("All done for now! Thanks for letting me help with your job search. Good luck! 🍀");
  }

  cleanup() {
    super.cleanup();
    this.processedJobs.clear();

    // Cleanup status overlay
    if (this.statusOverlay) {
      this.statusOverlay.destroy();
      this.statusOverlay = null;
    }

    this.log("🧹 Wellfound platform cleanup completed");
  }
}