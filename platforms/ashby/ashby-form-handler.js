// platforms/ashby/ashby-form-handler.js
import { AIService } from "../../services/index.js";
import Utils from "../../utils/utils.js";

export class AshbyFormHandler {
  constructor(options = {}) {
    this.logger = options.logger || console.log;
    this.host = options.host || "http://localhost:3000";
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
      this.logger(
        `✅ Textarea value set successfully: ${cleanedValue.substring(
          0,
          50
        )}...`
      );
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
      this.logger("Finding all Ashby form fields");
      const fields = [];

      // Find all field entries (they're not inside a form element)
      const fieldEntries = document.querySelectorAll(
        "._fieldEntry_hkyf8_29, .ashby-application-form-field-entry"
      );

      this.logger(`Found ${fieldEntries.length} Ashby field entries`);

      for (const fieldEntry of fieldEntries) {
        if (!this.isElementVisible(fieldEntry)) continue;

        const fieldInfo = this.analyzeAshbyField(fieldEntry);
        if (fieldInfo) {
          // Skip "If other, please provide context" fields
          if (this.shouldSkipField(fieldInfo.label)) {
            this.logger(`Skipping field: ${fieldInfo.label}`);
            continue;
          }

          fields.push(fieldInfo);
          this.logger(`Added field: ${fieldInfo.label} (${fieldInfo.type})`);
        }
      }

      return fields;
    } catch (error) {
      this.logger(`Error getting Ashby form fields: ${error.message}`);
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
      this.logger(`Error analyzing Ashby field: ${error.message}`);
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
      'input[type="text"], input[type="email"], input[type="tel"], textarea'
    );
    if (textInput) {
      return {
        type:
          textInput.tagName.toLowerCase() === "textarea" ? "textarea" : "text",
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
        case "text":
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
        this.logger(
          `✅ Successfully filled ${fieldInfo.type} field: ${fieldInfo.label}`
        );
      } else {
        this.logger(
          `❌ Failed to fill ${fieldInfo.type} field: ${fieldInfo.label}`
        );
      }

      return success;
    } catch (error) {
      this.logger(
        `❌ Error filling field ${fieldInfo.label}: ${error.message}`
      );
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
      this.logger("❌ No autocomplete input found");
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
      this.logger(
        "🔧 Special handling: Using LinkedIn for 'How did you hear' field"
      );
    } else if (isLocationField) {
      // For location fields, use the provided location data
      this.logger(`🔧 Location field detected: "${fieldInfo.label}"`);
      this.logger(`🔧 Using location data: "${searchValue}"`);
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

    // Type character by character to trigger autocomplete
    this.logger(`🔤 Typing "${searchValue}" character by character...`);
    for (let i = 0; i < searchValue.length; i++) {
      const currentValue = searchValue.substring(0, i + 1);
      nativeInputValueSetter.call(input, currentValue);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("keyup", { bubbles: true }));

      this.logger(`🔤 Typed: "${currentValue}"`);
      await this.wait(50);
    }

    // Wait longer for options to appear (especially for location)
    this.logger("⏳ Waiting for autocomplete options to appear...");
    await this.wait(1200);

    // Look for the results container
    const resultsContainer = document.querySelector(
      "._resultContainer_v5ami_112"
    );

