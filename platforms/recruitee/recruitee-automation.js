// platforms/recruitee/recruitee-automation.js
import { RecruiteeFormHandler } from "./recruitee-form-handler.js";
import { RecruiteeFileHandler } from "./recruitee-file-handler.js";
import { API_HOST_URL } from "../../services/constants.js";

// Debugging helpers
function debugLog(message, ...args) {
  console.log(`[RecruiteeAutomation] ${message}`, ...args);
}

function errorLog(message, error) {
  console.error(`[RecruiteeAutomation Error] ${message}`, error);
  if (error?.stack) {
    console.error(error.stack);
  }
}

// Custom error types
class ApplicationError extends Error {
  constructor(message, details) {
    super(message);
    this.name = "ApplicationError";
    this.details = details;
  }
}

class SkipApplicationError extends ApplicationError {
  constructor(message) {
    super(message);
    this.name = "SkipApplicationError";
  }
}

// Configuration
const CONFIG = {
  SELECTORS: {
    JOB_LINKS: "a[href*='recruitee.com/o/'], a[href*='recruitee.com/career/']",
    GOOGLE_RESULTS:
      "#search .g, #rso .g, div[data-sokoban-container], #rso div[data-hveid], div[data-hveid], .g, .MjjYud, .Gx5Zad",
    NEXT_BUTTON:
      "button.btn-primary, button.btn-submit, button[type='submit'], button.button--primary, button.next-step, button.submit, button[data-ui='next'], button.c-button--primary",
    SUCCESS_MESSAGE:
      "div.application-confirmation, div.success-message, h1.success-message, div[class*='success'], div.thank-you, div[class*='thankyou'], div.c-application__done",
    APPLY_BUTTON:
      "a.c-button--primary, a.c-button--apply, a.cta-button, button.c-button--apply",
    FORM: "form.c-form, form#new_job_application, form.careers-form, form.application-form",
  },
  TIMEOUTS: {
    STANDARD: 2000,
    EXTENDED: 5000,
    MAX_TIMEOUT: 300000, // 5 minutes
  },
  DEBUG: true,
  BRAND_COLOR: "#4a90e2", // FastApply brand blue
};

/**
 * RecruiteeJobAutomation - Content script for automating Recruitee job applications
 */
export class RecruiteeJobAutomation {
  constructor(config = {}) {
    debugLog("Initializing RecruiteeJobAutomation");

    // Extract config properly
    this.userProfile = config.userProfile || null;
    this.sessionContext = config.sessionContext || null;
    this.userId = config.userId || null;
    this.sessionId = config.sessionId || null;

    // State tracking
    this.state = {
      initialized: false,
      ready: false,
      isApplicationInProgress: false,
      applicationStartTime: null,
      processedUrls: new Set(),
      processedLinksCount: 0,
      countDown: null,
      lastCheckedUrl: null,
      debounceTimers: {},
    };

    // Search data
    this.searchData = {
      limit: null,
      current: null,
      domain: null,
      submittedLinks: [],
      searchLinkPattern: null,
    };

    // Create file handler for resume uploads
    this.fileHandler = new RecruiteeFileHandler({
      show: (message, type) => {
        debugLog(`[${type || "info"}] ${message}`);
        this.appendStatusMessage(message);
      },
    });
  }

