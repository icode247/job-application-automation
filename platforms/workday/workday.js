// platforms/workday/workday.js
import BasePlatform from '../base-platform.js';

export default class WorkdayPlatform extends BasePlatform {
  constructor(config) {
    super(config);
    this.platform = 'workday';
    this.searchQuery = config.searchQuery || 'software engineer';
    this.processedUrls = new Set();
    this.currentPageIndex = 0;
  }

  async initialize() {
    await super.initialize();
    this.log('🏢 Workday platform initialized');
  }

  async start(params = {}) {
    this.isRunning = true;
    this.log('🚀 Starting Workday automation');

    try {
      // Update config with any new parameters
      this.config = { ...this.config, ...params };

      // Ensure DOM is ready
      if (document.readyState !== 'complete') {
        this.log('⏳ Waiting for DOM to be ready...');
        await this.waitForPageLoad();
      }

      this.log('📍 Current URL: ' + window.location.href);

      // Determine if we're on Google search or Workday site
      if (window.location.href.includes('google.com')) {
        await this.handleGoogleSearchPage();
      } else if (window.location.href.includes('myworkdayjobs.com')) {
        await this.handleWorkdayPage();
      } else {
        // Navigate to Google search for Workday jobs
        await this.navigateToGoogleSearch();
      }

    } catch (error) {
      this.reportError(error, { phase: 'start' });
    }
  }

  async navigateToGoogleSearch() {
    const searchUrl = `https://www.google.com/search?q=site:myworkdayjobs.com+${encodeURIComponent(this.searchQuery)}`;
    this.log(`📍 Navigating to Google search: ${searchUrl}`);
    
    await this.navigateToUrl(searchUrl);
    await this.waitForPageLoad();
    await this.handleGoogleSearchPage();
  }

  async handleGoogleSearchPage() {
    this.log('🔍 Processing Google search results for Workday jobs');

    // Wait for search results
    await this.waitForElement('#search, .g');

    // Start automation loop for Google search results
    await this.googleSearchLoop();
  }

  async googleSearchLoop() {
    while (this.isRunning && this.progress.completed < this.progress.total) {
      if (this.isPaused) {
        await this.delay(1000);
        continue;
      }

      try {
        // Get Workday job links from current search page
        const jobLinks = await this.getWorkdayJobLinks();
        
        if (jobLinks.length === 0) {
          this.log('❌ No Workday job links found on this page');
          break;
        }

        // Process each job link
        for (const jobLink of jobLinks) {
          if (!this.isRunning || this.progress.completed >= this.progress.total) {
            break;
          }

          if (this.isPaused) {
            await this.delay(1000);
            continue;
          }

          await this.processJobFromSearch(jobLink);
        }

        // Go to next page of search results
        const hasNextPage = await this.goToNextSearchPage();
        if (!hasNextPage) {
          this.log('📄 No more search result pages');
          break;
        }

      } catch (error) {
        this.reportError(error, { phase: 'googleSearchLoop' });
        await this.delay(5000);
      }
    }

    this.reportComplete();
  }

  async getWorkdayJobLinks() {
    // Find all Google search result links that point to myworkdayjobs.com
    const searchResults = this.findElements('#search .g a[href*="myworkdayjobs.com"]');
    
    const jobLinks = [];
    
    for (const link of searchResults) {
      const href = link.href;
      
      // Filter for actual job pages
      if (href.includes('/job/') || 
          href.includes('/jobs/') ||
          href.includes('/en-us/') ||
          href.includes('/job-details/') ||
          href.includes('/position/')) {
        
        // Avoid duplicates
        if (!this.processedUrls.has(href)) {
          const title = link.textContent?.trim() || 'Unknown Job';
          
          jobLinks.push({
            url: href,
            title: title,
            source: 'google_search'
          });
          
          this.processedUrls.add(href);
        }
      }
    }
    
    this.log(`📊 Found ${jobLinks.length} new Workday job links`);
    return jobLinks.slice(0, 8); // Limit to first 8 per page
  }

