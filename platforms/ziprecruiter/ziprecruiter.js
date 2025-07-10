// platforms/ziprecruiter/ziprecruiter.js
import BasePlatform from "../base-platform.js";
import AIService from "../../services/ai-service.js";
import ApplicationTrackerService from "../../services/application-tracker-service.js";
import UserService from "../../services/user-service.js";
import { StatusOverlay } from "../../services/index.js";
import FileHandlerService from "../../services/file-handler-service.js";
import ZipRecruiterFormHandler from "./ziprecruiter-form-handler.js";

export default class ZipRecruiterPlatform extends BasePlatform {
  constructor(config) {
    super(config);
    this.platform = "ziprecruiter";
    this.baseUrl = "https://www.ziprecruiter.com";
    this.hasStarted = false;
    this.automationStarted = false;
    this.processedJobs = new Set();
    this.answerCache = new Map();

    // Initialize services
    const apiHost =
      config.apiHost || config.config?.apiHost || "http://localhost:3000";
    this.HOST = apiHost;

    this.aiService = new AIService({ apiHost });
    this.appTracker = new ApplicationTrackerService({
      apiHost,
      userId: config.userId,
    });
    this.userService = new UserService({ apiHost, userId: config.userId });

    this.statusOverlay = new StatusOverlay({
      id: "ziprecruiter-status-overlay",
      title: "ZIPRECRUITER AUTOMATION",
      icon: "⚡",
      position: { top: "10px", right: "10px" },
    });

    this.fileHandler = new FileHandlerService({ apiHost });
    this.fileHandler.setStatusManager(this.statusOverlay);

    // ZipRecruiter specific state
    this.state = {
      initialized: false,
      ready: false,
      isRunning: false,
      isApplicationInProgress: false,
      applicationStartTime: null,
      formDetected: false,
      processedCards: new Set(),
      processedCount: 0,
      currentJobIndex: 0,
      lastProcessedCard: null,
      currentJobDetails: null,
      lastActivity: Date.now(),
      jobProcessingLock: false,
      currentPage: 1,
      totalPages: 0,
      noMorePages: false,
    };

    this.config = {
      SELECTORS: {
        JOB_CARDS: ".job_result_two_pane",
        JOB_TITLE: "h2.font-bold.text-primary",
        COMPANY_NAME: "[data-testid='job-card-company']",
        LOCATION: "[data-testid='job-card-location']",
        SALARY: "p.text-primary:contains('$')",
        APPLY_BUTTON: "button[aria-label*='1-Click Apply']",
        APPLIED_INDICATOR: "button[aria-label*='Applied']",
        MODAL_CONTAINER: ".ApplyingToHeader",
        MODAL_QUESTIONS: ".question_form fieldset",
        MODAL_SELECT: "[role='combobox']",
        MODAL_SELECT_OPTIONS: "[role='listbox'] li",
        MODAL_CONTINUE_BUTTON: "button[type='submit']",
        MODAL_SUCCESS: ".apply-success, .application-success",
        NO_JOBS_FOUND: ".jobs_not_found",
        NEXT_PAGE_BUTTON: "a[title='Next Page']",
        PAGINATION_CONTAINER: ".pagination_container_two_pane",
        LAST_PAGE_INDICATOR: "button[title='Next Page'][disabled]",
      },
      TIMEOUTS: {
        STANDARD: 3000,
        EXTENDED: 8000,
        APPLICATION_TIMEOUT: 8 * 60 * 1000, // 8 minutes
      },
    };

    this.log(`🔧 ZipRecruiter services initialized with API host: ${apiHost}`);
  }

  async initialize() {
    await super.initialize();
    this.log("🔗 ZipRecruiter platform initialized");

    // Create status overlay
    this.statusOverlay.create();
    this.statusOverlay.addSuccess("ZipRecruiter automation initialized");

    this.state.initialized = true;
    this.state.ready = true;
  }

