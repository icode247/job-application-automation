// platforms/ziprecruiter/ziprecruiter-form-handler.js

export default class ZipRecruiterFormHandler {
  constructor(config = {}) {
    this.logger = config.logger || console.log;
    this.userData = config.userData || {};
    this.jobDescription = config.jobDescription || "";
    this.fileHandler = config.fileHandler;
    this.aiService = config.aiService;

    // Setup selectors specific to ZipRecruiter
    this.selectors = {
      INPUTS:
        'input[type="text"], input[type="email"], input[type="tel"], input[type="number"]',
      SELECTS: "select",
      TEXTAREAS: "textarea",
      RADIO_INPUTS: 'input[type="radio"]',
      CHECKBOX_INPUTS: 'input[type="checkbox"]',
      MODAL_CONTAINER: ".ApplyFlowApp",
      MODAL_QUESTIONS: ".question_form fieldset",
      MODAL_SELECT: "[role='combobox']",
      MODAL_SELECT_OPTIONS: "[role='listbox'] li",
      CONTINUE_BUTTON: "button[type='submit']",
      SUBMIT_BUTTON: "button[type='submit']",
      ACTION_BUTTONS:
        'button[type="submit"], button[class*="submit"], button[class*="continue"]',
    };

    this.timeouts = {
      SHORT: 500,
      STANDARD: 2000,
      EXTENDED: 5000,
    };

    // Track processed elements to prevent redundant processing
    this.processedElements = new Set();
  }

  async fillCompleteForm() {
    try {
      this.logger("Starting form filling process");
      await this.sleep(this.timeouts.STANDARD);

      let isComplete = false;
      let maxSteps = 10;
      let currentStep = 0;

      while (!isComplete && currentStep < maxSteps) {
        currentStep++;
        this.logger(`Processing form step ${currentStep}`);

        const formContainer =
          document.querySelector(this.selectors.MODAL_CONTAINER) ||
          document.querySelector("form") ||
          document.body;

        if (!formContainer) {
          throw new Error("No form container found");
        }

        // Fill current step
        await this.fillFormStep(formContainer);

        // Find and click action button
        const actionButton = this.findActionButton();
        if (!actionButton) {
          // Check if modal closed
          if (
            !document.querySelector(this.selectors.MODAL_CONTAINER) ||
            !this.isElementVisible(
              document.querySelector(this.selectors.MODAL_CONTAINER)
            )
          ) {
            this.logger("Modal closed, application completed");
            isComplete = true;
            return true;
          } else {
            throw new Error("No action button found and modal still open");
          }
        }

        // Prevent default form submission
        const formElement = formContainer.closest("form");
        if (formElement) {
          formElement.addEventListener(
            "submit",
            (e) => {
              e.preventDefault();
              this.logger(
                "Form submission prevented - handling via JavaScript"
              );
            },
            true
          );
        }

        // Click the button
        this.logger(`Clicking ${actionButton.textContent.trim()} button`);
        actionButton.click();
        await this.sleep(this.timeouts.STANDARD);

        // Check if modal closed after button click
        if (
          !document.querySelector(this.selectors.MODAL_CONTAINER) ||
          !this.isElementVisible(
            document.querySelector(this.selectors.MODAL_CONTAINER)
          )
        ) {
          this.logger("Modal closed after button click, application completed");
          isComplete = true;
          return true;
        }
      }

      if (currentStep >= maxSteps) {
        this.logger("Maximum steps reached");
        return false;
      }

      // Final check
      await this.sleep(this.timeouts.STANDARD);
      return (
        !document.querySelector(this.selectors.MODAL_CONTAINER) ||
        !this.isElementVisible(
          document.querySelector(this.selectors.MODAL_CONTAINER)
        )
      );
    } catch (error) {
      this.logger(`Error filling form: ${error.message}`);
      return false;
    }
  }

