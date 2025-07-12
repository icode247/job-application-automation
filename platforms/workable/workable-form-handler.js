// platforms/workable/workable-form-handler.js
import { AIService } from "../../services/index.js";

export default class WorkableFormHandler {
  constructor(options = {}) {
    this.logger = options.logger || console.log;
    this.host = options.host || "http://localhost:3000";
    this.userData = options.userData || {};
    this.jobDescription = options.jobDescription || "";
    this.aiService = new AIService({ apiHost: this.host });
    this.answerCache = new Map();
  }

  /**
   * Get all form fields from a Workable application form
   */
  getAllFormFields(form) {
    try {
      this.logger("Finding all form fields in Workable form");

      const fields = [];

      // Workable-specific selectors
      const formElements = form.querySelectorAll(
        'input:not([type="hidden"]), select, textarea, ' +
          '[role="radio"], [role="checkbox"], ' +
          'fieldset[role="radiogroup"], ' +
          'div[class*="styles--3IYUq"], ' + // Workable specific classes
          'div[role="group"], ' +
          "div.field-type-Boolean"
      );

      this.logger(`Found ${formElements.length} form elements`);

      // Process each element
      for (const element of formElements) {
        // Skip invisible elements
        if (!this.isElementVisible(element)) continue;

        const fieldInfo = {
          element,
          label: this.getFieldLabel(element),
          type: this.getFieldType(element),
          required: this.isFieldRequired(element),
        };

        // For radio groups, get the full fieldset when possible
        if (fieldInfo.type === "radio" && element.tagName !== "FIELDSET") {
          const radioGroup = element.closest('fieldset[role="radiogroup"]');
          if (radioGroup) {
            fieldInfo.element = radioGroup;
          }
        }

        fields.push(fieldInfo);
      }

      // Deduplicate fields - particularly important for radio groups
      const uniqueFields = [];
      const seenLabels = new Set();

      for (const field of fields) {
        // Only add fields with labels
        if (!field.label) continue;

        // For radio fields, only add the first instance of each label
        if (field.type === "radio") {
          if (!seenLabels.has(field.label)) {
            seenLabels.add(field.label);
            uniqueFields.push(field);
          }
        } else {
          uniqueFields.push(field);
        }
      }

      this.logger(`Processed ${uniqueFields.length} unique form fields`);
      return uniqueFields;
    } catch (error) {
      this.logger(`Error getting form fields: ${error.message}`);
      return [];
    }
  }

