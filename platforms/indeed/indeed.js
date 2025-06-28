// platforms/indeed/indeed.js
import BasePlatform from '../base-platform.js';

export default class IndeedPlatform extends BasePlatform {
  constructor(config) {
    super(config);
    this.platform = 'indeed';
    this.baseUrl = 'https://www.indeed.com';
    this.jobsOnCurrentPage = [];
    this.currentPageIndex = 0;
  }

  async initialize() {
    await super.initialize();
    this.log('🔍 Indeed platform initialized');
  }

  async start(params = {}) {
    this.isRunning = true;
    this.log('🚀 Starting Indeed automation');

    try {
      // Update config with any new parameters
      this.config = { ...this.config, ...params };

      // Ensure DOM is ready
      if (document.readyState !== 'complete') {
        this.log('⏳ Waiting for DOM to be ready...');
        await this.waitForPageLoad();
      }

      this.log('📍 Current URL: ' + window.location.href);

      // Navigate to Indeed if not already there
      if (!window.location.href.includes('indeed.com')) {
        await this.navigateToUrl(`${this.baseUrl}/jobs?q=software+engineer`);
        await this.waitForPageLoad();
      }

      // Wait for job cards to load
      await this.waitForElement('[data-jk], .job_seen_beacon', 15000);

      // Apply filters for easier applications
      await this.applySearchFilters();

      // Start the main automation loop
      await this.automationLoop();

    } catch (error) {
      this.reportError(error, { phase: 'start' });
    }
  }

  async automationLoop() {
    while (this.isRunning && this.progress.completed < this.progress.total) {
      if (this.isPaused) {
        await this.delay(1000);
        continue;
      }

      try {
        // Load jobs on current page
        await this.loadJobsOnPage();

        // Process jobs on current page
        for (const job of this.jobsOnCurrentPage) {
          if (!this.isRunning || this.progress.completed >= this.progress.total) {
            break;
          }

          if (this.isPaused) {
            await this.delay(1000);
            continue;
          }

          await this.processJob(job);
        }

        // Navigate to next page
        const hasNextPage = await this.goToNextPage();
        if (!hasNextPage) {
          this.log('📄 No more pages available');
          break;
        }

      } catch (error) {
        this.reportError(error, { phase: 'automationLoop' });
        await this.delay(5000);
      }
    }

    this.reportComplete();
  }

  async loadJobsOnPage() {
    this.log('📋 Loading jobs on current page');

    // Wait for job cards to load
    await this.waitForElement('[data-jk], .job_seen_beacon');

    // Get all job cards using multiple possible selectors
    const jobCardSelectors = [
      '[data-jk]',
      '.job_seen_beacon',
      '.jobsearch-SerpJobCard',
      '.slider_container .slider_item'
    ];

    let jobCards = [];
    for (const selector of jobCardSelectors) {
      jobCards = this.findElements(selector);
      if (jobCards.length > 0) break;
    }

    this.jobsOnCurrentPage = jobCards.map((card, index) => {
      const titleElement = card.querySelector('h2 a span[title], .jobTitle a span[title], h2 a') ||
                          card.querySelector('[data-testid="job-title"] a');
      const companyElement = card.querySelector('[data-testid="company-name"], .companyName') ||
                            card.querySelector('span[data-testid="company-name"]');
      const locationElement = card.querySelector('[data-testid="job-location"], .companyLocation') ||
                             card.querySelector('div[data-testid="job-location"]');
      const linkElement = card.querySelector('h2 a, .jobTitle a') ||
                         card.querySelector('[data-testid="job-title"] a');

      return {
        index,
        element: card,
        jobKey: card.getAttribute('data-jk') || index,
        title: titleElement?.getAttribute('title') || titleElement?.textContent?.trim() || 'Unknown Title',
        company: companyElement?.textContent?.trim() || 'Unknown Company',
        location: locationElement?.textContent?.trim() || 'Unknown Location',
        url: linkElement?.href || window.location.href
      };
    });

    this.log(`📊 Found ${this.jobsOnCurrentPage.length} jobs on current page`);
  }

