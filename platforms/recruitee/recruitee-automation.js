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
  constructor() {
    debugLog("Initializing RecruiteeJobAutomation");

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

    // Connection to background script
    this.port = null;
    this.portReconnectTimer = null;
    this.messageQueue = [];
    this.isProcessingQueue = false;

    // Search data
    this.searchData = {
      limit: null,
      current: null,
      domain: null,
      submittedLinks: [],
      searchLinkPattern: null,
    };

    // Create status overlay
    this.createStatusOverlay();

    // Create file handler for resume uploads
    this.fileHandler = new RecruiteeFileHandler({
      show: (message, type) => {
        debugLog(`[${type || "info"}] ${message}`);
        this.appendStatusMessage(message);
      },
    });

    // Initialize based on page type
    this.initializeConnection();
    this.detectPageTypeAndInitialize();

    // Set up health check timer
    this.healthCheckTimer = setInterval(() => this.checkHealth(), 30000);
  }

  /**
   * Initialize connection with the background script
   */
  initializeConnection() {
    try {
      debugLog("Initializing communication with background script");

      // Clean up existing connection if any
      if (this.port) {
        try {
          this.port.disconnect();
        } catch (e) {
          // Ignore errors when disconnecting
        }
        this.port = null;
      }

      // Determine port name based on the current page type
      const isApplyPage = window.location.href.match(
        /(recruitee\.com\/(o|career))/i
      );
      const tabId = Date.now(); // Using timestamp as a unique identifier
      const portName = isApplyPage
        ? `recruitee-apply-${tabId}`
        : `recruitee-search-${tabId}`;

      debugLog(`Creating connection with port name: ${portName}`);

      // Create the connection
      this.port = chrome.runtime.connect({ name: portName });

      if (!this.port) {
        throw new Error(
          "Failed to establish connection with background script"
        );
      }

      // Set up message listener
      this.port.onMessage.addListener((message) =>
        this.handlePortMessage(message)
      );

      // Handle disconnection
      this.port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        if (error) {
          debugLog("Port disconnected due to error:", error);
        } else {
          debugLog("Port disconnected");
        }

        this.port = null;

        // Schedule reconnection after a delay
        if (!this.portReconnectTimer) {
          this.portReconnectTimer = setTimeout(() => {
            debugLog("Attempting to reconnect");
            this.initializeConnection();
            this.portReconnectTimer = null;
          }, 5000);
        }
      });

      // Start keepalive interval
      this.startKeepAliveInterval();

      // Process any queued messages
      if (this.messageQueue.length > 0 && !this.isProcessingQueue) {
        this.processMessageQueue();
      }

      return true;
    } catch (error) {
      errorLog("Error initializing connection:", error);

      // Schedule reconnection after a delay
      if (!this.portReconnectTimer) {
        this.portReconnectTimer = setTimeout(() => {
          debugLog("Attempting to reconnect after error");
          this.initializeConnection();
          this.portReconnectTimer = null;
        }, 5000);
      }

      return false;
    }
  }

  /**
   * Start keepalive interval to maintain connection
   */
  startKeepAliveInterval() {
    // Clear any existing interval
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }

    // Send keepalive every 25 seconds
    this.keepAliveInterval = setInterval(() => {
      this.safeSendMessage({ type: "KEEPALIVE" });
    }, 25000);
  }

  /**
   * Queue a message to be sent when connection is available
   */
  safeSendMessage(message) {
    // Add message to queue with timestamp
    this.messageQueue.push({
      ...message,
      timestamp: Date.now(),
    });

    // Start processing queue if not already in progress
    if (!this.isProcessingQueue) {
      this.processMessageQueue();
    }
  }

  /**
   * Process queued messages
   */
  async processMessageQueue() {
    if (this.isProcessingQueue || this.messageQueue.length === 0) {
      return;
    }

    this.isProcessingQueue = true;

    try {
      // Check if we have a connection
      if (!this.port) {
        debugLog("No connection available, attempting to reconnect");
        this.initializeConnection();

        // Wait for connection to establish
        await new Promise((resolve) => setTimeout(resolve, 500));

        // If still no connection, try again later
        if (!this.port) {
          this.isProcessingQueue = false;
          setTimeout(() => this.processMessageQueue(), 2000);
          return;
        }
      }

      // Process the oldest message in the queue
      const message = this.messageQueue.shift();

      try {
        this.port.postMessage(message);
        debugLog("Sent message:", message.type);
      } catch (error) {
        debugLog("Error sending message, reconnecting:", error);

        // Put the message back in the queue
        this.messageQueue.unshift(message);

        // Try to reconnect
        this.initializeConnection();

        // Delay before trying again
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // Continue processing queue after a small delay
      setTimeout(() => {
        this.isProcessingQueue = false;
        this.processMessageQueue();
      }, 100);
    } catch (error) {
      errorLog("Error processing message queue:", error);

      // Reset processing flag and try again later
      setTimeout(() => {
        this.isProcessingQueue = false;
        this.processMessageQueue();
      }, 2000);
    }
  }

  /**
   * Handle messages received through the port
   */
  handlePortMessage(message) {
    try {
      debugLog("Received port message:", message);

      const { type, data } = message || {};

      if (!type) {
        debugLog("Received message without type, ignoring");
        return;
      }

      switch (type) {
        case "SEARCH_TASK_DATA":
          this.handleSearchTaskData(data);
          break;

        case "APPLICATION_TASK_DATA":
          this.handleApplicationTaskData(data);
          break;

        case "APPLICATION_STARTING":
          this.handleApplicationStarting(data);
          break;

        case "APPLICATION_STATUS":
          this.handleApplicationStatus(data);
          break;

        case "PROFILE_DATA":
          this.handleProfileData(data);
          break;

        case "DUPLICATE":
          this.handleDuplicate(data);
          break;

        case "SEARCH_NEXT":
          this.handleSearchNext(data);
          break;

        case "ERROR":
          this.handleError(message);
          break;

        case "KEEPALIVE_RESPONSE":
          // Just a ping-pong response, no action needed
          break;

        default:
          debugLog(`Unhandled message type: ${type}`);
      }
    } catch (error) {
      errorLog("Error handling port message:", error);
    }
  }

  /**
   * Detect the page type and initialize accordingly
   */
  detectPageTypeAndInitialize() {
    const url = window.location.href;
    debugLog("Detecting page type for:", url);

    // Wait for page to load fully
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", () =>
        this.initializeByPageType(url)
      );
    } else {
      this.initializeByPageType(url);
    }
  }

  /**
   * Initialize based on detected page type
   */
  initializeByPageType(url) {
    debugLog("Initializing by page type:", url);

    if (url.includes("google.com/search")) {
      debugLog("On Google search page");
      this.appendStatusMessage("Google search page detected");
      this.safeSendMessage({ type: "GET_SEARCH_TASK" });
    } else if (url.match(/(recruitee\.com\/(o|career))/i)) {
      debugLog("On Recruitee job page");
      this.appendStatusMessage("Recruitee job page detected");
      this.safeSendMessage({ type: "GET_APPLICATION_TASK" });
    }
  }

  /**
   * Handle search task data
   */
  handleSearchTaskData(data) {
    try {
      debugLog("Processing search task data:", data);

      if (!data) {
        debugLog("No search task data provided");
        return;
      }

      // Extract and store search parameters
      const { limit, current, domain, submittedLinks, searchLinkPattern } =
        data;

      this.searchData.limit = limit;
      this.searchData.current = current;
      this.searchData.domain = domain;

      // Process submitted links to include tries count
      this.searchData.submittedLinks = submittedLinks
        ? submittedLinks.map((link) => ({ ...link, tries: 0 }))
        : [];

      // Convert search link pattern string to RegExp if needed
      if (searchLinkPattern) {
        try {
          if (typeof searchLinkPattern === "string") {
            const patternParts = searchLinkPattern.match(/^\/(.*)\/([gimy]*)$/);
            if (patternParts) {
              this.searchData.searchLinkPattern = new RegExp(
                patternParts[1],
                patternParts[2]
              );
            } else {
              this.searchData.searchLinkPattern = new RegExp(searchLinkPattern);
            }
          } else {
            this.searchData.searchLinkPattern = searchLinkPattern;
          }
        } catch (regexErr) {
          errorLog("Error parsing search link pattern:", regexErr);
          this.searchData.searchLinkPattern = null;
        }
      }

      debugLog("Search data initialized:", this.searchData);

      // Update state
      this.state.ready = true;
      this.state.initialized = true;

      this.appendStatusMessage("Search initialization complete");
      this.updateStatusIndicator("ready");

      // Start processing search results after a short delay
      this.debounce("searchNext", () => this.searchNext(), 1000);
    } catch (error) {
      errorLog("Error processing search task data:", error);
      this.appendStatusErrorMessage(error);
    }
  }

  /**
   * Handle application task data
   */
  handleApplicationTaskData(data) {
    try {
      debugLog("Processing application task data:", data);

      if (!data) {
        debugLog("No application task data provided");
        return;
      }

      // Store profile data for application
      this.profile = data.profile;
      this.devMode = data.devMode;
      this.session = data.session;
      this.avatarUrl = data.avatarUrl;

      // Update state
      this.state.ready = true;
      this.state.initialized = true;

      this.appendStatusMessage("Application initialization complete");
      this.updateStatusIndicator("ready");

      // Start application process after a short delay
      this.debounce("startApplying", () => this.startApplying(), 1000);
    } catch (error) {
      errorLog("Error processing application task data:", error);
      this.appendStatusErrorMessage(error);
    }
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
        this.safeSendMessage({
          type: "APPLICATION_ERROR",
          data: "Application timed out after 5 minutes",
        });
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

        // Send completion message
        this.safeSendMessage({
          type: "APPLICATION_COMPLETED",
          data: {
            jobId,
            title: jobTitle,
            company: companyName,
            location,
            jobUrl: window.location.href,
            salary: "Not specified",
            workplace: "Not specified",
            postedDate: "Not specified",
            applicants: "Not specified",
          },
        });

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
        this.safeSendMessage({
          type: "APPLICATION_SKIPPED",
          data: error.message,
        });
      } else {
        errorLog("Application error:", error);
        this.appendStatusErrorMessage(error);
        this.safeSendMessage({
          type: "APPLICATION_ERROR",
          data: this.errorToString(error),
        });
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

  // Additional helper methods...
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

  // Status overlay methods...
  createStatusOverlay() {
    // Implementation from paste.txt
    // ... (keeping this brief for space)
  }

  appendStatusMessage(message) {
    console.log(`[Recruitee] ${message}`);
  }

  appendStatusErrorMessage(error) {
    console.error(`[Recruitee Error] ${error}`);
  }

  updateStatusIndicator(status) {
    console.log(`[Recruitee Status] ${status}`);
  }

  // Additional methods from paste.txt...
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
    // Implementation from paste.txt
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

  cleanup() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }
    if (this.port) {
      try {
        this.port.disconnect();
      } catch (e) {
        // Ignore errors
      }
    }
  }

  // Stub methods for missing functionality
  searchNext() {
    // Search functionality would go here
    debugLog("searchNext called");
  }

  handleSearchNext(data) {
    debugLog("handleSearchNext called with:", data);
  }

  handleApplicationStarting(data) {
    debugLog("handleApplicationStarting called with:", data);
  }

  handleApplicationStatus(data) {
    debugLog("handleApplicationStatus called with:", data);
  }

  handleProfileData(data) {
    debugLog("handleProfileData called with:", data);
  }

  handleDuplicate(data) {
    debugLog("handleDuplicate called with:", data);
  }

  handleError(message) {
    debugLog("handleError called with:", message);
  }

  checkHealth() {
    debugLog("checkHealth called");
  }

  startCountDownTimer(duration, callback) {
    return {
      stop: () => {},
      addTime: () => {},
    };
  }

  async getProfileData() {
    return this.profile;
  }
}