  /**
   * Start application process
   */
  async startApplying() {
    try {
      debugLog("Starting application process");
      this.appendStatusMessage("Starting application process");
      this.updateStatusIndicator("applying");

      // Check if page is valid
      if (
        document.body.innerText.includes("Cannot GET") ||
        document.body.innerText.includes("404 Not Found") ||
        document.body.innerText.includes("No longer available")
      ) {
        throw new SkipApplicationError(
          "Cannot start application: Page error or job no longer available"
        );
      }

      // Set application state
      this.state.isApplicationInProgress = true;
      this.state.applicationStartTime = Date.now();

      // Extract job ID from URL
      const urlParts = window.location.pathname.split("/");
      const jobId = urlParts[urlParts.length - 1] || "unknown";
      debugLog("Extracted job ID:", jobId);

      // Start countdown timer
      this.state.countDown = this.startCountDownTimer(60 * 5, () => {
        // Application timeout - parent platform will handle this
      });

      // Wait a moment for page to fully load
      await this.wait(3000);

      // Check if we're on a job details page or application form page
      const applyButton = document.querySelector(CONFIG.SELECTORS.APPLY_BUTTON);
      if (applyButton) {
        this.appendStatusMessage("Found apply button, clicking it");
        applyButton.click();
        await this.wait(3000);
      }

      // Apply for the job
      const applied = await this.apply();

      if (applied) {
        // Get job details from page
        const jobTitle =
          document.querySelector("h1")?.textContent.trim() ||
          document.title.split(" - ")[0] ||
          document.title ||
          "Job on Recruitee";

        // Extract company name from URL or page
        const companyName =
          this.extractCompanyFromUrl(window.location.href) ||
          document.querySelector('meta[property="og:site_name"]')?.content ||
          "Company on Recruitee";

        // Try to extract location from the page
        let location = "Not specified";
        const locationEl = document.querySelector(
          '.job-location, .c-job__info-item, [data-ui="location"]'
        );
        if (locationEl) {
          location = locationEl.textContent.trim();
        }

        // Application completed successfully - parent platform will handle this

        // Reset application state
        this.state.isApplicationInProgress = false;
        this.state.applicationStartTime = null;

        debugLog("Application completed successfully");
        this.appendStatusMessage("Application completed successfully");
        this.updateStatusIndicator("success");
      }
    } catch (error) {
      if (error instanceof SkipApplicationError) {
        errorLog("Application skipped:", error.message);
        this.appendStatusMessage("Application skipped: " + error.message);
      } else {
        errorLog("Application error:", error);
        this.appendStatusErrorMessage(error);
      }

      // Reset application state
      this.state.isApplicationInProgress = false;
      this.state.applicationStartTime = null;
    }
  }

  /**
   * Apply for the job
   */
  async apply() {
    try {
      this.appendStatusMessage("Starting to apply for job");

      // Check if we're on an apply page by looking for form
      const form = this.findApplicationForm();
      if (!form) {
        throw new SkipApplicationError("Cannot find application form");
      }

      // Get profile data if not already loaded
      if (!this.profile) {
        this.profile = await this.getProfileData();
      }

      // Extract job description
      const jobDescription = this.extractJobDescription();

      // Process the form
      const result = await this.processApplicationForm(
        form,
        this.profile,
        jobDescription
      );

      this.appendStatusMessage(
        "Form submission result: " + (result ? "SUCCESS" : "FAILED")
      );

      return result;
    } catch (error) {
      if (error instanceof SkipApplicationError) {
        throw error;
      } else {
        errorLog("Error in apply:", error);
        throw new ApplicationError(
          "Error during application process: " + this.errorToString(error)
        );
      }
    }
  }

  /**
   * Process the application form
   */
  async processApplicationForm(form, profile, jobDescription) {
    this.appendStatusMessage("Found application form, beginning to fill out");

    try {
      // Get the API host
      const aiApiHost = API_HOST_URL || "https://fastapply.co";

      // Initialize form handler
      this.formHandler = new RecruiteeFormHandler({
        logger: (message) => this.appendStatusMessage(message),
        host: aiApiHost,
        userData: profile,
        jobDescription,
      });

      // Handle multi-step form if present
      const isMultiStep = form.querySelector(".c-step, .steps-indicator");

      if (isMultiStep) {
        return await this.handleMultiStepForm(form, profile, jobDescription);
      }

      // Handle file uploads (resume)
      await this.fileHandler.handleResumeUpload(profile, form);

      // Fill out form fields using AI-enhanced RecruiteeFormHandler
      await this.formHandler.fillFormWithProfile(form, profile);

      // Handle required checkboxes
      await this.formHandler.handleRequiredCheckboxes(form);

      // Submit the form
      return await this.formHandler.submitForm(form);
    } catch (error) {
      errorLog("Error processing application form:", error);
      this.appendStatusErrorMessage(
        "Error processing form: " + this.errorToString(error)
      );
      return false;
    }
  }

