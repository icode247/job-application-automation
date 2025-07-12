// platforms/wellfound/wellfound-automation.js
import BasePlatformAutomation from "../../shared/base/base-platform-automation.js";
import {
  UrlUtils,
  DomUtils,
  FormUtils,
  FileUtils,
} from "../../shared/utilities/index.js";

export default class WellfoundAutomation extends BasePlatformAutomation {
  constructor(config) {
    super(config);
    this.platform = "wellfound";

    // Wellfound-specific configuration
    this.wellfoundConfig = {
      maxApplicationTime: 300000, // 5 minutes
      formSubmissionDelay: 2000,
      pageLoadTimeout: 30000,
    };

    this.applicationState = {
      ...this.applicationState,
      currentStep: null,
      applicationForm: null,
      isSubmitting: false,
    };

    this.log("🚀 WellfoundAutomation initialized");
  }

  /**
   * Get platform domains for link detection
   */
  getPlatformDomains() {
    return ["https://wellfound.com"];
  }

  /**
   * Get search link pattern for job URL validation
   */
  getSearchLinkPattern() {
    return /^https:\/\/wellfound\.com\/jobs\/\d+/;
  }

  /**
   * Check if current page is a valid job page
   */
  isValidJobPage(url) {
    return this.getSearchLinkPattern().test(url);
  }

  /**
   * Get API host from configuration
   */
  getApiHost() {
    return (
      this.sessionContext?.apiHost ||
      this.config?.apiHost ||
      "http://localhost:3000"
    );
  }

  /**
   * Determine if current page is an application page
   */
  isApplicationPage(url) {
    return (
      url.includes("/jobs/") &&
      (url.includes("/apply") ||
        document.querySelector(
          '.application-form, form[data-test="application-form"]'
        ))
    );
  }

  /**
   * Handle platform-specific messages
   */
  handlePlatformSpecificMessage(type, data) {
    switch (type) {
      case "START_APPLICATION":
        this.handleStartApplication(data);
        break;

      case "APPLICATION_STATUS":
        this.handleApplicationStatus(data);
        break;

      case "SUCCESS":
        this.handleSuccessMessage(data);
        break;

      default:
        this.log(`❓ Unhandled Wellfound message type: ${type}`);
    }
  }

  /**
   * Handle application start message
   */
  async handleStartApplication(data) {
    try {
      this.log("🎯 Starting Wellfound job application", data);

      if (this.applicationState.isApplicationInProgress) {
        this.log("⚠️ Application already in progress, ignoring start request");
        return;
      }

      const { url, title } = data;

      // Validate we're on the correct job page
      if (!this.isValidJobPage(window.location.href)) {
        throw new Error(
          `Not on a valid Wellfound job page: ${window.location.href}`
        );
      }

      // Set application state
      this.applicationState.isApplicationInProgress = true;
      this.applicationState.applicationStartTime = Date.now();
      this.applicationState.applicationUrl = url;

      this.statusOverlay.addInfo(`Starting application for: ${title}`);

      // Wait for page to fully load
      await this.waitForPageLoad();

      // Start the application process
      await this.startApplicationProcess();
    } catch (error) {
      this.log("❌ Error starting Wellfound application:", error);
      this.statusOverlay.addError(`Application failed: ${error.message}`);

      await this.reportApplicationError(error.message);
      this.resetApplicationState();
    }
  }

  /**
   * Main application process
   */
  async startApplicationProcess() {
    try {
      this.log("🚀 Starting Wellfound application process");
      this.statusOverlay.addInfo("Processing job application...");

      // Step 1: Find and click apply button
      const applyButton = await this.findApplyButton();
      if (!applyButton) {
        throw new Error("Apply button not found on job page");
      }

      this.log("✅ Found apply button, clicking...");
      this.statusOverlay.addInfo("Clicking apply button...");

      applyButton.click();
      await this.wait(3000);

      // Step 2: Handle application form flow
      await this.handleApplicationFlow();
    } catch (error) {
      this.log("❌ Error in application process:", error);
      throw error;
    }
  }

