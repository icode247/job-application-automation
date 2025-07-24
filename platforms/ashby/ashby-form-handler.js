// platforms/ashby/ashby-form-handler.js
import { AIService } from "../../services/index.js";
import Utils from "../../utils/utils.js";
//submitAndVerify
export class AshbyFormHandler {
  constructor(options = {}) {
    this.logger = options.logger || console.log;
    this.host = options.host || "https://fastapply.co";
    this.userData = options.userData || {};
    this.jobDescription = options.jobDescription || "";
    this.aiService = new AIService({ apiHost: this.host });
    this.answerCache = new Map();
    this.utils = new Utils();

    // FIXED: Add form state tracking to prevent duplicates
    this.processedForms = new Set();
    this.fillInProgress = false;
    this.lastFillTime = 0;
  }

  async fillTextareaInput(fieldInfo, value) {
    const textarea =
      fieldInfo.element.querySelector("textarea") || fieldInfo.element;

    this.scrollToElement(textarea);
    textarea.focus();
    await this.wait(100);

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
    const inputEvent = new Event("input", { bubbles: true, cancelable: true });
    const changeEvent = new Event("change", {
      bubbles: true,
      cancelable: true,
    });

    textarea.dispatchEvent(inputEvent);
    await this.wait(50);
    textarea.dispatchEvent(changeEvent);

    // Verify the value was set
    if (textarea.value === cleanedValue) {
      return true;
    } else {
      this.logger(
        `⚠️ Textarea value may not have been set correctly. Current value: ${textarea.value}`
      );

      // Fallback: Try direct assignment
      textarea.value = cleanedValue;
      textarea.dispatchEvent(inputEvent);
      textarea.dispatchEvent(changeEvent);

      return textarea.value === cleanedValue;
    }
  }

  /**
   * Get all form fields from Ashby application (not in a form element)
   */
  getAllFormFields() {
    try {
      this.logger("Finding all Ashby form fields, and preparing to fill them");
      const fields = [];

      // Find all field entries (they're not inside a form element)
      const fieldEntries = document.querySelectorAll(
        "._fieldEntry_hkyf8_29, .ashby-application-form-field-entry"
      );

      for (const fieldEntry of fieldEntries) {
        if (!this.isElementVisible(fieldEntry)) continue;

        const fieldInfo = this.analyzeAshbyField(fieldEntry);
        if (fieldInfo) {
          // Skip "If other, please provide context" fields
          if (this.shouldSkipField(fieldInfo.label)) {
            continue;
          }

          fields.push(fieldInfo);
        }
      }

      return fields;
    } catch (error) {
      return [];
    }
  }

  /**
   * Check if field should be skipped
   */
  shouldSkipField(label) {
    const skipPatterns = [
      /if other.*please provide context/i,
      /if other.*please specify/i,
      /other.*please explain/i,
    ];

    return skipPatterns.some((pattern) => pattern.test(label));
  }

  /**
   * Analyze individual Ashby field and extract information
   */
  analyzeAshbyField(fieldEntry) {
    try {
      // Get the label
      const labelElement = fieldEntry.querySelector(
        "._heading_101oc_53, .ashby-application-form-question-title"
      );
      if (!labelElement) return null;

      const labelText = this.cleanLabelText(labelElement.textContent);
      if (!labelText) return null;

      // Check if required
      const isRequired = this.isAshbyFieldRequired(fieldEntry, labelElement);

      // Determine field type and structure
      const fieldType = this.determineAshbyFieldType(fieldEntry);

      return {
        element: fieldEntry,
        label: labelText,
        type: fieldType.type,
        subType: fieldType.subType,
        required: isRequired,
        options: fieldType.options || [],
      };
    } catch (error) {
      return null;
    }
  }

