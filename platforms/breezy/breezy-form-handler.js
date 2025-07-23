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
   * Check if a field is required
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

    return false;
  }

  async fillFormWithProfile(form, profile) {
    try {
      this.log("Filling Breezy form with user profile data");
      this.userData = profile;

      // Use enhanced field discovery
      const formFields = await this.grabFields(form);
      this.log(`Found ${formFields.length} form fields to process`);

      if (formFields.length === 0) {
        this.log("No form fields found");
        return false;
      }

      // Process fields sequentially with enhanced error handling
      const processingResult = await this.processFieldsSequentially(formFields);

      // Handle required checkboxes
      await this.handleRequiredCheckboxes(form);

      this.log(`Processing summary: ${processingResult.processed} successful, ${processingResult.failed} failed`);

      if (processingResult.failedFields.length > 0) {
        this.log(`Failed fields: ${processingResult.failedFields.join(", ")}`);
      }

      return processingResult.processed > 0;
    } catch (error) {
      this.log(`Error filling form: ${error.message}`);
      return false;
    }
  }

  /**
   * Enhanced grabFields method - adapted from Wellfound approach
   */
  async grabFields(form) {
    const results = [];
    this.log("🔍 Starting systematic field discovery for Breezy form");

    try {
      // Debug: Log form structure first
      this.debugFormStructure(form);
      
      // 1. Handle Personal Details Section (standard form fields)
      await this.grabPersonalDetailsFields(form, results);
      
      // 2. Handle Salary Fields (special handling)
      await this.grabSalaryFields(form, results);
      
      // 3. Handle Textarea Fields (cover letter, experience summary)
      await this.grabTextareaFields(form, results);
      
      // 4. Handle Questionnaire Fields (dynamic questions)
      await this.grabQuestionnaireFields(form, results);
      
      // 5. Handle Checkbox/Consent Fields
      await this.grabCheckboxFields(form, results);
      
      // 6. Handle File Upload Fields
      await this.grabFileFields(form, results);

      this.log(`📝 Total fields discovered: ${results.length}`);
      
      // Log summary of field types found
      const fieldTypeSummary = results.reduce((acc, field) => {
        acc[field.type] = (acc[field.type] || 0) + 1;
        return acc;
      }, {});
      
      this.log(`📊 Field types found:`, fieldTypeSummary);
      
      // Debug: Log all discovered fields
      this.debugDiscoveredFields(results);
      
      return results;
      
    } catch (error) {
      this.log(`❌ Error in grabFields: ${error.message}`);
      return [];
    }
  }

  /**
   * Debug method to log form structure
   */
  debugFormStructure(form) {
    try {
      this.log("🔍 DEBUGGING: Form structure analysis");
      
      // Log all h3 elements and their positions
      const h3Elements = form.querySelectorAll('h3');
      this.log(`Found ${h3Elements.length} h3 elements:`);
      h3Elements.forEach((h3, index) => {
        const span = h3.querySelector('span.polygot');
        const text = span ? span.textContent.trim() : h3.textContent.trim();
        this.log(`  H3 ${index}: "${text}"`);
      });
      
      // Log all input elements and their names
      const inputElements = form.querySelectorAll('input, textarea, select');
      this.log(`Found ${inputElements.length} form elements:`);
      inputElements.forEach((input, index) => {
        if (input.type !== 'hidden') {
          this.log(`  Element ${index}: ${input.tagName.toLowerCase()}[name="${input.name}"][type="${input.type || 'N/A'}"]`);
        }
      });
      
      // Log questionnaire containers
      const questionnaireContainers = form.querySelectorAll('.dropdown, .multiplechoice');
      this.log(`Found ${questionnaireContainers.length} questionnaire containers:`);
      questionnaireContainers.forEach((container, index) => {
        const h3 = container.querySelector('h3');
        const h3Text = h3 ? h3.textContent.trim() : 'No h3 found';
        this.log(`  Container ${index}: .${container.className} - "${h3Text.substring(0, 50)}..."`);
        
        // Log the select element if it exists
        const select = container.querySelector('select');
        if (select) {
          this.log(`    └─ Select: name="${select.name}" with ${select.options.length} options`);
        }
      });
      
    } catch (error) {
      this.log(`❌ Error in debugFormStructure: ${error.message}`);
    }
  }

  /**
   * Debug method to log discovered fields
   */
  debugDiscoveredFields(fields) {
    try {
      this.log("🔍 DEBUGGING: Discovered fields summary");
      fields.forEach((field, index) => {
        this.log(`  Field ${index}: "${field.label}" (${field.type}) - Element: ${field.element.tagName.toLowerCase()}[name="${field.element.name}"]`);
      });
    } catch (error) {
      this.log(`❌ Error in debugDiscoveredFields: ${error.message}`);
    }
  }

  /**
   * Grab personal details fields (name, email, phone, etc.)
   */
  async grabPersonalDetailsFields(form, results) {
    this.log("🔍 Looking for personal details fields...");
    
    // Define specific field mappings to avoid label confusion
    const personalFieldMappings = [
      {
        selector: 'input[name="cName"]',
        expectedLabel: 'Full Name',
        fieldType: 'text'
      },
      {
        selector: 'input[name="cEmail"]',
        expectedLabel: 'Email Address', 
        fieldType: 'email'
      },
      {
        selector: 'input[name="cPhoneNumber"]',
        expectedLabel: 'Phone Number',
        fieldType: 'tel'
      }
    ];
    
    for (const mapping of personalFieldMappings) {
      const element = form.querySelector(mapping.selector);
      if (element && this.isElementVisible(element)) {
        
        // Try to get the actual label, but fall back to expected label
        let label = this.getFieldLabelFromH3(element);
        
        // If label detection fails or gives wrong result, use expected label
        if (!label || label.toLowerCase().includes('full name') && mapping.expectedLabel !== 'Full Name') {
          label = mapping.expectedLabel;
          this.log(`🔄 Using fallback label "${mapping.expectedLabel}" for ${mapping.selector}`);
        }
        
        const field = {
          element: element,
          type: mapping.fieldType,
          label: this.cleanLabelText(label),
          required: this.isFieldRequired(element),
          options: []
        };
        
        results.push(field);
        this.log(`✅ Personal field: ${field.label} (${field.type}) - ${mapping.selector}`);
      } else {
        this.log(`⚠️ Field not found or not visible: ${mapping.selector}`);
      }
    }
  }

  /**
   * Grab salary-related fields (currency, amount, period)
   */
  async grabSalaryFields(form, results) {
    this.log("🔍 Looking for salary fields...");
    
    const salaryContainer = form.querySelector('.desired-salary');
    if (!salaryContainer) return;
    
    // Currency selector
    const currencySelect = salaryContainer.querySelector('select[name="salaryCurrency"]');
    if (currencySelect && this.isElementVisible(currencySelect)) {
      const options = Array.from(currencySelect.options)
        .map(option => option.textContent.trim())
        .filter(text => text.length > 0);
      
      results.push({
        element: currencySelect,
        type: 'select',
        label: 'Salary Currency',
        required: this.isFieldRequired(currencySelect),
        options: options
      });
      this.log(`✅ Salary field: Currency (${options.length} options)`);
    }
    
    // Salary amount
    const salaryInput = salaryContainer.querySelector('input[name="cSalary"]');
    if (salaryInput && this.isElementVisible(salaryInput)) {
      results.push({
        element: salaryInput,
        type: 'salary',
        label: 'Desired Salary Amount',
        required: this.isFieldRequired(salaryInput),
        options: []
      });
      this.log(`✅ Salary field: Amount (salary)`);
    }
    
    // Salary period
    const periodSelect = salaryContainer.querySelector('select[ng-model="candidate.salary.period"]');
    if (periodSelect && this.isElementVisible(periodSelect)) {
      const options = Array.from(periodSelect.options)
        .map(option => option.textContent.trim())
        .filter(text => text.length > 0);
      
      results.push({
        element: periodSelect,
        type: 'select',
        label: 'Salary Period',
        required: this.isFieldRequired(periodSelect),
        options: options
      });
      this.log(`✅ Salary field: Period (${options.length} options)`);
    }
  }

  /**
   * Grab textarea fields (cover letter, experience summary)
   */
  async grabTextareaFields(form, results) {
    this.log("🔍 Looking for textarea fields...");
    
    const textareaSelectors = [
      'textarea[name="cCoverLetter"]',
      'textarea[name="cSummary"]'
    ];
    
    for (const selector of textareaSelectors) {
      const element = form.querySelector(selector);
      if (element && this.isElementVisible(element)) {
        const label = this.getFieldLabelFromH3(element);
        if (label) {
          const field = {
            element: element,
            type: 'textarea',
            label: this.cleanLabelText(label),
            required: this.isFieldRequired(element),
            options: []
          };
          
          results.push(field);
          this.log(`✅ Textarea field: ${field.label}`);
        }
      }
    }
  }

  /**
   * Grab questionnaire fields (dynamic questions from JSON)
   */
  async grabQuestionnaireFields(form, results) {
    this.log("🔍 Looking for questionnaire fields...");
    
    try {
      // Get questionnaire data from hidden input
      const questionsInput = form.querySelector('#questions');
      if (!questionsInput) {
        this.log("No questionnaire data found");
        return;
      }
      
      const questionsData = JSON.parse(questionsInput.value);
      this.log(`Found ${questionsData.length} questionnaire sections`);
      
      // Process each section
      for (const section of questionsData) {
        if (!section.questions) continue;
        
        for (let i = 0; i < section.questions.length; i++) {
          const question = section.questions[i];
          
          // Look for different types of question elements
          const questionSelectors = [
            `input[name="section_${section._id}_question_${i}"]`,
            `textarea[name="section_${section._id}_question_${i}"]`,
            `select[name="section_${section._id}_question_${i}"]` // Added select support
          ];
          
          let questionElement = null;
          for (const selector of questionSelectors) {
            questionElement = form.querySelector(selector);
            if (questionElement) {
              this.log(`✅ Found questionnaire element: ${selector}`);
              break;
            }
          }
          
          if (questionElement && this.isElementVisible(questionElement)) {
            const field = {
              element: questionElement,
              type: this.mapQuestionTypeToFieldType(question.type),
              label: this.cleanLabelText(question.text),
              required: question.required || false,
              options: []
            };
            
            // Handle different question types
            if (question.type.id === 'dropdown') {
              field.type = 'select';
              
              // Get options from the select element
              if (questionElement.tagName.toLowerCase() === 'select') {
                field.options = Array.from(questionElement.options)
                  .map(option => option.textContent.trim())
                  .filter(text => text.length > 0);
              }
              
              this.log(`✅ Dropdown field: "${field.label.substring(0, 50)}..." with options: [${field.options.join(', ')}]`);
            } else if (question.type.id === 'checkboxes') {
              const container = questionElement.closest('.multiplechoice');
              if (container) {
                field.element = container;
                field.type = 'checkbox';
                
                // Get options from the UI
                const optionElements = container.querySelectorAll('li.option span.ng-binding');
                field.options = Array.from(optionElements).map(span => span.textContent.trim());
              }
            } else if (question.type.id === 'multiplechoice') {
              field.type = 'radio';
              
              // Get options from question data
              if (question.options) {
                field.options = question.options.map(opt => opt.text);
              }
            } else {
              // For text/textarea fields, get options from question data if available
              if (question.options) {
                field.options = question.options.map(opt => opt.text);
              }
            }
            
            results.push(field);
            this.log(`✅ Questionnaire field: ${field.label.substring(0, 50)}... (${field.type})`);
          } else {
            this.log(`⚠️ Questionnaire element not found for section_${section._id}_question_${i}`);
          }
        }
      }
    } catch (error) {
      this.log(`❌ Error processing questionnaire: ${error.message}`);
    }
  }

  /**
   * Grab checkbox/consent fields
   */
  async grabCheckboxFields(form, results) {
    this.log("🔍 Looking for checkbox fields...");
    
    // SMS consent checkbox
    const smsConsent = form.querySelector('input[ng-model="$storage[positionId].sms_consent"]');
    if (smsConsent && this.isElementVisible(smsConsent)) {
      results.push({
        element: smsConsent,
        type: 'checkbox',
        label: 'SMS Consent',
        required: false,
        options: ['Yes', 'No']
      });
      this.log(`✅ Checkbox field: SMS Consent`);
    }
    
    // GDPR consent (if present)
    const gdprContainers = form.querySelectorAll('.gdpr-accept');
    for (const container of gdprContainers) {
      const checkbox = container.querySelector('input[type="checkbox"]');
      if (checkbox && this.isElementVisible(checkbox)) {
        results.push({
          element: checkbox,
          type: 'checkbox',
          label: 'Privacy Notice Consent',
          required: true,
          options: ['Yes', 'No']
        });
        this.log(`✅ Checkbox field: Privacy Notice Consent`);
      }
    }
  }

  /**
   * Grab file upload fields
   */
  async grabFileFields(form, results) {
    this.log("🔍 Looking for file upload fields...");
    
    const fileInput = form.querySelector('input[name="cResume"]');
    if (fileInput) {
      const required = form.querySelector('#resume_required')?.value === 'required';
      
      results.push({
        element: fileInput,
        type: 'file',
        label: 'Resume Upload',
        required: required,
        options: []
      });
      this.log(`✅ File field: Resume Upload (${required ? 'required' : 'optional'})`);
    }
  }

  /**
   * Get field label from preceding h3 element
   */
  getFieldLabelFromH3(element) {
    try {
      this.log(`🔍 Getting label for element: ${element.name || element.id || element.tagName}`);
      
      // Look for the closest preceding h3 element
      let currentElement = element.previousElementSibling;
      let attempts = 0;
      const maxAttempts = 10; // Prevent infinite loops
      
      // Walk backwards through siblings to find the closest h3
      while (currentElement && attempts < maxAttempts) {
        attempts++;
        
        if (currentElement.tagName && currentElement.tagName.toLowerCase() === 'h3') {
          const span = currentElement.querySelector('span.polygot');
          const labelText = span ? span.textContent.trim() : currentElement.textContent.trim();
          this.log(`✅ Found h3 label: "${labelText}" for ${element.name || 'unnamed field'}`);
          return labelText;
        }
        
        currentElement = currentElement.previousElementSibling;
      }
      
      // If no h3 found in siblings, look in parent section
      const section = element.closest('.section');
      if (section) {
        const h3Elements = Array.from(section.querySelectorAll('h3'));
        
        // Find the h3 that comes immediately before this element in document order
        let closestH3 = null;
        let closestDistance = Number.MAX_SAFE_INTEGER;
        
        for (const h3 of h3Elements) {
          const h3Position = h3.compareDocumentPosition(element);
          
          // Check if h3 comes before the element (DOCUMENT_POSITION_FOLLOWING means element comes after h3)
          if (h3Position & Node.DOCUMENT_POSITION_FOLLOWING) {
            // Calculate rough distance by comparing positions in DOM
            const h3Rect = h3.getBoundingClientRect();
            const elementRect = element.getBoundingClientRect();
            const distance = Math.abs(elementRect.top - h3Rect.top);
            
            if (distance < closestDistance) {
              closestDistance = distance;
              closestH3 = h3;
            }
          }
        }
        
        if (closestH3) {
          const span = closestH3.querySelector('span.polygot');
          const labelText = span ? span.textContent.trim() : closestH3.textContent.trim();
          this.log(`✅ Found section h3 label: "${labelText}" for ${element.name || 'unnamed field'}`);
          return labelText;
        }
      }
      
      this.log(`⚠️ No h3 label found, falling back to getFieldLabel for ${element.name || 'unnamed field'}`);
      // Fallback to original method
      return this.getFieldLabel(element);
    } catch (error) {
      this.log(`❌ Error in getFieldLabelFromH3: ${error.message}`);
      return this.getFieldLabel(element);
    }
  }

  /**
   * Map questionnaire question types to field types
   */
  mapQuestionTypeToFieldType(questionType) {
    const typeMap = {
      'text': 'text',
      'paragraph': 'textarea', 
      'dropdown': 'select',  // Ensure dropdown maps to select
      'multiplechoice': 'radio',
      'checkboxes': 'checkbox',
      'file': 'file',
      'date': 'date'
    };
    
    const mappedType = typeMap[questionType.id] || 'text';
    this.log(`🔄 Mapping question type "${questionType.id}" to field type "${mappedType}"`);
    return mappedType;
  }

  /**
   * Enhanced field processing with better error handling
   */
  async processFieldsSequentially(fields) {
    this.log(`🔄 Processing ${fields.length} fields sequentially`);
    
    let processedCount = 0;
    const failedFields = [];
    
    for (let i = 0; i < fields.length; i++) {
      const field = fields[i];
      
      try {
        this.log(`🔧 Processing field ${i + 1}/${fields.length}: ${field.label} (${field.type})`);
        
        // Skip file uploads for now
        if (field.type === 'file') {
          this.log(`⏭️ Skipping file upload: ${field.label}`);
          continue;
        }
        
        const success = await this.handleFieldWithRetry(field);
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
    
    this.log(`📊 Processing complete: ${processedCount}/${fields.length} successful`);
    if (failedFields.length > 0) {
      this.log(`❌ Failed fields: ${failedFields.join(', ')}`);
    }
    
    return {
      processed: processedCount,
      failed: failedFields.length,
      failedFields: failedFields
    };
  }

  /**
   * Handle individual field with retry logic
   */
  async handleFieldWithRetry(field, maxRetries = 2) {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        this.log(`🔄 Attempt ${attempt}/${maxRetries} for: ${field.label}`);
        
        const answer = await this.getAIAnswer(
          field.label,
          field.options,
          field.type,
          `This is a ${field.type} field${field.required ? ' (required)' : ''}`
        );
        
        if (answer) {
          const success = await this.fillField(field.element, answer);
          if (success) {
            return true;
          }
        }
        
        if (attempt < maxRetries) {
          this.log(`⏳ Retrying in 500ms...`);
          await this.wait(500);
        }
        
      } catch (error) {
        this.log(`❌ Attempt ${attempt} failed: ${error.message}`);
        if (attempt < maxRetries) {
          await this.wait(500);
        }
      }
    }
    
    return false;
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
      this.log(`Requesting AI answer for "${question}"`);

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

      // Use userData directly instead of calling getUserDetailsForContext
      const userDataForContext = this.userData;

      // Special handling for salary fields
      if (
        question.toLowerCase().includes("salary") ||
        fieldContext.includes("salary") ||
        fieldType === "salary"
      ) {
        const answer = await this.aiService.getAnswer(
          `${question} (provide only the numeric amount without currency symbols or commas)`,
          options,
          {
            platform: "breezy",
            userData: userDataForContext,
            jobDescription: this.jobDescription || "",
            fieldType,
            fieldContext: fieldContext + " - numeric only",
          }
        );

        const numericAnswer = this.extractNumericSalary(answer);
        this.answerCache.set(cacheKey, numericAnswer);
        return numericAnswer;
      }

      const answer = await this.aiService.getAnswer(question, options, {
        platform: "breezy",
        userData: userDataForContext,
        jobDescription: this.jobDescription || "",
        fieldType,
        fieldContext,
      });

      this.answerCache.set(cacheKey, answer);
      return answer;
    } catch (error) {
      this.log(
        `Error getting AI answer: ${error.message}`
      );
      return null;
    }
  }

  /**
   * Fill a form field with the appropriate value
   */
  async fillField(element, value) {
    try {
      if (!element || value === undefined || value === null) {
        return false;
      }

      const fieldType = this.getFieldType(element);
      this.log(`Filling ${fieldType} field with value: "${value}"`);

      switch (fieldType) {
        case "text":
        case "email":
        case "tel":
        case "url":
        case "number":
        case "password":
        case "salary":
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
      this.log(
        `Error filling field: ${error.message}`
      );
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

      // Handle salary fields specifically
      if (this.isSalaryField(element)) {
        const numericValue = this.extractNumericSalary(value);
        if (numericValue) {
          element.value = "";
          element.dispatchEvent(new Event("input", { bubbles: true }));
          await this.wait(50);

          element.value = numericValue;
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
          element.dispatchEvent(new Event("blur", { bubbles: true }));

          await this.wait(100);
          return true;
        }
        return false;
      }

      // Standard field handling
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
      this.log(
        `Error filling input field: ${error.message}`
      );
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
   * Check if element is a salary field
   */
  isSalaryField(element) {
    const name = (element.name || "").toLowerCase();
    const id = (element.id || "").toLowerCase();
    const placeholder = (element.placeholder || "").toLowerCase();
    const className = (element.className || "").toLowerCase();

    return (
      name.includes("salary") ||
      name === "csalary" ||
      id.includes("salary") ||
      placeholder.includes("salary") ||
      className.includes("salary") ||
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
      this.log(`Error filling select field: ${error.message}`);
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
        element.closest(".iti") ||
        document.querySelector(".iti__flag-container");

      if (isIntlPhone) {
        const phoneInput =
          element.tagName.toLowerCase() === "input"
            ? element
            : element.querySelector('input[type="tel"]');

        if (!phoneInput) return false;

        const countrySelector =
          element.querySelector(".iti__selected-flag") ||
          element.closest(".iti").querySelector(".iti__selected-flag");

        if (countrySelector) {
          this.scrollToElement(countrySelector);
          countrySelector.click();
          await this.wait(500);

          const countryList = document.querySelector(".iti__country-list");
          if (countryList) {
            const usOption = countryList.querySelector(
              '.iti__country[data-country-code="us"]'
            );
            if (usOption) {
              usOption.click();
              await this.wait(300);
            } else {
              countrySelector.click();
              await this.wait(300);
            }
          }
        }

        return await this.fillInputField(phoneInput, value);
      }

      return await this.fillInputField(element, value);
    } catch (error) {
      this.log(`Error filling phone field: ${error.message}`);
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
        element.classList.contains("datepicker-input") ||
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
      this.log(`Error filling date field: ${error.message}`);
      return false;
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
   * Check if a field is part of the education section
   */
  isEducationField(element) {
    const isInEducationItem = !!element.closest("li.experience");
    if (!isInEducationItem) return false;

    let currentNode = element;
    let educationHeading = null;

    while (currentNode && !educationHeading) {
      currentNode = currentNode.parentElement;

      if (currentNode && currentNode.classList.contains("section")) {
        const h3Elements = currentNode.querySelectorAll("h3");
        for (const h3 of h3Elements) {
          if (h3.textContent.includes("Education")) {
            educationHeading = h3;
            break;
          }
        }
      }
    }

    return !!educationHeading;
  }

  /**
   * Check if a field is part of the work history section
   */
  isWorkHistoryField(element) {
    const isInWorkHistoryItem = !!element.closest("li.experience");
    if (!isInWorkHistoryItem) return false;

    let currentNode = element;
    let workHistoryHeading = null;

    while (currentNode && !workHistoryHeading) {
      currentNode = currentNode.parentElement;

      if (currentNode && currentNode.classList.contains("section")) {
        const h3Elements = currentNode.querySelectorAll("h3");
        for (const h3 of h3Elements) {
          if (h3.textContent.includes("Work History")) {
            workHistoryHeading = h3;
            break;
          }
        }
      }
    }

    return !!workHistoryHeading;
  }

  /**
   * Find and submit the form
   */
  async submitForm(form) {
    try {
      this.log("Attempting to submit form");

      const submitButton = this.findSubmitButton(form);
      if (!submitButton) {
        this.log("No submit button found");
        return false;
      }

      this.log(
        `Found submit button: ${
          submitButton.textContent || submitButton.value || "Unnamed button"
        }`
      );

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
      "button.submit-button",
      "button.submit",
      "button.apply-button",
      "button.apply",
      "button.btn-primary",
      "button.btn-success",
      ".btn.btn-primary",
      ".btn.btn-success",
      'button[data-ui="submit-application"]',
      ".application-submit",
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
   * Enhanced getFieldLabel to handle all Breezy structures
   */
  getFieldLabel(element, container = null) {
    try {
      const fieldContainer =
        container ||
        element.closest(".multiplechoice") ||
        element.closest(".dropdown") ||
        element.closest(".gdpr-accept") ||
        element.closest(".form-group");

      // Handle Breezy multiplechoice (radio/checkbox groups)
      if (
        fieldContainer &&
        fieldContainer.classList.contains("multiplechoice")
      ) {
        const h3Element = fieldContainer.querySelector(
          "h3 span.ng-binding, h3.ng-binding"
        );
        if (h3Element) {
          return this.cleanLabelText(h3Element.textContent);
        }

        const h3 = fieldContainer.querySelector("h3");
        if (h3) {
          return this.cleanLabelText(h3.textContent);
        }
      }

      // Handle Breezy dropdown structure
      if (fieldContainer && fieldContainer.classList.contains("dropdown")) {
        const h3Element = fieldContainer.querySelector("h3 span.ng-binding");
        if (h3Element) {
          return this.cleanLabelText(h3Element.textContent);
        }

        const h3 = fieldContainer.querySelector("h3");
        if (h3) {
          return this.cleanLabelText(h3.textContent);
        }
      }

      // Handle GDPR consent checkbox
      if (fieldContainer && fieldContainer.classList.contains("gdpr-accept")) {
        const h3Element = fieldContainer.querySelector("h3 span");
        if (h3Element) {
          return this.cleanLabelText(h3Element.textContent);
        }

        const label = fieldContainer.querySelector("label");
        if (label) {
          const labelText = label.textContent.trim();
          if (labelText.length > 10) {
            return this.cleanLabelText("Privacy Notice Consent");
          }
        }
      }

      // Original Breezy specific label finding
      const breezyLabel = element
        .closest(".form-group")
        ?.querySelector("label");
      if (breezyLabel) {
        return this.cleanLabelText(breezyLabel.textContent);
      }

      // Handle file upload fields specifically
      if (
        element.type === "file" ||
        element.classList.contains("custom-file-input") ||
        element.closest(".custom-file")
      ) {
        const customFileLabel = element
          .closest(".custom-file")
          ?.querySelector(".custom-file-label");
        if (customFileLabel) {
          return this.cleanLabelText(customFileLabel.textContent);
        }

        const formGroup = element.closest(".form-group");
        if (formGroup) {
          const label = formGroup.querySelector("label");
          if (label) {
            return this.cleanLabelText(label.textContent);
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
      this.log(`Error getting field label: ${error.message}`);
      return "";
    }
  }

  /**
   * Enhanced getFieldOptions for Breezy structures
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
          element.closest(".multiplechoice") ||
          element.closest(".gdpr-accept") ||
          element.closest("fieldset") ||
          element.closest(".custom-radio-group");

        if (container) {
          const optionsList = container.querySelector("ul.options");
          if (optionsList) {
            const optionItems = optionsList.querySelectorAll("li.option");
            optionItems.forEach((li) => {
              const span = li.querySelector("span.ng-binding");
              if (span) {
                options.push(span.textContent.trim());
              } else {
                const text = li.textContent.trim();
                if (text) {
                  options.push(text);
                }
              }
            });
          } else {
            const inputs = container.querySelectorAll(
              `input[type="${fieldType}"]`
            );
            inputs.forEach((input) => {
              const label =
                input.closest("label") ||
                document.querySelector(`label[for="${input.id}"]`);
              if (label) {
                const span = label.querySelector("span.ng-binding");
                if (span) {
                  options.push(span.textContent.trim());
                } else {
                  options.push(label.textContent.trim());
                }
              }
            });
          }
        }
      }

      return options;
    } catch (error) {
      this.log(`Error getting field options: ${error.message}`);
      return [];
    }
  }

  /**
   * Enhanced fillRadioField to handle Breezy structures
   */
  async fillRadioField(element, value) {
    try {
      const valueStr = String(value).toLowerCase().trim();
      this.log(`Filling radio field with value: "${valueStr}"`);

      const container =
        element.closest(".multiplechoice") ||
        element.closest("fieldset") ||
        element.closest(".custom-radio-group");

      if (container) {
        if (container.classList.contains("multiplechoice")) {
          const optionsList = container.querySelector("ul.options");
          if (optionsList) {
            const optionItems = optionsList.querySelectorAll("li.option");

            for (const li of optionItems) {
              const radioInput = li.querySelector('input[type="radio"]');
              const span = li.querySelector("span.ng-binding");

              if (radioInput && span) {
                const optionText = span.textContent.trim().toLowerCase();
                const optionValue = radioInput.value.toLowerCase();

                if (this.matchesValue(valueStr, optionText, optionValue)) {
                  this.scrollToElement(li);

                  const label = li.querySelector("label");
                  if (label) {
                    label.click();
                  } else {
                    radioInput.click();
                  }

                  await this.wait(300);
                  return true;
                }
              }
            }
          }
        }

        const radios = container.querySelectorAll('input[type="radio"]');
        for (const radio of radios) {
          const label =
            radio.closest("label") ||
            document.querySelector(`label[for="${radio.id}"]`);

          if (label) {
            const span = label.querySelector("span.ng-binding");
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
      this.log(`Error filling radio field: ${error.message}`);
      return false;
    }
  }

  /**
   * Enhanced fillCheckboxField to handle Breezy structures
   */
  async fillCheckboxField(element, value) {
    try {
      const shouldCheck = this.shouldCheckValue(value);
      this.log(`Filling checkbox field, should check: ${shouldCheck}`);

      const gdprContainer = element.closest(".gdpr-accept");
      if (gdprContainer) {
        const label = gdprContainer.querySelector("label");
        if (label && label.contains(element)) {
          this.scrollToElement(label);
          label.click();
          await this.wait(200);
          return true;
        }
      }

      const multiplechoiceContainer = element.closest(".multiplechoice");
      if (multiplechoiceContainer) {
        const optionsList = multiplechoiceContainer.querySelector("ul.options");
        if (optionsList) {
          const optionItem = element.closest("li.option");
          if (optionItem) {
            this.scrollToElement(optionItem);

            const isCurrentlyChecked = element.checked;

            if (
              (shouldCheck && !isCurrentlyChecked) ||
              (!shouldCheck && isCurrentlyChecked)
            ) {
              const span = optionItem.querySelector("span.ng-binding");
              if (span) {
                span.click();
              } else {
                element.click();
              }

              await this.wait(200);

              if (element.checked !== shouldCheck) {
                element.checked = shouldCheck;
                element.dispatchEvent(new Event("change", { bubbles: true }));
              }
            }

            return true;
          }
        }
      }

      let checkboxInput = element;
      if (element.tagName.toLowerCase() !== "input") {
        checkboxInput = element.querySelector('input[type="checkbox"]');
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
      this.log(`Error filling checkbox field: ${error.message}`);
      return false;
    }
  }

  /**
   * Enhanced handleRequiredCheckboxes to specifically handle GDPR
   */
  async handleRequiredCheckboxes(form) {
    try {
      this.log("Handling required checkboxes");

      const checkboxFields = [];

      const gdprContainers = form.querySelectorAll(".gdpr-accept");
      for (const container of gdprContainers) {
        const checkbox = container.querySelector('input[type="checkbox"]');
        if (checkbox && this.isElementVisible(checkbox)) {
          checkboxFields.push({
            element: checkbox,
            label: "Privacy Notice Consent",
            isRequired: true,
            isAgreement: true,
            isGDPR: true,
          });
        }
      }

      const standardCheckboxes = form.querySelectorAll(
        'input[type="checkbox"]'
      );
      for (const checkbox of standardCheckboxes) {
        if (!this.isElementVisible(checkbox)) continue;

        if (checkbox.closest(".gdpr-accept")) continue;

        const label = this.getFieldLabel(checkbox);
        const isRequired = this.isFieldRequired(checkbox);
        const isAgreement = this.isAgreementCheckbox(label);

        if (isRequired || isAgreement) {
          checkboxFields.push({
            element: checkbox,
            label,
            isRequired,
            isAgreement,
            isGDPR: false,
          });
        }
      }

      const customCheckboxes = form.querySelectorAll(
        '.custom-checkbox, [role="checkbox"]'
      );
      for (const checkbox of customCheckboxes) {
        if (!this.isElementVisible(checkbox)) continue;

        const label = this.getFieldLabel(checkbox);
        const isRequired =
          this.isFieldRequired(checkbox) ||
          checkbox.closest(".form-group.required");
        const isAgreement = this.isAgreementCheckbox(label);

        if (isRequired || isAgreement) {
          checkboxFields.push({
            element: checkbox,
            label,
            isRequired,
            isAgreement,
            isGDPR: false,
          });
        }
      }

      this.log(
        `Found ${checkboxFields.length} required/agreement checkboxes`
      );

      for (const field of checkboxFields) {
        let shouldCheck = field.isRequired || field.isAgreement || field.isGDPR;

        if (field.isGDPR) {
          shouldCheck = true;
        } else if (!shouldCheck) {
          const answer = await this.getAIAnswer(
            field.label,
            ["yes", "no"],
            "checkbox",
            "This is a checkbox that may require consent or agreement."
          );

          shouldCheck = answer === "yes" || answer === "true";
        }

        this.log(
          `${shouldCheck ? "Checking" : "Unchecking"} checkbox: ${field.label}`
        );
        await this.fillCheckboxField(field.element, shouldCheck);
        await this.wait(200);
      }
    } catch (error) {
      this.log(`Error handling required checkboxes: ${error.message}`);
    }
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
    if (aiValue === optionText || aiValue === optionValue) return true;

    if (optionText.includes(aiValue) || aiValue.includes(optionText))
      return true;
    if (optionValue.includes(aiValue) || aiValue.includes(optionValue))
      return true;

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