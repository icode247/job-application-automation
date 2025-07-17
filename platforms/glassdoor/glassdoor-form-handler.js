// platforms/glassdoor/glassdoor-form-handler.js - FIXED FOR SMARTAPPLY FLOW
import { DomUtils, FormUtils } from "../../shared/utilities/index.js";

export default class GlassdoorFormHandler {
  constructor(config) {
    this.logger = config.logger || console.log;
    this.host = config.host || "http://localhost:3000";
    this.userData = config.userData || {};
    this.jobDescription = config.jobDescription || "";
    this.answerCache = new Map();

    // SmartApply specific configuration based on your description
    this.smartApplyConfig = {
      selectors: {
        continueButton:
          "button[data-testid='aa288590cde54b4a3f778f52168e7b17f']", // From your description
        submitButton: "button[type='submit']",
        form: "form",
        // Step-specific selectors
        resumeUpload: "input[type='file']",
        contactForm:
          "input[name*='name'], input[type='email'], input[type='tel']",
        questionsForm: "input[type='radio'], select, textarea",
        reviewPage: "*:contains('review'), *:contains('submit')",
      },
      maxSteps: 10,
      stepTimeout: 30000,
    };
  }

  log(message, data = {}) {
    if (this.logger) {
      this.logger(message);
    }
    console.log(`🤖 [GlassdoorFormHandler] ${message}`, data);
  }

  // ========================================
  // MAIN INDEED SMARTAPPLY PROCESSING
  // ========================================

