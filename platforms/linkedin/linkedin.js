// platforms/linkedin/linkedin.js
import BasePlatform from '../base-platform.js';

export default class LinkedInPlatform extends BasePlatform {
  constructor(config) {
    super(config);
    this.platform = 'linkedin';
    this.baseUrl = 'https://www.linkedin.com';
    this.hasStarted = false;
    this.automationStarted = false;
    this.processedJobs = new Set();
    this.answerCache = new Map();
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
    this.log('🚀 Starting LinkedIn automation');

    try {
      this.config = { ...this.config, ...params };
      this.log('📋 Configuration loaded', this.config);

      if (!this.config.jobsToApply || this.config.jobsToApply <= 0) {
        throw new Error('Invalid jobsToApply configuration');
      }

      this.updateProgress({ total: this.config.jobsToApply });

      // Wait for basic page readiness first
      await this.waitForBasicPageLoad();
      this.log('📄 Basic page loaded, current URL:', window.location.href);

      // Navigate to LinkedIn Jobs if needed
      const currentUrl = window.location.href.toLowerCase();
      if (!currentUrl.includes('linkedin.com/jobs')) {
        this.log('📍 Navigating to LinkedIn Jobs');
        await this.navigateToLinkedInJobs();
      } else {
        this.log('✅ Already on LinkedIn Jobs page');
      }

      // Wait for job search results to load
      await this.waitForSearchResultsLoad();

      // Start processing jobs using EXACT logic
      this.automationStarted = true;
      await this.processJobs({ jobsToApply: this.config.jobsToApply });

    } catch (error) {
      this.hasStarted = false;
      this.reportError(error, { phase: 'start' });
    }
  }

   async waitForBasicPageLoad() {
    try {
      // Wait for job list to be present
      await this.waitForElement(".jobs-search-results-list");

      // Wait for jobs to load
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
  async navigateToLinkedInJobs() {
    const jobsUrl = `${this.baseUrl}/jobs/search/?f_AL=true&keywords=software%20engineer&sortBy=DD`;
    this.log(`🔗 Navigating to: ${jobsUrl}`);
    
    window.location.href = jobsUrl;
    await this.delay(5000);
    await this.waitForPageLoad();
    this.log('✅ Navigation completed');
  }

  // ===== LINKEDIN-SPECIFIC UTILITY METHODS =====

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
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    ) {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }

    return element.offsetParent !== null;
  }