  async fillFormStep(container) {
    try {
      let hasVisibleFields = false;

      // Handle direct form inputs (name, email, phone) on initial page
      const directInputs = container.querySelectorAll(
        'input[type="text"], input[type="email"], input[type="tel"]'
      );

      if (directInputs.length > 0) {
        this.logger(`Found ${directInputs.length} direct input fields`);
        hasVisibleFields = true;

        for (const input of directInputs) {
          if (
            !this.isElementVisible(input) ||
            this.processedElements.has(input)
          ) {
            continue;
          }

          this.processedElements.add(input);
          const labelText = this.getElementLabel(input);
          if (!labelText) continue;

          this.logger(`Processing direct input: ${labelText}`);
          await this.handleDirectInput(input, labelText);
        }
      }

      // Handle file uploads first
      const fileUploads = container.querySelectorAll('input[type="file"]');
      if (fileUploads.length > 0 && this.fileHandler) {
        this.logger("Found file upload fields, handling them");

        for (const fileInput of fileUploads) {
          if (this.isResumeUploadField(fileInput)) {
            await this.handleResumeUpload(fileInput);
          }
        }
      }

      // Handle structured question fieldsets
      const questionFields = container.querySelectorAll(
        this.selectors.MODAL_QUESTIONS
      );
      if (questionFields.length > 0) {
        this.logger(
          `Found ${questionFields.length} structured question fields`
        );
        hasVisibleFields = true;

        for (const field of questionFields) {
          if (
            !this.isElementVisible(field) ||
            this.processedElements.has(field)
          ) {
            continue;
          }

          this.processedElements.add(field);
          const labelElement = field.querySelector("label");
          if (!labelElement) continue;

          const questionText = labelElement.textContent.trim();
          this.logger(`Processing question: ${questionText}`);
          await this.processFieldsetQuestion(field, questionText);
        }
      }

      // Handle required checkboxes
      await this.handleRequiredCheckboxes(container);

      return hasVisibleFields;
    } catch (error) {
      this.logger(`Error filling form step: ${error.message}`);
      return false;
    }
  }

  async handleDirectInput(input, labelText) {
    const name = input.name?.toLowerCase() || "";
    const lowerLabel = labelText.toLowerCase();

    try {
      if (name.includes("first") || lowerLabel.includes("first")) {
        await this.setElementValue(input, this.userData.firstName || "John");
      } else if (name.includes("last") || lowerLabel.includes("last")) {
        await this.setElementValue(input, this.userData.lastName || "Doe");
      } else if (name.includes("phone") || lowerLabel.includes("phone")) {
        await this.setElementValue(input, this.userData.phone || "1234567890");
      } else if (name.includes("email") || lowerLabel.includes("email")) {
        await this.setElementValue(
          input,
          this.userData.email || "user@example.com"
        );
      } else if (
        lowerLabel.includes("location") ||
        lowerLabel.includes("postal") ||
        lowerLabel.includes("city") ||
        lowerLabel.includes("zip")
      ) {
        await this.setElementValue(
          input,
          this.userData.location || this.userData.zip || "10001"
        );
      } else {
        // Use AI service for other inputs
        const answer = await this.getAnswerFromAI(labelText, []);
        await this.setElementValue(input, answer);
      }
    } catch (error) {
      this.logger(`Error handling direct input: ${error.message}`);
    }
  }

  async processFieldsetQuestion(fieldset, questionText) {
    try {
      // Check for resume upload field first
      if (this.isResumeUploadField(fieldset)) {
        this.logger("Detected resume upload field");
        await this.handleResumeUpload(fieldset);
        return;
      }

      // Handle ZipRecruiter dropdown (role="combobox")
      const combobox = fieldset.querySelector('[role="combobox"]');
      if (combobox) {
        await this.handleZipRecruiterDropdown(combobox, questionText);
        return;
      }

      // Handle textarea
      const textarea = fieldset.querySelector("textarea");
      if (textarea) {
        await this.handleTextInput(textarea, questionText);
        return;
      }

      // Handle radio buttons
      const radioButtons = fieldset.querySelectorAll(
        this.selectors.RADIO_INPUTS
      );
      if (radioButtons.length > 0) {
        await this.handleRadioGroup(radioButtons, questionText);
        return;
      }

      // Handle checkboxes
      const checkboxes = fieldset.querySelectorAll(
        this.selectors.CHECKBOX_INPUTS
      );
      if (checkboxes.length > 0) {
        await this.handleCheckboxGroup(checkboxes, questionText);
        return;
      }

      // Handle text input
      const textInput = fieldset.querySelector(this.selectors.INPUTS);
      if (textInput) {
        await this.handleTextInput(textInput, questionText);
        return;
      }
    } catch (error) {
      this.logger(`Error processing fieldset question: ${error.message}`);
    }
  }