  async processJob(jobData) {
    try {
      this.updateProgress({
        current: `Processing: ${jobData.title} at ${jobData.company}`
      });

      // Check if we should skip this job
      if (this.shouldSkipJob(jobData.url)) {
        this.log(`⏭️ Skipping already applied job: ${jobData.title}`);
        this.progress.skipped++;
        this.updateProgress({ skipped: this.progress.skipped });
        return;
      }

      // Click on job to open details
      const clicked = await this.clickJobCard(jobData);
      if (!clicked) {
        throw new Error('Failed to click job card');
      }

      // Wait for job details to load
      await this.delay(2000);

      // Check for Indeed Apply or easy application
      const applicationMethod = await this.checkApplicationMethod();

      if (!applicationMethod) {
        this.log(`⏭️ No easy application method for: ${jobData.title}`);
        this.progress.skipped++;
        this.updateProgress({ skipped: this.progress.skipped });
        return;
      }

      // Apply to the job
      const applied = await this.applyToJob(jobData, applicationMethod);
      if (applied) {
        this.reportApplicationSubmitted(jobData, { method: applicationMethod });
      } else {
        this.progress.failed++;
        this.updateProgress({ failed: this.progress.failed });
      }

    } catch (error) {
      this.reportError(error, { job: jobData });
      this.progress.failed++;
      this.updateProgress({ failed: this.progress.failed });
    }

    // Delay between applications
    await this.delay(this.getRandomDelay(3000, 8000));
  }

  async clickJobCard(jobData) {
    try {
      const jobCard = jobData.element;
      
      // Scroll job card into view
      this.scrollToElement(jobCard);
      await this.delay(500);

      // Try different click targets
      const clickTargets = [
        jobCard.querySelector('h2 a'),
        jobCard.querySelector('.jobTitle a'),
        jobCard.querySelector('[data-testid="job-title"] a'),
        jobCard
      ];

      for (const target of clickTargets) {
        if (target) {
          target.click();
          await this.delay(1000);
          return true;
        }
      }

      return false;
    } catch (error) {
      this.reportError(error, { action: 'clickJobCard', job: jobData });
      return false;
    }
  }

  async checkApplicationMethod() {
    // Check for Indeed Apply button
    const indeedApplySelectors = [
      'button[aria-label*="Apply"], button[data-testid*="apply"]',
      '.ia-ApplyButton',
      '.jobsearch-IndeedApplyButton',
      'button[data-tn-element="applyButton"]'
    ];

    for (const selector of indeedApplySelectors) {
      const button = this.findElement(selector);
      if (button) {
        const buttonText = button.textContent?.toLowerCase() || '';
        if (buttonText.includes('apply now') || buttonText.includes('indeed apply')) {
          return 'Indeed Apply';
        }
      }
    }

    // Check for other apply buttons
    const applyButtons = this.findElements('button, a');
    for (const button of applyButtons) {
      const text = button.textContent?.toLowerCase() || '';
      if (text.includes('apply') && !text.includes('save') && !text.includes('applied')) {
        return 'Quick Apply';
      }
    }

    return null;
  }

  async applyToJob(jobData, method) {
    try {
      this.log(`📝 Applying to: ${jobData.title} at ${jobData.company} via ${method}`);

      if (method === 'Indeed Apply') {
        return await this.handleIndeedApply(jobData);
      } else {
        return await this.handleQuickApply(jobData);
      }

    } catch (error) {
      this.log(`❌ Failed to apply: ${error.message}`);
      return false;
    }
  }

  async handleIndeedApply(jobData) {
    try {
      // Click Indeed Apply button
      const applyButtonSelectors = [
        'button[aria-label*="Apply"]',
        'button[data-testid*="apply"]',
        '.ia-ApplyButton',
        '.jobsearch-IndeedApplyButton'
      ];

      let applyButton = null;
      for (const selector of applyButtonSelectors) {
        applyButton = this.findElement(selector);
        if (applyButton) break;
      }

      if (!applyButton) {
        throw new Error('Indeed Apply button not found');
      }

      applyButton.click();
      await this.delay(3000);

      // Handle multi-step application
      let attempts = 0;
      const maxAttempts = 5;

      while (attempts < maxAttempts) {
        // Fill any form fields
        await this.fillIndeedApplicationForm();

        // Look for continue/submit button
        const actionButton = this.findActionButton();
        if (!actionButton) {
          this.log('No action button found, checking if completed');
          break;
        }

        const isSubmitButton = this.isSubmitButton(actionButton);
        actionButton.click();
        await this.delay(2000);

        if (isSubmitButton) {
          // Check for success
          const success = await this.checkApplicationSuccess();
          if (success) {
            this.log('✅ Application submitted via Indeed Apply');
            return true;
          }
        }

        attempts++;
      }

      // Check final status
      return await this.checkApplicationSuccess();

    } catch (error) {
      this.log(`❌ Indeed Apply failed: ${error.message}`);
      return false;
    }
  }

