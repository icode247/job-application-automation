/**
 * Enhanced FormHandler class for automated form filling on both Indeed and Glassdoor
 * Specifically handles the SmartApply interface (https://smartapply.indeed.com/...)
 */

class FormHandler {
  /**
   * Initialize the FormHandler with necessary configuration
   * @param {Object} config Configuration options
   */
  constructor(config = {}) {
    this.enableDebug = config.enableDebug || false;
    this.logger = console.log;
    this.host = config.host;
    this.userData = config.userData || {};
    this.jobDescription = config.jobDescription || "";
    this.platform = config.platform || "glassdoor";
    this.aiBaseUrl = "https://resumify.fastapply.co/api";

    // Setup selectors based on both platforms
    this.selectors = {
      COMMON: {
        // Form elements - Added date input selector
        INPUTS:
          'input[type="text"], input[type="email"], input[type="tel"], input[type="number"], input[type="radio"], input[type="checkbox"], input[type="password"], input[type="date"], input[placeholder*="MM/DD/YYYY"], input[placeholder*="mm/dd/yyyy"]',
        SELECTS: "select",
        TEXTAREAS: "textarea",

        // Resume elements
        RESUME_OPTIONS: '[data-testid="ResumeOptionsMenu-btn"]',
        RESUME_UPLOAD_BUTTON: '[data-testid="ResumeOptionsMenu-upload"]',
        FILE_INPUT: 'input[type="file"]',
        RESUME_PREVIEW: '[data-testid="ResumeThumbnail"]',
        RESUME_RADIO_INDEED: 'input[value="INDEED_RESUME"]',
        RESUME_RADIO_FILE: 'input[value="SAVED_FILE_RESUME"]',

        // Buttons - Enhanced button selectors
        SUBMIT_BUTTON:
          '[data-testid="indeed-apply-button"], button[type="submit"]',
        CONTINUE_BUTTON:
          '[data-testid="continue-button"], button[type="submit"]',
        ACTION_BUTTONS:
          'button[type="submit"], button[class*="submit"], button[class*="continue"], button[class*="next"], button[class*="apply"]',
      },
      INDEED: {
        // Indeed-specific selectors
        INDEED_FORM_CONTAINER:
          ".ia-ApplyFormScreen, #ia-container, .indeed-apply-bd, .indeed-apply-form",
        INDEED_RESUME_SECTION: ".ia-ResumeSection",
        INDEED_RESUME_OPTIONS: ".ia-ResumeSelection-resume",
        INDEED_RESUME_UPLOAD_BUTTON: '[data-testid="resume-upload-button"]',
      },
      GLASSDOOR: {
        // Glassdoor-specific selectors
        GD_FORM_CONTAINER:
          ".jobsOverlayModal, .modal-content, .applyButtonContainer",
        GD_RESUME_UPLOAD: '[data-test="resume-upload-button"]',
        GD_RESUME_CONTAINER: ".resumeUploadContainer",
        GD_FILE_INPUT: '.resumeUploadContainer input[type="file"]',
      },
    };

    // Setup timeout values - adjusted for platform
    this.timeouts = {
      SHORT: this.platform === "glassdoor" ? 1000 : 500,
      STANDARD: this.platform === "glassdoor" ? 3000 : 2000,
      EXTENDED: this.platform === "glassdoor" ? 8000 : 5000,
      UPLOAD: this.platform === "glassdoor" ? 45000 : 30000,
    };

    // Cache for AI answers
    this.answerCache = new Map();
    this.pendingRequests = new Map();
    this.requestTimeout = 10000; // 10 second timeout
  }

  /**
   * Show status message to user (placeholder - implement as needed)
   * @param {string} message - Status message
   * @param {string} type - Message type (info, success, error, warning)
   */
  showStatus(message, type) {
    this.logger(`🤖 ${message}`);
    // Implement your status display logic here
  }

  /**
   * Enhanced button clicking with multiple interaction methods
   * @param {HTMLElement} button - Button element to click
   * @returns {Promise<boolean>} Success or failure
   */
  async clickButton(button) {
    if (!button || !this.isElementVisible(button)) {
      return false;
    }

    try {
      // Method 1: Focus and programmatic click
      button.focus();
      await this.sleep(100);
      button.click();
      await this.sleep(200);

      // Method 2: If first method didn't work, try mouse event simulation
      const clickEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
        button: 0,
        buttons: 1,
        clientX: button.getBoundingClientRect().left + button.offsetWidth / 2,
        clientY: button.getBoundingClientRect().top + button.offsetHeight / 2,
      });
      button.dispatchEvent(clickEvent);
      await this.sleep(200);

      // Method 3: Try triggering via pointer events
      button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
      button.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
      await this.sleep(100);

      // Method 4: Try keyboard activation (Enter key)
      const enterEvent = new KeyboardEvent("keydown", {
        key: "Enter",
        code: "Enter",
        bubbles: true,
        cancelable: true,
      });
      button.dispatchEvent(enterEvent);