    this.logger(`✅ Found results container: ._resultContainer_v5ami_112`);
    return await this.selectFromAutocompleteOptions(
      resultsContainer,
      searchValue,
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
    this.logger(`📋 Found ${options.length} autocomplete options`);

    if (options.length === 0) {
      this.logger("❌ No options found in results container");

      // Log the container content for debugging
      this.logger(
        `🔍 Container HTML: ${resultsContainer.innerHTML.substring(0, 200)}...`
      );
      return false;
    }

    // Log all available options for debugging
    options.forEach((option, index) => {
      this.logger(`📝 Option ${index}: "${option.textContent.trim()}"`);
    });

    // Find best matching option
    let bestMatch = null;
    let bestScore = 0;
    const searchValueLower = searchValue.toLowerCase();

    for (const option of options) {
      const optionText = option.textContent.trim().toLowerCase();
      let score = 0;

      this.logger(
        `🔍 Checking option: "${optionText}" against "${searchValueLower}"`
      );

      // Exact match gets highest priority
      if (optionText === searchValueLower) {
        bestMatch = option;
        bestScore = 100;
        this.logger(`✅ EXACT match found: "${optionText}"`);
        break;
      }

      // For LinkedIn/How did you hear, match if option contains "linkedin"
      if (
        isHowDidYouHear &&
        searchValueLower === "linkedin" &&
        optionText.includes("linkedin")
      ) {
        bestMatch = option;
        bestScore = 95;
        this.logger(`✅ LinkedIn match found: "${optionText}"`);
        break;
      }

      // For location fields, use more flexible matching
      if (isLocationField) {
        // Split search value into parts (e.g., "New York, NY" -> ["new", "york", "ny"])
        const searchParts = searchValueLower
          .split(/[,\s]+/)
          .filter((part) => part.length > 0);
        let locationScore = 0;
        let matchedParts = 0;

        for (const part of searchParts) {
          if (optionText.includes(part)) {
            matchedParts++;
            if (optionText.startsWith(part)) {
              locationScore += 20; // Higher score for prefix matches
            } else {
              locationScore += 10; // Lower score for contains matches
            }
          }
        }

        // Bonus if all parts match
        if (matchedParts === searchParts.length) {
          locationScore += 30;
        }

        score = locationScore;
        this.logger(
          `🌍 Location match score for "${optionText}": ${score} (${matchedParts}/${searchParts.length} parts matched)`
        );
      } else {
        // Standard matching for non-location fields
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
        this.logger(`🎯 New best match: "${optionText}" (score: ${score})`);
      }
    }

    if (bestMatch) {
      const selectedText = bestMatch.textContent.trim();
      this.logger(
        `🎯 Selecting best match: "${selectedText}" (score: ${bestScore})`
      );

      // Scroll to the option and click it
      this.scrollToElement(bestMatch);
      await this.wait(200);

      // Try multiple click methods
      bestMatch.focus();
      await this.wait(100);

      bestMatch.click();
      bestMatch.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true })
      );

      await this.wait(500);

      // Verify selection by checking if the input value changed
      const input = document.querySelector(
        'input[role="combobox"], input[placeholder="Start typing..."]'
      );
      if (
        input &&
        input.value &&
        input.value.includes(selectedText.split(",")[0])
      ) {
        this.logger(`✅ Successfully selected: "${selectedText}"`);
        return true;
      } else {
        this.logger(
          `⚠️ Selection may not have registered. Input value: "${input?.value}"`
        );

        // Try setting the value directly as fallback
        if (input) {
          const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
            window.HTMLInputElement.prototype,
            "value"
          ).set;
          nativeInputValueSetter.call(input, selectedText);
          input.dispatchEvent(new Event("input", { bubbles: true }));
          input.dispatchEvent(new Event("change", { bubbles: true }));
          this.logger(
            `🔧 Fallback: Set input value directly to "${selectedText}"`
          );
        }

        return true; // Consider it successful since we tried our best
      }
    } else {
      this.logger(`❌ No suitable match found for "${searchValue}"`);

      // Log all available options one more time for debugging
      this.logger("📋 Available options were:");
      options.forEach((option, index) => {
        this.logger(`   ${index + 1}. "${option.textContent.trim()}"`);
      });

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
          this.logger(
            `✅ Successfully selected radio option: ${bestMatch.label.textContent.trim()}`
          );
        } else {
          this.logger(
            `⚠️ Radio selection may not have registered: ${bestMatch.label.textContent.trim()}`
          );

          // Final attempt: Force the selection
          bestMatch.radio.checked = true;
          bestMatch.radio.setAttribute("checked", "checked");
        }
      } else {
        this.logger(
          `Radio option already selected: ${bestMatch.label.textContent.trim()}`
        );
      }
      return true;
    }

    this.logger(`❌ No matching radio option found for: ${valueStr}`);
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
          this.logger(
            `✅ Successfully checked option: ${label.textContent.trim()}`
          );
        } else {
          this.logger(
            `⚠️ Checkbox selection may not have registered: ${label.textContent.trim()}`
          );

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
      this.logger(`✅ Successfully selected ${selectedCount} checkbox options`);
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
      this.logger(`📍 Using streetAddress: "${location}"`);
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
      this.logger(`📍 Constructed location from parts: "${location}"`);
      return location;
    }

    // Method 3: State and country only
    if (userData.state) {
      location = userData.state;
      if (userData.country && userData.country !== "United States") {
        location += ", " + userData.country;
      }
      this.logger(`📍 Using state: "${location}"`);
      return location;
    }

    // Method 4: Country only
    if (userData.country) {
      location = userData.country;
      this.logger(`📍 Using country only: "${location}"`);
      return location;
    }

    this.logger("⚠️ No location data found in user profile");
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
      /location/i,
      /address/i,
      /where.*live/i,
      /residence/i,
    ];

    const isLocation = locationPatterns.some((pattern) => pattern.test(label));
    if (isLocation) {
      this.logger(`🌍 Detected location field: "${label}"`);
    }
    return isLocation;
  }

  /**
   * Fill form with user profile data using AI
   */
  async fillFormWithProfile(profile) {
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

      // FIXED: Generate unique form identifier
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

      this.logger("Filling Ashby form with user profile data");
      this.userData = profile;
      const formFields = this.getAllFormFields();
      this.logger(`Found ${formFields.length} form fields to process`);

      let filledCount = 0;

      for (const field of formFields) {
        if (!field.label || field.type === "file") continue;

        try {
          this.logger(`Processing field: ${field.label} (${field.type})`);

          const fieldContext = this.buildFieldContext(field);
          let answer;

          // Special handling for "How did you hear" field
          if (field.label.toLowerCase().includes("how did you hear")) {
            answer = "LinkedIn";
            this.logger(`Using LinkedIn for "How did you hear" field`);
          }
          // Special handling for Location fields - use user data directly
          else if (this.isLocationField(field.label)) {
            answer = this.getUserLocationData();
            this.logger(
              `Using user location data for "${field.label}": ${answer}`
            );
          }
          // Use AI for other fields
          else {
            // FIXED: Ensure proper async sequencing
            this.logger(`Requesting AI answer for "${field.label}"`);
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
              this.logger(`No answer received for "${field.label}"`);
            }
          }

          if (answer) {
            // FIXED: Log before filling, not after async completion
            this.logger(
              `Filling ${field.type} field: ${field.label} with: ${answer}`
            );

            const success = await this.fillAshbyField(field, answer);
            if (success) {
              filledCount++;
              this.logger(`✅ Successfully filled field: ${field.label}`);
            } else {
              this.logger(`❌ Failed to fill field: ${field.label}`);
            }
          } else {
            this.logger(
              `⚠️ Skipping field "${field.label}" - no answer available`
            );
          }

          // FIXED: Longer wait between fields to prevent race conditions
          await this.wait(500);
        } catch (fieldError) {
          this.logger(
            `Error processing field "${field.label}": ${fieldError.message}`
          );
        }
      }

      // FIXED: Mark form as processed after successful completion
      this.processedForms.add(formId);
      this.logger(`Successfully filled ${filledCount} fields`);

      // // FIXED: Debug form state after filling
      // this.debugFormState();

      return true;
    } catch (error) {
      this.logger(`Error filling form: ${error.message}`);
      return false;
    } finally {
      this.fillInProgress = false;
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

      // Include URL to make identifier more specific
      const url = window.location.href.split("?")[0]; // Remove query params

      return btoa(url + "|" + fieldLabels).substring(0, 32); // Base64 encode for unique ID
    } catch (error) {
      // Fallback to URL-based identifier
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
      return false; // Default to not filled on error
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
   * Get AI answer for a form field - FIXED async handling
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

      console.log({
        platform: "ashby",
        userData: this.utils.getUserDetailsForContext(this.userData),
        jobDescription: this.jobDescription,
        fieldType,
        fieldContext,
      });

      // FIXED: Properly await the AI service call
      const answer = await this.aiService.getAnswer(question, options, {
        platform: "ashby",
        userData: this.utils.getUserDetailsForContext(this.userData),
        jobDescription: this.jobDescription,
        fieldType,
        fieldContext,
      });

      // FIXED: Only cache and return valid answers
      if (answer !== null && answer !== undefined && answer !== "") {
        this.answerCache.set(cacheKey, answer);
        return answer;
      } else {
        this.logger(`AI returned empty answer for "${question}"`);
        return null;
      }
    } catch (error) {
      this.logger(
        `Error getting AI answer for "${question}": ${error.message}`
      );

      // FIXED: Return fallback answer instead of undefined
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
      case "yesno":
        return "No";
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
      case "autocomplete":
        return options.length > 0 ? options[0] : "";
      default:
        return "I prefer not to answer";
    }
  }

  /**
   * Submit the form
   */
  async submitForm() {
    try {
      this.logger("Looking for submit button");

      // FIXED: Use the specific class that works
      let submitButton = document.querySelector(
        ".ashby-application-form-submit-button"
      );

      if (!submitButton) {
        // Fallback 1: Look for button with Submit Application text
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

      this.logger(
        `✅ Found submit button with classes: ${submitButton.className}`
      );
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
          this.logger("Form submission successful - success container found");
          return true;
        }
      }

      // Alternative check for success elements
      const successElement = document.querySelector(
        '[role="status"][aria-live="polite"] h2:contains("Success")'
      );

      if (successElement) {
        this.logger(
          "Form submission successful - alternative success element found"
        );
        return true;
      }

      this.logger("No success indicator found");
      return false;
    } catch (error) {
      this.logger(`Error checking submission success: ${error.message}`);
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
      const isSuccessful = this.checkSubmissionSuccess();

      return {
        success: isSuccessful,
        message: isSuccessful
          ? "Form submitted successfully"
          : "Form submitted but success status unclear",
      };
    } catch (error) {
      this.logger(`Error in submitAndVerify: ${error.message}`);
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

  /**
   * Debug method to check current state of form fields
   */
  debugFormState() {
    try {
      const formFields = this.getAllFormFields();
      this.logger("=== FORM STATE DEBUG ===");

      for (const field of formFields) {
        if (field.type === "radio") {
          const radios = field.element.querySelectorAll('input[type="radio"]');
          const checkedRadio = field.element.querySelector(
            'input[type="radio"]:checked'
          );
          this.logger(
            `Radio field "${field.label}": ${radios.length} options, ${
              checkedRadio ? "CHECKED: " + checkedRadio.value : "NONE CHECKED"
            }`
          );
        } else if (field.type === "checkbox") {
          const checkboxes = field.element.querySelectorAll(
            'input[type="checkbox"]'
          );
          const checkedBoxes = field.element.querySelectorAll(
            'input[type="checkbox"]:checked'
          );
          this.logger(
            `Checkbox field "${field.label}": ${checkboxes.length} options, ${checkedBoxes.length} checked`
          );
        } else if (field.type === "yesno") {
          const buttons = field.element.querySelectorAll(
            "button, ._option_y2cw4_33"
          );
          let selectedButton = null;
          for (const btn of buttons) {
            if (
              btn.getAttribute("aria-pressed") === "true" ||
              btn.classList.contains("selected") ||
              btn.classList.contains("active")
            ) {
              selectedButton = btn.textContent.trim();
              break;
            }
          }
          this.logger(
            `YesNo field "${field.label}": ${buttons.length} buttons, ${
              selectedButton ? "SELECTED: " + selectedButton : "NONE SELECTED"
            }`
          );
        }
      }
      this.logger("=== END FORM STATE DEBUG ===");
    } catch (error) {
      this.logger(`Error in debugFormState: ${error.message}`);
    }
  }
}

