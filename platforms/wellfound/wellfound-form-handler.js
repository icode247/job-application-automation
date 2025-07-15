export default class WellfoundFormHandler {
  constructor(aiService, userService, logger) {
    this.aiService = aiService;
    this.userService = userService;
    this.logger = logger;
    this.answerCache = new Map();
  }

  log(message, data = {}) {
    if (this.logger) {
      this.logger.log(message, data);
    } else {
      console.log(`🤖 [FormHandler] ${message}`, data);
    }
  }

  checkForLocationRestrictions() {
    try {
      const restrictionSelectors = [
        ".shared_fieldError__t2UkY",
        ".styles-module_component__HiSmQ",
        ".text-dark-error",
        ".text-dark-warning",
        '[class*="error"]',
        '[class*="warning"]',
      ];

      for (const selector of restrictionSelectors) {
        const restrictionElements = document.querySelectorAll(selector);
        for (const element of restrictionElements) {
          const restrictionText = element.textContent?.toLowerCase() || "";
          if (
            restrictionText.includes("location") ||
            restrictionText.includes("timezone") ||
            restrictionText.includes("relocation") ||
            restrictionText.includes("not accepting applications") ||
            restrictionText.includes("does not support")
          ) {
            this.log(`🌍 Restriction found: ${restrictionText}`);
            return element.textContent.trim();
          }
        }
      }

      return null;
    } catch (error) {
      this.log("❌ Error checking restrictions:", error.message);
      return null;
    }
  }

  async processApplicationForm() {
    try {
      this.log("🔍 Looking for application form...");
      await this.delay(1000);

      // Wait for the modal to appear
      await this.waitForElement('div[data-test="JobApplication-Modal"]');
      await this.waitForElement('button[data-test=JobApplicationModal--SubmitButton]');

      const applicationModal = document.querySelector('div[data-test="JobApplication-Modal"]');
      if (!applicationModal) {
        this.log("❌ No application modal found");
        return { success: false, reason: "no_modal_found" };
      }

      const restriction = this.checkForLocationRestrictions();
      if (restriction) {
        this.log("❌ Form is restricted, skipping extraction");
        return {
          success: false,
          reason: "location_restricted",
          error: restriction,
        };
      }

      // Grab all fields using the improved method
      const fields = await this.grabFields();
      this.log(`📝 Found ${fields.length} form fields`);

      // Process each field
      for (const field of fields) {
        await this.handleWellfoundField(field);
        await this.delay(500);
      }

      const submitButton = document.querySelector('button[data-test=JobApplicationModal--SubmitButton]');
      if (submitButton && !submitButton.disabled) {
        this.log("📤 Submitting application form");
        await this.clickElementReliably(submitButton);
        await this.delay(3000);
        
        return {
          success: true,
          message: "Form processed successfully",
        };
      } else {
        this.log("❌ Submit button not available or disabled");
        return {
          success: false,
          reason: "submit_button_disabled",
        };
      }

    } catch (error) {
      this.log("❌ Error processing application form:", error.message);
      return {
        success: false,
        reason: "error",
        error: error.message,
      };
    }
  }

  // New method based on the provided code
  async grabFields() {
    const results = [];
    
    // Get all label.block elements in the modal
    const labels = document.querySelectorAll('div[data-test="JobApplication-Modal"] form label.block');
    this.log(`🔍 Found ${labels.length} label.block elements`);

    for (const label of labels) {
      const result = {
        element: null,
        type: '',
        label: label.firstChild.innerText.trim(),
        required: false,
        options: []
      };

      // Check if required (ends with *)
      if (result.label.endsWith('*')) {
        result.label = result.label.slice(0, -1).trim();
        result.required = true;
      }

      // Special handling for cover letter questions
      if (result.label.startsWith('What interests you about working')) {
        result.label = 'Cover letter - ' + result.label;
      }

      const container = label.children[1];
      if (!container) { 
        this.log(`⚠️ No container found for label: ${result.label}`);
        continue; 
      }

      // Priority-based field type detection
      if (container.querySelector('input[type=radio]')) {
        result.type = 'radio';
        result.element = [...container.querySelectorAll('input[type=radio]')];
        result.options = result.element.map(input => 
          input.parentElement.querySelector('label').innerText.trim()
        );
        this.log(`📻 Radio field: ${result.label} with options: ${result.options.join(', ')}`);
        
      } else if (label.querySelector('input[type=checkbox]')) {
        result.type = 'checkbox';
        result.element = [...label.querySelectorAll('input[type=checkbox]')];
        result.options = result.element.map(input => 
          input.parentElement.querySelector('label').innerText.trim()
        );
        this.log(`☑️ Checkbox field: ${result.label} with options: ${result.options.join(', ')}`);
        
      } else if (container.querySelector('.select__control')) {
        result.type = 'select';
        result.element = container.querySelector('.select__control');
        
        // Trigger dropdown to get options
        if (!container.querySelector('.select__menu .select__option')) {
          this.log(`🔽 Opening React Select dropdown for: ${result.label}`);
          const input = result.element.querySelector('input');
          if (input) {
            input.dispatchEvent(new Event('mousedown', {bubbles: true}));
            input.dispatchEvent(new Event('focusin', {bubbles: true}));
            await this.delay(1000);
          }
        }

        result.options = [...container.querySelectorAll('.select__menu .select__option')]
          .map(option => option.innerText.trim())
          .filter(text => text.length > 0);
        
        this.log(`📋 Select field: ${result.label} with options: ${result.options.join(', ')}`);
        
        // Close dropdown
        const input = result.element.querySelector('input');
        if (input) {
          input.dispatchEvent(new Event('focusout', {bubbles: true}));
        }
        
      } else {
        result.element = container.firstChild;
        result.type = result.element ? result.element.type : 'unknown';
        this.log(`📝 Input field: ${result.label} type: ${result.type}`);
      }

      if (result.element && result.type) {
        results.push(result);
      }
    }

    // Handle cover letter separately
    const coverLetter = document.getElementById('form-input--userNote');
    if (coverLetter) {
      results.push({
        element: coverLetter,
        type: 'textarea',
        label: 'Cover letter - ' + coverLetter.placeholder,
        required: true,
        options: []
      });
      this.log(`📄 Cover letter field found`);
    }

    return results;
  }

  async handleWellfoundField(field) {
    try {
      this.log(`🔧 Processing field: ${field.label} (${field.type})`);
      
      // Scroll to element
      try {
        const modalContent = document.querySelector('.ReactModal__Content');
        if (modalContent) {
          this.scrollToElement(modalContent, Array.isArray(field.element) ? field.element[0] : field.element);
        }
      } catch (error) {
        // Ignore scroll errors
      }

      const answer = await this.getAnswer(field.label, field.options);
      
      if (!answer && answer !== 0) {
        if (field.required && Array.isArray(field.element) && field.element[0]) {
          // Click first option for required fields with no answer
          field.element[0].click();
          this.log(`✅ Selected first option for required field: ${field.label}`);
        } else {
          this.log(`⏭️ Skipping field with no answer: ${field.label}`);
        }
        return;
      }

      // Handle different field types
      if (Array.isArray(field.element)) {
        // Radio buttons or checkboxes
        let found = false;
        for (const el of field.element) {
          const optionText = el.parentElement.querySelector('label').innerText.trim();
          if (optionText === answer || optionText.toLowerCase().includes(answer.toLowerCase())) {
            el.click();
            found = true;
            this.log(`✅ Selected "${optionText}" for: ${field.label}`);
            break;
          }
        }
        if (!found) {
          this.log(`⚠️ Could not find matching option "${answer}" for: ${field.label}`);
        }
        
      } else if (field.type === 'select') {
        // React Select
        const container = field.element.parentElement;
        
        // Open dropdown if not already open
        if (!container.querySelector('.select__menu .select__option')) {
          const input = field.element.querySelector('input');
          if (input) {
            input.dispatchEvent(new Event('mousedown', {bubbles: true}));
            input.dispatchEvent(new Event('focusin', {bubbles: true}));
            await this.delay(1000);
          }
        }

        // Find and click matching option
        const options = container.querySelectorAll('.select__menu .select__option');
        let found = false;
        for (const option of options) {
          const optionText = option.innerText.trim();
          if (optionText === answer || optionText.toLowerCase().includes(answer.toLowerCase())) {
            option.click();
            found = true;
            this.log(`✅ Selected "${optionText}" for: ${field.label}`);
            break;
          }
        }
        
        if (!found) {
          this.log(`⚠️ Could not find matching option "${answer}" for: ${field.label}`);
        }

        await this.delay(1000);
        
        // Close dropdown
        const input = field.element.querySelector('input');
        if (input) {
          input.dispatchEvent(new Event('focusout', {bubbles: true}));
        }
        
      } else {
        // Regular input fields
        this.setNativeValue(field.element, answer);
        this.log(`✅ Filled "${field.label}" with: ${answer}`);
      }

    } catch (error) {
      this.log(`❌ Error handling field "${field.label}": ${error.message}`);
    }
  }

  // Helper method to set native value (like React)
  setNativeValue(element, value) {
    const { set: valueSetter } = Object.getOwnPropertyDescriptor(element, 'value') || {};
    const prototype = Object.getPrototypeOf(element);
    const { set: prototypeValueSetter } = Object.getOwnPropertyDescriptor(prototype, 'value') || {};
    
    if (prototypeValueSetter && valueSetter !== prototypeValueSetter) {
      prototypeValueSetter.call(element, value);
    } else if (valueSetter) {
      valueSetter.call(element, value);
    } else {
      element.value = value;
    }
    
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // Helper method to scroll to element
  scrollToElement(container, element) {
    if (!container || !element) return;
    
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    const offset = elementRect.top - containerRect.top;
    
    container.scrollTop += offset;
    
    const scrollEvent = new Event('scroll', {
      bubbles: true,
      cancelable: true,
    });
    
    container.dispatchEvent(scrollEvent);
  }

  // Helper method to wait for element
  async waitForElement(selector, timeout = 10000) {
    return new Promise((resolve, reject) => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      const observer = new MutationObserver((mutations) => {
        const element = document.querySelector(selector);
        if (element) {
          observer.disconnect();
          resolve(element);
        }
      });

      observer.observe(document.body, {
        childList: true,
        subtree: true,
      });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Element ${selector} not found within ${timeout}ms`));
      }, timeout);
    });
  }

  async getAnswer(label, options = []) {
    const normalizedLabel = label?.toLowerCase()?.trim() || "";

    if (this.answerCache.has(normalizedLabel)) {
      this.log(`🔄 Using cached answer for: ${label}`);
      return this.answerCache.get(normalizedLabel);
    }

    try {
      this.log(`🤖 Getting AI answer for: "${label}"`);

      const context = {
        platform: "wellfound",
        userData: await this.userService.getUserDetails(),
        jobDescription: this.scrapeJobDescription(),
      };

      const answer = await this.aiService.getAnswer(label, options, context);
      const cleanedAnswer = answer.replace(/["*\-]/g, '');

      this.answerCache.set(normalizedLabel, cleanedAnswer);
      this.log(`✅ Got AI answer for "${label}": ${cleanedAnswer}`);
      return cleanedAnswer;
    } catch (error) {
      this.log(`❌ AI Answer Error for "${label}": ${error.message}`);
      return this.getFallbackAnswer(normalizedLabel, options);
    }
  }

  getFallbackAnswer(normalizedLabel, options = []) {
    const defaultAnswers = {
      "work authorization": "Yes",
      "authorized to work": "Yes",
      "require sponsorship": "No",
      "require visa": "No",
      "visa sponsorship": "No",
      "experience": "Yes",
      "data quality": "Yes",
      "dataset diversity": "Yes",
      "working": "I am excited about the opportunity to contribute to innovative projects and work with cutting-edge technology.",
      "years of experience": "2 years",
      "phone": "555-0123",
      "salary": "80000",
      "expected salary": "80000",
      "desired salary": "80000",
      "location": "Remote",
      "preferred location": "Remote",
      "willing to relocate": "Yes",
      "start date": "Immediately",
      "notice period": "2 weeks",
      "availability": "Immediately",
      "hear about us": "LinkedIn",
      "how did you hear": "LinkedIn",
      "cover letter": "I am writing to express my strong interest in this position. With my background and experience, I believe I would be a valuable addition to your team.",
    };

    for (const [key, value] of Object.entries(defaultAnswers)) {
      if (normalizedLabel.includes(key)) {
        this.log(`🔄 Using fallback answer for "${normalizedLabel}": ${value}`);
        return value;
      }
    }

    if (options.length > 0) {
      this.log(`🔄 Using first option for "${normalizedLabel}": ${options[0]}`);
      return options[0];
    }

    this.log(`🔄 Using default fallback for "${normalizedLabel}": Yes`);
    return "Yes";
  }

  scrapeJobDescription() {
    try {
      const descriptionSelectors = [
        'div[class^=styles_description]',
        '[data-test*="job-description"]',
        ".job-description",
        ".description",
        '[class*="description"]',
      ];

      for (const selector of descriptionSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          return element.textContent.trim().substring(0, 500);
        }
      }

      return "No job description found";
    } catch (error) {
      return "No job description found";
    }
  }

  async clickElementReliably(element) {
    const strategies = [
      () => element.click(),
      () =>
        element.dispatchEvent(
          new MouseEvent("click", { bubbles: true, cancelable: true })
        ),
      () => {
        element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
        element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
        element.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      },
      () => {
        element.focus();
        element.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true })
        );
      },
    ];

    element.scrollIntoView({ behavior: "smooth", block: "center" });
    await this.delay(500);

    for (const strategy of strategies) {
      try {
        strategy();
        await this.delay(1000);
        return true;
      } catch (error) {
        continue;
      }
    }

    throw new Error("All click strategies failed");
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}