  async start(params = {}) {
    if (this.hasStarted) {
      this.log("⚠️ ZipRecruiter automation already started");
      this.statusOverlay.addWarning("ZipRecruiter automation already started");
      return;
    }

    this.hasStarted = true;
    this.isRunning = true;
    this.state.isRunning = true;
    this.log("🚀 Starting ZipRecruiter automation");
    this.statusOverlay.addInfo("Starting ZipRecruiter automation");

    try {
      // Merge config
      this.config = { ...this.config, ...params };

      // Update services with proper userId
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

      this.log("📋 Configuration loaded:", {
        jobsToApply: this.config.jobsToApply,
        userId: this.config.userId,
      });

      if (!this.config.jobsToApply || this.config.jobsToApply <= 0) {
        throw new Error("Invalid jobsToApply configuration");
      }

      // Check user authorization
      await this.checkUserAuthorization();

      this.updateProgress({ total: this.config.jobsToApply });

      // Wait for page readiness
      await this.waitForPageLoad();
      this.log("📄 Page loaded, current URL:", window.location.href);

      // Check if we're on the right page
      const currentUrl = window.location.href.toLowerCase();
      if (!currentUrl.includes("ziprecruiter.com")) {
        throw new Error("Not on ZipRecruiter domain");
      }

      // Check if no jobs were found
      if (this.checkNoJobsFound()) {
        this.statusOverlay.addWarning("No jobs found for this search");
        this.log("No jobs found for this search");
        return;
      }

      // Detect pagination info
      this.detectPaginationInfo();

      // Start processing jobs
      this.automationStarted = true;
      this.statusOverlay.updateStatus("applying", "Processing jobs");
      await this.processJobs();
    } catch (error) {
      this.hasStarted = false;
      this.reportError(error, { phase: "start" });
      this.statusOverlay.addError("Failed to start: " + error.message);
    }
  }

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

  async processJobs() {
    let appliedCount = 0;
    let skippedCount = 0;
    let currentPage = 1;
    let noNewJobsCount = 0;
    const MAX_NO_NEW_JOBS = 3;
    const targetJobs = this.config.jobsToApply;

    try {
      this.log(`Starting to process jobs. Target: ${targetJobs} jobs`);
      this.statusOverlay.addInfo(`Starting to process ${targetJobs} jobs`);

      while (appliedCount < targetJobs && this.state.isRunning) {
        if (
          this.state.isApplicationInProgress ||
          this.state.jobProcessingLock
        ) {
          this.log("Application in progress, waiting...");
          await this.delay(5000);
          continue;
        }

        const jobCards = this.getUnprocessedJobCards();
        this.log(`Found ${jobCards.length} job cards on page ${currentPage}`);

        if (jobCards.length === 0) {
          if (this.state.noMorePages) {
            this.log("No more jobs or pages to process");
            this.statusOverlay.addWarning("No more jobs available");
            break;
          }

          if (await this.goToNextPage()) {
            currentPage++;
            this.log(`Navigated to page ${currentPage}`);
            this.statusOverlay.addInfo(`Moving to page ${currentPage}`);
            await this.waitForPageLoad();
            continue;
          } else {
            this.log("No more pages available");
            break;
          }
        }

        let newApplicableJobsFound = false;

        for (const jobCard of jobCards) {
          if (appliedCount >= targetJobs || !this.state.isRunning) break;

          const jobId = this.getJobIdFromCard(jobCard);
          if (!jobId || this.state.processedCards.has(jobId)) continue;

          this.state.processedCards.add(jobId);
          newApplicableJobsFound = true;

          try {
            // Acquire processing lock
            this.state.jobProcessingLock = true;
            this.state.lastProcessedCard = jobCard;

            // Extract job details and click
            const jobDetails = this.extractJobDetailsFromCard(jobCard);
            this.state.currentJobDetails = jobDetails;

            this.log(
              `Processing job: ${jobDetails.title} at ${jobDetails.company}`
            );
            this.statusOverlay.addInfo(`Processing: ${jobDetails.title}`);

            // Begin application process
            await this.beginApplication();

            // Click job card and process
            await this.clickJobCard(jobCard);
            await this.waitForJobDetailsLoad();

            // Process the application
            const success = await this.processJobApplication(
              jobCard,
              jobDetails
            );

            if (success) {
              appliedCount++;
              this.updateProgress({ completed: appliedCount });
              await this.userService.updateApplicationCount();

              this.log(
                `Successfully applied to job ${appliedCount}/${targetJobs}`
              );
              this.statusOverlay.addSuccess(
                `Applied to job ${appliedCount}/${targetJobs}`
              );

              this.reportApplicationSubmitted(jobDetails, {
                method: "1-Click Apply",
                userId: this.config.userId,
              });
            } else {
              skippedCount++;
              this.updateProgress({ failed: this.progress.failed + 1 });
            }

            await this.endApplication(success);
          } catch (error) {
            this.log(`Error processing job ${jobId}: ${error.message}`);
            this.statusOverlay.addError(
              `Error processing job: ${error.message}`
            );
            await this.endApplication(false);
          } finally {
            this.state.jobProcessingLock = false;
            await this.delay(2000); // Rate limiting
          }
        }

        if (!newApplicableJobsFound) {
          noNewJobsCount++;
          if (noNewJobsCount >= MAX_NO_NEW_JOBS) {
            this.log("No more applicable jobs found");
            break;
          }
        } else {
          noNewJobsCount = 0;
        }
      }

      const message =
        appliedCount >= targetJobs
          ? `Successfully applied to target of ${appliedCount}/${targetJobs} jobs`
          : `Applied to ${appliedCount}/${targetJobs} jobs - no more jobs available`;

      this.log(message);
      this.statusOverlay.addSuccess(message);
      this.reportComplete();
    } catch (error) {
      this.log("Error in processJobs:", error.message);
      this.statusOverlay.addError("Error in processJobs: " + error.message);
      this.reportError(error, { phase: "processJobs" });
    }
  }