  async handleZipRecruiterDropdown(combobox, questionText) {
    try {
      this.logger(`Handling ZipRecruiter dropdown for: ${questionText}`);

      const menuId = combobox.getAttribute("aria-controls");
      let menuElement = null;

      if (menuId) {
        menuElement = document.getElementById(menuId);
      }

      // Click to open dropdown
      combobox.click();
      await this.sleep(500);

      // Extract available options
      let availableOptions = [];
      if (menuElement && menuElement.style.visibility !== "hidden") {
        const optionElements = menuElement.querySelectorAll("li");
        if (optionElements.length > 0) {
          availableOptions = Array.from(optionElements)
            .filter((opt) => this.isElementVisible(opt))
            .map((opt) => opt.textContent.trim());
        }
      }

      // Get answer from AI service
      const selectedValue = await this.getAnswerFromAI(
        questionText,
        availableOptions
      );

      // Select the option
      if (menuElement && menuElement.style.visibility !== "hidden") {
        const options = menuElement.querySelectorAll("li");
        let optionToSelect = Array.from(options).find(
          (opt) =>
            opt.textContent.trim().toLowerCase() === selectedValue.toLowerCase()
        );

        if (!optionToSelect) {
          optionToSelect = Array.from(options).find(
            (opt) =>
              opt.textContent
                .trim()
                .toLowerCase()
                .includes(selectedValue.toLowerCase()) ||
              selectedValue
                .toLowerCase()
                .includes(opt.textContent.trim().toLowerCase())
          );
        }

        if (!optionToSelect && options.length > 0) {
          optionToSelect = options[0];
        }

        if (optionToSelect) {
          this.logger(`Selecting option: ${optionToSelect.textContent.trim()}`);
          optionToSelect.click();
          await this.sleep(300);
          return;
        }
      }

      // Fallback: set value directly
      if (combobox.tagName === "INPUT") {
        combobox.value = selectedValue;
        combobox.dispatchEvent(new Event("input", { bubbles: true }));
        combobox.dispatchEvent(new Event("change", { bubbles: true }));
      }

      await this.sleep(500);
    } catch (error) {
      this.logger(`Error handling dropdown: ${error.message}`);
    }
  }

  async handleRadioGroup(radioButtons, questionText) {
    try {
      const options = Array.from(radioButtons)
        .map((radio) => ({
          element: radio,
          label: this.getRadioLabel(radio),
        }))
        .filter((opt) => opt.label);

      const optionTexts = options.map((opt) => opt.label);
      const selectedValue = await this.getAnswerFromAI(
        questionText,
        optionTexts
      );

      let optionToSelect = options.find(
        (opt) => opt.label.toLowerCase() === selectedValue.toLowerCase()
      );

      if (!optionToSelect) {
        optionToSelect = options.find(
          (opt) =>
            opt.label.toLowerCase().includes(selectedValue.toLowerCase()) ||
            selectedValue.toLowerCase().includes(opt.label.toLowerCase())
        );
      }

      if (!optionToSelect && options.length > 0) {
        optionToSelect = options[0];
      }

      if (optionToSelect) {
        this.logger(`Selecting radio option: ${optionToSelect.label}`);
        optionToSelect.element.click();
      }

      await this.sleep(500);
    } catch (error) {
      this.logger(`Error handling radio group: ${error.message}`);
    }
  }

  async handleCheckboxGroup(checkboxes, questionText) {
    try {
      if (this.isAgreementQuestion(questionText)) {
        for (const checkbox of checkboxes) {
          if (!checkbox.checked) {
            checkbox.click();
            await this.sleep(200);
          }
        }
        return;
      }

      // Handle each checkbox individually
      for (const checkbox of checkboxes) {
        const checkboxLabel = this.getElementLabel(checkbox);
        if (!checkboxLabel) continue;

        const fullQuestion = `For the question "${questionText}", should the option "${checkboxLabel}" be selected?`;
        const shouldCheck =
          (await this.getAnswerFromAI(fullQuestion, ["Yes", "No"])) === "Yes";

        if (shouldCheck !== checkbox.checked) {
          checkbox.click();
          await this.sleep(200);
        }
      }
    } catch (error) {
      this.logger(`Error handling checkbox group: ${error.message}`);
    }
  }

  async handleTextInput(inputElement, questionText) {
    try {
      const value = await this.getAnswerFromAI(questionText, []);
      await this.setElementValue(inputElement, value);
    } catch (error) {
      this.logger(`Error handling text input: ${error.message}`);
    }
  }