      this.showStatus(
        `Clicked button: ${button.textContent?.trim() || "Continue"}`,
        "info"
      );
      return true;
    } catch (error) {
      this.logger(`Error clicking button: ${error.message}`);
      return false;
    }
  }

  /**
   * Handle date input fields with proper MM/DD/YYYY formatting
   * @param {HTMLElement} element - Date input element
   * @param {string} value - Date value to input
   * @returns {Promise<void>}
   */
  async handleDateInput(element, value) {
    try {
      // Parse and format the date value
      const formattedDate = this.formatDateForInput(value);
      if (!formattedDate) {
        this.showStatus(`Could not format date: ${value}`, "warning");
        return;
      }

      this.showStatus(`Filling date field with: ${formattedDate}`, "info");

      // Clear the field first
      element.focus();
      await this.sleep(100);

      // Select all and delete
      element.select();
      document.execCommand("delete");

      // Set the value directly
      element.value = formattedDate;

      // Dispatch input events
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));

      // Simulate typing for better compatibility
      for (let i = 0; i < formattedDate.length; i++) {
        const char = formattedDate[i];
        const keydownEvent = new KeyboardEvent("keydown", {
          key: char,
          code: `Digit${char}`,
          bubbles: true,
        });
        const inputEvent = new InputEvent("input", {
          inputType: "insertText",
          data: char,
          bubbles: true,
        });

        element.dispatchEvent(keydownEvent);
        element.dispatchEvent(inputEvent);
        await this.sleep(50);
      }

      element.blur();
      await this.sleep(200);
    } catch (error) {
      this.logger(`Error handling date input: ${error.message}`);
    }
  }

  /**
   * Format date value to MM/DD/YYYY format
   * @param {string} value - Input date value
   * @returns {string} Formatted date or empty string
   */
  formatDateForInput(value) {
    if (!value) return "";

    try {
      // Try to parse various date formats
      let date;

      // If already in MM/DD/YYYY format
      if (/^\d{2}\/\d{2}\/\d{4}$/.test(value)) {
        return value;
      }

      // If in YYYY-MM-DD format
      if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        const parts = value.split("-");
        return `${parts[1]}/${parts[2]}/${parts[0]}`;
      }

      // Try parsing as a date
      date = new Date(value);

      if (isNaN(date.getTime())) {
        // Try extracting numbers and creating a reasonable date
        const numbers = value.match(/\d+/g);
        if (numbers && numbers.length >= 3) {
          const month = numbers[0].padStart(2, "0");
          const day = numbers[1].padStart(2, "0");
          let year = numbers[2];

          // Handle 2-digit years
          if (year.length === 2) {
            const currentYear = new Date().getFullYear();
            const century = Math.floor(currentYear / 100) * 100;
            year = century + parseInt(year);
            if (year > currentYear + 10) {
              year -= 100;
            }
          }

          return `${month}/${day}/${year}`;
        }
        return "";
      }

      // Format as MM/DD/YYYY
      const month = (date.getMonth() + 1).toString().padStart(2, "0");
      const day = date.getDate().toString().padStart(2, "0");
      const year = date.getFullYear();

      return `${month}/${day}/${year}`;
    } catch (error) {
      this.logger(`Error formatting date: ${error.message}`);
      return "";
    }
  }

  /**
   * Check if input is a date field
   * @param {HTMLElement} element - Input element
   * @returns {boolean} True if it's a date field
   */
  isDateField(element) {
    if (!element) return false;

    return (
      element.type === "date" ||
      element.placeholder?.includes("MM/DD/YYYY") ||
      element.placeholder?.includes("mm/dd/yyyy") ||
      element.placeholder?.includes("MM-DD-YYYY") ||
      element.name?.toLowerCase().includes("date") ||
      element.id?.toLowerCase().includes("date")
    );
  }

  /**
   * Upload blob to file input
   * @param {HTMLElement} fileInput - File input element
   * @param {Blob} blob - File blob
   * @param {string} fileName - File name
   * @returns {Promise<void>}
   */
  async uploadBlob(fileInput, blob, fileName) {
    try {
      const file = new File([blob], fileName, {
        type: blob.type || "application/pdf",
        lastModified: Date.now(),
      });

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;

      // Dispatch events
      await this.sleep(200);
      fileInput.dispatchEvent(new Event("focus", { bubbles: true }));
      await this.sleep(200);
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      await this.sleep(200);
      fileInput.dispatchEvent(new Event("input", { bubbles: true }));

      this.showStatus(`Resume uploaded successfully: ${fileName}`, "success");
    } catch (error) {
      this.showStatus(`Failed to upload resume: ${error.message}`, "error");
      throw error;
    }
  }

  /**
   * Generate and upload custom resume for unlimited users
   * @param {HTMLElement} fileInput - File input element
   * @param {Object} userDetails - User details
   * @param {string} jobDescription - Job description
   * @param {Array} fileUrls - Array of resume URLs
   * @returns {Promise<boolean>} Success or failure
   */
  async generateAndUploadCustomResume(
    fileInput,
    userDetails,
    jobDescription,
    fileUrls
  ) {
    try {
      this.showStatus(
        "Generating custom resume tailored for this job...",
        "info"
      );

      const parseResponse = await fetch(`${this.aiBaseUrl}/parse-resume`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          file_url: fileUrls[fileUrls.length - 1],
        }),
      });

      if (!parseResponse.ok) {
        throw new Error(`Resume parsing failed: ${parseResponse.status}`);
      }

      const { text: parsedResumeText } = await parseResponse.json();

      const optimizeResponse = await fetch(
        `${this.aiBaseUrl}/optimize-resume`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resume_text: parsedResumeText,
            job_description: jobDescription,
            user_data: {
              summary: userDetails.summary,
              projects: userDetails.projects,
              fullPositions: userDetails.fullPositions,
              education: userDetails.education,
              educationStartMonth: userDetails.educationStartMonth,
              educationStartYear: userDetails.educationStartYear,
              educationEndMonth: userDetails.educationEndMonth,
              educationEndYear: userDetails.educationEndYear,
            },
          }),
        }
      );

      if (!optimizeResponse.ok) {
        throw new Error(
          `Resume optimization failed: ${optimizeResponse.status}`
        );
      }

      const resumeData = await optimizeResponse.json();

      const generateResponse = await fetch(
        `${this.aiBaseUrl}/generate-resume-pdf`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_data: {
              author:
                userDetails.name ||
                `${userDetails.firstName} ${userDetails.lastName}`,
              email: userDetails.email,
              phone: `${userDetails.phoneCountryCode || ""}${
                userDetails.phoneNumber || ""
              }`,
              address: userDetails.streetAddress || userDetails.country,
            },
            resume_data: resumeData.data,
          }),
        }
      );

      if (!generateResponse.ok) {
        this.showStatus(
          "Custom resume generation failed, using original resume",
          "error"
        );
        throw new Error(`Resume generation failed: ${generateResponse.status}`);
      }

      const blob = await generateResponse.blob();

      if (blob.size === 0) {
        throw new Error("Generated PDF is empty");
      }

      const fileName = `${userDetails.name || "resume"}.pdf`;
      await this.uploadBlob(fileInput, blob, fileName);

      this.showStatus(
        "Custom resume generated and uploaded successfully!",
        "success"
      );
      return true;
    } catch (error) {
      this.showStatus(
        "Custom resume generation failed, using existing resume",
        "warning"
      );
      // Fallback to regular upload
      return await this.uploadFileFromURL(fileInput, this.userData);
    }
  }

  /**
   * Match and upload resume (existing functionality)
   * @param {HTMLElement} fileInput - File input element
   * @param {Object} userDetails - User details
   * @param {string} jobDescription - Job description
   * @param {Array} fileUrls - Array of resume URLs
   * @returns {Promise<boolean>} Success or failure
   */
  async matchAndUploadResume(fileInput, userDetails, jobDescription, fileUrls) {
    try {
      this.showStatus("Finding the best resume match for this job...", "info");

      // Use the existing uploadFileFromURL logic
      return await this.uploadFileFromURL(fileInput, this.userData);
    } catch (error) {
      this.showStatus("Resume matching failed: " + error.message, "error");
      return false;
    }
  }

  /**
   * Handle resume upload with custom generation support
   * @returns {Promise<boolean>} Success or failure
   */
  async handleResumeUpload() {
    try {
      this.showStatus(`Looking for resume upload section...`, "info");

      // Platform-specific handling
      if (this.platform === "glassdoor") {
        // Glassdoor-specific upload flow
        return await this.handleGlassdoorResumeStep();
      }

      // Indeed-specific upload flow
      // First look for resume options button
      const resumeOptionsBtn = document.querySelector(
        this.selectors.COMMON.RESUME_OPTIONS
      );
      if (resumeOptionsBtn) {
        this.showStatus("Found resume options menu", "info");
        await this.clickButton(resumeOptionsBtn);
        await this.sleep(this.timeouts.SHORT);

        // Look for upload option in menu
        const uploadOption =
          document.querySelector(this.selectors.COMMON.RESUME_UPLOAD_BUTTON) ||
          this.findElementByAttribute("role", "menuitem", "Upload");

        if (uploadOption) {
          this.showStatus("Selecting upload resume option", "info");
          await this.clickButton(uploadOption);
          await this.sleep(this.timeouts.SHORT);
        }
      } else {
        // Try to find direct upload button
        const uploadButton =
          this.findButtonByText("Upload resume") ||
          this.findButtonByText("Upload Resume") ||
          document.querySelector(
            this.selectors.INDEED.INDEED_RESUME_UPLOAD_BUTTON
          );

        if (uploadButton) {
          this.showStatus("Found upload button", "info");
          await this.clickButton(uploadButton);
          await this.sleep(this.timeouts.SHORT);
        }
      }

      // Now look for file input - try multiple times
      let fileInput = null;
      let attempts = 0;
      const maxAttempts = 5;

      while (!fileInput && attempts < maxAttempts) {
        fileInput = document.querySelector(this.selectors.COMMON.FILE_INPUT);

        if (!fileInput) {
          attempts++;
          this.showStatus(
            `Waiting for file upload field... (${attempts}/${maxAttempts})`,
            "info"
          );
          await this.sleep(1000);
        }
      }

      if (!fileInput) {
        this.showStatus(
          "No file upload field found, looking for skip option",
          "warning"
        );

        // Look for skip option
        const skipButton =
          this.findButtonByText("Skip") ||
          this.findLinkByText("Skip this step");

        if (skipButton) {
          this.showStatus("Skipping resume upload step", "info");
          await this.clickButton(skipButton);
          await this.sleep(this.timeouts.STANDARD);
          return true;
        }

        return false;
      }

      // Get resume URL from user data
      if (!this.userData.cv?.url && !this.userData.resumeUrl) {
        this.showStatus("No resume found in user data", "error");
        return false;
      }

      // Handle custom resume generation or regular upload
      try {
        const fileUrls = this.userData.resumeUrl || [this.userData.cv.url];

        if (
          this.userData.plan === "unlimited" &&
          this.userData.jobPreferences?.useCustomResume === true &&
          this.jobDescription
        ) {
          // Generate custom resume
          const uploaded = await this.generateAndUploadCustomResume(
            fileInput,
            this.userData,
            this.jobDescription,
            Array.isArray(fileUrls) ? fileUrls : [fileUrls]
          );

          if (uploaded) {
            this.showStatus("Custom resume uploaded successfully!", "success");
          } else {
            this.showStatus(
              "Custom resume upload failed, trying regular upload",
              "warning"
            );
            // Fallback to regular upload
            const regularUploaded = await this.uploadFileFromURL(
              fileInput,
              this.userData
            );
            if (!regularUploaded) {
              this.showStatus("Resume upload failed completely", "error");
              return false;
            }
          }
        } else {
          // Regular resume upload with matching
          const uploaded = await this.matchAndUploadResume(
            fileInput,
            this.userData,
            this.jobDescription,
            Array.isArray(fileUrls) ? fileUrls : [fileUrls]
          );

          if (!uploaded) {
            this.showStatus("Resume upload failed", "error");
            return false;
          }
        }
      } catch (error) {
        this.showStatus(`Error in resume upload: ${error.message}`, "error");
        return false;
      }

      // Wait for upload processing
      await this.sleep(this.timeouts.STANDARD);

      // Find and click continue
      const continueButton =
        document.querySelector(this.selectors.COMMON.CONTINUE_BUTTON) ||
        this.findButtonByText("Continue") ||
        this.findButtonByText("Next") ||
        this.findActionButton();

      if (continueButton) {
        this.showStatus("Continuing to next step...", "info");
        await this.clickButton(continueButton);
        await this.sleep(this.timeouts.STANDARD);
      }

      return true;
    } catch (error) {
      this.showStatus(`Resume upload error: ${error.message}`, "error");
      return false;
    }
  }

  /**
   * Handle Glassdoor-specific resume upload step - ALWAYS upload a new resume
   * Enhanced with custom resume generation support
   * @returns {Promise<boolean>} Success or failure
   */
  async handleGlassdoorResumeStep() {
    try {
      this.showStatus("Processing Glassdoor resume upload...", "info");

      // First look for hidden file inputs - they often exist but are triggered by other buttons
      const hiddenFileInputs = [
        document.querySelector(
          'input[type="file"][data-testid="FileResumeCard-file-input"]'
        ),
        document.querySelector('input[type="file"][style*="display: none"]'),
        document.querySelector('input[type="file"][style*="display:none"]'),
      ].filter((input) => input !== null);

      if (hiddenFileInputs.length > 0) {
        this.showStatus("Found hidden file input, activating it...", "info");

        // Look for the trigger button that would normally activate this input
        const triggerButtons = [
          document.querySelector('[data-testid="FileResumeCard-label"]'),
          document.querySelector('[for="' + hiddenFileInputs[0].id + '"]'),
          this.findButtonByText("Upload Resume"),
          this.findButtonByText("Upload resume"),
          this.findButtonByText("Upload"),
          document.querySelector('[data-testid="ResumeOptionsMenu-btn"]'),
        ].filter((btn) => btn && this.isElementVisible(btn));

        if (triggerButtons.length > 0) {
          this.showStatus("Clicking upload trigger button...", "info");
          await this.clickButton(triggerButtons[0]);
          await this.sleep(this.timeouts.SHORT);
        }

        // Use the hidden file input directly
        const fileInput = hiddenFileInputs[0];

        // Get resume URL from user data
        if (!this.userData.cv?.url && !this.userData.resumeUrl) {
          this.showStatus("No resume URL found in user data", "error");
          return false;
        }

        // Handle custom resume generation or regular upload
        let uploaded = false;
        try {
          const fileUrls = this.userData.resumeUrl || [this.userData.cv.url];
          if (
            this.userData.plan === "unlimited" &&
            this.userData.jobPreferences?.useCustomResume === true &&
            this.jobDescription
          ) {
            // Generate custom resume
            uploaded = await this.generateAndUploadCustomResume(
              fileInput,
              this.userData,
              this.jobDescription,
              Array.isArray(fileUrls) ? fileUrls : [fileUrls]
            );
          } else {
            // Regular resume upload with matching
            uploaded = await this.matchAndUploadResume(
              fileInput,
              this.userData,
              this.jobDescription,
              Array.isArray(fileUrls) ? fileUrls : [fileUrls]
            );
          }
        } catch (error) {
          this.showStatus(`Glassdoor upload error: ${error.message}`, "error");
          // Fallback to original method
          uploaded = await this.uploadFileFromURL(
            fileInput,
            this.userData,
            true // Pass true to bypass visibility check
          );
        }

        if (uploaded) {
          this.showStatus(
            "Resume uploaded to Glassdoor successfully!",
            "success"
          );

          // Wait longer for Glassdoor processing
          await this.sleep(this.timeouts.EXTENDED);

          // Find and click continue
          const continueButton =
            document.querySelector(this.selectors.COMMON.CONTINUE_BUTTON) ||
            this.findButtonByText("Continue") ||
            this.findButtonByText("Next") ||
            this.findButtonByText("Save and Continue") ||
            this.findActionButton();

          if (continueButton) {
            this.showStatus("Proceeding to next step...", "info");
            await this.clickButton(continueButton);
            await this.sleep(this.timeouts.STANDARD);
          }

          return true;
        }
      }

      // Continue with normal flow if hidden inputs didn't work
      // First check if there's an existing resume preview
      const resumePreview =
        document.querySelector(".resumePreview") ||
        document.querySelector(".uploadedResume") ||
        document.querySelector("[data-test='resume-preview']");

      if (resumePreview) {
        this.showStatus(
          "Found existing resume, attempting to replace it...",
          "info"
        );

        // Look for replace options
        const replaceButtons = [
          this.findButtonByText("Replace"),
          this.findButtonByText("Change"),
          this.findButtonByText("Update"),
          this.findButtonByText("Edit resume"),
          this.findButtonByText("Upload new"),
        ].filter((btn) => btn && this.isElementVisible(btn));

        if (replaceButtons.length > 0) {
          this.showStatus("Replacing existing resume...", "info");
          await this.clickButton(replaceButtons[0]);
          await this.sleep(this.timeouts.STANDARD);
        }
      }

      // Look for Glassdoor-specific upload button
      const gdUploadButton = document.querySelector(
        this.selectors.GLASSDOOR.GD_RESUME_UPLOAD
      );

      if (gdUploadButton) {
        this.showStatus("Found Glassdoor upload button", "info");
        await this.clickButton(gdUploadButton);
        await this.sleep(this.timeouts.STANDARD);
      }

      // Look for file input - check multiple selectors
      let fileInput = null;
      const possibleFileInputs = [
        document.querySelector(this.selectors.GLASSDOOR.GD_FILE_INPUT),
        document.querySelector(this.selectors.COMMON.FILE_INPUT),
        document.querySelector('input[type="file"]'),
        document.querySelector('input[accept=".pdf,.doc,.docx,.rtf,.txt"]'),
      ];

      for (const input of possibleFileInputs) {
        if (input && this.isElementVisible(input)) {
          fileInput = input;
          this.showStatus("Found Glassdoor file input", "info");
          break;
        }
      }

      if (!fileInput) {
        // If no file input is visible, try clicking any buttons that might reveal it
        const uploadButtons = [
          this.findButtonByText("Upload Resume"),
          this.findButtonByText("Upload resume"),
          this.findButtonByText("Upload"),
          this.findButtonByText("Add resume"),
          this.findButtonByText("Add Resume"),
        ].filter((btn) => btn && this.isElementVisible(btn));

        if (uploadButtons.length > 0) {
          this.showStatus("Clicking button to reveal file input...", "info");
          await this.clickButton(uploadButtons[0]);
          await this.sleep(this.timeouts.STANDARD);

          // Check again for file input
          for (const selector of [
            'input[type="file"]',
            'input[accept*=".pdf"]',
            'input[accept*=".doc"]',
          ]) {
            fileInput = document.querySelector(selector);
            if (fileInput && this.isElementVisible(fileInput)) {
              this.showStatus(`Found file input: ${selector}`, "info");
              break;
            }
          }
        }
      }

      if (!fileInput) {
        this.showStatus(
          "No file input found, looking for skip option...",
          "warning"
        );

        // Look for skip option
        const skipButton =
          this.findButtonByText("Skip") ||
          this.findLinkByText("Skip this step");
        if (skipButton) {
          this.showStatus("Skipping resume step", "info");
          await this.clickButton(skipButton);
          await this.sleep(this.timeouts.STANDARD);
          return true;
        }

        return false;
      }

      // Get resume URL from user data
      if (!this.userData.cv?.url && !this.userData.resumeUrl) {
        this.showStatus("No resume URL available", "error");
        return false;
      }

      // Handle custom resume generation or regular upload
      let uploaded = false;
      try {
        const fileUrls = this.userData.resumeUrl || [this.userData.cv.url];

        if (
          this.userData.plan === "unlimited" &&
          this.userData.jobPreferences?.useCustomResume === true &&
          this.jobDescription
        ) {
          // Generate custom resume
          uploaded = await this.generateAndUploadCustomResume(
            fileInput,
            this.userData,
            this.jobDescription,
            Array.isArray(fileUrls) ? fileUrls : [fileUrls]
          );
        } else {
          // Regular resume upload with matching
          uploaded = await this.matchAndUploadResume(
            fileInput,
            this.userData,
            this.jobDescription,
            Array.isArray(fileUrls) ? fileUrls : [fileUrls]
          );
        }
      } catch (error) {
        this.showStatus(
          `Glassdoor upload process error: ${error.message}`,
          "error"
        );
        // Fallback to original method
        uploaded = await this.uploadFileFromURL(fileInput, this.userData);
      }

      if (uploaded) {
        this.showStatus(
          "Resume uploaded to Glassdoor successfully!",
          "success"
        );

        // Wait longer for Glassdoor processing
        await this.sleep(this.timeouts.EXTENDED);

        // Find and click continue
        const continueButton =
          document.querySelector(this.selectors.COMMON.CONTINUE_BUTTON) ||
          this.findButtonByText("Continue") ||
          this.findButtonByText("Next") ||
          this.findButtonByText("Save and Continue") ||
          this.findActionButton();

        if (continueButton) {
          this.showStatus("Moving to next step...", "info");
          await this.clickButton(continueButton);
          await this.sleep(this.timeouts.STANDARD);
        }

        return true;
      } else {
        this.showStatus("Glassdoor resume upload failed", "error");
        return false;
      }
    } catch (error) {
      this.showStatus(`Glassdoor resume step error: ${error.message}`, "error");
      return false;
    }
  }

  /**
   * Processes the job description element to maintain formatting
   * @param {HTMLElement} element - The job description container element
   * @returns {string} The processed job description
   */
  processJobDescription(element) {
    const clone = element.cloneNode(true);

    const listItems = clone.querySelectorAll("li");
    listItems.forEach((item) => {
      item.textContent = `• ${item.textContent.trim()}`;
    });

    // Replace heading elements with proper formatting
    const headings = clone.querySelectorAll("h1, h2, h3, h4, h5, h6");
    headings.forEach((heading) => {
      heading.textContent = `${heading.textContent.trim()}`;
    });

    // Get the text with preserved formatting
    return clone.textContent.trim();
  }

  /**
   * Handle the form filling process from start to finish
   * @param {Object} formData Additional data for form filling
   * @returns {Promise<boolean>} Success or failure
   */
  async fillCompleteForm(formData = {}) {
    try {
      this.showStatus("Starting automated form filling...", "info");

      // Wait for form to be fully loaded
      await this.sleep(this.timeouts.STANDARD);

      // First check if we need to handle resume
      await this.handleResumeStep();

      // Process all form steps
      let isLastStep = false;
      let maxSteps = 10;
      let currentStep = 0;

      while (!isLastStep && currentStep < maxSteps) {
        currentStep++;
        this.showStatus(
          `Processing application step ${currentStep}...`,
          "info"
        );

        // Find the form container
        const formContainer = this.findFormContainer();
        if (!formContainer) {
          throw new Error("No form container found after waiting");
        }

        // Fill all visible form elements in this step
        await this.fillFormStep(formContainer);

        // Find and click continue/submit button
        const actionButton = this.findActionButton();

        if (!actionButton) {
          // Check if this is the success page
          if (this.isSuccessPage()) {
            this.showStatus(
              "Application submitted successfully! 🎉",
              "success"
            );
            isLastStep = true;
            return true;
          } else {
            this.showStatus(
              "Looking for any available action button...",
              "info"
            );
            // Wait briefly to see if success indicators appear
            await this.sleep(this.timeouts.STANDARD);

            if (this.isSuccessPage()) {
              this.showStatus(
                "Application submitted successfully! 🎉",
                "success"
              );
              isLastStep = true;
              return true;
            } else {
              // Try to find any clickable element as a last resort
              const anyButton = this.findAnyButton();
              if (anyButton) {
                this.showStatus(
                  "Found possible button, attempting to click...",
                  "info"
                );
                await this.clickButton(anyButton);
                await this.sleep(this.timeouts.STANDARD);
              } else {
                this.showStatus(
                  "No buttons found - form may be complete",
                  "warning"
                );
                isLastStep = true;
              }
            }
          }
        } else {
          // Check if this is the final submit button
          const buttonText = actionButton.textContent.trim().toLowerCase();
          if (this.isFinalSubmitButton(actionButton)) {
            this.showStatus("Submitting final application...", "info");
            isLastStep = true;
          } else {
            this.showStatus("Continuing to next step...", "info");
          }

          // Click the button using enhanced method
          await this.clickButton(actionButton);

          // Wait for next page to load
          await this.sleep(this.timeouts.STANDARD);
        }
      }

      //Final success check
      await this.sleep(this.timeouts.STANDARD);
      const success = this.isSuccessPage();
      if (success) {
        this.showStatus(
          "Application process completed successfully! 🎉",
          "success"
        );
      }
      return success;
    } catch (error) {
      this.showStatus(`Form filling error: ${error.message}`, "error");
      return false;
    }
  }

  /**
   * Check if this is the final submit button
   * @param {HTMLElement} button The button to check
   * @returns {boolean} True if it's a final submit button
   */
  isFinalSubmitButton(button) {
    if (!button) return false;

    const buttonText = button.textContent.trim().toLowerCase();
    return (
      buttonText.includes("submit") ||
      buttonText.includes("apply") ||
      buttonText === "submit application" ||
      buttonText === "submit your application"
    );
  }

  /**
   * Find the form container based on platform
   * @returns {HTMLElement} The form container
   */
  findFormContainer() {
    let container = null;

    if (this.platform === "indeed") {
      container =
        document.querySelector(this.selectors.INDEED.INDEED_FORM_CONTAINER) ||
        document.querySelector("form") ||
        document.body;
    } else {
      container =
        document.querySelector(this.selectors.GLASSDOOR.GD_FORM_CONTAINER) ||
        document.querySelector("form") ||
        document.body;
    }

    return container;
  }

  /**
   * Find an element by attribute that contains specified text
   * @param {string} attribute Attribute name
   * @param {string} value Attribute value
   * @param {string} textContent Text content to match
   * @returns {HTMLElement} The matching element
   */
  findElementByAttribute(attribute, value, textContent) {
    const elements = Array.from(
      document.querySelectorAll(`[${attribute}="${value}"]`)
    );
    return elements.find(
      (el) =>
        el.textContent &&
        el.textContent.trim().toLowerCase().includes(textContent.toLowerCase())
    );
  }

  /**
   * Handle all required checkboxes on the form
   * @param {HTMLElement} container The form container
   * @returns {Promise<void>}
   */
  async handleRequiredCheckboxes(container) {
    try {
      // Find all checkbox inputs
      const checkboxes = Array.from(
        container.querySelectorAll('input[type="checkbox"]')
      );

      for (const checkbox of checkboxes) {
        // Skip if not visible
        if (!this.isElementVisible(checkbox)) continue;

        // Check if this is required
        const isRequired =
          checkbox.hasAttribute("required") ||
          checkbox.hasAttribute("aria-required") ||
          checkbox.closest('[aria-required="true"]') ||
          checkbox.closest(".required");

        if (isRequired && !checkbox.checked) {
          this.showStatus("Checking required checkbox", "info");
          checkbox.click();
          await this.sleep(200);
        }
      }
    } catch (error) {
      this.logger(`Error handling required checkboxes: ${error.message}`);
    }
  }

  /**
   * Handle a specific form element based on its type
   * @param {HTMLElement} element The form element
   * @param {string} labelText The label text
   * @returns {Promise<void>}
   */
  async handleFormElement(element, labelText) {
    try {
      // Get options for this element (for select, radio, etc.)
      const options = this.getElementOptions(element);

      // Get value from AI or predefined mappings
      const value = await this.getValueForField(labelText, options);
      if (!value) return;

      // Apply the value to the element based on its type
      await this.applyValueToElement(element, value, labelText);
    } catch (error) {
      this.logger(`Error handling form element ${labelText}: ${error.message}`);
    }
  }

  /**
   * Handle radio input element
   * @param {HTMLElement} element The radio input
   * @param {string} value The value to apply
   * @param {string} labelText The label text
   * @returns {Promise<void>}
   */
  async handleRadioInput(element, value, labelText) {
    // Convert value to string and lowercase for comparison
    const normalizedValue = String(value).toLowerCase().trim();

    // Check if the radio button's value matches or its label contains the value
    const matches = (radioValue) => {
      const normalizedRadioValue = String(radioValue).toLowerCase().trim();
      return (
        normalizedValue === normalizedRadioValue ||
        normalizedRadioValue.includes(normalizedValue) ||
        normalizedValue.includes(normalizedRadioValue)
      );
    };

    // Find radio buttons in the same group
    const radioGroup = document.getElementsByName(element.name);

    for (const radio of radioGroup) {
      // Compare value with the radio button's value, label, or associated text
      const radioLabel = this.getElementLabel(radio);
      const radioValue = radio.value;

      if (matches(radioValue) || matches(radioLabel)) {
        // Simulate human-like interaction
        radio.focus();
        radio.click();
        return;
      }
    }

    // If no match is found and this is a required field, select the first option as fallback
    if (
      element.hasAttribute("required") ||
      element.closest('[aria-required="true"]')
    ) {
      if (radioGroup.length > 0) {
        this.showStatus(
          `No matching radio option found for "${value}", selecting first option as fallback`,
          "warning"
        );
        radioGroup[0].focus();
        radioGroup[0].click();
      }
    }
  }

  /**
   * Handle checkbox input element
   * @param {HTMLElement} element The checkbox input
   * @param {string} value The value to apply
   * @param {string} labelText The label text
   * @returns {Promise<void>}
   */
  async handleCheckboxInput(element, value, labelText) {
    // Normalize the value - we want to check if it implies "true" or selection
    const normalizedValue = String(value).toLowerCase().trim();
    const shouldBeChecked =
      normalizedValue === "true" ||
      normalizedValue === "1" ||
      normalizedValue === "yes" ||
      normalizedValue === "y";

    // Check current state and act accordingly
    if (shouldBeChecked && !element.checked) {
      element.focus();
      element.click();
      this.showStatus(`Checked: ${labelText}`, "info");
    } else if (!shouldBeChecked && element.checked) {
      element.focus();
      element.click();
      this.showStatus(`Unchecked: ${labelText}`, "info");
    }
  }

  /**
   * Handle phone input element with country code
   * @param {HTMLElement} element The phone input
   * @param {string} value The phone number
   * @returns {Promise<void>}
   */
  async handlePhoneInput(element, value) {
    try {
      // Find the country select element
      const countrySelect = element
        .closest(".PhoneInput")
        ?.querySelector("select");
      if (!countrySelect) {
        // No country selector, just set phone directly
        await this.simulateHumanInput(element, value);
        return;
      }

      // Parse phone number to extract country code and number
      const normalizedValue = value.replace(/[^\d+]/g, "");
      let countryCode = normalizedValue.match(/^\+?(\d{1,3})/)?.[1];
      let phoneNumber = normalizedValue.replace(/^\+?\d{1,3}/, "").trim();

      // Find matching country option
      const options = Array.from(countrySelect.options);
      const countryOption = options.find((opt) =>
        opt.text.includes(`(+${countryCode})`)
      );

      if (countryOption) {
        // Select country
        countrySelect.focus();
        countrySelect.value = countryOption.value;
        countrySelect.dispatchEvent(new Event("change", { bubbles: true }));
      }

      // Input phone number
      await this.simulateHumanInput(element, phoneNumber);
    } catch (error) {
      this.logger(`Error handling phone input: ${error.message}`);
      // Fallback to direct input
      await this.simulateHumanInput(element, value);
    }
  }

  /**
   * Get the label text for a form element
   * @param {HTMLElement} element The form element
   * @returns {string} The label text
   */
  getElementLabel(element) {
    // Try to get label from associated label element
    const labelElement = document.querySelector(`label[for="${element.id}"]`);
    if (labelElement) {
      return labelElement.textContent.trim();
    }

    // Try to get label from parent label element
    const parentLabel = element.closest("label");
    if (parentLabel) {
      // Get text content excluding nested input texts
      const labelText = Array.from(parentLabel.childNodes)
        .filter((node) => node.nodeType === Node.TEXT_NODE)
        .map((node) => node.textContent.trim())
        .join(" ")
        .trim();
      return labelText;
    }

    // For radio buttons, try to find the fieldset legend
    if (element.type === "radio") {
      const fieldset = element.closest("fieldset");
      const legend = fieldset?.querySelector("legend");
      if (legend) {
        return legend.textContent.trim();
      }
    }

    // Try to get label from aria-label
    if (element.getAttribute("aria-label")) {
      return element.getAttribute("aria-label").trim();
    }

    // Try to get label from placeholder
    if (element.placeholder) {
      return element.placeholder.trim();
    }

    // Try to find a label-like element near the radio button
    if (element.type === "radio") {
      const nearbyText =
        element.nextElementSibling?.textContent?.trim() ||
        element.previousElementSibling?.textContent?.trim();
      if (nearbyText) {
        return nearbyText;
      }
    }

    // If no label found, return the name attribute or empty string
    return element.name || "";
  }

  /**
   * Get options for a form element
   * @param {HTMLElement} element The form element
   * @returns {string[]} Array of options
   */
  getElementOptions(element) {
    switch (element.type) {
      case "select-one":
      case "select-multiple":
        return Array.from(element.options).map((opt) => opt.text.trim());

      case "radio":
        return Array.from(document.getElementsByName(element.name))
          .map((radio) => this.getElementLabel(radio))
          .filter(Boolean);

      case "checkbox":
        return ["Yes", "No"];

      default:
        return [];
    }
  }

  /**
   * Get a value for a form field based on label text
   * @param {string} labelText The label text
   * @param {string[]} options Available options
   * @returns {Promise<string>} The value to use
   */
  async getValueForField(labelText, options = []) {
    try {
      const normalizedLabel = labelText.toLowerCase().trim();

      // Use AI to determine best value
      const aiAnswer = await this.getAIAnswer(normalizedLabel, options);
      return aiAnswer;
    } catch (error) {
      this.logger(`Error getting value for ${labelText}: ${error.message}`);
      return "";
    }
  }

  /**
   * Get an appropriate answer from AI for a form field
   * @param {string} question - The field label/question
   * @param {Array<string>} options - Available options for select/radio fields
   * @returns {Promise<string>} - The AI-generated answer
   */
  async getAIAnswer(question, options = []) {
    try {
      // Make API request to get answer
      const response = await fetch(`${this.host}/api/ai-answer`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question,
          options,
          userData: this.userData,
          description: this.jobDescription,
        }),
      });

      if (!response.ok) {
        throw new Error(`AI service error: ${response.status}`);
      }

      const data = await response.json();
      return data.answer || "";
    } catch (error) {
      this.logger(`Error getting AI answer: ${error.message}`);
      return "";
    }
  }

  /**
   * Find the submit/continue button on the current form
   * @returns {HTMLElement} The button element
   */
  findActionButton() {
    // Look for buttons with clear action text
    const buttonTexts = ["submit", "continue", "next", "apply", "review"];

    for (const text of buttonTexts) {
      const button = this.findButtonByText(text);
      if (button && this.isElementVisible(button)) {
        return button;
      }
    }

    // Look for buttons with standard selectors
    const actionButton =
      document.querySelector(this.selectors.COMMON.SUBMIT_BUTTON) ||
      document.querySelector(this.selectors.COMMON.CONTINUE_BUTTON) ||
      document.querySelector(this.selectors.COMMON.ACTION_BUTTONS);

    if (actionButton && this.isElementVisible(actionButton)) {
      return actionButton;
    }

    return null;
  }

  /**
   * Find any visible button as a last resort
   * @returns {HTMLElement} The button element
   */
  findAnyButton() {
    const buttons = Array.from(document.querySelectorAll("button"));
    for (const button of buttons) {
      if (this.isElementVisible(button)) {
        return button;
      }
    }
    return null;
  }

  /**
   * Find a button by its text content
   * @param {string} text The text to search for
   * @returns {HTMLElement} The button element
   */
  findButtonByText(text) {
    const buttons = Array.from(document.querySelectorAll("button"));
    return buttons.find(
      (button) =>
        button.textContent &&
        button.textContent.trim().toLowerCase().includes(text.toLowerCase()) &&
        this.isElementVisible(button)
    );
  }

  /**
   * Find a link by its text content
   * @param {string} text The text to search for
   * @returns {HTMLElement} The link element
   */
  findLinkByText(text) {
    const links = Array.from(document.querySelectorAll("a"));
    return links.find(
      (link) =>
        link.textContent &&
        link.textContent.trim().toLowerCase().includes(text.toLowerCase()) &&
        this.isElementVisible(link)
    );
  }

  /**
   * Check if an element is visible
   * @param {HTMLElement} element The element to check
   * @returns {boolean} True if visible
   */
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

  /**
   * Check if we're on the success page
   * @returns {boolean} True if success page
   */
  isSuccessPage() {
    // Check for success indicators
    const successIndicators = [
      ".ia-ApplicationMessage-successMessage",
      ".ia-JobActionConfirmation-container",
      ".ia-SuccessPage",
      ".ia-JobApplySuccess",
      ".submitted-container",
      ".success-container",
    ];

    for (const selector of successIndicators) {
      const element = document.querySelector(selector);
      if (element && this.isElementVisible(element)) {
        return true;
      }
    }

    // Check for success text
    const pageText = document.body.innerText.toLowerCase();
    return (
      pageText.includes("application submitted") ||
      pageText.includes("successfully applied") ||
      pageText.includes("thank you for applying") ||
      pageText.includes("successfully submitted") ||
      pageText.includes("application complete")
    );
  }

  /**
   * Sleep for a specified time
   * @param {number} ms Milliseconds to sleep
   * @returns {Promise<void>}
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Apply value to form element
   * @param {HTMLElement} element Form element
   * @param {string} value The value to apply
   * @param {string} labelText The label text
   * @returns {Promise<void>}
   */
  async applyValueToElement(element, value, labelText) {
    if (!element || !value) return;

    const strValue = String(value).trim();
    if (!strValue) return;

    try {
      switch (element.tagName.toLowerCase()) {
        case "input":
          switch (element.type) {
            case "text":
            case "email":
            case "tel":
              // Check if this is a date field
              if (this.isDateField(element)) {
                await this.handleDateInput(element, strValue);
              } else {
                await this.simulateHumanInput(element, strValue);
              }
              break;

            case "number":
              // Extract only numeric portion
              const numValue = strValue.replace(/[^\d.-]/g, "");
              if (numValue) {
                await this.simulateHumanInput(element, numValue);
              }
              break;

            case "checkbox":
              const shouldCheck = ["yes", "true", "1", "y"].includes(
                strValue.toLowerCase()
              );
              if (
                (shouldCheck && !element.checked) ||
                (!shouldCheck && element.checked)
              ) {
                element.click();
              }
              break;
          }
          break;

        case "textarea":
          await this.simulateHumanInput(element, strValue);
          break;

        case "select":
          await this.handleSelect(element, strValue, labelText);
          break;
      }
    } catch (error) {
      this.logger(`Error applying value to ${labelText}: ${error.message}`);
    }
  }

  /**
   * Handle select element
   * @param {HTMLElement} element The select element
   * @param {string} value The value to apply
   * @param {string} labelText The label text
   * @returns {Promise<void>}
   */
  async handleSelect(element, value, labelText) {
    if (!element.options || element.options.length === 0) return;

    const normalizedValue = value.toLowerCase().trim();
    let selectedOption = null;

    // Skip placeholder options
    const startIndex = element.options[0].value ? 0 : 1;

    // Try exact match first
    for (let i = startIndex; i < element.options.length; i++) {
      const option = element.options[i];
      if (
        option.text.toLowerCase().trim() === normalizedValue ||
        option.value.toLowerCase() === normalizedValue
      ) {
        selectedOption = option;
        break;
      }
    }

    // If no exact match, try partial match
    if (!selectedOption) {
      for (let i = startIndex; i < element.options.length; i++) {
        const option = element.options[i];
        if (
          option.text.toLowerCase().includes(normalizedValue) ||
          normalizedValue.includes(option.text.toLowerCase())
        ) {
          selectedOption = option;
          break;
        }
      }
    }

    // Apply selection if found
    if (selectedOption) {
      element.value = selectedOption.value;
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.dispatchEvent(new Event("input", { bubbles: true }));
      this.showStatus(
        `Selected "${selectedOption.text}" for: ${labelText}`,
        "info"
      );
    } else {
      // If no match found and this is not the first option (placeholder),
      // select the first valid option as fallback
      if (startIndex < element.options.length) {
        this.showStatus(
          `No matching option for "${value}" in ${labelText}, using first option`,
          "warning"
        );
        element.value = element.options[startIndex].value;
        element.dispatchEvent(new Event("change", { bubbles: true }));
        element.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
  }

  /**
   * Simulate human input with proper event sequence
   * @param {HTMLElement} element Input element
   * @param {string} value Value to input
   * @returns {Promise<void>}
   */
  async simulateHumanInput(element, value) {
    try {
      element.focus();

      // Clear current value
      element.value = "";
      element.dispatchEvent(new Event("input", { bubbles: true }));
      await this.sleep(30);

      // Set new value
      element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      element.blur();
    } catch (error) {
      this.logger(`Error simulating input: ${error.message}`);
    }
  }

  /**
   * Handle the resume upload/selection step
   * @returns {Promise<boolean>} Success or failure
   */
  async handleResumeStep() {
    try {
      this.showStatus(`Checking for resume section...`, "info");

      // Check if we're on the resume step
      const isResumeStep = this.isResumeStep();

      if (!isResumeStep) {
        return true;
      }

      this.showStatus(`Found resume section, processing...`, "info");
      // Platform-specific handling
      if (this.platform === "glassdoor") {
        return await this.handleGlassdoorResumeStep();
      }

      // For Indeed - First check for already uploaded resume preview
      const resumePreview =
        document.querySelector(this.selectors.COMMON.RESUME_PREVIEW) ||
        document.querySelector("[aria-roledescription='document']");

      if (resumePreview) {
        this.showStatus("Resume already uploaded, continuing...", "info");

        // Find and click continue button
        const continueButton =
          document.querySelector(this.selectors.COMMON.CONTINUE_BUTTON) ||
          this.findButtonByText("Continue") ||
          this.findButtonByText("Next");

        if (continueButton) {
          await this.clickButton(continueButton);
          await this.sleep(this.timeouts.STANDARD);
        }

        return true;
      }

      // Next, check for resume selection options (previously uploaded resumes)
      const resumeOptions = document.querySelectorAll(
        this.selectors.INDEED.INDEED_RESUME_OPTIONS
      );

      if (resumeOptions && resumeOptions.length > 0) {
        this.showStatus(
          `Found existing resumes, selecting the first one...`,
          "info"
        );
        resumeOptions[0].click();
        await this.sleep(this.timeouts.SHORT);

        // Find and click continue
        const continueButton =
          document.querySelector(this.selectors.COMMON.CONTINUE_BUTTON) ||
          this.findButtonByText("Continue") ||
          this.findButtonByText("Next");

        if (continueButton) {
          await this.clickButton(continueButton);
          await this.sleep(this.timeouts.STANDARD);
        }

        return true;
      }

      // Check for Indeed resume vs File resume radio buttons
      const indeedResumeRadio = document.querySelector(
        this.selectors.COMMON.RESUME_RADIO_INDEED
      );
      const fileResumeRadio = document.querySelector(
        this.selectors.COMMON.RESUME_RADIO_FILE
      );

      if (indeedResumeRadio && fileResumeRadio) {
        // Prefer file upload since we have control over it
        this.showStatus("Selecting file resume option...", "info");
        fileResumeRadio.click();
        await this.sleep(this.timeouts.SHORT);

        // Continue with file upload
        return await this.handleResumeUpload();
      }

      // If no radio buttons, look for direct upload options
      return await this.handleResumeUpload();
    } catch (error) {
      this.showStatus(`Resume step error: ${error.message}`, "error");
      return false;
    }
  }

  /**
   * Check if we're on the resume upload/selection step
   * @returns {boolean} True if on resume step
   */
  isResumeStep() {
    // Platform-specific checks
    if (this.platform === "glassdoor") {
      // Glassdoor-specific resume step detection
      const gdResumeContainer = document.querySelector(
        this.selectors.GLASSDOOR.GD_RESUME_CONTAINER
      );
      const gdUploadButton = document.querySelector(
        this.selectors.GLASSDOOR.GD_RESUME_UPLOAD
      );

      if (gdResumeContainer || gdUploadButton) {
        return true;
      }

      // Check text content for Glassdoor resume indicators
      const pageText = document.body.innerText.toLowerCase();
      if (
        pageText.includes("upload your resume") ||
        pageText.includes("upload resume") ||
        pageText.includes("add your resume")
      ) {
        return true;
      }
    }

    // Common checks for both platforms
    // Check heading texts
    const resumeHeadings = Array.from(
      document.querySelectorAll("h1, h2, h3, label, legend")
    ).filter(
      (h) =>
        h.textContent &&
        (h.textContent.toLowerCase().includes("add your resume") ||
          h.textContent.toLowerCase().includes("resume") ||
          h.textContent.toLowerCase().includes("upload resume") ||
          h.textContent.toLowerCase().includes("choose a resume"))
    );

    // Check for resume-specific elements
    const hasResumeElements =
      document.querySelector(this.selectors.COMMON.RESUME_PREVIEW) ||
      document.querySelector(this.selectors.COMMON.RESUME_OPTIONS) ||
      document.querySelector(this.selectors.COMMON.RESUME_RADIO_INDEED) ||
      document.querySelector(this.selectors.COMMON.RESUME_RADIO_FILE) ||
      document.querySelector(this.selectors.INDEED.INDEED_RESUME_SECTION) ||
      document.querySelector('input[type="file"][accept*=".pdf"]') ||
      document.querySelector('input[type="file"][accept*=".doc"]');

    return resumeHeadings.length > 0 || hasResumeElements;
  }

  /**
   * Wait for file upload to complete
   * @param {HTMLElement} fileInput The file input element
   * @returns {Promise<boolean>} Success or failure
   */
  async waitForUploadComplete(fileInput) {
    const startTime = Date.now();
    let logCounter = 0;

    while (Date.now() - startTime < this.timeouts.UPLOAD) {
      // Only log progress occasionally and only if debugging is enabled
      if (this.enableDebug && logCounter % 10 === 0) {
        this.showStatus(
          `Waiting for upload... ${Math.round(
            (Date.now() - startTime) / 1000
          )}s`,
          "info"
        );
      }
      logCounter++;

      // Check if file input has a file
      if (fileInput.files.length > 0) {
        // Platform-specific success indicators
        if (this.platform === "glassdoor") {
          const successIndicators = [
            document.querySelector(".resumeUploadSuccess"),
            document.querySelector("[data-test='resume-upload-success']"),
            document.querySelector(".resumePreview"),
            document.querySelector(".uploadSuccess"),
          ];

          if (successIndicators.some((el) => el && this.isElementVisible(el))) {
            this.showStatus("Resume upload completed successfully!", "success");
            return true;
          }
        } else {
          // Indeed success indicators
          const successIndicator =
            document.querySelector(".upload-success") ||
            document.querySelector('[data-testid="resume-upload-success"]') ||
            document.querySelector("[data-testid='ResumeThumbnail']");

          if (successIndicator) {
            this.showStatus("Resume upload completed successfully!", "success");
            return true;
          }
        }

        // Check for generic success indicators
        const previewElements = document.querySelectorAll(
          "[aria-roledescription='document'], .resume-preview"
        );
        if (previewElements.length > 0) {
          this.showStatus("Resume upload completed successfully!", "success");
          return true;
        }
      }

      await this.sleep(300);
    }

    // If timeout reached
    this.showStatus(`Upload wait timeout reached`, "warning");

    // For Glassdoor, check one more time for anything that might indicate success
    if (this.platform === "glassdoor") {
      const anyPreview =
        document.querySelector(".resumePreview") ||
        document.querySelector("[data-test='resume-preview']") ||
        document.querySelector(".uploadedResume");

      if (anyPreview) {
        this.showStatus("Found resume preview after timeout", "success");
        return true;
      }
    }

    // Return file presence as fallback success indicator
    return fileInput.files.length > 0;
  }

  /**
   * Fill all form elements in the current step
   * @param {HTMLElement} container The form container
   * @returns {Promise<boolean>} Success or failure
   */
  async fillFormStep(container) {
    try {
      this.showStatus(`Filling form fields...`, "info");
      let hasVisibleFields = false;

      // FIRST PASS: Process all fieldsets (radio groups) as a single unit
      const fieldsets = Array.from(
        container.querySelectorAll('fieldset[role="radiogroup"]')
      );

      // If no fieldsets found with role="radiogroup", try other common fieldset selectors
      if (fieldsets.length === 0) {
        const altFieldsets = Array.from(
          container.querySelectorAll(
            'fieldset, .css-1ciavar, [data-testid^="input-q_"]'
          )
        );
        fieldsets.push(...altFieldsets);
      }

      for (const fieldset of fieldsets) {
        // Only process visible fieldsets
        if (!this.isElementVisible(fieldset)) {
          continue;
        }

        hasVisibleFields = true;

        // Get the question text from the legend or equivalent element
        let questionText = "";
        const legend = fieldset.querySelector("legend, .css-ae8cki");

        if (legend) {
          // Try various ways to extract the question text based on the structure
          const questionSpans = legend.querySelectorAll(
            ".css-gtr6b9, .css-bev4h3, .css-ft2u8r"
          );

          if (questionSpans.length > 0) {
            // Use the first span that contains text
            for (const span of questionSpans) {
              if (span.textContent.trim()) {
                questionText = span.textContent.trim();
                break;
              }
            }
          } else {
            // Fallback to legend text
            questionText = legend.textContent.trim();

            // Clean up the question text by removing unwanted child elements text
            const removeElements = legend.querySelectorAll(
              "button, .css-1afmp4o"
            );
            for (const el of removeElements) {
              questionText = questionText
                .replace(el.textContent.trim(), "")
                .trim();
            }
          }
        } else {
          // Try to find other question indicators
          const questionEl = fieldset.querySelector(
            '[class*="question"], [class*="Question"], [class*="label"], [class*="Label"]'
          );
          if (questionEl) {
            questionText = questionEl.textContent.trim();
          }
        }

        if (!questionText) {
          continue;
        }

        this.showStatus(`Processing question: "${questionText}"`, "info");

        // Get all available options from the radio buttons
        const optionLabels = [];
        const radioInputs = Array.from(
          fieldset.querySelectorAll('input[type="radio"]')
        );

        // Store a map from option text to radio input for later selection
        const optionMap = new Map();

        // Collect all option texts
        for (const radio of radioInputs) {
          const label = radio.closest("label");
          if (!label) continue;

          // Try different selectors for option text based on the provided HTML
          let optionText = "";
          const optionSpan = label.querySelector(".css-l5h8kx, .css-u74ql7");

          if (optionSpan) {
            optionText = optionSpan.textContent.trim();
          } else {
            // Fallback to label text excluding the radio button text
            optionText = label.textContent.trim();
          }

          if (optionText) {
            optionLabels.push(optionText);
            optionMap.set(optionText, radio);
          }
        }

        if (optionLabels.length === 0) {
          continue;
        }

        // Make a SINGLE API call with the proper question and all options
        const answer = await this.getValueForField(questionText, optionLabels);

        if (!answer) {
          // If no answer received and this is a required field, select the first option
          if (
            fieldset.getAttribute("aria-required") === "true" ||
            fieldset.classList.contains("required")
          ) {
            if (radioInputs.length > 0) {
              this.showStatus(
                "Selecting first option for required field",
                "warning"
              );
              radioInputs[0].click();
            }
          }
          continue;
        }

        // Now find the matching radio button and select it
        let foundMatch = false;
        const normalizedAnswer = answer.toLowerCase().trim();

        // First try exact match
        if (optionMap.has(answer)) {
          optionMap.get(answer).click();
          this.showStatus(`Selected: "${answer}"`, "info");
          foundMatch = true;
        } else {
          // Try case-insensitive match
          for (const [optionText, radio] of optionMap.entries()) {
            if (optionText.toLowerCase() === normalizedAnswer) {
              radio.click();
              this.showStatus(`Selected: "${optionText}"`, "info");
              foundMatch = true;
              break;
            }
          }

          // If still no match, try partial match
          if (!foundMatch) {
            for (const [optionText, radio] of optionMap.entries()) {
              if (
                optionText.toLowerCase().includes(normalizedAnswer) ||
                normalizedAnswer.includes(optionText.toLowerCase())
              ) {
                radio.click();
                this.showStatus(
                  `Selected: "${optionText}" (partial match)`,
                  "info"
                );
                foundMatch = true;
                break;
              }
            }

            // Last resort - try select an option if it contains key words from the answer
            if (!foundMatch) {
              const answerWords = normalizedAnswer.split(/\s+/);
              for (const [optionText, radio] of optionMap.entries()) {
                const optionLower = optionText.toLowerCase();
                for (const word of answerWords) {
                  if (word.length > 3 && optionLower.includes(word)) {
                    radio.click();
                    this.showStatus(
                      `Selected: "${optionText}" (keyword match)`,
                      "info"
                    );
                    foundMatch = true;
                    break;
                  }
                }
                if (foundMatch) break;
              }
            }
          }
        }

        if (!foundMatch) {
          // Select first option as fallback
          if (radioInputs.length > 0) {
            radioInputs[0].click();
            this.showStatus(`Selected first option as fallback`, "warning");
          }
        }

        // Mark fieldset as processed
        fieldset.dataset.processed = "true";
      }

      const elementTypes = [
        { selector: "textarea", type: "textarea" },
        { selector: "select", type: "select" },
        { selector: 'input[type="text"]', type: "text" },
        { selector: 'input[type="email"]', type: "email" },
        { selector: 'input[type="tel"]', type: "tel" },
        { selector: 'input[type="number"]', type: "number" },
        { selector: 'input[type="checkbox"]', type: "checkbox" },
        // Added date field selectors
        { selector: 'input[type="date"]', type: "date" },
        { selector: 'input[placeholder*="MM/DD/YYYY"]', type: "date" },
        { selector: 'input[placeholder*="mm/dd/yyyy"]', type: "date" },
      ];

      for (const { selector, type } of elementTypes) {
        const elements = container.querySelectorAll(selector);

        for (const element of elements) {
          // Skip if element is not visible or is in a processed fieldset
          if (
            !this.isElementVisible(element) ||
            element.closest('fieldset[data-processed="true"]')
          ) {
            continue;
          }

          hasVisibleFields = true;

          // Get proper label text
          const label = this.findLabelForElement(element);
          if (!label) continue;

          const labelText = this.extractLabelText(label);
          if (!labelText) continue;

          this.showStatus(
            `Processing ${
              type === "date" ? "date" : type
            } field: "${labelText}"`,
            "info"
          );

          // Get options for selects
          let options = [];
          if (type === "select") {
            options = Array.from(element.options)
              .filter((opt) => opt.value)
              .map((opt) => opt.text.trim());
          }

          // Get value from API
          const value = await this.getValueForField(labelText, options);
          if (!value) continue;

          // Apply value - handle date fields specially
          if (type === "date" || this.isDateField(element)) {
            await this.handleDateInput(element, value);
          } else {
            await this.applyValueToElement(element, value, labelText);
          }
        }
      }

      return hasVisibleFields;
    } catch (error) {
      this.showStatus(`Error filling form step: ${error.message}`, "error");
      return false;
    }
  }

  /**
   * Extract label text from label element, handling the Indeed structure
   * @param {HTMLElement} label The label element
   * @returns {string} The extracted label text
   */
  extractLabelText(label) {
    // First try platform-specific selectors
    if (this.platform === "glassdoor") {
      // Glassdoor label structure
      const questionSpan = label.querySelector(".css-gtr6b9, .css-bev4h3");
      if (questionSpan) {
        return questionSpan.textContent.trim();
      }
    } else {
      // Indeed label structure
      const questionSpan = label.querySelector(".css-ft2u8r");
      if (questionSpan) {
        return questionSpan.textContent.trim();
      }
    }

    // Common selectors as fallback
    const textSpan = label.querySelector("span:not(:empty)");
    if (textSpan) {
      return textSpan.textContent.trim();
    }

    // Fallback to full label text
    return label.textContent.trim();
  }

  /**
   * Find label element for a form element
   * @param {HTMLElement} element Form element
   * @returns {HTMLElement|null} Label element
   */
  findLabelForElement(element) {
    // If element has id, try to find label with for attribute
    if (element.id) {
      const label = document.querySelector(`label[for="${element.id}"]`);
      if (label) return label;
    }

    // If element is inside a label, return the label
    const parentLabel = element.closest("label");
    if (parentLabel) return parentLabel;

    // For textareas and selects, try to find label based on common patterns
    const previousSibling = element.previousElementSibling;
    if (
      previousSibling &&
      (previousSibling.tagName === "LABEL" ||
        previousSibling.classList.contains("css-ae8cki") ||
        previousSibling.querySelector('[class*="label"], [class*="Label"]'))
    ) {
      return previousSibling;
    }

    // Try to find nearby label using various selectors
    let currentEl = element;
    for (let i = 0; i < 3; i++) {
      // Check up to 3 levels up
      const parent = currentEl.parentElement;
      if (!parent) break;

      const nearbyLabel = parent.querySelector(
        'label, [class*="label"], [class*="Label"]'
      );
      if (nearbyLabel) return nearbyLabel;

      currentEl = parent;
    }

    return null;
  }

  /**
   * Upload file from URL to a file input element
   * @param {HTMLElement} fileInput The file input element
   * @param {Object} userData User data containing resume URL
   * @param {boolean} bypassVisibilityCheck Optional flag to bypass visibility check for hidden inputs
   * @returns {Promise<boolean>} Success or failure
   */
  async uploadFileFromURL(fileInput, userData, bypassVisibilityCheck = false) {
    try {
      // Skip visibility check if explicitly told to bypass it
      if (!bypassVisibilityCheck && !this.isElementVisibleOrHidden(fileInput)) {
        return false;
      }

      this.showStatus(`Uploading resume file...`, "info");

      // Try to use AI matching if job description is available
      let resumeUrl = userData.resumeUrl || userData.cv?.url;

      if (this.jobDescription && resumeUrl) {
        try {
          const matchedUrl = `https://resumify.fastapply.co/api/match`;
          const res = await fetch(matchedUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              resume_urls: Array.isArray(resumeUrl) ? resumeUrl : [resumeUrl],
              job_description: this.jobDescription,
            }),
          });

          const data = await res.json();
          if (data && data.highest_ranking_resume) {
            resumeUrl = data.highest_ranking_resume;
            this.showStatus("Using AI-matched resume", "info");
          }
        } catch (error) {
          this.logger(`Error in resume matching: ${error.message}`);
          // Continue with original resume URL
        }
      }

      // Use the first URL if resumeUrl is an array
      const finalResumeUrl = Array.isArray(resumeUrl)
        ? resumeUrl[0]
        : resumeUrl;

      if (!finalResumeUrl) {
        this.showStatus("No resume URL available", "error");
        return false;
      }

      // Use proxy to fetch the file
      const proxyURL = `${this.host}/api/proxy-file?url=${encodeURIComponent(
        finalResumeUrl
      )}&fresh=true&platform=${this.platform}`;

      const response = await fetch(proxyURL);

      if (!response.ok) {
        this.showStatus(
          `Failed to fetch resume file: ${response.status}`,
          "error"
        );
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }

      const blob = await response.blob();

      if (blob.size === 0) {
        this.showStatus("Received empty resume file", "error");
        throw new Error("Received empty file blob");
      }

      let filename = `${userData.firstName || "Resume"} ${
        userData.lastName || ""
      } resume.pdf`;

      // Get filename from Content-Disposition header
      const contentDisposition = response.headers.get("content-disposition");
      if (contentDisposition) {
        const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(
          contentDisposition
        );
        if (matches?.[1]) {
          // Remove any quotes and path information
          filename = matches[1].replace(/['"]/g, "");
        }
      }

      // Add timestamp to filename to ensure uniqueness
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const fileExt = filename.substring(filename.lastIndexOf("."));
      const filenameWithoutExt = filename.substring(
        0,
        filename.lastIndexOf(".")
      );
      filename = `${filenameWithoutExt}_${timestamp}${fileExt}`;

      // Create file object with sanitized filename
      const file = new File([blob], filename, {
        type: blob.type || "application/pdf",
        lastModified: Date.now(),
      });

      if (file.size === 0) {
        this.showStatus("Created file is empty", "error");
        throw new Error("Created file is empty");
      }

      // Add file to input
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;

      // Dispatch events in sequence with small delays
      await this.sleep(200);
      fileInput.dispatchEvent(new Event("focus", { bubbles: true }));
      await this.sleep(200);
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      await this.sleep(200);
      fileInput.dispatchEvent(new Event("input", { bubbles: true }));

      // Wait for upload to complete
      const uploadComplete = await this.waitForUploadComplete(fileInput);

      if (!uploadComplete) {
        this.showStatus(
          `Resume upload may not have completed fully`,
          "warning"
        );
        // For Glassdoor, we'll try to proceed anyway as their upload confirmation UI can be inconsistent
        return this.platform === "glassdoor";
      }

      return true;
    } catch (error) {
      this.showStatus(`Resume upload failed: ${error.message}`, "error");
      try {
        fileInput.value = "";
      } catch (e) {
        // Ignore
      }
      return false;
    }
  }

  /**
   * Check if an element exists in the DOM, even if hidden
   * @param {HTMLElement} element The element to check
   * @returns {boolean} True if the element exists
   */
  isElementVisibleOrHidden(element) {
    return element !== null && element !== undefined;
  }
}

export default FormHandler;
