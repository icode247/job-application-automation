// 
import AIService from "../../services/ai-service.js";
// ========================================
// GREENHOUSE FORM HANDLER - UPDATED
// ========================================

export default class GreenhouseFormHandler {
    constructor(options = {}) {
        this.logger = options.logger || console.log;
        this.host = options.host;
        this.userData = options.userData || {};
        this.jobDescription = options.jobDescription || "";
        this.aiService = new AIService({ apiHost: this.host });
        this.answerCache = new Map();
    }

    /**
     * Fill form with user profile data using AI - Greenhouse specific
     */
    async fillFormWithProfile(form, profile) {
        try {
            this.logger("Filling Greenhouse form with user profile data");
            this.userData = profile;

            // Get all form fields using the updated approach
            const formFields = await this.getAllGreenhouseFormFields(form);
            this.logger(`Found ${formFields.length} form fields to process`);

            let filledCount = 0;
            let skippedCount = 0;

            for (const field of formFields) {
                if (this.shouldSkipField(field)) {
                    continue;
                }

                try {
                    this.logger(`Processing field: ${field.label} (${field.type})`);

                    // Get AI answer with options
                    const answer = await this.getAIAnswer(
                        field.label,
                        field.options || [],
                        field.type,
                        this.buildFieldContext(field)
                    );

                    if (answer !== null && answer !== undefined && answer !== "") {
                        const success = await this.fillField(
                            field.element,
                            answer,
                            field.type,
                            field.options
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
     * Get all form fields from a Greenhouse application form using active extraction
     */
    async getAllGreenhouseFormFields(form) {
        try {
            this.logger("Finding all form fields in Greenhouse form with active extraction");

            const fields = [];

            // Find all labels first (like the working code)
            const labels = [...form.querySelectorAll('label')];
            this.logger(`Found ${labels.length} labels to process`);

            for (const label of labels) {
                let element = document.getElementById(label.getAttribute('for'));

                if (!element || !this.isElementVisible(element)) {
                    continue;
                }

                let required = element.getAttribute('aria-required') === 'true' || element.required;
                let labelText = label.innerText.trim();

                // Clean up label text
                if (labelText.endsWith('*')) {
                    labelText = labelText.slice(0, -1).trim();
                    required = true;
                }

                // Skip file uploads and unwanted fields
                if (element.id === 'resume' || element.id === 'cover_letter' || element.type === 'file') {
                    if (element.type === 'file' && required) {
                        this.logger(`Required file field skipped: ${labelText}`);
                    }
                    continue;
                }

                // Handle cover letter text
                if (element.id === 'cover_letter_text') {
                    labelText = "Cover letter";
                }

                // Add country code note for phone fields
                if (labelText.toLowerCase().includes('phone')) {
                    labelText += ' (with country code)';
                }

                const fieldInfo = await this.processFieldElement(element, labelText, required);
                if (fieldInfo) {
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
     * Process individual field element and extract options
     */
    async processFieldElement(element, labelText, required) {
        try {
            if (element.tagName === 'INPUT') {
                if (element.type === 'file') {
                    return null; // Skip file inputs
                }

                // Handle radio/checkbox groups
                if (element.type === 'radio' || element.type === 'checkbox') {
                    return await this.processRadioCheckboxGroup(element, labelText, required);
                }

                // Handle combobox/select elements
                if (element.getAttribute('role') === 'combobox') {
                    return await this.processComboboxField(element, labelText, required);
                }

                // Regular input field
                return {
                    element: element,
                    type: element.type,
                    label: this.cleanLabelText(labelText),
                    required: required,
                    options: []
                };

            } else if (element.tagName === 'TEXTAREA') {
                return {
                    element: element,
                    type: 'textarea',
                    label: this.cleanLabelText(labelText),
                    required: required,
                    options: []
                };
            } else if (element.tagName === 'SELECT') {
                return await this.processSelectField(element, labelText, required);
            }

            return null;
        } catch (error) {
            this.logger(`Error processing field element: ${error.message}`);
            return null;
        }
    }

    /**
     * Process radio/checkbox group using fieldset approach
     */
    async processRadioCheckboxGroup(element, labelText, required) {
        try {
            const fieldset = element.closest('fieldset');
            if (!fieldset) {
                // Single checkbox/radio without fieldset
                return {
                    element: element,
                    type: element.type,
                    label: this.cleanLabelText(labelText),
                    required: required,
                    options: []
                };
            }

            const legend = fieldset.querySelector('legend');
            if (!legend) {
                this.logger('Radio/checkbox group without legend');
                return null;
            }

            // Extract options from all labels in the fieldset
            const optionLabels = [...fieldset.querySelectorAll('label:not(.greenhouse-application-form-question-title)')];
            const options = optionLabels.map(option => this.cleanLabelText(option.innerText));
            const elements = optionLabels.map(option => document.getElementById(option.getAttribute('for'))).filter(Boolean);

            // Only process the first element in the group
            if (!elements || elements[0] !== element) {
                return null;
            }

            let legendText = legend.innerText.trim();
            if (legendText.endsWith('*')) {
                legendText = legendText.slice(0, -1).trim() + ' (you need to select at least one option)';
                required = true;
            }

            return {
                element: elements,
                type: elements[0].type,
                label: this.cleanLabelText(legendText),
                required: required,
                options: options
            };
        } catch (error) {
            this.logger(`Error processing radio/checkbox group: ${error.message}`);
            return null;
        }
    }

    /**
     * Process combobox field with active option extraction
     */
    async processComboboxField(element, labelText, required) {
        try {
            let options = [];

            // Skip location and school fields for option extraction (as per working code)
            const labelLower = labelText.toLowerCase();
            if (!labelLower.startsWith('location') && !labelLower.includes('school')) {
                this.logger(`Extracting options for combobox: ${labelText}`);

                // Scroll to element and trigger dropdown
                this.scrollToElement(element.parentElement);
                await this.wait(200);

                element.dispatchEvent(new Event('mouseup', { bubbles: true }));
                await this.wait(100);

                // Try to get options with retry logic
                for (let attempt = 0; attempt < 7; attempt++) {
                    await this.wait(300);

                    const listboxId = element.getAttribute('aria-controls');
                    if (listboxId) {
                        const listbox = document.getElementById(listboxId);
                        if (listbox) {
                            const listboxItems = listbox.querySelectorAll('div[role=option]');
                            if (listboxItems.length) {
                                options = [...listboxItems].map(option => this.cleanLabelText(option.innerText));
                                this.logger(`Found ${options.length} options for ${labelText}`);
                                break;
                            }

                            // Check for no results indicator
                            if (listbox.querySelector('p')?.parentElement.className.includes('_noResults')) {
                                this.logger(`No results found for ${labelText}`);
                                break;
                            }
                        }
                    }
                }

                // Close dropdown
                element.dispatchEvent(new Event('focusout', { bubbles: true }));
                element.blur();
                await this.wait(300);
            }

            // Add language code note for location fields
            if (labelLower.startsWith('location')) {
                labelText += ` - Please fill in this field in the following language code: ${navigator.language}`;
            }

            return {
                element: element,
                type: 'select',
                label: this.cleanLabelText(labelText),
                required: required,
                options: options
            };
        } catch (error) {
            this.logger(`Error processing combobox field: ${error.message}`);
            return {
                element: element,
                type: 'select',
                label: this.cleanLabelText(labelText),
                required: required,
                options: []
            };
        }
    }

    /**
     * Process regular select field
     */
    async processSelectField(element, labelText, required) {
        try {
            const options = [];
            const optionElements = element.querySelectorAll("option");

            optionElements.forEach((option) => {
                const text = option.textContent.trim();
                if (text && !text.toLowerCase().includes("select") &&
                    text !== "---" && option.value !== "") {
                    options.push(this.cleanLabelText(text));
                }
            });

            return {
                element: element,
                type: 'select',
                label: this.cleanLabelText(labelText),
                required: required,
                options: options
            };
        } catch (error) {
            this.logger(`Error processing select field: ${error.message}`);
            return {
                element: element,
                type: 'select',
                label: this.cleanLabelText(labelText),
                required: required,
                options: []
            };
        }
    }

    /**
     * Get label text for a form field - Updated approach
     */
    getGreenhouseFieldLabel(element) {
        try {
            // This method is now mainly used as fallback
            // Primary label extraction happens in getAllGreenhouseFormFields

            // Standard HTML label association
            if (element.id) {
                const label = document.querySelector(`label[for="${element.id}"]`);
                if (label) {
                    return this.cleanLabelText(label.textContent);
                }
            }

            // Parent label
            const parentLabel = element.closest("label");
            if (parentLabel) {
                const clone = parentLabel.cloneNode(true);
                clone.querySelectorAll("input, select, textarea").forEach((el) => el.remove());
                return this.cleanLabelText(clone.textContent);
            }

            // Aria-label
            if (element.getAttribute("aria-label")) {
                return this.cleanLabelText(element.getAttribute("aria-label"));
            }

            // Placeholder as fallback
            if (element.placeholder) {
                return this.cleanLabelText(element.placeholder);
            }

            return "";
        } catch (error) {
            this.logger(`Error getting field label: ${error.message}`);
            return "";
        }
    }

    /**
     * Fill a form field with the appropriate value - Updated for array elements
     */
    async fillField(element, value, fieldType, options = []) {
        try {
            if (!element || value === undefined || value === null) {
                return false;
            }

            this.logger(`Filling ${fieldType} field with: ${String(value).substring(0, 50)}`);

            // Handle array elements (radio/checkbox groups)
            if (Array.isArray(element)) {
                return await this.fillFieldArray(element, value, fieldType, options);
            }

            switch (fieldType) {
                case "text":
                case "email":
                case "url":
                case "number":
                case "phone":
                    return await this.fillInputField(element, value);

                case "textarea":
                    return await this.fillTextareaField(element, value);

                case "select":
                    if (element.getAttribute('role') === 'combobox') {
                        return await this.fillComboboxField(element, value);
                    } else {
                        return await this.fillSelectField(element, value);
                    }

                case "checkbox":
                case "radio":
                    return await this.fillSingleRadioCheckbox(element, value);

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
     * Fill array of elements (radio/checkbox groups)
     */
    async fillFieldArray(elements, value, fieldType, options = []) {
        try {
            this.scrollToElement(elements[0]);
            await this.wait(200);

            if (!Array.isArray(value)) {
                value = [value];
            }

            let filled = false;

            for (let i = 0; i < elements.length; i++) {
                const el = elements[i];
                const optionText = options[i] || '';

                const shouldSelect = value.some(val => {
                    const valStr = String(val).toLowerCase().trim();
                    const optionStr = optionText.toLowerCase().trim();
                    return optionStr === valStr ||
                        optionStr.includes(valStr) ||
                        valStr.includes(optionStr);
                });

                if (shouldSelect && !el.checked) {
                    el.click();
                    await this.wait(500);
                    filled = true;
                } else if (fieldType === 'checkbox' && el.checked && !shouldSelect) {
                    // Uncheck if it shouldn't be selected
                    el.click();
                    await this.wait(500);
                    filled = true;
                }
            }

            return filled;
        } catch (error) {
            this.logger(`Error filling field array: ${error.message}`);
            return false;
        }
    }

    /**
     * Fill combobox field (like select but with special handling)
     */
    async fillComboboxField(element, value) {
        try {
            this.scrollToElement(element);
            element.focus();
            await this.wait(100);

            // Trigger dropdown
            element.dispatchEvent(new Event('mouseup', { bubbles: true }));
            await this.wait(100);

            // Set value
            element.value = String(value);
            element.dispatchEvent(new Event('input', { bubbles: true }));

            // Try to select from dropdown
            for (let attempt = 0; attempt < 30; attempt++) {
                if (attempt > 10) {
                    // Try with shorter value if no match found
                    const shorterValue = String(value).substring(0, Math.floor(String(value).length / 2));
                    element.value = shorterValue;
                    element.dispatchEvent(new Event('input', { bubbles: true }));
                }

                await this.wait(500);

                const listboxId = element.getAttribute('aria-controls');
                if (listboxId) {
                    const listbox = document.getElementById(listboxId);
                    if (listbox) {
                        const listboxItems = listbox.querySelectorAll('div[role=option]');
                        if (listboxItems.length > 0) {
                            listboxItems[0]?.click();
                            await this.wait(100);
                            break;
                        }
                    }
                }
            }

            element.dispatchEvent(new Event('focusout', { bubbles: true }));
            return true;
        } catch (error) {
            this.logger(`Error filling combobox field: ${error.message}`);
            return false;
        }
    }

    /**
     * Fill single radio/checkbox (not in a group)
     */
    async fillSingleRadioCheckbox(element, value) {
        try {
            const shouldCheck = this.parseAIBoolean(value);

            if (shouldCheck !== null && element.checked !== shouldCheck) {
                this.scrollToElement(element);
                element.focus();
                element.click();
                await this.wait(200);
                return true;
            }

            return false;
        } catch (error) {
            this.logger(`Error filling single radio/checkbox: ${error.message}`);
            return false;
        }
    }

    // ... (keep all the existing utility methods like shouldSkipField, getAIAnswer, 
    // buildFieldContext, cleanLabelText, getFieldType, isFieldRequired, 
    // fillInputField, fillTextareaField, fillSelectField, fillCheckboxField, 
    // fillRadioField, fillDateField, handleRequiredCheckboxes, isAgreementCheckbox, 
    // parseAIBoolean, submitForm, findSubmitButton, isElementVisible, 
    // scrollToElement, wait, etc.)

    /**
     * Check if field should be skipped
     */
    shouldSkipField(field) {
        if (!field.label) return true;

        const labelLower = field.label.toLowerCase();

        // Skip file fields
        if (field.type === "file") {
            this.logger(`Skipping file field: ${field.label}`);
            return true;
        }

        // Skip "Other URL" fields silently
        if (
            labelLower.includes("other url") ||
            labelLower.includes("other website") ||
            labelLower.includes("additional url") ||
            (labelLower === "other" && field.type === "url")
        ) {
            return true;
        }

        return false;
    }

    /**
     * Get AI answer for a form field
     */
    async getAIAnswer(question, options = [], fieldType = "text", fieldContext = "") {
        try {
            const cacheKey = `${question}_${options.join("_")}_${fieldType}`;

            // Check cache first
            if (this.answerCache.has(cacheKey)) {
                return this.answerCache.get(cacheKey);
            }

            this.logger(`Requesting AI answer for: "${question}" with ${options.length} options`);

            // Use standardized AI service
            const context = {
                platform: "greenhouse",
                userData: this.userData,
                jobDescription: this.jobDescription,
                fieldType,
                fieldContext,
                required: fieldContext.includes('required')
            };

            const answer = await this.aiService.getAnswer(question, options, context);

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
            field.element.name ? `Field name: ${field.element.name}` : "",
            field.options && field.options.length > 0 ? `Available options: ${field.options.join(', ')}` : "",
            "Please provide your response based on the user profile data.",
        ]
            .filter(Boolean)
            .join(". ");
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
        if (element.required || element.getAttribute("aria-required") === "true") {
            return true;
        }

        const label = this.getGreenhouseFieldLabel(element);
        if (label && (label.includes("*") || label.includes("required"))) {
            return true;
        }

        const container = element.closest(".field, .form-field, .field-wrapper");
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
     * Fill input field
     */
    async fillInputField(element, value) {
        try {
            this.scrollToElement(element);
            element.focus();
            await this.wait(100);

            element.value = "";
            element.dispatchEvent(new Event("input", { bubbles: true }));
            await this.wait(50);

            element.value = String(value);

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

            this.logger(`Trying to match "${valueStr}" against ${optionElements.length} options`);

            let targetOption = null;

            for (const option of optionElements) {
                const optionText = option.textContent.trim();
                if (optionText.toLowerCase() === valueStr) {
                    targetOption = option;
                    this.logger(`Exact match found: "${optionText}"`);
                    break;
                }
            }

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

            if (!targetOption) {
                for (const option of optionElements) {
                    if (option.value.toLowerCase() === valueStr) {
                        targetOption = option;
                        this.logger(`Value match found: "${option.textContent.trim()}" (${option.value})`);
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
                optionElements.map((opt) => `"${opt.textContent.trim()}" (${opt.value})`)
            );
            return false;
        } catch (error) {
            this.logger(`Error filling select field: ${error.message}`);
            return false;
        }
    }

    /**
     * Fill date field
     */
    async fillDateField(element, value) {
        try {
            let dateValue = value;

            if (element.type === "date") {
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

            // Handle required checkboxes that are not part of fieldsets
            const requiredCheckboxes = form.querySelectorAll('input[type="checkbox"][aria-required="true"]:not(:checked):not(fieldset *)');
            for (const checkbox of requiredCheckboxes) {
                if (this.isElementVisible(checkbox)) {
                    this.logger(`Checking required checkbox: ${checkbox.name}`);
                    checkbox.click();
                    await this.wait(300);
                }
            }

            const requiredCheckboxes2 = form.querySelectorAll('input[type="checkbox"][required]:not(:checked):not(fieldset *)');
            for (const checkbox of requiredCheckboxes2) {
                if (this.isElementVisible(checkbox)) {
                    this.logger(`Checking required checkbox: ${checkbox.name}`);
                    checkbox.click();
                    await this.wait(300);
                }
            }
        } catch (error) {
            this.logger(`Error handling checkboxes: ${error.message}`);
        }
    }

    /**
     * Parse AI boolean response
     */
    parseAIBoolean(value) {
        if (!value) return false;

        const normalizedValue = String(value).toLowerCase().trim();

        const positiveResponses = [
            "yes", "true", "agree", "accept", "confirm", "ok", "okay", "sure",
            "definitely", "absolutely", "correct", "right", "affirmative",
            "positive", "1", "checked", "check", "select",
        ];

        const negativeResponses = [
            "no", "false", "disagree", "decline", "deny", "refuse", "never",
            "negative", "incorrect", "wrong", "0", "unchecked", "uncheck",
            "deselect", "skip",
        ];

        if (positiveResponses.some((response) => normalizedValue.includes(response))) {
            return true;
        }

        if (negativeResponses.some((response) => normalizedValue.includes(response))) {
            return false;
        }

        return null;
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
                `Found submit button: ${submitButton.textContent || submitButton.value || "Submit"}`
            );

            if (!this.isElementVisible(submitButton) || submitButton.disabled) {
                this.logger("Submit button is not clickable");
                return false;
            }

            this.scrollToElement(submitButton);
            await this.wait(500);

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
            "button.btn-primary:last-child",
            "button:last-child",
        ];

        for (const selector of submitSelectors) {
            const button = form.querySelector(selector);
            if (button && this.isElementVisible(button) && !button.disabled) {
                return button;
            }
        }

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