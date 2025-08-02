// platforms/breezy/breezy-form-handler.js

import Utils from "../../utils/utils.js";

export class BreezyFormHandler {
  constructor(aiService, userData, logger) {
    this.aiService = aiService;
    this.userData = userData;
    this.logger = logger || console.log;
    this.answerCache = new Map();
    this.utils = new Utils();
  }

  log(message, data = {}) {
    if (typeof this.logger === "function") {
      this.logger(message);
    } else if (this.logger && this.logger.log) {
      this.logger.log(message, data);
    } else {
      console.log(`🤖 [BreezyHandler] ${message}`, data);
    }
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
   * Main form filling method
   */
  async fillFormWithProfile(form, profile) {
    try {
      this.log("Filling Breezy form with user profile data");
      this.userData = profile;

      // Use simplified field discovery approach
      const formFields = await this.grabFields(form);
      this.log(`Found ${formFields.length} form fields to process`);

      if (formFields.length === 0) {
        this.log("No form fields found");
        return false;
      }

      // Process fields sequentially
      let processedCount = 0;
      const failedFields = [];

      for (let i = 0; i < formFields.length; i++) {
        const field = formFields[i];

        try {
          this.log(`Processing field ${i + 1}/${formFields.length}: ${field.label} (${field.type})`);

          // Skip file uploads for now
          if (field.type === 'file') {
            this.log(`⏭️ Skipping file upload: ${field.label}`);
            continue;
          }

          const success = await this.handleField(field);
          if (success) {
            processedCount++;
            this.log(`✅ Successfully processed: ${field.label}`);
          } else {
            failedFields.push(field.label);
            this.log(`❌ Failed to process: ${field.label}`);
          }

          // Wait between fields
          await this.wait(300);

        } catch (error) {
          failedFields.push(field.label);
          this.log(`❌ Error processing field "${field.label}": ${error.message}`);
        }
      }

      // Handle required checkboxes (GDPR, etc.)
      await this.handleRequiredCheckboxes(form);

      this.log(`Processing summary: ${processedCount} successful, ${failedFields.length} failed`);
      return processedCount > 0;

    } catch (error) {
      this.log(`Error filling form: ${error.message}`);
      return false;
    }
  }

  /**
   * Simplified field detection based on working approach
   */
  async grabFields(form) {
    const results = [];
    this.log("🔍 Starting field discovery for Breezy form");

    try {
      // Use the proven selector approach
      const fieldSelectors = [
        'input[type=text]',
        'input[type=email]',
        'input[type=tel]',
        'input[type=number]',
        'input[name="cSalary"]', // Specific salary field
        'select',
        'textarea',
        'ul:has(input[type=radio])',
        'ul:has(input[type=checkbox])',
        'input[type=checkbox]' // Individual checkboxes
      ];

      const allElements = form.querySelectorAll(fieldSelectors.join(', '));
      this.log(`Found ${allElements.length} potential form elements`);

      for (const element of allElements) {
        if (!this.isElementVisible(element)) continue;

        const field = this.createFieldObject(element);
        if (field && field.label) {
          results.push(field);
          this.log(`✅ Field: ${field.label} (${field.type})`);
        }
      }

      return results;

    } catch (error) {
      this.log(`❌ Error in grabFields: ${error.message}`);
      return [];
    }
  }

  /**
   * Create field object from element using simplified approach
   */
  createFieldObject(element) {
    try {
      const label = this.findFieldLabel(element);
      if (!label) return null;

      const field = {
        element: element,
        label: this.cleanLabelText(label),
        required: this.isFieldRequired(element),
        options: []
      };

      // Determine field type and get options
      if (element.tagName === 'INPUT') {
        field.type = element.type;

        // Special handling for salary fields
        if (element.name === 'cSalary' || this.isSalaryField(element)) {
          field.type = 'salary';
        }
      }
      else if (element.tagName === 'SELECT') {
        field.type = 'select';
        field.options = Array.from(element.options)
          .map(option => option.textContent.trim())
          .filter(text => text.length > 0 && text !== 'Select...');
      }
      else if (element.tagName === 'TEXTAREA') {
        field.type = 'textarea';
      }
      else if (element.tagName === 'UL') {
        // Handle radio/checkbox groups
        const inputs = element.querySelectorAll('input');
        if (inputs.length > 0) {
          const inputType = inputs[0].type;
          field.type = inputType;
          field.element = element; // Keep the UL as the main element

          // Extract options from the list
          const optionElements = element.querySelectorAll('li span, li strong, li .ng-binding');
          field.options = Array.from(optionElements)
            .map(span => span.textContent.trim())
            .filter(text => text.length > 0);

          // Fallback to input labels if no spans found
          if (field.options.length === 0) {
            field.options = Array.from(inputs).map(input => {
              const label = input.closest('label') ||
                document.querySelector(`label[for="${input.id}"]`);
              return label ? label.textContent.trim() : '';
            }).filter(text => text.length > 0);
          }
        }
      }

      return field;

    } catch (error) {
      this.log(`Error creating field object: ${error.message}`);
      return null;
    }
  }

  /**
   * Simplified label finding based on working approach
   */
  findFieldLabel(element) {
    try {
      // Start from the element and traverse up to find the label
      let label = element;
      let attempts = 0;
      const maxAttempts = 10;

      while (label && attempts < maxAttempts) {
        attempts++;

        // Move to previous sibling or parent
        label = label.previousElementSibling || label.parentElement;

        if (!label) break;

        // Check if this is a header element
        if (label.tagName === 'H3' || label.className.includes('section-header')) {
          // Extract text from span h2 or direct text
          const spanH2 = label.querySelector('span h2');
          if (spanH2) {
            return spanH2.textContent.trim();
          }

          const polygotSpan = label.querySelector('span.polygot');
          if (polygotSpan) {
            return polygotSpan.textContent.trim();
          }

          return label.textContent.trim();
        }
      }

      // Fallback methods
      // Check for standard label association
      if (element.id) {
        const labelElement = document.querySelector(`label[for="${element.id}"]`);
        if (labelElement) {
          return labelElement.textContent.trim();
        }
      }

      // Check aria-label
      if (element.getAttribute('aria-label')) {
        return element.getAttribute('aria-label');
      }

      // Check placeholder
      if (element.placeholder) {
        return element.placeholder;
      }

      // Check name attribute as last resort
      if (element.name) {
        return element.name.replace(/([A-Z])/g, ' $1').replace(/_/g, ' ');
      }

      return null;

    } catch (error) {
      this.log(`Error finding field label: ${error.message}`);
      return null;
    }
  }

  /**
   * Handle individual field
   */
  async handleField(field) {
    try {
      const answer = await this.getAIAnswer(
        field.label,
        field.options,
        field.type,
        `This is a ${field.type} field${field.required ? ' (required)' : ''}`
      );

      if (!answer) {
        this.log(`No answer received for: ${field.label}`);
        return false;
      }

      return await this.fillField(field, answer);

    } catch (error) {
      this.log(`Error handling field: ${error.message}`);
      return false;
    }
  }

  /**
   * Fill field with appropriate method based on type
   */
  async fillField(field, value) {
    try {
      const element = field.element;
      const fieldType = field.type;

      this.log(`Filling ${fieldType} field "${field.label}" with value: "${value}"`);

      switch (fieldType) {
        case 'text':
        case 'email':
        case 'tel':
        case 'number':
        case 'salary':
          return await this.setNativeValue(element, value);

        case 'textarea':
          return await this.setNativeValue(element, value);

        case 'select':
          return await this.fillSelectField(element, value, field.options);

        case 'radio':
          return await this.fillRadioField(element, value, field.options);

        case 'checkbox':
          if (element.tagName === 'UL') {
            return await this.fillCheckboxGroup(element, value, field.options);
          } else {
            return await this.fillSingleCheckbox(element, value);
          }

        default:
          this.log(`Unknown field type: ${fieldType}`);
          return false;
      }

    } catch (error) {
      this.log(`Error filling field: ${error.message}`);
      return false;
    }
  }

  /**
   * Set native value and dispatch events (based on working approach)
   */
  async setNativeValue(element, value) {
    try {
      this.scrollToElement(element);
      element.focus();
      await this.wait(100);

      // Special handling for salary fields
      if (this.isSalaryField(element)) {
        const numericValue = this.extractNumericSalary(value);
        if (numericValue) {
          element.value = numericValue;
        } else {
          return false;
        }
      } else {
        element.value = value;
      }

      // Dispatch events to trigger validation
      element.dispatchEvent(new Event('input', { bubbles: true }));
      element.dispatchEvent(new Event('change', { bubbles: true }));
      element.dispatchEvent(new Event('blur', { bubbles: true }));

      await this.wait(200);
      return true;

    } catch (error) {
      this.log(`Error setting native value: ${error.message}`);
      return false;
    }
  }

  /**
   * Fill select field
   */
  async fillSelectField(element, value, options) {
    try {
      this.scrollToElement(element);
      element.focus();
      await this.wait(200);

      const valueStr = String(value).toLowerCase();
      let optionSelected = false;

      // Try to find matching option
      for (const option of Array.from(element.options)) {
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

      if (optionSelected) {
        element.dispatchEvent(new Event('change', { bubbles: true }));
        await this.wait(200);
        return true;
      }

      return false;

    } catch (error) {
      this.log(`Error filling select field: ${error.message}`);
      return false;
    }
  }

  /**
   * Fill radio field group
   */
  async fillRadioField(element, value, options) {
    try {
      const valueStr = String(value).toLowerCase();
      const radioInputs = element.querySelectorAll('input[type="radio"]');

      for (const radio of radioInputs) {
        const li = radio.closest('li');
        if (!li) continue;

        // Get option text
        const span = li.querySelector('span, strong, .ng-binding');
        const optionText = span ? span.textContent.trim().toLowerCase() : '';
        const radioValue = radio.value.toLowerCase();

        if (
          optionText === valueStr ||
          optionText.includes(valueStr) ||
          valueStr.includes(optionText) ||
          radioValue === valueStr
        ) {
          this.scrollToElement(li);

          // Click the list item or label to select the radio
          const label = li.querySelector('label');
          if (label) {
            label.click();
          } else {
            radio.click();
          }

          await this.wait(300);
          return true;
        }
      }

      return false;

    } catch (error) {
      this.log(`Error filling radio field: ${error.message}`);
      return false;
    }
  }

  /**
   * Fill checkbox group
   */
  async fillCheckboxGroup(element, value, options) {
    try {
      // For checkbox groups, we might get multiple values
      const values = Array.isArray(value) ? value : [value];
      const checkboxInputs = element.querySelectorAll('input[type="checkbox"]');
      let checkedAny = false;

      for (const checkbox of checkboxInputs) {
        const li = checkbox.closest('li');
        if (!li) continue;

        const span = li.querySelector('span, strong, .ng-binding');
        const optionText = span ? span.textContent.trim().toLowerCase() : '';
        const checkboxValue = checkbox.value.toLowerCase();

        const shouldCheck = values.some(val => {
          const valStr = String(val).toLowerCase();
          return optionText === valStr ||
            optionText.includes(valStr) ||
            valStr.includes(optionText) ||
            checkboxValue === valStr;
        });

        if (shouldCheck && !checkbox.checked) {
          this.scrollToElement(li);

          const label = li.querySelector('label');
          if (label) {
            label.click();
          } else {
            checkbox.click();
          }

          await this.wait(200);
          checkedAny = true;
        }
      }

      return checkedAny;

    } catch (error) {
      this.log(`Error filling checkbox group: ${error.message}`);
      return false;
    }
  }

  /**
   * Fill single checkbox
   */
  async fillSingleCheckbox(element, value) {
    try {
      const shouldCheck = this.shouldCheckValue(value);

      if (element.checked !== shouldCheck) {
        this.scrollToElement(element);

        const label = element.closest('label') ||
          document.querySelector(`label[for="${element.id}"]`);

        if (label) {
          label.click();
        } else {
          element.click();
        }

        await this.wait(200);
      }

      return true;

    } catch (error) {
      this.log(`Error filling single checkbox: ${error.message}`);
      return false;
    }
  }

  /**
   * Handle required checkboxes (GDPR, etc.)
   */
  async handleRequiredCheckboxes(form) {
    try {
      this.log("Handling required checkboxes");

      // Handle GDPR checkboxes
      const gdprContainers = form.querySelectorAll('.gdpr-accept');
      for (const container of gdprContainers) {
        const checkbox = container.querySelector('input[type="checkbox"]');
        if (checkbox && this.isElementVisible(checkbox) && !checkbox.checked) {
          this.log("Checking GDPR consent checkbox");
          await this.fillSingleCheckbox(checkbox, true);
        }
      }

      // Handle other required checkboxes
      const requiredCheckboxes = form.querySelectorAll('input[type="checkbox"][required]');
      for (const checkbox of requiredCheckboxes) {
        if (this.isElementVisible(checkbox) && !checkbox.checked) {
          this.log(`Checking required checkbox: ${checkbox.name}`);
          await this.fillSingleCheckbox(checkbox, true);
        }
      }

    } catch (error) {
      this.log(`Error handling required checkboxes: ${error.message}`);
    }
  }

  /**
   * Get AI answer for a form field
   */
  async getAIAnswer(question, options = [], fieldType = "text", fieldContext = "") {
    try {
      const cacheKey = JSON.stringify({
        question: this.cleanLabelText(question),
        options: options.sort(),
        fieldType,
        fieldContext,
      });

      if (this.answerCache.has(cacheKey)) {
        this.log(`Using cached answer for "${question}"`);
        return this.answerCache.get(cacheKey);
      }

      this.log(`Requesting AI answer for: "${question}"`);

      // Use standardized AI service
      const context = {
        platform: "breezy",
        userData: this.userData,
        jobDescription: this.jobDescription || "",
        fieldType,
        fieldContext,
        required: fieldContext.includes('required')
      };

      const answer = await this.aiService.getAnswer(question, options, context);

      if (answer !== null && answer !== undefined && answer !== "") {
        this.answerCache.set(cacheKey, answer);
        return answer;
      } else {
        return null;
      }
    } catch (error) {
      this.log(`Error getting AI answer: ${error.message}`);
      return null;
    }
  }

  /**
   * Check if element is a salary field
   */
  isSalaryField(element) {
    const name = (element.name || "").toLowerCase();
    const id = (element.id || "").toLowerCase();
    const placeholder = (element.placeholder || "").toLowerCase();

    return (
      name.includes("salary") ||
      name === "csalary" ||
      id.includes("salary") ||
      placeholder.includes("salary") ||
      element.getAttribute("ng-change") === "stripNonNumeric()"
    );
  }

  /**
   * Extract numeric value from salary string
   */
  extractNumericSalary(salaryValue) {
    if (!salaryValue) return "";

    const numericOnly = String(salaryValue).replace(/[^\d]/g, "");
    if (!numericOnly) return "";

    const numValue = parseInt(numericOnly, 10);
    if (numValue < 1000 || numValue > 999999999) {
      if (numericOnly.length > 6) {
        return numericOnly.substring(0, 6);
      }
      return numericOnly;
    }

    return numericOnly;
  }

  /**
   * Check if a field is required
   */
  isFieldRequired(element) {
    return element.required ||
      element.getAttribute("aria-required") === "true" ||
      element.classList.contains("is-required") ||
      element.closest(".form-group")?.classList.contains("required");
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
   * Submit form
   */
  async submitForm(form) {
    try {
      this.log("Attempting to submit form");

      const submitButton = this.findSubmitButton(form);
      if (!submitButton) {
        this.log("No submit button found");
        return false;
      }

      if (!this.isElementVisible(submitButton) || submitButton.disabled) {
        this.log("Submit button is not clickable");
        return false;
      }

      this.scrollToElement(submitButton);
      await this.wait(500);

      submitButton.click();
      this.log("Clicked submit button");

      await this.wait(3000);
      return true;

    } catch (error) {
      this.log(`Error submitting form: ${error.message}`);
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
      'button.submit-button',
      'button.btn-primary',
      '.btn.btn-primary'
    ];

    for (const selector of submitSelectors) {
      const button = form.querySelector(selector);
      if (button && this.isElementVisible(button) && !button.disabled) {
        return button;
      }
    }

    // Look for buttons with submit-like text
    const allButtons = form.querySelectorAll('button, input[type="button"]');
    for (const btn of allButtons) {
      if (!this.isElementVisible(btn) || btn.disabled) continue;

      const text = (btn.textContent || btn.value || '').toLowerCase();
      if (text.includes("submit") || text.includes("apply") || text.includes("send")) {
        return btn;
      }
    }

    return null;
  }
}