  getElementText(selector) {
    const element = document.querySelector(selector);
    return element ? element.textContent.trim() : "N/A";
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

  // ===== LINKEDIN-SPECIFIC AUTOMATION METHODS =====

  // EXACT logic from working automation
  async waitForPageLoad() {
    try {
      // Wait for job list to be present
      await this.waitForElement(".jobs-search-results-list");

      // Wait for jobs to load
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

  // EXACT logic from working automation
  async waitForSearchResultsLoad() {
    return new Promise((resolve) => {
      const checkSearchResults = () => {
        if (document.querySelector(".jobs-search-results-list")) {
          console.log("Search results loaded");
          resolve();
        } else {
          setTimeout(checkSearchResults, 500);
        }
      };
      checkSearchResults();
    });
  }

  // EXACT logic from working automation  
  async getJobCards() {
    const jobCards = document.querySelectorAll(
      ".scaffold-layout__list-item[data-occludable-job-id]"
    );
    return jobCards;
  }

  // EXACT logic from working automation
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

  // EXACT logic from working automation
  async findEasyApplyButton() {
    try {
      // Wait for button with timeout
      const button = await this.waitForElement(".jobs-apply-button", 5000);
      return button;
    } catch (error) {
      console.log("Easy Apply button not found");
      return null;
    }
  }

  // EXACT logic from working automation
  getJobProperties() {
    const company = document.querySelector(
      ".job-details-jobs-unified-top-card__company-name"
    ).textContent;
    const title = document.querySelector(
      ".job-details-jobs-unified-top-card__job-title"
    ).textContent;
    const urlParams = new URLSearchParams(window.location.search);
    const jobId = urlParams.get("currentJobId");
    const detailsContainer = document.querySelector(
      ".job-details-jobs-unified-top-card__primary-description-container .t-black--light.mt2"
    );
    const detailsText = detailsContainer ? detailsContainer.textContent : "";
    const location = detailsText.match(/^(.*?)\s·/)?.[1] || "Not specified";
    const postedDate = detailsText.match(/·\s(.*?)\s·/)?.[1] || "Not specified";
    const applications =
      detailsText.match(/·\s([^·]+)$/)?.[1] || "Not specified";
    const workplaceElem = document.querySelector(
      ".job-details-preferences-and-skills__pill"
    );

    const workplace = workplaceElem
      ? workplaceElem.textContent.trim()
      : "Not specified";

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

  // EXACT logic from working automation
  async clickJobCard(jobCard) {
    try {
      const clickableElement = jobCard.querySelector(
        "a[href*='jobs/view'], .job-card-list__title, .job-card-container__link"
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

  // EXACT logic from working automation
  async waitForJobDetailsLoad() {
    try {
      console.log("Waiting for job details to load");
      const element = await this.waitForElement(
        ".job-details-jobs-unified-top-card__job-title",
        10000
      );

      console.log("Job details title element found");
      await this.sleep(1000);

      return element;
    } catch (error) {
      console.error("Error waiting for job details:", error);
      throw new Error("Job details failed to load");
    }
  }

  // EXACT logic from working automation
  async applyToJob(applyButton, jobDetails) {
    try {
      // Start application
      applyButton.click();
      // await this.waitForElement(".jobs-easy-apply-content");

      let currentStep = "initial";
      let attempts = 0;
      const maxAttempts = 20; // Maximum number of steps to prevent infinite loops
      while (currentStep !== "submitted" && attempts < maxAttempts) {
        await this.fillCurrentStep();
        currentStep = await this.moveToNextStep();
        attempts++;

        // Handle post-submission modal
        if (currentStep === "submitted") {
          await this.handlePostSubmissionModal();
        }
      }

      if (attempts >= maxAttempts) {
        // Close the application modal before moving on
        await this.closeApplication();
        // Add a small delay to ensure modal is fully closed
        await this.sleep(1000);
        return false;
      }

      await this.saveAppliedJob(jobDetails);
      return true;
    } catch (error) {
      // Ensure we close the modal even if there's an error
      await this.handleErrorState();
      // Add a small delay to ensure modal is fully closed
      await this.sleep(1000);
      return false;
    }
  }

  // EXACT logic from working automation
  async fillCurrentStep() {
    // First handle file upload questions as they're more specific
    const fileUploadContainers = document.querySelectorAll(
      ".js-jobs-document-upload__container"
    );

    if (fileUploadContainers.length) {
      for (const container of fileUploadContainers) {
        // Handle file upload (simplified for now)
        console.log("File upload container found, skipping for now");
      }
    }

    // Then handle regular form questions
    const questions = document.querySelectorAll(".fb-dash-form-element");
    for (const question of questions) {
      await this.handleQuestion(question);
    }
  }

  // EXACT logic from working automation
  async handleQuestion(question) {
    if (
      question.classList.contains("js-jobs-document-upload__container") ||
      question.hasAttribute("data-processed")
    ) {
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

  // EXACT logic from working automation
  getQuestionSelector(type) {
    const selectors = {
      select: "select",
      radio:
        'fieldset[data-test-form-builder-radio-button-form-component="true"]',
      text: "input[type='text']",
      textarea: "textarea",
      checkbox: "input[type='checkbox']",
    };
    return selectors[type];
  }

  // EXACT logic from working automation
  async handleSelectQuestion(select) {
    // Find parent container
    const container = select.closest(".fb-dash-form-element");
    // Get label accounting for nested spans
    const labelElement = container.querySelector(
      ".fb-dash-form-element__label"
    );
    const label = labelElement?.textContent?.trim();

    const options = Array.from(select.options)
      .filter((opt) => opt.value !== "Select an option")
      .map((opt) => opt.text.trim());

    const answer = await this.getAnswer(label, options);
    select.value = answer;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // EXACT logic from working automation
  async handleRadioQuestion(radio) {
    const label = this.getQuestionLabel(radio);
    const options = Array.from(
      radio.querySelectorAll('input[type="radio"]')
    ).map((input) => {
      const labelElement = document.querySelector(`label[for="${input.id}"]`);
      return labelElement ? labelElement.textContent : "Unknown";
    });
    const answer = await this.getAnswer(label, options);

    const answerElement = Array.from(radio.querySelectorAll("label")).find(
      (el) => el.textContent.includes(answer)
    );
    if (answerElement) answerElement.click();
  }

  // EXACT logic from working automation
  async handleTextQuestion(textInput) {
    const label = this.getQuestionLabel(textInput);
    const answer = await this.getAnswer(label);

    // Handle date fields
    const isDateField =
      textInput.getAttribute("placeholder") === "mm/dd/yyyy" ||
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
      textInput.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown" })
      );
      await this.sleep(500);
      textInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    }
  }

  // EXACT logic from working automation
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

  // EXACT logic from working automation
  async handleTextAreaQuestion(textArea) {
    const label = this.getQuestionLabel(textArea);
    const answer = await this.getAnswer(label);
    textArea.value = answer;
    textArea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // EXACT logic from working automation
  async handleCheckboxQuestion(checkbox) {
    const label = this.getQuestionLabel(checkbox);
    const answer = (await this.getAnswer(label, ["Yes", "No"])) === "Yes";
    checkbox.checked = answer;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // EXACT logic from working automation
  getQuestionLabel(element) {
    const container = element.closest(".fb-dash-form-element");
    if (!container) return "Unknown";

    const label = container.querySelector(
      "label, legend, .fb-dash-form-element__label"
    );
    if (!label) return "Unknown";

    // Handle both nested spans and direct text
    return label.textContent.trim().replace(/\s+/g, " ");
  }

  // Simplified answer logic
  async getAnswer(label, options = []) {
    const normalizedLabel = label?.toLowerCase()?.trim() || '';
    
    // Simple default answers for common questions
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

  // EXACT logic from working automation
  async moveToNextStep() {
    try {
      // Define all possible buttons
      const buttonSelectors = {
        next: 'button[aria-label="Continue to next step"]',
        preview: 'button[aria-label="Review your application"]',
        submit: 'button[aria-label="Submit application"]',
        dismiss: 'button[aria-label="Dismiss"]',
        done: 'button[aria-label="Done"]',
        close: 'button[aria-label="Close"]',
        continueApplying:
          'button[aria-label*="Easy Apply"][aria-label*="Continue applying"]',
        continueTips:
          'button[aria-label="I understand the tips and want to continue the apply process"]',
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

      if (
        (await this.findAndClickButton(buttonSelectors.dismiss)) ||
        (await this.findAndClickButton(buttonSelectors.done)) ||
        (await this.findAndClickButton(buttonSelectors.close))
      ) {
        await this.sleep(2000);
        return "modal-closed";
      }
      return "error";
    } catch (error) {
      return "error";
    }
  }

  // EXACT logic from working automation
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
          await this.sleep(1000); // Wait for modal to close
          return true;
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  // EXACT logic from working automation
  async closeApplication() {
    try {
      // First try to click the main close button (jobs modal)
      const closeButton = document.querySelector(
        "button[data-test-modal-close-btn]"
      );
      if (closeButton && this.isElementVisible(closeButton)) {
        closeButton.click();
        await this.sleep(1000); // Wait for potential save dialog

        // Check for the "Save Application" dialog
        const discardButton = document.querySelector(
          'button[data-control-name="discard_application_confirm_btn"]'
        );
        if (discardButton && this.isElementVisible(discardButton)) {
          console.log("Found save dialog, clicking discard");
          discardButton.click();
          await this.sleep(1000); // Wait for dialog to close
        }
        return true;
      }

      // Fallback selectors in case the main selectors change
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

          // Check for save dialog with fallback selector
          const discardDialog = document.querySelector(
            ".artdeco-modal__actionbar--confirm-dialog"
          );
          if (discardDialog) {
            const discardBtn = document.querySelector(
              'button[data-control-name="discard_application_confirm_btn"]'
            );
            if (discardBtn && this.isElementVisible(discardBtn)) {
              discardBtn.click();
              await this.sleep(1000);
            }
          }
          return true;
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  // EXACT logic from working automation
  async handleErrorState() {
    try {
      // Try to close any open modals or dialogs
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

  // EXACT logic from working automation
  async saveAppliedJob(jobDetails) {
    try {
      const applicationData = {
        userId: this.config.userId,
        jobId: jobDetails.jobId,
        title: jobDetails.title,
        company: jobDetails.company,
        location: jobDetails.location,
        jobUrl: window.location.href,
        salary: jobDetails.salary || "Not specified",
        workplace: jobDetails.workplace,
        postedDate: jobDetails.postedDate,
        applicants: jobDetails.applications,
      };

      // For now, just log the application data
      console.log("Application data:", applicationData);
      return true;
    } catch (error) {
      console.error("Error saving applied job:", error);
      return false;
    }
  }

  // EXACT logic from working automation
  async goToNextPage(currentPage) {
    try {
      console.log(`Attempting to go to next page after page ${currentPage}`);

      // First try to find the next button
      const nextButton = document.querySelector(
        "button.jobs-search-pagination__button--next"
      );
      if (nextButton) {
        console.log("Found next button, clicking it");
        nextButton.click();
        await this.waitForSearchResultsLoad();
        return true;
      }

      // If no next button, try finding the pagination container
      const paginationContainer = document.querySelector(
        ".jobs-search-pagination__pages"
      );
      if (!paginationContainer) {
        console.log("No pagination found");
        return false;
      }

      // Get all page indicators
      const pageIndicators = paginationContainer.querySelectorAll(
        ".jobs-search-pagination__indicator"
      );

      // Find the current active page button
      const activeButton = paginationContainer.querySelector(
        ".jobs-search-pagination__indicator-button--active"
      );
      if (!activeButton) {
        console.log("No active page button found");
        return false;
      }

      // Get the current page number
      const currentPageNum = parseInt(
        activeButton.querySelector("span").textContent
      );
      console.log(`Current page number: ${currentPageNum}`);

      // Find the next page button
      let nextPageButton = null;
      pageIndicators.forEach((indicator, index) => {
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
        await this.waitForSearchResultsLoad();
        return true;
      }

      console.log("No next page available");
      return false;
    } catch (error) {
      console.error("Error navigating to next page:", error);
      return false;
    }
  }

  // EXACT logic from working automation
  async initialScroll() {
    const jobsList = document.querySelector(".jobs-search-results-list");

    if (!jobsList) {
      return;
    }

    // Scroll down in smaller increments
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

  // EXACT logic from working automation
  async scrollAndWaitForNewJobs() {
    const jobsList = document.querySelector(".jobs-search-results-list");

    if (!jobsList) {
      return false;
    }

    const previousHeight = jobsList.scrollHeight;
    const previousJobCount = document.querySelectorAll(
      ".jobs-search-results-list [data-occludable-job-id]"
    ).length;

    // Scroll in smaller increments
    const currentScroll = jobsList.scrollTop;
    const targetScroll = currentScroll + window.innerHeight * 0.75;

    jobsList.scrollTo({
      top: targetScroll,
      behavior: "smooth",
    });

    // Wait for potential loading
    await this.sleep(2000);

    // Check for new content
    const newHeight = jobsList.scrollHeight;
    const newJobCount = document.querySelectorAll(
      ".jobs-search-results-list [data-occludable-job-id]"
    ).length;

    console.log(
      `Scroll check - Previous jobs: ${previousJobCount}, New jobs: ${newJobCount}`
    );

    return newHeight > previousHeight || newJobCount > previousJobCount;
  }

  // EXACT logic from working automation - THE MAIN PROCESSING LOOP
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
        `Starting to process jobs. Target: ${jobsToApply} jobs`,
      );

      // Initial scroll to trigger job loading
      await this.initialScroll();

      while (appliedCount < jobsToApply) {
        const jobCards = await this.getJobCards();
        console.log(
          `Found ${jobCards.length} job cards on page ${currentPage}`
        );

        if (jobCards.length === 0) {
          console.log("No job cards found, checking pagination");
          const hasNextPage = await this.goToNextPage(currentPage);
          if (hasNextPage) {
            currentPage++;
            noNewJobsCount = 0;
            await this.waitForSearchResultsLoad();
            continue;
          } else {
            console.log("No more pages available");
            break;
          }
        }

        let newJobsFound = false;
        let newApplicableJobsFound = false; // Track if we found jobs we can apply to

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

            // Find the Easy Apply button - if not found, this job is considered already applied
            const applyButton = await this.findEasyApplyButton();
            if (!applyButton) {
              console.log("No Easy Apply button found - job already applied");
              this.log(
                `Already applied to job ${jobId}, skipping.`,
              );
              skippedCount++;
              continue;
            }

            // We found a job we can actually apply to
            newApplicableJobsFound = true;

            const jobDetails = this.getJobProperties();
            this.updateProgress({
              current: `Processing: ${jobDetails.title} (Page ${currentPage})`
            });

            // Attempt to apply
            const success = await this.applyToJob(applyButton, jobDetails);

            if (success) {
              appliedCount++;
              this.progress.completed = appliedCount;
              this.updateProgress({ completed: appliedCount });
              this.log(
                `Successfully applied to job ${appliedCount}/${jobsToApply} (${skippedCount} jobs skipped)`
              );

              this.reportApplicationSubmitted(jobDetails, { 
                method: 'Easy Apply',
                userId: this.config.userId || this.userId 
              });
            } else {
              this.progress.failed++;
              this.updateProgress({ failed: this.progress.failed });
            }

            await this.sleep(2000);
          } catch (error) {
            this.log(
              `Error processing job ${jobId} on page ${currentPage}`
            );
            console.error(`Error processing job ${jobId}:`, error);
            continue;
          }
        }

        // If we haven't found any new jobs that we can apply to
        if (!newApplicableJobsFound) {
          // Try scrolling first to load more jobs
          if (await this.scrollAndWaitForNewJobs()) {
            noNewJobsCount = 0;
            continue;
          }

          // If scrolling doesn't help, try next page
          this.log(
            `Moving to next page (current: ${currentPage})`
          );
          const hasNextPage = await this.goToNextPage(currentPage);
          if (hasNextPage) {
            currentPage++;
            noNewJobsCount = 0;
            await this.waitForSearchResultsLoad();
          } else {
            noNewJobsCount++;
            if (noNewJobsCount >= MAX_NO_NEW_JOBS) {
              this.log(
                `No more applicable jobs to apply. Applied to ${appliedCount}/${jobsToApply} (${skippedCount} jobs)`
              );
              break;
            }
          }
        } else {
          // Reset the counter if we found applicable jobs
          noNewJobsCount = 0;
        }
      }

      // Determine the status based on whether we reached the target
      const completionStatus =
        appliedCount >= jobsToApply ? "target_reached" : "no_more_jobs";
      const message =
        appliedCount >= jobsToApply
          ? `Successfully applied to target of ${appliedCount}/${jobsToApply} jobs (Processed ${processedCount} total across ${currentPage} pages)`
          : `Applied to ${appliedCount}/${jobsToApply} jobs - no more jobs available (Skipped ${skippedCount} already applied jobs)`;

      this.log(message);
      this.reportComplete();

      return {
        status: completionStatus,
        message,
        appliedCount,
        processedCount,
        skippedCount,
        totalPages: currentPage,
      };
    } catch (error) {
      console.error("Error in processJobs:", error);
      this.reportError(error, { phase: 'processJobs' });
      throw error;
    }
  }

  // Handle DOM changes (called by content script)
  onDOMChange() {
    // Only reload jobs if automation has started to prevent initial loops
    if (this.automationStarted && this.isRunning && !this.isPaused) {
      // Don't automatically reload, let the main loop handle it
    }
  }

  // Handle navigation (called by content script)
  onNavigation(oldUrl, newUrl) {
    this.log(`🔄 Navigation detected: ${oldUrl} → ${newUrl}`);
    
    // If we navigated away from LinkedIn jobs and automation is running
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
}

// Add the missing isVisible method to Element prototype (LinkedIn-specific)
if (typeof Element !== 'undefined' && !Element.prototype.isVisible) {
  Element.prototype.isVisible = function () {
    return (
      window.getComputedStyle(this).display !== "none" &&
      window.getComputedStyle(this).visibility !== "hidden" &&
      this.offsetParent !== null
    );
  };
}