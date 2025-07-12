// platforms/ashby/ashby-form-handler.js'
//Attempting to submit form
//No submit button found
import { AIService } from "../../services/index.js";
import { DomUtils } from "../../shared/utilities/index.js";

export class AshbyFormHandler {
  constructor(options = {}) {
    this.logger = options.logger || console.log;
    this.host = options.host || "http://localhost:3000";
    this.userData = options.userData || {};
    this.jobDescription = options.jobDescription || "";
    this.aiService = new AIService({ apiHost: this.host });
    this.answerCache = new Map();
  }

  /**
   * Enhanced form finding for Ashby application pages
   */
  static findApplicationForm() {
    // Ashby-specific form selectors for application tab
    const ashbyApplicationSelectors = [
      "form.application-form",
      "form#application-form",
      'form[data-testid="application-form"]',
      'form[action*="apply"]',
      ".application-form form",
      'form[role="form"]',
      "#form form",
      '[aria-controls="form"] form',
      ".ashby-job-posting-application form",
    ];

    return DomUtils.findForm(ashbyApplicationSelectors);
  }

  /**
   * Get label text for a form field (Ashby-specific)
   */
  getFieldLabel(element) {
    try {
      // Ashby specific label finding
      const ashbyLabel = element
        .closest(".form-field, .form-group")
        ?.querySelector("label, .label-text");
      if (ashbyLabel) {
        return this.cleanLabelText(ashbyLabel.textContent);
      }

      // Handle file upload fields specifically
      if (
        element.type === "file" ||
        element.classList.contains("file-input") ||
        element.closest(".file-upload")
      ) {
        const fileLabel = element
          .closest(".file-upload")
          ?.querySelector("label, .upload-label");
        if (fileLabel) {
          return this.cleanLabelText(fileLabel.textContent);
        }

        const formField = element.closest(".form-field");
        if (formField) {
          const label = formField.querySelector("label");
          if (label) {
            return this.cleanLabelText(label.textContent);
          }
        }
      }

      // If this is a checkbox/radio group, look for the label with aria-labelledby
      if (
        element.getAttribute("role") === "group" ||
        element.getAttribute("role") === "radiogroup" ||
        (element.tagName === "FIELDSET" &&
          element.getAttribute("role") === "radiogroup")
      ) {
        const labelledById = element.getAttribute("aria-labelledby");
        if (labelledById) {
          const labelEl = document.getElementById(labelledById);
          if (labelEl) {
            const labelText = Array.from(labelEl.childNodes)
              .filter(
                (node) =>
                  node.nodeType === Node.TEXT_NODE ||
                  (node.nodeType === Node.ELEMENT_NODE &&
                    node.tagName !== "SVG")
              )
              .map((node) => node.textContent)
              .join(" ");
            return this.cleanLabelText(labelText);
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

      // Fieldset legend
      const fieldset = element.closest("fieldset");
      if (fieldset) {
        const legend = fieldset.querySelector("legend");
        if (legend) {
          return this.cleanLabelText(legend.textContent);
        }
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
      element.closest(".radio-group")
    ) {
      return "radio";
    }

    // Checkbox groups
    if (
      (role === "group" &&
        element.querySelector('[role="checkbox"], input[type="checkbox"]')) ||
      element.closest(".checkbox-group")
    ) {
      return "checkbox";
    }

    // Individual radio or checkbox
    if (role === "radio" || role === "checkbox") {
      return role;
    }

    // Custom select
    if (role === "combobox" || element.classList.contains("select")) {
      return "select";
    }

    // Upload fields
    if (
      className.includes("file-input") ||
      element.querySelector('input[type="file"]') ||
      element.classList.contains("file-upload")
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
      element.classList.contains("required") ||
      element
        .closest(".form-field, .form-group")
        ?.classList.contains("required")
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

  /**
   * Fill form with user profile data using AI
   */
  async fillFormWithProfile(form, profile) {
    try {
      this.logger("Filling Ashby form with user profile data");
      this.userData = profile;

      const formFields = this.getAllFormFields(form);
      this.logger(`Found ${formFields.length} form fields to process`);

      let filledCount = 0;

      for (const field of formFields) {
        if (!field.label) continue;
        if (field.type === "file") continue;

        try {
          this.logger(`Processing field: ${field.label} (${field.type})`);

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
            if (success) filledCount++;
          }

          await this.wait(300);
        } catch (fieldError) {
          this.logger(
            `Error processing field "${field.label}": ${fieldError.message}`
          );
        }
      }

      // Handle required checkboxes and agreements
      await this.handleRequiredCheckboxes(form);

      this.logger(`Successfully filled ${filledCount} fields with AI answers`);
      return true;
    } catch (error) {
      this.logger(`Error filling form with AI answers: ${error.message}`);
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
      const cacheKey = `${question}:${options.join(",")}`;
      if (this.answerCache.has(cacheKey)) {
        return this.answerCache.get(cacheKey);
      }

      this.logger(`Requesting AI answer for "${question}"`);

      const answer = await this.aiService.getAnswer(question, options, {
        platform: "ashby",
        userData: this.userData,
        jobDescription: this.jobDescription,
        fieldType,
        fieldContext,
      });

      this.answerCache.set(cacheKey, answer);
      return answer;
    } catch (error) {
      this.logger(`Error getting AI answer: ${error.message}`);

      // Return appropriate fallback based on field type
      if (fieldType === "checkbox" || fieldType === "radio") {
        return options.length > 0 ? options[0] : "yes";
      } else if (fieldType === "select") {
        return options.length > 0 ? options[0] : "";
      } else {
        return "I prefer not to answer";
      }
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
   * Fill a textarea field
   */
  async fillTextareaField(element, value) {
    return await this.fillInputField(element, value);
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
        element.closest(".phone-input") ||
        document.querySelector(".phone-input-container");

      if (isIntlPhone) {
        const phoneInput =
          element.tagName.toLowerCase() === "input"
            ? element
            : element.querySelector('input[type="tel"]');

        if (!phoneInput) return false;

        return await this.fillInputField(phoneInput, value);
      }

      return await this.fillInputField(element, value);
    } catch (error) {
      this.logger(`Error filling phone field: ${error.message}`);
      return false;
    }
  }

  /**
   * Fill a checkbox field
   */
  async fillCheckboxField(element, value) {
    try {
      const shouldCheck =
        value === true ||
        value === "true" ||
        value === "yes" ||
        value === "on" ||
        value === 1;

      let checkboxInput = element;
      if (element.tagName.toLowerCase() !== "input") {
        checkboxInput = element.querySelector('input[type="checkbox"]');

        if (!checkboxInput) {
          if (element.getAttribute("role") === "checkbox") {
            const isChecked = element.getAttribute("aria-checked") === "true";

            if ((shouldCheck && !isChecked) || (!shouldCheck && isChecked)) {
              this.scrollToElement(element);
              element.click();
              await this.wait(200);
            }
            return true;
          }

          const customCheckbox = element.querySelector(".checkbox");
          if (customCheckbox) {
            this.scrollToElement(customCheckbox);
            customCheckbox.click();
            await this.wait(200);
            return true;
          }
        }

        if (!checkboxInput) return false;
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
   * Fill a radio button field
   */
  async fillRadioField(element, value) {
    try {
      const valueStr = String(value).toLowerCase();

      // Handle Ashby's radio groups
      if (
        element.classList.contains("radio-group") ||
        element.closest(".radio-group")
      ) {
        const container = element.classList.contains("radio-group")
          ? element
          : element.closest(".radio-group");

        const radioLabels = container.querySelectorAll("label");

        let matchingLabel = null;

        for (const label of radioLabels) {
          const labelText = label.textContent.trim().toLowerCase();

          if (
            labelText === valueStr ||
            labelText.includes(valueStr) ||
            valueStr.includes(labelText) ||
            (valueStr === "yes" && labelText === "yes") ||
            (valueStr === "no" && labelText === "no")
          ) {
            matchingLabel = label;
            break;
          }
        }

        if (
          !matchingLabel &&
          (valueStr === "yes" ||
            valueStr === "no" ||
            valueStr === "true" ||
            valueStr === "false")
        ) {
          const isYes = valueStr === "yes" || valueStr === "true";

          if (isYes && radioLabels.length > 0) {
            matchingLabel = radioLabels[0];
          } else if (!isYes && radioLabels.length > 1) {
            matchingLabel = radioLabels[1];
          }
        }

        if (!matchingLabel && radioLabels.length > 0) {
          matchingLabel = radioLabels[0];
        }

        if (matchingLabel) {
          this.scrollToElement(matchingLabel);
          matchingLabel.click();
          await this.wait(300);
          return true;
        }
      }

      // Handle standard radio groups
      if (
        element.getAttribute("role") === "radiogroup" ||
        (element.tagName === "FIELDSET" &&
          element.getAttribute("role") === "radiogroup")
      ) {
        const radios = element.querySelectorAll(
          '[role="radio"], input[type="radio"]'
        );
        if (!radios.length) return false;

        let matchingRadio = null;

        for (const radio of radios) {
          const label =
            radio.closest("label") ||
            document.querySelector(`label[for="${radio.id}"]`);

          if (label) {
            const labelText = label.textContent.trim().toLowerCase();

            if (
              labelText === valueStr ||
              labelText.includes(valueStr) ||
              valueStr.includes(labelText) ||
              (valueStr === "yes" && labelText === "yes") ||
              (valueStr === "no" && labelText === "no")
            ) {
              matchingRadio = radio;
              break;
            }
          }
        }

        if (
          !matchingRadio &&
          (valueStr === "yes" ||
            valueStr === "no" ||
            valueStr === "true" ||
            valueStr === "false")
        ) {
          const isYes = valueStr === "yes" || valueStr === "true";

          if (isYes && radios.length > 0) {
            matchingRadio = radios[0];
          } else if (!isYes && radios.length > 1) {
            matchingRadio = radios[1];
          }
        }

        if (!matchingRadio && radios.length > 0) {
          matchingRadio = radios[0];
        }

        if (matchingRadio) {
          this.scrollToElement(matchingRadio);

          const label =
            matchingRadio.closest("label") ||
            document.querySelector(`label[for="${matchingRadio.id}"]`);
          if (label) {
            label.click();
          } else {
            matchingRadio.click();
          }

          await this.wait(300);
          return true;
        }
      }

      return false;
    } catch (error) {
      this.logger(`Error filling radio field: ${error.message}`);
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
        element.classList.contains("date-input") ||
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
   * Handle required checkboxes and agreements
   */
  async handleRequiredCheckboxes(form) {
    try {
      this.logger("Handling required checkboxes");

      const checkboxFields = [];

      // Standard checkboxes
      const standardCheckboxes = form.querySelectorAll(
        'input[type="checkbox"]'
      );
      for (const checkbox of standardCheckboxes) {
        if (!this.isElementVisible(checkbox)) continue;

        const label = this.getFieldLabel(checkbox);
        const isRequired = this.isFieldRequired(checkbox);
        const isAgreement = this.isAgreementCheckbox(label);

        if (isRequired || isAgreement) {
          checkboxFields.push({
            element: checkbox,
            label,
            isRequired,
            isAgreement,
          });
        }
      }

      // Ashby custom checkboxes
      const customCheckboxes = form.querySelectorAll(
        '.checkbox, [role="checkbox"]'
      );
      for (const checkbox of customCheckboxes) {
        if (!this.isElementVisible(checkbox)) continue;

        const label = this.getFieldLabel(checkbox);
        const isRequired =
          this.isFieldRequired(checkbox) ||
          checkbox.closest(".form-field.required");
        const isAgreement = this.isAgreementCheckbox(label);

        if (isRequired || isAgreement) {
          checkboxFields.push({
            element: checkbox,
            label,
            isRequired,
            isAgreement,
          });
        }
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
   * Get available options from select fields
   */
  getFieldOptions(element) {
    try {
      const options = [];
      const fieldType = this.getFieldType(element);

      if (fieldType === "select") {
        if (element.tagName.toLowerCase() === "select") {
          Array.from(element.options).forEach((option) => {
            const text = option.textContent.trim();
            if (text && option.value) {
              options.push(text);
            }
          });
        }
      } else if (fieldType === "radio") {
        const radios =
          element.tagName === "FIELDSET"
            ? element.querySelectorAll('[role="radio"], input[type="radio"]')
            : element
                .closest("fieldset, .radio-group")
                ?.querySelectorAll('[role="radio"], input[type="radio"]') || [];

        radios.forEach((radio) => {
          const label =
            radio.closest("label") ||
            document.querySelector(`label[for="${radio.id}"]`);
          if (label) {
            options.push(label.textContent.trim());
          }
        });

        if (options.length === 0 && element.closest(".radio-group")) {
          element
            .closest(".radio-group")
            .querySelectorAll("label")
            .forEach((label) => {
              options.push(label.textContent.trim());
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
   * Find and submit the form
   */
  async submitForm(form) {
    try {
      this.logger("Attempting to submit form");

      const submitButton = this.findSubmitButton(form);
      console.log();
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
   * Get all form fields from an Ashby application form
   */
  getAllFormFields(form) {
    try {
      this.logger("Finding all form fields in Ashby form");

      const fields = [];

      // Ashby-specific field entry selector
      const fieldEntries = form.querySelectorAll(
        "._fieldEntry_hkyf8_29, .ashby-application-form-field-entry"
      );

      this.logger(`Found ${fieldEntries.length} Ashby field entries`);

      for (const fieldEntry of fieldEntries) {
        if (!this.isElementVisible(fieldEntry)) continue;

        // Get the label from Ashby's structure
        const label = fieldEntry.querySelector(
          "._heading_101oc_53, .ashby-application-form-question-title"
        );
        if (!label) continue;

        const labelText = this.cleanLabelText(label.textContent);
        if (!labelText) continue;

        // Determine field type and get element
        const fieldInfo = this.getAshbyFieldInfo(fieldEntry, labelText);
        if (fieldInfo) {
          fields.push(fieldInfo);
        }
      }

      this.logger(`Processed ${fields.length} Ashby form fields`);
      return fields;
    } catch (error) {
      this.logger(`Error getting Ashby form fields: ${error.message}`);
      return [];
    }
  }

  /**
   * Get field information for Ashby-specific field structure
   */
  getAshbyFieldInfo(fieldEntry, labelText) {
    try {
      // Check for file upload field
      const fileInput = fieldEntry.querySelector('input[type="file"]');
      if (fileInput) {
        return {
          element: fieldEntry, // Use the container for file uploads
          label: labelText,
          type: "file",
          required: this.isAshbyFieldRequired(fieldEntry),
          ashbyType: "file-upload",
        };
      }

      // Check for Yes/No button group
      const yesNoContainer = fieldEntry.querySelector(
        "._container_y2cw4_29, ._yesno_hkyf8_143"
      );
      if (yesNoContainer) {
        return {
          element: yesNoContainer,
          label: labelText,
          type: "yesno",
          required: this.isAshbyFieldRequired(fieldEntry),
          ashbyType: "yes-no-buttons",
        };
      }

      // Check for regular input fields
      const input = fieldEntry.querySelector(
        'input[type="text"], input[type="email"], textarea'
      );
      if (input) {
        return {
          element: input,
          label: labelText,
          type:
            input.tagName.toLowerCase() === "textarea"
              ? "textarea"
              : input.type,
          required: this.isAshbyFieldRequired(fieldEntry),
          ashbyType: "standard-input",
        };
      }

      return null;
    } catch (error) {
      this.logger(`Error getting Ashby field info: ${error.message}`);
      return null;
    }
  }

  /**
   * Check if Ashby field is required
   */
  isAshbyFieldRequired(fieldEntry) {
    // Check for required class on label
    const label = fieldEntry.querySelector(
      "._heading_101oc_53, .ashby-application-form-question-title"
    );
    if (
      label &&
      (label.classList.contains("_required_101oc_92") ||
        label.textContent.includes("*"))
    ) {
      return true;
    }

    // Check for required attribute on input
    const input = fieldEntry.querySelector("input, textarea");
    if (
      input &&
      (input.required || input.getAttribute("aria-required") === "true")
    ) {
      return true;
    }

    return false;
  }

  /**
   * Fill a form field with the appropriate value - Ashby specific
   */
  async fillField(element, value) {
    try {
      if (!element || value === undefined || value === null) {
        return false;
      }

      // Handle based on Ashby field type
      const fieldEntry =
        element.closest("._fieldEntry_hkyf8_29") ||
        element.closest(".ashby-application-form-field-entry");
      if (!fieldEntry) {
        return await this.fillStandardField(element, value);
      }

      // Check if this is a file upload field
      if (
        element.querySelector &&
        element.querySelector('input[type="file"]')
      ) {
        this.logger(`Skipping file upload field - handled separately`);
        return true; // File uploads are handled by the file handler
      }

      // Check if this is a Yes/No button group
      if (
        element.classList.contains("_container_y2cw4_29") ||
        element.querySelector("._option_y2cw4_33")
      ) {
        return await this.fillAshbyYesNoField(element, value);
      }

      // Handle standard input/textarea
      const input =
        element.tagName === "INPUT" || element.tagName === "TEXTAREA"
          ? element
          : fieldEntry.querySelector("input, textarea");

      if (input) {
        return await this.fillAshbyInputField(input, value);
      }

      return false;
    } catch (error) {
      this.logger(`Error filling Ashby field: ${error.message}`);
      return false;
    }
  }

  /**
   * Fill Ashby Yes/No button field
   */
  async fillAshbyYesNoField(container, value) {
    try {
      this.logger(`Filling Ashby Yes/No field with value: ${value}`);

      const valueStr = String(value).toLowerCase();
      const shouldSelectYes =
        valueStr === "yes" ||
        valueStr === "true" ||
        valueStr.includes("yes") ||
        valueStr.includes("authorized");

      // Find Yes and No buttons
      const buttons = container.querySelectorAll("._option_y2cw4_33, button");
      let yesButton = null;
      let noButton = null;

      for (const button of buttons) {
        const buttonText = button.textContent.trim().toLowerCase();
        if (buttonText === "yes") {
          yesButton = button;
        } else if (buttonText === "no") {
          noButton = button;
        }
      }

      if (!yesButton || !noButton) {
        this.logger(`Could not find Yes/No buttons in container`);
        return false;
      }

      const targetButton = shouldSelectYes ? yesButton : noButton;
      this.logger(`Clicking ${shouldSelectYes ? "Yes" : "No"} button`);

      this.scrollToElement(targetButton);
      targetButton.click();
      await this.wait(300);

      return true;
    } catch (error) {
      this.logger(`Error filling Ashby Yes/No field: ${error.message}`);
      return false;
    }
  }

  /**
   * Fill Ashby input field (text, email, textarea)
   */
  async fillAshbyInputField(input, value) {
    try {
      this.scrollToElement(input);
      input.focus();
      await this.wait(100);

      // Clear existing value
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await this.wait(50);

      // Set new value
      input.value = String(value);

      // Trigger Ashby-specific events
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new Event("blur", { bubbles: true }));

      await this.wait(200);
      this.logger(`Successfully filled Ashby input: ${input.name || input.id}`);
      return true;
    } catch (error) {
      this.logger(`Error filling Ashby input field: ${error.message}`);
      return false;
    }
  }

  /**
   * Find submit button in Ashby form
   */
  findSubmitButton(form) {
    const selectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      '._button_8wvgw_29[type="submit"]',
      '.ashby-application-form button[type="submit"]',
      ".ashby-application-form-submit",
      ".ashby-application-form-submit-button",
      "button._primary_8wvgw_86",
    ];

    for (const selector of selectors) {
      const button =
        form?.querySelector(selector) || document.querySelector(selector);
      if (button && this.isElementVisible(button) && !button.disabled) {
        return button;
      }
    }

    const allButtons =
      form?.querySelectorAll("button, ._button_8wvgw_29") ||
      document.querySelectorAll("button, ._button_8wvgw_29");
    for (const btn of allButtons) {
      if (!this.isElementVisible(btn) || btn.disabled) continue;

      const text = btn.textContent.toLowerCase();
      if (
        text.includes("submit") ||
        text.includes("apply") ||
        text.includes("send application") ||
        text.includes("complete application")
      ) {
        return btn;
      }
    }

    return null;
  }
}
