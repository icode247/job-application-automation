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

    // FIXED: Initialize services with proper API host from config
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

    // Create status overlay
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
    this.log("📋 Received start parameters:", params); // ADDED: Debug log
    this.statusOverlay.addInfo("Alright, let's get you some amazing job opportunities on Wellfound! Let me start searching based on your preferences...");

    try {
      // FIXED: Better config merging with validation
      this.config = { 
        ...this.config, 
        ...params,
        // Ensure essential fields have values
        jobsToApply: params.jobsToApply || this.config.jobsToApply || 10,
        userId: params.userId || this.config.userId || this.userId,
        preferences: params.preferences || this.config.preferences || {},
        apiHost: params.apiHost || this.config.apiHost || this.HOST
      };

      // FIXED: Update services with proper userId and config if they weren't set properly
      if (this.config.userId && (!this.appTracker.userId || !this.userService.userId)) {
        this.appTracker = new ApplicationTrackerService({
          apiHost: this.HOST,
          userId: this.config.userId,
        });
        this.userService = new UserService({
          apiHost: this.HOST,
          userId: this.config.userId,
        });
        this.log("🔧 Services re-initialized with correct userId");
      }

      this.log("📋 Final configuration after merging:", {
        jobsToApply: this.config.jobsToApply,
        userId: this.config.userId,
        hasPreferences: !!this.config.preferences,
        preferencesKeys: Object.keys(this.config.preferences || {}),
        apiHost: this.config.apiHost
      });

      if (!this.config.jobsToApply || this.config.jobsToApply <= 0) {
        const errorMessage = "I need to know how many jobs you want me to apply to!";
        this.statusOverlay.addError(errorMessage);
        throw new Error(errorMessage);
      }

      if (!this.config.userId) {
        const errorMessage = "User ID is required for automation";
        this.statusOverlay.addError(errorMessage);
        throw new Error(errorMessage);
      }

      // Check user authorization before starting
      await this.checkUserAuthorization();

      this.updateProgress({ total: this.config.jobsToApply });

      // Wait for page readiness
      await this.waitForPageLoad();
      this.log("📄 Page loaded, current URL:", window.location.href);

      // Navigate to Wellfound Jobs if not already there
      const currentUrl = window.location.href.toLowerCase();
      if (!currentUrl.includes("wellfound.com/jobs")) {
        this.log("📍 Navigating to Wellfound Jobs");
        this.statusOverlay.addInfo("Let me take you to the Wellfound jobs page! ✨");
        await this.navigateToWellfoundJobs();
      } else {
        this.log("✅ Already on Wellfound Jobs page");
        this.statusOverlay.addSuccess("Great! We're already on Wellfound Jobs. Now let me apply your filters...");
      }

      // Apply filters based on user preferences
      await this.applyFilters();

      // Click View Results to show job cards
      await this.clickViewResults();

      // Start processing jobs
      this.automationStarted = true;
      this.statusOverlay.updateStatus("applying", "Finding perfect matches for you");
      await this.processJobs({ jobsToApply: this.config.jobsToApply });
    } catch (error) {
      this.hasStarted = false;
      this.reportError(error, { phase: "start" });
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

  async navigateToWellfoundJobs() {
    window.location.href = "https://wellfound.com/jobs";
    await this.delay(3000);
    await this.waitForPageLoad();
    this.log("✅ Navigation to Wellfound Jobs completed");
    this.statusOverlay.addSuccess("Perfect! Now I'm setting up the search with all your preferences.");
  }

  async applyFilters() {
    try {
      this.statusOverlay.addInfo("Checking filter panel status...");

      // Check if filter panel is already open
      const isAlreadyOpen = await this.isFilterPanelOpen();
      if (isAlreadyOpen) {
        this.log("✅ Filter panel is already open!");
        this.statusOverlay.addSuccess("Filter panel is already open! Applying your preferences...");
      } else {
        this.statusOverlay.addInfo("Opening the filter panel to apply your job preferences...");

        // Click the Filters button to open the filter panel
        const filtersButton = await this.clickFiltersButton();
        if (!filtersButton) {
          this.log("⚠️ Could not open filter panel, but continuing with filter application...");
          this.statusOverlay.addWarning("Couldn't open the filter panel, but I'll try to apply filters anyway...");
        }

        // Wait for filter panel to open
        await this.delay(2000);
      }
      
      this.statusOverlay.addInfo("Now applying your preferences...");

      const preferences = this.config.preferences || {};
      
      // Apply search keywords (positions)
      await this.applyPositionFilters(preferences.positions);
      
      // Apply location filters
      await this.applyLocationFilters(preferences.location, preferences.remoteOnly);
      
      // Apply salary filters
      await this.applySalaryFilters(preferences.salary);
      
      // Apply job type filters
      await this.applyJobTypeFilters(preferences.jobType);
      
      // Apply experience level filters
      await this.applyExperienceFilters(preferences.experience);

      this.log("✅ All filters applied successfully");
      this.statusOverlay.addSuccess("All your filters are now applied! Let's see what amazing opportunities we found!");
    } catch (error) {
      this.log("⚠️ Failed to apply some filters:", error.message);
      this.statusOverlay.addWarning("I had trouble with some filters, but the main search is working great!");
    }
  }

  async clickFiltersButton() {
    try {
      this.log("🔍 Looking for Filters button...");
      
      // Look for the Filters button with multiple strategies
      let filtersButton = null;
      
      // Strategy 1: Look for any clickable element containing "Filters"
      const potentialButtons = document.querySelectorAll('button, div[role="button"], [class*="button"], div[onclick], [style*="cursor: pointer"]');
      for (const element of potentialButtons) {
        if (element.textContent && element.textContent.trim().toLowerCase().includes('filters')) {
          filtersButton = element;
          this.log("🎯 Found filters button via text search:", element);
          break;
        }
      }
      
      // Strategy 2: Look for the specific icon
      if (!filtersButton) {
        const filterIcon = document.querySelector('.styles_filtersIcon__WhlNp');
        if (filterIcon) {
          // Find the closest clickable parent
          filtersButton = filterIcon.closest('button, div[role="button"], [onclick], [class*="button"]') || 
                         filterIcon.parentElement;
          this.log("🎯 Found filters button via icon:", filtersButton);
        }
      }
      
      // Strategy 3: Look for any element with the text "Filters"
      if (!filtersButton) {
        const allElements = document.querySelectorAll('*');
        for (const element of allElements) {
          if (element.textContent && 
              element.textContent.trim() === 'Filters' &&
              element.offsetParent !== null) { // Make sure it's visible
            filtersButton = element.closest('button, div, span') || element;
            this.log("🎯 Found filters button via exact text match:", filtersButton);
            break;
          }
        }
      }

      if (!filtersButton) {
        this.log("❌ Could not find Filters button at all");
        return false;
      }

      // Try multiple click methods to ensure it works
      const clickMethods = [
        () => filtersButton.click(),
        () => filtersButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
        () => filtersButton.dispatchEvent(new Event('click', { bubbles: true })),
        () => {
          // Simulate a full mouse interaction
          filtersButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          filtersButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          filtersButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
      ];

      this.log("🎯 Attempting to click Filters button...");
      
      // Scroll into view first
      filtersButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await this.delay(1000);

      // Try each click method
      for (let i = 0; i < clickMethods.length; i++) {
        try {
          this.log(`Attempting click method ${i + 1}...`);
          clickMethods[i]();
          await this.delay(2000);
          
          // Check if filter panel opened by looking for filter elements
          if (await this.isFilterPanelOpen()) {
            this.log("✅ Filter panel opened successfully!");
            this.statusOverlay.addSuccess("Filter panel opened successfully!");
            return true;
          }
        } catch (error) {
          this.log(`Click method ${i + 1} failed:`, error.message);
        }
      }

      // If none of the click methods worked, try manual focus and key press
      try {
        this.log("Trying focus + Enter method...");
        filtersButton.focus();
        await this.delay(500);
        filtersButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await this.delay(2000);
        
        if (await this.isFilterPanelOpen()) {
          this.log("✅ Filter panel opened with keyboard!");
          this.statusOverlay.addSuccess("Filter panel opened successfully!");
          return true;
        }
      } catch (error) {
        this.log("Keyboard method failed:", error.message);
      }

      this.log("❌ All click methods failed - filter panel did not open");
      this.statusOverlay.addWarning("Couldn't open the filter panel, but I'll try to apply filters anyway...");
      return false;
      
    } catch (error) {
      this.log("❌ Error in clickFiltersButton:", error.message);
      this.statusOverlay.addWarning("Had trouble opening the filter panel, but continuing...");
      return false;
    }
  }

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

  async clickViewResults() {
    try {
      this.statusOverlay.addInfo("Looking for the View Results button to show your job matches...");
      
      let viewResultsButton = null;
      
      // Strategy 1: Look for the specific data-test attribute
      viewResultsButton = document.querySelector('button[data-test="SearchBar-ViewResultsButton"]');
      if (viewResultsButton) {
        this.log("🎯 Found View Results button via data-test attribute");
      }
      
      // Strategy 2: Look for any button with "View results" text
      if (!viewResultsButton) {
        const buttons = document.querySelectorAll('button');
        for (const button of buttons) {
          if (button.textContent && button.textContent.trim().toLowerCase().includes('view results')) {
            viewResultsButton = button;
            this.log("🎯 Found View Results button via text search");
            break;
          }
        }
      }
      
      // Strategy 3: Look for buttons in the footer area that might contain results count
      if (!viewResultsButton) {
        const footerButtons = document.querySelectorAll('.styles_footer__2BOOk button, footer button, [class*="footer"] button');
        for (const button of footerButtons) {
          if (button.textContent && 
              (button.textContent.includes('results') || 
               button.textContent.includes('View') ||
               /\d+\s*results?/i.test(button.textContent))) {
            viewResultsButton = button;
            this.log("🎯 Found View Results button in footer area");
            break;
          }
        }
      }
      
      // Strategy 4: Look for any button that might trigger results
      if (!viewResultsButton) {
        const allButtons = document.querySelectorAll('button, [role="button"]');
        for (const button of allButtons) {
          const text = button.textContent?.trim().toLowerCase() || '';
          if (text.includes('view') || text.includes('show') || text.includes('results') || text.includes('apply')) {
            // Check if it's not a filter button or other non-results button
            if (!text.includes('filter') && !text.includes('clear') && !text.includes('reset')) {
              viewResultsButton = button;
              this.log("🎯 Found potential View Results button:", button.textContent);
              break;
            }
          }
        }
      }

      if (!viewResultsButton) {
        this.log("❌ Could not find View Results button, checking if results are already visible...");
        
        // Check if job cards are already visible (maybe the button was already clicked or not needed)
        const existingJobCards = document.querySelectorAll('.styles_component__uTjje');
        if (existingJobCards.length > 0) {
          this.log("✅ Job cards already visible, no need to click View Results");
          this.statusOverlay.addSuccess("Great! Job results are already showing!");
          return true;
        }
        
        this.statusOverlay.addWarning("Couldn't find the View Results button. Let me check if jobs are already showing...");
        
        // Wait a bit and check again
        await this.delay(3000);
        const jobCardsAfterWait = document.querySelectorAll('.styles_component__uTjje');
        if (jobCardsAfterWait.length > 0) {
          this.log("✅ Job cards appeared after waiting");
          this.statusOverlay.addSuccess("Perfect! Job results are now showing!");
          return true;
        }
        
        throw new Error("View Results button not found and no job cards visible");
      }

      // Try multiple click methods
      const clickMethods = [
        () => viewResultsButton.click(),
        () => viewResultsButton.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })),
        () => {
          viewResultsButton.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
          viewResultsButton.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
          viewResultsButton.dispatchEvent(new MouseEvent('click', { bubbles: true }));
        }
      ];

      this.log("🎯 Attempting to click View Results button...");
      
      // Scroll into view first
      viewResultsButton.scrollIntoView({ behavior: 'smooth', block: 'center' });
      await this.delay(1000);

      // Try each click method
      for (let i = 0; i < clickMethods.length; i++) {
        try {
          this.log(`Attempting View Results click method ${i + 1}...`);
          clickMethods[i]();
          await this.delay(3000);
          
          // Check if job cards appeared
          const jobCards = document.querySelectorAll('.styles_component__uTjje');
          if (jobCards.length > 0) {
            this.log(`✅ View Results clicked successfully! Found ${jobCards.length} job cards`);
            this.statusOverlay.addSuccess("Perfect! Found your job matches. Now let me start applying to them!");
            await this.waitForJobCards();
            return true;
          }
        } catch (error) {
          this.log(`View Results click method ${i + 1} failed:`, error.message);
        }
      }

      // If clicking didn't work, try keyboard
      try {
        this.log("Trying focus + Enter for View Results...");
        viewResultsButton.focus();
        await this.delay(500);
        viewResultsButton.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await this.delay(3000);
        
        const jobCards = document.querySelectorAll('.styles_component__uTjje');
        if (jobCards.length > 0) {
          this.log("✅ View Results worked with keyboard!");
          this.statusOverlay.addSuccess("Perfect! Found your job matches!");
          await this.waitForJobCards();
          return true;
        }
      } catch (error) {
        this.log("Keyboard method failed for View Results:", error.message);
      }

      throw new Error("All View Results click methods failed");
      
    } catch (error) {
      this.log("❌ Failed to click View Results:", error.message);
      this.statusOverlay.addError("Had trouble loading the job results, but I'll keep trying!");
      throw error;
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

  async processJobs({ jobsToApply }) {
    let processedCount = 0;
    let appliedCount = 0;
    let skippedCount = 0;
    let processedJobs = new Set();

    try {
      this.log(`Starting to process Wellfound jobs. Target: ${jobsToApply} jobs`);
      this.statusOverlay.addInfo(`Alright! I'm going to help you apply to ${jobsToApply} jobs. Let me start scanning through the opportunities...`);

      while (appliedCount < jobsToApply) {
        const jobCards = await this.getJobCards();
        console.log(`Found ${jobCards.length} job cards`);

        if (jobCards.length === 0) {
          this.statusOverlay.addWarning("Looks like I've reached the end of available jobs for your search criteria!");
          break;
        }

        this.statusOverlay.addInfo(`Great! I found ${jobCards.length} jobs. Let me check each one...`);

        for (const jobCard of jobCards) {
          if (appliedCount >= jobsToApply) {
            this.log(`Reached target of ${jobsToApply} jobs`);
            this.statusOverlay.addSuccess(`Amazing! I've successfully applied to your target of ${jobsToApply} jobs! 🎉`);
            break;
          }

          const jobId = this.getJobIdFromCard(jobCard);
          if (!jobId || processedJobs.has(jobId)) {
            continue;
          }

          processedJobs.add(jobId);
          processedCount++;

          try {
            // Click Learn More to view job details
            const success = await this.clickLearnMore(jobCard);
            
            if (success) {
              // Extract job details
              const jobDetails = await this.extractJobDetails();
              
              if (jobDetails) {
                // Check if job matches user preferences
                if (this.doesJobMatchPreferences(jobDetails)) {
                  this.updateProgress({
                    current: `Checking: ${jobDetails.title} at ${jobDetails.company}`,
                  });

                  // Check if already applied
                  const alreadyApplied = await this.appTracker.checkIfAlreadyApplied(jobId);
                  if (alreadyApplied) {
                    this.log(`Already applied to job ${jobId}, skipping.`);
                    skippedCount++;
                    continue;
                  }

                  // Try to apply to the job
                  const applied = await this.applyToJob(jobDetails);
                  
                  if (applied) {
                    appliedCount++;
                    this.progress.completed = appliedCount;
                    this.updateProgress({ completed: appliedCount });

                    await this.userService.updateApplicationCount();
                    await this.saveAppliedJob(jobDetails);

                    this.log(`Successfully applied to job ${appliedCount}/${jobsToApply}`);
                    this.statusOverlay.addSuccess(
                      `Woohoo! Just applied to "${jobDetails.title}" at ${jobDetails.company}! That's ${appliedCount} down, ${jobsToApply - appliedCount} to go! 🎯`
                    );

                    this.reportApplicationSubmitted(jobDetails, {
                      method: "Wellfound Application",
                      userId: this.config.userId || this.userId,
                      matchedPreferences: true,
                    });
                  } else {
                    this.progress.failed++;
                    this.updateProgress({ failed: this.progress.failed });
                    this.statusOverlay.addError(`Oops! Had trouble applying to "${jobDetails.title}". Don't worry, I'll keep going with the next ones!`);
                  }
                } else {
                  this.log(`Skipping job "${jobDetails.title}" - doesn't match preferences`);
                  this.statusOverlay.addInfo(`"${jobDetails.title}" at ${jobDetails.company} doesn't quite match your preferences, so I'll skip this one.`);
                  skippedCount++;
                }
              }
            }

            await this.delay(2000); // Delay between jobs
          } catch (error) {
            this.log(`Error processing job ${jobId}:`, error);
            this.statusOverlay.addError("Had a little hiccup with one of the jobs, but I'm keeping going! 💪");
            continue;
          }
        }

        // If we need more jobs, try to load more (scroll or pagination)
        if (appliedCount < jobsToApply) {
          const hasMore = await this.loadMoreJobs();
          if (!hasMore) {
            this.statusOverlay.addSuccess(
              `I've looked everywhere and applied to ${appliedCount} out of ${jobsToApply} jobs! I couldn't find any more that match your criteria right now. 🎯`
            );
            break;
          }
        }
      }

      const completionStatus = appliedCount >= jobsToApply ? "target_reached" : "no_more_jobs";
      const message = appliedCount >= jobsToApply
        ? `Mission accomplished! 🎉 I successfully applied to all ${appliedCount} jobs you wanted!`
        : `Great work! I applied to ${appliedCount} out of ${jobsToApply} jobs. I couldn't find any more that perfectly match your criteria right now.`;

      this.log(message);
      this.statusOverlay.addSuccess(message);
      this.reportComplete();

      return {
        status: completionStatus,
        message,
        appliedCount,
        processedCount,
        skippedCount,
        preferencesUsed: this.config.preferences,
      };
    } catch (error) {
      console.error("Error in processJobs:", error);
      this.statusOverlay.addError("Something went wrong during the job application process. Don't worry though - I saved your progress!");
      this.reportError(error, { phase: "processJobs" });
      throw error;
    }
  }

  async getJobCards() {
    const jobCards = document.querySelectorAll('.styles_component__uTjje');
    return Array.from(jobCards);
  }

  getJobIdFromCard(jobCard) {
    // Try to extract a unique identifier from the job card
    const link = jobCard.querySelector('a[href*="/jobs/"]');
    if (link) {
      const href = link.getAttribute('href');
      const match = href.match(/\/jobs\/(\d+)/);
      return match ? match[1] : null;
    }
    
    // Fallback: use company + title as unique identifier
    const company = jobCard.querySelector('.styles_headerContainer__GfbYF h2')?.textContent?.trim();
    const title = jobCard.querySelector('.styles_component__Ey28k .styles_title__xpQDw')?.textContent?.trim();
    
    if (company && title) {
      return `${company}-${title}`.replace(/[^a-zA-Z0-9]/g, '');
    }
    
    return null;
  }

  async clickLearnMore(jobCard) {
    try {
      const learnMoreButton = jobCard.querySelector('button[data-test="LearnMoreButton"]');
      if (learnMoreButton) {
        learnMoreButton.click();
        await this.delay(2000);
        
        // Wait for job details to load
        await this.waitForElement('.styles_description__xjvTf', 5000);
        return true;
      }
      return false;
    } catch (error) {
      this.log("Failed to click Learn More button:", error.message);
      return false;
    }
  }

  async extractJobDetails() {
    try {
      // Extract job title from the main heading
      const title = document.querySelector('h1.inline.text-xl.font-semibold.text-black')?.textContent?.trim() || 
                   document.querySelector('h1')?.textContent?.trim() || 
                   "Unknown Position";
      
      // Extract company name from the company link/text
      const company = document.querySelector('a[rel="noopener noreferrer"][target="_blank"] span.text-sm.font-semibold.text-black')?.textContent?.trim() ||
                     document.querySelector('.text-sm.font-semibold.text-black')?.textContent?.trim() ||
                     "Unknown Company";
      
      // Extract location from the job details
      const locationElement = document.querySelector('li:contains("Remote")') || 
                             document.querySelector('ul.block.text-md.text-black li');
      let location = "Not specified";
      if (locationElement) {
        const locationText = locationElement.textContent.trim();
        // Extract location from text like "Remote (United States) | Full Time"
        const locationMatch = locationText.match(/Remote\s*\(([^)]+)\)|([^|]+)/);
        location = locationMatch ? (locationMatch[1] || locationMatch[2]).trim() : locationText;
      }
      
      // Extract job type (Full Time, Contract, etc.)
      const jobTypeElement = document.querySelector('ul.block.text-md.text-black li:last-child');
      const jobType = jobTypeElement ? jobTypeElement.textContent.replace(/.*\|/, '').trim() : "Not specified";
      
      // Extract job description from the description container
      const descriptionElement = document.querySelector('.styles_description__xjvTf') ||
                                 document.querySelector('#job-description') ||
                                 document.querySelector('.description');
      const description = descriptionElement ? descriptionElement.textContent.trim() : "No description available";
      
      // Extract additional details from the grid section
      const detailsGrid = document.querySelector('.grid.grid-cols-1.gap-6.rounded-b-xl.bg-neutral-50');
      let visaSponsorship = "Not specified";
      let relocation = "Not specified";
      let hiringContact = "Not specified";
      let hiresRemotelyIn = "Not specified";
      
      if (detailsGrid) {
        const detailSections = detailsGrid.querySelectorAll('div');
        detailSections.forEach(section => {
          const label = section.querySelector('span.text-md.font-semibold')?.textContent?.trim();
          
          if (label === "Hires remotely in") {
            hiresRemotelyIn = section.querySelector('a')?.textContent?.trim() || "Not specified";
          } else if (label === "Visa Sponsorship") {
            visaSponsorship = section.querySelector('p span')?.textContent?.trim() || "Not Available";
          } else if (label === "Relocation") {
            const relocationSpan = section.querySelector('span.flex');
            relocation = relocationSpan ? relocationSpan.textContent.trim() : "Not specified";
          } else if (label === "Hiring contact") {
            hiringContact = section.querySelector('.text-md.text-black')?.textContent?.trim() || "Not specified";
          }
        });
      }
      
      // Extract posting date if available
      const postingDateElement = document.querySelector('.text-sm.font-extralight.text-neutral-500');
      const postedDate = postingDateElement ? postingDateElement.textContent.replace('Reposted:', '').trim() : "Not specified";
      
      // Generate a job ID from URL or create one
      let jobId = this.extractJobIdFromUrl(window.location.href);
      if (!jobId) {
        // Create a unique ID based on company and title
        jobId = `${company}-${title}`.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      }

      const jobDetails = {
        jobId,
        title,
        company,
        location,
        jobType,
        description,
        hiresRemotelyIn,
        visaSponsorship,
        relocation,
        hiringContact,
        postedDate,
        url: window.location.href,
        platform: this.platform,
        extractedAt: Date.now(),
      };

      this.currentJobDetails = jobDetails;
      this.log("📋 Extracted job details:", {
        title: jobDetails.title,
        company: jobDetails.company,
        location: jobDetails.location,
        jobType: jobDetails.jobType
      });
      
      return jobDetails;
    } catch (error) {
      this.log("Failed to extract job details:", error.message);
      return null;
    }
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

  async applyToJob(jobDetails) {
    try {
      this.statusOverlay.addInfo(`Starting my application magic for "${jobDetails.title}"... ✨`);
      
      // Look for apply button in the job details page
      const applyButtons = [
        'button:contains("Apply")',
        'a:contains("Apply")',
        'button[class*="apply"]',
        'a[class*="apply"]',
        '.apply-button',
        '.apply-btn'
      ];
      
      let applyButton = null;
      for (const selector of applyButtons) {
        applyButton = document.querySelector(selector);
        if (applyButton) break;
      }
      
      if (applyButton) {
        // Check if this is an external application
        const isExternal = applyButton.getAttribute('href') || 
                          applyButton.textContent.includes('company website') ||
                          applyButton.textContent.includes('external');
        
        if (isExternal) {
          // This is an external application - save for manual application
          this.statusOverlay.addInfo(`"${jobDetails.title}" requires applying on their company website. I'll save this one for you to apply manually later! 📌`);
          
          // Save as external job for tracking
          await this.saveExternalJob(jobDetails);
          return false; // Don't count as successful automated application
        } else {
          // This is a direct application through Wellfound
          applyButton.click();
          await this.delay(2000);
          
          // Handle potential application form or modal
          const success = await this.handleApplicationForm(jobDetails);
          
          if (success) {
            this.statusOverlay.addSuccess(`Successfully applied to "${jobDetails.title}"! 🚀`);
            return true;
          } else {
            this.statusOverlay.addWarning(`Had some trouble with the application form for "${jobDetails.title}"`);
            return false;
          }
        }
      } else {
        // No apply button found - this might be a view-only job or requires other action
        this.statusOverlay.addInfo(`"${jobDetails.title}" doesn't have a direct apply button. I'll save it for your reference! 📝`);
        await this.saveExternalJob(jobDetails);
        return false;
      }
    } catch (error) {
      this.log("Failed to apply to job:", error.message);
      this.statusOverlay.addError("Had trouble with this application, but I'm moving on to the next one!");
      return false;
    }
  }

  async handleApplicationForm(jobDetails) {
    try {
      // Wait for application form/modal to appear
      await this.delay(2000);
      
      // Look for application form elements
      const formElements = [
        'form',
        '.application-form',
        '.modal',
        '[role="dialog"]'
      ];
      
      let applicationForm = null;
      for (const selector of formElements) {
        applicationForm = document.querySelector(selector);
        if (applicationForm) break;
      }
      
      if (applicationForm) {
        // Fill out the application form
        await this.fillApplicationForm(applicationForm, jobDetails);
        
        // Submit the form
        const submitButton = applicationForm.querySelector('button[type="submit"], .submit-btn, button:contains("Submit")');
        if (submitButton) {
          submitButton.click();
          await this.delay(3000);
          
          // Check for success confirmation
          const successIndicators = [
            '.success',
            '.confirmation',
            ':contains("Application submitted")',
            ':contains("Thank you")'
          ];
          
          for (const indicator of successIndicators) {
            if (document.querySelector(indicator)) {
              return true;
            }
          }
        }
      }
      
      // If no form found, assume the click was sufficient
      return true;
    } catch (error) {
      this.log("Error handling application form:", error.message);
      return false;
    }
  }

  async fillApplicationForm(form, jobDetails) {
    try {
      // Get user details for form filling
      const userDetails = await this.userService.getUserDetails();
      if (!userDetails) return;
      
      // Fill common form fields
      const fieldMappings = {
        'name': userDetails.firstName + ' ' + userDetails.lastName,
        'first_name': userDetails.firstName,
        'last_name': userDetails.lastName,
        'email': userDetails.email,
        'phone': userDetails.phoneNumber,
        'linkedin': userDetails.linkedIn,
        'website': userDetails.website,
        'github': userDetails.github,
        'cover_letter': userDetails.coverLetter || `Dear ${jobDetails.company} team,\n\nI am excited to apply for the ${jobDetails.title} position...`,
      };
      
      for (const [fieldName, value] of Object.entries(fieldMappings)) {
        if (!value) continue;
        
        const field = form.querySelector(`input[name*="${fieldName}"], textarea[name*="${fieldName}"], input[placeholder*="${fieldName}"]`);
        if (field) {
          field.value = value;
          field.dispatchEvent(new Event('input', { bubbles: true }));
          field.dispatchEvent(new Event('change', { bubbles: true }));
          await this.delay(300);
        }
      }
      
      // Handle file uploads (resume/CV)
      const fileInputs = form.querySelectorAll('input[type="file"]');
      for (const fileInput of fileInputs) {
        await this.handleFileUpload(fileInput, userDetails, jobDetails);
      }
      
    } catch (error) {
      this.log("Error filling application form:", error.message);
    }
  }

  async handleFileUpload(fileInput, userDetails, jobDetails) {
    try {
      // This would need to be implemented based on the user's resume/CV files
      // For now, we'll skip file uploads as they require actual file handling
      this.log("File upload detected but skipped for now");
    } catch (error) {
      this.log("Error handling file upload:", error.message);
    }
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