  /**
   * Find the apply button on the job page
   */
  async findApplyButton() {
    const selectors = [
      '[data-test="apply-button"]',
      ".apply-button",
      'button[data-test="apply"]',
      'a[href*="/apply"]',
      'button:contains("Apply")',
      ".js-apply-button",
      '[data-action="apply"]',
    ];

    for (const selector of selectors) {
      try {
        const button = await this.waitForElement(selector, 2000);
        if (button && DomUtils.isElementVisible(button) && !button.disabled) {
          return button;
        }
      } catch (e) {
        // Continue to next selector
      }
    }

    // Try finding by text content
    const buttons = document.querySelectorAll("button, a");
    for (const button of buttons) {
      const text = button.textContent.toLowerCase().trim();
      if (
        text.includes("apply") &&
        DomUtils.isElementVisible(button) &&
        !button.disabled
      ) {
        return button;
      }
    }

    return null;
  }

  /**
   * Handle the complete application flow
   */
  async handleApplicationFlow() {
    let attempts = 0;
    const maxAttempts = 10;
    let currentStep = "initial";

    this.log("🔄 Starting application flow");

    while (currentStep !== "completed" && attempts < maxAttempts) {
      attempts++;
      this.log(
        `📝 Application step ${attempts}/${maxAttempts}: ${currentStep}`
      );

      try {
        // Handle current step
        await this.handleCurrentApplicationStep();

        // Move to next step
        currentStep = await this.proceedToNextStep();

        // Add delay between steps
        await this.wait(2000);
      } catch (error) {
        this.log(`❌ Error in application step ${attempts}:`, error);

        if (attempts >= maxAttempts) {
          throw new Error(
            `Application failed after ${maxAttempts} attempts: ${error.message}`
          );
        }

        // Try to recover
        await this.handleStepError(error);
        await this.wait(3000);
      }
    }

    if (currentStep === "completed") {
      this.log("✅ Application completed successfully");
      await this.reportApplicationSuccess();
    } else {
      throw new Error(
        `Application failed to complete after ${maxAttempts} steps`
      );
    }
  }

  /**
   * Handle current application step (form filling, file uploads, etc.)
   */
  async handleCurrentApplicationStep() {
    try {
      this.log("📝 Handling current application step");

      // Look for application form
      const form = this.findApplicationForm();
      if (form) {
        this.applicationState.applicationForm = form;
        this.log("📋 Found application form, filling fields...");
        await this.fillApplicationForm(form);
      }

      // Handle file uploads
      await this.handleFileUploads();

      // Handle any special elements (checkboxes, agreements, etc.)
      await this.handleSpecialElements();
    } catch (error) {
      this.log("❌ Error handling application step:", error);
      throw error;
    }
  }

  /**
   * Find the application form on the page
   */
  findApplicationForm() {
    const formSelectors = [
      'form[data-test="application-form"]',
      ".application-form form",
      "form.application",
      'form[action*="apply"]',
      'form:has(input[type="submit"])',
      'form:has(button[type="submit"])',
    ];

    for (const selector of formSelectors) {
      const form = document.querySelector(selector);
      if (form && DomUtils.isElementVisible(form)) {
        return form;
      }
    }

    // Fallback: find any visible form with enough inputs
    const allForms = document.querySelectorAll("form");
    for (const form of allForms) {
      if (DomUtils.isElementVisible(form)) {
        const inputs = form.querySelectorAll("input, select, textarea");
        const visibleInputs = Array.from(inputs).filter(
          (input) => input.type !== "hidden" && DomUtils.isElementVisible(input)
        );

        if (visibleInputs.length >= 3) {
          // Form with at least 3 visible inputs
          return form;
        }
      }
    }

    return null;
  }

  /**
   * Fill the application form
   */
  async fillApplicationForm(form) {
    try {
      this.log("📝 Filling application form");
      this.statusOverlay.addInfo("Filling application form...");

      const fields = FormUtils.getAllFormFields(form);
      this.log(`📋 Found ${fields.length} form fields to fill`);

      for (const field of fields) {
        try {
          if (field.type === "file") {
            // File inputs are handled separately
            continue;
          }

          this.log(`📝 Filling field: ${field.label} (${field.type})`);

          const answer = await this.getAnswerForField(field);
          if (answer !== null && answer !== undefined) {
            await FormUtils.fillField(field.element, answer, field.type);
            this.log(`✅ Filled field: ${field.label} = ${answer}`);
          } else {
            this.log(`⚠️ No answer found for field: ${field.label}`);
          }

          // Small delay between fields
          await this.wait(300);
        } catch (error) {
          this.log(`❌ Error filling field ${field.label}:`, error);
          // Continue with other fields
        }
      }

      // Handle required checkboxes and agreements
      await FormUtils.handleRequiredCheckboxes(form);

      this.log("✅ Form filling completed");
      this.statusOverlay.addSuccess("Form filled successfully");
    } catch (error) {
      this.log("❌ Error filling application form:", error);
      throw error;
    }
  }