  async processJobApplication(jobCard, jobDetails) {
    try {
      // Find apply button
      const applyButton = await this.findApplyButton();
      if (!applyButton || !this.isElementVisible(applyButton)) {
        this.log("No apply button found, skipping job");
        this.markJobCard(jobCard, "skipped");
        return false;
      }

      // Check if already applied
      if (applyButton.textContent.includes("Applied")) {
        this.log("Job already applied to");
        this.markJobCard(jobCard, "already_applied");
        return false;
      }

      // Check if already applied using service
      const alreadyApplied = await this.appTracker.checkIfAlreadyApplied(
        jobDetails.jobId
      );
      if (alreadyApplied) {
        this.log("Already applied to job (from database)");
        this.markJobCard(jobCard, "already_applied");
        return false;
      }

      this.log("Starting application process");
      this.markJobCard(jobCard, "processing");

      // Click apply button
      applyButton.click();
      await this.delay(2000);

      // Handle application flow
      const success = await this.handleApplicationFlow(jobDetails);

      if (success) {
        this.markJobCard(jobCard, "applied");
        await this.saveAppliedJob(jobDetails);
        return true;
      } else {
        this.markJobCard(jobCard, "error");
        return false;
      }
    } catch (error) {
      this.log(`Error in job application: ${error.message}`);
      this.markJobCard(jobCard, "error");
      return false;
    }
  }

  async handleApplicationFlow(jobDetails) {
    try {
      // Wait for modal or success to appear
      await this.delay(1500);

      // Check for modal
      const modalContainer = document.querySelector(
        this.config.SELECTORS.MODAL_CONTAINER
      );

      if (modalContainer && this.isElementVisible(modalContainer)) {
        this.log("Application modal detected - handling form");
        return await this.handleApplicationForm(jobDetails);
      }

      // Check for instant success
      const appliedButton = document.querySelector(
        this.config.SELECTORS.APPLIED_INDICATOR
      );
      if (appliedButton) {
        this.log("Application submitted instantly");
        return true;
      }

      // Check for success in page content
      const pageContent = document.body.innerText.toLowerCase();
      const successPhrases = [
        "application submitted",
        "successfully applied",
        "thank you for applying",
        "application complete",
      ];

      if (successPhrases.some((phrase) => pageContent.includes(phrase))) {
        this.log("Application success detected in content");
        return true;
      }

      this.log("No success indicators found");
      return false;
    } catch (error) {
      this.log(`Error in application flow: ${error.message}`);
      return false;
    }
  }

  async handleApplicationForm(jobDetails) {
    try {
      const userDetails = await this.userService.getUserDetails();
      const formHandler = new ZipRecruiterFormHandler({
        logger: (message) => this.statusOverlay.addInfo(message),
        userData: userDetails,
        jobDescription: this.scrapeJobDescription(jobDetails),
        fileHandler: this.fileHandler,
        aiService: this.aiService,
      });

      return await formHandler.fillCompleteForm();
    } catch (error) {
      this.log(`Form handling error: ${error.message}`);
      await this.closeFailedApplicationModals();
      return false;
    }
  }

  // Helper methods
  async beginApplication() {
    this.state.isApplicationInProgress = true;
    this.state.applicationStartTime = Date.now();
    this.statusOverlay.addInfo("Application process started");
  }

