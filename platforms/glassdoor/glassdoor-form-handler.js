// platforms/glassdoor/glassdoor-form-handler.js - ENHANCED VERSION
import { DomUtils, FormUtils } from "../../shared/utilities/index.js";

export default class GlassdoorFormHandler {
  constructor(config) {
    this.logger = config.logger || console.log;
    this.host = config.host || "http://localhost:3000";
    this.userData = config.userData || {};
    this.jobDescription = config.jobDescription || "";
    this.answerCache = new Map();
  }

  log(message, data = {}) {
    if (this.logger) {
      this.logger(message);
    }
    console.log(`🤖 [GlassdoorFormHandler] ${message}`, data);
  }

  // ========================================
  // INDEED SMARTAPPLY INTEGRATION (NEW)
  // ========================================

  async processIndeedSmartApply() {
    try {
      this.log("🎯 Starting Indeed SmartApply process");

      // Wait for SmartApply page to fully load
      await this.waitForElement("form, .ia-BasePage-main", 15000);
      await this.delay(2000);

      // Check if this is Indeed SmartApply
      if (!this.isIndeedSmartApplyPage()) {
        throw new Error("Not an Indeed SmartApply page");
      }

      // Extract job title for context
      const jobTitle = this.extractJobTitle();
      this.log(`📋 Processing SmartApply for: ${jobTitle}`);

      // Process multi-step application
      let currentStep = 1;
      let maxSteps = 5; // Safety limit
      let applicationCompleted = false;

      while (currentStep <= maxSteps && !applicationCompleted) {
        this.log(`📄 Processing SmartApply step ${currentStep}`);

        // Wait for page content to load
        await this.delay(2000);

        // Check if application is completed
        if (this.checkSmartApplyCompletion()) {
          this.log("✅ SmartApply application completed successfully");
          applicationCompleted = true;
          break;
        }

        // Process current step
        const stepResult = await this.processSmartApplyStep();

        if (stepResult.completed) {
          applicationCompleted = true;
          break;
        } else if (stepResult.nextStep) {
          // Find and click next/continue button
          const nextButton = this.findSmartApplyNextButton();
          if (nextButton) {
            this.log("🔄 Moving to next SmartApply step");
            await this.clickElementReliably(nextButton);
            await this.delay(3000);
            currentStep++;
          } else {
            throw new Error("Cannot find next button to continue");
          }
        } else {
          throw new Error("Cannot process current step");
        }
      }

      if (applicationCompleted) {
        return {
          success: true,
          jobTitle: jobTitle,
          message: "Indeed SmartApply completed successfully",
        };
      } else {
        throw new Error("SmartApply process exceeded maximum steps");
      }
    } catch (error) {
      this.log("❌ SmartApply error:", error.message);
      return {
        success: false,
        error: error.message,
        jobTitle: this.extractJobTitle(),
      };
    }
  }

  isIndeedSmartApplyPage() {
    return (
      window.location.href.includes("smartapply.indeed.com") ||
      document.querySelector(".ia-BasePage-main, .smartapply-container") !==
        null
    );
  }

  async processSmartApplyStep() {
    try {
      // Check for different step types
      if (this.isResumeStep()) {
        return await this.handleResumeStep();
      } else if (this.isContactInfoStep()) {
        return await this.handleContactInfoStep();
      } else if (this.isQuestionsStep()) {
        return await this.handleQuestionsStep();
      } else if (this.isReviewStep()) {
        return await this.handleReviewStep();
      } else {
        // Generic form processing
        return await this.handleGenericStep();
      }
    } catch (error) {
      this.log("❌ Error processing SmartApply step:", error.message);
      throw error;
    }
  }

  isResumeStep() {
    return (
      document.querySelector("input[type='file']") !== null ||
      document.querySelector(".resume-upload, .file-upload") !== null ||
      document.body.textContent.toLowerCase().includes("resume")
    );
  }

  async handleResumeStep() {
    this.log("📄 Handling resume upload step");

    // Look for file input
    const fileInput = document.querySelector("input[type='file']");
    if (fileInput && this.userData.resumeUrl) {
      try {
        // For SmartApply, often the resume is auto-detected
        // Check if resume is already uploaded
        const resumeStatus = document.querySelector(
          ".resume-uploaded, .file-uploaded"
        );
        if (resumeStatus) {
          this.log("✅ Resume already uploaded");
          return { nextStep: true };
        }

        // If manual upload needed, you might need to handle file upload
        this.log("📎 Resume upload may be required");
        return { nextStep: true };
      } catch (error) {
        this.log("⚠️ Resume upload error:", error.message);
        return { nextStep: true }; // Continue anyway
      }
    }

    return { nextStep: true };
  }

