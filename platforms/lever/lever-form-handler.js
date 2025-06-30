// platforms/lever/lever-form-handler.js
import { AIService } from "../../services/index.js";

export default class LeverFormHandler {
  constructor(options = {}) {
    this.logger = options.logger || console.log;
    this.host = options.host || "http://localhost:3000";
    this.userData = options.userData || {};
    this.jobDescription = options.jobDescription || "";
    this.aiService = new AIService({ apiHost: this.host });
    this.answerCache = new Map();
  }

  /**
   * Get all form fields from a Lever application form
   */
  getAllFormFields(form) {
    try {
      this.logger("Finding all form fields in Lever form");

      const fields = [];

      // Lever-specific selectors
      const formElements = form.querySelectorAll(`
        input:not([type="hidden"]), 
        select, 
        textarea,
        .lever-form-field input,
        .lever-form-field select,
        .lever-form-field textarea,
        [data-qa*="field"] input,
        [data-qa*="field"] select,
        [data-qa*="field"] textarea
      `);

      this.logger(`Found ${formElements.length} form elements`);

      for (const element of formElements) {
        if (!this.isElementVisible(element)) continue;

        const fieldInfo = {
          element,
          label: this.getFieldLabel(element),
          type: this.getFieldType(element),
          required: this.isFieldRequired(element),
          name: element.name || element.id || "",
        };

        if (fieldInfo.label) {
          fields.push(fieldInfo);
        }
      }

      this.logger(`Processed ${fields.length} valid form fields`);
      return fields;
    } catch (error) {
      this.logger(`Error getting form fields: ${error.message}`);
      return [];
    }
  }