  async processJobFromSearch(jobLink) {
    try {
      this.updateProgress({
        current: `Processing: ${jobLink.title}`
      });

      // Check if already applied
      if (this.shouldSkipJob(jobLink.url)) {
        this.log(`⏭️ Skipping already applied job: ${jobLink.title}`);
        this.progress.skipped++;
        this.updateProgress({ skipped: this.progress.skipped });
        return;
      }

      // Navigate to job page
      this.log(`🔗 Opening job: ${jobLink.url}`);
      await this.navigateToUrl(jobLink.url);
      await this.waitForPageLoad();
      await this.delay(3000);

      // Now we're on the Workday job page
      await this.handleWorkdayPage();

    } catch (error) {
      this.reportError(error, { jobLink });
      this.progress.failed++;
      this.updateProgress({ failed: this.progress.failed });
    }

    // Delay between job applications
    await this.delay(this.getRandomDelay(5000, 10000));
  }

  async handleWorkdayPage() {
    this.log('🏢 Processing Workday job page');

    try {
      // Extract job data from the page
      const jobData = await this.extractWorkdayJobData();
      
      // Look for apply button
      const applyButton = this.findWorkdayApplyButton();
      
      if (!applyButton) {
        this.log(`⏭️ No apply button found for: ${jobData.title}`);
        this.progress.skipped++;
        this.updateProgress({ skipped: this.progress.skipped });
        return;
      }

      // Apply to the job
      const applied = await this.applyToWorkdayJob(jobData);
      if (applied) {
        this.reportApplicationSubmitted(jobData, { method: 'Workday Application' });
      } else {
        this.progress.failed++;
        this.updateProgress({ failed: this.progress.failed });
      }

    } catch (error) {
      this.reportError(error, { action: 'handleWorkdayPage' });
      this.progress.failed++;
      this.updateProgress({ failed: this.progress.failed });
    }
  }

  findWorkdayApplyButton() {
    const applySelectors = [
      'button[data-automation-id*="apply"]',
      'a[data-automation-id*="apply"]',
      'button[aria-label*="Apply"]',
      'button[title*="Apply"]',
      '.css-1psaude button',
      '[data-automation-id="applyToJob"]',
      'button[type="submit"]'
    ];

    for (const selector of applySelectors) {
      const button = this.findElement(selector);
      if (button) {
        const buttonText = button.textContent?.toLowerCase() || '';
        const ariaLabel = button.getAttribute('aria-label')?.toLowerCase() || '';
        
        if (buttonText.includes('apply') || 
            ariaLabel.includes('apply') ||
            button.getAttribute('data-automation-id')?.includes('apply')) {
          return button;
        }
      }
    }

    return null;
  }

  async extractWorkdayJobData() {
    // Try multiple selectors for job data extraction
    const titleSelectors = [
      'h1[data-automation-id="jobPostingHeader"]',
      'h1',
      '[data-automation-id="jobTitle"]',
      '.css-cygeeu'
    ];

    const companySelectors = [
      '[data-automation-id="company"]',
      '.company-name',
      '.css-1cxmrzs'
    ];

    const locationSelectors = [
      '[data-automation-id="locations"]',
      '[data-automation-id="location"]',
      '.css-k008qs'
    ];

    // Fallback: extract company from URL
    let company = this.extractText(companySelectors);
    if (!company || company === 'Unknown Company') {
      const urlMatch = window.location.hostname.match(/([^.]+)\.myworkdayjobs\.com/);
      if (urlMatch) {
        company = urlMatch[1].charAt(0).toUpperCase() + urlMatch[1].slice(1);
      }
    }

    return {
      title: this.extractText(titleSelectors) || 'Unknown Title',
      company: company || 'Unknown Company',
      location: this.extractText(locationSelectors) || 'Unknown Location',
      url: window.location.href,
      platform: 'workday',
      extractedAt: Date.now()
    };
  }