// async fillCheckboxField(element, value) {
//   try {
//     const shouldCheck =
//       value === true ||
//       value === "true" ||
//       value === "yes" ||
//       value === "on" ||
//       value === 1;

//     let checkboxInput = element;
//     if (element.tagName.toLowerCase() !== "input") {
//       checkboxInput = element.querySelector('input[type="checkbox"]');

//       if (!checkboxInput) {
//         if (element.getAttribute("role") === "checkbox") {
//           const isChecked = element.getAttribute("aria-checked") === "true";

//           if ((shouldCheck && !isChecked) || (!shouldCheck && isChecked)) {
//             this.scrollToElement(element);
//             element.click();
//             await this.wait(200);
//           }
//           return true;
//         }

//         const customCheckbox = element.querySelector(".checkbox");
//         if (customCheckbox) {
//           this.scrollToElement(customCheckbox);
//           customCheckbox.click();
//           await this.wait(200);
//           return true;
//         }
//       }

//       if (!checkboxInput) return false;
//     }

//     if (
//       (shouldCheck && !checkboxInput.checked) ||
//       (!shouldCheck && checkboxInput.checked)
//     ) {
//       this.scrollToElement(checkboxInput);

//       const labelEl =
//         checkboxInput.closest("label") ||
//         document.querySelector(`label[for="${checkboxInput.id}"]`);

