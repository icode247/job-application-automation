// platforms/linkedin/linkedin.js
import BasePlatform from "../base-platform.js";
import ApplicationTrackerService from "../../services/application-tracker-service.js";
import AIService from "../../services/ai-service.js";
import UserService from "../../services/user-service.js";
import StatusNotificationService from "../../services/status-notification-service.js";
import FileHandlerService from "../../services/file-handler-service.js";
import StateManagerService from "../../services/state-manager-service.js";

export default class LinkedInPlatform extends BasePlatform {
  constructor(config) {
    super(config);
    this.platform = "linkedin";
    this.baseUrl = "https://www.linkedin.com";
    this.jobsProcessed = 0;
    this.currentPageIndex = 0;

    // Initialize services
    this.initializeServices(config);

    // Job processing state
    this.processedJobIds = new Set();
    this.maxNoNewJobsCount = 3;
    this.noNewJobsCount = 0;
  }

  initializeServices(config) {
    const serviceConfig = {
      apiHost: config.apiHost || "https://api.yourdomain.com",
      userId: config.userId || config.config?.userId,
    };

    this.applicationTracker = new ApplicationTrackerService(serviceConfig);
    this.aiService = new AIService(serviceConfig);
    this.userService = new UserService(serviceConfig);
    this.statusManager = new StatusNotificationService();
    this.fileHandler = new FileHandlerService(serviceConfig);
    this.stateManager = new StateManagerService({
      storageKey: `linkedinState_${this.sessionId}`,
      sessionId: this.sessionId,
    });
  }

  async initialize() {
    await super.initialize();
    this.log("🔗 LinkedIn platform initialized");

    // Initialize state
    await this.stateManager.initializeState({
      userId: this.config.userId,
      platform: this.platform,
      sessionId: this.sessionId,
    });
  }

  async start(params = {}) {
    this.isRunning = true;
    this.log("🚀 Starting LinkedIn automation");

    try {
      // Update config with any new parameters
      this.config = { ...this.config, ...params };

      // Update state with user details
      await this.initializeUserState();

      // Wait for page to be ready
      await this.waitForPageLoad();

      // Navigate to LinkedIn Jobs if not already there
      if (!window.location.href.includes("linkedin.com/jobs")) {
        this.log("📍 Navigating to LinkedIn Jobs");
        await this.navigateToUrl(`${this.baseUrl}/jobs/search/`);
        await this.waitForPageLoad();
      }

      // Generate and navigate to search URL with filters
      const searchUrl = await this.generateComprehensiveSearchUrl(
        this.config.preferences || {}
      );
      if (searchUrl !== window.location.href) {
        this.log("🔍 Applying search filters");
        await this.navigateToUrl(searchUrl);
        await this.waitForPageLoad();
      }

      // Wait for job search results to load
      await this.waitForElement(
        ".jobs-search-results-list, .jobs-search__results-list"
      );
      await this.delay(2000);

      // Start the main automation loop
      await this.processJobs();
    } catch (error) {
      this.reportError(error, { phase: "start" });
      this.statusManager.show(
        "Failed to start automation: " + error.message,
        "error"
      );
    }
  }

  async initializeUserState() {
    try {
      // Fetch user details and update state
      const userDetails = await this.userService.fetchUserDetails();
      await this.stateManager.updateState({
        userId: userDetails.id,
        userRole: userDetails.role,
        applicationLimit: userDetails.applicationLimit,
        applicationsUsed: userDetails.applicationsUsed,
        availableCredits: userDetails.credits,
        preferences: userDetails.jobPreferences || {},
      });
    } catch (error) {
      this.log("⚠️ Could not fetch user details, using config values");
    }
  }