  isContactInfoStep() {
    const contactFields = [
      "input[name*='name']",
      "input[name*='email']",
      "input[name*='phone']",
      "input[type='email']",
      "input[type='tel']",
    ];

    return contactFields.some(
      (selector) => document.querySelector(selector) !== null
    );
  }

  async handleContactInfoStep() {
    this.log("👤 Handling contact information step");

    try {
      // Fill name fields
      await this.fillFieldBySelectors(
        [
          "input[name*='firstName']",
          "input[placeholder*='First name']",
          "input[aria-label*='First name']",
        ],
        this.userData.firstName
      );

      await this.fillFieldBySelectors(
        [
          "input[name*='lastName']",
          "input[placeholder*='Last name']",
          "input[aria-label*='Last name']",
        ],
        this.userData.lastName
      );

      // Fill email
      await this.fillFieldBySelectors(
        [
          "input[type='email']",
          "input[name*='email']",
          "input[placeholder*='email']",
        ],
        this.userData.email
      );

      // Fill phone
      const phoneNumber = this.formatPhoneNumber(this.userData.phoneNumber);
      await this.fillFieldBySelectors(
        [
          "input[type='tel']",
          "input[name*='phone']",
          "input[placeholder*='phone']",
        ],
        phoneNumber
      );

      this.log("✅ Contact information filled");
      return { nextStep: true };
    } catch (error) {
      this.log("⚠️ Contact info error:", error.message);
      return { nextStep: true }; // Continue anyway
    }
  }

  isQuestionsStep() {
    return (
      document.querySelector("input[type='radio'], select, textarea") !==
        null || document.body.textContent.toLowerCase().includes("question")
    );
  }

  async handleQuestionsStep() {
    this.log("❓ Handling questions step");

    try {
      // Process all form fields on the page
      const fields = this.getAllFormFields();

      for (const field of fields) {
        await this.processFormField(field);
        await this.delay(300); // Brief delay between fields
      }

      this.log("✅ Questions processed");
      return { nextStep: true };
    } catch (error) {
      this.log("⚠️ Questions error:", error.message);
      return { nextStep: true }; // Continue anyway
    }
  }

  isReviewStep() {
    return (
      document.body.textContent.toLowerCase().includes("review") ||
      document.body.textContent.toLowerCase().includes("submit") ||
      document.querySelector(
        "button[type='submit'], button:contains('Submit')"
      ) !== null
    );
  }

  async handleReviewStep() {
    this.log("📋 Handling review/submit step");

    // Look for submit button
    const submitButton = this.findSmartApplySubmitButton();
    if (submitButton) {
      this.log("📤 Found submit button, submitting application");
      await this.clickElementReliably(submitButton);
      await this.delay(5000); // Wait for submission

      // Check for completion
      if (this.checkSmartApplyCompletion()) {
        return { completed: true };
      }
    }

    return { nextStep: true };
  }

  async handleGenericStep() {
    this.log("📝 Handling generic form step");

    try {
      // Process any visible form fields
      const fields = this.getAllFormFields();

      for (const field of fields) {
        await this.processFormField(field);
      }

      return { nextStep: true };
    } catch (error) {
      this.log("⚠️ Generic step error:", error.message);
      return { nextStep: true };
    }
  }