  /**
   * Handle multi-step application form
   */
  async handleMultiStepForm(form, profile, jobDescription) {
    this.appendStatusMessage("Detected multi-step application form");

    try {
      // Get the API host
      const aiApiHost = API_HOST_URL || "https://fastapply.co";

      // Initialize form handler if not already done
      if (!this.formHandler) {
        this.formHandler = new RecruiteeFormHandler({
          logger: (message) => this.appendStatusMessage(message),
          host: aiApiHost,
          userData: profile,
          jobDescription,
        });
      }

      // Handle resume upload - typically on first step
      await this.fileHandler.handleResumeUpload(profile, form);

      // Process each step until we reach the end
      let isComplete = false;
      let stepCount = 0;
      const maxSteps = 10; // Safety limit

      while (!isComplete && stepCount < maxSteps) {
        stepCount++;
        this.appendStatusMessage(`Processing form step ${stepCount}`);

        // Fill out visible form fields
        await this.formHandler.fillFormWithProfile(form, profile);

        // Handle required checkboxes
        await this.formHandler.handleRequiredCheckboxes(form);

        // Find next/submit button
        const nextButton = this.formHandler.findSubmitButton(form);
        if (!nextButton) {
          throw new ApplicationError(
            `Cannot find next/submit button on step ${stepCount}`
          );
        }

        // Click the button
        this.appendStatusMessage(
          `Clicking next/submit button on step ${stepCount}`
        );
        nextButton.click();

        // Wait for page to update
        await this.wait(3000);

        // Check if we're done
        const successMessage = document.querySelector(
          CONFIG.SELECTORS.SUCCESS_MESSAGE
        );
        if (successMessage) {
          this.appendStatusMessage(
            "Found success message, application complete"
          );
          isComplete = true;
          return true;
        }

        // Check if there was an error
        const errorMessage = document.querySelector(
          ".error-message, .field_with_errors, .invalid-feedback"
        );
        if (errorMessage) {
          this.appendStatusMessage(
            `Error on step ${stepCount}: ${errorMessage.textContent.trim()}`
          );
          // Try to fix the error and continue
        }

        // Find form again (might have changed)
        form = this.findApplicationForm();
        if (!form) {
          this.appendStatusMessage(
            "Form no longer found, checking if application completed"
          );
          // Check alternative success indicators
          if (
            document.body.textContent.includes("Thank you") ||
            document.body.textContent.includes("Successfully")
          ) {
            isComplete = true;
            return true;
          } else {
            throw new ApplicationError(
              "Form disappeared without success message"
            );
          }
        }
      }

      if (stepCount >= maxSteps) {
        throw new ApplicationError("Exceeded maximum number of form steps");
      }

      return isComplete;
    } catch (error) {
      errorLog("Error in multi-step form:", error);
      throw error;
    }
  }

  /**
   * Search for job links and process them
   */
  searchNext() {
    debugLog("searchNext called - searching for job links");
    
    try {
      // Find job links on the current page
      const jobLinks = this.findJobLinks();
      
      if (jobLinks.length > 0) {
        debugLog(`Found ${jobLinks.length} job links`);
        this.processJobLinks(jobLinks);
      } else {
        debugLog("No job links found on current page");
      }
    } catch (error) {
      errorLog("Error in searchNext:", error);
    }
  }

  /**
   * Find job links on the current page
   */
  findJobLinks() {
    const links = document.querySelectorAll(CONFIG.SELECTORS.JOB_LINKS);
    const validLinks = [];

    for (const link of links) {
      const href = link.href;
      
      // Check if link matches the search pattern
      if (this.searchData.searchLinkPattern && !this.searchData.searchLinkPattern.test(href)) {
        continue;
      }

      // Check if already processed
      if (this.state.processedUrls.has(href)) {
        continue;
      }

      // Check if in submitted links
      const isSubmitted = this.searchData.submittedLinks.some(
        submitted => submitted.url === href
      );
      
      if (!isSubmitted) {
        validLinks.push({
          url: href,
          title: link.textContent.trim(),
          element: link
        });
        this.state.processedUrls.add(href);
      }
    }

    return validLinks;
  }

