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
   * Get label for individual radio/checkbox options
   */
  getFieldLabelForOption(element) {
    try {
      // Method 1: Check for Lever's application-answer-alternative
      const leverOption = element.parentElement?.querySelector(
        ".application-answer-alternative"
      );
      if (leverOption) {
        return leverOption.textContent.trim();
      }

      // Method 2: Parent label
      const parentLabel = element.closest("label");
      if (parentLabel) {
        const clone = parentLabel.cloneNode(true);
        // Remove input elements from clone to get just label text
        clone.querySelectorAll("input").forEach((el) => el.remove());
        return this.cleanLabelText(clone.textContent);
      }

      // Method 3: Following sibling text
      let sibling = element.nextSibling;
      while (sibling) {
        if (sibling.nodeType === Node.TEXT_NODE && sibling.textContent.trim()) {
          return this.cleanLabelText(sibling.textContent);
        }
        if (sibling.nodeType === Node.ELEMENT_NODE) {
          const text = sibling.textContent.trim();
          if (text) {
            return this.cleanLabelText(text);
          }
        }
        sibling = sibling.nextSibling;
      }

      return "";
    } catch (error) {
      this.logger(`Error getting option label: ${error.message}`);
      return "";
    }
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
      // Method 1: Check for Lever's application-label structure
      const leverContainer = element.closest(".application-question");
      if (leverContainer) {
        // First try direct application-label
        const directLabel = leverContainer.querySelector(".application-label");
        if (directLabel && !directLabel.querySelector(".text")) {
          return this.cleanLabelText(directLabel.textContent);
        }

        // Then try application-label with nested text div
        const nestedTextLabel = leverContainer.querySelector(
          ".application-label .text"
        );
        if (nestedTextLabel) {
          return this.cleanLabelText(nestedTextLabel.textContent);
        }
      }

      // Method 2: Check for Lever's label structure (legacy)
      const leverLabel = element
        .closest(".lever-form-field")
        ?.querySelector("label");
      if (leverLabel) {
        return this.cleanLabelText(leverLabel.textContent);
      }

      // Method 3: Check for data-qa attributes
      const dataQaContainer = element.closest('[data-qa*="field"]');
      if (dataQaContainer) {
        const label = dataQaContainer.querySelector(
          "label, .form-label, .field-label"
        );
        if (label) {
          return this.cleanLabelText(label.textContent);
        }
      }

      // Method 4: Standard HTML label association
      if (element.id) {
        const label = document.querySelector(`label[for="${element.id}"]`);
        if (label) {
          return this.cleanLabelText(label.textContent);
        }
      }

      // Method 5: Parent label
      const parentLabel = element.closest("label");
      if (parentLabel) {
        const clone = parentLabel.cloneNode(true);
        // Remove input elements from clone to get just label text
        clone
          .querySelectorAll("input, select, textarea")
          .forEach((el) => el.remove());
        return this.cleanLabelText(clone.textContent);
      }

      // Method 6: Preceding label or text in container
      const container =
        element.closest(".form-group, .field-group, .lever-form-field") ||
        element.parentElement;
      if (container) {
        const label = container.querySelector("label, .label, .field-label");
        if (label && !label.contains(element)) {
          return this.cleanLabelText(label.textContent);
        }
      }

      // Method 7: Aria-label
      if (element.getAttribute("aria-label")) {
        return this.cleanLabelText(element.getAttribute("aria-label"));
      }

      // Method 8: Placeholder as fallback
      if (element.placeholder) {
        return this.cleanLabelText(element.placeholder);
      }

      // Method 9: Name attribute
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
      
      // Check for location autocomplete field
      if (this.isLocationField(element)) return "location";
      
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
   * Check if element is a location autocomplete field
   */
  isLocationField(element) {
    // Check for Lever location input characteristics
    return (
      element.classList.contains("location-input") ||
      element.getAttribute("data-qa") === "location-input" ||
      element.id === "location-input" ||
      (element.name === "location" && 
       element.parentElement?.querySelector('input[name="selectedLocation"]'))
    );
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

    try {
      if (element.tagName.toLowerCase() === "select") {
        const optionElements = element.querySelectorAll("option");
        optionElements.forEach((option) => {
          const text = option.textContent.trim();
          if (
            text &&
            !text.toLowerCase().includes("select") &&
            text !== "---" &&
            option.value !== ""
          ) {
            options.push(text);
          }
        });
      } else if (element.type === "radio" || element.type === "checkbox") {
        const name = element.name;
        if (name) {
          // Find all elements with the same name
          const relatedElements = document.querySelectorAll(
            `input[name="${name}"]`
          );

          relatedElements.forEach((relatedElement) => {
            // Method 1: Look for Lever's application-answer-alternative
            const leverOption = relatedElement.parentElement?.querySelector(
              ".application-answer-alternative"
            );
            if (leverOption) {
              const text = leverOption.textContent.trim();
              if (text) {
                options.push(text);
              }
              return;
            }

            // Method 2: Traditional label approach
            const label = this.getFieldLabelForOption(relatedElement);
            if (label) {
              options.push(label);
            }
          });
        }
      }
    } catch (error) {
      this.logger(`Error getting field options: ${error.message}`);
    }

    // Remove duplicates
    return [...new Set(options)];
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
        case "location":
          return await this.fillLocationField(element, value);

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
   * Fill location autocomplete field
   */
  async fillLocationField(element, value) {
    try {
      this.logger(`Filling location field with: ${value}`);
      
      // Scroll to and focus the input
      this.scrollToElement(element);
      element.focus();
      await this.wait(500);

      // Find the dropdown container
      const container = element.closest(".application-question") || element.parentElement;
      const dropdownContainer = container?.querySelector(".dropdown-container");
      
      if (!dropdownContainer) {
        this.logger("No dropdown container found for location field");
        return false;
      }

      // Clear any existing value first
      element.value = "";
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("keydown", { bubbles: true }));
      element.dispatchEvent(new Event("keyup", { bubbles: true }));
      await this.wait(300);

      // Type the location character by character to trigger autocomplete
      const locationValue = String(value);
      this.logger(`Starting to type: "${locationValue}"`);
      
      for (let i = 0; i < locationValue.length; i++) {
        const currentValue = locationValue.substring(0, i + 1);
        
        // Set the value
        element.value = currentValue;
        
        // Create and dispatch keyboard events to mimic real typing
        const keydownEvent = new KeyboardEvent("keydown", {
          key: locationValue[i],
          code: `Key${locationValue[i].toUpperCase()}`,
          bubbles: true,
          cancelable: true
        });
        
        const keyupEvent = new KeyboardEvent("keyup", {
          key: locationValue[i],
          code: `Key${locationValue[i].toUpperCase()}`,
          bubbles: true,
          cancelable: true
        });
        
        const inputEvent = new Event("input", { bubbles: true });
        
        // Dispatch events in proper order
        element.dispatchEvent(keydownEvent);
        element.dispatchEvent(inputEvent);
        element.dispatchEvent(keyupEvent);
        
        this.logger(`Typed: "${currentValue}"`);
        await this.wait(300); // Very slow typing
        
        // Check if dropdown appeared early
        const dropdownResults = dropdownContainer.querySelector(".dropdown-results");
        if (dropdownResults && dropdownResults.children.length > 0 && 
            window.getComputedStyle(dropdownContainer).display !== "none") {
          this.logger("Dropdown appeared early, stopping typing");
          break;
        }
      }

      // Wait for dropdown results to load
      this.logger("Waiting for location dropdown results...");
      let attempts = 0;
      const maxAttempts = 25; // Wait up to 5 seconds
      
      while (attempts < maxAttempts) {
        const dropdownResults = dropdownContainer.querySelector(".dropdown-results");
        const loadingElement = dropdownContainer.querySelector(".dropdown-loading-results");
        const noResultsElement = dropdownContainer.querySelector(".dropdown-no-results");
        
        // Check if loading is complete
        const isLoading = loadingElement && 
          window.getComputedStyle(loadingElement).display !== "none";
        
        // Check if we have results
        const hasResults = dropdownResults && 
          dropdownResults.children.length > 0 &&
          window.getComputedStyle(dropdownContainer).display !== "none";
        
        // Check if no results found
        const hasNoResults = noResultsElement &&
          window.getComputedStyle(noResultsElement).display !== "none";

        this.logger(`Attempt ${attempts + 1}: Loading: ${isLoading}, HasResults: ${hasResults}, NoResults: ${hasNoResults}`);

        if (!isLoading && (hasResults || hasNoResults)) {
          if (hasResults) {
            this.logger(`Found dropdown results container with ${dropdownResults.children.length} children`);
            
            // Debug: Log the actual HTML structure
            this.logger(`Dropdown results HTML: ${dropdownResults.innerHTML.substring(0, 500)}`);
            
            // Get all clickable elements inside dropdown-results
            const options = Array.from(dropdownResults.children);
            
            // If no direct children, look for specific selectors
            if (options.length === 0) {
              const alternativeOptions = Array.from(dropdownResults.querySelectorAll('*'));
              this.logger(`No direct children found, checking all descendants: ${alternativeOptions.length}`);
              
              // Log each descendant to understand structure
              alternativeOptions.forEach((elem, idx) => {
                if (elem.textContent.trim()) {
                  this.logger(`  Descendant ${idx}: <${elem.tagName}> "${elem.textContent.trim().substring(0, 100)}"`);
                }
              });
              
              // Use descendants that have text content and look clickable
              options.push(...alternativeOptions.filter(elem => 
                elem.textContent.trim() && 
                (elem.onclick || elem.getAttribute('onclick') || 
                 elem.classList.contains('cursor-pointer') ||
                 elem.style.cursor === 'pointer' ||
                 elem.getAttribute('role') === 'option' ||
                 elem.hasAttribute('data-value') ||
                 elem.tagName.toLowerCase() === 'button' ||
                 elem.tagName.toLowerCase() === 'a')
              ));
            }
            
            this.logger(`Total options to evaluate: ${options.length}`);
            
            // Log each option for debugging
            options.forEach((option, idx) => {
              this.logger(`Raw option ${idx + 1}: "${option.textContent.trim().substring(0, 100)}" (tag: ${option.tagName})`);
            });
            
            if (options.length === 0) {
              this.logger("No valid options found in dropdown!");
              return false;
            }
            
            // Look for the best matching option
            options = Array.from(dropdownResults.children);
            let bestMatch = null;
            let bestScore = 0;
            
            const searchValue = locationValue.toLowerCase().trim();
            this.logger(`Searching for: "${searchValue}" among ${options.length} options`);
            
            for (let i = 0; i < options.length; i++) {
              const option = options[i];
              const optionText = option.textContent.trim().toLowerCase();
              let score = 0;
              
              this.logger(`Option ${i + 1}: "${optionText}"`);
              
              // Exact match gets highest score
              if (optionText === searchValue) {
                score = 1000;
                this.logger(`  → Exact match! Score: ${score}`);
              }
              // Starts with search value (very high priority for locations)
              else if (optionText.startsWith(searchValue)) {
                score = 900;
                this.logger(`  → Starts with search! Score: ${score}`);
              }
              // Search value starts with option (good for partial typing)
              else if (searchValue.startsWith(optionText)) {
                score = 850;
                this.logger(`  → Search starts with option! Score: ${score}`);
              }
              // Contains search value
              else if (optionText.includes(searchValue)) {
                score = 700;
                this.logger(`  → Contains search! Score: ${score}`);
              }
              // Word-by-word matching (important for cities with country/state)
              else {
                const searchWords = searchValue.split(/[,\s]+/).filter(w => w.length > 0);
                const optionWords = optionText.split(/[,\s]+/).filter(w => w.length > 0);
                let exactWordMatches = 0;
                let partialWordMatches = 0;
                
                // Check for exact word matches first
                for (const searchWord of searchWords) {
                  for (const optionWord of optionWords) {
                    if (searchWord === optionWord) {
                      exactWordMatches++;
                      break;
                    }
                  }
                }
                
                // Check for partial word matches
                for (const searchWord of searchWords) {
                  for (const optionWord of optionWords) {
                    if (searchWord !== optionWord && 
                        (optionWord.includes(searchWord) || searchWord.includes(optionWord))) {
                      partialWordMatches++;
                      break;
                    }
                  }
                }
                
                // Calculate score based on word matches
                const totalSearchWords = searchWords.length;
                if (exactWordMatches > 0) {
                  score = (exactWordMatches / totalSearchWords) * 600 + (partialWordMatches * 50);
                } else if (partialWordMatches > 0) {
                  score = (partialWordMatches / totalSearchWords) * 400;
                }
                
                this.logger(`  → Word matching: ${exactWordMatches} exact, ${partialWordMatches} partial. Score: ${score}`);
              }
              
              // Boost score if this is the first option (often the best match)
              if (i === 0 && score > 0) {
                score += 50;
                this.logger(`  → First option bonus! New score: ${score}`);
              }
              
              if (score > bestScore) {
                bestScore = score;
                bestMatch = option;
                this.logger(`  → NEW BEST MATCH! Score: ${score}`);
              }
            }
            
            this.logger(`Final best match: "${bestMatch?.textContent.trim()}" with score: ${bestScore}`);
            
            if (bestMatch && bestScore > 0) {
              this.logger(`Selecting location option: "${bestMatch.textContent.trim()}" (score: ${bestScore})`);
              
              // Ensure the field is still focused and the dropdown is visible
              element.focus();
              await this.wait(200);
              
              // Try multiple click methods to ensure selection works
              try {
                // Method 1: Direct click
                bestMatch.click();
                await this.wait(300);
                
                // Check if selection worked
                let hiddenLocationInput = container?.querySelector('input[name="selectedLocation"]');
                if (hiddenLocationInput && hiddenLocationInput.value) {
                  this.logger("Selection successful with direct click");
                  return true;
                }
                
                // Method 2: Mouse events if direct click didn't work
                this.logger("Direct click didn't work, trying mouse events");
                const mousedownEvent = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
                const mouseupEvent = new MouseEvent('mouseup', { bubbles: true, cancelable: true });
                const clickEvent = new MouseEvent('click', { bubbles: true, cancelable: true });
                
                bestMatch.dispatchEvent(mousedownEvent);
                await this.wait(50);
                bestMatch.dispatchEvent(mouseupEvent);
                await this.wait(50);
                bestMatch.dispatchEvent(clickEvent);
                await this.wait(500);
                
                // Check again
                hiddenLocationInput = container?.querySelector('input[name="selectedLocation"]');
                if (hiddenLocationInput && hiddenLocationInput.value) {
                  this.logger("Selection successful with mouse events");
                  return true;
                }
                
                // Method 3: Try to trigger selection by setting focus on the option
                this.logger("Mouse events didn't work, trying focus approach");
                if (bestMatch.focus) {
                  bestMatch.focus();
                  await this.wait(100);
                }
                
                // Simulate Enter key press
                const enterEvent = new KeyboardEvent('keydown', {
                  key: 'Enter',
                  code: 'Enter',
                  keyCode: 13,
                  which: 13,
                  bubbles: true,
                  cancelable: true
                });
                
                bestMatch.dispatchEvent(enterEvent);
                await this.wait(500);
                
                // Final check
                hiddenLocationInput = container?.querySelector('input[name="selectedLocation"]');
                if (hiddenLocationInput && hiddenLocationInput.value) {
                  this.logger("Selection successful with Enter key");
                  return true;
                }
                
                this.logger("All selection methods failed, but keeping typed value");
                return false;
                
              } catch (clickError) {
                this.logger(`Error during option selection: ${clickError.message}`);
                return false;
              }
            } else {
              this.logger(`No suitable location match found. Best score was: ${bestScore}`);
              // List all available options for debugging
              this.logger("Available options were:");
              options.forEach((opt, idx) => {
                this.logger(`  ${idx + 1}: "${opt.textContent.trim()}"`);
              });
              return false;
            }
          } else {
            this.logger("No location results found for the input");
            return false;
          }
        }
        
        attempts++;
        await this.wait(200);
      }
      
      this.logger("Timeout waiting for location dropdown results");
      return false;
      
    } catch (error) {
      this.logger(`Error filling location field: ${error.message}`);
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
      const optionElements = Array.from(element.options);
      const valueStr = String(value).toLowerCase().trim();

      this.logger(
        `Trying to match "${valueStr}" against ${optionElements.length} options`
      );

      // Find matching option element
      let targetOption = null;

      // Exact text match first
      for (const option of optionElements) {
        const optionText = option.textContent.trim();
        if (optionText.toLowerCase() === valueStr) {
          targetOption = option;
          this.logger(`Exact match found: "${optionText}"`);
          break;
        }
      }

      // Partial text match if no exact match
      if (!targetOption) {
        for (const option of optionElements) {
          const optionText = option.textContent.toLowerCase().trim();
          if (optionText.includes(valueStr) || valueStr.includes(optionText)) {
            targetOption = option;
            this.logger(`Partial match found: "${option.textContent.trim()}"`);
            break;
          }
        }
      }

      // Value match as fallback
      if (!targetOption) {
        for (const option of optionElements) {
          if (option.value.toLowerCase() === valueStr) {
            targetOption = option;
            this.logger(
              `Value match found: "${option.textContent.trim()}" (${
                option.value
              })`
            );
            break;
          }
        }
      }

      if (targetOption) {
        this.scrollToElement(element);
        element.focus();
        element.value = targetOption.value;
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.dispatchEvent(new Event("input", { bubbles: true }));
        await this.wait(100);
        return true;
      }

      this.logger(
        `No matching option found for: "${value}". Available options:`,
        optionElements.map(
          (opt) => `"${opt.textContent.trim()}" (${opt.value})`
        )
      );
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
      // For single checkboxes (like agreements), parse as boolean
      const name = element.name;
      const checkboxes = document.querySelectorAll(
        `input[type="checkbox"][name="${name}"]`
      );

      if (checkboxes.length === 1) {
        // Single checkbox - treat as boolean
        const shouldCheck = this.parseAIBoolean(value);
        if (shouldCheck === null) {
          this.logger(`Unclear AI response for checkbox: ${value}`);
          return false;
        }

        const isCurrentlyChecked = element.checked;

        if (shouldCheck !== isCurrentlyChecked) {
          this.scrollToElement(element);
          element.focus();
          element.click();
          await this.wait(200);
        }

        return true;
      } else {
        // Multiple checkboxes - treat as selection
        const valueStr = String(value).toLowerCase().trim();
        const label = this.getFieldLabelForOption(element);

        if (!label) {
          this.logger(`No label found for checkbox`);
          return false;
        }

        this.logger(
          `Checking if "${valueStr}" matches checkbox option "${label}"`
        );

        // Check if this checkbox should be selected
        const shouldSelect =
          label.toLowerCase().includes(valueStr) ||
          valueStr.includes(label.toLowerCase()) ||
          element.value.toLowerCase() === valueStr;

        if (shouldSelect && !element.checked) {
          this.scrollToElement(element);
          element.focus();
          element.click();
          await this.wait(200);
          this.logger(`Selected checkbox: "${label}"`);
          return true;
        } else if (!shouldSelect && element.checked) {
          // Uncheck if it was checked but shouldn't be
          this.scrollToElement(element);
          element.focus();
          element.click();
          await this.wait(200);
          this.logger(`Deselected checkbox: "${label}"`);
          return true;
        }

        return false;
      }
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
      const valueStr = String(value).toLowerCase().trim();

      this.logger(
        `Trying to match radio "${valueStr}" against ${radioButtons.length} options`
      );

      // Find matching radio button
      let targetRadio = null;

      // Exact text match first
      for (const radio of radioButtons) {
        const label = this.getFieldLabelForOption(radio);
        if (label && label.toLowerCase().trim() === valueStr) {
          targetRadio = radio;
          this.logger(`Exact match found: "${label}"`);
          break;
        }
      }

      // Partial text match
      if (!targetRadio) {
        for (const radio of radioButtons) {
          const label = this.getFieldLabelForOption(radio);
          if (label) {
            const labelText = label.toLowerCase().trim();
            if (labelText.includes(valueStr) || valueStr.includes(labelText)) {
              targetRadio = radio;
              this.logger(`Partial match found: "${label}"`);
              break;
            }
          }
        }
      }

      // Value match
      if (!targetRadio) {
        for (const radio of radioButtons) {
          if (radio.value.toLowerCase() === valueStr) {
            const label = this.getFieldLabelForOption(radio);
            targetRadio = radio;
            this.logger(`Value match found: "${label}" (${radio.value})`);
            break;
          }
        }
      }

      if (targetRadio) {
        this.scrollToElement(targetRadio);
        targetRadio.focus();
        targetRadio.click();
        await this.wait(200);
        return true;
      }

      // Log available options for debugging
      const availableOptions = [];
      for (const radio of radioButtons) {
        const label = this.getFieldLabelForOption(radio);
        if (label) {
          availableOptions.push(`"${label}" (${radio.value})`);
        }
      }

      this.logger(
        `No matching radio option found for: "${value}". Available options:`,
        availableOptions
      );
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