  /**
   * Get answer for a form field using AI or defaults
   */
  async getAnswerForField(field) {
    try {
      // Get field options if it's a select or radio
      const options = this.getFieldOptions(field);

      // Use AI service if available, otherwise use defaults
      if (this.userProfile && this.sessionContext) {
        const context = {
          platform: this.platform,
          userData: this.userProfile,
          jobDescription: this.getJobDescription(),
        };

        // Try to get answer from AI service
        const answer = await this.getAIAnswer(field.label, options, context);
        if (answer) {
          return answer;
        }
      }

      // Fallback to default answers
      return this.getDefaultAnswer(field);
    } catch (error) {
      this.log(`❌ Error getting answer for field ${field.label}:`, error);
      return this.getDefaultAnswer(field);
    }
  }

  /**
   * Get field options for select and radio inputs
   */
  getFieldOptions(field) {
    if (field.type === "select") {
      return Array.from(field.element.options)
        .filter((opt) => opt.value && opt.value !== "")
        .map((opt) => opt.textContent.trim());
    }

    if (field.type === "radio") {
      const radioGroup = document.querySelectorAll(
        `input[name="${field.element.name}"]`
      );
      return Array.from(radioGroup).map((radio) => {
        const label = FormUtils.getFieldLabel(radio);
        return label || radio.value;
      });
    }

    return [];
  }

  /**
   * Get AI-powered answer (placeholder - implement based on your AI service)
   */
  async getAIAnswer(label, options, context) {
    try {
      // This would integrate with your existing AI service
      // For now, return null to use default answers
      return null;
    } catch (error) {
      this.log("❌ AI answer service error:", error);
      return null;
    }
  }

  /**
   * Get default answer for common fields
   */
  getDefaultAnswer(field) {
    const label = field.label.toLowerCase();
    const fieldType = field.type;

    // Work authorization questions
    if (
      label.includes("work authorization") ||
      label.includes("authorized to work")
    ) {
      return fieldType === "checkbox" ? true : "Yes";
    }

    if (
      label.includes("require sponsorship") ||
      label.includes("require visa")
    ) {
      return fieldType === "checkbox" ? false : "No";
    }

    // Experience fields
    if (label.includes("years of experience") || label.includes("experience")) {
      return "3 years";
    }

    // Contact fields
    if (label.includes("phone") || label.includes("mobile")) {
      return this.userProfile?.phoneNumber || "555-0123";
    }

    if (label.includes("email")) {
      return this.userProfile?.email || "user@example.com";
    }

    // Salary expectations
    if (label.includes("salary") || label.includes("compensation")) {
      return "80000";
    }

    // Start date
    if (label.includes("start date") || label.includes("availability")) {
      const date = new Date();
      date.setDate(date.getDate() + 14); // 2 weeks from now
      return date.toISOString().split("T")[0]; // YYYY-MM-DD format
    }

    // Boolean fields default to true/yes
    if (fieldType === "checkbox") {
      return true;
    }

    // For select fields, try to pick a reasonable default
    if (fieldType === "select") {
      const options = this.getFieldOptions(field);
      if (options.length > 0) {
        // Look for common positive responses
        const positiveOptions = ["yes", "true", "agree", "accept"];
        for (const positive of positiveOptions) {
          const match = options.find((opt) =>
            opt.toLowerCase().includes(positive)
          );
          if (match) return match;
        }
        // Otherwise return first non-empty option
        return options[0];
      }
    }

    return "";
  }