  async processJobs() {
    const targetJobs = this.config.jobsToApply || 10;
    let appliedCount = 0;
    let skippedCount = 0;
    let processedCount = 0;
    let currentPage = 1;

    this.updateProgress({
      total: targetJobs,
      completed: appliedCount,
      skipped: skippedCount,
      current: `Starting job search on page ${currentPage}`,
    });

    // Initial scroll to load jobs
    await this.initialScroll();

    while (this.isRunning && appliedCount < targetJobs) {
      if (this.isPaused) {
        await this.delay(1000);
        continue;
      }

      try {
        // Check if user can still apply
        const canApply = await this.stateManager.canApplyMore();
        if (!canApply) {
          const remaining = await this.stateManager.getRemainingApplications();
          this.statusManager.show(
            `Application limit reached. ${remaining} applications remaining.`,
            "warning"
          );
          break;
        }

        // Get job cards on current page
        const jobCards = await this.getJobCards();
        this.log(`Found ${jobCards.length} job cards on page ${currentPage}`);

        if (jobCards.length === 0) {
          this.log("No job cards found, trying next page");
          const hasNextPage = await this.goToNextPage(currentPage);
          if (hasNextPage) {
            currentPage++;
            this.noNewJobsCount = 0;
            await this.waitForPageLoad();
            continue;
          } else {
            this.log("No more pages available");
            break;
          }
        }

        let newApplicableJobsFound = false;

        // Process each job card
        for (const jobCard of jobCards) {
          if (appliedCount >= targetJobs || !this.isRunning) break;
          if (this.isPaused) {
            await this.delay(1000);
            continue;
          }

          const jobId = this.getJobIdFromCard(jobCard);
          if (!jobId || this.processedJobIds.has(jobId)) {
            continue;
          }

          this.processedJobIds.add(jobId);
          processedCount++;

          try {
            // Check if user can still apply
            const currentState = await this.stateManager.getState();
            if (!(await this.stateManager.canApplyMore())) {
              const remaining =
                await this.stateManager.getRemainingApplications();
              this.statusManager.show(
                `Cannot apply: Application limit reached (${remaining} remaining)`,
                "warning"
              );
              this.isRunning = false;
              break;
            }

            // Scroll job card into view if needed
            if (!this.isElementInViewport(jobCard)) {
              jobCard.scrollIntoView({ behavior: "smooth", block: "center" });
              await this.delay(1000);
            }

            // Click and load job details
            await this.clickJobCard(jobCard);
            await this.waitForJobDetailsLoad();

            // Find Easy Apply button
            const applyButton = await this.findEasyApplyButton();
            if (!applyButton) {
              this.log(`No Easy Apply button found for job ${jobId}, skipping`);
              skippedCount++;
              continue;
            }

            // We found a job we can apply to
            newApplicableJobsFound = true;

            // Get job details
            const jobDetails = await this.getJobProperties();
            this.updateProgress({
              current: `Processing: ${jobDetails.title} at ${jobDetails.company} (Page ${currentPage})`,
            });

            // Apply to the job
            const success = await this.applyToJob(applyButton, jobDetails);

            if (success) {
              appliedCount++;
              this.statusManager.show(
                `Successfully applied to job ${appliedCount}/${targetJobs} (${skippedCount} jobs skipped)`,
                "success"
              );

              // Update state and tracking
              await this.stateManager.incrementApplicationsUsed();
              await this.stateManager.decrementAvailableCredits();
              await this.applicationTracker.updateApplicationCount();

              this.updateProgress({
                completed: appliedCount,
                current: null,
              });
            } else {
              skippedCount++;
            }

            await this.delay(this.getRandomDelay(2000, 5000));
          } catch (error) {
            this.log(`Error processing job ${jobId}: ${error.message}`);
            skippedCount++;
            continue;
          }
        }

        // Handle pagination and job loading
        if (!newApplicableJobsFound) {
          // Try scrolling to load more jobs
          if (await this.scrollAndWaitForNewJobs()) {
            this.noNewJobsCount = 0;
            continue;
          }

          // Try next page
          this.statusManager.show(
            `Moving to next page (current: ${currentPage})`,
            "info"
          );
          const hasNextPage = await this.goToNextPage(currentPage);
          if (hasNextPage) {
            currentPage++;
            this.noNewJobsCount = 0;
            await this.waitForPageLoad();
          } else {
            this.noNewJobsCount++;
            if (this.noNewJobsCount >= this.maxNoNewJobsCount) {
              this.statusManager.show(
                `No more applicable jobs found. Applied to ${appliedCount}/${targetJobs} jobs`,
                "warning"
              );
              break;
            }
          }
        } else {
          this.noNewJobsCount = 0;
        }
      } catch (error) {
        this.reportError(error, { phase: "processJobs", page: currentPage });
        await this.delay(5000);
      }
    }

    // Final status update
    const completionStatus =
      appliedCount >= targetJobs ? "target_reached" : "no_more_jobs";
    const message =
      appliedCount >= targetJobs
        ? `Successfully applied to target of ${appliedCount}/${targetJobs} jobs`
        : `Applied to ${appliedCount}/${targetJobs} jobs - no more jobs available`;

    this.statusManager.show(
      message,
      appliedCount >= targetJobs ? "success" : "warning"
    );
    this.reportComplete();
  }

