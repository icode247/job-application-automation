// platforms/workable/workable-form-handler.js - FIXED VERSION
import { AIService } from "../../services/index.js";
//submitForm
export default class WorkableFormHandler {
  constructor(options = {}) {
    this.logger = options.logger || console.log;
    this.host = options.host || "http://localhost:3000";
    this.userData = options.userData || {};
    this.jobDescription = options.jobDescription || "";
    this.aiService = new AIService({ apiHost: this.host });
    this.answerCache = new Map();

    // FIXED: Add form state tracking to prevent duplicates
    this.processedForms = new Set();
    this.fillInProgress = false;
    this.lastFillTime = 0;
  }

  /**
   * Enhanced phone field handling
   */
  async fillPhoneField(element, value) {
    try {
      // Look for the international telephone input field
      const phoneInput =
        element.querySelector("input.iti__tel-input") ||
        element.querySelector('input[type="tel"]') ||
        element;

      if (!phoneInput) {
        this.logger("No phone input found");
        return false;
      }

      this.scrollToElement(phoneInput);
      phoneInput.focus();
      await this.wait(200);

      // Use native setter for phone inputs
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;

      // Clean the phone number (remove any formatting)
      let cleanPhone = String(value).replace(/\D/g, "");

      // If it starts with country code, keep it as is
      // If it doesn't, it might be a local number
      if (cleanPhone.length > 10) {
        // Likely includes country code
        cleanPhone = cleanPhone;
      } else {
        // Local number, don't add country code as ITI will handle it
        cleanPhone = cleanPhone;
      }

      // Clear and set new value
      nativeInputValueSetter.call(phoneInput, "");
      phoneInput.dispatchEvent(new Event("input", { bubbles: true }));
      await this.wait(50);

      nativeInputValueSetter.call(phoneInput, cleanPhone);
      phoneInput.dispatchEvent(new Event("input", { bubbles: true }));
      phoneInput.dispatchEvent(new Event("change", { bubbles: true }));
      phoneInput.dispatchEvent(new Event("blur", { bubbles: true }));

      await this.wait(300);

      this.logger(`✅ Phone number set: ${cleanPhone}`);
      return true;
    } catch (error) {
      this.logger(`Error filling phone field: ${error.message}`);
      return false;
    }
  }

  /**
   * Find the submit button in a form
   */
  findSubmitButton(form) {
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      "button.submit-button",
      "button.submit",
      "button.apply-button",
      "button.apply",
      "button.btn-primary:last-child",
      "button.button--primary:last-child",
      'button[data-ui="submit-application"]',
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

    const visibleButtons = Array.from(form.querySelectorAll("button")).filter(
      (btn) => this.isElementVisible(btn) && !btn.disabled
    );

    if (visibleButtons.length) {
      return visibleButtons[visibleButtons.length - 1];
    }

    return null;
  }

