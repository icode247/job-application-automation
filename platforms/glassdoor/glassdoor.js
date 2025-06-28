// platforms/glassdoor/glassdoor.js
import BasePlatform from "../base-platform.js";

export default class GlassdoorPlatform extends BasePlatform {
  constructor(config) {
    super(config);
    this.platform = "glassdoor";
    this.baseUrl = "https://www.glassdoor.com";
    this.jobsOnCurrentPage = [];
    this.currentPageIndex = 0;
  }

  async initialize() {
    await super.initialize();
    this.log("🔍 Glassdoor platform initialized");
  }

  async start(params = {}) {
    this.isRunning = true;
    this.log("🚀 Starting Glassdoor automation");

    try {
      // Update config with any new parameters
      this.config = { ...this.config, ...params };

      // Ensure DOM is ready
      if (document.readyState !== "complete") {
        this.log("⏳ Waiting for DOM to be ready...");
        await this.waitForPageLoad();
      }

      this.log("📍 Current URL: " + window.location.href);

      // Navigate to Glassdoor jobs if not already there
      if (!window.location.href.includes("glassdoor.com")) {
        await this.navigateToUrl(`${this.baseUrl}/Job/index.htm`);
        await this.waitForPageLoad();
      }

      // Wait for job listings to load
      await this.waitForElement(
        '[data-test="job-link"], .react-job-listing',
        15000
      );

      // Apply filters
      await this.applyGlassdoorFilters();

      // Start automation loop
      await this.automationLoop();
    } catch (error) {
      this.reportError(error, { phase: "start" });
    }
  }

  async automationLoop() {
    while (this.isRunning && this.progress.completed < this.progress.total) {
      if (this.isPaused) {
        await this.delay(1000);
        continue;
      }

      try {
        await this.loadJobsOnPage();

        for (const job of this.jobsOnCurrentPage) {
          if (
            !this.isRunning ||
            this.progress.completed >= this.progress.total
          ) {
            break;
          }

          if (this.isPaused) {
            await this.delay(1000);
            continue;
          }

          await this.processGlassdoorJob(job);
        }

        const hasNextPage = await this.goToNextPage();
        if (!hasNextPage) {
          this.log("📄 No more pages available");
          break;
        }
      } catch (error) {
        this.reportError(error, { phase: "automationLoop" });
        await this.delay(5000);
      }
    }

    this.reportComplete();
  }

  async loadJobsOnPage() {
    this.log("📋 Loading Glassdoor jobs on current page");

    await this.waitForElement('[data-test="job-link"], .react-job-listing');

    // Get all job listings using multiple possible selectors
    const jobListingSelectors = [
      '[data-test="job-link"]',
      ".react-job-listing",
      ".jobListing",
      ".job-search-card",
    ];

    let jobElements = [];
    for (const selector of jobListingSelectors) {
      jobElements = this.findElements(selector);
      if (jobElements.length > 0) break;
    }

    this.jobsOnCurrentPage = jobElements.map((element, index) => {
      const titleElement =
        element.querySelector('[data-test="job-title"], .jobTitle, h2 a') ||
        element.querySelector('a[data-test="job-link"]');
      const companyElement =
        element.querySelector('[data-test="employer-name"], .employerName') ||
        element.querySelector('[data-test="employer-short-name"]');
      const locationElement =
        element.querySelector('[data-test="job-location"], .location') ||
        element.querySelector('[data-test="emp-location"]');

      return {
        index,
        element: element,
        title: titleElement?.textContent?.trim() || "Unknown Title",
        company: companyElement?.textContent?.trim() || "Unknown Company",
        location: locationElement?.textContent?.trim() || "Unknown Location",
        url: titleElement?.href || window.location.href,
        jobId: element.getAttribute("data-id") || index,
      };
    });

    this.log(`📊 Found ${this.jobsOnCurrentPage.length} jobs on current page`);
  }

