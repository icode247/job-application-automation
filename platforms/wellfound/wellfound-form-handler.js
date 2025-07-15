export default class WellfoundFormHandler {
  constructor(aiService, userService, logger) {
    this.aiService = aiService;
    this.userService = userService;
    this.logger = logger;
  }

  log(message, data = {}) {
    if (this.logger) {
      this.logger.log(message, data);
    } else {
      console.log(`🤖 [FormHandler] ${message}`, data);
    }
  }

  async findApplyButton() {
    try {
      this.log("🔍 Looking for Apply button...");

      // Strategy 1: Look for Wellfound-specific apply button
      let applyButton = document.querySelector(
        'button[data-test="JobDescriptionSlideIn--SubmitButton"]'
      );
      if (applyButton) {
        this.log("✅ Found Apply button via data-test attribute");
        return applyButton;
      }

      // Strategy 2: Look for any submit button in a form
      const submitButtons = document.querySelectorAll('button[type="submit"]');
      for (const button of submitButtons) {
        const buttonText = button.textContent?.toLowerCase() || "";
        if (buttonText.includes("apply")) {
          this.log("✅ Found Apply button via submit type");
          return button;
        }
      }

      // Strategy 3: Look for buttons with "Apply" text
      const allButtons = document.querySelectorAll("button");
      for (const button of allButtons) {
        const buttonText = button.textContent?.toLowerCase() || "";
        if (buttonText.includes("apply") && !buttonText.includes("filters")) {
          this.log("✅ Found Apply button via text content");
          return button;
        }
      }

      // Strategy 4: Look for links with "Apply" text (external applications)
      const allLinks = document.querySelectorAll("a");
      for (const link of allLinks) {
        const linkText = link.textContent?.toLowerCase() || "";
        if (linkText.includes("apply")) {
          this.log("✅ Found Apply link via text content");
          return link;
        }
      }

      this.log("❌ No Apply button found");
      return null;
    } catch (error) {
      this.log("❌ Error finding Apply button:", error.message);
      return null;
    }
  }

  async clickApplyButton() {
    try {
      const applyButton = await this.findApplyButton();
      if (!applyButton) {
        return { success: false, reason: "no_button" };
      }

      // Check if it's an external link
      if (applyButton.href) {
        this.log("🔗 Apply button is external link");
        return {
          success: false,
          reason: "external_link",
          url: applyButton.href,
        };
      }

      // Check if button is disabled or has restrictions
      if (applyButton.disabled || this.checkForLocationRestrictions()) {
        this.log(
          "⚠️ Apply button is disabled or restricted - checking for location restrictions"
        );

        const locationError = this.checkForLocationRestrictions();
        if (locationError) {
          this.log("🌍 Location restriction detected");
          return {
            success: false,
            reason: "location_restricted",
            error: locationError,
          };
        }

        return { success: false, reason: "disabled_button" };
      }

      // Click the button
      await this.clickElementReliably(applyButton);
      await this.delay(2000);

      this.log("✅ Apply button clicked successfully");
      return { success: true };
    } catch (error) {
      this.log("❌ Error clicking Apply button:", error.message);
      return { success: false, reason: "click_error", error: error.message };
    }
  }

  checkForLocationRestrictions() {
    try {
      // Look for location restriction error or warning messages
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

  async extractApplicationForm() {
    try {
      this.log("🔍 Looking for application form...");

      // Check for restrictions first
      const restriction = this.checkForLocationRestrictions();
      if (restriction) {
        this.log("❌ Form is restricted, skipping extraction");
        return {
          success: false,
          reason: "location_restricted",
          error: restriction,
        };
      }

      // Wait a bit for form to appear after clicking apply
      await this.delay(1000);

      // Look for application forms - exclude search forms
      const formSelectors = [
        'form:has(button[data-test="JobDescriptionSlideIn--SubmitButton"])',
        'form:has(button[type="submit"])',
        "form:has(textarea)",
        '[role="dialog"] form',
        ".application-form",
      ];

      let applicationForm = null;
      for (const selector of formSelectors) {
        try {
          const form = document.querySelector(selector);
          if (form && this.isApplicationForm(form)) {
            applicationForm = form;
            this.log(`✅ Found application form via selector: ${selector}`);
            break;
          }
        } catch (error) {
          continue;
        }
      }

      // Fallback: look for any form with application-related fields
      if (!applicationForm) {
        const allForms = document.querySelectorAll("form");
        for (const form of allForms) {
          if (this.isApplicationForm(form)) {
            applicationForm = form;
            this.log("✅ Found application form via fallback method");
            break;
          }
        }
      }

      if (!applicationForm) {
        this.log("❌ No application form found");
        return null;
      }

      // Extract form fields
      const formFields = await this.extractFormFields(applicationForm);

      // Send to AI service if there are fields
      if (formFields.length > 0) {
        await this.sendFieldsToAIService(formFields, applicationForm);
      }

      return {
        form: applicationForm,
        fields: formFields,
        isValid: formFields.length > 0,
      };
    } catch (error) {
      this.log("❌ Error extracting application form:", error.message);
      return null;
    }
  }

  isApplicationForm(form) {
    try {
      // Check if this is a search form (exclude these)
      const searchIndicators = [
        'input[name*="search"]',
        'input[placeholder*="search" i]',
        'input[placeholder*="role" i]',
        'button[data-test*="Search"]',
        ".search-form",
        '[class*="search"]',
      ];

      for (const indicator of searchIndicators) {
        if (form.querySelector(indicator)) {
          this.log("❌ Form appears to be a search form, skipping");
          return false;
        }
      }

      // Check for application form indicators
      const applicationIndicators = [
        "textarea",
        'button[type="submit"]',
        'input[type="file"]',
        'button[data-test*="Submit"]',
        'button[data-test*="Apply"]',
        'input[type="radio"]',
        "select",
        'input[type="checkbox"]',
      ];

      for (const indicator of applicationIndicators) {
        if (form.querySelector(indicator)) {
          this.log("✅ Form appears to be an application form");
          return true;
        }
      }

      // Check form fields count
      const formFields = form.querySelectorAll("input, textarea, select");
      const nonHiddenFields = Array.from(formFields).filter(
        (field) => field.type !== "hidden" && field.type !== "submit"
      );

      if (nonHiddenFields.length >= 1) {
        this.log("✅ Form has sufficient fields to be an application form");
        return true;
      }

      return false;
    } catch (error) {
      this.log("❌ Error checking if form is application form:", error.message);
      return false;
    }
  }

  async extractFormFields(form) {
    try {
      const formFields = [];

      // Get all input elements
      const allInputs = form.querySelectorAll("input, textarea, select");

      for (const input of allInputs) {
        // Skip hidden, submit, and search fields
        if (input.type === "hidden" || input.type === "submit") continue;

        const fieldName = (input.name || input.id || "").toLowerCase();
        const fieldPlaceholder = (input.placeholder || "").toLowerCase();

        // Skip search-related fields
        if (
          fieldName.includes("search") ||
          fieldPlaceholder.includes("search")
        ) {
          this.log(
            `⚠️ Skipping search field: ${fieldName || fieldPlaceholder}`
          );
          continue;
        }

        // Extract question/label
        const question = this.extractQuestionForField(input);

        // Extract options for radio, select, and checkbox
        let options = [];
        if (input.type === "radio" || input.type === "checkbox") {
          options = this.extractRadioOrCheckboxOptions(input, form);
        } else if (input.tagName.toLowerCase() === "select") {
          options = this.extractSelectOptions(input);
        }

        const fieldInfo = {
          element: input,
          name: input.name || input.id,
          type: input.type || input.tagName.toLowerCase(),
          placeholder: input.placeholder || "",
          required: input.required || input.hasAttribute("required"),
          disabled: input.disabled,
          selector: this.generateSelector(input),
          question: question,
          value: input.value || "",
          options: options.length > 0 ? options : undefined,
        };

        formFields.push(fieldInfo);
        this.log(
          `📝 Found application field: "${question}" (${fieldInfo.type}) ${
            options.length > 0 ? "with options: " + JSON.stringify(options) : ""
          }`
        );
      }

      this.log(`✅ Extracted ${formFields.length} application form fields`);
      return formFields;
    } catch (error) {
      this.log("❌ Error extracting form fields:", error.message);
      return [];
    }
  }

  extractQuestionForField(input) {
    try {
      // Strategy 1: Look for associated label
      if (input.id) {
        const label = document.querySelector(`label[for="${input.id}"]`);
        if (label) {
          return this.cleanQuestionText(label.textContent);
        }
      }

      // Strategy 2: Look for parent label
      const parentLabel = input.closest("label");
      if (parentLabel) {
        const labelText = Array.from(parentLabel.childNodes)
          .filter(
            (node) =>
              node.nodeType === Node.TEXT_NODE ||
              (node.nodeType === Node.ELEMENT_NODE && node !== input)
          )
          .map((node) => node.textContent || "")
          .join(" ")
          .trim();
        if (labelText) return this.cleanQuestionText(labelText);
      }

      // Strategy 3: Look for preceding div with question text
      const container = input.closest("div");
      if (container) {
        const questionElements = container.querySelectorAll(
          "div, span, p, label"
        );
        for (const element of questionElements) {
          const text = element.textContent?.trim();
          if (
            text &&
            text.length > 10 &&
            (text.includes("?") || text.includes(":"))
          ) {
            return this.cleanQuestionText(text);
          }
        }
      }

      // Strategy 4: Look for preceding siblings
      let sibling = input.previousElementSibling;
      let attempts = 0;
      while (sibling && attempts < 3) {
        const text = sibling.textContent?.trim();
        if (text && text.length > 5) {
          return this.cleanQuestionText(text);
        }
        sibling = sibling.previousElementSibling;
        attempts++;
      }

      // Fallback: use placeholder or name
      return this.cleanQuestionText(
        input.placeholder || input.name || "Unknown field"
      );
    } catch (error) {
      return this.cleanQuestionText(
        input.placeholder || input.name || "Unknown field"
      );
    }
  }

  extractRadioOrCheckboxOptions(input, form) {
    try {
      const options = [];
      const name = input.name;
      const sameNameInputs = form.querySelectorAll(`input[name="${name}"]`);
      for (const sameInput of sameNameInputs) {
        const label = document.querySelector(`label[for="${sameInput.id}"]`);
        const optionText = label
          ? this.cleanQuestionText(label.textContent)
          : sameInput.value || `Option ${options.length + 1}`;
        if (optionText && !options.includes(optionText)) {
          options.push(optionText);
        }
      }
      return options;
    } catch (error) {
      this.log("❌ Error extracting radio/checkbox options:", error.message);
      return [];
    }
  }

  extractSelectOptions(select) {
    try {
      const options = [];
      const optionElements = select.querySelectorAll("option");
      for (const option of optionElements) {
        const text = this.cleanQuestionText(option.textContent || option.value);
        if (text && !options.includes(text)) {
          options.push(text);
        }
      }
      // Handle React-Select dropdowns
      if (options.length === 0) {
        const reactSelect = select.closest(".select__control");
        if (reactSelect) {
          const valueContainer = reactSelect.querySelector(
            ".select__single-value"
          );
          if (valueContainer) {
            const text = this.cleanQuestionText(valueContainer.textContent);
            if (text) options.push(text);
          }
        }
      }
      return options;
    } catch (error) {
      this.log("❌ Error extracting select options:", error.message);
      return [];
    }
  }

  cleanQuestionText(text) {
    return text.replace(/\*$/, "").replace(/\s+/g, " ").trim();
  }

  async sendFieldsToAIService(fields, form) {
    try {
      const jobDetails = await this.getJobDetails(form);
      const userDetails = await this.userService.getUserDetails();
      if (!userDetails) {
        this.log("❌ No user details available for AI service");
        return false;
      }

      const aiRequest = fields.map((field) => ({
        question: field.question,
        type: field.type,
        options: field.options,
        name: field.name,
        required: field.required,
      }));

      this.log("🤖 Sending form fields to AI service:", { fields: aiRequest });

      const aiResponse = await this.aiService.processApplicationFields({
        fields: aiRequest,
        userProfile: {
          name: `${userDetails.firstName} ${userDetails.lastName}`,
          email: userDetails.email,
          experience:
            userDetails.experience || userDetails.resumeText?.substring(0, 300),
          skills: userDetails.skills || [],
          linkedIn: userDetails.linkedIn,
          github: userDetails.github,
          website: userDetails.website,
        },
        jobDetails,
      });

      if (aiResponse && aiResponse.answers) {
        this.log("✅ Received AI responses for form fields");
        await this.fillFormWithAIResponses(form, fields, aiResponse.answers);
        return true;
      } else {
        this.log("⚠️ No valid AI response received");
        return false;
      }
    } catch (error) {
      this.log("❌ Error sending fields to AI service:", error.message);
      return false;
    }
  }

  async getJobDetails(form) {
    try {
      // Extract job details from page (simplified, adjust based on page structure)
      const jobTitle =
        document.querySelector("h1")?.textContent || "Unknown Job";
      const company =
        document.querySelector('[data-test*="company-name"]')?.textContent ||
        "Unknown Company";
      const description =
        document.querySelector('[data-test*="job-description"]')?.textContent ||
        "";
      return {
        title: jobTitle.trim(),
        company: company.trim(),
        description: description.substring(0, 500),
      };
    } catch (error) {
      this.log("❌ Error getting job details:", error.message);
      return { title: "Unknown", company: "Unknown", description: "" };
    }
  }

  async fillFormWithAIResponses(form, fields, aiAnswers) {
    try {
      for (const field of fields) {
        if (field.disabled) {
          this.log(`⚠️ Skipping disabled field: ${field.question}`);
          continue;
        }

        const answer = aiAnswers.find(
          (a) => a.name === field.name || a.question === field.question
        );
        if (!answer || !answer.value) {
          this.log(`⚠️ No AI answer for field: ${field.question}`);
          continue;
        }

        const element = form.querySelector(field.selector);
        if (!element) {
          this.log(`⚠️ Field element not found: ${field.question}`);
          continue;
        }

        if (field.type === "radio" || field.type === "checkbox") {
          const optionInput = Array.from(
            form.querySelectorAll(`input[name="${field.name}"]`)
          ).find(
            (input) =>
              this.cleanQuestionText(
                input.nextElementSibling?.textContent || ""
              ) === answer.value
          );
          if (optionInput) {
            optionInput.checked = true;
            optionInput.dispatchEvent(new Event("change", { bubbles: true }));
            this.log(
              `✅ Filled ${field.type} field: "${field.question}" with "${answer.value}"`
            );
          }
        } else if (field.type === "select") {
          const option = element.querySelector(
            `option[value="${answer.value}"], option:not([value=""])`
          );
          if (option) {
            element.value = answer.value;
            element.dispatchEvent(new Event("change", { bubbles: true }));
            this.log(
              `✅ Filled select field: "${field.question}" with "${answer.value}"`
            );
          }
        } else {
          element.value = answer.value;
          element.dispatchEvent(new Event("input", { bubbles: true }));
          element.dispatchEvent(new Event("change", { bubbles: true }));
          element.dispatchEvent(new Event("blur", { bubbles: true }));
          this.log(
            `✅ Filled field: "${field.question}" with ${answer.value.length} characters`
          );
        }
      }
    } catch (error) {
      this.log("❌ Error filling form with AI responses:", error.message);
    }
  }

  async fillFormWithAI(formData, jobDetails) {
    try {
      if (!formData || !formData.fields || formData.fields.length === 0) {
        this.log("❌ No form fields to fill");
        return false;
      }

      // Get user details
      const userDetails = await this.userService.getUserDetails();
      if (!userDetails) {
        this.log("❌ No user details available");
        return false;
      }

      this.log(
        `🤖 Filling ${formData.fields.length} form fields with AI assistance`
      );

      // Fill each field
      for (const field of formData.fields) {
        if (field.disabled) {
          this.log(`⚠️ Skipping disabled field: ${field.question}`);
          continue;
        }

        await this.fillSingleField(field, userDetails, jobDetails);
        await this.delay(500);
      }

      return true;
    } catch (error) {
      this.log("❌ Error filling form with AI:", error.message);
      return false;
    }
  }

  async fillSingleField(field, userDetails, jobDetails) {
    try {
      const element = document.querySelector(field.selector);
      if (!element || element.disabled) {
        this.log(`⚠️ Field not found or disabled: ${field.question}`);
        return;
      }

      let value = "";

      // First try standard field mapping
      value = this.getStandardFieldValue(field, userDetails);

      // If no standard mapping and it's a custom question, use AI
      if (!value && field.question && field.question.length > 10) {
        this.log(`🤖 Generating AI answer for: "${field.question}"`);
        value = await this.generateAIAnswer(
          field.question,
          userDetails,
          jobDetails
        );
      }

      // Fill the field if we have a value
      if (value) {
        element.focus();
        element.value = value;

        element.dispatchEvent(new Event("input", { bubbles: true }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.dispatchEvent(new Event("blur", { bubbles: true }));

        this.log(
          `✅ Filled field: "${field.question}" with ${value.length} characters`
        );
      } else {
        this.log(`⚠️ No value generated for field: ${field.question}`);
      }
    } catch (error) {
      this.log(`❌ Error filling field "${field.question}":`, error.message);
    }
  }

  getStandardFieldValue(field, userDetails) {
    const fieldIdentifier = (
      field.name ||
      field.placeholder ||
      field.question ||
      ""
    ).toLowerCase();

    if (
      fieldIdentifier.includes("name") &&
      !fieldIdentifier.includes("company")
    ) {
      return `${userDetails.firstName} ${userDetails.lastName}`;
    } else if (fieldIdentifier.includes("first")) {
      return userDetails.firstName;
    } else if (fieldIdentifier.includes("last")) {
      return userDetails.lastName;
    } else if (fieldIdentifier.includes("email")) {
      return userDetails.email;
    } else if (fieldIdentifier.includes("phone")) {
      return userDetails.phoneNumber;
    } else if (fieldIdentifier.includes("linkedin")) {
      return userDetails.linkedIn;
    } else if (
      fieldIdentifier.includes("website") ||
      fieldIdentifier.includes("portfolio")
    ) {
      return userDetails.website;
    } else if (fieldIdentifier.includes("github")) {
      return userDetails.github;
    }

    return "";
  }

  async generateAIAnswer(question, userDetails, jobDetails) {
    try {
      const context = {
        question: question,
        jobTitle: jobDetails.title,
        company: jobDetails.company,
        jobDescription: jobDetails.description?.substring(0, 500),
        userProfile: {
          name: `${userDetails.firstName} ${userDetails.lastName}`,
          email: userDetails.email,
          experience:
            userDetails.experience || userDetails.resumeText?.substring(0, 300),
          skills: userDetails.skills || [],
          linkedIn: userDetails.linkedIn,
          github: userDetails.github,
          website: userDetails.website,
        },
      };

      const aiResponse = await this.aiService.generateApplicationAnswer(
        context
      );

      if (aiResponse && aiResponse.answer) {
        this.log(
          `✅ AI generated ${aiResponse.answer.length} character answer`
        );
        return aiResponse.answer;
      } else {
        return this.generateTemplateAnswer(question, userDetails, jobDetails);
      }
    } catch (error) {
      this.log("❌ Error generating AI answer:", error.message);
      return this.generateTemplateAnswer(question, userDetails, jobDetails);
    }
  }

  generateTemplateAnswer(question, userDetails, jobDetails) {
    const questionLower = question.toLowerCase();

    if (
      questionLower.includes("side project") ||
      questionLower.includes("project")
    ) {
      return `I recently developed a web application using modern technologies like React, Node.js, and Express. This project helped me strengthen my full-stack development skills and gave me hands-on experience with database design, API development, and responsive UI creation. The project involved implementing user authentication, real-time data updates, and optimized performance. You can view my work on GitHub: ${
        userDetails.github || "Available upon request"
      }`;
    }

    if (
      questionLower.includes("reference") ||
      questionLower.includes("linkedin")
    ) {
      return `I can provide professional references from previous colleagues, supervisors, and mentors who can speak to my technical abilities and work ethic. I prefer to coordinate reference sharing directly to respect their time and privacy. My LinkedIn profile where you can see my professional network is: ${
        userDetails.linkedIn || "Available upon request"
      }`;
    }

    if (
      questionLower.includes("why") ||
      questionLower.includes("interest") ||
      questionLower.includes("motivat")
    ) {
      return `I am genuinely excited about the ${jobDetails.title} position at ${jobDetails.company} because it aligns perfectly with my technical expertise and career aspirations. The opportunity to work with cutting-edge technologies and contribute to innovative solutions in a collaborative environment is exactly what I'm looking for in my next role.`;
    }

    if (
      questionLower.includes("experience") ||
      questionLower.includes("background") ||
      questionLower.includes("tell us about")
    ) {
      return `I have strong experience in software development with expertise in modern web technologies and frameworks. I'm passionate about writing clean, maintainable code and enjoy collaborating with cross-functional teams to deliver high-quality products. I'm always eager to learn new technologies and take on challenging projects that push my skills forward.`;
    }

    if (
      questionLower.includes("cover") ||
      questionLower.includes("letter") ||
      questionLower.includes("yourself")
    ) {
      return `I am a dedicated software developer with a passion for creating innovative solutions and delivering exceptional user experiences. My technical skills combined with my collaborative approach make me well-suited for the ${jobDetails.title} role at ${jobDetails.company}. I'm excited about the opportunity to contribute to your team's success.`;
    }

    return `I am very interested in this opportunity and believe my skills and experience make me a strong candidate for the ${jobDetails.title} position. I would welcome the chance to discuss how I can contribute to ${jobDetails.company}'s continued success and growth.`;
  }

  async submitForm(formData) {
    try {
      if (!formData || !formData.form) {
        this.log("❌ No form to submit");
        return false;
      }

      const submitButton =
        formData.form.querySelector('button[type="submit"]') ||
        formData.form.querySelector('button[data-test*="Submit"]') ||
        formData.form.querySelector('button[data-test*="Apply"]');

      if (!submitButton) {
        this.log("❌ No submit button found in form");
        return false;
      }

      if (submitButton.disabled) {
        this.log("⚠️ Submit button is disabled - checking for form errors");
        const errorCheck = await this.checkFormErrors(formData.form);
        if (errorCheck.hasErrors) {
          this.log(`❌ Form has errors: ${errorCheck.errors.join(", ")}`);
          return false;
        }
      }

      this.log("📤 Submitting application form");
      await this.clickElementReliably(submitButton);
      await this.delay(3000);

      return true;
    } catch (error) {
      this.log("❌ Error submitting form:", error.message);
      return false;
    }
  }

  async checkFormErrors(form) {
    try {
      const errors = [];

      const errorSelectors = [
        ".error",
        ".field-error",
        ".shared_fieldError__t2UkY",
        '[class*="error"]',
        ".text-red-500",
        ".text-danger",
      ];

      for (const selector of errorSelectors) {
        const errorElements = form.querySelectorAll(selector);
        for (const errorEl of errorElements) {
          const errorText = errorEl.textContent?.trim();
          if (errorText && errorText.length > 0) {
            errors.push(errorText);
          }
        }
      }

      return {
        hasErrors: errors.length > 0,
        errors: errors,
      };
    } catch (error) {
      this.log("❌ Error checking form errors:", error.message);
      return { hasErrors: false, errors: [] };
    }
  }

  async verifySubmissionSuccess() {
    try {
      await this.delay(2000);

      const successSelectors = [
        ".success",
        ".confirmation",
        '[class*="success"]',
        '[class*="confirm"]',
        ".thank-you",
      ];

      for (const selector of successSelectors) {
        const element = document.querySelector(selector);
        if (element) {
          this.log("✅ Application success verified via element");
          return true;
        }
      }

      const successTexts = [
        "application submitted",
        "thank you",
        "successfully applied",
        "application received",
        "we'll be in touch",
        "thanks for applying",
      ];

      const bodyText = document.body.textContent.toLowerCase();
      for (const text of successTexts) {
        if (bodyText.includes(text)) {
          this.log("✅ Application success verified via text");
          return true;
        }
      }

      const currentUrl = window.location.href.toLowerCase();
      if (
        currentUrl.includes("thank") ||
        currentUrl.includes("success") ||
        currentUrl.includes("applied")
      ) {
        this.log("✅ Application success verified via URL");
        return true;
      }

      this.log("⚠️ Could not verify success explicitly, assuming success");
      return true;
    } catch (error) {
      this.log("❌ Error verifying submission success:", error.message);
      return false;
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

  generateSelector(element) {
    if (element.id) return `#${element.id}`;
    if (element.name) return `[name="${element.name}"]`;
    if (element.className) {
      const classes = element.className
        .split(" ")
        .filter((c) => c && !c.includes(" "));
      if (classes.length > 0) return `.${classes[0]}`;
    }
    return element.tagName.toLowerCase();
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