  /**
   * Determine the type of Ashby field
   */
  determineAshbyFieldType(fieldEntry) {
    // 1. Check for autocomplete fields (Location, How you heard)
    const autocompleteInput = fieldEntry.querySelector(
      'input[role="combobox"], input[placeholder="Start typing..."]'
    );
    if (autocompleteInput) {
      return {
        type: "autocomplete",
        subType: "combobox",
        element: autocompleteInput,
      };
    }

    // 2. Check for Yes/No button fields
    const yesNoContainer = fieldEntry.querySelector(
      "._container_y2cw4_29, ._yesno_hkyf8_143"
    );
    if (yesNoContainer) {
      return {
        type: "yesno",
        subType: "buttons",
        element: yesNoContainer,
        options: ["Yes", "No"],
      };
    }

    // 3. Check for radio button groups
    if (
      fieldEntry.tagName === "FIELDSET" &&
      fieldEntry.querySelector('input[type="radio"]')
    ) {
      const options = this.extractRadioOptions(fieldEntry);
      return {
        type: "radio",
        subType: "group",
        element: fieldEntry,
        options: options,
      };
    }

    // 4. Check for checkbox groups
    if (
      fieldEntry.tagName === "FIELDSET" &&
      fieldEntry.querySelector('input[type="checkbox"]')
    ) {
      const options = this.extractCheckboxOptions(fieldEntry);
      return {
        type: "checkbox",
        subType: "group",
        element: fieldEntry,
        options: options,
      };
    }

    // 5. Check for regular text inputs (INCLUDING TEL TYPE)
    const textInput = fieldEntry.querySelector(
      'input[type="text"], input[type="email"], input[type="tel"], input[type="number"], textarea'
    );
    if (textInput) {
      return {
        type:
          textInput.tagName.toLowerCase() === "textarea"
            ? "textarea"
            : textInput.type === "number"
            ? "number"
            : textInput.type || "text",
        subType: textInput.type || "text",
        element: textInput,
      };
    }

    // 6. Check for file uploads
    const fileInput = fieldEntry.querySelector('input[type="file"]');
    if (fileInput) {
      return {
        type: "file",
        subType: "upload",
        element: fileInput,
      };
    }

    return { type: "unknown", subType: "unknown", element: fieldEntry };
  }

  /**
   * Extract radio button options from fieldset
   */
  extractRadioOptions(fieldset) {
    const options = [];
    const radioContainers = fieldset.querySelectorAll("._option_1v5e2_35");

    for (const container of radioContainers) {
      const label = container.querySelector("label");
      if (label) {
        options.push(label.textContent.trim());
      }
    }

    return options;
  }

  /**
   * Extract checkbox options from fieldset
   */
  extractCheckboxOptions(fieldset) {
    const options = [];
    const checkboxContainers = fieldset.querySelectorAll("._option_1v5e2_35");

    for (const container of checkboxContainers) {
      const label = container.querySelector("label");
      if (label) {
        options.push(label.textContent.trim());
      }
    }

    return options;
  }