  async handleQuickApply(jobData) {
    try {
      // Click apply button
      const applyButtons = this.findElements('button, a');
      let clicked = false;

      for (const button of applyButtons) {
        const text = button.textContent?.toLowerCase() || '';
        if (text.includes('apply') && !text.includes('save')) {
          button.click();
          clicked = true;
          break;
        }
      }

      if (!clicked) {
        throw new Error('Failed to click apply button');
      }

      await this.delay(2000);

      // Check if redirected to external site
      const isExternal = !window.location.href.includes('indeed.com');

      if (isExternal) {
        // Try to find and fill application form on external site
        await this.fillExternalApplicationForm();
        
        // Look for submit button
        const submitted = this.submitExternalForm();
        
        if (submitted) {
          this.log('✅ Application submitted via external site');
          return true;
        }
      }

      return false;

    } catch (error) {
      this.log(`❌ Quick Apply failed: ${error.message}`);
      return false;
    }
  }

  findActionButton() {
    const buttonSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button[aria-label*="Continue"]',
      'button[aria-label*="Submit"]',
      'button[data-testid*="continue"]',
      'button[data-testid*="submit"]'
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
      if ((text.includes('continue') || text.includes('submit') || text.includes('send')) && !button.disabled) {
        return button;
      }
    }

    return null;
  }

  isSubmitButton(button) {
    const buttonText = button.textContent?.toLowerCase() || '';
    const ariaLabel = button.getAttribute('aria-label')?.toLowerCase() || '';
    
    return buttonText.includes('submit') || 
           buttonText.includes('send') ||
           ariaLabel.includes('submit') ||
           ariaLabel.includes('send') ||
           button.type === 'submit';
  }

  async fillIndeedApplicationForm() {
    const formData = this.config.preferences || {};

    // Use base platform form filling
    const result = await this.fillForm(formData);
    this.log(`📝 Filled ${result.fieldsFilled}/${result.fieldsFound} form fields`);

    // Handle Indeed-specific fields
    await this.handleIndeedSpecificFields(formData);
  }

  async handleIndeedSpecificFields(formData) {
    // Handle Yes/No questions common on Indeed
    const questions = [
      { 
        keywords: ['authorized to work', 'work authorization'], 
        value: formData.workAuthorization || 'yes'
      },
      { 
        keywords: ['require sponsorship', 'visa sponsorship'], 
        value: formData.visaSponsorship || 'no'
      },
      { 
        keywords: ['background check'], 
        value: 'yes'
      }
    ];

    for (const question of questions) {
      await this.handleYesNoQuestion(question.keywords, question.value);
    }

    // Handle file uploads
    this.highlightFileUploads();
  }

  async handleYesNoQuestion(keywords, value) {
    const radioButtons = this.findElements('input[type="radio"]');
    
    for (const radio of radioButtons) {
      const label = radio.closest('label') || radio.parentElement;
      const questionText = label?.textContent?.toLowerCase() || '';
      
      const isRelevantQuestion = keywords.some(keyword => 
        questionText.includes(keyword.toLowerCase())
      );
      
      if (isRelevantQuestion) {
        const answerText = radio.value?.toLowerCase() || label?.textContent?.toLowerCase() || '';
        
        if ((value === 'yes' && (answerText.includes('yes') || answerText.includes('true'))) ||
            (value === 'no' && (answerText.includes('no') || answerText.includes('false')))) {
          radio.checked = true;
          radio.dispatchEvent(new Event('change', { bubbles: true }));
          break;
        }
      }
    }
  }

  highlightFileUploads() {
    const fileInputs = this.findElements('input[type="file"]');
    fileInputs.forEach(input => {
      input.style.border = '3px solid #FF9800';
      input.style.boxShadow = '0 0 10px #FF9800';
      
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
      
      const rect = input.getBoundingClientRect();
      tooltip.style.top = (rect.top - 30) + 'px';
      tooltip.style.left = rect.left + 'px';
      
      document.body.appendChild(tooltip);
      
      setTimeout(() => {
        input.style.border = '';
        input.style.boxShadow = '';
        tooltip.remove();
      }, 10000);
    });
  }

  async fillExternalApplicationForm() {
    const formData = this.config.preferences || {};

    // Generic form filling for external sites
    const inputs = this.findElements('input[type="text"], input[type="email"], input[type="tel"], textarea');
    
    inputs.forEach(input => {
      const fieldContext = [
        input.name?.toLowerCase() || '',
        input.id?.toLowerCase() || '',
        input.placeholder?.toLowerCase() || '',
        input.closest('label')?.textContent?.toLowerCase() || ''
      ].join(' ');
      
      // Fill based on field context
      if (fieldContext.includes('first name') && formData.firstName) {
        this.fillTextField(input, formData.firstName);
      } else if (fieldContext.includes('last name') && formData.lastName) {
        this.fillTextField(input, formData.lastName);
      } else if (fieldContext.includes('email') && formData.email) {
        this.fillTextField(input, formData.email);
      } else if (fieldContext.includes('phone') && formData.phone) {
        this.fillTextField(input, formData.phone);
      } else if (input.tagName === 'TEXTAREA' && formData.coverLetter) {
        this.fillTextField(input, formData.coverLetter);
      }
    });
  }

  submitExternalForm() {
    const submitButtons = this.findElements('button[type="submit"], input[type="submit"]');
    if (submitButtons.length > 0) {
      submitButtons[0].click();
      return true;
    }
    return false;
  }

  async checkApplicationSuccess() {
    // Wait a bit for any redirects or confirmations
    await this.delay(2000);

    // Check for success indicators
    const successSelectors = [
      '.ia-BasePage-sidebar .ia-ApplyForm-success',
      '[data-testid="application-complete"]',
      '.application-confirmation'
    ];

    for (const selector of successSelectors) {
      if (this.findElement(selector)) {
        return true;
      }
    }

    // Check page content for success messages
    const pageText = document.body.textContent?.toLowerCase() || '';
    const successKeywords = [
      'application submitted',
      'thank you for applying',
      'application received',
      'successfully applied'
    ];
    
    return successKeywords.some(keyword => pageText.includes(keyword));
  }

  async goToNextPage() {
    try {
      // Look for next page button
      const nextPageSelectors = [
        'a[aria-label="Next Page"]',
        'a[aria-label="Next"]',
        '.np:last-child'
      ];

      let nextButton = null;
      for (const selector of nextPageSelectors) {
        nextButton = this.findElement(selector);
        if (nextButton) break;
      }

      if (!nextButton) {
        return false;
      }

      // Click next page
      nextButton.click();
      await this.delay(3000);

      // Wait for new page to load
      await this.waitForElement('[data-jk], .job_seen_beacon');

      this.currentPageIndex++;
      this.log(`📄 Navigated to page ${this.currentPageIndex + 1}`);

      return true;

    } catch (error) {
      this.reportError(error, { action: 'goToNextPage' });
      return false;
    }
  }

  async applySearchFilters() {
    try {
      this.log('🔍 Applying Indeed search filters');
      
      // Could add specific filters here if needed
      // For now, just log that we're ready
      
    } catch (error) {
      this.log('⚠️ Failed to apply filters, continuing anyway');
    }
  }

  // Handle DOM changes (called by content script)
  onDOMChange() {
    // Re-scan for jobs if we're in the middle of automation
    if (this.isRunning && !this.isPaused) {
      setTimeout(() => {
        this.loadJobsOnPage().catch(console.error);
      }, 1000);
    }
  }

  // Handle navigation (called by content script)
  onNavigation(oldUrl, newUrl) {
    this.log(`🔄 Navigation detected: ${oldUrl} → ${newUrl}`);
    
    // If we navigated away from Indeed, try to go back
    if (!newUrl.includes('indeed.com') && this.isRunning) {
      setTimeout(() => {
        this.navigateToUrl(`${this.baseUrl}/jobs?q=software+engineer`);
      }, 2000);
    }
  }
}