//       if (labelEl) {
//         labelEl.click();
//       } else {
//         checkboxInput.click();
//       }

//       await this.wait(200);

//       if (checkboxInput.checked !== shouldCheck) {
//         checkboxInput.checked = shouldCheck;
//         checkboxInput.dispatchEvent(new Event("change", { bubbles: true }));
//       }
//     }

//     return true;
//   } catch (error) {
//     this.logger(`Error filling checkbox field: ${error.message}`);
//     return false;
//   }
// }

// /**
//  * Fill a radio button field
//  */
// async fillRadioField(element, value) {
//   try {
//     const valueStr = String(value).toLowerCase();

//     // Handle Ashby's radio groups
//     if (
//       element.classList.contains("radio-group") ||
//       element.closest(".radio-group")
//     ) {
//       const container = element.classList.contains("radio-group")
//         ? element
//         : element.closest(".radio-group");

//       const radioLabels = container.querySelectorAll("label");

//       let matchingLabel = null;

//       for (const label of radioLabels) {
//         const labelText = label.textContent.trim().toLowerCase();

//         if (
//           labelText === valueStr ||
//           labelText.includes(valueStr) ||
//           valueStr.includes(labelText) ||
//           (valueStr === "yes" && labelText === "yes") ||
//           (valueStr === "no" && labelText === "no")
//         ) {
//           matchingLabel = label;
//           break;
//         }
//       }