  async endApplication(success) {
    this.state.isApplicationInProgress = false;
    this.state.applicationStartTime = null;
    this.state.formDetected = false;

    if (success) {
      this.statusOverlay.addSuccess("Application completed successfully");
    } else {
      this.statusOverlay.addWarning("Application process ended");
    }
  }

  checkNoJobsFound() {
    return !!document.querySelector(this.config.SELECTORS.NO_JOBS_FOUND);
  }

  detectPaginationInfo() {
    try {
      const paginationContainer = document.querySelector(
        this.config.SELECTORS.PAGINATION_CONTAINER
      );

      if (!paginationContainer) {
        this.state.totalPages = 1;
        return;
      }

      const pageLinks =
        paginationContainer.querySelectorAll("a[title^='Page:']");
      if (pageLinks.length > 0) {
        const pageNumbers = Array.from(pageLinks)
          .map((link) => {
            const match = link.getAttribute("title").match(/Page: (\d+)/);
            return match ? parseInt(match[1], 10) : 0;
          })
          .filter((num) => num > 0);

        if (pageNumbers.length > 0) {
          this.state.totalPages = Math.max(...pageNumbers);
        }
      }

      // Check if on last page
      const nextPageDisabled = paginationContainer.querySelector(
        this.config.SELECTORS.LAST_PAGE_INDICATOR
      );
      if (nextPageDisabled) {
        this.state.noMorePages = true;
      }

      this.log(
        `Pagination detected: Page ${this.state.currentPage} of ${this.state.totalPages}`
      );
    } catch (error) {
      this.state.currentPage = 1;
      this.state.totalPages = 1;
    }
  }

  getUnprocessedJobCards() {
    const allCards = document.querySelectorAll(this.config.SELECTORS.JOB_CARDS);
    return Array.from(allCards).filter((card) => {
      const cardId = this.getJobIdFromCard(card);
      return cardId && !this.state.processedCards.has(cardId);
    });
  }

  getJobIdFromCard(jobCard) {
    try {
      const dataId =
        jobCard.getAttribute("data-job-id") ||
        jobCard.getAttribute("data-id") ||
        jobCard.id;

      if (dataId) return dataId;

      const jobLink = jobCard.querySelector(
        "a[href*='ziprecruiter.com/jobs/']"
      );
      if (jobLink?.href) return jobLink.href;

      const title =
        jobCard
          .querySelector(this.config.SELECTORS.JOB_TITLE)
          ?.textContent.trim() || "";
      const company =
        jobCard
          .querySelector(this.config.SELECTORS.COMPANY_NAME)
          ?.textContent.trim() || "";

      return `${title}-${company}`.replace(/\s+/g, "").toLowerCase();
    } catch (error) {
      return Math.random().toString(36).substring(2, 15);
    }
  }

  extractJobDetailsFromCard(jobCard) {
    try {
      const title =
        jobCard
          .querySelector(this.config.SELECTORS.JOB_TITLE)
          ?.textContent.trim() || "Unknown Position";
      const company =
        jobCard
          .querySelector(this.config.SELECTORS.COMPANY_NAME)
          ?.textContent.trim() || "Unknown Company";
      const location =
        jobCard
          .querySelector(this.config.SELECTORS.LOCATION)
          ?.textContent.trim() || "Unknown Location";

      const jobId = this.getJobIdFromCard(jobCard);
      const jobUrl = window.location.href;

      return {
        jobId,
        title,
        company,
        location,
        jobUrl,
        platform: this.platform,
        extractedAt: Date.now(),
      };
    } catch (error) {
      return {
        jobId: "",
        title: "Unknown Position",
        company: "Unknown Company",
        location: "Unknown Location",
        jobUrl: window.location.href,
        platform: this.platform,
      };
    }
  }

  markJobCard(jobCard, status) {
    try {
      if (!jobCard) return;

      const existingHighlight = jobCard.querySelector(".job-highlight");
      if (existingHighlight) existingHighlight.remove();

      const highlight = document.createElement("div");
      highlight.className = "job-highlight";

      const statusConfig = {
        processing: { color: "#2196F3", text: "Processing" },
        applied: { color: "#4CAF50", text: "Applied" },
        already_applied: { color: "#8BC34A", text: "Already Applied" },
        skipped: { color: "#FF9800", text: "Skipped" },
        error: { color: "#F44336", text: "Error" },
      };

      const config = statusConfig[status] || {
        color: "#9E9E9E",
        text: "Unknown",
      };

      highlight.style.cssText = `
        position: absolute;
        top: 0;
        right: 0;
        background-color: ${config.color};
        color: white;
        padding: 3px 8px;
        font-size: 12px;
        font-weight: bold;
        border-radius: 0 0 0 5px;
        z-index: 999;
      `;
      highlight.textContent = config.text;

      jobCard.style.border = `2px solid ${config.color}`;
      jobCard.style.position = "relative";
      jobCard.appendChild(highlight);
    } catch (error) {
      this.log("Error marking job card:", error.message);
    }
  }

