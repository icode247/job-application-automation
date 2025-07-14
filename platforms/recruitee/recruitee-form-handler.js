// platforms/recruitee/recruitee-form-handler.js
import { AIService } from "../../services/index.js";
import Utils from "../../utils/utils.js";

export class RecruiteeFormHandler {
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
   * Clean up label text - following Breezy pattern
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
   * Get the type of a form field - following Breezy pattern
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
   * Check if a field is required - following Breezy pattern
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

    // Recruitee-specific required indicator
    const label = this.getFieldLabelElement(element);
    if (label && label.querySelector(".sc-1glzqyg-1")) {
      return true;
    }

    return false;
  }

  /**
   * Fill form with profile data - following Breezy pattern
   */
  async fillFormWithProfile(form, profile) {
    try {
      this.logger("Filling Recruitee form with user profile data");
      this.userData = profile;

      const formFields = this.getAllFormFields(form);
      this.logger(`Found ${formFields.length} form fields to process`);

      let filledCount = 0;
      const processedFields = new Set();
      const failedFields = new Map();

      for (const field of formFields) {
        if (!field.label) continue;
        if (field.type === "file") continue;

        const fieldIdentifier = `${field.type}:${this.cleanLabelText(
          field.label
        )}`;

        if (processedFields.has(fieldIdentifier)) {
          this.logger(`Skipping already processed field: ${field.label}`);
          continue;
        }

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
              processedFields.add(fieldIdentifier);
              this.logger(`✅ Successfully filled field: ${field.label}`);
            } else {
              throw new Error("Failed to fill field with answer");
            }
          } else {
            throw new Error("No answer received from AI");
          }

          await this.wait(300);
        } catch (fieldError) {
          failedFields.set(fieldIdentifier, failureCount + 1);
          this.logger(
            `❌ Error processing field "${field.label}" (attempt ${
              failureCount + 1
            }): ${fieldError.message}`
          );
          continue;
        }
      }

      // Handle required checkboxes
      await this.handleRequiredCheckboxes(form);

      this.logger(`Successfully filled ${filledCount} fields`);
      return true;
    } catch (error) {
      this.logger(`Error filling form: ${error.message}`);
      return false;
    }
  }

  /**
   * Get AI answer for a form field - following Breezy pattern with caching
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
        options: options.sort(),
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

      const answer = await this.aiService.getAnswer(question, options, {
        platform: "recruitee",
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
        `Error getting AI answer: ${error.message}`
      );
      return null;
    }
  }

  /**
   * Fill a form field with the appropriate value - following Breezy pattern
   */
  async fillField(element, value) {
    try {
      if (!element || value === undefined || value === null) {
        return false;
      }

      const fieldType = this.getFieldType(element);
      this.logger(`Filling ${fieldType} field with value`);

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
      this.logger(`Error filling field: ${error.message}`);
      return false;
    }
  }

  /**
   * Get all form fields - following Breezy pattern
   */
  getAllFormFields(form) {
    try {
      this.logger("Finding all form fields in Recruitee application form");

      const fields = [];
      const processedFields = new Set();

      // Enhanced selectors for Recruitee-specific structures
      const formElements = form.querySelectorAll(
        'input:not([type="hidden"]), select, textarea, ' +
          '[role="radio"], [role="checkbox"], ' +
          'fieldset[role="radiogroup"], ' +
          'div.form-group, div[role="group"], div.custom-checkbox, ' +
          "div.sc-1omxthk-1, div.sc-qci8q2-1"
      );

      for (const element of formElements) {
        if (!this.isElementVisible(element)) continue;

        const fieldId = this.createFieldIdentifier(element);
        if (processedFields.has(fieldId)) {
          continue;
        }

        const fieldInfo = this.processFormElement(element);

        if (fieldInfo && fieldInfo.label) {
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

      return this.deduplicateRadioGroups(fields);
    } catch (error) {
      this.logger(`Error getting form fields: ${error.message}`);
      return [];
    }
  }

  /**
   * Process form element - following Breezy pattern
   */
  processFormElement(element) {
    const fieldType = this.getFieldType(element);
    const label = this.getFieldLabel(element);
    const required = this.isFieldRequired(element);

    if (!label && fieldType !== "checkbox" && fieldType !== "radio") {
      return null;
    }

    return {
      element,
      type: fieldType,
      label,
      required,
    };
  }

  /**
   * Create field identifier - following Breezy pattern
   */
  createFieldIdentifier(element) {
    const id = element.id || "";
    const name = element.name || "";
    const className = element.className || "";
    const tagName = element.tagName.toLowerCase();

    if (
      element.classList.contains("sc-1omxthk-1") ||
      element.classList.contains("sc-qci8q2-1")
    ) {
      const siblings = Array.from(element.parentNode.children);
      const index = siblings.indexOf(element);
      return `container:${tagName}:${className}:${index}`;
    }

    return `${tagName}:${id}:${name}:${className}`;
  }

  /**
   * Deduplicate radio groups - following Breezy pattern
   */
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
   * Get field label - following Breezy pattern
   */
  getFieldLabel(element, container = null) {
    try {
      const fieldContainer =
        container ||
        element.closest(".sc-1omxthk-1") ||
        element.closest(".sc-qci8q2-1") ||
        element.closest(".form-group");

      // Handle Recruitee-specific fieldset structure
      if (fieldContainer) {
        const legend = fieldContainer.querySelector("legend");
        if (legend) {
          return this.cleanLabelText(legend.textContent);
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
      this.logger(`Error getting field label: ${error.message}`);
      return "";
    }
  }

  /**
   * Get field options - following Breezy pattern
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
            if (text && value && value !== "? undefined:undefined ?") {
              options.push(text);
            }
          });
        }
      } else if (fieldType === "radio" || fieldType === "checkbox") {
        const container =
          element.closest(".sc-1omxthk-1") ||
          element.closest(".sc-qci8q2-1") ||
          element.closest("fieldset") ||
          element.closest(".custom-radio-group");

        if (container) {
          const inputs = container.querySelectorAll(
            `input[type="${fieldType}"]`
          );
          inputs.forEach((input) => {
            const label =
              input.closest("label") ||
              document.querySelector(`label[for="${input.id}"]`);
            if (label) {
              const span = label.querySelector("span:last-child");
              if (span) {
                options.push(span.textContent.trim());
              } else {
                options.push(label.textContent.trim());
              }
            }
          });
        }
      }

      return options;
    } catch (error) {
      this.logger(`Error getting field options: ${error.message}`);
      return [];
    }
  }

  /**
   * Fill input field - following Breezy pattern
   */
  async fillInputField(element, value) {
    try {
      this.scrollToElement(element);
      element.focus();
      await this.wait(100);

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
      this.logger(`Error filling input field: ${error.message}`);
      return false;
    }
  }

  /**
   * Fill textarea field - following Breezy pattern
   */
  async fillTextareaField(element, value) {
    return await this.fillInputField(element, value);
  }

  /**
   * Fill select field - following Breezy pattern
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

          if (this.matchesValue(valueStr, optionText, optionValue)) {
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
   * Fill phone field - following Breezy pattern
   */
  async fillPhoneField(element, value) {
    try {
      const phoneCode = this.userData.phoneCode || this.userData.phoneCountryCode || "+1";
      const phoneNumber = this.userData.phoneNumber || this.userData.phone || "";

      if (!phoneNumber) return false;

      // Process the code - remove any symbols
      let cleanCode = phoneCode.replace(/[+\-\s()]/g, "");
      
      // Process the number - remove any country code already in there
      let cleanNumber = phoneNumber;
      if (cleanNumber.startsWith("+")) {
        cleanNumber = cleanNumber.replace(/^\+\d+\s*/, "");
      }
      
      // Remove leading zeros
      cleanNumber = cleanNumber.replace(/^0+/, "");
      
      // Combine the two parts with a space
      const formattedPhone = `${cleanCode} ${cleanNumber}`;

      return await this.fillInputField(element, formattedPhone);
    } catch (error) {
      this.logger(`Error filling phone field: ${error.message}`);
      return false;
    }
  }

  /**
   * Fill radio field - following Breezy pattern
   */
  async fillRadioField(element, value) {
    try {
      const valueStr = String(value).toLowerCase().trim();
      this.logger(`Filling radio field with value: "${valueStr}"`);

      const container =
        element.closest(".sc-1omxthk-1") ||
        element.closest(".sc-qci8q2-1") ||
        element.closest("fieldset") ||
        element.closest(".custom-radio-group");

      if (container) {
        const radios = container.querySelectorAll('input[type="radio"]');
        for (const radio of radios) {
          const label =
            radio.closest("label") ||
            document.querySelector(`label[for="${radio.id}"]`);

          if (label) {
            const span = label.querySelector("span:last-child");
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
   * Fill checkbox field - following Breezy pattern
   */
  async fillCheckboxField(element, value) {
    try {
      const shouldCheck = this.shouldCheckValue(value);
      this.logger(`Filling checkbox field, should check: ${shouldCheck}`);

      let checkboxInput = element;
      if (element.tagName.toLowerCase() !== "input") {
        checkboxInput = element.querySelector('input[type="checkbox"]');
      }

      if (!checkboxInput) return false;

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
   * Fill date field - following Breezy pattern
   */
  async fillDateField(element, value) {
    try {
      if (
        element.tagName.toLowerCase() === "input" &&
        element.type === "date"
      ) {
        return await this.fillInputField(element, value);
      }

      // Handle custom date pickers
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
    } catch (error) {
      this.logger(`Error filling date field: ${error.message}`);
      return false;
    }
  }

  /**
   * Handle required checkboxes - following Breezy pattern
   */
  async handleRequiredCheckboxes(form) {
    try {
      this.logger("Handling required checkboxes");

      const checkboxFields = [];

      // Find all required checkboxes
      const requiredCheckboxes = form.querySelectorAll(
        'input[type="checkbox"][required], input[type="checkbox"][aria-required="true"], input[type="checkbox"].required'
      );

      for (const checkbox of requiredCheckboxes) {
        if (!this.isElementVisible(checkbox)) continue;

        const label = this.getFieldLabel(checkbox);
        const isAgreement = this.isAgreementCheckbox(label);

        checkboxFields.push({
          element: checkbox,
          label,
          isRequired: true,
          isAgreement,
        });
      }

      // Look for consent checkboxes even if not explicitly required
      const consentCheckboxes = Array.from(
        form.querySelectorAll('input[type="checkbox"]')
      ).filter((checkbox) => {
        const label = this.getFieldLabel(checkbox).toLowerCase();
        return (
          label.includes("privacy") ||
          label.includes("consent") ||
          label.includes("agree") ||
          label.includes("terms") ||
          label.includes("policy")
        );
      });

      for (const checkbox of consentCheckboxes) {
        if (!this.isElementVisible(checkbox)) continue;

        const label = this.getFieldLabel(checkbox);
        checkboxFields.push({
          element: checkbox,
          label,
          isRequired: false,
          isAgreement: true,
        });
      }

      this.logger(
        `Found ${checkboxFields.length} required/agreement checkboxes`
      );

      for (const field of checkboxFields) {
        let shouldCheck = field.isRequired || field.isAgreement;

        if (!shouldCheck) {
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
   * Find submit button - following Breezy pattern
   */
  findSubmitButton(form) {
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button[data-testid="submit-application-form-button"]',
      "button.cNFhOU",
      "button.btn-primary",
      "button.btn-submit",
      "button.c-button--primary",
      "button.submit-button",
      "button.submit",
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
   * Submit form - following Breezy pattern
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

  // Helper methods following Breezy pattern

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

  /**
   * Get field label element
   */
  getFieldLabelElement(element) {
    try {
      if (element.id) {
        const label = document.querySelector(`label[for="${element.id}"]`);
        if (label) {
          return label;
        }
      }

      let parent = element.parentElement;
      while (parent) {
        if (parent.tagName === "LABEL") {
          return parent;
        }

        const siblingLabel = parent.querySelector("label");
        if (siblingLabel) {
          return siblingLabel;
        }

        const recruiteeLabel = parent.querySelector(".sc-1glzqyg-0");
        if (recruiteeLabel) {
          return recruiteeLabel;
        }

        parent = parent.parentElement;
      }

      return null;
    } catch (error) {
      return null;
    }
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
}