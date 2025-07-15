export default class WellfoundFormHandler {
  constructor(aiService, userService, logger) {
    this.aiService = aiService;
    this.userService = userService;
    this.logger = logger;
    this.answerCache = new Map(); // Add caching like LinkedIn
  }

  log(message, data = {}) {
    if (this.logger) {
      this.logger.log(message, data);
    } else {
      console.log(`🤖 [FormHandler] ${message}`, data);
    }
  }

  checkForLocationRestrictions() {
    try {
      // Look for location restriction error or warning messages
      const restrictionSelectors = [
        ".shared_fieldError__t2UkY",
        ".styles-module_component__HiSmQ",
        ".text-dark-error",
        ".text-dark-warning",
        '[class*="error"]',
        '[class*="warning"]',
      ];

      for (const selector of restrictionSelectors) {
        const restrictionElements = document.querySelectorAll(selector);
        for (const element of restrictionElements) {
          const restrictionText = element.textContent?.toLowerCase() || "";
          if (
            restrictionText.includes("location") ||
            restrictionText.includes("timezone") ||
            restrictionText.includes("relocation") ||
            restrictionText.includes("not accepting applications") ||
            restrictionText.includes("does not support")
          ) {
            this.log(`🌍 Restriction found: ${restrictionText}`);
            return element.textContent.trim();
          }
        }
      }

      return null;
    } catch (error) {
      this.log("❌ Error checking restrictions:", error.message);
      return null;
    }
  }

  async processApplicationForm() {
    try {
      this.log("🔍 Looking for application form...");

      // Wait a bit for form to appear after clicking apply
      await this.delay(1000);

      // Look for application forms - exclude search forms
      const formSelectors = [
        'form:has(button[data-test="JobDescriptionSlideIn--SubmitButton"])',
        'form:has(button[type="submit"])',
        "form:has(textarea)",
        '[role="dialog"] form',
        ".application-form",
      ];

      let applicationForm = null;
      for (const selector of formSelectors) {
        try {
          const form = document.querySelector(selector);
          if (form && this.isApplicationForm(form)) {
            applicationForm = form;
            this.log(`✅ Found application form via selector: ${selector}`);
            break;
          }
        } catch (error) {
          continue;
        }
      }

      if (!applicationForm) {
        this.log("❌ No application form found");
        return { success: false, reason: "no_form_found" };
      }

      // Check for restrictions first
      const restriction = this.checkForLocationRestrictions();
      if (restriction) {
        this.log("❌ Form is restricted, skipping extraction");
        return {
          success: false,
          reason: "location_restricted",
          error: restriction,
        };
      }

      // Process form fields individually (LinkedIn approach)
      const success = await this.fillCurrentStep(applicationForm);

      if (success) {
        const submitSuccess = await this.submitForm(applicationForm);
        if (submitSuccess) {
          return {
            success: true,
            form: applicationForm,
            message: "Form processed successfully",
          };
        }
      } else {
        return {
          success: false,
          reason: "form_processing_failed",
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

  // LinkedIn-style form processing
  async fillCurrentStep(form) {
    try {
      // Find all form fields in current step
      const formFields = this.getCurrentStepFields(form);

      this.log(`📝 Processing ${formFields.length} form fields`);

      for (const field of formFields) {
        if (field.hasAttribute("data-processed")) {
          continue; // Skip already processed fields
        }

        await this.handleField(field);
        field.setAttribute("data-processed", "true");
      }

      return true;
    } catch (error) {
      this.log("❌ Error filling current step:", error.message);
      return false;
    }
  }

  getCurrentStepFields(form) {
    // Get all input elements that are currently visible and not processed
    const allInputs = form.querySelectorAll("input, textarea, select");
    const currentStepFields = [];

    for (const input of allInputs) {
      // Skip hidden, submit, and search fields
      if (input.type === "hidden" || input.type === "submit") continue;

      // Skip if not visible
      if (!this.isElementVisible(input)) continue;

      const fieldName = (input.name || input.id || "").toLowerCase();
      const fieldPlaceholder = (input.placeholder || "").toLowerCase();

      // Skip search-related fields
      if (fieldName.includes("search") || fieldPlaceholder.includes("search")) {
        continue;
      }

      currentStepFields.push(input);
    }

    return currentStepFields;
  }

  async handleField(field) {
    try {
      const fieldType = field.type || field.tagName.toLowerCase();

      // Route to appropriate handler based on field type
      switch (fieldType) {
        case "select":
          await this.handleSelectField(field);
          break;
        case "radio":
          await this.handleRadioField(field);
          break;
        case "checkbox":
          await this.handleCheckboxField(field);
          break;
        case "textarea":
          await this.handleTextAreaField(field);
          break;
        case "text":
        case "email":
        case "tel":
        case "url":
          await this.handleTextField(field);
          break;
        default:
          this.log(`⚠️ Unknown field type: ${fieldType}`);
      }
    } catch (error) {
      this.log(`❌ Error handling field: ${error.message}`);
    }
  }

  async handleSelectField(select) {
    const label = this.getFieldLabel(select);
    const options = this.extractSelectOptions(select);

    if (options.length === 0) {
      this.log(`⚠️ No options found for select field: ${label}`);
      return;
    }

    const answer = await this.getAnswer(label, options);

    // Find matching option and select it
    const matchingOption = Array.from(select.options).find(
      (opt) => opt.text.trim() === answer || opt.value === answer
    );

    if (matchingOption) {
      select.value = matchingOption.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      this.log(`✅ Selected "${answer}" for: ${label}`);
    } else {
      this.log(`⚠️ Could not find matching option "${answer}" for: ${label}`);
    }
  }

  async handleRadioField(radio) {
    const container = radio.closest("fieldset") || radio.closest("div");
    const label = this.getFieldLabel(radio);
    const options = this.extractRadioOptions(radio, container);

    if (options.length === 0) {
      this.log(`⚠️ No options found for radio field: ${label}`);
      return;
    }

    const answer = await this.getAnswer(label, options);

    // Find and click the matching radio button
    const radioInputs = container.querySelectorAll(
      `input[name="${radio.name}"]`
    );
    for (const radioInput of radioInputs) {
      const radioLabel = this.getFieldLabel(radioInput);
      if (radioLabel.includes(answer) || radioInput.value === answer) {
        radioInput.checked = true;
        radioInput.dispatchEvent(new Event("change", { bubbles: true }));
        this.log(`✅ Selected "${answer}" for: ${label}`);
        break;
      }
    }
  }

  async handleCheckboxField(checkbox) {
    const label = this.getFieldLabel(checkbox);
    const answer = await this.getAnswer(label, ["Yes", "No"]);

    const shouldCheck =
      answer.toLowerCase().includes("yes") ||
      answer.toLowerCase().includes("true");
    checkbox.checked = shouldCheck;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
    this.log(`✅ Set checkbox "${label}" to: ${shouldCheck}`);
  }

  async handleTextAreaField(textarea) {
    const label = this.getFieldLabel(textarea);
    const answer = await this.getAnswer(label);

    textarea.value = answer;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
    this.log(`✅ Filled textarea "${label}" with ${answer.length} characters`);
  }

  async handleTextField(textInput) {
    const label = this.getFieldLabel(textInput);
    const answer = await this.getAnswer(label);

    // Handle date fields
    if (this.isDateField(textInput, label)) {
      const formattedDate = this.formatDateForInput(answer);
      textInput.value = formattedDate;
    } else {
      textInput.value = answer;
    }

    textInput.dispatchEvent(new Event("input", { bubbles: true }));
    textInput.dispatchEvent(new Event("change", { bubbles: true }));
    textInput.dispatchEvent(new Event("blur", { bubbles: true }));

    this.log(`✅ Filled text field "${label}" with: ${answer}`);
  }

  // LinkedIn-style answer method (individual, with caching)
  async getAnswer(label, options = []) {
    const normalizedLabel = label?.toLowerCase()?.trim() || "";

    // Check cache first (like LinkedIn)
    if (this.answerCache.has(normalizedLabel)) {
      this.log(`🔄 Using cached answer for: ${label}`);
      return this.answerCache.get(normalizedLabel);
    }

    try {
      this.log(`🤖 Getting AI answer for: "${label}"`);

      // Use AI service for smart answers (same as LinkedIn)
      const context = {
        platform: "wellfound",
        userData: await this.userService.getUserDetails(),
        jobDescription: this.scrapeJobDescription(),
      };

      const answer = await this.aiService.getAnswer(label, options, context);
      const cleanedAnswer = answer.replace(/["*\-]/g, '');

      // Cache the answer (like LinkedIn)
      this.answerCache.set(normalizedLabel, cleanedAnswer);
      this.log(`✅ Got AI answer for "${label}": ${cleanedAnswer}`);
      return cleanedAnswer;
    } catch (error) {
      this.log(`❌ AI Answer Error for "${label}": ${error.message}`);

      // Fallback to default answers (like LinkedIn)
      return this.getFallbackAnswer(normalizedLabel, options);
    }
  }

  // LinkedIn-style fallback logic
  getFallbackAnswer(normalizedLabel, options = []) {
    const defaultAnswers = {
      "work authorization": "Yes",
      "authorized to work": "Yes",
      "require sponsorship": "No",
      "require visa": "No",
      "visa sponsorship": "No",
      experience: "2 years",
      "years of experience": "2 years",
      phone: "555-0123",
      salary: "80000",
      "expected salary": "80000",
      "desired salary": "80000",
      location: "Remote",
      "preferred location": "Remote",
      "willing to relocate": "Yes",
      "start date": "Immediately",
      "notice period": "2 weeks",
      availability: "Immediately",
    };

    // Check for keyword matches
    for (const [key, value] of Object.entries(defaultAnswers)) {
      if (normalizedLabel.includes(key)) {
        this.log(`🔄 Using fallback answer for "${normalizedLabel}": ${value}`);
        return value;
      }
    }

    // Return first option if available
    if (options.length > 0) {
      this.log(`🔄 Using first option for "${normalizedLabel}": ${options[0]}`);
      return options[0];
    }

    // Final fallback
    this.log(`🔄 Using default fallback for "${normalizedLabel}": Yes`);
    return "Yes";
  }

  getFieldLabel(field) {
    try {
      // Strategy 1: Look for associated label
      if (field.id) {
        const label = document.querySelector(`label[for="${field.id}"]`);
        if (label) {
          return this.cleanQuestionText(label.textContent);
        }
      }

      // Strategy 2: Look for parent label
      const parentLabel = field.closest("label");
      if (parentLabel) {
        const labelText = Array.from(parentLabel.childNodes)
          .filter(
            (node) =>
              node.nodeType === Node.TEXT_NODE ||
              (node.nodeType === Node.ELEMENT_NODE && node !== field)
          )
          .map((node) => node.textContent || "")
          .join(" ")
          .trim();
        if (labelText) return this.cleanQuestionText(labelText);
      }

      // Strategy 3: Look for preceding div with question text
      const container = field.closest("div");
      if (container) {
        const questionElements = container.querySelectorAll(
          "div, span, p, label"
        );
        for (const element of questionElements) {
          const text = element.textContent?.trim();
          if (
            text &&
            text.length > 10 &&
            (text.includes("?") || text.includes(":"))
          ) {
            return this.cleanQuestionText(text);
          }
        }
      }

      // Strategy 4: Look for preceding siblings
      let sibling = field.previousElementSibling;
      let attempts = 0;
      while (sibling && attempts < 3) {
        const text = sibling.textContent?.trim();
        if (text && text.length > 5) {
          return this.cleanQuestionText(text);
        }
        sibling = sibling.previousElementSibling;
        attempts++;
      }

      // Fallback: use placeholder or name
      return this.cleanQuestionText(
        field.placeholder || field.name || "Unknown field"
      );
    } catch (error) {
      return this.cleanQuestionText(
        field.placeholder || field.name || "Unknown field"
      );
    }
  }

  extractSelectOptions(select) {
    try {
      const options = [];
      const optionElements = select.querySelectorAll("option");

      for (const option of optionElements) {
        const text = this.cleanQuestionText(option.textContent || option.value);
        if (text && text !== "Select an option" && !options.includes(text)) {
          options.push(text);
        }
      }

      // Handle React-Select dropdowns
      if (options.length === 0) {
        const reactSelect = select.closest(".select__control");
        if (reactSelect) {
          const valueContainer = reactSelect.querySelector(
            ".select__single-value"
          );
          if (valueContainer) {
            const text = this.cleanQuestionText(valueContainer.textContent);
            if (text) options.push(text);
          }
        }
      }

      return options;
    } catch (error) {
      this.log("❌ Error extracting select options:", error.message);
      return [];
    }
  }

  extractRadioOptions(radio, container) {
    try {
      const options = [];
      const name = radio.name;
      const sameNameInputs = container.querySelectorAll(
        `input[name="${name}"]`
      );

      for (const sameInput of sameNameInputs) {
        const label =
          document.querySelector(`label[for="${sameInput.id}"]`) ||
          sameInput.closest("label") ||
          sameInput.nextElementSibling;

        const optionText = label
          ? this.cleanQuestionText(label.textContent)
          : sameInput.value || `Option ${options.length + 1}`;

        if (optionText && !options.includes(optionText)) {
          options.push(optionText);
        }
      }
      return options;
    } catch (error) {
      this.log("❌ Error extracting radio options:", error.message);
      return [];
    }
  }

  isDateField(input, label) {
    const placeholder = input.placeholder?.toLowerCase() || "";
    const name = input.name?.toLowerCase() || "";
    const labelLower = label.toLowerCase();

    return (
      placeholder.includes("mm/dd/yyyy") ||
      placeholder.includes("date") ||
      name.includes("date") ||
      labelLower.includes("date") ||
      input.type === "date"
    );
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

  scrapeJobDescription() {
    try {
      // Try multiple selectors for job description
      const descriptionSelectors = [
        '[data-test*="job-description"]',
        ".job-description",
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

  cleanQuestionText(text) {
    return text.replace(/\*$/, "").replace(/\s+/g, " ").trim();
  }

  isElementVisible(element) {
    if (!element) return false;

    const style = window.getComputedStyle(element);
    return (
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      element.offsetParent !== null
    );
  }

  isApplicationForm(form) {
    try {
      // Check if this is a search form (exclude these)
      const searchIndicators = [
        'input[name*="search"]',
        'input[placeholder*="search" i]',
        'input[placeholder*="role" i]',
        'button[data-test*="Search"]',
        ".search-form",
        '[class*="search"]',
      ];

      for (const indicator of searchIndicators) {
        if (form.querySelector(indicator)) {
          this.log("❌ Form appears to be a search form, skipping");
          return false;
        }
      }

      // Check for application form indicators
      const applicationIndicators = [
        "textarea",
        'button[type="submit"]',
        'input[type="file"]',
        'button[data-test*="Submit"]',
        'button[data-test*="Apply"]',
        'input[type="radio"]',
        "select",
        'input[type="checkbox"]',
      ];

      for (const indicator of applicationIndicators) {
        if (form.querySelector(indicator)) {
          this.log("✅ Form appears to be an application form");
          return true;
        }
      }

      // Check form fields count
      const formFields = form.querySelectorAll("input, textarea, select");
      const nonHiddenFields = Array.from(formFields).filter(
        (field) => field.type !== "hidden" && field.type !== "submit"
      );

      if (nonHiddenFields.length >= 1) {
        this.log("✅ Form has sufficient fields to be an application form");
        return true;
      }

      return false;
    } catch (error) {
      this.log("❌ Error checking if form is application form:", error.message);
      return false;
    }
  }

  async submitForm(form) {
    try {
      if (!form) {
        this.log("❌ No form to submit");
        return false;
      }

      const submitButton =
        form.querySelector('button[type="submit"]') ||
        form.querySelector('button[data-test*="Submit"]') ||
        form.querySelector('button[data-test*="Apply"]');

      if (!submitButton) {
        this.log("❌ No submit button found in form");
        return false;
      }

      if (submitButton.disabled) {
        this.log("⚠️ Submit button is disabled - checking for form errors");
        const errorCheck = await this.checkFormErrors(form);
        if (errorCheck.hasErrors) {
          this.log(`❌ Form has errors: ${errorCheck.errors.join(", ")}`);
          return false;
        }
      }

      this.log("📤 Submitting application form");
      await this.clickElementReliably(submitButton);
      await this.delay(3000);

      return true;
    } catch (error) {
      this.log("❌ Error submitting form:", error.message);
      return false;
    }
  }

  async checkFormErrors(form) {
    try {
      const errors = [];

      const errorSelectors = [
        ".error",
        ".field-error",
        ".shared_fieldError__t2UkY",
        '[class*="error"]',
        ".text-red-500",
        ".text-danger",
      ];

      for (const selector of errorSelectors) {
        const errorElements = form.querySelectorAll(selector);
        for (const errorEl of errorElements) {
          const errorText = errorEl.textContent?.trim();
          if (errorText && errorText.length > 0) {
            errors.push(errorText);
          }
        }
      }

      return {
        hasErrors: errors.length > 0,
        errors: errors,
      };
    } catch (error) {
      this.log("❌ Error checking form errors:", error.message);
      return { hasErrors: false, errors: [] };
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

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