  async applyToWorkdayJob(jobData) {
    try {
      this.log(`📝 Applying to: ${jobData.title} at ${jobData.company}`);

      // Find and click apply button
      const applyButton = this.findWorkdayApplyButton();
      if (!applyButton) {
        throw new Error('Apply button not found');
      }

      // Click apply button
      applyButton.click();
      await this.delay(3000);

      // Handle Workday application flow
      let step = 1;
      const maxSteps = 10;

      while (step <= maxSteps) {
        this.log(`📋 Processing Workday step ${step}`);

        // Fill form fields
        await this.fillWorkdayForm();

        // Look for continue/submit button
        const actionButton = this.findWorkdayActionButton();
        
        if (!actionButton) {
          this.log('No action button found, checking if completed');
          break;
        }

        const isSubmitButton = this.isWorkdaySubmitButton(actionButton);
        
        // Click the button
        actionButton.click();
        await this.delay(2000);

        if (isSubmitButton) {
          this.log('✅ Workday application submitted');
          return true;
        }

        step++;
      }

      // Check if we completed successfully
      return await this.checkWorkdayApplicationSuccess();

    } catch (error) {
      this.log(`❌ Failed to apply: ${error.message}`);
      return false;
    }
  }

  findWorkdayActionButton() {
    const buttonSelectors = [
      'button[data-automation-id*="continueButton"]',
      'button[data-automation-id*="submitButton"]',
      'button[data-automation-id*="nextButton"]',
      'button[aria-label*="Continue"]',
      'button[aria-label*="Submit"]',
      'button[type="submit"]'
    ];

    for (const selector of buttonSelectors) {
      const button = this.findElement(selector);
      if (button && !button.disabled) {
        return button;
      }
    }

    // Look for buttons with relevant text
    const buttons = this.findElements('button');
    for (const button of buttons) {
      const text = button.textContent?.toLowerCase() || '';
      const automationId = button.getAttribute('data-automation-id') || '';
      
      if ((text.includes('continue') || text.includes('next') || text.includes('submit')) && 
          !button.disabled && 
          !automationId.includes('cancel')) {
        return button;
      }
    }

    return null;
  }

  isWorkdaySubmitButton(button) {
    const buttonText = button.textContent?.toLowerCase() || '';
    const ariaLabel = button.getAttribute('aria-label')?.toLowerCase() || '';
    const automationId = button.getAttribute('data-automation-id')?.toLowerCase() || '';
    
    return buttonText.includes('submit') || 
           ariaLabel.includes('submit') ||
           automationId.includes('submit') ||
           button.type === 'submit';
  }

  async fillWorkdayForm() {
    const formData = this.config.preferences || {};
    
    // Use base platform form filling
    const result = await this.fillForm(formData);
    this.log(`📝 Filled ${result.fieldsFilled}/${result.fieldsFound} form fields`);

    // Handle Workday-specific fields using data-automation-id
    await this.handleWorkdaySpecificFields(formData);
  }

  async handleWorkdaySpecificFields(formData) {
    // Workday uses data-automation-id attributes extensively
    const workdayFields = [
      {
        selector: '[data-automation-id*="firstName"]',
        value: formData.firstName
      },
      {
        selector: '[data-automation-id*="lastName"]',
        value: formData.lastName
      },
      {
        selector: '[data-automation-id*="email"]',
        value: formData.email
      },
      {
        selector: '[data-automation-id*="phone"]',
        value: formData.phone
      }
    ];

    for (const field of workdayFields) {
      const element = this.findElement(field.selector);
      if (element && field.value) {
        const input = element.querySelector('input') || element;
        if (input.tagName === 'INPUT') {
          await this.fillTextField(input, field.value);
        }
      }
    }

    // Handle file uploads
    this.highlightWorkdayFileUploads();

    // Handle dropdowns and complex fields
    await this.handleWorkdayDropdowns(formData);
  }