  /**
   * Check if Ashby field is required
   */
  isAshbyFieldRequired(fieldEntry, labelElement) {
    // Check for required class on label
    if (labelElement.classList.contains("_required_101oc_92")) {
      return true;
    }

    // Check for asterisk in label text
    if (labelElement.textContent.includes("*")) {
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
   * Fill form field based on type - FIXED with better error handling
   */
  async fillAshbyField(fieldInfo, answer) {
    try {
      this.logger(
        `Starting to fill ${fieldInfo.type} field: ${fieldInfo.label}`
      );

      let success = false;

      switch (fieldInfo.type) {
        case "number":
          success = await this.fillNumberInput(
            fieldInfo.element.querySelector("input"),
            answer
          );
          break;
        case "text":
        case "tel":
        case "email":
          success = await this.fillTextInput(fieldInfo, answer);
          break;
        case "textarea":
          success = await this.fillTextareaInput(fieldInfo, answer);
          break;
        case "autocomplete":
          success = await this.fillAutocompleteField(fieldInfo, answer);
          break;
        case "yesno":
          success = await this.fillYesNoField(fieldInfo, answer);
          break;
        case "radio":
          success = await this.fillRadioGroup(fieldInfo, answer);
          break;
        case "checkbox":
          success = await this.fillCheckboxGroup(fieldInfo, answer);
          break;
        case "file":
          this.logger("Skipping file upload field");
          success = true;
          break;
        default:
          this.logger(`Unknown field type: ${fieldInfo.type}`);
          success = false;
      }

      if (success) {
        this.logger(` Answered question ${fieldInfo.label}`);
      }
      return success;
    } catch (error) {
      return false;
    }
  }

  /**
   * Fill text input field - FIXED VERSION
   */
  async fillTextInput(fieldInfo, value) {
    const input =
      fieldInfo.element.querySelector("input, textarea") || fieldInfo.element;

    this.scrollToElement(input);

    // Focus without triggering potential form resets
    input.focus();
    await this.wait(100);

    // Use a more gentle approach to setting values
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    ).set;

    // Clear current value
    nativeInputValueSetter.call(input, "");

    // Set new value
    nativeInputValueSetter.call(input, String(value));

    // Dispatch only necessary events - avoid blur which can cause resets
    const inputEvent = new Event("input", { bubbles: true, cancelable: true });
    const changeEvent = new Event("change", {
      bubbles: true,
      cancelable: true,
    });

    input.dispatchEvent(inputEvent);
    await this.wait(50);
    input.dispatchEvent(changeEvent);

    await this.wait(200);
    return true;
  }

  /**
   * Fill autocomplete field (Location, How you heard)
   */
  async fillAutocompleteField(fieldInfo, value) {
    const input =
      fieldInfo.element.querySelector('input[role="combobox"]') ||
      fieldInfo.element.querySelector('input[placeholder="Start typing..."]');

    if (!input) {
      return false;
    }

    this.scrollToElement(input);
    input.focus();
    await this.wait(200);

    // Determine search value based on field type
    let searchValue = String(value);
    let isHowDidYouHear = fieldInfo.label
      .toLowerCase()
      .includes("how did you hear");
    let isLocationField = this.isLocationField(fieldInfo.label);

    if (isHowDidYouHear) {
      searchValue = "LinkedIn";
    }

    // Clear and start typing
    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value"
    ).set;

    // Clear the input
    nativeInputValueSetter.call(input, "");
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await this.wait(150);

    let stopAtChar = searchValue.length;

    if (isLocationField) {
      stopAtChar = Math.min(10, searchValue.length);
    } else if (!isHowDidYouHear) {
      stopAtChar = Math.min(4, searchValue.length);
    }

    let actualTypedValue = "";

    for (let i = 0; i < stopAtChar; i++) {
      const currentValue = searchValue.substring(0, i + 1);
      actualTypedValue = currentValue;

      input.value = currentValue;

      const keydownEvent = new KeyboardEvent("keydown", {
        key: searchValue[i],
        code: `Key${searchValue[i].toUpperCase()}`,
        bubbles: true,
        cancelable: true,
      });

      const keyupEvent = new KeyboardEvent("keyup", {
        key: searchValue[i],
        code: `Key${searchValue[i].toUpperCase()}`,
        bubbles: true,
        cancelable: true,
      });

      const inputEvent = new Event("input", { bubbles: true });

      input.dispatchEvent(keydownEvent);
      input.dispatchEvent(inputEvent);
      input.dispatchEvent(keyupEvent);

      await this.wait(500);

      if (!isHowDidYouHear && i >= (isLocationField ? 9 : 3)) {
        const resultsContainer = document.querySelector(
          "._resultContainer_v5ami_112"
        );
        if (
          resultsContainer &&
          resultsContainer.querySelectorAll('[role="option"]').length > 0
        ) {
          this.logger("Options appeared early, stopping typing");
          break;
        }
      }
    }

    await this.wait(1200);

    const resultsContainer = document.querySelector(
      "._resultContainer_v5ami_112"
    );

    return await this.selectFromAutocompleteOptions(
      resultsContainer,
      actualTypedValue,
      isHowDidYouHear,
      isLocationField
    );
  }

