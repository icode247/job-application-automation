// platforms/breezy/breezy-form-handler.js
import { AIService } from "../../services/index.js";
import Utils from "../../utils/utils.js";
//getAIAnswer
export class BreezyFormHandler {
  constructor(options = {}) {
    this.logger = options.logger || console.log;
    this.host = options.host || "http://localhost:3000";
    this.userData = options.userData || {};
    this.jobDescription = options.jobDescription || "";
    this.aiService = new AIService({ apiHost: this.host });
    this.answerCache = new Map();
    this.utils = new Utils();
  }

  /**
   * Clean up label text
   */
  cleanLabelText(text) {
    if (!text) return "";

    return text
      .replace(/[*✱]/g, "")
      .replace(/\s+/g, " ")
      .replace(/^\s+|\s+$/g, "")
      .replace(/\(required\)/i, "")
      .replace(/\(optional\)/i, "")
      .toLowerCase();
  }

  /**
   * Get the type of a form field
   */
  getFieldType(element) {
    const role = element.getAttribute("role");
    const tagName = element.tagName.toLowerCase();
    const className = element.className || "";

    // Radio groups
    if (
      role === "radiogroup" ||
      (tagName === "fieldset" && role === "radiogroup") ||
      element.closest(".custom-radio-group")
    ) {
      return "radio";
    }

    // Checkbox groups
    if (
      (role === "group" &&
        element.querySelector('[role="checkbox"], input[type="checkbox"]')) ||
      element.closest(".custom-checkbox-group")
    ) {
      return "checkbox";
    }

    // Individual radio or checkbox
    if (role === "radio" || role === "checkbox") {
      return role;
    }

    // Custom select
    if (role === "combobox" || element.classList.contains("custom-select")) {
      return "select";
    }

    // Upload fields
    if (
      className.includes("custom-file") ||
      element.querySelector('input[type="file"]') ||
      element.classList.contains("dropzone")
    ) {
      return "file";
    }

    // Standard HTML elements
    if (tagName === "select") return "select";
    if (tagName === "textarea") return "textarea";
    if (tagName === "input") {
      const type = element.type.toLowerCase();
      if (type === "file") return "file";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "tel") return "phone";
      return type || "text";
    }