  /**
   * Get label text for a form field (Lever-specific)
   */
  getFieldLabel(element) {
    try {
      // Method 1: Check for Lever's label structure
      const leverLabel = element
        .closest(".lever-form-field")
        ?.querySelector("label");
      if (leverLabel) {
        return this.cleanLabelText(leverLabel.textContent);
      }

      // Method 2: Check for data-qa attributes
      const dataQaContainer = element.closest('[data-qa*="field"]');
      if (dataQaContainer) {
        const label = dataQaContainer.querySelector(
          "label, .form-label, .field-label"
        );
        if (label) {
          return this.cleanLabelText(label.textContent);
        }
      }

      // Method 3: Standard HTML label association
      if (element.id) {
        const label = document.querySelector(`label[for="${element.id}"]`);
        if (label) {
          return this.cleanLabelText(label.textContent);
        }
      }

      // Method 4: Parent label
      const parentLabel = element.closest("label");
      if (parentLabel) {
        const clone = parentLabel.cloneNode(true);
        // Remove input elements from clone to get just label text
        clone
          .querySelectorAll("input, select, textarea")
          .forEach((el) => el.remove());
        return this.cleanLabelText(clone.textContent);
      }

      // Method 5: Preceding label or text
      const container =
        element.closest(".form-group, .field-group, .lever-form-field") ||
        element.parentElement;
      if (container) {
        const label = container.querySelector("label, .label, .field-label");
        if (label && !label.contains(element)) {
          return this.cleanLabelText(label.textContent);
        }
      }

      // Method 6: Aria-label
      if (element.getAttribute("aria-label")) {
        return this.cleanLabelText(element.getAttribute("aria-label"));
      }

      // Method 7: Placeholder as fallback
      if (element.placeholder) {
        return this.cleanLabelText(element.placeholder);
      }

      // Method 8: Name attribute
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
   * Clean up label text
   */
  cleanLabelText(text) {
    if (!text) return "";

    return text
      .replace(/[*✱]/g, "") // Remove asterisks
      .replace(/\s+/g, " ") // Normalize whitespace
      .replace(/^\s+|\s+$/g, "") // Trim
      .replace(/\(required\)/i, "") // Remove "(required)"
      .replace(/\(optional\)/i, "") // Remove "(optional)"
      .toLowerCase();
  }

  /**
   * Get the type of a form field
   */
  getFieldType(element) {
    const tagName = element.tagName.toLowerCase();

    if (tagName === "select") return "select";
    if (tagName === "textarea") return "textarea";

    if (tagName === "input") {
      const type = element.type.toLowerCase();
      if (type === "file") return "file";
      if (type === "checkbox") return "checkbox";
      if (type === "radio") return "radio";
      if (type === "tel" || type === "phone") return "phone";
      if (type === "email") return "email";
      if (type === "url") return "url";
      if (type === "number") return "number";
      if (type === "date") return "date";
      return type || "text";
    }

    return "unknown";
  }

  /**
   * Check if a field is required
   */
  isFieldRequired(element) {
    // Check required attribute
    if (element.required || element.getAttribute("aria-required") === "true") {
      return true;
    }

    // Check for required indicators in label
    const label = this.getFieldLabel(element);
    if (label && (label.includes("*") || label.includes("required"))) {
      return true;
    }

    // Check for Lever-specific required indicators
    const container = element.closest(
      ".lever-form-field, .form-group, .field-group"
    );
    if (container) {
      const requiredIndicator = container.querySelector(
        '.required, .mandatory, [class*="required"]'
      );
      if (requiredIndicator) {
        return true;
      }
    }

    return false;
  }

  /**
   * Fill form with user profile data using AI
   */
  async fillFormWithProfile(form, profile) {
    try {
      this.logger("Filling Lever form with user profile data");
      this.userData = profile;

      const formFields = this.getAllFormFields(form);
      this.logger(`Found ${formFields.length} form fields to process`);

      let filledCount = 0;
      let skippedCount = 0;

      for (const field of formFields) {
        if (!field.label) {
          this.logger(`Skipping field without label: ${field.name}`);
          continue;
        }

        if (field.type === "file") {
          this.logger(`Skipping file field: ${field.label}`);
          continue;
        }

        try {
          this.logger(`Processing field: ${field.label} (${field.type})`);

          // Get field options for select/radio fields
          const options = this.getFieldOptions(field.element);

          // Get AI answer
          const answer = await this.getAIAnswer(
            field.label,
            options,
            field.type,
            this.buildFieldContext(field)
          );

          if (answer !== null && answer !== undefined && answer !== "") {
            const success = await this.fillField(
              field.element,
              answer,
              field.type
            );
            if (success) {
              filledCount++;
              this.logger(`✓ Successfully filled: ${field.label}`);
            } else {
              skippedCount++;
              this.logger(`✗ Failed to fill: ${field.label}`);
            }
          } else {
            skippedCount++;
            this.logger(`✗ No AI answer for: ${field.label}`);
          }

          // Small delay between fields
          await this.wait(200);
        } catch (fieldError) {
          this.logger(
            `Error processing field "${field.label}": ${fieldError.message}`
          );
          skippedCount++;
        }
      }

      this.logger(
        `Form filling complete: ${filledCount} filled, ${skippedCount} skipped`
      );

      // Handle checkboxes and agreements
      await this.handleRequiredCheckboxes(form);

      return filledCount > 0;
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
      const cacheKey = `${question}_${options.join("_")}_${fieldType}`;

      // Check cache first
      if (this.answerCache.has(cacheKey)) {
        return this.answerCache.get(cacheKey);
      }

      this.logger(`Requesting AI answer for: "${question}"`);

      const answer = await this.aiService.getAnswer(question, options, {
        platform: "lever",
        userData: this.userData,
        jobDescription: this.jobDescription,
        fieldType,
        fieldContext,
      });

      // Cache the answer
      this.answerCache.set(cacheKey, answer);

      return answer;
    } catch (error) {
      this.logger(`Error getting AI answer: ${error.message}`);
      return null;
    }
  }

  /**
   * Build context for AI field processing
   */
  buildFieldContext(field) {
    return [
      `Field type: ${field.type}`,
      field.required ? "This field is required" : "This field is optional",
      field.name ? `Field name: ${field.name}` : "",
      "Please provide your response based on the user profile data.",
    ]
      .filter(Boolean)
      .join(". ");
  }

  /**
   * Get options for select/radio fields
   */
  getFieldOptions(element) {
    const options = [];

    if (element.tagName.toLowerCase() === "select") {
      const optionElements = element.querySelectorAll("option");
      optionElements.forEach((option) => {
        const text = option.textContent.trim();
        if (text && !text.toLowerCase().includes("select") && text !== "---") {
          options.push(text);
        }
      });
    } else if (element.type === "radio") {
      const name = element.name;
      if (name) {
        const radioButtons = document.querySelectorAll(
          `input[type="radio"][name="${name}"]`
        );
        radioButtons.forEach((radio) => {
          const label = this.getFieldLabel(radio);
          if (label) {
            options.push(label);
          }
        });
      }
    }

    return options;
  }

  /**
   * Fill a form field with the appropriate value
   */
  async fillField(element, value, fieldType) {
    try {
      if (!element || value === undefined || value === null) {
        return false;
      }

      this.logger(
        `Filling ${fieldType} field with: ${String(value).substring(0, 50)}`
      );

      switch (fieldType) {
        case "text":
        case "email":
        case "tel":
        case "phone":
        case "url":
        case "number":
          return await this.fillInputField(element, value);

        case "textarea":
          return await this.fillTextareaField(element, value);

        case "select":
          return await this.fillSelectField(element, value);

        case "checkbox":
          return await this.fillCheckboxField(element, value);

        case "radio":
          return await this.fillRadioField(element, value);

        case "date":
          return await this.fillDateField(element, value);

        default:
          this.logger(`Unsupported field type: ${fieldType}`);
          return false;
      }
    } catch (error) {
      this.logger(`Error filling field: ${error.message}`);
      return false;
    }
  }

  /**
   * Fill input field
   */
  async fillInputField(element, value) {
    try {
      this.scrollToElement(element);
      element.focus();
      await this.wait(100);

      // Clear existing value
      element.value = "";
      element.dispatchEvent(new Event("input", { bubbles: true }));
      await this.wait(50);

      // Set new value
      element.value = String(value);

      // Trigger events
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
   * Fill textarea field
   */
  async fillTextareaField(element, value) {
    return await this.fillInputField(element, value);
  }

  /**
   * Fill select field
   */
  async fillSelectField(element, value) {
    try {
      const options = Array.from(element.options);
      const valueStr = String(value).toLowerCase();

      // Find matching option
      let targetOption = null;

      // Exact match first
      for (const option of options) {
        if (option.textContent.toLowerCase().trim() === valueStr) {
          targetOption = option;
          break;
        }
      }

      // Partial match if no exact match
      if (!targetOption) {
        for (const option of options) {
          const optionText = option.textContent.toLowerCase().trim();
          if (optionText.includes(valueStr) || valueStr.includes(optionText)) {
            targetOption = option;
            break;
          }
        }
      }

      if (targetOption) {
        this.scrollToElement(element);
        element.focus();
        element.value = targetOption.value;
        element.dispatchEvent(new Event("change", { bubbles: true }));
        await this.wait(100);
        return true;
      }

      this.logger(`No matching option found for: ${value}`);
      return false;
    } catch (error) {
      this.logger(`Error filling select field: ${error.message}`);
      return false;
    }
  }

  /**
   * Fill checkbox field
   */
  async fillCheckboxField(element, value) {
    try {
      const shouldCheck = this.parseAIBoolean(value);
      if (shouldCheck === null) {
        this.logger(`Unclear AI response for checkbox: ${value}`);
        return false;
      }

      const isCurrentlyChecked = element.checked;

      if (shouldCheck !== isCurrentlyChecked) {
        this.scrollToElement(element);
        element.click();
        await this.wait(200);
      }

      return true;
    } catch (error) {
      this.logger(`Error filling checkbox field: ${error.message}`);
      return false;
    }
  }

  /**
   * Fill radio field
   */
  async fillRadioField(element, value) {
    try {
      const name = element.name;
      if (!name) return false;

      const radioButtons = document.querySelectorAll(
        `input[type="radio"][name="${name}"]`
      );
      const valueStr = String(value).toLowerCase();

      // Find matching radio button
      for (const radio of radioButtons) {
        const label = this.getFieldLabel(radio);
        if (label && label.toLowerCase().includes(valueStr)) {
          this.scrollToElement(radio);
          radio.click();
          await this.wait(200);
          return true;
        }
      }

      this.logger(`No matching radio option found for: ${value}`);
      return false;
    } catch (error) {
      this.logger(`Error filling radio field: ${error.message}`);
      return false;
    }
  }

  /**
   * Fill date field
   */
  async fillDateField(element, value) {
    try {
      // For date inputs, try to format the value appropriately
      let dateValue = value;

      if (element.type === "date") {
        // Convert to YYYY-MM-DD format if needed
        try {
          const date = new Date(value);
          if (!isNaN(date.getTime())) {
            dateValue = date.toISOString().split("T")[0];
          }
        } catch (e) {
          // Keep original value if parsing fails
        }
      }

      return await this.fillInputField(element, dateValue);
    } catch (error) {
      this.logger(`Error filling date field: ${error.message}`);
      return false;
    }
  }

  /**
   * Handle required checkboxes and agreements
   */
  async handleRequiredCheckboxes(form) {
    try {
      this.logger("Handling required checkboxes");

      const checkboxes = form.querySelectorAll('input[type="checkbox"]');

      for (const checkbox of checkboxes) {
        if (!this.isElementVisible(checkbox)) continue;

        const isRequired = this.isFieldRequired(checkbox);
        const label = this.getFieldLabel(checkbox);

        if (isRequired || this.isAgreementCheckbox(label)) {
          if (!checkbox.checked) {
            this.logger(`Checking required/agreement checkbox: ${label}`);
            checkbox.click();
            await this.wait(200);
          }
        }
      }
    } catch (error) {
      this.logger(`Error handling checkboxes: ${error.message}`);
    }
  }

  /**
   * Check if checkbox is for terms/agreement
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
   * Parse AI boolean response
   */
  parseAIBoolean(value) {
    if (!value) return false;

    const normalizedValue = String(value).toLowerCase().trim();

    const positiveResponses = [
      "yes",
      "true",
      "agree",
      "accept",
      "confirm",
      "ok",
      "okay",
      "sure",
      "definitely",
      "absolutely",
      "correct",
      "right",
      "affirmative",
      "positive",
      "1",
      "checked",
      "check",
      "select",
    ];

    const negativeResponses = [
      "no",
      "false",
      "disagree",
      "decline",
      "deny",
      "refuse",
      "never",
      "negative",
      "incorrect",
      "wrong",
      "0",
      "unchecked",
      "uncheck",
      "deselect",
      "skip",
    ];

    if (
      positiveResponses.some((response) => normalizedValue.includes(response))
    ) {
      return true;
    }

    if (
      negativeResponses.some((response) => normalizedValue.includes(response))
    ) {
      return false;
    }

    return null; // Unclear response
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
          submitButton.textContent || submitButton.value || "Submit"
        }`
      );

      if (!this.isElementVisible(submitButton) || submitButton.disabled) {
        this.logger("Submit button is not clickable");
        return false;
      }

      this.scrollToElement(submitButton);
      await this.wait(500);

      // Click submit button
      submitButton.click();
      this.logger("Clicked submit button");

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
      'button[data-qa="btn-submit"]',
      'button[data-qa="submit"]',
      ".submit-button",
      ".posting-btn-submit",
      "button.btn-primary:last-child",
      "button:last-child",
    ];

    for (const selector of submitSelectors) {
      const button = form.querySelector(selector);
      if (button && this.isElementVisible(button) && !button.disabled) {
        return button;
      }
    }

    // Look for buttons with submit-like text
    const buttons = form.querySelectorAll('button, input[type="button"]');
    for (const button of buttons) {
      if (!this.isElementVisible(button) || button.disabled) continue;

      const text = (button.textContent || button.value || "").toLowerCase();
      if (
        text.includes("submit") ||
        text.includes("apply") ||
        text.includes("send") ||
        text.includes("continue") ||
        text === "next"
      ) {
        return button;
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
}