  async handleResumeUpload(fieldsetOrInput) {
    try {
      this.logger("Handling resume upload");

      let fileInput;
      if (fieldsetOrInput.tagName === "INPUT") {
        fileInput = fieldsetOrInput;
      } else {
        fileInput = fieldsetOrInput.querySelector('input[type="file"]');
      }

      if (!fileInput) {
        this.logger("No file input found for resume upload");
        return false;
      }

      if (!this.userData || !this.userData.resumeUrl) {
        // Try alternative properties
        const possibleUrls = [
          this.userData?.cv?.url,
          this.userData?.resume?.url,
          this.userData?.resumeUrl,
        ];

        const validUrl = possibleUrls.find(
          (url) => url && typeof url === "string"
        );
        if (!validUrl) {
          this.logger("No valid resume URL found");
          return false;
        }
        this.userData.resumeUrl = validUrl;
      }

      if (this.fileHandler) {
        // Create dummy container for file handler
        const form =
          fileInput.closest("form") || document.createElement("form");
        const adaptedProfile = {
          ...this.userData,
          cv: { url: this.userData.resumeUrl },
        };

        return await this.fileHandler.handleFileUpload(
          form,
          adaptedProfile,
          this.jobDescription
        );
      }

      // Fallback direct upload
      return await this.uploadFileFromUrl(fileInput, this.userData.resumeUrl);
    } catch (error) {
      this.logger(`Error handling resume upload: ${error.message}`);
      return false;
    }
  }