    return "unknown";
  }

  /**
   * Check if a field is required
   */
  isFieldRequired(element) {
    if (element.required || element.getAttribute("aria-required") === "true") {
      return true;
    }

    if (
      element.classList.contains("is-required") ||
      element.closest(".form-group")?.classList.contains("required")
    ) {
      return true;
    }

    // Check for asterisk in label
    const labelledById = element.getAttribute("aria-labelledby");
    if (labelledById) {
      const labelElement = document.getElementById(labelledById);
      if (
        labelElement &&
        (labelElement.textContent.includes("*") ||
          labelElement.textContent.includes("✱"))
      ) {
        return true;
      }
    }

    // Check for explicit label with asterisk
    if (element.id) {
      const labelElement = document.querySelector(`label[for="${element.id}"]`);
      if (
        labelElement &&
        (labelElement.textContent.includes("*") ||
          labelElement.textContent.includes("✱"))
      ) {
        return true;
      }
    }

    return false;
  }

  async fillFormWithProfile(form, profile) {
    try {
      this.logger("Filling Breezy form with user profile data");
      this.userData = profile;

      const formFields = this.getAllFormFields(form);
      this.logger(`Found ${formFields.length} form fields to process`);

      let filledCount = 0;
      const processedFields = new Set(); // Track what we've already processed
      const failedFields = new Map(); // Track failures to avoid infinite retries

      for (const field of formFields) {
        if (!field.label) continue;
        if (field.type === "file") continue;

        // Skip education and work history fields - handled separately
        if (
          this.isEducationField(field.element) ||
          this.isWorkHistoryField(field.element)
        ) {
          continue;
        }

        // Create field identifier for tracking
        const fieldIdentifier = `${field.type}:${this.cleanLabelText(
          field.label
        )}`;

        // Skip if already processed successfully
        if (processedFields.has(fieldIdentifier)) {
          this.logger(`Skipping already processed field: ${field.label}`);
          continue;
        }

        // Skip if failed too many times
        const failureCount = failedFields.get(fieldIdentifier) || 0;
        if (failureCount >= 3) {
          this.logger(
            `Skipping field after ${failureCount} failures: ${field.label}`
          );
          continue;
        }

        try {
          this.logger(`Processing ${field.type} field: ${field.label}`);

          const options = this.getFieldOptions(field.element);
          const fieldContext = `This is a ${field.type} field${
            field.required ? " (required)" : ""
          }`;

          const answer = await this.getAIAnswer(
            field.label,
            options,
            field.type,
            fieldContext
          );

          if (answer) {
            this.logger(
              `Got AI answer for "${field.label}": ${answer.substring(0, 50)}${
                answer.length > 50 ? "..." : ""
              }`
            );

            const success = await this.fillField(field.element, answer);
            if (success) {
              filledCount++;
              processedFields.add(fieldIdentifier); // Mark as successfully processed
              this.logger(`✅ Successfully filled field: ${field.label}`);
            } else {
              throw new Error("Failed to fill field with answer");
            }
          } else {
            throw new Error("No answer received from AI");
          }

          await this.wait(300);
        } catch (fieldError) {
          // Track the failure
          failedFields.set(fieldIdentifier, failureCount + 1);
          this.logger(
            `❌ Error processing field "${field.label}" (attempt ${
              failureCount + 1
            }): ${fieldError.message}`
          );

          // Don't immediately retry, continue to next field
          continue;
        }
      }

      // Handle required checkboxes
      await this.handleRequiredCheckboxes(form);

      this.logger(`Successfully filled ${filledCount} fields`);
      this.logger(
        `Processed fields: ${Array.from(processedFields).join(", ")}`
      );

      if (failedFields.size > 0) {
        this.logger(
          `Failed fields: ${Array.from(failedFields.keys()).join(", ")}`
        );
      }

      return true;
    } catch (error) {
      this.logger(`Error filling form: ${error.message}`);
      return false;
    }
  }

  /**
   * Get AI answer for a form field
   */
  async getAIAnswer(
    question,
    options = [],
    fieldType = "text",
    fieldContext = ""
  ) {
    try {
      this.logger(`Requesting AI answer for "${question}"`);

      // Create a cache key that includes all relevant parameters
      const cacheKey = JSON.stringify({
        question: this.cleanLabelText(question),
        options: options.sort(), // Sort to ensure consistent ordering
        fieldType,
        fieldContext,
      });

      // Check cache first
      if (this.answerCache.has(cacheKey)) {
        this.logger(`Using cached answer for "${question}"`);
        return this.answerCache.get(cacheKey);
      }

      const userDataForContext = this.utils.getUserDetailsForContext(
        this.userData
      );

      // Special handling for salary fields
      if (
        question.toLowerCase().includes("salary") ||
        fieldContext.includes("salary")
      ) {
        const answer = await this.aiService.getAnswer(
          `${question} (provide only the numeric amount without currency symbols or commas)`,
          options,
          {
            platform: "breezy",
            userData: userDataForContext,
            jobDescription: this.jobDescription,
            fieldType,
            fieldContext: fieldContext + " - numeric only",
          }
        );

        const numericAnswer = this.extractNumericSalary(answer);

        // Cache the result
        this.answerCache.set(cacheKey, numericAnswer);
        return numericAnswer;
      }

      const answer = await this.aiService.getAnswer(question, options, {
        platform: "breezy",
        userData: userDataForContext,
        jobDescription: this.jobDescription,
        fieldType,
        fieldContext,
      });

      // Cache the result
      this.answerCache.set(cacheKey, answer);
      return answer;
    } catch (error) {
      this.logger(
        `I'm having trouble finding the right answer: ${error.message}`
      );
      return null;
    }
  }

  /**
   * Fill a form field with the appropriate value
   */
  async fillField(element, value) {
    try {
      if (!element || value === undefined || value === null) {
        return false;
      }

      const fieldType = this.getFieldType(element);
      this.logger(`Hang on while I fill in the ${fieldType} field`);

      switch (fieldType) {
        case "text":
        case "email":
        case "tel":
        case "url":
        case "number":
        case "password":
          return await this.fillInputField(element, value);

        case "textarea":
          return await this.fillTextareaField(element, value);

        case "select":
          return await this.fillSelectField(element, value);

        case "phone":
          return await this.fillPhoneField(element, value);

        case "checkbox":
          return await this.fillCheckboxField(element, value);

        case "radio":
          return await this.fillRadioField(element, value);

        case "date":
          return await this.fillDateField(element, value);

        case "file":
          return false; // File uploads handled separately

        default:
          return false;
      }
    } catch (error) {
      this.logger(
        `I'm having trouble finding the right answer: ${error.message}`
      );
      return false;
    }
  }

  /**
   * Fill a text input field
   */
  async fillInputField(element, value) {
    try {
      this.scrollToElement(element);
      element.focus();
      await this.wait(100);

      // Handle salary fields specifically
      if (this.isSalaryField(element)) {
        const numericValue = this.extractNumericSalary(value);
        if (numericValue) {
          element.value = "";
          element.dispatchEvent(new Event("input", { bubbles: true }));
          await this.wait(50);

          element.value = numericValue;
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
          element.dispatchEvent(new Event("blur", { bubbles: true }));

          await this.wait(100);
          return true;
        }
        return false;
      }

      // Standard field handling
      element.value = "";
      element.dispatchEvent(new Event("input", { bubbles: true }));
      await this.wait(50);

      element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new Event("blur", { bubbles: true }));

      await this.wait(100);
      return true;
    } catch (error) {
      this.logger(
        `I'm having trouble finding the right answer: ${error.message}`
      );
      return false;
    }
  }

  /**
   * Fill a textarea field
   */
  async fillTextareaField(element, value) {
    return await this.fillInputField(element, value);
  }

  /**
   * Check if element is a salary field
   */
  isSalaryField(element) {
    const name = (element.name || "").toLowerCase();
    const id = (element.id || "").toLowerCase();
    const placeholder = (element.placeholder || "").toLowerCase();
    const className = (element.className || "").toLowerCase();

    return (
      name.includes("salary") ||
      name === "csalary" ||
      id.includes("salary") ||
      placeholder.includes("salary") ||
      className.includes("salary") ||
      element.getAttribute("ng-change") === "stripNonNumeric()"
    );
  }

  /**
   * Extract numeric value from salary string
   */
  extractNumericSalary(salaryValue) {
    if (!salaryValue) return "";

    // Convert to string and extract only numbers
    const numericOnly = String(salaryValue).replace(/[^\d]/g, ""); // Remove all non-digit characters

    // Return empty string if no numbers found
    if (!numericOnly) return "";

    // Ensure it's a reasonable salary range (between 1000 and 999999999)
    const numValue = parseInt(numericOnly, 10);
    if (numValue < 1000 || numValue > 999999999) {
      // If unreasonable, try to extract a more reasonable number
      if (numericOnly.length > 6) {
        // Take first 6 digits for very long numbers
        return numericOnly.substring(0, 6);
      }
      return numericOnly;
    }

    return numericOnly;
  }

  /**
   * Fill a select field
   */
  async fillSelectField(element, value) {
    try {
      const valueStr = String(value).toLowerCase();

      if (element.tagName.toLowerCase() === "select") {
        this.scrollToElement(element);
        element.focus();
        await this.wait(200);

        let optionSelected = false;
        const options = Array.from(element.options);

        for (const option of options) {
          const optionText = option.textContent.trim().toLowerCase();
          const optionValue = option.value.toLowerCase();

          if (
            optionText === valueStr ||
            optionText.includes(valueStr) ||
            valueStr.includes(optionText) ||
            optionValue === valueStr
          ) {
            option.selected = true;
            optionSelected = true;
            break;
          }
        }

        if (!optionSelected && options.length > 0) {
          for (const option of options) {
            if (
              option.value &&
              option.value !== "null" &&
              option.value !== "undefined"
            ) {
              option.selected = true;
              optionSelected = true;
              break;
            }
          }
        }

        if (optionSelected) {
          element.dispatchEvent(new Event("change", { bubbles: true }));
          await this.wait(200);
          return true;
        }
      }

      return false;
    } catch (error) {
      this.logger(`Error filling select field: ${error.message}`);
      return false;
    }
  }

  /**
   * Fill a phone field
   */
  async fillPhoneField(element, value) {
    try {
      if (element.tagName.toLowerCase() === "input") {
        return await this.fillInputField(element, value);
      }

      const isIntlPhone =
        element.closest(".iti") ||
        document.querySelector(".iti__flag-container");

      if (isIntlPhone) {
        const phoneInput =
          element.tagName.toLowerCase() === "input"
            ? element
            : element.querySelector('input[type="tel"]');

        if (!phoneInput) return false;

        const countrySelector =
          element.querySelector(".iti__selected-flag") ||
          element.closest(".iti").querySelector(".iti__selected-flag");

        if (countrySelector) {
          this.scrollToElement(countrySelector);
          countrySelector.click();
          await this.wait(500);

          const countryList = document.querySelector(".iti__country-list");
          if (countryList) {
            const usOption = countryList.querySelector(
              '.iti__country[data-country-code="us"]'
            );
            if (usOption) {
              usOption.click();
              await this.wait(300);
            } else {
              countrySelector.click();
              await this.wait(300);
            }
          }
        }

        return await this.fillInputField(phoneInput, value);
      }

      return await this.fillInputField(element, value);
    } catch (error) {
      this.logger(`Error filling phone field: ${error.message}`);
      return false;
    }
  }

  /**
   * Fill a date field
   */
  async fillDateField(element, value) {
    try {
      if (
        element.tagName.toLowerCase() === "input" &&
        element.type === "date"
      ) {
        return await this.fillInputField(element, value);
      }

      if (
        element.classList.contains("datepicker-input") ||
        element.classList.contains("datepicker")
      ) {
        this.scrollToElement(element);
        element.focus();
        await this.wait(100);

        element.value = "";
        element.dispatchEvent(new Event("input", { bubbles: true }));
        await this.wait(50);

        try {
          const dateObj = new Date(value);
          if (!isNaN(dateObj.getTime())) {
            const month = (dateObj.getMonth() + 1).toString().padStart(2, "0");
            const day = dateObj.getDate().toString().padStart(2, "0");
            const year = dateObj.getFullYear();

            const formattedDate = `${month}/${day}/${year}`;
            element.value = formattedDate;
          } else {
            element.value = value;
          }
        } catch (e) {
          element.value = value;
        }

        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.dispatchEvent(new Event("blur", { bubbles: true }));

        return true;
      }

      return await this.fillInputField(element, value);
    } catch (error) {
      this.logger(`Error filling date field: ${error.message}`);
      return false;
    }
  }

  /**
   * Check if a label indicates an agreement checkbox
   */
  isAgreementCheckbox(label) {
    if (!label) return false;

    const agreementTerms = [
      "agree",
      "accept",
      "consent",
      "terms",
      "privacy",
      "policy",
      "gdpr",
      "confirm",
      "acknowledge",
      "permission",
      "receive",
      "subscribe",
      "newsletter",
      "marketing",
      "communications",
    ];

    return agreementTerms.some((term) => label.includes(term));
  }

  /**
   * Check if a field is part of the education section
   */
  isEducationField(element) {
    const isInEducationItem = !!element.closest("li.experience");
    if (!isInEducationItem) return false;

    let currentNode = element;
    let educationHeading = null;

    while (currentNode && !educationHeading) {
      currentNode = currentNode.parentElement;

      if (currentNode && currentNode.classList.contains("section")) {
        const h3Elements = currentNode.querySelectorAll("h3");
        for (const h3 of h3Elements) {
          if (h3.textContent.includes("Education")) {
            educationHeading = h3;
            break;
          }
        }
      }
    }

    return !!educationHeading;
  }

  /**
   * Check if a field is part of the work history section
   */
  isWorkHistoryField(element) {
    const isInWorkHistoryItem = !!element.closest("li.experience");
    if (!isInWorkHistoryItem) return false;

    let currentNode = element;
    let workHistoryHeading = null;

    while (currentNode && !workHistoryHeading) {
      currentNode = currentNode.parentElement;

      if (currentNode && currentNode.classList.contains("section")) {
        const h3Elements = currentNode.querySelectorAll("h3");
        for (const h3 of h3Elements) {
          if (h3.textContent.includes("Work History")) {
            workHistoryHeading = h3;
            break;
          }
        }
      }
    }

    return !!workHistoryHeading;
  }

  /**
   * Find and submit the form
   */
  async submitForm(form) {
    try {
      this.logger("Attempting to submit form");

      const submitButton = this.findSubmitButton(form);
      if (!submitButton) {
        this.logger("No submit button found");
        return false;
      }

      this.logger(
        `Found submit button: ${
          submitButton.textContent || submitButton.value || "Unnamed button"
        }`
      );

      if (!this.isElementVisible(submitButton) || submitButton.disabled) {
        this.logger("Submit button is not clickable");
        return false;
      }

      this.scrollToElement(submitButton);
      await this.wait(500);

      submitButton.click();
      this.logger("Clicked submit button");

      await this.wait(3000);
      return true;
    } catch (error) {
      this.logger(`Error submitting form: ${error.message}`);
      return false;
    }
  }

  /**
   * Find submit button
   */
  findSubmitButton(form) {
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      "button.submit-button",
      "button.submit",
      "button.apply-button",
      "button.apply",
      "button.btn-primary",
      "button.btn-success",
      ".btn.btn-primary",
      ".btn.btn-success",
      'button[data-ui="submit-application"]',
      ".application-submit",
    ];

    for (const selector of submitSelectors) {
      const buttons = form.querySelectorAll(selector);
      if (buttons.length) {
        for (const btn of buttons) {
          if (this.isElementVisible(btn) && !btn.disabled) {
            return btn;
          }
        }
      }
    }

    // Look for buttons with submit-like text
    const allButtons = form.querySelectorAll('button, input[type="button"]');
    for (const btn of allButtons) {
      if (!this.isElementVisible(btn) || btn.disabled) continue;

      const text = btn.textContent.toLowerCase();
      if (
        text.includes("submit") ||
        text.includes("apply") ||
        text.includes("send") ||
        text.includes("continue") ||
        text === "next"
      ) {
        return btn;
      }
    }

    return null;
  }

  /**
   * Utility methods
   */
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
      element.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    } catch (error) {
      try {
        element.scrollIntoView();
      } catch (e) {
        // Silent fail
      }
    }
  }

  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Enhanced getAllFormFields to better detect Breezy field structures
   */
  getAllFormFields(form) {
    try {
      this.logger(
        "Let me find all the form fields in this Breezy application form"
      );

      const fields = [];
      const processedFields = new Set(); // Track processed fields

      // Enhanced selectors to include Breezy-specific structures
      const formElements = form.querySelectorAll(
        'input:not([type="hidden"]), select, textarea, ' +
          '[role="radio"], [role="checkbox"], ' +
          'fieldset[role="radiogroup"], ' +
          'div.form-group, div[role="group"], div.custom-checkbox, ' +
          "div.multiplechoice, div.dropdown, div.gdpr-accept, " +
          "ul.options"
      );

      for (const element of formElements) {
        if (!this.isElementVisible(element)) continue;

        // Create a unique identifier for this field
        const fieldId = this.createFieldIdentifier(element);
        if (processedFields.has(fieldId)) {
          this.logger(`Skipping duplicate field: ${fieldId}`);
          continue;
        }

        // Process field based on type...
        const fieldInfo = this.processFormElement(element);

        if (fieldInfo && fieldInfo.label) {
          // Additional deduplication check based on label
          const labelKey = `${fieldInfo.type}:${this.cleanLabelText(
            fieldInfo.label
          )}`;
          if (!processedFields.has(labelKey)) {
            fields.push(fieldInfo);
            processedFields.add(fieldId);
            processedFields.add(labelKey);
          }
        }
      }

      // Final deduplication pass for radio groups
      return this.deduplicateRadioGroups(fields);
    } catch (error) {
      this.logger(`Error getting form fields: ${error.message}`);
      return [];
    }
  }

  createFieldIdentifier(element) {
    // Create unique identifier based on element properties
    const id = element.id || "";
    const name = element.name || "";
    const className = element.className || "";
    const tagName = element.tagName.toLowerCase();

    // For containers, use their position in the DOM
    if (
      element.classList.contains("multiplechoice") ||
      element.classList.contains("dropdown") ||
      element.classList.contains("gdpr-accept")
    ) {
      const siblings = Array.from(element.parentNode.children);
      const index = siblings.indexOf(element);
      return `container:${tagName}:${className}:${index}`;
    }

    return `${tagName}:${id}:${name}:${className}`;
  }

  deduplicateRadioGroups(fields) {
    const uniqueFields = [];
    const radioGroupsSeen = new Map();

    for (const field of fields) {
      if (field.type === "radio") {
        const groupKey = this.cleanLabelText(field.label);
        if (!radioGroupsSeen.has(groupKey)) {
          radioGroupsSeen.set(groupKey, true);
          uniqueFields.push(field);
        }
      } else {
        uniqueFields.push(field);
      }
    }

    return uniqueFields;
  }

  /**
   * Enhanced getFieldLabel to handle all Breezy structures
   */
  getFieldLabel(element, container = null) {
    try {
      // Use provided container or find the appropriate container
      const fieldContainer =
        container ||
        element.closest(".multiplechoice") ||
        element.closest(".dropdown") ||
        element.closest(".gdpr-accept") ||
        element.closest(".form-group");

      // Handle Breezy multiplechoice (radio/checkbox groups)
      if (
        fieldContainer &&
        fieldContainer.classList.contains("multiplechoice")
      ) {
        const h3Element = fieldContainer.querySelector(
          "h3 span.ng-binding, h3.ng-binding"
        );
        if (h3Element) {
          return this.cleanLabelText(h3Element.textContent);
        }

        const h3 = fieldContainer.querySelector("h3");
        if (h3) {
          return this.cleanLabelText(h3.textContent);
        }
      }

      // Handle Breezy dropdown structure
      if (fieldContainer && fieldContainer.classList.contains("dropdown")) {
        const h3Element = fieldContainer.querySelector("h3 span.ng-binding");
        if (h3Element) {
          return this.cleanLabelText(h3Element.textContent);
        }

        const h3 = fieldContainer.querySelector("h3");
        if (h3) {
          return this.cleanLabelText(h3.textContent);
        }
      }

      // Handle GDPR consent checkbox
      if (fieldContainer && fieldContainer.classList.contains("gdpr-accept")) {
        const h3Element = fieldContainer.querySelector("h3 span");
        if (h3Element) {
          return this.cleanLabelText(h3Element.textContent);
        }

        // Also look at the label text for additional context
        const label = fieldContainer.querySelector("label");
        if (label) {
          const labelText = label.textContent.trim();
          if (labelText.length > 10) {
            // If substantial text
            return this.cleanLabelText("Privacy Notice Consent");
          }
        }
      }

      // Original Breezy specific label finding
      const breezyLabel = element
        .closest(".form-group")
        ?.querySelector("label");
      if (breezyLabel) {
        return this.cleanLabelText(breezyLabel.textContent);
      }

      // Handle file upload fields specifically
      if (
        element.type === "file" ||
        element.classList.contains("custom-file-input") ||
        element.closest(".custom-file")
      ) {
        const customFileLabel = element
          .closest(".custom-file")
          ?.querySelector(".custom-file-label");
        if (customFileLabel) {
          return this.cleanLabelText(customFileLabel.textContent);
        }

        const formGroup = element.closest(".form-group");
        if (formGroup) {
          const label = formGroup.querySelector("label");
          if (label) {
            return this.cleanLabelText(label.textContent);
          }
        }
      }

      // Standard HTML label association
      if (element.id) {
        const labelElement = document.querySelector(
          `label[for="${element.id}"]`
        );
        if (labelElement) {
          return this.cleanLabelText(labelElement.textContent);
        }
      }

      // Parent label
      const parentLabel = element.closest("label");
      if (parentLabel) {
        const clone = parentLabel.cloneNode(true);
        const inputElements = clone.querySelectorAll("input, select, textarea");
        for (const inputEl of inputElements) {
          if (inputEl.parentNode) {
            inputEl.parentNode.removeChild(inputEl);
          }
        }
        return this.cleanLabelText(clone.textContent);
      }

      // Aria-label, placeholder, or name as fallback
      if (element.getAttribute("aria-label")) {
        return this.cleanLabelText(element.getAttribute("aria-label"));
      }

      if (element.placeholder) {
        return this.cleanLabelText(element.placeholder);
      }

      if (element.name) {
        return this.cleanLabelText(
          element.name.replace(/([A-Z])/g, " $1").replace(/_/g, " ")
        );
      }

      return "";
    } catch (error) {
      this.logger(`I'm having trouble getting the field label`);
      return "";
    }
  }

  /**
   * Enhanced getFieldOptions for Breezy structures
   */
  getFieldOptions(element) {
    try {
      const options = [];
      const fieldType = this.getFieldType(element);

      if (fieldType === "select") {
        if (element.tagName.toLowerCase() === "select") {
          Array.from(element.options).forEach((option) => {
            const text = option.textContent.trim();
            const value = option.value.trim();
            // Skip empty, undefined, or placeholder options
            if (text && value && value !== "? undefined:undefined ?") {
              options.push(text);
            }
          });
        }
      } else if (fieldType === "radio" || fieldType === "checkbox") {
        // Find the container for this radio/checkbox group
        const container =
          element.closest(".multiplechoice") ||
          element.closest(".gdpr-accept") ||
          element.closest("fieldset") ||
          element.closest(".custom-radio-group");

        if (container) {
          // Look for Breezy-style options in ul.options
          const optionsList = container.querySelector("ul.options");
          if (optionsList) {
            const optionItems = optionsList.querySelectorAll("li.option");
            optionItems.forEach((li) => {
              const span = li.querySelector("span.ng-binding");
              if (span) {
                options.push(span.textContent.trim());
              } else {
                // Fallback to any text in the li
                const text = li.textContent.trim();
                if (text) {
                  options.push(text);
                }
              }
            });
          } else {
            // Standard radio/checkbox handling
            const inputs = container.querySelectorAll(
              `input[type="${fieldType}"]`
            );
            inputs.forEach((input) => {
              const label =
                input.closest("label") ||
                document.querySelector(`label[for="${input.id}"]`);
              if (label) {
                const span = label.querySelector("span.ng-binding");
                if (span) {
                  options.push(span.textContent.trim());
                } else {
                  options.push(label.textContent.trim());
                }
              }
            });
          }
        }
      }

      return options;
    } catch (error) {
      this.logger(`Error getting field options: ${error.message}`);
      return [];
    }
  }

  /**
   * Enhanced fillRadioField to handle Breezy structures
   */
  async fillRadioField(element, value) {
    try {
      const valueStr = String(value).toLowerCase().trim();
      this.logger(`Filling radio field with value: "${valueStr}"`);

      // Find the container for this radio group
      const container =
        element.closest(".multiplechoice") ||
        element.closest("fieldset") ||
        element.closest(".custom-radio-group");

      if (container) {
        // Handle Breezy multiplechoice structure
        if (container.classList.contains("multiplechoice")) {
          const optionsList = container.querySelector("ul.options");
          if (optionsList) {
            const optionItems = optionsList.querySelectorAll("li.option");

            for (const li of optionItems) {
              const radioInput = li.querySelector('input[type="radio"]');
              const span = li.querySelector("span.ng-binding");

              if (radioInput && span) {
                const optionText = span.textContent.trim().toLowerCase();
                const optionValue = radioInput.value.toLowerCase();

                // Enhanced matching logic
                if (this.matchesValue(valueStr, optionText, optionValue)) {
                  this.scrollToElement(li);

                  // Click the label if it exists, otherwise click the input
                  const label = li.querySelector("label");
                  if (label) {
                    label.click();
                  } else {
                    radioInput.click();
                  }

                  await this.wait(300);
                  return true;
                }
              }
            }
          }
        }

        // Fallback to standard radio handling
        const radios = container.querySelectorAll('input[type="radio"]');
        for (const radio of radios) {
          const label =
            radio.closest("label") ||
            document.querySelector(`label[for="${radio.id}"]`);

          if (label) {
            const span = label.querySelector("span.ng-binding");
            const labelText = span
              ? span.textContent.trim().toLowerCase()
              : label.textContent.trim().toLowerCase();
            const radioValue = radio.value.toLowerCase();

            if (this.matchesValue(valueStr, labelText, radioValue)) {
              this.scrollToElement(label);
              label.click();
              await this.wait(300);
              return true;
            }
          }
        }
      }

      return false;
    } catch (error) {
      this.logger(`Error filling radio field: ${error.message}`);
      return false;
    }
  }

  /**
   * Enhanced fillCheckboxField to handle Breezy structures
   */
  async fillCheckboxField(element, value) {
    try {
      const shouldCheck = this.shouldCheckValue(value);
      this.logger(`Filling checkbox field, should check: ${shouldCheck}`);

      // Handle GDPR consent checkbox
      const gdprContainer = element.closest(".gdpr-accept");
      if (gdprContainer) {
        const label = gdprContainer.querySelector("label");
        if (label && label.contains(element)) {
          this.scrollToElement(label);
          label.click();
          await this.wait(200);
          return true;
        }
      }

      // Handle Breezy multiplechoice checkbox structure
      const multiplechoiceContainer = element.closest(".multiplechoice");
      if (multiplechoiceContainer) {
        const optionsList = multiplechoiceContainer.querySelector("ul.options");
        if (optionsList) {
          const optionItem = element.closest("li.option");
          if (optionItem) {
            this.scrollToElement(optionItem);

            // Check current state
            const isCurrentlyChecked = element.checked;

            if (
              (shouldCheck && !isCurrentlyChecked) ||
              (!shouldCheck && isCurrentlyChecked)
            ) {
              // Try clicking the span or the checkbox itself
              const span = optionItem.querySelector("span.ng-binding");
              if (span) {
                span.click();
              } else {
                element.click();
              }

              await this.wait(200);

              // Verify the state changed
              if (element.checked !== shouldCheck) {
                element.checked = shouldCheck;
                element.dispatchEvent(new Event("change", { bubbles: true }));
              }
            }

            return true;
          }
        }
      }

      // Standard checkbox handling (existing code)
      let checkboxInput = element;
      if (element.tagName.toLowerCase() !== "input") {
        checkboxInput = element.querySelector('input[type="checkbox"]');
        // ... rest of existing checkbox handling
      }

      if (
        (shouldCheck && !checkboxInput.checked) ||
        (!shouldCheck && checkboxInput.checked)
      ) {
        this.scrollToElement(checkboxInput);

        const labelEl =
          checkboxInput.closest("label") ||
          document.querySelector(`label[for="${checkboxInput.id}"]`);

        if (labelEl) {
          labelEl.click();
        } else {
          checkboxInput.click();
        }

        await this.wait(200);

        if (checkboxInput.checked !== shouldCheck) {
          checkboxInput.checked = shouldCheck;
          checkboxInput.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }

      return true;
    } catch (error) {
      this.logger(`Error filling checkbox field: ${error.message}`);
      return false;
    }
  }

  /**
   * Enhanced handleRequiredCheckboxes to specifically handle GDPR
   */
  async handleRequiredCheckboxes(form) {
    try {
      this.logger("Handling required checkboxes");

      const checkboxFields = [];

      // Specifically look for GDPR consent checkboxes
      const gdprContainers = form.querySelectorAll(".gdpr-accept");
      for (const container of gdprContainers) {
        const checkbox = container.querySelector('input[type="checkbox"]');
        if (checkbox && this.isElementVisible(checkbox)) {
          checkboxFields.push({
            element: checkbox,
            label: "Privacy Notice Consent",
            isRequired: true,
            isAgreement: true,
            isGDPR: true,
          });
        }
      }

      // Standard checkboxes
      const standardCheckboxes = form.querySelectorAll(
        'input[type="checkbox"]'
      );
      for (const checkbox of standardCheckboxes) {
        if (!this.isElementVisible(checkbox)) continue;

        // Skip if already handled as GDPR
        if (checkbox.closest(".gdpr-accept")) continue;

        const label = this.getFieldLabel(checkbox);
        const isRequired = this.isFieldRequired(checkbox);
        const isAgreement = this.isAgreementCheckbox(label);

        if (isRequired || isAgreement) {
          checkboxFields.push({
            element: checkbox,
            label,
            isRequired,
            isAgreement,
            isGDPR: false,
          });
        }
      }

      // Breezy custom checkboxes
      const customCheckboxes = form.querySelectorAll(
        '.custom-checkbox, [role="checkbox"]'
      );
      for (const checkbox of customCheckboxes) {
        if (!this.isElementVisible(checkbox)) continue;

        const label = this.getFieldLabel(checkbox);
        const isRequired =
          this.isFieldRequired(checkbox) ||
          checkbox.closest(".form-group.required");
        const isAgreement = this.isAgreementCheckbox(label);

        if (isRequired || isAgreement) {
          checkboxFields.push({
            element: checkbox,
            label,
            isRequired,
            isAgreement,
            isGDPR: false,
          });
        }
      }

      this.logger(
        `Found ${checkboxFields.length} required/agreement checkboxes`
      );

      for (const field of checkboxFields) {
        let shouldCheck = field.isRequired || field.isAgreement || field.isGDPR;

        // For GDPR, always check
        if (field.isGDPR) {
          shouldCheck = true;
        } else if (!shouldCheck) {
          const answer = await this.getAIAnswer(
            field.label,
            ["yes", "no"],
            "checkbox",
            "This is a checkbox that may require consent or agreement."
          );

          shouldCheck = answer === "yes" || answer === "true";
        }

        this.logger(
          `${shouldCheck ? "Checking" : "Unchecking"} checkbox: ${field.label}`
        );
        await this.fillCheckboxField(field.element, shouldCheck);
        await this.wait(200);
      }
    } catch (error) {
      this.logger(`Error handling required checkboxes: ${error.message}`);
    }
  }

  /**
   * Helper method to determine if a value should result in checking a checkbox
   */
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

  /**
   * Enhanced value matching for radio buttons and select options
   */
  matchesValue(aiValue, optionText, optionValue) {
    // Direct matches
    if (aiValue === optionText || aiValue === optionValue) return true;

    // Partial matches
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
}