  async processIndeedSmartApply() {
    try {
      this.log("🎯 Starting Indeed SmartApply process");

      // Wait for SmartApply page to fully load
      await this.waitForElement("form, .ia-BasePage-main", 20000);
      await this.delay(3000);

      // Verify this is Indeed SmartApply
      if (!this.isIndeedSmartApplyPage()) {
        throw new Error("Not an Indeed SmartApply page");
      }

      // Extract job title for context
      const jobTitle = this.extractJobTitle();
      this.log(`📋 Processing SmartApply for: ${jobTitle}`);

      // Process multi-step application following your described flow
      let currentStep = 1;
      let applicationCompleted = false;

      while (
        currentStep <= this.smartApplyConfig.maxSteps &&
        !applicationCompleted
      ) {
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
        const stepResult = await this.processSmartApplyStep(currentStep);

        if (stepResult.completed) {
          applicationCompleted = true;
          break;
        } else if (stepResult.needsSubmit) {
          // Final step - submit the application
          const submitButton = this.findSubmitButton();
          if (submitButton) {
            this.log("📤 Found submit button, submitting application");
            await this.clickElementReliably(submitButton);
            await this.delay(5000);

            if (this.checkSmartApplyCompletion()) {
              applicationCompleted = true;
              break;
            }
          }
        } else if (stepResult.nextStep) {
          // Continue to next step using the CORRECT button selector
          const continueButton = this.findContinueButton();
          if (continueButton) {
            this.log("🔄 Moving to next SmartApply step");
            await this.clickElementReliably(continueButton);
            await this.delay(3000);
            currentStep++;
          } else {
            throw new Error("Cannot find continue button to proceed");
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
        null ||
      document.title.toLowerCase().includes("indeed") ||
      document.querySelector("form") !== null // Generic form check for SmartApply
    );
  }

  async processSmartApplyStep(stepNumber) {
    try {
      this.log(`🔧 Processing SmartApply step ${stepNumber}`);

      // Determine step type based on page content
      if (this.isResumeStep()) {
        this.log("📄 Detected resume upload step");
        return await this.handleResumeStep();
      } else if (this.isContactInfoStep()) {
        this.log("👤 Detected contact information step");
        return await this.handleContactInfoStep();
      } else if (this.isQuestionsStep()) {
        this.log("❓ Detected questions/form step");
        return await this.handleQuestionsStep();
      } else if (this.isReviewStep()) {
        this.log("📋 Detected review/submit step");
        return await this.handleReviewStep();
      } else {
        this.log("📝 Detected generic form step");
        return await this.handleGenericStep();
      }
    } catch (error) {
      this.log("❌ Error processing SmartApply step:", error.message);
      throw error;
    }
  }

  // ========================================
  // STEP TYPE DETECTION
  // ========================================

  isResumeStep() {
    return (
      document.querySelector(this.smartApplyConfig.selectors.resumeUpload) !==
        null ||
      document.body.textContent.toLowerCase().includes("resume") ||
      document.body.textContent.toLowerCase().includes("upload") ||
      window.location.href.includes("/resume")
    );
  }

  isContactInfoStep() {
    return (
      document.querySelector(this.smartApplyConfig.selectors.contactForm) !==
      null
    );
  }

  isQuestionsStep() {
    return (
      document.querySelector(this.smartApplyConfig.selectors.questionsForm) !==
        null ||
      document.body.textContent.toLowerCase().includes("question") ||
      document.querySelectorAll("input[type='radio'], select").length > 0
    );
  }

  isReviewStep() {
    const pageText = document.body.textContent.toLowerCase();
    return (
      pageText.includes("review") ||
      pageText.includes("submit") ||
      pageText.includes("confirm") ||
      document.querySelector(this.smartApplyConfig.selectors.submitButton) !==
        null
    );
  }

  // ========================================
  // STEP HANDLERS
  // ========================================

  async handleResumeStep() {
    this.log("📄 Handling resume upload step");

    try {
      // Look for file input
      const fileInput = document.querySelector(
        this.smartApplyConfig.selectors.resumeUpload
      );

      if (fileInput && this.userData.resumeUrl) {
        this.log("📎 Resume upload field found");

        // Check if resume is already uploaded/detected
        const resumeStatus = document.querySelector(
          ".resume-uploaded, .file-uploaded, .upload-success, [data-testid*='resume']"
        );

        if (resumeStatus) {
          this.log("✅ Resume already detected/uploaded");
          return { nextStep: true };
        }

        // For SmartApply, often the resume is auto-detected from Indeed profile
        this.log("📎 Resume upload may be handled automatically by Indeed");
        return { nextStep: true };
      }

      this.log("✅ Resume step completed");
      return { nextStep: true };
    } catch (error) {
      this.log("⚠️ Resume upload error:", error.message);
      return { nextStep: true }; // Continue anyway
    }
  }

  async handleContactInfoStep() {
    this.log("👤 Handling contact information step");

    try {
      // Fill name fields
      await this.fillFieldBySelectors(
        [
          "input[name*='firstName']",
          "input[placeholder*='First name' i]",
          "input[aria-label*='First name' i]",
        ],
        this.userData.firstName
      );

      await this.fillFieldBySelectors(
        [
          "input[name*='lastName']",
          "input[placeholder*='Last name' i]",
          "input[aria-label*='Last name' i]",
        ],
        this.userData.lastName
      );

      // Fill email
      await this.fillFieldBySelectors(
        [
          "input[type='email']",
          "input[name*='email']",
          "input[placeholder*='email' i]",
        ],
        this.userData.email
      );

      // Fill phone
      const phoneNumber = this.formatPhoneNumber(this.userData.phoneNumber);
      await this.fillFieldBySelectors(
        [
          "input[type='tel']",
          "input[name*='phone']",
          "input[placeholder*='phone' i]",
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

  async handleQuestionsStep() {
    this.log("❓ Handling questions step");

    try {
      // Process all form fields on the page
      const fields = this.getAllFormFields();
      this.log(`Found ${fields.length} form fields to process`);

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

  async handleReviewStep() {
    this.log("📋 Handling review/submit step");

    // This is typically the final step, so we need to submit
    return { needsSubmit: true };
  }

  async handleGenericStep() {
    this.log("📝 Handling generic form step");

    try {
      // Process any visible form fields
      const fields = this.getAllFormFields();

      for (const field of fields) {
        await this.processFormField(field);
        await this.delay(200);
      }

      return { nextStep: true };
    } catch (error) {
      this.log("⚠️ Generic step error:", error.message);
      return { nextStep: true };
    }
  }

  // ========================================
  // BUTTON DETECTION (Using correct selectors from your description)
  // ========================================

  findContinueButton() {
    // First try the EXACT selector from your description
    const exactButton = document.querySelector(
      this.smartApplyConfig.selectors.continueButton
    );
    if (
      exactButton &&
      this.isElementVisible(exactButton) &&
      !exactButton.disabled
    ) {
      this.log("✅ Found continue button with exact selector");
      return exactButton;
    }

    // Fallback selectors for continue buttons
    const fallbackSelectors = [
      "button:contains('Continue')",
      "button:contains('Next')",
      "button[type='button']:contains('Continue')",
      ".aba5bff612c96e760268ff66780c44f60", // Additional class from your description
      "button.css-q81v3z", // Another class mentioned
      "button[data-testid*='continue']",
      "button[data-testid*='next']",
    ];

    for (const selector of fallbackSelectors) {
      try {
        if (selector.includes(":contains(")) {
          // Handle text-based selectors manually
          const buttons = document.querySelectorAll("button");
          for (const button of buttons) {
            const text = button.textContent?.toLowerCase() || "";
            if (
              (selector.includes("Continue") && text.includes("continue")) ||
              (selector.includes("Next") && text.includes("next"))
            ) {
              if (this.isElementVisible(button) && !button.disabled) {
                this.log(`✅ Found continue button with text: "${text}"`);
                return button;
              }
            }
          }
        } else {
          const button = document.querySelector(selector);
          if (button && this.isElementVisible(button) && !button.disabled) {
            this.log(`✅ Found continue button with selector: ${selector}`);
            return button;
          }
        }
      } catch (error) {
        continue;
      }
    }

    this.log("❌ No continue button found");
    return null;
  }

  findSubmitButton() {
    const submitSelectors = [
      "button[type='submit']",
      "button:contains('Submit')",
      "button:contains('Apply')",
      "button:contains('Send')",
      ".submit-btn",
      ".apply-btn",
      "button[data-testid*='submit']",
    ];

    for (const selector of submitSelectors) {
      try {
        if (selector.includes(":contains(")) {
          // Handle text-based selectors manually
          const buttons = document.querySelectorAll("button");
          for (const button of buttons) {
            const text = button.textContent?.toLowerCase() || "";
            if (
              (selector.includes("Submit") && text.includes("submit")) ||
              (selector.includes("Apply") && text.includes("apply")) ||
              (selector.includes("Send") && text.includes("send"))
            ) {
              if (this.isElementVisible(button) && !button.disabled) {
                this.log(`✅ Found submit button with text: "${text}"`);
                return button;
              }
            }
          }
        } else {
          const button = document.querySelector(selector);
          if (button && this.isElementVisible(button) && !button.disabled) {
            this.log(`✅ Found submit button with selector: ${selector}`);
            return button;
          }
        }
      } catch (error) {
        continue;
      }
    }

    this.log("❌ No submit button found");
    return null;
  }

  // ========================================
  // COMPLETION DETECTION
  // ========================================

  checkSmartApplyCompletion() {
    // Check for success indicators
    const successIndicators = [
      "application submitted",
      "application complete",
      "thank you",
      "confirmation",
      "success",
      "application sent",
      "we've received your application",
    ];

    const pageText = document.body.textContent.toLowerCase();
    const hasSuccessText = successIndicators.some((indicator) =>
      pageText.includes(indicator)
    );

    // Check for success elements
    const successElements = document.querySelectorAll(
      ".success, .confirmation, .complete, [data-testid*='success'], [class*='success']"
    );
    const hasSuccessElement = successElements.length > 0;

    // Check URL for success indicators
    const url = window.location.href.toLowerCase();
    const hasSuccessUrl =
      url.includes("success") ||
      url.includes("confirmation") ||
      url.includes("complete") ||
      url.includes("thank");

    // Check if redirected away from SmartApply
    const redirectedAway = !url.includes("smartapply.indeed.com");

    const isComplete =
      hasSuccessText || hasSuccessElement || hasSuccessUrl || redirectedAway;

    if (isComplete) {
      this.log("✅ SmartApply completion detected");
    }

    return isComplete;
  }

  extractJobTitle() {
    const selectors = [
      "h1",
      ".job-title",
      ".jobTitle",
      "[data-testid='job-title']",
      ".ia-JobHeader-title",
      "title",
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && element.textContent) {
        return element.textContent.trim();
      }
    }

    // Fallback to page title
    if (document.title) {
      return document.title.split(" - ")[0].trim();
    }

    return "Job Application";
  }

  // ========================================
  // FORM FIELD PROCESSING (Enhanced)
  // ========================================

  getAllFormFields(container = document) {
    const fields = [];
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
          // File inputs are typically handled separately
          this.log("📎 File input detected - skipping automatic fill");
          break;

        default:
          this.log(`❓ Unknown field type: ${field.type}`);
      }

      this.log(`✅ Filled field: ${field.label} = ${answer}`);
    } catch (error) {
      this.log(`❌ Error processing field ${field.label}:`, error.message);
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

    // Check for exact matches first
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
      "hear about": "Online",
      "how did you hear": "Online job search",
    };

    for (const [key, value] of Object.entries(fallbackAnswers)) {
      if (normalizedLabel.includes(key)) {
        return value;
      }
    }

    return "Yes"; // Default fallback
  }

  // ========================================
  // FIELD FILLING METHODS
  // ========================================

  async fillTextInput(element, value) {
    element.focus();
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.blur();
    await this.delay(200);
  }

  async fillTextarea(element, value) {
    element.focus();
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.blur();
    await this.delay(200);
  }

  async fillSelect(element, value) {
    const options = element.querySelectorAll("option");

    for (const option of options) {
      const optionText = option.textContent.toLowerCase();
      const optionValue = option.value.toLowerCase();
      const searchValue = value.toString().toLowerCase();

      if (
        optionText.includes(searchValue) ||
        optionValue.includes(searchValue) ||
        searchValue.includes(optionText)
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
      if (element && this.isElementVisible(element)) {
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

  isElementVisible(element) {
    if (!element) return false;

    try {
      const style = window.getComputedStyle(element);
      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      ) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    } catch (error) {
      return false;
    }
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