  /**
   * Process found job links
   */
  processJobLinks(jobLinks) {
    jobLinks.forEach((jobLink, index) => {
      // Mark link as processed
      this.markLinkAsProcessed(jobLink.element);
      
      debugLog(`Processed job link ${index + 1}/${jobLinks.length}: ${jobLink.title}`);
    });

    this.state.processedLinksCount += jobLinks.length;
    this.appendStatusMessage(`Processed ${jobLinks.length} job links`);
  }

  /**
   * Mark a link as processed visually
   */
  markLinkAsProcessed(linkElement) {
    if (linkElement && typeof this.markLinkAsColor === 'function') {
      this.markLinkAsColor(linkElement, 'processed');
    }
  }

  // Utility methods
  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  debounce(key, fn, delay) {
    if (this.state.debounceTimers[key]) {
      clearTimeout(this.state.debounceTimers[key]);
    }
    this.state.debounceTimers[key] = setTimeout(() => {
      delete this.state.debounceTimers[key];
      fn();
    }, delay);
  }

  errorToString(e) {
    if (e instanceof Error) {
      if (e.stack) {
        return e.stack;
      }
      return e.message;
    }
    return String(e);
  }

  extractCompanyFromUrl(url) {
    try {
      const matches = url.match(/\/\/(.+?)\.recruitee\.com\//);
      if (matches && matches[1]) {
        return (
          matches[1].charAt(0).toUpperCase() +
          matches[1].slice(1).replace(/-/g, " ")
        );
      }
      return null;
    } catch (error) {
      return null;
    }
  }

  extractJobDescription() {
    let description = "";

    const descriptionSelectors = [
      ".c-job__description",
      ".job-description",
      ".description",
      '[data-ui="job-description"]',
      ".vacancy-description",
      "#job-details",
    ];

    for (const selector of descriptionSelectors) {
      const descElement = document.querySelector(selector);
      if (descElement) {
        description = descElement.textContent.trim();
        break;
      }
    }

    if (!description) {
      const mainContent = document.querySelector(
        "main, #content, .content, .job-content"
      );
      if (mainContent) {
        description = mainContent.textContent.trim();
      }
    }

    if (!description) {
      const jobTitle = document.title || "";
      const companyName =
        this.extractCompanyFromUrl(window.location.href) || "";
      description = `Job: ${jobTitle} at ${companyName}`;
    }

    return description;
  }

  findApplicationForm() {
    const formSelectors = CONFIG.SELECTORS.FORM.split(", ");

    for (const selector of formSelectors) {
      const forms = document.querySelectorAll(selector);
      if (forms.length) {
        for (const form of forms) {
          if (this.isElementVisible(form)) {
            return form;
          }
        }
      }
    }

    const allForms = document.querySelectorAll("form");
    for (const form of allForms) {
      if (
        this.isElementVisible(form) &&
        form.querySelectorAll("input, select, textarea").length > 0
      ) {
        return form;
      }
    }

    return null;
  }

  isElementVisible(element) {
    try {
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

      return true;
    } catch (error) {
      return true;
    }
  }

  // Status methods (to be implemented by parent or UI layer)
  appendStatusMessage(message) {
    console.log(`[Recruitee] ${message}`);
  }

  appendStatusErrorMessage(error) {
    console.error(`[Recruitee Error] ${error}`);
  }

  updateStatusIndicator(status) {
    console.log(`[Recruitee Status] ${status}`);
  }

  // Stub methods that need to be implemented
  startCountDownTimer(duration, callback) {
    return {
      stop: () => {},
      addTime: () => {},
    };
  }

  async getProfileData() {
    return this.profile || this.userProfile;
  }

  cleanup() {
    // Clear any timers
    Object.values(this.state.debounceTimers).forEach(timer => {
      if (timer) clearTimeout(timer);
    });
    this.state.debounceTimers = {};

    // Stop countdown if active
    if (this.state.countDown && this.state.countDown.stop) {
      this.state.countDown.stop();
    }

    // Reset state
    this.state.isApplicationInProgress = false;
    this.state.applicationStartTime = null;
  }
}