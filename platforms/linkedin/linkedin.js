// platforms/linkedin/linkedin.js
import BasePlatform from '../base-platform.js';

export default class LinkedInPlatform extends BasePlatform {
  constructor(config) {
    super(config);
    this.platform = 'linkedin';
    this.baseUrl = 'https://www.linkedin.com';
    this.jobsProcessed = 0;
    this.jobsOnCurrentPage = [];
    this.currentPageIndex = 0;
  }

  async initialize() {
    await super.initialize();
    this.log('🔗 LinkedIn platform initialized');
  }

  async start(params = {}) {
    this.isRunning = true;
    this.log('🚀 Starting LinkedIn automation');

    try {
      // Update config with any new parameters
      this.config = { ...this.config, ...params };

      // Wait for page to be ready
      await this.waitForPageLoad();

      // Navigate to LinkedIn Jobs if not already there
      if (!window.location.href.includes('linkedin.com/jobs')) {
        this.log('📍 Navigating to LinkedIn Jobs');
        await this.navigateToUrl(`${this.baseUrl}/jobs/search/`);
        await this.waitForPageLoad();
      }

      // Wait for job search results to load
      await this.waitForElement('.jobs-search-results-list, .jobs-search__results-list');

      // Apply filters if needed
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
        await this.delay(5000); // Wait before retrying
      }
    }