  /**
   * Submit the form
   */
  async submitForm(form, options = {}) {
    const { dryRun = false } = options;

    try {
      this.logger("Submitting form...");

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
        this.logger("Submit button is not clickable (hidden or disabled)");
        return false;
      }

      this.scrollToElement(submitButton);
      await this.wait(500);

      if (dryRun) {
        this.logger("DRY RUN: Would have clicked submit button");
        return true;
      }

      submitButton.click();
      this.logger("Clicked submit button");

      return true;
    } catch (error) {
      this.logger(`Error submitting form: ${error.message}`);
      return false;
    }
  }
  /**
   * Handle custom select fields that use modals
   */
  async handleCustomSelectWithModal(form, profile) {
    try {
      // Find custom selects
      const customSelects = form.querySelectorAll(
        'input[role="combobox"][aria-owns]'
      );

      for (const element of customSelects) {
        // Get listbox ID
        const listboxId = element.getAttribute("aria-owns");
        if (!listboxId) {
          this.logger(`No listbox ID found for element ${element.id}`);
          continue;
        }

        // Get question text
        const labelId = element.getAttribute("aria-labelledby");
        const labelElement = labelId ? document.getElementById(labelId) : null;
        const question = labelElement
          ? labelElement.textContent.trim()
          : "Select an option";

        // Click to open modal
        element.click();
        await this.wait(500);

        // Find listbox
        const listbox = document.getElementById(listboxId);
        if (!listbox) {
          this.logger(`No listbox found for ${listboxId}`);
          continue;
        }

        // Extract options
        const options = [];
        const optionElements = listbox.querySelectorAll('[role="option"]');
        optionElements.forEach((opt) => {
          const span = opt.querySelector("span.styles--f-uLT");
          if (span) options.push(span.textContent.trim());
        });

        // Close modal
        element.click();
        await this.wait(300);

        // Skip if no options
        if (options.length === 0) {
          this.logger(`No options found for listbox ${listboxId}`);
          continue;
        }

        // Request AI to choose best option
        let valueToSelect = "N/A - Does not apply to me";
        try {
          const response = await fetch(`${HOST}/api/ai-answer`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              question,
              options,
              userData: profile,
              description: "",
            }),
          });

          if (!response.ok) {
            throw new Error(`AI service error: ${response.status}`);
          }

          const data = await response.json();
          valueToSelect = data.answer;
        } catch (aiError) {
          this.logger(
            `AI selection failed for ${question}: ${aiError.message}`
          );
        }

        // Reopen modal and select option
        element.click();
        await this.wait(500);

        const updatedListbox = document.getElementById(listboxId);
        if (updatedListbox) {
          const valueStr = String(valueToSelect).toLowerCase();
          const optionsToSelect =
            updatedListbox.querySelectorAll('[role="option"]');

          let optionSelected = false;
          for (const option of optionsToSelect) {
            const span = option.querySelector("span.styles--f-uLT");
            if (span) {
              const optionText = span.textContent.toLowerCase();
              if (
                optionText === valueStr ||
                optionText.includes(valueStr) ||
                valueStr.includes(optionText)
              ) {
                option.click();
                await this.wait(300);
                optionSelected = true;
                break;
              }
            }
          }

          // Select first option as fallback
          if (!optionSelected && optionsToSelect.length > 0) {
            optionsToSelect[0].click();
            await this.wait(300);
            this.logger(
              `No matching option for "${valueToSelect}", selected first option`
            );
          }
        }
      }
    } catch (error) {
      this.logger(`Error handling custom select with modal: ${error.message}`);
    }
  }

  /**
   * Handle standard radio buttons (fallback)
   */
  async handleStandardRadioButtons(element, aiValue) {
    try {
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

      const bestMatch = this.findBestMatchingOption(aiValue, availableOptions);
      if (!bestMatch) {
        this.logger(`No matching standard radio option found for "${aiValue}"`);
        return false;
      }

      const matchingRadio = optionMap.get(bestMatch);
      if (matchingRadio) {
        this.scrollToElement(matchingRadio);

        // Multiple selection strategies
        matchingRadio.checked = true;

        const label =
          matchingRadio.closest("label") ||
          document.querySelector(`label[for="${matchingRadio.id}"]`);
        if (label) {
          label.click();
        } else {
          matchingRadio.click();
        }

        matchingRadio.dispatchEvent(new Event("change", { bubbles: true }));
        matchingRadio.dispatchEvent(new Event("click", { bubbles: true }));

        await this.wait(200);

        if (!matchingRadio.checked) {
          matchingRadio.checked = true;
          matchingRadio.setAttribute("checked", "checked");
        }

        return true;
      }

      return false;
    } catch (error) {
      this.logger(`Error handling standard radio buttons: ${error.message}`);
      return false;
    }
  }

  /**
   * Select a Workable radio option using multiple strategies
   */
  async selectWorkableRadioOption(optionInfo) {
    try {
      const { element, labelText, inputElement, isChecked } = optionInfo;

      // Skip if already selected
      if (isChecked) {
        this.logger(`Option "${labelText}" is already selected`);
        return true;
      }

      this.scrollToElement(element);
      await this.wait(300);

      let success = false;
      const strategies = [];

      // Strategy 1: Click the main div element with role="radio"
      strategies.push(async () => {
        this.logger(
          `Strategy 1: Clicking div[role="radio"] for "${labelText}"`
        );
        element.click();
        await this.wait(300);
        return element.getAttribute("aria-checked") === "true";
      });

      // Strategy 2: Click the label if it exists
      strategies.push(async () => {
        const label =
          element.querySelector("label") || element.closest("label");
        if (label) {
          this.logger(`Strategy 2: Clicking label for "${labelText}"`);
          label.click();
          await this.wait(300);
          return (
            element.getAttribute("aria-checked") === "true" ||
            (inputElement && inputElement.checked)
          );
        }
        return false;
      });

      // Strategy 3: Click the input element directly
      strategies.push(async () => {
        if (inputElement) {
          this.logger(`Strategy 3: Clicking input element for "${labelText}"`);
          inputElement.click();
          await this.wait(300);
          return (
            inputElement.checked ||
            element.getAttribute("aria-checked") === "true"
          );
        }
        return false;
      });

      // Strategy 4: Force the selection by setting attributes and dispatching events
      strategies.push(async () => {
        this.logger(`Strategy 4: Force selection for "${labelText}"`);

        // Set aria-checked on the div
        element.setAttribute("aria-checked", "true");
        element.setAttribute("tabindex", "0");

        // Uncheck other options in the same group
        const radioGroup = element.closest('[role="radiogroup"]');
        if (radioGroup) {
          const otherOptions = radioGroup.querySelectorAll('[role="radio"]');
          otherOptions.forEach((option) => {
            if (option !== element) {
              option.setAttribute("aria-checked", "false");
              option.setAttribute("tabindex", "-1");
            }
          });
        }

        // Set input checked if it exists
        if (inputElement) {
          inputElement.checked = true;
          inputElement.setAttribute("checked", "checked");
          inputElement.dispatchEvent(new Event("change", { bubbles: true }));
        }

        // Dispatch events on the main element
        element.dispatchEvent(new Event("click", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));

        await this.wait(300);
        return true; // Assume success since we forced it
      });

      // Try each strategy until one works
      for (let i = 0; i < strategies.length; i++) {
        try {
          success = await strategies[i]();
          if (success) {
            this.logger(`✅ Strategy ${i + 1} successful for "${labelText}"`);
            break;
          }
        } catch (e) {
          this.logger(`Strategy ${i + 1} failed: ${e.message}`);
        }
      }

      if (!success) {
        this.logger(`❌ All strategies failed for "${labelText}"`);
      }

      return success;
    } catch (error) {
      this.logger(`Error selecting radio option: ${error.message}`);
      return false;
    }
  }

  /**
   * Extract information from a radio option element
   */
  extractRadioOptionInfo(radioElement) {
    let labelText = "";
    let value = "";
    let inputElement = null;

    try {
      // Method 1: Look for span with radio_label_ ID pattern
      const labelSpan = radioElement.querySelector('span[id*="radio_label"]');
      if (labelSpan) {
        labelText = labelSpan.textContent.trim();
      }

      // Method 2: Look for aria-labelledby reference
      if (!labelText) {
        const labelledById = radioElement.getAttribute("aria-labelledby");
        if (labelledById) {
          // Extract just the radio_label part if it exists
          const radioLabelId = labelledById
            .split(" ")
            .find((id) => id.includes("radio_label"));
          if (radioLabelId) {
            const labelEl = document.getElementById(radioLabelId);
            if (labelEl) {
              labelText = labelEl.textContent.trim();
            }
          }
        }
      }

      // Method 3: Look for text content in spans (for YES/NO style)
      if (!labelText) {
        const textSpans = radioElement.querySelectorAll(
          "span.styles--1h-sV, span"
        );
        for (const span of textSpans) {
          const text = span.textContent.trim();
          if (text && text !== " " && !text.includes("SVG")) {
            labelText = text;
            break;
          }
        }
      }

      // Method 4: Check if this is a label container (older structure)
      if (!labelText && radioElement.tagName === "LABEL") {
        const clone = radioElement.cloneNode(true);
        // Remove input and SVG elements to get just the text
        const elementsToRemove = clone.querySelectorAll(
          'input, svg, [aria-hidden="true"]'
        );
        elementsToRemove.forEach((el) => el.remove());
        labelText = clone.textContent.trim();
      }

      // Find the actual input element
      inputElement = radioElement.querySelector('input[type="radio"]');
      if (inputElement) {
        value = inputElement.value || "";
      }

      // Special handling for YES/NO responses
      if (labelText.toLowerCase() === "yes") {
        value = value || "true";
      } else if (labelText.toLowerCase() === "no") {
        value = value || "false";
      }

      return {
        labelText,
        value,
        inputElement,
        isChecked:
          radioElement.getAttribute("aria-checked") === "true" ||
          (inputElement && inputElement.checked),
      };
    } catch (error) {
      this.logger(`Error extracting radio option info: ${error.message}`);
      return { labelText: "", value: "", inputElement: null, isChecked: false };
    }
  }

  async handleWorkableRadioGroup(radioGroup, aiValue) {
    try {
      // Method 1: Look for div elements with role="radio" (newer Workable structure)
      let radioOptions = radioGroup.querySelectorAll('div[role="radio"]');

      // Method 2: Look for div elements with data-ui="option" (Yes/No style)
      if (radioOptions.length === 0) {
        radioOptions = radioGroup.querySelectorAll(
          'div[data-ui="option"][role="radio"]'
        );
      }

      // Method 3: Look for label containers (older Workable structure)
      if (radioOptions.length === 0) {
        radioOptions = radioGroup.querySelectorAll(
          'label[role="presentation"]'
        );
      }

      if (radioOptions.length === 0) {
        this.logger("No radio options found in group");
        return false;
      }

      this.logger(`Found ${radioOptions.length} radio options to check`);

      // Extract options and build mapping
      const availableOptions = [];
      const optionMap = new Map();

      for (const radio of radioOptions) {
        const optionInfo = this.extractRadioOptionInfo(radio);
        if (optionInfo.labelText) {
          availableOptions.push(optionInfo.labelText);
          optionMap.set(optionInfo.labelText, {
            element: radio,
            ...optionInfo,
          });

          this.logger(
            `Found option: "${optionInfo.labelText}" (value: ${optionInfo.value})`
          );
        }
      }

      if (availableOptions.length === 0) {
        this.logger("No valid options found with labels");
        return false;
      }

      // Use fuzzy matching to find best option
      const bestMatch = this.findBestMatchingOption(aiValue, availableOptions);
      if (!bestMatch) {
        this.logger(
          `No matching radio option found for "${aiValue}" among options: ${availableOptions.join(
            ", "
          )}`
        );
        return false;
      }

      const targetOption = optionMap.get(bestMatch);
      if (targetOption) {
        this.logger(`Found matching radio option: "${bestMatch}"`);
        return await this.selectWorkableRadioOption(targetOption);
      }

      return false;
    } catch (error) {
      this.logger(`Error handling Workable radio group: ${error.message}`);
      return false;
    }
  }

  /**
   * Get all form fields from a Workable application form
   */
  getAllFormFields(form) {
    try {
      this.logger("Finding all form fields in Workable form");

      const fields = [];

      // Workable-specific selectors with enhanced coverage
      const formElements = form.querySelectorAll(
        'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), ' +
          "select, textarea, " +
          '[role="radio"], [role="checkbox"], [role="combobox"], ' +
          'fieldset[role="radiogroup"], ' +
          'div[role="group"], ' +
          '[data-ui="select"], ' +
          '[data-role="dropzone"], ' +
          "div.field-type-Boolean, " +
          ".styles--3aPac input, " +
          ".styles--3aPac select, " +
          ".styles--3aPac textarea, " +
          'div[class*="styles--3IYUq"], ' +
          'div[class*="styles--2-TzV"]'
      );

      this.logger(`Found ${formElements.length} form elements`);

      // Process each element with enhanced validation
      for (const element of formElements) {
        // Skip invisible elements
        if (!this.isElementInteractable(element)) continue;

        const fieldInfo = {
          element,
          label: this.getFieldLabel(element),
          type: this.getFieldType(element),
          required: this.isFieldRequired(element),
        };

        // For radio groups, get the full fieldset when possible
        if (fieldInfo.type === "radio" && element.tagName !== "FIELDSET") {
          const radioGroup =
            element.closest('fieldset[role="radiogroup"]') ||
            element.closest('[role="radiogroup"]');
          if (radioGroup) {
            fieldInfo.element = radioGroup;
          }
        }

        // Only include fields with valid labels and types
        if (fieldInfo.label && fieldInfo.type !== "unknown") {
          fields.push(fieldInfo);
        }
      }

      // Deduplicate fields - particularly important for radio groups
      const uniqueFields = this.deduplicateFields(fields);

      this.logger(`Processed ${uniqueFields.length} unique form fields`);
      return uniqueFields;
    } catch (error) {
      this.logger(`Error getting form fields: ${error.message}`);
      return [];
    }
  }

  /**
   * Enhanced field deduplication
   */
  deduplicateFields(fields) {
    const uniqueFields = [];
    const seenElements = new Set();
    const seenLabels = new Map();

    for (const field of fields) {
      // Skip if we've already processed this exact element
      if (seenElements.has(field.element)) {
        continue;
      }

      // For radio fields, only add one per label (fieldset)
      if (field.type === "radio") {
        const existingRadio = seenLabels.get(field.label);
        if (existingRadio === "radio") {
          continue; // Skip duplicate radio group
        }
        seenLabels.set(field.label, "radio");
      } else {
        // For other fields, ensure unique labels within type
        const labelKey = `${field.label}-${field.type}`;
        if (seenLabels.has(labelKey)) {
          continue;
        }
        seenLabels.set(labelKey, field.type);
      }

      seenElements.add(field.element);
      uniqueFields.push(field);
    }

    return uniqueFields;
  }

  /**
   * Enhanced element interactability check
   */
  isElementInteractable(element) {
    if (!element) return false;

    // Check if element is visible and enabled
    const style = window.getComputedStyle(element);
    const isVisible =
      style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0";

    const isEnabled =
      !element.disabled &&
      !element.hasAttribute("disabled") &&
      !element.getAttribute("aria-disabled");

    const isInDOM = document.contains(element);

    return isVisible && isEnabled && isInDOM;
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
   * Update the main getFieldType method to detect phone fields
   */
  getFieldType(element) {
    const role = element.getAttribute("role");
    const tagName = element.tagName.toLowerCase();

    // Phone field detection
    if (
      element.closest('[data-ui="phone"]') ||
      element.querySelector("input.iti__tel-input") ||
      (element.tagName === "INPUT" && element.type === "tel")
    ) {
      return "phone";
    }

    // Enhanced Workable-specific detection
    if (
      element.closest('[data-ui="select"]') ||
      (role === "combobox" && !element.closest('[data-ui="phone"]'))
    ) {
      return "select";
    }

    // Radio groups - enhanced detection
    if (
      role === "radiogroup" ||
      (tagName === "fieldset" && role === "radiogroup") ||
      element.querySelector('[role="radio"]') ||
      element.querySelector('div[data-ui="option"][role="radio"]')
    ) {
      return "radio";
    }

    // Rest of the existing logic...
    if (
      role === "group" &&
      element.querySelector('[role="checkbox"], input[type="checkbox"]')
    ) {
      return "checkbox";
    }

    if (role === "radio" || role === "checkbox") {
      return role;
    }

    if (
      element.getAttribute("data-role") === "dropzone" ||
      element.querySelector('input[type="file"]') ||
      element.closest('[data-role="dropzone"]')
    ) {
      return "file";
    }

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
      if (
        parent.querySelector('.required, .mandatory, [class*="required"]') ||
        parent.querySelector('[class*="33eUF"]')
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
      const cacheKey = `${question}:${options.join(",")}:${fieldType}`;
      if (this.answerCache.has(cacheKey)) {
        const cachedAnswer = this.answerCache.get(cacheKey);
        this.logger(`Using cached answer for "${question}": ${cachedAnswer}`);
        return cachedAnswer;
      }

      this.logger(`Requesting AI answer for "${question}"`);

      const answer = await this.aiService.getAnswer(question, options, {
        platform: "workable",
        userData: this.userData,
        jobDescription: this.jobDescription,
        fieldType,
        fieldContext,
      });

      // Only cache and return valid answers
      if (answer !== null && answer !== undefined && answer !== "") {
        this.answerCache.set(cacheKey, answer);
        return answer;
      } else {
        this.logger(`AI returned empty answer for "${question}"`);

        // Return fallback answer instead of null
        const fallback = this.getFallbackAnswer(fieldType, options);
        this.logger(`Using fallback answer for "${question}": ${fallback}`);
        return fallback;
      }
    } catch (error) {
      this.logger(
        `Error getting AI answer for "${question}": ${error.message}`
      );

      // Return fallback answer instead of null
      const fallback = this.getFallbackAnswer(fieldType, options);
      this.logger(`Using fallback answer for "${question}": ${fallback}`);
      return fallback;
    }
  }

  /**
   * Get fallback answer based on field type
   */
  getFallbackAnswer(fieldType, options) {
    switch (fieldType) {
      case "radio":
      case "checkbox":
        if (options.length > 0) {
          // Look for "prefer not to answer" type options first
          const preferNotTo = options.find(
            (opt) =>
              opt.toLowerCase().includes("prefer not") ||
              opt.toLowerCase().includes("not to answer")
          );
          return preferNotTo || options[0];
        }
        return "I prefer not to answer";
      case "select":
        return options.length > 0 ? options[0] : "";
      default:
        return "I prefer not to answer";
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
        bestScore = score;
        bestMatch = option;
      }
    }

    return bestMatch;
  }

  /**
   * Handle phone input with country code
   */
  async handlePhoneInputWithCountryCode(form, profile) {
    try {
      this.logger("Handling phone input with country code");

      // Make sure we have phone data
      if (!profile.phone && !profile.phoneNumber) {
        this.logger("No phone number available in profile");
        return false;
      }

      const phoneNumber = profile.phone || profile.phoneNumber;
      const phoneCountryCode = profile.phoneCountryCode;

      this.logger(
        `Setting phone: ${phoneNumber} with country code: ${
          phoneCountryCode || "default"
        }`
      );

      // Find phone input field
      const phoneInput = form.querySelector(
        'input[name="phone"], input[type="tel"]'
      );
      if (!phoneInput) {
        this.logger("No phone input field found");
        return false;
      }

      // Find country selector dropdown
      const countrySelector = phoneInput.parentElement.querySelector(
        ".iti__selected-flag"
      );
      if (!countrySelector) {
        this.logger("No country selector found, setting direct phone number");
        await this.setPhoneValue(phoneInput, phoneNumber);
        return true;
      }

      await this.wait(300);
      countrySelector.click();
      await this.wait(500);

      // Get dropdown list
      const countryList = document.querySelector(".iti__country-list");
      if (!countryList) {
        this.logger("Country dropdown not found, setting direct phone number");
        await this.setPhoneValue(phoneInput, phoneNumber);
        return true;
      }

      // Get all country items and extract codes
      const countryItems = countryList.querySelectorAll("li.iti__country");
      const countryCodesMap = {};

      for (const item of countryItems) {
        const codeSpan = item.querySelector(".iti__dial-code");
        if (codeSpan) {
          const code = codeSpan.textContent.trim();
          countryCodesMap[code] = item;
        }
      }

      // Find matching country code
      let targetItem = null;
      let selectedCountryCode = null;

      if (phoneCountryCode) {
        // Make sure it has the plus sign
        const formattedCode = phoneCountryCode.startsWith("+")
          ? phoneCountryCode
          : `+${phoneCountryCode}`;

        targetItem = countryCodesMap[formattedCode];
        selectedCountryCode = formattedCode;
      }

      if (targetItem) {
        // Click the matching country code
        this.logger(`Selecting country code: ${selectedCountryCode}`);
        targetItem.click();
        await this.wait(300);

        // Process phone number to remove country code if present
        let phoneNumberWithoutCode = phoneNumber;

        if (
          selectedCountryCode &&
          phoneNumber.startsWith(selectedCountryCode)
        ) {
          phoneNumberWithoutCode = phoneNumber
            .substring(selectedCountryCode.length)
            .trim()
            .replace(/^[\s\-\(\)]+/, "");
        } else if (phoneNumber.startsWith("+")) {
          // Extract and remove any country code
          const genericCodeMatch = phoneNumber.match(/^\+\d{1,4}/);
          if (genericCodeMatch) {
            phoneNumberWithoutCode = phoneNumber
              .substring(genericCodeMatch[0].length)
              .trim()
              .replace(/^[\s\-\(\)]+/, "");
          }
        }

        this.logger(`Setting phone number part: ${phoneNumberWithoutCode}`);
        await this.setPhoneValue(phoneInput, phoneNumberWithoutCode);
      } else {
        // No matching country found, set full phone number
        this.logger(
          "No matching country code found, setting full phone number"
        );
        await this.setPhoneValue(phoneInput, phoneNumber);
      }

      return true;
    } catch (error) {
      this.logger(`Error handling phone field: ${error.message}`);
      return false;
    }
  }

  /**
   * Method for setting phone input values
   */
  async setPhoneValue(input, value) {
    if (!input || value === undefined) return;

    try {
      // Wait briefly
      await this.wait(200);

      // Focus input
      input.focus();
      await this.wait(100);

      // Clear existing value
      input.value = "";
      input.dispatchEvent(new Event("input", { bubbles: true }));
      await this.wait(100);

      // Set new value
      input.value = value;

      // Dispatch events
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.dispatchEvent(new Event("blur", { bubbles: true }));

      // For international phone input
      if (input.classList.contains("iti__tel-input")) {
        setTimeout(() => {
          input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true }));
        }, 100);
      }

      await this.wait(200);

      // Verify value set correctly
      if (input.value !== value) {
        this.logger("Value didn't set correctly, trying alternative method");

        // Direct approach as fallback
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value"
        ).set;

        nativeInputValueSetter.call(input, value);

        // Dispatch synthetic input event
        const event = new Event("input", { bubbles: true });
        input.dispatchEvent(event);

        await this.wait(100);
        this.logger(`Final value: ${input.value}`);
      }
    } catch (error) {
      this.logger(`Error setting phone value: ${error.message}`);
    }
  }

  /**
   * Update the main fillField method to handle phone fields
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
        case "url":
        case "number":
        case "password":
          return await this.fillInputField(element, value);

        // case "phone":
        // case "tel":
        //   return await this.fillPhoneField(element, value);

        case "textarea":
          return await this.fillTextareaField(element, value);

        case "checkbox":
          return false;
        // return await this.fillCheckboxField(element, value);

        case "radio":
          return await this.fillRadioField(element, value);

        case "select":
          return await this.fillSelectField(element, value);

        case "date":
          return await this.fillDateField(element, value);

        case "file":
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
   * FIXED: Fill a text input field using native property setters
   */
  async fillInputField(element, value) {
    try {
      this.scrollToElement(element);
      element.focus();
      await this.wait(200);

      // CRITICAL FIX: Use native property setters like Ashby
      const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        "value"
      ).set;

      // Clear existing value using native setter
      nativeInputValueSetter.call(element, "");
      element.dispatchEvent(
        new Event("input", { bubbles: true, composed: true })
      );
      await this.wait(50);

      // Set new value using native setter
      nativeInputValueSetter.call(element, String(value));

      // Dispatch comprehensive events
      const inputEvent = new Event("input", {
        bubbles: true,
        cancelable: true,
      });
      const changeEvent = new Event("change", {
        bubbles: true,
        cancelable: true,
      });

      element.dispatchEvent(inputEvent);
      await this.wait(50);
      element.dispatchEvent(changeEvent);

      await this.wait(200);

      // Verify the value was set correctly
      if (element.value === String(value)) {
        this.logger(`✅ Input value set successfully: ${value}`);
        return true;
      } else {
        this.logger(
          `⚠️ Input value may not have been set correctly. Current: ${element.value}`
        );

        // Fallback: Try direct assignment
        element.value = String(value);
        element.dispatchEvent(inputEvent);
        element.dispatchEvent(changeEvent);

        return element.value === String(value);
      }
    } catch (error) {
      this.logger(`Error filling input field: ${error.message}`);
      return false;
    }
  }

  /**
   * FIXED: Fill a textarea field using native property setters
   */
  async fillTextareaField(element, value) {
    try {
      const textarea = element.querySelector("textarea") || element;

      this.scrollToElement(textarea);
      textarea.focus();
      await this.wait(100);

      // CRITICAL FIX: Use native textarea setter
      const nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(
        window.HTMLTextAreaElement.prototype,
        "value"
      ).set;

      // Clear existing content
      nativeTextareaValueSetter.call(textarea, "");
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
      await this.wait(50);

      // Set new value
      const cleanedValue = String(value)
        .replace(/\r?\n|\r/g, "\n")
        .trim();
      nativeTextareaValueSetter.call(textarea, cleanedValue);

      // Dispatch events
      const inputEvent = new Event("input", {
        bubbles: true,
        cancelable: true,
      });
      const changeEvent = new Event("change", {
        bubbles: true,
        cancelable: true,
      });

      textarea.dispatchEvent(inputEvent);
      await this.wait(50);
      textarea.dispatchEvent(changeEvent);

      // Verify the value was set
      if (textarea.value === cleanedValue) {
        this.logger(
          `✅ Textarea value set successfully: ${cleanedValue.substring(
            0,
            50
          )}...`
        );
        return true;
      } else {
        this.logger(
          `⚠️ Textarea value may not have been set correctly. Current: ${textarea.value}`
        );

        // Fallback: Try direct assignment
        textarea.value = cleanedValue;
        textarea.dispatchEvent(inputEvent);
        textarea.dispatchEvent(changeEvent);

        return textarea.value === cleanedValue;
      }
    } catch (error) {
      this.logger(`Error filling textarea field: ${error.message}`);
      return false;
    }
  }

  /**
   * FIXED: Fill a checkbox field using Ashby's aggressive approach
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
      let currentState = false;

      if (element.tagName.toLowerCase() !== "input") {
        checkboxInput = element.querySelector('input[type="checkbox"]');

        if (!checkboxInput) {
          if (element.getAttribute("role") === "checkbox") {
            currentState = element.getAttribute("aria-checked") === "true";

            // ASHBY'S AGGRESSIVE APPROACH: Try multiple methods
            if (
              (shouldCheck && !currentState) ||
              (!shouldCheck && currentState)
            ) {
              this.scrollToElement(element);

              // Method 1: Click the element
              element.click();
              await this.wait(200);

              // Method 2: Force the state if click didn't work
              const newState = element.getAttribute("aria-checked") === "true";
              if (newState !== shouldCheck) {
                element.setAttribute("aria-checked", shouldCheck.toString());
                element.dispatchEvent(new Event("change", { bubbles: true }));
              }
            }
            return true;
          }
        }

        if (!checkboxInput) {
          return false;
        }
      } else {
        currentState = element.checked;
      }

      // Only change state if needed
      if ((shouldCheck && !currentState) || (!shouldCheck && currentState)) {
        this.scrollToElement(checkboxInput);
        await this.wait(200);

        // ASHBY'S AGGRESSIVE APPROACH: Try multiple click strategies
        let success = false;

        // Method 1: Direct property assignment
        checkboxInput.checked = shouldCheck;
        if (checkboxInput.checked === shouldCheck) {
          success = true;
        }

        // Method 2: Click the label (most reliable for checkboxes)
        if (!success) {
          const label =
            checkboxInput.closest("label") ||
            document.querySelector(`label[for="${checkboxInput.id}"]`);
          if (label) {
            label.click();
            await this.wait(200);
            success = checkboxInput.checked === shouldCheck;
          }
        }

        // Method 3: Click the checkbox directly
        if (!success) {
          checkboxInput.click();
          await this.wait(200);
          success = checkboxInput.checked === shouldCheck;
        }

        // Method 4: Force the state and dispatch events
        if (!success) {
          checkboxInput.checked = shouldCheck;
          checkboxInput.setAttribute("checked", shouldCheck ? "checked" : "");
          checkboxInput.dispatchEvent(new Event("change", { bubbles: true }));
          checkboxInput.dispatchEvent(new Event("click", { bubbles: true }));
          success = true; // Assume success since we forced it
        }

        this.logger(
          `Checkbox ${shouldCheck ? "check" : "uncheck"} ${
            success ? "successful" : "failed"
          }`
        );
        return success;
      }

      return true; // No change needed
    } catch (error) {
      this.logger(`Error filling checkbox field: ${error.message}`);
      return false;
    }
  }

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
        return await this.handleWorkableRadioGroup(element, aiValue);
      }

      // Handle individual radio elements
      else if (element.getAttribute("role") === "radio") {
        const radioGroup =
          element.closest('fieldset[role="radiogroup"]') ||
          element.closest('[role="radiogroup"]');
        if (radioGroup) {
          return await this.handleWorkableRadioGroup(radioGroup, aiValue);
        }
      }

      // Handle standard radio buttons (fallback)
      else {
        return await this.handleStandardRadioButtons(element, aiValue);
      }

      this.logger(`Unable to fill radio field - no matching option found`);
      return false;
    } catch (error) {
      this.logger(`Error filling radio field: ${error.message}`);
      return false;
    }
  }

  /**
   * Fill a select field
   */
  async fillSelectField(element, value) {
    try {
      if (element.tagName === "SELECT") {
        // Standard select element
        const options = Array.from(element.options);
        const bestMatch = this.findBestMatchingOption(
          value,
          options.map((opt) => opt.textContent)
        );

        if (bestMatch) {
          const matchingOption = options.find(
            (opt) => opt.textContent === bestMatch
          );
          if (matchingOption) {
            element.value = matchingOption.value;
            element.dispatchEvent(new Event("change", { bubbles: true }));
            return true;
          }
        }
      } else if (element.getAttribute("role") === "combobox") {
        // Custom Workable select (combobox)
        this.scrollToElement(element);
        element.click();
        await this.wait(300);

        // Look for the listbox that appears
        const listbox = document.querySelector('ul[role="listbox"]');
        if (listbox) {
          const optionItems = listbox.querySelectorAll('li[role="option"]');
          const availableOptions = [];
          const optionMap = new Map();

          for (const item of optionItems) {
            const textEl =
              item.querySelector("span.styles--f-uLT") ||
              item.querySelector("span") ||
              item;

            if (textEl && textEl.textContent.trim()) {
              const text = textEl.textContent.trim();
              availableOptions.push(text);
              optionMap.set(text, item);
            }
          }

          const bestMatch = this.findBestMatchingOption(
            value,
            availableOptions
          );
          if (bestMatch) {
            const matchingOption = optionMap.get(bestMatch);
            if (matchingOption) {
              matchingOption.click();
              await this.wait(300);
              return true;
            }
          }
        }
      }

      return false;
    } catch (error) {
      this.logger(`Error filling select field: ${error.message}`);
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

        // Use native setter for date inputs too
        const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value"
        ).set;

        nativeInputValueSetter.call(element, "");
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

        nativeInputValueSetter.call(element, formattedDate);
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
   * Get available options from select fields including custom Workable dropdowns
   */
  getFieldOptions(element, form) {
    try {
      const options = [];
      const fieldType = this.getFieldType(element);

      if (fieldType === "select") {
        // First, try to click to open dropdown if it's a custom select
        if (element.getAttribute("role") === "combobox") {
          element.click();

          // Wait briefly and then look for options
          setTimeout(() => {
            const listbox = document.querySelector('ul[role="listbox"]');
            if (listbox) {
              const optionItems = listbox.querySelectorAll('li[role="option"]');
              optionItems.forEach((item) => {
                const textEl =
                  item.querySelector("span.styles--f-uLT") ||
                  item.querySelector("span") ||
                  item;

                if (textEl && textEl.textContent.trim()) {
                  options.push(textEl.textContent.trim());
                }
              });

              // Close the dropdown
              element.blur();
            }
          }, 100);
        }

        // Handle standard select
        else if (element.tagName === "SELECT") {
          const optionElements = element.querySelectorAll("option");
          optionElements.forEach((option) => {
            if (option.value && option.textContent.trim()) {
              options.push(option.textContent.trim());
            }
          });
        }
      } else if (fieldType === "radio") {
        // Enhanced radio option extraction
        const radioContainer =
          element.tagName === "FIELDSET"
            ? element
            : element.closest('fieldset[role="radiogroup"]') ||
              element.closest('[role="radiogroup"]');

        if (radioContainer) {
          const radios = radioContainer.querySelectorAll('[role="radio"]');
          radios.forEach((radio) => {
            const radioId = radio.id;
            const labelSpan =
              radio.querySelector('span[id*="radio_label"]') ||
              document.querySelector(
                `span[id="radio_label_${radioId?.split("_").pop()}"]`
              );

            if (labelSpan) {
              options.push(labelSpan.textContent.trim());
            } else {
              // Fallback label extraction
              const label = this.getFieldLabel(radio);
              if (label) {
                options.push(label);
              }
            }
          });
        }
      }

      // Remove duplicates and empty options
      return [...new Set(options.filter((opt) => opt && opt.trim()))];
    } catch (error) {
      this.logger(`Error getting field options: ${error.message}`);
      return [];
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
   * Generate unique form identifier based on form structure
   */
  getFormIdentifier() {
    try {
      const formFields = this.getAllFormFields(document);
      const fieldLabels = formFields
        .map((f) => f.label)
        .filter((label) => label)
        .sort()
        .join("|");

      const url = window.location.href.split("?")[0];
      return btoa(url + "|" + fieldLabels).substring(0, 32);
    } catch (error) {
      return btoa(window.location.href).substring(0, 32);
    }
  }

  /**
   * Check if form already appears to be filled
   */
  isFormAlreadyFilled() {
    try {
      const formFields = this.getAllFormFields(document);
      let filledCount = 0;
      let totalTextFields = 0;

      for (const field of formFields) {
        if (field.type === "text" || field.type === "textarea") {
          totalTextFields++;
          const input = field.element.querySelector("input, textarea");
          if (input && input.value && input.value.trim()) {
            filledCount++;
          }
        } else if (field.type === "radio") {
          const checkedRadio =
            field.element.querySelector(
              '[role="radio"][aria-checked="true"]'
            ) || field.element.querySelector('input[type="radio"]:checked');
          if (checkedRadio) {
            filledCount++;
          }
        } else if (field.type === "checkbox") {
          const checkedBoxes =
            field.element.querySelectorAll(
              '[role="checkbox"][aria-checked="true"]'
            ) ||
            field.element.querySelectorAll('input[type="checkbox"]:checked');
          if (checkedBoxes.length > 0) {
            filledCount++;
          }
        }
      }

      // Consider form filled if more than 50% of text fields have values
      const fillRatio = totalTextFields > 0 ? filledCount / totalTextFields : 0;
      const isAlreadyFilled = fillRatio > 0.5;

      this.logger(
        `Form fill check: ${filledCount}/${totalTextFields} text fields filled (${Math.round(
          fillRatio * 100
        )}%)`
      );

      return isAlreadyFilled;
    } catch (error) {
      this.logger(`Error checking form fill status: ${error.message}`);
      return false;
    }
  }

  /**
   * FIXED: Fill form with profile data using AI-generated answers with state management
   */
  async fillFormWithProfile(form, profile, jobDescription) {
    try {
      // FIXED: Prevent duplicate form filling
      if (this.fillInProgress) {
        this.logger("⚠️ Form filling already in progress, skipping duplicate");
        return true;
      }

      // FIXED: Prevent rapid re-fills
      const now = Date.now();
      if (now - this.lastFillTime < 5000) {
        this.logger("⚠️ Form filled too recently, skipping");
        return true;
      }

      // FIXED: Check if form already processed
      const formId = this.getFormIdentifier();
      if (this.processedForms.has(formId)) {
        this.logger("⚠️ Form already processed, skipping");
        return true;
      }

      // FIXED: Check if form already has values
      if (this.isFormAlreadyFilled()) {
        this.logger("⚠️ Form appears to be already filled, skipping");
        this.processedForms.add(formId);
        return true;
      }

      this.fillInProgress = true;
      this.lastFillTime = now;

      this.logger("=== STARTING WORKABLE FORM FILLING WITH AI ANSWERS ===");
      this.logger(`Profile available: ${!!profile}`);
      this.logger(`Job description available: ${!!jobDescription}`);

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
          const options = ["select", "radio", "checkbox"].includes(field.type)
            ? this.getFieldOptions(field.element, form)
            : [];

          if (options.length > 0) {
            this.logger(`Available options: [${options.join(", ")}]`);
          }

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
              this.logger(`✅ Successfully filled field: ${field.label}`);
            } else {
              this.logger(`❌ Failed to fill field: ${field.label}`);
              skippedCount++;
            }
          } else {
            this.logger(
              `❌ AI provided no answer for field: ${field.label} - skipping`
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

      // FIXED: Mark form as processed after successful completion
      this.processedForms.add(formId);

      this.logger(
        `=== WORKABLE FORM FILLING COMPLETE: ${filledCount} filled, ${skippedCount} skipped ===`
      );
      return filledCount > 0;
    } catch (error) {
      this.logger(`❌ Error filling form with AI answers: ${error.message}`);
      return false;
    } finally {
      this.fillInProgress = false;
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

  /**
   * Reset form handler state (useful for new forms)
   */
  resetState() {
    this.processedForms.clear();
    this.fillInProgress = false;
    this.lastFillTime = 0;
    this.answerCache.clear();
    this.logger("🔄 Workable form handler state reset");
  }
}