  /**
   * Handle file uploads (resume, cover letter)
   */
  async handleFileUploads() {
    try {
      const fileInputs = document.querySelectorAll('input[type="file"]');
      if (fileInputs.length === 0) {
        this.log("📄 No file inputs found");
        return;
      }

      this.log(`📄 Found ${fileInputs.length} file input(s)`);
      this.statusOverlay.addInfo("Uploading resume/cover letter...");

      for (const fileInput of fileInputs) {
        if (!DomUtils.isElementVisible(fileInput)) continue;

        try {
          const uploaded = await this.uploadFileToInput(fileInput);
          if (uploaded) {
            this.log("✅ File uploaded successfully");
            this.statusOverlay.addSuccess("File uploaded successfully");
          } else {
            this.log("⚠️ File upload failed or skipped");
            this.statusOverlay.addWarning("File upload failed");
          }
        } catch (error) {
          this.log(`❌ Error uploading file:`, error);
          this.statusOverlay.addError("File upload error: " + error.message);
        }
      }
    } catch (error) {
      this.log("❌ Error handling file uploads:", error);
      // Don't throw error - file upload is not critical
    }
  }

  /**
   * Upload file to input element
   */
  async uploadFileToInput(fileInput) {
    try {
      // Determine file type based on input attributes or surrounding text
      const fileType = this.determineFileType(fileInput);

      // Get user profile data
      const userProfile = this.userProfile || {};

      // Get file URLs based on type
      let fileUrls = [];
      if (fileType === "resume") {
        fileUrls =
          userProfile.resumeUrls ||
          (userProfile.resumeUrl ? [userProfile.resumeUrl] : []);
      } else if (fileType === "cover_letter") {
        fileUrls = userProfile.coverLetterUrl
          ? [userProfile.coverLetterUrl]
          : [];
      }

      if (fileUrls.length === 0) {
        this.log(`⚠️ No ${fileType} file available for user`);
        return false;
      }

      // Use the first available file URL
      const fileUrl = fileUrls[0];
      this.log(`📄 Uploading ${fileType} from: ${fileUrl}`);

      // Fetch and upload the file
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }

      const blob = await response.blob();
      const fileName = FileUtils.extractFileNameFromUrl(fileUrl);
      const file = FileUtils.createFileFromBlob(blob, fileName);

      // Set file on input
      FileUtils.setFilesOnInput(fileInput, file);

      // Dispatch events
      await FileUtils.dispatchFileEvents(fileInput);

      // Wait for any upload processing
      await this.wait(2000);

      return true;
    } catch (error) {
      this.log(`❌ Error uploading file to input:`, error);
      return false;
    }
  }

  /**
   * Determine what type of file is needed for the input
   */
  determineFileType(fileInput) {
    const container =
      fileInput.closest(".form-group, .field-group") || fileInput.parentElement;
    const containerText = container ? container.textContent.toLowerCase() : "";

    const inputId = fileInput.id?.toLowerCase() || "";
    const inputName = fileInput.name?.toLowerCase() || "";
    const inputAccept = fileInput.accept?.toLowerCase() || "";

    // Check for cover letter indicators
    if (
      containerText.includes("cover letter") ||
      inputId.includes("cover") ||
      inputName.includes("cover")
    ) {
      return "cover_letter";
    }

    // Default to resume
    return "resume";
  }

  /**
   * Handle special elements like checkboxes, agreements, etc.
   */
  async handleSpecialElements() {
    try {
      // Handle privacy agreements, terms acceptance, etc.
      const checkboxes = document.querySelectorAll('input[type="checkbox"]');

      for (const checkbox of checkboxes) {
        if (!DomUtils.isElementVisible(checkbox)) continue;

        const label = FormUtils.getFieldLabel(checkbox);
        const isAgreement = this.isAgreementCheckbox(label);
        const isRequired = FormUtils.isFieldRequired(checkbox);

        if (isAgreement || isRequired) {
          if (!checkbox.checked) {
            this.log(`☑️ Checking agreement/required checkbox: ${label}`);
            checkbox.click();
            await this.wait(200);
          }
        }
      }
    } catch (error) {
      this.log("❌ Error handling special elements:", error);
      // Don't throw - these are not critical
    }
  }

  /**
   * Check if checkbox is for agreements/terms
   */
  isAgreementCheckbox(label) {
    if (!label) return false;

    const agreementKeywords = [
      "terms",
      "conditions",
      "privacy",
      "policy",
      "agreement",
      "consent",
      "authorize",
      "acknowledge",
      "accept",
      "agree",
    ];

    const labelLower = label.toLowerCase();
    return agreementKeywords.some((keyword) => labelLower.includes(keyword));
  }

  /**
   * Proceed to the next step in the application process
   */
  async proceedToNextStep() {
    try {
      this.log("⏭️ Proceeding to next application step");

      // Look for submit/continue buttons
      const submitButton = this.findSubmitButton();
      if (submitButton) {
        this.log("🔘 Found submit button, clicking...");
        this.statusOverlay.addInfo("Submitting application...");

        this.applicationState.isSubmitting = true;
        submitButton.click();

        await this.wait(3000);

        // Check if application was completed
        if (await this.isApplicationCompleted()) {
          return "completed";
        }

        // Wait for next page/step to load
        await this.waitForPageLoad();
        return "next_step";
      }

      // Look for continue/next buttons
      const continueButton = this.findContinueButton();
      if (continueButton) {
        this.log("🔘 Found continue button, clicking...");
        continueButton.click();
        await this.wait(2000);
        await this.waitForPageLoad();
        return "next_step";
      }

      // If no buttons found, check if we're done
      if (await this.isApplicationCompleted()) {
        return "completed";
      }

      // Default to error if no way to proceed
      throw new Error(
        "No way to proceed found - no submit or continue buttons"
      );
    } catch (error) {
      this.log("❌ Error proceeding to next step:", error);
      throw error;
    }
  }

  /**
   * Find submit button
   */
  findSubmitButton() {
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button:contains("Submit")',
      'button:contains("Apply")',
      'button:contains("Send Application")',
      ".submit-button",
      '[data-test="submit"]',
    ];

    return this.findVisibleButton(submitSelectors);
  }

  /**
   * Find continue/next button
   */
  findContinueButton() {
    const continueSelectors = [
      'button:contains("Continue")',
      'button:contains("Next")',
      'button:contains("Proceed")',
      ".continue-button",
      ".next-button",
      '[data-test="continue"]',
      '[data-test="next"]',
    ];

    return this.findVisibleButton(continueSelectors);
  }

  /**
   * Find visible button from selectors
   */
  findVisibleButton(selectors) {
    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button && DomUtils.isElementVisible(button) && !button.disabled) {
        return button;
      }
    }

    // Try finding by text content
    const buttons = document.querySelectorAll(
      'button, input[type="button"], input[type="submit"]'
    );
    for (const button of buttons) {
      if (!DomUtils.isElementVisible(button) || button.disabled) continue;

      const text = (button.textContent || button.value || "")
        .toLowerCase()
        .trim();
      const isSubmitButton = ["submit", "apply", "send application"].some(
        (keyword) => text.includes(keyword)
      );
      const isContinueButton = ["continue", "next", "proceed"].some((keyword) =>
        text.includes(keyword)
      );

      if (isSubmitButton || isContinueButton) {
        return button;
      }
    }

    return null;
  }

  /**
   * Check if application has been completed
   */
  async isApplicationCompleted() {
    try {
      // Look for success indicators
      const successIndicators = [
        ".application-success",
        ".success-message",
        ".confirmation",
        '[data-test="application-success"]',
        'h1:contains("Success")',
        'h2:contains("Thank you")',
        'h3:contains("Application submitted")',
      ];

      for (const selector of successIndicators) {
        const element = document.querySelector(selector);
        if (element && DomUtils.isElementVisible(element)) {
          this.log("✅ Found application success indicator");
          return true;
        }
      }

      // Check page URL for success patterns
      const url = window.location.href.toLowerCase();
      const successPatterns = [
        "/success",
        "/thank-you",
        "/confirmation",
        "/applied",
      ];
      if (successPatterns.some((pattern) => url.includes(pattern))) {
        this.log("✅ Success detected in URL");
        return true;
      }

      // Check page title
      const title = document.title.toLowerCase();
      if (
        title.includes("success") ||
        title.includes("thank you") ||
        title.includes("confirmation")
      ) {
        this.log("✅ Success detected in page title");
        return true;
      }

      return false;
    } catch (error) {
      this.log("❌ Error checking application completion:", error);
      return false;
    }
  }

  /**
   * Get job description from the page
   */
  getJobDescription() {
    const descriptionSelectors = [
      ".job-description",
      ".description",
      ".job-details",
      '[data-test="job-description"]',
      ".job-content",
    ];

    for (const selector of descriptionSelectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element.textContent.trim();
      }
    }

    return "No job description found";
  }

  /**
   * Handle step error and try to recover
   */
  async handleStepError(error) {
    this.log("⚠️ Handling step error:", error.message);

    // Try to close any modal dialogs
    const closeButtons = document.querySelectorAll(
      '.modal-close, .close-button, [aria-label="Close"]'
    );
    for (const button of closeButtons) {
      if (DomUtils.isElementVisible(button)) {
        button.click();
        await this.wait(1000);
      }
    }

    // Try to dismiss any error messages
    const dismissButtons = document.querySelectorAll(
      ".dismiss, .error-dismiss, [data-dismiss]"
    );
    for (const button of dismissButtons) {
      if (DomUtils.isElementVisible(button)) {
        button.click();
        await this.wait(1000);
      }
    }
  }

  /**
   * Handle application status message
   */
  handleApplicationStatus(data) {
    this.log("📊 Application status update:", data);
    // Handle any status updates from background script
  }

  /**
   * Handle success message
   */
  handleSuccessMessage(data) {
    this.log("✅ Success message received:", data);
    // Handle success confirmation from background script
  }

  /**
   * Report application success
   */
  async reportApplicationSuccess() {
    try {
      this.log("✅ Reporting application success");
      this.statusOverlay.addSuccess("Application submitted successfully!");

      const jobData = this.extractJobData();

      this.safeSendPortMessage({
        type: "APPLICATION_SUCCESS",
        data: {
          url: this.applicationState.applicationUrl,
          jobData: jobData,
          completedAt: Date.now(),
          duration: Date.now() - this.applicationState.applicationStartTime,
        },
      });

      this.resetApplicationState();
    } catch (error) {
      this.log("❌ Error reporting success:", error);
      await this.reportApplicationError("Failed to report success");
    }
  }

  /**
   * Report application error
   */
  async reportApplicationError(errorMessage) {
    try {
      this.log("❌ Reporting application error:", errorMessage);
      this.statusOverlay.addError("Application failed: " + errorMessage);

      this.safeSendPortMessage({
        type: "APPLICATION_ERROR",
        data: {
          url: this.applicationState.applicationUrl,
          error: errorMessage,
          failedAt: Date.now(),
          duration: Date.now() - this.applicationState.applicationStartTime,
        },
      });

      this.resetApplicationState();
    } catch (error) {
      this.log("❌ Error reporting error:", error);
      this.resetApplicationState();
    }
  }

  /**
   * Extract job data from the page
   */
  extractJobData() {
    return {
      title: DomUtils.extractText([
        "h1",
        ".job-title",
        '[data-test="job-title"]',
      ]),
      company: DomUtils.extractText([
        ".company-name",
        '[data-test="company-name"]',
      ]),
      location: DomUtils.extractText([
        ".job-location",
        '[data-test="location"]',
      ]),
      url: window.location.href,
      platform: this.platform,
      extractedAt: Date.now(),
    };
  }

  /**
   * Reset application state
   */
  resetApplicationState() {
    this.applicationState.isApplicationInProgress = false;
    this.applicationState.applicationStartTime = null;
    this.applicationState.applicationUrl = null;
    this.applicationState.currentStep = null;
    this.applicationState.applicationForm = null;
    this.applicationState.isSubmitting = false;

    this.log("🔄 Application state reset");
  }

  /**
   * Get job task message type for background communication
   */
  getJobTaskMessageType() {
    return "START_APPLICATION";
  }

  /**
   * Platform-specific URL normalization
   */
  platformSpecificUrlNormalization(url) {
    // Remove any Wellfound-specific URL parameters that don't affect job identity
    try {
      const urlObj = new URL(url);
      // Keep important parameters, remove tracking ones
      const keepParams = ["utm_source"]; // Add important params here
      const newSearchParams = new URLSearchParams();

      for (const [key, value] of urlObj.searchParams) {
        if (keepParams.includes(key)) {
          newSearchParams.set(key, value);
        }
      }

      urlObj.search = newSearchParams.toString();
      return urlObj.toString();
    } catch (e) {
      return url;
    }
  }

  /**
   * Enhanced cleanup
   */
  cleanup() {
    super.cleanup();
    this.resetApplicationState();
    this.log("🧹 WellfoundAutomation cleanup completed");
  }
}