  async selectFromAutocompleteOptions(
    resultsContainer,
    searchValue,
    isHowDidYouHear,
    isLocationField
  ) {
    const options = resultsContainer.querySelectorAll('[role="option"]');

    if (options.length === 0) {
      return false;
    }

    let bestMatch = null;
    let bestScore = 0;
    const searchValueLower = searchValue.toLowerCase();

    for (const option of options) {
      const optionText = option.textContent.trim().toLowerCase();
      let score = 0;

      if (optionText === searchValueLower) {
        bestMatch = option;
        bestScore = 100;
        break;
      }

      if (
        isHowDidYouHear &&
        searchValueLower === "linkedin" &&
        optionText.includes("linkedin")
      ) {
        bestMatch = option;
        bestScore = 95;
        break;
      }

      if (isLocationField) {
        const searchParts = searchValueLower
          .split(/[,\s]+/)
          .filter((part) => part.length > 0);
        let locationScore = 0;
        let matchedParts = 0;

        for (const part of searchParts) {
          if (optionText.includes(part)) {
            matchedParts++;
            if (optionText.startsWith(part)) {
              locationScore += 20;
            } else {
              locationScore += 10;
            }
          }
        }

        if (matchedParts === searchParts.length) {
          locationScore += 30;
        }
        if (matchedParts === searchParts.length) {
          locationScore += 30;
        }

        score = locationScore;
      } else {
        if (optionText.startsWith(searchValueLower)) {
          score = 80;
        } else if (optionText.includes(searchValueLower)) {
          score = 60;
        } else if (searchValueLower.includes(optionText)) {
          score = 40;
        }
      }

      if (score > bestScore) {
        bestMatch = option;
        bestScore = score;
      }
    }

    if (bestMatch) {
      const selectedText = bestMatch.textContent.trim();
      this.logger(
        `🎯 Selecting best match: "${selectedText}" (score: ${bestScore})`
      );

      this.scrollToElement(bestMatch);
      await this.wait(200);

      try {
        const expectedText = bestMatch.textContent.trim();

        bestMatch.scrollIntoView({ behavior: "smooth", block: "nearest" });
        await this.wait(200);

        const syntheticMouseDown = new MouseEvent("mousedown", {
          bubbles: true,
          cancelable: true,
          view: window,
          detail: 1,
          screenX: 0,
          screenY: 0,
          clientX: 0,
          clientY: 0,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
          metaKey: false,
          button: 0,
          buttons: 1,
        });

        const syntheticMouseUp = new MouseEvent("mouseup", {
          bubbles: true,
          cancelable: true,
          view: window,
          detail: 1,
          screenX: 0,
          screenY: 0,
          clientX: 0,
          clientY: 0,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
          metaKey: false,
          button: 0,
          buttons: 0,
        });

        const syntheticClick = new MouseEvent("click", {
          bubbles: true,
          cancelable: true,
          view: window,
          detail: 1,
          screenX: 0,
          screenY: 0,
          clientX: 0,
          clientY: 0,
          ctrlKey: false,
          altKey: false,
          shiftKey: false,
          metaKey: false,
          button: 0,
          buttons: 0,
        });

        bestMatch.dispatchEvent(syntheticMouseDown);
        await this.wait(50);
        bestMatch.dispatchEvent(syntheticMouseUp);
        await this.wait(50);
        bestMatch.dispatchEvent(syntheticClick);
        await this.wait(500);

        if (
          input &&
          (input.value.trim() === expectedText ||
            input.value.includes(selectedText.split(",")[0]))
        ) {
          return true;
        }

        if (bestMatch.tabIndex !== undefined) {
          bestMatch.tabIndex = 0;
        }
        bestMatch.focus();
        await this.wait(100);

        const enterKeyDown = new KeyboardEvent("keydown", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        });

        const enterKeyUp = new KeyboardEvent("keyup", {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        });

        bestMatch.dispatchEvent(enterKeyDown);
        await this.wait(50);
        bestMatch.dispatchEvent(enterKeyUp);
        await this.wait(500);

        if (
          input &&
          (input.value.trim() === expectedText ||
            input.value.includes(selectedText.split(",")[0]))
        ) {
          return true;
        }

        const clickHandler = bestMatch.onclick;
        if (clickHandler) {
          clickHandler.call(bestMatch, syntheticClick);
          await this.wait(500);

          if (
            input &&
            (input.value.trim() === expectedText ||
              input.value.includes(selectedText.split(",")[0]))
          ) {
            return true;
          }
        }

        const pointerDown = new PointerEvent("pointerdown", {
          pointerId: 1,
          bubbles: true,
          cancelable: true,
          isPrimary: true,
        });

        const pointerUp = new PointerEvent("pointerup", {
          pointerId: 1,
          bubbles: true,
          cancelable: true,
          isPrimary: true,
        });

        bestMatch.dispatchEvent(pointerDown);
        await this.wait(50);
        bestMatch.dispatchEvent(pointerUp);
        await this.wait(50);
        bestMatch.dispatchEvent(syntheticClick);
        await this.wait(500);

        // Final check
        if (
          input &&
          (input.value.trim() === expectedText ||
            input.value.includes(selectedText.split(",")[0]))
        ) {
          return true;
        }

        if (input) {
          nativeInputValueSetter.call(input, selectedText);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          input.dispatchEvent(new Event("blur", { bubbles: true }));
        }

        await this.wait(300);

        return true;
      } catch (clickError) {
        return false;
      }
    } else {
      this.logger(`❌ No suitable match found for "${searchValue}"`);
      return false;
    }
  }

  /**
   * Calculate match score for autocomplete options
   */
  calculateMatchScore(option, search) {
    const optionLower = option.toLowerCase();
    const searchLower = search.toLowerCase();

    if (optionLower === searchLower) return 100;
    if (optionLower.startsWith(searchLower)) return 80;
    if (optionLower.includes(searchLower)) return 60;
    if (searchLower.includes(optionLower)) return 40;

    return 0;
  }

  /**
   * Fill Yes/No button field
   */
  async fillYesNoField(fieldInfo, value) {
    const container = fieldInfo.element;
    const valueStr = String(value).toLowerCase();

    const shouldSelectYes =
      valueStr === "yes" ||
      valueStr === "true" ||
      valueStr.includes("yes") ||
      valueStr.includes("authorized") ||
      value === true;

    const buttons = container.querySelectorAll("._option_y2cw4_33, button");
    let targetButton = null;

    for (const button of buttons) {
      const buttonText = button.textContent.trim().toLowerCase();
      if (
        (shouldSelectYes && buttonText === "yes") ||
        (!shouldSelectYes && buttonText === "no")
      ) {
        targetButton = button;
        break;
      }
    }

    if (targetButton) {
      this.scrollToElement(targetButton);
      targetButton.click();
      await this.wait(300);
      this.logger(`Clicked ${shouldSelectYes ? "Yes" : "No"} button`);
      return true;
    }

    return false;
  }

  /**
   * Fill radio button group - FIXED to ensure actual selection
   */
  async fillRadioGroup(fieldInfo, value) {
    const fieldset = fieldInfo.element;
    const valueStr = String(value).toLowerCase();

    // Find matching option
    const radioContainers = fieldset.querySelectorAll("._option_1v5e2_35");
    let bestMatch = null;
    let bestScore = 0;

    for (const container of radioContainers) {
      const label = container.querySelector("label");
      const radio = container.querySelector('input[type="radio"]');

      if (!label || !radio) continue;

      const labelText = label.textContent.trim().toLowerCase();
      const score = this.calculateMatchScore(labelText, valueStr);

      if (score > bestScore) {
        bestMatch = { container, label, radio };
        bestScore = score;
      }
    }

    if (bestMatch) {
      // Check if already selected
      if (!bestMatch.radio.checked) {
        this.scrollToElement(bestMatch.label);

        // FIXED: More aggressive selection approach
        bestMatch.radio.focus();
        await this.wait(100);

        // Method 1: Direct property assignment
        bestMatch.radio.checked = true;

        // Method 2: Click the label (more reliable)
        bestMatch.label.click();

        // Method 3: Click the radio directly
        bestMatch.radio.click();

        bestMatch.radio.checked = true;

        // Method 4: Dispatch events
        bestMatch.radio.dispatchEvent(new Event("change", { bubbles: true }));
        bestMatch.radio.dispatchEvent(new Event("click", { bubbles: true }));

        await this.wait(500); // Longer wait to ensure state settles

        // Verify selection worked
        if (bestMatch.radio.checked) {
        } else {
          // Final attempt: Force the selection
          bestMatch.radio.checked = true;
          bestMatch.radio.setAttribute("checked", "checked");
        }
      }
      return true;
    }

    return false;
  }

  /**
   * Fill checkbox group (can select multiple) - FIXED to ensure actual selection
   */
  async fillCheckboxGroup(fieldInfo, value) {
    const fieldset = fieldInfo.element;
    let valuesToSelect = [];

    // Handle different answer formats
    if (Array.isArray(value)) {
      valuesToSelect = value.map((v) => String(v).toLowerCase());
    } else if (typeof value === "string" && value.includes(",")) {
      valuesToSelect = value.split(",").map((v) => v.trim().toLowerCase());
    } else {
      valuesToSelect = [String(value).toLowerCase()];
    }

    const checkboxContainers = fieldset.querySelectorAll("._option_1v5e2_35");
    let selectedCount = 0;

    for (const container of checkboxContainers) {
      const label = container.querySelector("label");
      const checkbox = container.querySelector('input[type="checkbox"]');

      if (!label || !checkbox) continue;

      const labelText = label.textContent.trim().toLowerCase();

      // Check if this option should be selected
      let shouldSelect = false;
      for (const searchValue of valuesToSelect) {
        if (this.calculateMatchScore(labelText, searchValue) > 50) {
          shouldSelect = true;
          break;
        }
      }

      // Handle special cases
      if (!shouldSelect) {
        if (
          valuesToSelect.includes("prefer not to answer") ||
          valuesToSelect.includes("no") ||
          valuesToSelect.includes("none") ||
          valuesToSelect.includes("none of the above")
        ) {
          if (
            labelText.includes("prefer not to") ||
            labelText.includes("not to answer") ||
            labelText.includes("none of the above")
          ) {
            shouldSelect = true;
          }
        }
      }

      if (shouldSelect && !checkbox.checked) {
        this.scrollToElement(label);

        // FIXED: More aggressive checkbox selection
        checkbox.focus();
        await this.wait(100);

        // Method 1: Direct property assignment
        checkbox.checked = true;

        // Method 2: Click the label (most reliable for checkboxes)
        label.click();

        // Method 3: Click the checkbox directly
        checkbox.click();

        // Method 4: Dispatch events
        checkbox.dispatchEvent(new Event("change", { bubbles: true }));
        checkbox.dispatchEvent(new Event("click", { bubbles: true }));

        await this.wait(300);

        // Verify selection worked
        if (checkbox.checked) {
          selectedCount++;
        } else {
          // Final attempt: Force the selection
          checkbox.checked = true;
          checkbox.setAttribute("checked", "checked");
          selectedCount++;
        }
      } else if (checkbox.checked && shouldSelect) {
        // Already checked and should be checked
        selectedCount++;
        this.logger(`Option already checked: ${label.textContent.trim()}`);
      }
    }

    if (selectedCount > 0) {
      this.logger(` Successfully selected ${selectedCount} checkbox options`);
      return true;
    } else {
      this.logger(`⚠️ No checkbox options were selected`);
      return false;
    }
  }

  /**
   * Get user location data for Location fields
   */
  getUserLocationData() {
    const userData = this.userData;

    // Try different location combinations
    let location = "";

    // Method 1: Use streetAddress if available
    if (userData.streetAddress) {
      location = userData.streetAddress;
      return location;
    }

    // Method 2: Combine city, state, country
    const parts = [];
    if (userData.city) parts.push(userData.city);
    if (userData.state) parts.push(userData.state);
    if (userData.country && userData.country !== "United States") {
      parts.push(userData.country);
    }

    if (parts.length > 0) {
      location = parts.join(", ");
      return location;
    }

    // Method 3: State and country only
    if (userData.state) {
      location = userData.state;
      if (userData.country && userData.country !== "United States") {
        location += ", " + userData.country;
      }
      return location;
    }

    // Method 4: Country only
    if (userData.country) {
      location = userData.country;
      return location;
    }

    return "";
  }

  /**
   * Check if field is a location field that should use user data
   */
  isLocationField(label) {
    const locationPatterns = [
      /location.*state/i,
      /state.*location/i,
      /current.*location/i,
      /where.*located/i,
      /city.*state/i,
      /state.*city/i,
      /^location$/i, // ← More specific - exact match only
      /physical.*address/i, // ← More specific than just "address"
      /mailing.*address/i, // ← More specific
      /street.*address/i, // ← More specific
      /home.*address/i, // ← More specific
      /where.*live/i,
      /residence/i,
      /geographic/i,
      /city.*country/i,
    ];

    // Exclude email-related fields explicitly
    const emailPatterns = [/email/i, /e-mail/i, /@/];

    const isEmail = emailPatterns.some((pattern) => pattern.test(label));
    if (isEmail) return false;

    const isLocation = locationPatterns.some((pattern) => pattern.test(label));
    return isLocation;
  }

  /**
   * Fill form with user profile data using AI
   */
  async fillFormWithProfile(profile) {
    try {
      if (this.fillInProgress) {
        return true;
      }

      const now = Date.now();
      if (now - this.lastFillTime < 5000) {
        return true;
      }

      const formId = this.getFormIdentifier();
      if (this.processedForms.has(formId)) {
        return true;
      }

      // FIXED: Check if form already has values
      if (this.isFormAlreadyFilled()) {
        this.processedForms.add(formId);
        return true;
      }

      this.fillInProgress = true;
      this.lastFillTime = now;

      this.logger("Let me help you answer the job questions now...");
      this.userData = profile;
      const formFields = this.getAllFormFields();

      let filledCount = 0;

      for (const field of formFields) {
        if (!field.label || field.type === "file") continue;

        try {
          const fieldContext = this.buildFieldContext(field);
          let answer;

          // Special handling for "How did you hear" field
          if (field.label.toLowerCase().includes("how did you hear")) {
            answer = "LinkedIn";
          }
          // Special handling for Location fields - use user data directly
          else if (this.isLocationField(field.label)) {
            answer = this.getUserLocationData();
          } else {
            this.logger(`Thinking of the answer for "${field.label}"`);
            answer = await this.getAIAnswer(
              field.label,
              field.options,
              field.type,
              fieldContext
            );

            if (answer) {
              this.logger(
                `Got answer for "${field.label}": ${String(answer).substring(
                  0,
                  100
                )}${String(answer).length > 100 ? "..." : ""}`
              );
            } else {
              this.logger(
                `Sorry, I could not answer the question "${field.label}"`
              );
            }
          }

          if (answer) {
            const success = await this.fillAshbyField(field, answer);
            if (success) {
              filledCount++;
            }
          }

          await this.wait(500);
        } catch (fieldError) {
          throw new Error(
            `Error processing field "${field.label}": ${fieldError.message}`
          );
        }
      }

      this.processedForms.add(formId);
      this.logger(`Successfully filled ${filledCount} fields`);

      return true;
    } catch (error) {
      return false;
    } finally {
      this.fillInProgress = false;
    }
  }

  async fillNumberInput(input, value) {
    try {
      // Validate input element
      if (!input || input.type !== "number") {
        this.logger("❌ Invalid number input element");
        return false;
      }

      // Validate and clean the numeric value
      if (value === null || value === undefined || value === "") {
        this.logger("❌ No value provided for number input");
        return false;
      }

      // Convert to number
      const stringValue = String(value).replace(/[$,\s]/g, "");
      const numericValue = parseFloat(stringValue);

      // Validate the number
      if (isNaN(numericValue) || !isFinite(numericValue)) {
        this.logger(
          `❌ Invalid numeric value: "${value}" -> "${numericValue}"`
        );
        return false;
      }

      // Check if number is reasonable (positive)
      if (numericValue <= 0) {
        this.logger(`❌ Invalid number range: ${numericValue}`);
        return false;
      }

      // Clear any existing value first
      input.value = "";
      input.focus();
      await this.wait(50);

      // Set the validated numeric value
      input.value = numericValue.toString();

      this.logger(`✅ Set number input to: ${numericValue}`);

      // Dispatch events for number inputs
      const inputEvent = new Event("input", {
        bubbles: true,
        cancelable: true,
      });
      const changeEvent = new Event("change", {
        bubbles: true,
        cancelable: true,
      });

      input.dispatchEvent(inputEvent);
      await this.wait(50);
      input.dispatchEvent(changeEvent);

      // Verify the value was set correctly
      const finalValue = input.value;
      if (finalValue && !isNaN(parseFloat(finalValue))) {
        this.logger(`✅ Number input verification passed: ${finalValue}`);
        return true;
      } else {
        this.logger(
          `❌ Number input verification failed. Current value: ${finalValue}`
        );
        return false;
      }
    } catch (error) {
      this.logger(`❌ Error filling number input: ${error.message}`);
      return false;
    }
  }

  /**
   * Generate unique form identifier based on form structure
   */
  getFormIdentifier() {
    try {
      const formFields = this.getAllFormFields();
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
      const formFields = this.getAllFormFields();
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
          const checkedRadio = field.element.querySelector(
            'input[type="radio"]:checked'
          );
          if (checkedRadio) {
            filledCount++;
          }
        } else if (field.type === "checkbox") {
          const checkedBoxes = field.element.querySelectorAll(
            'input[type="checkbox"]:checked'
          );
          if (checkedBoxes.length > 0) {
            filledCount++;
          }
        }
      }

      const fillRatio = totalTextFields > 0 ? filledCount / totalTextFields : 0;
      const isAlreadyFilled = fillRatio > 0.5;

      this.logger(
        `Form fill check: ${filledCount}/${totalTextFields} text fields filled (${Math.round(
          fillRatio * 100
        )}%)`
      );

      return isAlreadyFilled;
    } catch (error) {
      return false;
    }
  }

  /**
   * Build context for AI about the field
   */
  buildFieldContext(field) {
    let context = `This is a ${field.type} field`;

    if (field.required) {
      context += " (required)";
    }

    if (field.options && field.options.length > 0) {
      context += `. Available options: ${field.options.join(", ")}`;
    }

    if (field.subType) {
      context += `. Field subtype: ${field.subType}`;
    }

    return context;
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
      const cacheKey = JSON.stringify({
        question: this.cleanLabelText(question),
        options: options.sort(),
        fieldType,
        fieldContext,
      });

      if (this.answerCache.has(cacheKey)) {
        const cachedAnswer = this.answerCache.get(cacheKey);
        this.logger(`Using cached answer for "${question}"`);
        return cachedAnswer;
      }

      // Use userData directly instead of calling getUserDetailsForContext
      const userDataForContext = this.userData;

      // Special handling for salary fields
      if (
        question.toLowerCase().includes("salary") ||
        question.toLowerCase().includes("compensation") ||
        question.toLowerCase().includes("expected salary") ||
        question.toLowerCase().includes("salary expectation") ||
        fieldContext.includes("salary")
      ) {
        this.logger(`Special salary field handling for "${question}"`);
        const answer = await this.aiService.getAnswer(
          `${question} (provide only the numeric amount without currency symbols or commas)`,
          options,
          {
            platform: "ashby",
            userData: userDataForContext,
            jobDescription: this.jobDescription || "",
            fieldType,
            fieldContext: fieldContext + " - numeric only",
          }
        );

        const numericAnswer = this.extractNumericSalary(answer);
        this.answerCache.set(cacheKey, numericAnswer);
        this.logger(`Extracted numeric salary: ${numericAnswer}`);
        return numericAnswer;
      }

      const answer = await this.aiService.getAnswer(question, options, {
        platform: "ashby",
        userData: userDataForContext,
        jobDescription: this.jobDescription || "",
        fieldType,
        fieldContext,
      });

      if (answer !== null && answer !== undefined && answer !== "") {
        this.answerCache.set(cacheKey, answer);
        return answer;
      } else {
        return null;
      }
    } catch (error) {
      this.logger(`Error getting AI answer: ${error.message}`);
      return null;
    }
  }

  /**
   * Extract numeric salary value from AI response
   */
  extractNumericSalary(salaryText) {
    if (!salaryText || salaryText === null || salaryText === undefined) {
      this.logger("❌ No salary text provided");
      return null;
    }

    // Convert to string and clean
    const cleaned = String(salaryText)
      .replace(/[$,\s]/g, "") // Remove dollar signs, commas, spaces
      .replace(/[^\d.]/g, ""); // Keep only digits and decimal points

    // Extract first number found
    const match = cleaned.match(/\d+\.?\d*/);
    if (match) {
      const number = parseFloat(match[0]);
      if (!isNaN(number) && number > 0) {
        const result = Math.round(number).toString();
        this.logger(`✅ Extracted salary: ${salaryText} -> ${result}`);
        return result;
      }
    }

    this.logger(`❌ Could not extract valid salary from: ${salaryText}`);
    return null;
  }

  /**
   * Submit the form
   */
  async submitForm() {
    try {
      this.logger("I'm about to submit the form now.");
      this.wait(2000);

      let submitButton = document.querySelector(
        ".ashby-application-form-submit-button"
      );

      if (!submitButton) {
        const allButtons = document.querySelectorAll("button");
        for (const btn of allButtons) {
          const spanText = btn.querySelector("span")?.textContent?.trim();
          if (spanText && spanText.includes("Submit Application")) {
            submitButton = btn;
            this.logger(`Found submit button via span text: ${spanText}`);
            break;
          }
        }
      }

      if (!submitButton) {
        this.logger("❌ No submit button found");
        return false;
      }

     
      return this.clickSubmitButton(submitButton);
    } catch (error) {
      this.logger(`❌ Error submitting form: ${error.message}`);
      return false;
    }
  }

  /**
   * Click submit button
   */
  async clickSubmitButton(button) {
    if (!this.isElementVisible(button) || button.disabled) {
      this.logger("Submit button is not clickable");
      return false;
    }

    this.scrollToElement(button);
    await this.wait(500);

    button.click();
    this.logger("Clicked submit button");
    await this.wait(3000);
    return true;
  }

  /**
   * Check if the form was successfully submitted
   */
  checkSubmissionSuccess() {
    try {
      // Look for the specific success container
      const successContainer = document.querySelector(
        '.ashby-application-form-success-container[data-highlight="positive"]'
      );

      if (successContainer) {
        const heading = successContainer.querySelector("h2._heading_101oc_53");
        if (heading && heading.textContent.trim() === "Success") {
          this.logger("Great! I think the form was submitted successfully.");
          return true;
        }
      }

      // Alternative check for success elements
      const successElement = document.querySelector(
        '[role="status"][aria-live="polite"] h2:contains("Success")'
      );

      if (successElement) {
        this.logger("Great! I think the form was submitted successfully.");
        return true;
      }

      return false;
    } catch (error) {
      return false;
    }
  }

  /**
   * Complete form submission and verify success
   */
  async submitAndVerify() {
    try {
      const submitSuccess = await this.submitForm();
      if (!submitSuccess) {
        return { success: false, message: "Failed to submit form" };
      }

      // Wait for response
      await this.wait(2000);

      // Check for success
      // const isSuccessful = this.checkSubmissionSuccess();

      // return {
      //   success: isSuccessful,
      //   message: isSuccessful
      //     ? "Form submitted successfully"
      //     : "Form submitted but success status unclear",
      // };
    } catch (error) {
      return { success: false, message: `Submission error: ${error.message}` };
    }
  }

  /**
   * Utility methods
   */
  cleanLabelText(text) {
    if (!text) return "";
    return text
      .replace(/[*✱]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .replace(/\(required\)/i, "")
      .replace(/\(optional\)/i, "");
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
      element.scrollIntoView();
    }
  }

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
    this.logger("🔄 Form handler state reset");
  }

  /**
   * Check if form with current identifier was already processed
   */
  wasFormProcessed() {
    const formId = this.getFormIdentifier();
    return this.processedForms.has(formId);
  }
}