  async uploadFileFromUrl(fileInput, url) {
    try {
      const proxyURL = `${
        window.HOST || "http://localhost:3000"
      }/api/proxy-file?url=${encodeURIComponent(url)}`;
      const response = await fetch(proxyURL);

      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }

      const blob = await response.blob();
      if (!blob || blob.size === 0) {
        throw new Error("Downloaded file is empty");
      }

      let filename = "resume.pdf";
      const contentDisposition = response.headers.get("content-disposition");
      if (contentDisposition) {
        const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(
          contentDisposition
        );
        if (matches && matches[1]) {
          filename = matches[1].replace(/['"]/g, "");
        }
      }

      if (this.userData.firstName && this.userData.lastName) {
        const ext = filename.split(".").pop() || "pdf";
        filename = `${this.userData.firstName}_${this.userData.lastName}_resume.${ext}`;
      }

      const file = new File([blob], filename, {
        type: blob.type || "application/pdf",
        lastModified: Date.now(),
      });

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;

      await this.triggerFileEvents(fileInput);
      return fileInput.files.length > 0;
    } catch (error) {
      this.logger(`Error uploading file: ${error.message}`);
      return false;
    }
  }

  async triggerFileEvents(fileInput) {
    const events = ["focus", "click", "change", "input"];
    for (const eventName of events) {
      await this.sleep(100);
      fileInput.dispatchEvent(new Event(eventName, { bubbles: true }));
    }
    await this.sleep(1000);
  }

  async handleRequiredCheckboxes(container) {
    try {
      // Handle consent checkboxes with ZipRecruiter-specific pattern
      const consentCheckboxes = container.querySelectorAll(
        'fieldset input[type="checkbox"].peer, input.pointer-event-auto.peer'
      );

      for (const checkbox of consentCheckboxes) {
        if (!checkbox.checked) {
          this.logger("Checking consent checkbox");
          checkbox.click();
          await this.sleep(200);
        }
      }

      // Handle other required checkboxes
      const checkboxes = Array.from(
        container.querySelectorAll('input[type="checkbox"]')
      );
      for (const checkbox of checkboxes) {
        if (
          !this.isElementVisible(checkbox) ||
          this.processedElements.has(checkbox)
        ) {
          continue;
        }

        this.processedElements.add(checkbox);

        const parentText =
          checkbox.parentElement?.textContent?.toLowerCase() || "";
        const isConsent =
          parentText.includes("consent") ||
          parentText.includes("agree") ||
          parentText.includes("terms") ||
          parentText.includes("privacy");

        const isRequired =
          checkbox.hasAttribute("required") ||
          checkbox.getAttribute("aria-required") === "true" ||
          checkbox.closest('[aria-required="true"]') ||
          checkbox.closest(".required") ||
          isConsent;

        if (isRequired && !checkbox.checked) {
          this.logger("Checking required/consent checkbox");
          checkbox.click();
          await this.sleep(200);
        }
      }
    } catch (error) {
      this.logger(`Error handling required checkboxes: ${error.message}`);
    }
  }

  async getAnswerFromAI(questionText, options = []) {
    try {
      if (this.aiService) {
        const context = {
          platform: "ziprecruiter",
          userData: this.userData,
          jobDescription: this.jobDescription,
        };

        return await this.aiService.getAnswer(questionText, options, context);
      }

      // Fallback answers
      const normalizedQuestion = questionText.toLowerCase();
      const defaultAnswers = {
        "work authorization": "Yes",
        "authorized to work": "Yes",
        "require sponsorship": "No",
        "require visa": "No",
        experience: "2 years",
        "years of experience": "2 years",
        phone: "555-0123",
        salary: "80000",
      };

      for (const [key, value] of Object.entries(defaultAnswers)) {
        if (normalizedQuestion.includes(key)) {
          return value;
        }
      }

      return options.length > 0 ? options[0] : "Yes";
    } catch (error) {
      this.logger(`Error getting AI answer: ${error.message}`);
      return options.length > 0 ? options[0] : "Yes";
    }
  }

  // Helper methods
  getElementLabel(element) {
    // Try associated label
    if (element.id) {
      const labelElement = document.querySelector(`label[for="${element.id}"]`);
      if (labelElement) return labelElement.textContent.trim();
    }

    // Try parent label
    const parentLabel = element.closest("label");
    if (parentLabel) {
      const labelText = Array.from(parentLabel.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent.trim())
        .join(" ")
        .trim();

      if (labelText) return labelText;
    }

    // Try fieldset label
    const parentFieldset = element.closest("fieldset");
    if (parentFieldset) {
      const fieldsetLabel = parentFieldset.querySelector(
        "label, span.text-primary"
      );
      if (fieldsetLabel) return fieldsetLabel.textContent.trim();
    }

    // Try aria-label
    if (element.getAttribute("aria-label")) {
      return element.getAttribute("aria-label").trim();
    }

    // Try placeholder
    if (element.placeholder) {
      return element.placeholder.trim();
    }

    return element.name || "";
  }

  getRadioLabel(radioButton) {
    // Try label by for attribute
    if (radioButton.id) {
      const label = document.querySelector(`label[for="${radioButton.id}"]`);
      if (label) return label.textContent.trim();
    }

    // Try parent label
    const parentLabel = radioButton.closest("label");
    if (parentLabel) {
      const labelText = Array.from(parentLabel.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent.trim())
        .join(" ")
        .trim();

      return labelText || parentLabel.textContent.trim();
    }

    // Try next sibling
    const nextSibling = radioButton.nextElementSibling;
    if (nextSibling && nextSibling.tagName !== "INPUT") {
      return nextSibling.textContent.trim();
    }

    return radioButton.value || "Unknown";
  }

  isAgreementQuestion(questionText) {
    const lowerText = questionText.toLowerCase();
    const agreementKeywords = [
      "agree",
      "consent",
      "terms",
      "conditions",
      "privacy",
      "policy",
      "accept",
      "agreement",
      "authorize",
      "permission",
    ];
    return agreementKeywords.some((keyword) => lowerText.includes(keyword));
  }

  isResumeUploadField(fieldsetOrInput) {
    let fileInput;
    if (
      fieldsetOrInput.tagName === "INPUT" &&
      fieldsetOrInput.type === "file"
    ) {
      fileInput = fieldsetOrInput;
    } else {
      fileInput = fieldsetOrInput.querySelector('input[type="file"]');
    }

    if (!fileInput) return false;

    // Check input attributes
    const inputAttrs = [
      fileInput.name,
      fileInput.id,
      fileInput.getAttribute("accept"),
    ];

    if (
      inputAttrs.some(
        (attr) =>
          attr &&
          (attr.toLowerCase().includes("resume") ||
            attr.toLowerCase().includes("cv") ||
            attr.includes(".pdf") ||
            attr.includes(".doc"))
      )
    ) {
      return true;
    }

    // Check surrounding text
    const container =
      fieldsetOrInput.tagName === "INPUT"
        ? fileInput.closest("fieldset") || fileInput.parentElement
        : fieldsetOrInput;

    const containerText = container ? container.textContent.toLowerCase() : "";
    const resumeKeywords = [
      "resume",
      "cv",
      "upload",
      "attach",
      "curriculum vitae",
    ];

    return resumeKeywords.some((keyword) => containerText.includes(keyword));
  }

  findActionButton() {
    const buttonSelectors = [
      "button[type='submit']",
      'button[class*="submit"]',
      'button[class*="continue"]',
      'button[class*="next"]',
      'button[class*="apply"]',
    ];

    for (const selector of buttonSelectors) {
      const button = document.querySelector(selector);
      if (button && this.isElementVisible(button)) {
        return button;
      }
    }

    return null;
  }

  async setElementValue(element, value) {
    try {
      element.focus();
      element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.blur();
      this.logger(`Set value: "${value}" for input`);
    } catch (error) {
      this.logger(`Error setting element value: ${error.message}`);
    }
  }

  isElementVisible(element) {
    if (!element) return false;

    try {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();

      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.opacity !== "0" &&
        rect.height > 0 &&
        rect.width > 0
      );
    } catch (error) {
      return false;
    }
  }

  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