  async getJobCards() {
    const jobCards = document.querySelectorAll(
      ".scaffold-layout__list-item[data-occludable-job-id]"
    );
    return Array.from(jobCards);
  }

  getJobIdFromCard(jobCard) {
    // Try multiple ways to get job ID
    const jobLink = jobCard.querySelector('a[href*="jobs/view"]');
    if (jobLink) {
      const href = jobLink.href;
      const match = href.match(/view\/(\d+)/);
      return match ? match[1] : null;
    }
    return jobCard.dataset.jobId || jobCard.dataset.occludableJobId || null;
  }

  async clickJobCard(jobCard) {
    try {
      const clickableElement = jobCard.querySelector(
        'a[href*="jobs/view"], .job-card-list__title, .job-card-container__link'
      );

      if (!clickableElement) {
        throw new Error("No clickable element found in job card");
      }

      const clickEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      });

      clickableElement.dispatchEvent(clickEvent);
      return true;
    } catch (error) {
      this.reportError(error, { action: "clickJobCard" });
      throw error;
    }
  }

  async waitForJobDetailsLoad() {
    try {
      const element = await this.waitForElement(
        ".job-details-jobs-unified-top-card__job-title",
        10000
      );
      await this.delay(1000);
      return element;
    } catch (error) {
      throw new Error("Job details failed to load");
    }
  }

  async findEasyApplyButton() {
    try {
      const button = await this.waitForElement(".jobs-apply-button", 5000);
      return button;
    } catch (error) {
      return null;
    }
  }

  async getJobProperties() {
    // Wait for the job details panel to load
    await this.waitForElement(".job-details-jobs-unified-top-card__job-title");

    const jobTitle = this.getElementText(
      ".job-details-jobs-unified-top-card__job-title"
    );
    const company = this.getElementText(
      ".job-details-jobs-unified-top-card__company-name"
    );
    const location = this.getElementText(
      ".job-details-jobs-unified-top-card__bullet"
    );

    // Find salary information
    const salary = this.findSalaryInfo();

    // Additional details
    const jobInsightText = this.getElementText(
      ".job-details-jobs-unified-top-card__primary-description-container"
    );
    const [, postedDate, applicants] = jobInsightText
      .split("·")
      .map((item) => item?.trim());

    // Extract job ID from URL
    const jobId =
      new URL(window.location.href).searchParams.get("currentJobId") ||
      "Unknown ID";

    return {
      jobId,
      title: jobTitle,
      company,
      salary,
      location,
      postedDate: postedDate || "Unknown Date",
      applicants: applicants || "Unknown Applicants",
      jobUrl: window.location.href,
      platform: this.platform,
    };
  }

  getElementText(selector) {
    const element = document.querySelector(selector);
    return element ? element.textContent.trim() : "N/A";
  }

  findSalaryInfo() {
    const jobInsightElements = document.querySelectorAll(
      ".job-details-jobs-unified-top-card__job-insight"
    );
    for (const element of jobInsightElements) {
      const text = element.textContent;
      if (text.includes("$") || text.toLowerCase().includes("salary")) {
        return text.trim();
      }
    }
    return "Not specified";
  }

  async applyToJob(applyButton, jobDetails) {
    try {
      this.log(`📝 Applying to: ${jobDetails.title} at ${jobDetails.company}`);

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
        await this.delay(1000);
        return false;
      }

      await this.saveAppliedJob(jobDetails);
      return true;
    } catch (error) {
      await this.handleErrorState();
      await this.delay(1000);
      return false;
    }
  }

  async fillCurrentStep() {
    // Handle file upload questions first
    const fileUploadContainers = document.querySelectorAll(
      ".js-jobs-document-upload__container"
    );

    if (fileUploadContainers.length) {
      for (const container of fileUploadContainers) {
        this.statusManager.show(
          "Analyzing resumes for the perfect match",
          "info"
        );
        const userDetails = await this.userService.getUserDetails();
        const jobDescription = this.scrapeDescription();
        await this.fileHandler.handleFileUpload(
          container,
          userDetails,
          jobDescription
        );
      }
    }

    // Handle regular form questions
    const questions = document.querySelectorAll(".fb-dash-form-element");
    for (const question of questions) {
      await this.handleQuestion(question);
    }
  }

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

  async handleSelectQuestion(select) {
    const container = select.closest(".fb-dash-form-element");
    const labelElement = container.querySelector(
      ".fb-dash-form-element__label"
    );
    const label = labelElement?.textContent?.trim();

    const options = Array.from(select.options)
      .filter((opt) => opt.value !== "Select an option")
      .map((opt) => opt.text.trim());

    const answer = await this.aiService.getAnswer(label, options, {
      platform: this.platform,
      userData: await this.userService.getUserDetails(),
      jobDescription: this.scrapeDescription(),
    });

    select.value = answer;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async handleRadioQuestion(radio) {
    const label = this.getQuestionLabel(radio);
    const options = Array.from(
      radio.querySelectorAll('input[type="radio"]')
    ).map((input) => {
      const labelElement = document.querySelector(`label[for="${input.id}"]`);
      return labelElement ? labelElement.textContent : "Unknown";
    });

    const answer = await this.aiService.getAnswer(label, options, {
      platform: this.platform,
      userData: await this.userService.getUserDetails(),
      jobDescription: this.scrapeDescription(),
    });

    const answerElement = Array.from(radio.querySelectorAll("label")).find(
      (el) => el.textContent.includes(answer)
    );
    if (answerElement) answerElement.click();
  }

  async handleTextQuestion(textInput) {
    const label = this.getQuestionLabel(textInput);
    const answer = await this.aiService.getAnswer(label, [], {
      platform: this.platform,
      userData: await this.userService.getUserDetails(),
      jobDescription: this.scrapeDescription(),
    });

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
      await this.delay(1000);
      textInput.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown" })
      );
      await this.delay(500);
      textInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    }
  }

  async handleTextAreaQuestion(textArea) {
    const label = this.getQuestionLabel(textArea);
    const answer = await this.aiService.getAnswer(label, [], {
      platform: this.platform,
      userData: await this.userService.getUserDetails(),
      jobDescription: this.scrapeDescription(),
    });
    textArea.value = answer;
    textArea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async handleCheckboxQuestion(checkbox) {
    const label = this.getQuestionLabel(checkbox);
    const answer =
      (await this.aiService.getAnswer(label, ["Yes", "No"], {
        platform: this.platform,
        userData: await this.userService.getUserDetails(),
        jobDescription: this.scrapeDescription(),
      })) === "Yes";
    checkbox.checked = answer;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  }

  getQuestionSelector(type) {
    const selectors = {
      select: "select",
      radio:
        'fieldset[data-test-form-builder-radio-button-form-component="true"]',
      text: 'input[type="text"]',
      textarea: "textarea",
      checkbox: 'input[type="checkbox"]',
    };
    return selectors[type];
  }

  getQuestionLabel(element) {
    const container = element.closest(".fb-dash-form-element");
    if (!container) return "Unknown";

    const label = container.querySelector(
      "label, legend, .fb-dash-form-element__label"
    );
    if (!label) return "Unknown";

    return label.textContent.trim().replace(/\s+/g, " ");
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

  scrapeDescription() {
    const descriptionElement = document.querySelector(
      ".jobs-description-content__text"
    );
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
        continueApplying:
          'button[aria-label*="Easy Apply"][aria-label*="Continue applying"]',
        continueTips:
          'button[aria-label="I understand the tips and want to continue the apply process"]',
        saveJob: 'button[data-control-name="save_application_btn"]',
      };

      await this.waitForAnyElement(Object.values(buttonSelectors));

      if (await this.findAndClickButton(buttonSelectors.continueTips)) {
        await this.delay(2000);
        return "continue";
      }

      if (await this.findAndClickButton(buttonSelectors.continueApplying)) {
        await this.delay(2000);
        return "continue";
      }

      if (await this.findAndClickButton(buttonSelectors.saveJob)) {
        await this.delay(2000);
        return "saved";
      }

      if (await this.findAndClickButton(buttonSelectors.submit)) {
        await this.delay(2000);
        return "submitted";
      }

      if (await this.findAndClickButton(buttonSelectors.preview)) {
        await this.delay(2000);
        return "preview";
      }

      if (await this.findAndClickButton(buttonSelectors.next)) {
        await this.delay(2000);
        return "next";
      }

      if (
        (await this.findAndClickButton(buttonSelectors.dismiss)) ||
        (await this.findAndClickButton(buttonSelectors.done)) ||
        (await this.findAndClickButton(buttonSelectors.close))
      ) {
        await this.delay(2000);
        return "modal-closed";
      }

      return "error";
    } catch (error) {
      return "error";
    }
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

  async waitForAnyElement(selectors, timeout = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element && this.isElementVisible(element)) {
          return element;
        }
      }
      await this.delay(100);
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

  async handlePostSubmissionModal() {
    try {
      await this.delay(2000);

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
          await this.delay(1000);
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
      const closeButton = document.querySelector(
        "button[data-test-modal-close-btn]"
      );
      if (closeButton && this.isElementVisible(closeButton)) {
        closeButton.click();
        await this.delay(1000);

        const discardButton = document.querySelector(
          'button[data-control-name="discard_application_confirm_btn"]'
        );
        if (discardButton && this.isElementVisible(discardButton)) {
          discardButton.click();
          await this.delay(1000);
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
          await this.delay(1000);
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
          await this.delay(1000);
        }
      }
    } catch (error) {
      console.error("Error handling error state:", error);
    }
  }

  async saveAppliedJob(jobDetails) {
    try {
      return await this.applicationTracker.saveAppliedJob(jobDetails);
    } catch (error) {
      console.error("Error saving applied job:", error);
      return false;
    }
  }

  async goToNextPage(currentPage) {
    try {
      const nextButton = document.querySelector(
        ".jobs-search-pagination__button--next"
      );
      if (nextButton && !nextButton.disabled) {
        nextButton.click();
        await this.waitForPageLoad();
        return true;
      }

      const paginationContainer = document.querySelector(
        ".jobs-search-pagination__pages"
      );
      if (!paginationContainer) return false;

      const activeButton = paginationContainer.querySelector(
        ".jobs-search-pagination__indicator-button--active"
      );
      if (!activeButton) return false;

      const currentPageNum = parseInt(
        activeButton.querySelector("span").textContent
      );
      const pageIndicators = paginationContainer.querySelectorAll(
        ".jobs-search-pagination__indicator"
      );

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
        nextPageButton.click();
        await this.waitForPageLoad();
        return true;
      }

      return false;
    } catch (error) {
      console.error("Error navigating to next page:", error);
      return false;
    }
  }

  async initialScroll() {
    const jobsList = document.querySelector(".jobs-search-results-list");
    if (!jobsList) return;

    const totalHeight = jobsList.scrollHeight;
    const increment = Math.floor(totalHeight / 4);

    for (let i = 0; i <= totalHeight; i += increment) {
      jobsList.scrollTo(0, i);
      await this.delay(500);
    }

    jobsList.scrollTo(0, 0);
    await this.delay(1000);
  }

  async scrollAndWaitForNewJobs() {
    const jobsList = document.querySelector(".jobs-search-results-list");
    if (!jobsList) return false;

    const previousJobCount = document.querySelectorAll(
      ".jobs-search-results-list [data-occludable-job-id]"
    ).length;

    const currentScroll = jobsList.scrollTop;
    const targetScroll = currentScroll + window.innerHeight * 0.75;

    jobsList.scrollTo({
      top: targetScroll,
      behavior: "smooth",
    });

    await this.delay(2000);

    const newJobCount = document.querySelectorAll(
      ".jobs-search-results-list [data-occludable-job-id]"
    ).length;

    return newJobCount > previousJobCount;
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

  async generateComprehensiveSearchUrl(preferences) {
    const baseUrl = "https://www.linkedin.com/jobs/search/?";
    const params = new URLSearchParams();

    params.append("f_AL", "true"); // Easy Apply filter

    // Handle positions
    if (preferences.positions?.length) {
      params.append("keywords", preferences.positions.join(" OR "));
    }

    // Handle location
    if (preferences.location) {
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
      };

      if (preferences.location === "Remote") {
        params.append("f_WT", "2");
      } else if (geoIdMap[preferences.location]) {
        params.append("geoId", geoIdMap[preferences.location]);
      } else {
        params.append("location", preferences.location);
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
    }

    // Handle date posted
    const datePostedMap = {
      "Any time": "",
      "Past month": "r2592000",
      "Past week": "r604800",
      "Past 24 hours": "r86400",
    };

    if (preferences.datePosted && datePostedMap[preferences.datePosted]) {
      params.append("f_TPR", datePostedMap[preferences.datePosted]);
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

    // Sorting
    params.append("sortBy", "R");

    return baseUrl + params.toString();
  }

  // Handle DOM changes and navigation
  onDOMChange() {
    if (this.isRunning && !this.isPaused) {
      setTimeout(() => {
        this.getJobCards().catch(console.error);
      }, 1000);
    }
  }

  onNavigation(oldUrl, newUrl) {
    this.log(`🔄 Navigation detected: ${oldUrl} → ${newUrl}`);

    if (!newUrl.includes("linkedin.com/jobs") && this.isRunning) {
      setTimeout(() => {
        this.navigateToUrl(`${this.baseUrl}/jobs/search/`);
      }, 2000);
    }
  }
}