  async findApplyButton() {
    try {
      const button = await this.waitForElement(
        this.config.SELECTORS.APPLY_BUTTON,
        5000
      );
      return button;
    } catch (error) {
      return null;
    }
  }

  async clickJobCard(jobCard) {
    try {
      const clickableElement = jobCard.querySelector("h2 a") || jobCard;
      clickableElement.click();
      await this.delay(2000);
      return true;
    } catch (error) {
      throw new Error("Failed to click job card");
    }
  }

  async waitForJobDetailsLoad() {
    await this.delay(1000);
    // Basic wait - ZipRecruiter loads details quickly
  }

  async goToNextPage() {
    try {
      const nextButton = document.querySelector(
        this.config.SELECTORS.NEXT_PAGE_BUTTON
      );

      if (nextButton && this.isElementVisible(nextButton)) {
        const isDisabled =
          nextButton.hasAttribute("disabled") ||
          nextButton.classList.contains("disabled");

        if (isDisabled) {
          this.state.noMorePages = true;
          return false;
        }

        this.state.currentPage++;
        nextButton.click();
        return true;
      }

      this.state.noMorePages = true;
      return false;
    } catch (error) {
      return false;
    }
  }

  async closeFailedApplicationModals() {
    try {
      const closeButtons = Array.from(
        document.querySelectorAll(
          'button[title="Close"], button[aria-label="Close"]'
        )
      );

      for (const button of closeButtons) {
        if (this.isElementVisible(button)) {
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

  async saveAppliedJob(jobDetails) {
    try {
      const success = await this.appTracker.saveAppliedJob({
        jobId: jobDetails.jobId,
        title: jobDetails.title,
        company: jobDetails.company,
        location: jobDetails.location,
        jobUrl: window.location.href,
        salary: jobDetails.salary || "Not specified",
        platform: this.platform,
      });

      if (success) {
        await this.appTracker.updateApplicationCount();
        this.log(`✅ Job application saved: ${jobDetails.title}`);
        return true;
      }
      return false;
    } catch (error) {
      this.log(`❌ Error saving job application: ${error.message}`);
      return false;
    }
  }

  scrapeJobDescription(jobDetails) {
    const descriptionElement = document.querySelector(
      ".job-description, .job-details-description"
    );
    if (descriptionElement) {
      return descriptionElement.textContent.trim();
    }
    return `${jobDetails.title} at ${jobDetails.company} in ${jobDetails.location}`;
  }

  // Utility methods
  async waitForPageLoad() {
    try {
      await this.waitForElement(this.config.SELECTORS.JOB_CARDS, 10000);
      await this.delay(2000);
    } catch (error) {
      this.log("Page load timeout");
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

  isElementVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      rect.width > 0 &&
      rect.height > 0
    );
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
    if (!newUrl.includes("ziprecruiter.com") && this.isRunning) {
      this.log("⚠️ Navigated away from ZipRecruiter");
      this.statusOverlay.addWarning("Navigated away from ZipRecruiter");
    }
  }

  async pause() {
    await super.pause();
    this.state.isRunning = false;
    this.statusOverlay.addWarning("ZipRecruiter automation paused");
  }

  async resume() {
    await super.resume();
    this.state.isRunning = true;
    this.statusOverlay.addSuccess("ZipRecruiter automation resumed");
  }

  async stop() {
    await super.stop();
    this.hasStarted = false;
    this.automationStarted = false;
    this.state.isRunning = false;
    this.statusOverlay.addWarning("ZipRecruiter automation stopped");
  }

  cleanup() {
    super.cleanup();
    this.state.processedCards.clear();
    this.answerCache.clear();

    if (this.statusOverlay) {
      this.statusOverlay.destroy();
    }

    this.log("🧹 ZipRecruiter platform cleanup completed");
  }
}