  async processGlassdoorJob(jobData) {
    try {
      this.updateProgress({
        current: `Processing: ${jobData.title} at ${jobData.company}`,
      });

      if (this.shouldSkipJob(jobData.url)) {
        this.log(`⏭️ Skipping already applied job: ${jobData.title}`);
        this.progress.skipped++;
        this.updateProgress({ skipped: this.progress.skipped });
        return;
      }

      // Click on job
      const clicked = await this.clickGlassdoorJob(jobData);
      if (!clicked) {
        throw new Error("Failed to click job");
      }

      await this.delay(3000);

      // Check for easy apply
      const hasEasyApply = this.findElement(
        '[data-test="easy-apply-button"], .css-1gqc91l button, .apply-btn'
      );

      if (!hasEasyApply) {
        this.log(`⏭️ No Easy Apply for: ${jobData.title}`);
        this.progress.skipped++;
        this.updateProgress({ skipped: this.progress.skipped });
        return;
      }

      const applied = await this.applyToGlassdoorJob(jobData);
      if (applied) {
        this.reportApplicationSubmitted(jobData, {
          method: "Glassdoor Easy Apply",
        });
      } else {
        this.progress.failed++;
        this.updateProgress({ failed: this.progress.failed });
      }
    } catch (error) {
      this.reportError(error, { job: jobData });
      this.progress.failed++;
      this.updateProgress({ failed: this.progress.failed });
    }

    await this.delay(this.getRandomDelay(3000, 7000));
  }

