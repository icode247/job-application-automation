export class RecruiteeFormHandler {
  constructor(aiService, userService, logger) {
    this.aiService = aiService;
    this.userService = userService;
    this.logger = logger;
    this.answerCache = new Map();
  }

  log(message, data = {}) {
    if (typeof this.logger === "function") {
      this.logger(message);
    } else if (this.logger && this.logger.log) {
      this.logger.log(message, data);
    } else {
      console.log(`🤖 [RecruiteeHandler] ${message}`, data);
    }
  }

  async processApplicationForm() {
    try {
      this.log("🔍 Looking for Recruitee application form...");
      await this.delay(1000);

      // Find the specific Recruitee form
      const applicationForm = document.querySelector(
        "form#offer-application-form"
      );
      if (!applicationForm) {
        this.log("❌ No Recruitee application form found");
        return { success: false, reason: "no_form_found" };
      }

      this.log("✅ Found Recruitee application form");

      // Grab all fields using adapted method
      const fields = await this.grabRecruiteeFields(applicationForm);
      this.log(`📝 Found ${fields.length} form fields`);

      // Process each field
      for (const field of fields) {
        await this.handleRecruiteeField(field);
        await this.delay(300);
      }

      // Handle required checkboxes (privacy/consent)
      await this.handleRequiredCheckboxes(applicationForm);

      // Find and click submit button
      const submitButton = this.findSubmitButton(applicationForm);
      if (submitButton && !submitButton.disabled) {
        this.log("📤 Submitting application form");
        await this.clickElementReliably(submitButton);
        await this.delay(3000);

        return {
          success: true,
          message: "Form processed successfully",
        };
      } else {
        this.log("❌ Submit button not available or disabled");
        return {
          success: false,
          reason: "submit_button_disabled",
        };
      }
    } catch (error) {
      this.log("❌ Error processing application form:", error.message);
      return {
        success: false,
        reason: "error",
        error: error.message,
      };
    }
  }

  async grabRecruiteeFields(form) {
    const results = [];

    // Get all form containers and input elements
    const containers = form.querySelectorAll(
      ".sc-1mqz0cx-3, fieldset, section"
    );
    const directInputs = form.querySelectorAll(
      'input:not([type="hidden"]), select, textarea'
    );

    this.log(
      `🔍 Found ${containers.length} containers and ${directInputs.length} direct inputs`
    );

    // Process containers first (for complex fields)
    for (const container of containers) {
      const fieldInfo = await this.processRecruiteeContainer(container);
      if (fieldInfo) {
        results.push(fieldInfo);
      }
    }

    // Process any remaining direct inputs not caught by containers
    for (const input of directInputs) {
      if (
        input.hasAttribute("data-processed") ||
        !this.isElementVisible(input)
      ) {
        continue;
      }

      const fieldInfo = this.processDirectInput(input);
      if (fieldInfo && fieldInfo.label) {
        results.push(fieldInfo);
        input.setAttribute("data-processed", "true");
      }
    }

    return this.deduplicateFields(results);
  }

  async processRecruiteeContainer(container) {
    try {
      // Skip if already processed
      if (container.hasAttribute("data-processed")) {
        return null;
      }

      let result = {
        element: null,
        type: "",
        label: "",
        required: false,
        options: [],
      };

      // Handle fieldset radio groups
      if (container.tagName.toLowerCase() === "fieldset") {
        const legend = container.querySelector("legend");
        if (legend) {
          result.label = this.cleanLabelText(legend.textContent);
          result.required = this.isRequiredByText(result.label);
        }

        const radioInputs = container.querySelectorAll('input[type="radio"]');
        if (radioInputs.length > 0) {
          result.type = "radio";
          result.element = [...radioInputs];
          result.options = [...radioInputs].map((input) => {
            const label =
              input.closest("label") ||
              document.querySelector(`label[for="${input.id}"]`);
            if (label) {
              // Get the text from the last span (Recruitee structure)
              const span = label.querySelector("span:last-child");
              return span ? span.textContent.trim() : label.textContent.trim();
            }
            return input.value || "Unknown";
          });

          this.log(
            `📻 Radio group: ${
              result.label
            } with options: ${result.options.join(", ")}`
          );
          container.setAttribute("data-processed", "true");
          return result;
        }
      }

      // Handle regular input containers
      const label = container.querySelector("label");
      const input = container.querySelector("input, select, textarea");

      if (label && input && !input.hasAttribute("data-processed")) {
        result.label = this.cleanLabelText(label.textContent);
        result.required = this.isRequiredByText(result.label) || input.required;
        result.element = input;
        result.type = this.getInputType(input);

        // Handle special phone field
        if (
          result.type === "tel" ||
          input.classList.contains("PhoneInputInput")
        ) {
          result.type = "phone";
          this.log(`📞 Phone field: ${result.label}`);
        }

        // Handle file inputs
        if (result.type === "file") {
          this.log(`📎 File field: ${result.label}`);
        }

        // Handle select options
        if (result.type === "select") {
          result.options = this.getSelectOptions(input);
          this.log(
            `📋 Select field: ${
              result.label
            } with options: ${result.options.join(", ")}`
          );
        }

        if (result.label && result.type !== "file") {
          this.log(`📝 Input field: ${result.label} (${result.type})`);
          input.setAttribute("data-processed", "true");
          container.setAttribute("data-processed", "true");
          return result;
        }
      }

      return null;
    } catch (error) {
      this.log(`❌ Error processing container: ${error.message}`);
      return null;
    }
  }

  processDirectInput(input) {
    try {
      const result = {
        element: input,
        type: this.getInputType(input),
        label: this.getInputLabel(input),
        required:
          input.required || input.getAttribute("aria-required") === "true",
        options: [],
      };

      if (result.type === "select") {
        result.options = this.getSelectOptions(input);
      }

      return result;
    } catch (error) {
      this.log(`❌ Error processing direct input: ${error.message}`);
      return null;
    }
  }

  getInputType(input) {
    if (input.tagName.toLowerCase() === "select") return "select";
    if (input.tagName.toLowerCase() === "textarea") return "textarea";
    if (input.tagName.toLowerCase() === "input") {
      const type = input.type.toLowerCase();
      if (type === "tel" || input.classList.contains("PhoneInputInput"))
        return "phone";
      return type;
    }
    return "unknown";
  }

  getInputLabel(input) {
    // Try label[for] first
    if (input.id) {
      const label = document.querySelector(`label[for="${input.id}"]`);
      if (label) {
        return this.cleanLabelText(label.textContent);
      }
    }

    // Try parent label
    const parentLabel = input.closest("label");
    if (parentLabel) {
      return this.cleanLabelText(parentLabel.textContent);
    }

    // Try preceding label in container
    const container = input.closest(".sc-1mqz0cx-3, .form-group, div");
    if (container) {
      const label = container.querySelector("label");
      if (label) {
        return this.cleanLabelText(label.textContent);
      }
    }

    // Fallback to placeholder or name
    return this.cleanLabelText(
      input.placeholder || input.name || "Unknown field"
    );
  }

  getSelectOptions(select) {
    const options = [];
    Array.from(select.options).forEach((option) => {
      const text = option.textContent.trim();
      const value = option.value.trim();
      if (text && value && value !== "? undefined:undefined ?") {
        options.push(text);
      }
    });
    return options;
  }

  async handleRecruiteeField(field) {
    try {
      this.log(`🔧 Processing field: ${field.label} (${field.type})`);

      // Skip file fields
      if (field.type === "file") {
        this.log(`⏭️ Skipping file field: ${field.label}`);
        return;
      }

      const answer = await this.getAnswer(field.label, field.options);

      if (!answer && answer !== 0) {
        if (
          field.required &&
          Array.isArray(field.element) &&
          field.element[0]
        ) {
          // Click first option for required fields with no answer
          field.element[0].click();
          this.log(
            `✅ Selected first option for required field: ${field.label}`
          );
        } else {
          this.log(`⏭️ Skipping field with no answer: ${field.label}`);
        }
        return;
      }

      // Handle different field types
      switch (field.type) {
        case "radio":
          await this.handleRadioField(field, answer);
          break;
        case "checkbox":
          await this.handleCheckboxField(field, answer);
          break;
        case "select":
          await this.handleSelectField(field, answer);
          break;
        case "phone":
          await this.handlePhoneField(field, answer);
          break;
        case "textarea":
          await this.handleTextareaField(field, answer);
          break;
        case "number":
          await this.handleNumberField(field, answer);
          break;
        default:
          await this.handleTextInput(field, answer);
      }
    } catch (error) {
      this.log(`❌ Error handling field "${field.label}": ${error.message}`);
    }
  }

  async handleRadioField(field, answer) {
    if (!Array.isArray(field.element)) return;

    const answerLower = answer.toLowerCase().trim();

    for (const radio of field.element) {
      const label =
        radio.closest("label") ||
        document.querySelector(`label[for="${radio.id}"]`);
      if (label) {
        const span = label.querySelector("span:last-child");
        const labelText = span
          ? span.textContent.trim().toLowerCase()
          : label.textContent.trim().toLowerCase();

        if (
          this.matchesValue(answerLower, labelText, radio.value.toLowerCase())
        ) {
          this.scrollToElement(radio);
          radio.click();
          this.log(`✅ Selected "${labelText}" for: ${field.label}`);
          return;
        }
      }
    }

    this.log(
      `⚠️ Could not find matching option "${answer}" for: ${field.label}`
    );
  }

  async handleSelectField(field, answer) {
    const select = field.element;
    const answerLower = answer.toLowerCase();

    this.scrollToElement(select);
    select.focus();
    await this.delay(200);

    let optionSelected = false;
    const options = Array.from(select.options);

    for (const option of options) {
      const optionText = option.textContent.trim().toLowerCase();
      const optionValue = option.value.toLowerCase();

      if (this.matchesValue(answerLower, optionText, optionValue)) {
        option.selected = true;
        optionSelected = true;
        this.log(
          `✅ Selected "${option.textContent.trim()}" for: ${field.label}`
        );
        break;
      }
    }

    if (!optionSelected && options.length > 1) {
      // Select first non-empty option
      for (const option of options) {
        if (option.value && option.value !== "" && option.value !== "null") {
          option.selected = true;
          optionSelected = true;
          this.log(
            `✅ Selected fallback "${option.textContent.trim()}" for: ${
              field.label
            }`
          );
          break;
        }
      }
    }

    if (optionSelected) {
      select.dispatchEvent(new Event("change", { bubbles: true }));
      await this.delay(200);
    }
  }

  async handlePhoneField(field, answer) {
    const phoneInput = field.element;

    // Get user phone data
    const userData = await this.userService.getUserDetails();
    const phoneCode = userData.phoneCode || userData.phoneCountryCode || "+1";
    const phoneNumber = userData.phoneNumber || userData.phone || answer;

    if (!phoneNumber) {
      this.log(`⚠️ No phone number available for: ${field.label}`);
      return;
    }

    // Clean and format phone number
    let cleanCode = phoneCode.replace(/[+\-\s()]/g, "");
    let cleanNumber = phoneNumber.replace(/^\+\d+\s*/, "").replace(/^0+/, "");
    const formattedPhone = `+${cleanCode}${cleanNumber}`;

    await this.fillInputField(phoneInput, formattedPhone);
    this.log(`✅ Filled phone field "${field.label}" with: ${formattedPhone}`);
  }

  async handleTextareaField(field, answer) {
    await this.fillInputField(field.element, answer);
    this.log(
      `✅ Filled textarea "${field.label}" with ${answer.length} characters`
    );
  }

  async handleNumberField(field, answer) {
    // Extract numbers from answer
    const numericValue = answer.toString().replace(/[^\d.]/g, "");
    await this.fillInputField(field.element, numericValue);
    this.log(`✅ Filled number field "${field.label}" with: ${numericValue}`);
  }

  async handleTextInput(field, answer) {
    await this.fillInputField(field.element, answer);
    this.log(`✅ Filled text field "${field.label}" with: ${answer}`);
  }

  async handleCheckboxField(field, answer) {
    const checkbox = field.element;
    const shouldCheck = this.shouldCheckValue(answer);

    if (
      (shouldCheck && !checkbox.checked) ||
      (!shouldCheck && checkbox.checked)
    ) {
      this.scrollToElement(checkbox);

      const labelEl =
        checkbox.closest("label") ||
        document.querySelector(`label[for="${checkbox.id}"]`);
      if (labelEl) {
        labelEl.click();
      } else {
        checkbox.click();
      }

      await this.delay(200);
      this.log(`✅ Set checkbox "${field.label}" to: ${shouldCheck}`);
    }
  }

  async fillInputField(element, value) {
    try {
      this.scrollToElement(element);
      element.focus();
      await this.delay(100);

      // Clear field first
      element.value = "";
      element.dispatchEvent(new Event("input", { bubbles: true }));
      await this.delay(50);

      // Set new value
      element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new Event("blur", { bubbles: true }));

      await this.delay(100);
      return true;
    } catch (error) {
      this.log(`Error filling input field: ${error.message}`);
      return false;
    }
  }

  async handleRequiredCheckboxes(form) {
    try {
      this.log("🔍 Looking for required checkboxes");

      const requiredCheckboxes = form.querySelectorAll(
        'input[type="checkbox"][required], input[type="checkbox"][aria-required="true"]'
      );

      for (const checkbox of requiredCheckboxes) {
        if (!this.isElementVisible(checkbox)) continue;

        const label = this.getInputLabel(checkbox);
        const isAgreement = this.isAgreementCheckbox(label);

        if (isAgreement || checkbox.required) {
          this.log(`✅ Checking required/agreement checkbox: ${label}`);
          await this.handleCheckboxField({ element: checkbox, label }, true);
          await this.delay(200);
        }
      }
    } catch (error) {
      this.log(`❌ Error handling required checkboxes: ${error.message}`);
    }
  }

  findSubmitButton(form) {
    const submitSelectors = [
      'button[type="submit"]',
      'button[data-testid="submit-application-form-button"]',
      'input[type="submit"]',
      "button.btn-primary",
      "button.submit-button",
    ];

    for (const selector of submitSelectors) {
      const button = form.querySelector(selector);
      if (button && this.isElementVisible(button) && !button.disabled) {
        return button;
      }
    }

    // Look for buttons with submit-like text
    const allButtons = form.querySelectorAll("button");
    for (const btn of allButtons) {
      if (!this.isElementVisible(btn) || btn.disabled) continue;

      const text = btn.textContent.toLowerCase();
      if (
        text.includes("submit") ||
        text.includes("send") ||
        text.includes("apply")
      ) {
        return btn;
      }
    }

    return null;
  }

  async getAnswer(label, options = []) {
    const normalizedLabel = label?.toLowerCase()?.trim() || "";

    if (this.answerCache.has(normalizedLabel)) {
      this.log(`🔄 Using cached answer for: ${label}`);
      return this.answerCache.get(normalizedLabel);
    }

    try {
      this.log(`🤖 Getting AI answer for: "${label}"`);

      const context = {
        platform: "recruitee",
        userData: await this.userService.getUserDetails(),
        jobDescription: this.scrapeJobDescription(),
      };

      const answer = await this.aiService.getAnswer(label, options, context);
      const cleanedAnswer = answer.replace(/["*\-]/g, "");

      this.answerCache.set(normalizedLabel, cleanedAnswer);
      this.log(`✅ Got AI answer for "${label}": ${cleanedAnswer}`);
      return cleanedAnswer;
    } catch (error) {
      this.log(`❌ AI Answer Error for "${label}": ${error.message}`);
      return this.getFallbackAnswer(normalizedLabel, options);
    }
  }

  getFallbackAnswer(normalizedLabel, options = []) {
    const defaultAnswers = {
      "full name": "John Doe",
      email: "john.doe@example.com",
      phone: "555-0123",
      location: "New York, USA",
      "current location": "New York, USA",
      "visa sponsorship": "No",
      "need visa": "No",
      linkedin: "https://linkedin.com/in/johndoe",
      "linkedin profile": "https://linkedin.com/in/johndoe",
      salary: "80000",
      "expected salary": "80000",
      "annual salary": "80000",
      "how did you hear": "LinkedIn",
      "hear about": "LinkedIn",
      experience: "Yes",
      "authorized to work": "Yes",
      "work authorization": "Yes",
    };

    for (const [key, value] of Object.entries(defaultAnswers)) {
      if (normalizedLabel.includes(key)) {
        this.log(`🔄 Using fallback answer for "${normalizedLabel}": ${value}`);
        return value;
      }
    }

    if (options.length > 0) {
      this.log(`🔄 Using first option for "${normalizedLabel}": ${options[0]}`);
      return options[0];
    }

    this.log(`🔄 Using default fallback for "${normalizedLabel}": Yes`);
    return "Yes";
  }

  scrapeJobDescription() {
    try {
      const descriptionSelectors = [
        ".job-description",
        '[data-testid="job-description"]',
        ".description",
        '[class*="description"]',
      ];

      for (const selector of descriptionSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          return element.textContent.trim().substring(0, 500);
        }
      }

      return "No job description found";
    } catch (error) {
      return "No job description found";
    }
  }

  // Helper methods
  cleanLabelText(text) {
    if (!text) return "";
    return text
      .replace(/[*✱]/g, "")
      .replace(/\s+/g, " ")
      .replace(/^\s+|\s+$/g, "")
      .replace(/\(required\)/i, "")
      .replace(/\(optional\)/i, "")
      .trim();
  }

  isRequiredByText(text) {
    return (
      text.includes("*") ||
      text.includes("✱") ||
      text.toLowerCase().includes("required")
    );
  }

  isAgreementCheckbox(label) {
    if (!label) return false;
    const lowerLabel = label.toLowerCase();
    const agreementTerms = [
      "agree",
      "accept",
      "consent",
      "terms",
      "privacy",
      "policy",
    ];
    return agreementTerms.some((term) => lowerLabel.includes(term));
  }

  shouldCheckValue(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const lowerValue = value.toLowerCase().trim();
      return (
        lowerValue === "true" ||
        lowerValue === "yes" ||
        lowerValue === "on" ||
        lowerValue === "1"
      );
    }
    if (typeof value === "number") return value === 1;
    return false;
  }

  matchesValue(aiValue, optionText, optionValue) {
    if (aiValue === optionText || aiValue === optionValue) return true;
    if (optionText.includes(aiValue) || aiValue.includes(optionText))
      return true;
    if (optionValue.includes(aiValue) || aiValue.includes(optionValue))
      return true;

    // Special cases for yes/no
    if (
      (aiValue === "yes" || aiValue === "true") &&
      (optionText === "yes" || optionValue === "yes")
    )
      return true;
    if (
      (aiValue === "no" || aiValue === "false") &&
      (optionText === "no" || optionValue === "no")
    )
      return true;

    return false;
  }

  deduplicateFields(fields) {
    const uniqueFields = [];
    const seenLabels = new Set();

    for (const field of fields) {
      const labelKey = `${field.type}:${field.label.toLowerCase()}`;
      if (!seenLabels.has(labelKey)) {
        seenLabels.add(labelKey);
        uniqueFields.push(field);
      }
    }

    return uniqueFields;
  }

  isElementVisible(element) {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0"
    );
  }

  scrollToElement(element) {
    if (!element) return;
    try {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
    } catch (error) {
      // Silent fail
    }
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

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