  findSmartApplyNextButton() {
    const selectors = [
      "button:contains('Continue')",
      "button:contains('Next')",
      "button[type='submit']",
      ".ia-continueButton",
      ".continue-btn",
      "button.btn-primary",
    ];

    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button && DomUtils.isElementVisible(button) && !button.disabled) {
        return button;
      }
    }

    // Fallback - look for any enabled button with relevant text
    const buttons = document.querySelectorAll("button");
    for (const button of buttons) {
      const text = button.textContent?.toLowerCase() || "";
      if (
        (text.includes("continue") ||
          text.includes("next") ||
          text.includes("proceed")) &&
        DomUtils.isElementVisible(button) &&
        !button.disabled
      ) {
        return button;
      }
    }

    return null;
  }

  findSmartApplySubmitButton() {
    const selectors = [
      "button:contains('Submit')",
      "button:contains('Apply')",
      "button[type='submit']",
      ".submit-btn",
      ".apply-btn",
      "button.btn-primary",
    ];

    for (const selector of selectors) {
      const button = document.querySelector(selector);
      if (button && DomUtils.isElementVisible(button) && !button.disabled) {
        return button;
      }
    }

    return null;
  }

  checkSmartApplyCompletion() {
    // Check for success indicators
    const successIndicators = [
      "application submitted",
      "application complete",
      "thank you",
      "confirmation",
      "success",
    ];

    const pageText = document.body.textContent.toLowerCase();
    const hasSuccessText = successIndicators.some((indicator) =>
      pageText.includes(indicator)
    );

    // Check for success elements
    const successElements = document.querySelectorAll(
      ".success, .confirmation, .complete"
    );
    const hasSuccessElement = successElements.length > 0;

    // Check URL for success indicators
    const url = window.location.href.toLowerCase();
    const hasSuccessUrl =
      url.includes("success") ||
      url.includes("confirmation") ||
      url.includes("complete");

    return hasSuccessText || hasSuccessElement || hasSuccessUrl;
  }

  extractJobTitle() {
    const selectors = [
      "h1",
      ".job-title",
      ".jobTitle",
      "[data-testid='job-title']",
      ".ia-JobHeader-title",
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element.textContent?.trim();
      }
    }

    return "Job Application";
  }

  // ========================================
  // GLASSDOOR MODAL PROCESSING (ENHANCED)
  // ========================================

  async fillFormWithProfile(form, userData, jobDescription) {
    try {
      this.log("📝 Filling Glassdoor form with user profile");
      this.userData = userData;
      this.jobDescription = jobDescription;

      // Get all form fields
      const fields = this.getAllFormFields(form);
      this.log(`Found ${fields.length} form fields to process`);

      // Process each field
      for (const field of fields) {
        try {
          await this.processFormField(field);
          await this.delay(200); // Brief delay between fields
        } catch (fieldError) {
          this.log(`⚠️ Error processing field: ${fieldError.message}`);
          continue; // Continue with other fields
        }
      }

      this.log("✅ Form filling completed");
      return true;
    } catch (error) {
      this.log("❌ Error filling form:", error.message);
      throw error;
    }
  }

  // ========================================
  // FORM FIELD PROCESSING (ENHANCED)
  // ========================================

  getAllFormFields(container = document) {
    const fields = [];

    // Get all input, select, and textarea elements
    const elements = container.querySelectorAll("input, select, textarea");

    for (const element of elements) {
      // Skip hidden, disabled, or readonly fields
      if (element.type === "hidden" || element.disabled || element.readOnly) {
        continue;
      }

      // Get field information
      const fieldInfo = this.getFieldInfo(element);
      if (fieldInfo.label) {
        fields.push({
          element: element,
          type: element.type || element.tagName.toLowerCase(),
          label: fieldInfo.label,
          name: element.name || "",
          id: element.id || "",
          required: element.required || fieldInfo.label.includes("*"),
          placeholder: element.placeholder || "",
        });
      }
    }

    return fields;
  }

  getFieldInfo(element) {
    const sources = [
      element.labels?.[0]?.textContent,
      element.getAttribute("aria-label"),
      element.getAttribute("placeholder"),
      element.getAttribute("data-label"),
      element.closest("label")?.textContent,
      element
        .closest(".form-group, .field, .input-group")
        ?.querySelector("label")?.textContent,
      element.closest("div")?.querySelector("label")?.textContent,
    ];

    const label = sources.find((source) => source && source.trim()) || "";

    return {
      label: label.trim().replace(/\s+/g, " "),
      element: element,
    };
  }

  async processFormField(field) {
    try {
      this.log(`🔧 Processing field: ${field.label} (${field.type})`);

      // Get appropriate answer for this field
      const answer = await this.getAnswerForField(field);

      if (!answer && answer !== 0) {
        this.log(`⏭️ No answer for field: ${field.label}`);
        return;
      }

      // Fill the field based on its type
      switch (field.type) {
        case "text":
        case "email":
        case "tel":
        case "password":
        case "number":
          await this.fillTextInput(field.element, answer);
          break;

        case "textarea":
          await this.fillTextarea(field.element, answer);
          break;

        case "select-one":
          await this.fillSelect(field.element, answer);
          break;

        case "radio":
          await this.fillRadio(field.element, answer, field.label);
          break;

        case "checkbox":
          await this.fillCheckbox(field.element, answer);
          break;

        case "file":
          await this.fillFileInput(field.element, answer);
          break;

        default:
          this.log(`❓ Unknown field type: ${field.type}`);
      }

      this.log(`✅ Filled field: ${field.label} = ${answer}`);
    } catch (error) {
      this.log(`❌ Error processing field ${field.label}:`, error.message);
      throw error;
    }
  }

  async getAnswerForField(field) {
    const normalizedLabel = field.label.toLowerCase().trim();

    // Check cache first
    if (this.answerCache.has(normalizedLabel)) {
      return this.answerCache.get(normalizedLabel);
    }

    // Get answer based on field label/context
    let answer = this.getDirectAnswer(normalizedLabel);

    if (!answer) {
      // Use AI service if available
      try {
        if (this.aiService) {
          answer = await this.aiService.getAnswer(field.label, [], {
            userData: this.userData,
            jobDescription: this.jobDescription,
            platform: "glassdoor",
          });
        }
      } catch (error) {
        this.log("⚠️ AI service error:", error.message);
      }
    }

    if (!answer) {
      answer = this.getFallbackAnswer(normalizedLabel);
    }

    // Cache the answer
    if (answer) {
      this.answerCache.set(normalizedLabel, answer);
    }

    return answer;
  }

  getDirectAnswer(normalizedLabel) {
    // Map user data to common field patterns
    const fieldMappings = {
      "first name": this.userData.firstName,
      "last name": this.userData.lastName,
      "full name": `${this.userData.firstName} ${this.userData.lastName}`,
      email: this.userData.email,
      phone: this.formatPhoneNumber(this.userData.phoneNumber),
      "phone number": this.formatPhoneNumber(this.userData.phoneNumber),
      city: this.userData.currentCity,
      location: this.userData.currentCity,
      address: this.userData.streetAddress,
      linkedin: this.userData.linkedIn,
      website: this.userData.website,
      github: this.userData.github,
      company: this.userData.currentCompany,
      "current company": this.userData.currentCompany,
      position: this.userData.fullPosition,
      title: this.userData.fullPosition,
      experience: this.userData.yearsOfExperience,
      "years of experience": this.userData.yearsOfExperience,
      salary: this.userData.desiredSalary,
      "expected salary": this.userData.desiredSalary,
      "desired salary": this.userData.desiredSalary,
      "notice period": this.userData.noticePeriod,
      "cover letter": this.userData.coverLetter,
    };

    // Check for exact matches
    if (fieldMappings[normalizedLabel]) {
      return fieldMappings[normalizedLabel];
    }

    // Check for partial matches
    for (const [key, value] of Object.entries(fieldMappings)) {
      if (normalizedLabel.includes(key) && value) {
        return value;
      }
    }

    // Common question patterns
    if (
      normalizedLabel.includes("authorized to work") ||
      normalizedLabel.includes("work authorization")
    ) {
      return this.userData.usCitizenship ? "Yes" : "No";
    }

    if (
      normalizedLabel.includes("require sponsorship") ||
      normalizedLabel.includes("visa sponsorship")
    ) {
      return this.userData.needsSponsorship ? "Yes" : "No";
    }

    if (normalizedLabel.includes("disability")) {
      return this.userData.disabilityStatus || "Prefer not to answer";
    }

    if (normalizedLabel.includes("veteran")) {
      return this.userData.veteranStatus || "Not a veteran";
    }

    if (
      normalizedLabel.includes("race") ||
      normalizedLabel.includes("ethnicity")
    ) {
      return this.userData.race || "Prefer not to answer";
    }

    if (normalizedLabel.includes("gender")) {
      return this.userData.gender || "Prefer not to answer";
    }

    return null;
  }

  getFallbackAnswer(normalizedLabel) {
    // Common fallback answers
    const fallbackAnswers = {
      "work authorization": "Yes",
      "authorized to work": "Yes",
      "require sponsorship": "No",
      "visa sponsorship": "No",
      experience: "Yes",
      available: "Immediately",
      "start date": "Immediately",
      "notice period": "2 weeks",
      salary: "Competitive",
      relocate: "Yes",
      "willing to relocate": "Yes",
    };

    for (const [key, value] of Object.entries(fallbackAnswers)) {
      if (normalizedLabel.includes(key)) {
        return value;
      }
    }

    return "Yes"; // Default fallback
  }

  // ========================================
  // FIELD FILLING METHODS (ENHANCED)
  // ========================================

  async fillTextInput(element, value) {
    element.focus();
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.blur();
  }

  async fillTextarea(element, value) {
    element.focus();
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.blur();
  }

  async fillSelect(element, value) {
    // Try to find matching option
    const options = element.querySelectorAll("option");

    for (const option of options) {
      const optionText = option.textContent.toLowerCase();
      const optionValue = option.value.toLowerCase();
      const searchValue = value.toString().toLowerCase();

      if (
        optionText.includes(searchValue) ||
        optionValue.includes(searchValue) ||
        searchValue.includes(optionText) ||
        searchValue.includes(optionValue)
      ) {
        element.value = option.value;
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
    }

    // If no match found, try first non-empty option
    for (const option of options) {
      if (
        option.value &&
        option.value !== "" &&
        option.textContent.trim() !== ""
      ) {
        element.value = option.value;
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
    }
  }

  async fillRadio(element, value, fieldLabel) {
    // Find all radio buttons with the same name
    const radioGroup = document.querySelectorAll(
      `input[name="${element.name}"]`
    );

    for (const radio of radioGroup) {
      const radioLabel = this.getRadioLabel(radio);
      const radioValue = radio.value.toLowerCase();
      const searchValue = value.toString().toLowerCase();

      if (
        radioLabel.toLowerCase().includes(searchValue) ||
        radioValue.includes(searchValue) ||
        searchValue.includes(radioLabel.toLowerCase())
      ) {
        radio.checked = true;
        radio.dispatchEvent(new Event("change", { bubbles: true }));
        return;
      }
    }

    // Fallback - select first radio if no match
    if (radioGroup.length > 0) {
      radioGroup[0].checked = true;
      radioGroup[0].dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  async fillCheckbox(element, value) {
    const shouldCheck =
      value &&
      (value.toString().toLowerCase() === "yes" ||
        value.toString().toLowerCase() === "true" ||
        value === true);

    element.checked = shouldCheck;
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async fillFileInput(element, value) {
    // File inputs typically can't be filled programmatically for security reasons
    // This would need to be handled differently, possibly with file upload APIs
    this.log("📎 File input detected - manual handling required");
  }

  getRadioLabel(radioElement) {
    const sources = [
      radioElement.labels?.[0]?.textContent,
      radioElement.getAttribute("aria-label"),
      radioElement.closest("label")?.textContent,
      radioElement.nextElementSibling?.textContent,
      radioElement.parentElement?.textContent,
    ];

    return sources.find((source) => source && source.trim()) || "";
  }

  // ========================================
  // UTILITY METHODS
  // ========================================

  async fillFieldBySelectors(selectors, value) {
    if (!value) return false;

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && DomUtils.isElementVisible(element)) {
        await this.fillTextInput(element, value);
        return true;
      }
    }

    return false;
  }

  formatPhoneNumber(phone) {
    if (!phone) return "";

    // Remove all non-digits
    const digits = phone.replace(/\D/g, "");

    // Format as (XXX) XXX-XXXX if US number
    if (digits.length === 10) {
      return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
    }

    return phone; // Return original if can't format
  }

  async clickElementReliably(element) {
    const strategies = [
      () => element.click(),
      () =>
        element.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        ),
      () => {
        element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      },
      () => {
        element.focus();
        element.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
        );
      },
    ];

    element.scrollIntoView({ behavior: "smooth", block: "center" });
    await this.delay(500);

    for (const strategy of strategies) {
      try {
        strategy();
        await this.delay(1000);
        return true;
      } catch (error) {
        continue;
      }
    }

    throw new Error("All click strategies failed");
  }

  async waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      const observer = new MutationObserver(() => {
        const element = document.querySelector(selector);
        if (element) {
          observer.disconnect();
          resolve(element);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Element ${selector} not found within ${timeout}ms`));
      }, timeout);
    });
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