//       if (
//         !matchingLabel &&
//         (valueStr === "yes" ||
//           valueStr === "no" ||
//           valueStr === "true" ||
//           valueStr === "false")
//       ) {
//         const isYes = valueStr === "yes" || valueStr === "true";

//         if (isYes && radioLabels.length > 0) {
//           matchingLabel = radioLabels[0];
//         } else if (!isYes && radioLabels.length > 1) {
//           matchingLabel = radioLabels[1];
//         }
//       }

//       if (!matchingLabel && radioLabels.length > 0) {
//         matchingLabel = radioLabels[0];
//       }

//       if (matchingLabel) {
//         this.scrollToElement(matchingLabel);
//         matchingLabel.click();
//         await this.wait(300);
//         return true;
//       }
//     }

//     // Handle standard radio groups
//     if (
//       element.getAttribute("role") === "radiogroup" ||
//       (element.tagName === "FIELDSET" &&
//         element.getAttribute("role") === "radiogroup")
//     ) {
//       const radios = element.querySelectorAll(
//         '[role="radio"], input[type="radio"]'
//       );
//       if (!radios.length) return false;

//       let matchingRadio = null;

//       for (const radio of radios) {
//         const label =
//           radio.closest("label") ||
//           document.querySelector(`label[for="${radio.id}"]`);

//         if (label) {
//           const labelText = label.textContent.trim().toLowerCase();

//           if (
//             labelText === valueStr ||
//             labelText.includes(valueStr) ||
//             valueStr.includes(labelText) ||
//             (valueStr === "yes" && labelText === "yes") ||
//             (valueStr === "no" && labelText === "no")
//           ) {
//             matchingRadio = radio;
//             break;
//           }
//         }
//       }

//       if (
//         !matchingRadio &&
//         (valueStr === "yes" ||
//           valueStr === "no" ||
//           valueStr === "true" ||
//           valueStr === "false")
//       ) {
//         const isYes = valueStr === "yes" || valueStr === "true";

//         if (isYes && radios.length > 0) {
//           matchingRadio = radios[0];
//         } else if (!isYes && radios.length > 1) {
//           matchingRadio = radios[1];
//         }
//       }

//       if (!matchingRadio && radios.length > 0) {
//         matchingRadio = radios[0];
//       }

//       if (matchingRadio) {
//         this.scrollToElement(matchingRadio);

//         const label =
//           matchingRadio.closest("label") ||
//           document.querySelector(`label[for="${matchingRadio.id}"]`);
//         if (label) {
//           label.click();
//         } else {
//           matchingRadio.click();
//         }

//         await this.wait(300);
//         return true;
//       }
//     }

//     return false;
//   } catch (error) {
//     this.logger(`Error filling radio field: ${error.message}`);
//     return false;
//   }
// }