  /**
   * Get label text for a form field
   */
  getFieldLabel(element) {
    try {
      const workableLabel = element
        .closest(".styles--3aPac")
        ?.querySelector(".styles--QTMDv");
      if (workableLabel) {
        return this.cleanLabelText(workableLabel.textContent);
      }

      // Handle file upload fields specifically
      if (
        element.type === "file" ||
        element.getAttribute("data-role") === "dropzone" ||
        element.closest('[data-role="dropzone"]')
      ) {
        let container = element;

        if (element.tagName === "INPUT" && element.type === "file") {
          container =
            element.closest('[data-role="dropzone"]') || element.parentElement;
        }

        let fieldContainer = container;
        for (let i = 0; i < 5 && fieldContainer; i++) {
          if (
            fieldContainer.classList.contains("styles--3aPac") ||
            fieldContainer.className.includes("styles--3aPac")
          ) {
            break;
          }
          fieldContainer = fieldContainer.parentElement;
        }

        if (fieldContainer) {
          const labelEl = fieldContainer.querySelector(
            '.styles--QTMDv, [class*="QTMDv"]'
          );
          if (labelEl) {
            return this.cleanLabelText(labelEl.textContent);
          }
        }

        const labelledById = element.getAttribute("aria-labelledby");
        if (labelledById) {
          const labelElement = document.getElementById(labelledById);
          if (labelElement) {
            return this.cleanLabelText(labelElement.textContent);
          }
        }

        if (element.id) {
          const idParts = element.id.split("_");
          const prefix = idParts[0];

          const labelEl = document.querySelector(
            `span[id="${prefix}_label"], span[id*="${prefix}_label"]`
          );
          if (labelEl) {
            return this.cleanLabelText(labelEl.textContent);
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
            // Specifically exclude SVG descriptions
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

      // Special handling for Workable radio groups
      if (
        element.getAttribute("role") === "radiogroup" ||
        (element.tagName === "FIELDSET" &&
          element.getAttribute("role") === "radiogroup")
      ) {
        // Look for aria-labelledby first
        const labelledById = element.getAttribute("aria-labelledby");
        if (labelledById) {
          const labelEl = document.getElementById(labelledById);
          if (labelEl) {
            return this.cleanLabelText(labelEl.textContent);
          }
        }

        // If no aria-labelledby, try to find previous sibling with label class
        const prevSibling = element.previousElementSibling;
        if (prevSibling) {
          const labelEl = prevSibling.querySelector(
            '[class*="QTMDv"], [class*="label"], span[id*="_label"]'
          );
          if (labelEl) {
            return this.cleanLabelText(labelEl.textContent);
          }
        }
      }

      // Method 1: Check for aria-labelledby attribute
      const labelledById = element.getAttribute("aria-labelledby");
      if (labelledById) {
        const labelElement = document.getElementById(labelledById);
        if (labelElement) {
          return this.cleanLabelText(labelElement.textContent);
        }
      }

      // Method 2: Check for explicit label element
      if (element.id) {
        const labelElement = document.querySelector(
          `label[for="${element.id}"]`
        );
        if (labelElement) {
          return this.cleanLabelText(labelElement.textContent);
        }
      }

      // Method 3: Check if element is inside a label
      const parentLabel = element.closest("label");
      if (parentLabel) {
        // Clone the label to avoid modifying the original
        const clone = parentLabel.cloneNode(true);

        // Remove the input element from the clone to get just the label text
        const inputElements = clone.querySelectorAll("input, select, textarea");
        for (const inputEl of inputElements) {
          if (inputEl.parentNode) {
            inputEl.parentNode.removeChild(inputEl);
          }
        }

        return this.cleanLabelText(clone.textContent);
      }

      // Workable-specific: Check for styles--QTMDv class in parent container
      const parentContainer = element.closest('div[class*="styles--3aPac"]');
      if (parentContainer) {
        const labelEl = parentContainer.querySelector('[class*="QTMDv"]');
        if (labelEl) {
          return this.cleanLabelText(labelEl.textContent);
        }
      }

      // Method 4: Check if element is in a fieldset with legend
      const fieldset = element.closest("fieldset");
      if (fieldset) {
        const legend = fieldset.querySelector("legend");
        if (legend) {
          return this.cleanLabelText(legend.textContent);
        }
      }

      // Method 5: Look for nearby elements that could be labels
      const parent = element.parentElement;
      if (parent) {
        // Check for elements with label-like class names
        const labelElements = parent.querySelectorAll(
          '.label, .field-label, [class*="label"]'
        );
        if (labelElements.length > 0) {
          return this.cleanLabelText(labelElements[0].textContent);
        }

        // Check for special Workable structure
        if (
          parent.previousElementSibling &&
          parent.previousElementSibling.querySelector('[class*="QTMDv"]')
        ) {
          return this.cleanLabelText(parent.previousElementSibling.textContent);
        }
      }

      // Method 6: Use aria-label, placeholder, or name as fallback
      if (element.getAttribute("aria-label")) {
        return this.cleanLabelText(element.getAttribute("aria-label"));
      }

      if (element.placeholder) {
        return this.cleanLabelText(element.placeholder);
      }

      if (element.name) {
        // Convert camelCase or snake_case to spaces
        return this.cleanLabelText(
          element.name.replace(/([A-Z])/g, " $1").replace(/_/g, " ")
        );
      }

      // If nothing else works, return empty string
      return "";
    } catch (error) {
      this.logger(`Error getting field label: ${error.message}`);
      return "";
    }
  }

  /**
   * Clean up label text by removing asterisks and extra whitespace
   */
  cleanLabelText(text) {
    if (!text) return "";

    return text
      .replace(/[*✱]/g, "") // Remove asterisks (both standard and special)
      .replace(/\s+/g, " ") // Normalize whitespace
      .replace(/^\s+|\s+$/g, "") // Trim start and end
      .replace(/\(required\)/i, "") // Remove "(required)" text
      .replace(/\(optional\)/i, "") // Remove "(optional)" text
      .toLowerCase(); // Convert to lowercase for easier comparison
  }

  /**
   * Get the type of a form field
   */
  getFieldType(element) {
    const role = element.getAttribute("role");
    const tagName = element.tagName.toLowerCase();

    // Radio groups
    if (
      role === "radiogroup" ||
      (tagName === "fieldset" && role === "radiogroup")
    ) {
      return "radio";
    }

    // Checkbox groups
    if (
      role === "group" &&
      element.querySelector('[role="checkbox"], input[type="checkbox"]')
    ) {
      return "checkbox";
    }

    // Individual radio or checkbox
    if (role === "radio" || role === "checkbox") {
      return role;
    }

    // Custom select (combobox not part of phone input)
    if (role === "combobox" && !element.closest('[data-ui="phone"]')) {
      return "select";
    }

    // Upload fields
    if (
      element.getAttribute("data-role") === "dropzone" ||
      element.querySelector('input[type="file"]')
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
      if (type === "tel" || element.closest('[data-ui="phone"]'))
        return "phone";
      return type || "text";
    }

    // Workable-specific custom fields (only apply if no other match)
    if (
      element.classList.contains("styles--2-TzV") &&
      element.querySelector('[role="radio"], input[type="radio"]')
    ) {
      return "radio";
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

    // Check for asterisk in label or aria-labelledby element
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

    // Check for Workable-specific required indicators
    const hasWorkableRequired =
      element.parentElement?.querySelector('[class*="33eUF"]') ||
      element.closest("div")?.querySelector('[class*="33eUF"]');

    if (hasWorkableRequired) {
      return true;
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

    // Check parent elements for required indicator
    let parent = element.parentElement;
    for (let i = 0; i < 3 && parent; i++) {
      // Only check up to 3 levels
      if (
        parent.querySelector('.required, .mandatory, [class*="required"]') ||
        parent.querySelector('[class*="33eUF"]') // Workable-specific class for required indicators
      ) {
        return true;
      }
      parent = parent.parentElement;
    }

    return false;
  }

  /**
   * Get an appropriate answer from AI for a form field
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
      console.log(this.jobDescription);

      const answer = await this.aiService.getAnswer(question, options, {
        platform: "workable",
        userData: this.userData,
        jobDescription: this.jobDescription,
        fieldType,
        fieldContext,
      });

      this.answerCache.set(cacheKey, answer);
      return answer;
    } catch (error) {
      this.logger(`Error getting AI answer: ${error.message}`);
      return null;
    }
  }

  /**
   * Convert AI response to boolean value with flexible interpretation
   */
  parseAIBoolean(value) {
    if (!value) return false;

    const normalizedValue = String(value).toLowerCase().trim();

    // Positive responses
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

    // Negative responses
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

    // If unclear, return null to indicate we should skip this field
    return null;
  }

  /**
   * Find best matching option using fuzzy matching
   */
  findBestMatchingOption(aiValue, options) {
    if (!aiValue || !options || options.length === 0) return null;

    const normalizedAIValue = String(aiValue).toLowerCase().trim();

    // First try exact match
    for (const option of options) {
      if (option.toLowerCase().trim() === normalizedAIValue) {
        return option;
      }
    }

    // Then try substring matches
    for (const option of options) {
      const normalizedOption = option.toLowerCase().trim();
      if (
        normalizedOption.includes(normalizedAIValue) ||
        normalizedAIValue.includes(normalizedOption)
      ) {
        return option;
      }
    }

    // Try word-based matching
    const aiWords = normalizedAIValue.split(/\s+/);
    let bestMatch = null;
    let bestScore = 0;

    for (const option of options) {
      const optionWords = option.toLowerCase().trim().split(/\s+/);
      let matchingWords = 0;

      for (const aiWord of aiWords) {
        if (
          optionWords.some(
            (optionWord) =>
              optionWord.includes(aiWord) || aiWord.includes(optionWord)
          )
        ) {
          matchingWords++;
        }
      }

      const score =
        matchingWords / Math.max(aiWords.length, optionWords.length);
      if (score > bestScore && score > 0.5) {
        // Require at least 50% word match
        bestScore = score;
        bestMatch = option;
      }
    }

    return bestMatch;
  }

  /**
   * Fill a form field with the appropriate value - PURE AI VERSION
   */
  async fillField(element, value) {
    try {
      if (!element || value === undefined || value === null) {
        return false;
      }

      const fieldType = this.getFieldType(element);
      this.logger(`Filling ${fieldType} field with AI value: ${value}`);

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

        case "checkbox":
          return await this.fillCheckboxField(element, value);

        case "radio":
          return await this.fillRadioField(element, value);

        case "date":
          return await this.fillDateField(element, value);

        case "file":
          // File uploads handled separately
          return false;

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
   * Fill a checkbox field - PURE AI VERSION (no assumptions)
   */
  async fillCheckboxField(element, value) {
    try {
      // Parse AI response to boolean, return false if unclear
      const shouldCheck = this.parseAIBoolean(value);
      if (shouldCheck === null) {
        this.logger(
          `AI response "${value}" is unclear for checkbox - skipping field`
        );
        return false;
      }

      // Find the actual checkbox input if we were given a container
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
        }

        if (!checkboxInput) {
          return false;
        }
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
   * Fill a radio button field - PURE AI VERSION (no assumptions or defaults)
   */
  async fillRadioField(element, value) {
    try {
      if (!value) {
        this.logger("No AI value provided for radio field - skipping");
        return false;
      }

      const aiValue = String(value).toLowerCase().trim();
      this.logger(
        `Looking for radio option matching AI response: "${aiValue}"`
      );

      // Handle Workable's fieldset radio groups
      if (
        element.getAttribute("role") === "radiogroup" ||
        (element.tagName === "FIELDSET" &&
          element.getAttribute("role") === "radiogroup")
      ) {
        const radioOptions = element.querySelectorAll('div[role="radio"]');
        if (!radioOptions.length) {
          this.logger("No radio options found");
          return false;
        }

        // Get all available options for fuzzy matching
        const availableOptions = [];
        const optionMap = new Map();

        for (const radio of radioOptions) {
          const labelSpan = radio.querySelector('span[id*="radio_label"]');
          if (labelSpan) {
            const labelText = labelSpan.textContent.trim();
            availableOptions.push(labelText);
            optionMap.set(labelText, radio);
          }
        }

        // Use fuzzy matching to find best option
        const bestMatch = this.findBestMatchingOption(
          aiValue,
          availableOptions
        );
        if (!bestMatch) {
          this.logger(
            `No matching radio option found for "${aiValue}" among options: ${availableOptions.join(
              ", "
            )}`
          );
          return false;
        }

        const targetRadio = optionMap.get(bestMatch);
        if (targetRadio) {
          this.logger(`Found matching radio option: "${bestMatch}"`);
          this.scrollToElement(targetRadio);
          await this.wait(300);

          targetRadio.click();
          await this.wait(400);

          const success = targetRadio.getAttribute("aria-checked") === "true";
          this.logger(`Radio selection ${success ? "successful" : "failed"}`);
          return success;
        }
      }

      // Handle generic radio groups
      else if (
        element.getAttribute("role") === "radiogroup" ||
        (element.tagName === "FIELDSET" &&
          element.getAttribute("role") === "radiogroup")
      ) {
        const radios = element.querySelectorAll('[role="radio"]');
        if (!radios.length) return false;

        const availableOptions = [];
        const optionMap = new Map();

        for (const radio of radios) {
          const labelSpan = radio.querySelector('span[id*="radio_label"]');
          if (labelSpan) {
            const labelText = labelSpan.textContent.trim();
            availableOptions.push(labelText);
            optionMap.set(labelText, radio);
          }
        }

        const bestMatch = this.findBestMatchingOption(
          aiValue,
          availableOptions
        );
        if (!bestMatch) {
          this.logger(
            `No matching radio option found for "${aiValue}" among options: ${availableOptions.join(
              ", "
            )}`
          );
          return false;
        }

        const matchingRadio = optionMap.get(bestMatch);
        if (matchingRadio) {
          this.scrollToElement(matchingRadio);

          if (matchingRadio.getAttribute("aria-checked") !== "true") {
            matchingRadio.click();
            await this.wait(300);
          }
          return true;
        }
      }

      // Handle individual radio buttons
      else if (element.getAttribute("role") === "radio") {
        const radioGroup =
          element.closest('[role="radiogroup"]') || element.parentElement;
        if (!radioGroup) return false;

        const radios = radioGroup.querySelectorAll('[role="radio"]');
        const availableOptions = [];
        const optionMap = new Map();

        for (const radio of radios) {
          let radioLabel = "";

          const labelledById = radio.getAttribute("aria-labelledby");
          if (labelledById) {
            const labelEl = document.getElementById(labelledById);
            if (labelEl) {
              radioLabel = labelEl.textContent.trim();
            }
          }

          if (!radioLabel) {
            const labelSpan = radio.querySelector('span[id*="radio_label"]');
            if (labelSpan) {
              radioLabel = labelSpan.textContent.trim();
            }
          }

          if (radioLabel) {
            availableOptions.push(radioLabel);
            optionMap.set(radioLabel, radio);
          }
        }

        const bestMatch = this.findBestMatchingOption(
          aiValue,
          availableOptions
        );
        if (!bestMatch) {
          this.logger(
            `No matching radio option found for "${aiValue}" among options: ${availableOptions.join(
              ", "
            )}`
          );
          return false;
        }

        const matchingRadio = optionMap.get(bestMatch);
        if (matchingRadio) {
          this.scrollToElement(matchingRadio);
          matchingRadio.click();
          await this.wait(200);
          return true;
        }
      }

      // Handle standard radio buttons
      else {
        let radioName = "";

        if (
          element.tagName.toLowerCase() === "input" &&
          element.type === "radio"
        ) {
          radioName = element.name;
        } else {
          const radioInput = element.querySelector('input[type="radio"]');
          if (radioInput) {
            radioName = radioInput.name;
          }
        }

        if (!radioName) return false;

        const radios = document.querySelectorAll(
          `input[type="radio"][name="${radioName}"]`
        );

        const availableOptions = [];
        const optionMap = new Map();

        for (const radio of radios) {
          // Check value attribute first
          if (radio.value) {
            availableOptions.push(radio.value);
            optionMap.set(radio.value, radio);
          }

          // Check label text
          const label =
            radio.closest("label") ||
            document.querySelector(`label[for="${radio.id}"]`);
          if (label) {
            const labelText = label.textContent.trim();
            if (labelText && !availableOptions.includes(labelText)) {
              availableOptions.push(labelText);
              optionMap.set(labelText, radio);
            }
          }
        }

        const bestMatch = this.findBestMatchingOption(
          aiValue,
          availableOptions
        );
        if (!bestMatch) {
          this.logger(
            `No matching radio option found for "${aiValue}" among options: ${availableOptions.join(
              ", "
            )}`
          );
          return false;
        }

        const matchingRadio = optionMap.get(bestMatch);
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

          await this.wait(200);

          if (!matchingRadio.checked) {
            matchingRadio.checked = true;
            matchingRadio.dispatchEvent(new Event("change", { bubbles: true }));
          }

          return true;
        }
      }

      this.logger(`Unable to fill radio field - no matching option found`);
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

      const isDateInput =
        element.getAttribute("inputmode") === "tel" &&
        (element.placeholder?.includes("MM/YYYY") ||
          element.placeholder?.includes("MM/DD/YYYY"));

      if (isDateInput || element.closest(".react-datepicker-wrapper")) {
        this.scrollToElement(element);
        element.focus();
        await this.wait(100);

        element.value = "";
        element.dispatchEvent(new Event("input", { bubbles: true }));
        await this.wait(50);

        let formattedDate = value;
        if (element.placeholder?.includes("MM/YYYY")) {
          let dateObj;
          try {
            dateObj = new Date(value);
            if (isNaN(dateObj.getTime())) {
              const parts = value.split(/[\s\/\-\.]/);
              if (parts.length >= 2) {
                let month = parseInt(parts[0]);
                let year = parseInt(parts[1]);

                if (year < 100) {
                  year += year < 50 ? 2000 : 1900;
                }

                formattedDate = `${month.toString().padStart(2, "0")}/${year}`;
              }
            } else {
              const month = dateObj.getMonth() + 1;
              const year = dateObj.getFullYear();
              formattedDate = `${month.toString().padStart(2, "0")}/${year}`;
            }
          } catch (e) {
            // Keep original value if parsing fails
          }
        } else if (element.placeholder?.includes("MM/DD/YYYY")) {
          try {
            const dateObj = new Date(value);
            if (!isNaN(dateObj.getTime())) {
              const month = dateObj.getMonth() + 1;
              const day = dateObj.getDate();
              const year = dateObj.getFullYear();
              formattedDate = `${month.toString().padStart(2, "0")}/${day
                .toString()
                .padStart(2, "0")}/${year}`;
            }
          } catch (e) {
            // Keep original value if parsing fails
          }
        }

        element.value = formattedDate;
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
   * Handle required checkbox fields - PURE AI VERSION (no hard-coded assumptions)
   */
  async handleRequiredCheckboxes(form) {
    try {
      this.logger("Handling checkboxes with AI guidance (no assumptions)");

      const checkboxFields = [];

      // Find standard checkboxes
      const standardCheckboxes = form.querySelectorAll(
        'input[type="checkbox"]'
      );
      for (const checkbox of standardCheckboxes) {
        if (!this.isElementVisible(checkbox)) continue;

        const label = this.getFieldLabel(checkbox);
        const isRequired = this.isFieldRequired(checkbox);

        if (label) {
          // Process all checkboxes with labels, let AI decide
          checkboxFields.push({
            element: checkbox,
            label,
            isRequired,
          });
        }
      }

      // Find Workable custom checkboxes
      const customCheckboxes = form.querySelectorAll('[role="checkbox"]');
      for (const checkbox of customCheckboxes) {
        if (!this.isElementVisible(checkbox)) continue;

        const label = this.getFieldLabel(checkbox);
        const isRequired = this.isFieldRequired(checkbox);

        if (label) {
          // Process all checkboxes with labels, let AI decide
          checkboxFields.push({
            element: checkbox,
            label,
            isRequired,
          });
        }
      }

      this.logger(`Found ${checkboxFields.length} checkboxes to process`);

      // Process each checkbox with AI guidance
      for (const field of checkboxFields) {
        try {
          // Build context for AI decision
          const fieldContext = [
            `This is a checkbox field`,
            field.isRequired
              ? "This checkbox is required"
              : "This checkbox is optional",
            "Please decide whether to check this checkbox based on the user profile and the checkbox label/purpose",
          ].join(". ");

          // Get AI answer for this checkbox
          const answer = await this.getAIAnswer(
            field.label,
            ["yes", "no"],
            "checkbox",
            fieldContext
          );

          if (answer !== null && answer !== undefined && answer !== "") {
            const shouldCheck = this.parseAIBoolean(answer);

            if (shouldCheck !== null) {
              this.logger(
                `AI decision for checkbox "${field.label}": ${
                  shouldCheck ? "CHECK" : "UNCHECK"
                }`
              );
              await this.fillCheckboxField(field.element, shouldCheck);
              await this.wait(200);
            } else {
              this.logger(
                `AI response unclear for checkbox "${field.label}" - skipping`
              );
            }
          } else {
            this.logger(
              `No AI answer for checkbox "${field.label}" - skipping`
            );
          }
        } catch (fieldError) {
          this.logger(
            `Error processing checkbox "${field.label}": ${fieldError.message}`
          );
        }
      }
    } catch (error) {
      this.logger(`Error handling checkboxes: ${error.message}`);
    }
  }

  /**
   * Fill a form with profile data using AI-generated answers - PURE AI VERSION
   */
  async fillFormWithProfile(form, profile, jobDescription) {
    try {
      this.logger(
        "Filling form with pure AI-generated answers (no assumptions)"
      );

      this.userData = profile;
      this.jobDescription = jobDescription;
      const formFields = this.getAllFormFields(form);
      this.logger(`Found ${formFields.length} form fields`);

      let filledCount = 0;
      let skippedCount = 0;

      for (const field of formFields) {
        if (!field.label) {
          this.logger(`Skipping field without label`);
          continue;
        }

        if (field.type === "file") {
          this.logger(`Skipping file upload field: ${field.label}`);
          continue;
        }

        try {
          this.logger(`Processing field: ${field.label} (${field.type})`);

          // Get available options for select/radio fields
          const options =
            field.type === "select" ||
            field.type === "radio" ||
            field.type === "checkbox"
              ? this.getFieldOptions(field.element, form)
              : [];

          // Build comprehensive context for AI
          const fieldContext = [
            `Field type: ${field.type}`,
            field.required
              ? "This field is required"
              : "This field is optional",
            options.length > 0
              ? `Available options: ${options.join(", ")}`
              : "",
            "Please provide your response based solely on the user profile data provided.",
          ]
            .filter(Boolean)
            .join(". ");

          // Get AI answer with full context
          const answer = await this.getAIAnswer(
            field.label,
            options,
            field.type,
            fieldContext
          );

          if (answer !== null && answer !== undefined && answer !== "") {
            this.logger(
              `AI answer for "${field.label}": ${String(answer).substring(
                0,
                50
              )}${String(answer).length > 50 ? "..." : ""}`
            );

            const success = await this.fillField(field.element, answer);
            if (success) {
              filledCount++;
              this.logger(`✓ Successfully filled field: ${field.label}`);
            } else {
              this.logger(`✗ Failed to fill field: ${field.label}`);
              skippedCount++;
            }
          } else {
            this.logger(
              `✗ AI provided no answer for field: ${field.label} - skipping`
            );
            skippedCount++;
          }

          await this.wait(300);
        } catch (fieldError) {
          this.logger(
            `Error processing field "${field.label}": ${fieldError.message}`
          );
          skippedCount++;
        }
      }

      // Handle checkboxes with AI guidance
      await this.handleRequiredCheckboxes(form);

      this.logger(
        `Form filling complete: ${filledCount} filled, ${skippedCount} skipped`
      );
      return filledCount > 0;
    } catch (error) {
      this.logger(`Error filling form with AI answers: ${error.message}`);
      return false;
    }
  }

  /**
   * Get available options from select fields including custom Workable dropdowns
   */
  getFieldOptions(element, form) {
    try {
      const options = [];
      const fieldType = this.getFieldType(element);

      if (fieldType === "select") {
        const listbox = form.querySelector('ul[role="listbox"]');
        console.log("listbox:", listbox);

        if (listbox) {
          const optionItems = listbox.querySelectorAll('li[role="option"]');
          console.log("optionItems count:", optionItems.length);
          optionItems.forEach((item) => {
            const targetSpan = item.querySelector("span.styles--f-uLT");
            console.log("targetSpan:", targetSpan);
            if (targetSpan) {
              options.push(targetSpan.textContent.trim());
            }
          });
        }
      } else if (fieldType === "radio") {
        const radios =
          element.tagName === "FIELDSET"
            ? element.querySelectorAll('[role="radio"]')
            : element
                .closest('fieldset[role="radiogroup"]')
                ?.querySelectorAll('[role="radio"]') || [element];

        radios.forEach((radio) => {
          const radioId = radio.id;
          const labelSpan =
            radio.parentElement.querySelector(
              `span[id="radio_label_${radioId.split("_").pop()}"]`
            ) ||
            document.querySelector(
              `span[id="radio_label_${radioId.split("_").pop()}"]`
            );
          const label = labelSpan
            ? labelSpan.textContent.trim()
            : this.getFieldLabel(radio);
          if (label) options.push(label);
        });
      } else if (fieldType === "checkbox") {
        if (element.getAttribute("role") === "group") {
          const checkboxes = element.querySelectorAll('[role="checkbox"]');

          checkboxes.forEach((checkbox) => {
            const checkboxId = checkbox.id;
            const labelSpan = element.querySelector(
              `span[id="checkbox_label_${checkboxId}"]`
            );

            if (labelSpan && labelSpan.textContent) {
              options.push(labelSpan.textContent.trim());
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
   * Check if an element is visible on the page
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

  /**
   * Scroll an element into view
   */
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
        // Silent fail if scrolling fails
      }
    }
  }

  /**
   * Wait for a specified amount of time
   */
  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