  highlightWorkdayFileUploads() {
    const fileUploadSelectors = [
      '[data-automation-id*="file-upload"]',
      '[data-automation-id*="resume"]',
      'input[type="file"]'
    ];

    for (const selector of fileUploadSelectors) {
      const elements = this.findElements(selector);
      elements.forEach(element => {
        const fileInput = element.querySelector('input[type="file"]') || element;
        
        if (fileInput.type === 'file') {
          fileInput.style.border = '3px solid #FF9800';
          fileInput.style.boxShadow = '0 0 10px #FF9800';
          
          // Add tooltip
          const tooltip = document.createElement('div');
          tooltip.textContent = 'Please upload your resume here';
          tooltip.style.cssText = `
            position: absolute;
            background: #FF9800;
            color: white;
            padding: 4px 8px;
            border-radius: 4px;
            font-size: 12px;
            z-index: 10000;
            pointer-events: none;
          `;
          
          const rect = fileInput.getBoundingClientRect();
          tooltip.style.top = (rect.top - 30) + 'px';
          tooltip.style.left = rect.left + 'px';
          
          document.body.appendChild(tooltip);
          
          setTimeout(() => {
            fileInput.style.border = '';
            fileInput.style.boxShadow = '';
            tooltip.remove();
          }, 10000);
        }
      });
    }
  }

  async handleWorkdayDropdowns(formData) {
    // Handle common Workday dropdowns
    const dropdowns = this.findElements('[data-automation-id*="dropdown"]');
    
    for (const dropdown of dropdowns) {
      const automationId = dropdown.getAttribute('data-automation-id') || '';
      
      if (automationId.includes('country') && formData.country) {
        await this.selectWorkdayDropdownOption(dropdown, formData.country);
      } else if (automationId.includes('state') && formData.state) {
        await this.selectWorkdayDropdownOption(dropdown, formData.state);
      }
    }
  }

  async selectWorkdayDropdownOption(dropdown, value) {
    try {
      // Click dropdown to open
      dropdown.click();
      await this.delay(500);

      // Look for options
      const options = this.findElements('[data-automation-id*="option"]');
      
      for (const option of options) {
        const optionText = option.textContent?.toLowerCase() || '';
        if (optionText.includes(value.toLowerCase())) {
          option.click();
          await this.delay(500);
          break;
        }
      }
    } catch (error) {
      this.log(`⚠️ Failed to select dropdown option: ${error.message}`);
    }
  }

  async checkWorkdayApplicationSuccess() {
    // Wait for potential confirmation page
    await this.delay(3000);

    // Check for success indicators
    const successSelectors = [
      '[data-automation-id*="confirmation"]',
      '[data-automation-id*="success"]',
      '.css-1dbjc4n[role="main"] h1',
      '.css-cygeeu'
    ];

    for (const selector of successSelectors) {
      const element = this.findElement(selector);
      if (element) {
        const text = element.textContent?.toLowerCase() || '';
        if (text.includes('thank') || text.includes('submitted') || text.includes('received')) {
          return true;
        }
      }
    }

    // Check URL for confirmation
    if (window.location.href.includes('confirmation') || 
        window.location.href.includes('thank') ||
        window.location.href.includes('submitted')) {
      return true;
    }

    return false;
  }

  async goToNextSearchPage() {
    try {
      // Look for next page button in Google search
      const nextButton = this.findElement('a[id="pnnext"], a[aria-label="Next"]');
      
      if (!nextButton) {
        return false;
      }

      // Click next page
      nextButton.click();
      await this.delay(3000);
      
      // Wait for new search results
      await this.waitForElement('#search, .g');

      this.currentPageIndex++;
      this.log(`📄 Navigated to search results page ${this.currentPageIndex + 1}`);

      return true;

    } catch (error) {
      this.reportError(error, { action: 'goToNextSearchPage' });
      return false;
    }
  }

  // Handle DOM changes (called by content script)
  onDOMChange() {
    // Re-scan for jobs if we're on Google search
    if (this.isRunning && !this.isPaused && window.location.href.includes('google.com')) {
      setTimeout(() => {
        this.getWorkdayJobLinks().catch(console.error);
      }, 1000);
    }
  }

  // Handle navigation (called by content script)
  onNavigation(oldUrl, newUrl) {
    this.log(`🔄 Navigation detected: ${oldUrl} → ${newUrl}`);
    
    // Handle transitions between Google search and Workday pages
    if (newUrl.includes('myworkdayjobs.com') && oldUrl.includes('google.com')) {
      this.log('📍 Navigated from Google search to Workday job page');
    } else if (newUrl.includes('google.com') && oldUrl.includes('myworkdayjobs.com')) {
      this.log('📍 Navigated back to Google search from Workday');
    }
  }
}