    this.reportComplete();
  }

  async loadJobsOnPage() {
    this.log('📋 Loading jobs on current page');

    // Wait for job list to load
    await this.waitForElement('.jobs-search-results-list, .jobs-search__results-list');

    // Get all job cards using multiple possible selectors
    const jobCardSelectors = [
      '.jobs-search-results__list-item',
      '.jobs-search__results-list .jobs-search-result',
      '.job-card-container',
      '[data-job-id]'
    ];

    let jobCards = [];
    for (const selector of jobCardSelectors) {
      jobCards = this.findElements(selector);
      if (jobCards.length > 0) break;
    }

    this.jobsOnCurrentPage = jobCards.map((card, index) => {
      const titleElement = card.querySelector('.job-card-list__title a, .job-card__title a, .sr-only') || 
                          card.querySelector('a[data-control-name="job_card_title"]');
      const companyElement = card.querySelector('.job-card-container__company-name, .job-card__company-name') ||
                            card.querySelector('[data-control-name="job_card_company_link"]');
      const locationElement = card.querySelector('.job-card-container__metadata-item, .job-card__location');

      return {
        index,
        element: card,
        title: titleElement?.textContent?.trim() || 'Unknown Title',
        company: companyElement?.textContent?.trim() || 'Unknown Company',
        location: locationElement?.textContent?.trim() || 'Unknown Location',
        url: titleElement?.href || window.location.href,
        jobId: card.getAttribute('data-job-id') || index
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
      await this.waitForElement('.jobs-details, .job-details-module');
      await this.delay(2000); // Additional wait for full load

      // Check if Easy Apply is available
      const hasEasyApply = this.findElement('.jobs-apply-button[aria-label*="Easy Apply"], .jobs-apply-button--top-card');

      if (!hasEasyApply) {
        this.log(`⏭️ No Easy Apply available for: ${jobData.title}`);
        this.progress.skipped++;
        this.updateProgress({ skipped: this.progress.skipped });
        return;
      }

      // Apply to the job
      const applied = await this.applyToJob(jobData);
      if (applied) {
        this.reportApplicationSubmitted(jobData, { method: 'Easy Apply' });
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
    await this.delay(this.getRandomDelay(3000, 7000));
  }

  async clickJobCard(jobData) {
    try {
      const jobCard = jobData.element;
      
      // Scroll job card into view
      this.scrollToElement(jobCard);
      await this.delay(500);

      // Try different click targets
      const clickTargets = [
        jobCard.querySelector('.job-card-list__title a'),
        jobCard.querySelector('.job-card__title a'),
        jobCard.querySelector('a[data-control-name="job_card_title"]'),
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

  async applyToJob(jobData) {
    try {
      this.log(`📝 Applying to: ${jobData.title} at ${jobData.company}`);

      // Click Easy Apply button
      const applyButton = this.findElement('.jobs-apply-button[aria-label*="Easy Apply"], .jobs-apply-button--top-card');
      if (!applyButton) {
        throw new Error('Easy Apply button not found');
      }

      applyButton.click();
      await this.delay(2000);

      // Wait for application modal
      await this.waitForElement('.jobs-easy-apply-modal, .jobs-easy-apply-content');

      // Handle multi-step application process
      let step = 1;
      const maxSteps = 10;

      while (step <= maxSteps) {
        this.log(`📋 Processing application step ${step}`);

        // Check if we're on a form page
        const hasForm = this.findElement('.jobs-easy-apply-modal form, .jobs-easy-apply-content form');

        if (hasForm) {
          // Fill form fields
          await this.fillApplicationForm();
        }

        // Look for next/submit button
        const nextButton = this.findNextSubmitButton();

        if (!nextButton) {
          this.log('❌ No next/submit button found');
          break;
        }

        // Check if this is the submit button
        const isSubmitButton = this.isSubmitButton(nextButton);

        // Click the button
        nextButton.click();
        await this.delay(2000);

        // If it was submit button, check for confirmation
        if (isSubmitButton) {
          const isSubmitted = await this.checkSubmissionSuccess();
          if (isSubmitted) {
            this.log('✅ Application submitted successfully');
            return true;
          }
        }

        step++;
      }

      throw new Error('Application process exceeded maximum steps');

    } catch (error) {
      this.log(`❌ Failed to apply: ${error.message}`);
      
      // Close modal if still open
      const closeButton = this.findElement('.jobs-easy-apply-modal [aria-label="Dismiss"], .artdeco-modal__dismiss');
      if (closeButton) {
        closeButton.click();
      }
      
      return false;
    }
  }

  findNextSubmitButton() {
    const buttonSelectors = [
      '.jobs-easy-apply-modal footer button[aria-label*="Continue"]',
      '.jobs-easy-apply-modal footer button[aria-label*="Submit"]',
      '.jobs-easy-apply-modal footer button[aria-label*="Send"]',
      '.jobs-easy-apply-modal footer button.artdeco-button--primary',
      '.jobs-easy-apply-content footer button[aria-label*="Continue"]',
      '.jobs-easy-apply-content footer button[aria-label*="Submit"]'
    ];

    for (const selector of buttonSelectors) {
      const button = this.findElement(selector);
      if (button && !button.disabled) {
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
           ariaLabel.includes('send');
  }

  async checkSubmissionSuccess() {
    // Wait a bit for potential redirect or confirmation
    await this.delay(2000);

    // Check for success indicators
    const successSelectors = [
      '.jobs-easy-apply-confirmation',
      '[data-test-modal-id="easy-apply-success-modal"]',
      '.artdeco-inline-feedback--success'
    ];

    for (const selector of successSelectors) {
      if (this.findElement(selector)) {
        return true;
      }
    }

    // Check if modal is gone (might indicate success)
    const modal = this.findElement('.jobs-easy-apply-modal, .jobs-easy-apply-content');
    return !modal;
  }

  async fillApplicationForm() {
    // Get form data from config
    const formData = this.config.preferences || {};

    // Fill the form using base platform method
    const result = await this.fillForm(formData);
    
    this.log(`📝 Filled ${result.fieldsFilled}/${result.fieldsFound} form fields`);

    // Handle LinkedIn-specific fields
    await this.handleLinkedInSpecificFields(formData);
  }

  async handleLinkedInSpecificFields(formData) {
    // Phone number
    const phoneInput = this.findElement('input[id*="phone"], input[name*="phone"]');
    if (phoneInput && formData.phone) {
      await this.fillTextField(phoneInput, formData.phone);
    }

    // Cover letter
    const coverLetterTextarea = this.findElement('textarea[id*="cover"], textarea[name*="cover"]');
    if (coverLetterTextarea && formData.coverLetter) {
      await this.fillTextField(coverLetterTextarea, formData.coverLetter);
    }

    // Handle Yes/No questions
    const radioButtons = this.findElements('input[type="radio"]');
    radioButtons.forEach(radio => {
      const label = radio.closest('label') || radio.parentElement;
      const text = label?.textContent?.toLowerCase() || '';
      
      if (text.includes('authorized to work') && formData.workAuthorization) {
        if ((formData.workAuthorization === 'yes' && text.includes('yes')) ||
            (formData.workAuthorization === 'no' && text.includes('no'))) {
          radio.checked = true;
          radio.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
    });
  }

  async goToNextPage() {
    try {
      // Look for next page button
      const nextButton = this.findElement('.jobs-search-pagination__button--next, .artdeco-pagination__button--next');
      
      if (!nextButton || nextButton.disabled) {
        return false;
      }

      // Click next page
      nextButton.click();
      await this.delay(3000);

      // Wait for new page to load
      await this.waitForElement('.jobs-search-results-list, .jobs-search__results-list');

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
      // Apply Easy Apply filter
      const easyApplyFilter = this.findElement('button[aria-label*="Easy Apply"], .jobs-search-box__filter-button');
      if (easyApplyFilter && !easyApplyFilter.classList.contains('selected')) {
        easyApplyFilter.click();
        await this.delay(2000);
      }

      // Apply date filter (recent jobs)
      const dateFilter = this.findElement('button[aria-label*="Date posted"]');
      if (dateFilter) {
        dateFilter.click();
        await this.delay(500);
        
        const pastWeekOption = this.findElement('label[for*="past-week"], input[value*="past-week"]');
        if (pastWeekOption) {
          pastWeekOption.click();
          await this.delay(2000);
        }
      }

      this.log('🔍 Applied search filters');

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
    
    // If we navigated away from LinkedIn jobs, try to go back
    if (!newUrl.includes('linkedin.com/jobs') && this.isRunning) {
      setTimeout(() => {
        this.navigateToUrl(`${this.baseUrl}/jobs/search/`);
      }, 2000);
    }
  }
}