  async clickGlassdoorJob(jobData) {
    try {
      const jobElement = jobData.element;

      // Scroll job into view
      this.scrollToElement(jobElement);
      await this.delay(500);

      // Try different click targets
      const clickTargets = [
        jobElement.querySelector('[data-test="job-title"] a'),
        jobElement.querySelector(".jobTitle a"),
        jobElement.querySelector("h2 a"),
        jobElement.querySelector('a[data-test="job-link"]'),
        jobElement,
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
      this.reportError(error, { action: "clickGlassdoorJob", job: jobData });
      return false;
    }
  }

  async applyToGlassdoorJob(jobData) {
    try {
      this.log(`📝 Applying to: ${jobData.title} at ${jobData.company}`);

      // Click Easy Apply button
      const easyApplySelectors = [
        '[data-test="easy-apply-button"]',
        ".css-1gqc91l button",
        ".apply-btn",
        'button[aria-label*="Apply"]',
      ];

      let applyButton = null;
      for (const selector of easyApplySelectors) {
        applyButton = this.findElement(selector);
        if (applyButton) break;
      }

      if (!applyButton) {
        throw new Error("Easy Apply button not found");
      }

      applyButton.click();
      await this.delay(2000);

      // Handle application flow
      let step = 1;
      const maxSteps = 8;

      while (step <= maxSteps) {
        this.log(`📋 Processing Glassdoor application step ${step}`);

        // Fill form if present
        await this.fillGlassdoorForm();

        // Look for next/submit button
        const actionButton = this.findGlassdoorActionButton();

        if (!actionButton) {
          this.log("No action button found, checking completion");
          break;
        }

        const isSubmitButton = this.isGlassdoorSubmitButton(actionButton);

        actionButton.click();
        await this.delay(2000);

        if (isSubmitButton) {
          // Check if application completed
          const isComplete = await this.checkGlassdoorApplicationComplete();
          if (isComplete) {
            this.log("✅ Glassdoor application submitted successfully");
            return true;
          }
        }

        step++;
      }

      // Final completion check
      return await this.checkGlassdoorApplicationComplete();
    } catch (error) {
      this.log(`❌ Failed to apply: ${error.message}`);

      // Close modal if open
      const closeButton = this.findElement(
        '[data-test="modal-close"], .modal-close, [aria-label="Close"]'
      );
      if (closeButton) {
        closeButton.click();
      }

      return false;
    }
  }

  findGlassdoorActionButton() {
    const buttonSelectors = [
      'button[data-test="continue-button"]',
      'button[data-test="submit-button"]',
      'button[data-test="next-button"]',
      'button[aria-label*="Continue"]',
      'button[aria-label*="Submit"]',
      'button[type="submit"]',
    ];

    for (const selector of buttonSelectors) {
      const button = this.findElement(selector);
      if (button && !button.disabled) {
        return button;
      }
    }

    // Look for buttons with relevant text
    const buttons = this.findElements("button");
    for (const button of buttons) {
      const text = button.textContent?.toLowerCase() || "";
      if (
        (text.includes("continue") ||
          text.includes("submit") ||
          text.includes("apply")) &&
        !button.disabled
      ) {
        return button;
      }
    }

    return null;
  }

  isGlassdoorSubmitButton(button) {
    const buttonText = button.textContent?.toLowerCase() || "";
    const ariaLabel = button.getAttribute("aria-label")?.toLowerCase() || "";
    const testId = button.getAttribute("data-test") || "";

    return (
      buttonText.includes("submit") ||
      buttonText.includes("apply") ||
      ariaLabel.includes("submit") ||
      ariaLabel.includes("apply") ||
      testId.includes("submit") ||
      button.type === "submit"
    );
  }

  async fillGlassdoorForm() {
    const formData = this.config.preferences || {};

    // Use base platform form filling
    const result = await this.fillForm(formData);
    this.log(
      `📝 Filled ${result.fieldsFilled}/${result.fieldsFound} form fields`
    );

    // Handle Glassdoor-specific fields
    await this.handleGlassdoorSpecificFields(formData);
  }

  async handleGlassdoorSpecificFields(formData) {
    // Phone number
    const phoneSelectors = [
      'input[data-test="phone-input"]',
      'input[name*="phone"]',
      'input[id*="phone"]',
    ];

    for (const selector of phoneSelectors) {
      const phoneInput = this.findElement(selector);
      if (phoneInput && formData.phone) {
        await this.fillTextField(phoneInput, formData.phone);
        break;
      }
    }

    // Cover letter / additional information
    const textareaSelectors = [
      'textarea[data-test="cover-letter"]',
      'textarea[name*="cover"]',
      'textarea[placeholder*="additional"]',
    ];

    for (const selector of textareaSelectors) {
      const textarea = this.findElement(selector);
      if (textarea && formData.coverLetter) {
        await this.fillTextField(textarea, formData.coverLetter);
        break;
      }
    }

    // Handle Yes/No questions
    await this.handleGlassdoorYesNoQuestions(formData);

    // Handle file uploads
    this.highlightGlassdoorFileUploads();
  }

  async handleGlassdoorYesNoQuestions(formData) {
    const questions = [
      {
        keywords: ["authorized to work", "work authorization"],
        value: formData.workAuthorization || "yes",
      },
      {
        keywords: ["require sponsorship", "visa sponsorship"],
        value: formData.visaSponsorship || "no",
      },
      {
        keywords: ["background check", "criminal background"],
        value: "yes",
      },
    ];

    const radioButtons = this.findElements('input[type="radio"]');

    for (const radio of radioButtons) {
      const label = radio.closest("label") || radio.parentElement;
      const questionText = label?.textContent?.toLowerCase() || "";

      for (const question of questions) {
        const isRelevantQuestion = question.keywords.some((keyword) =>
          questionText.includes(keyword.toLowerCase())
        );

        if (isRelevantQuestion) {
          const answerText = radio.value?.toLowerCase() || questionText;

          if (
            (question.value === "yes" &&
              (answerText.includes("yes") || answerText.includes("true"))) ||
            (question.value === "no" &&
              (answerText.includes("no") || answerText.includes("false")))
          ) {
            radio.checked = true;
            radio.dispatchEvent(new Event("change", { bubbles: true }));
            break;
          }
        }
      }
    }
  }

  highlightGlassdoorFileUploads() {
    const fileUploadSelectors = [
      'input[type="file"]',
      '[data-test="file-upload"]',
      ".file-upload-input",
    ];

    for (const selector of fileUploadSelectors) {
      const elements = this.findElements(selector);
      elements.forEach((input) => {
        if (input.type === "file") {
          input.style.border = "3px solid #FF9800";
          input.style.boxShadow = "0 0 10px #FF9800";

          // Add tooltip
          const tooltip = document.createElement("div");
          tooltip.textContent = "Please upload your resume here";
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
          tooltip.style.top = rect.top - 30 + "px";
          tooltip.style.left = rect.left + "px";

          document.body.appendChild(tooltip);

          setTimeout(() => {
            input.style.border = "";
            input.style.boxShadow = "";
            tooltip.remove();
          }, 10000);
        }
      });
    }
  }

  async checkGlassdoorApplicationComplete() {
    // Wait for potential confirmation
    await this.delay(2000);

    // Check for success indicators
    const successSelectors = [
      '[data-test="application-complete"]',
      '[data-test="application-success"]',
      ".application-confirmation",
      ".success-message",
    ];

    for (const selector of successSelectors) {
      if (this.findElement(selector)) {
        return true;
      }
    }

    // Check page content for success messages
    const pageText = document.body.textContent?.toLowerCase() || "";
    const successKeywords = [
      "application submitted",
      "thank you for applying",
      "application has been submitted",
      "successfully applied",
    ];

    return successKeywords.some((keyword) => pageText.includes(keyword));
  }

  async applyGlassdoorFilters() {
    try {
      // Apply Easy Apply filter if available
      const easyApplyFilterSelectors = [
        '[data-test="easy-apply-only-toggle"]',
        'input[name="easyApply"]',
        ".easy-apply-filter",
      ];

      for (const selector of easyApplyFilterSelectors) {
        const easyApplyFilter = this.findElement(selector);
        if (easyApplyFilter && !easyApplyFilter.checked) {
          easyApplyFilter.click();
          await this.delay(2000);
          break;
        }
      }

      // Apply date filter for recent jobs
      const dateFilterSelectors = [
        '[data-test="date-posted-filter"]',
        'select[name="fromAge"]',
      ];

      for (const selector of dateFilterSelectors) {
        const dateFilter = this.findElement(selector);
        if (dateFilter) {
          // Try to select "Past Week" or recent option
          if (dateFilter.tagName === "SELECT") {
            const options = dateFilter.querySelectorAll("option");
            for (const option of options) {
              const optionText = option.textContent?.toLowerCase() || "";
              if (optionText.includes("week") || optionText.includes("7")) {
                option.selected = true;
                dateFilter.dispatchEvent(
                  new Event("change", { bubbles: true })
                );
                await this.delay(2000);
                break;
              }
            }
          }
          break;
        }
      }

      this.log("🔍 Applied Glassdoor filters");
    } catch (error) {
      this.log("⚠️ Failed to apply filters, continuing anyway");
    }
  }

  async goToNextPage() {
    try {
      const nextPageSelectors = [
        '[data-test="pagination-next"]',
        ".next-page",
        'a[aria-label="Next"]',
      ];

      let nextButton = null;
      for (const selector of nextPageSelectors) {
        nextButton = this.findElement(selector);
        if (nextButton && !nextButton.disabled) break;
      }

      if (!nextButton) {
        return false;
      }

      nextButton.click();
      await this.delay(3000);
      await this.waitForElement('[data-test="job-link"], .react-job-listing');

      this.currentPageIndex++;
      this.log(`📄 Navigated to page ${this.currentPageIndex + 1}`);

      return true;
    } catch (error) {
      this.reportError(error, { action: "goToNextPage" });
      return false;
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

    // If we navigated away from Glassdoor, try to go back
    if (!newUrl.includes("glassdoor.com") && this.isRunning) {
      setTimeout(() => {
        this.navigateToUrl(`${this.baseUrl}/Job/index.htm`);
      }, 2000);
    }
  }
}
