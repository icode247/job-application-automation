// platforms/ashby/ashby-file-handler.js
// handleFileUploads
export class AshbyFileHandler {
  constructor(config = {}) {
    this.statusService = config.statusService;
    this.apiHost = config.apiHost || "http://localhost:3000";
    this.aiBaseUrl = "https://resumify-6b8b3d9b7428.herokuapp.com/api";
    this.processedInputs = new Set();

    console.log("📎 AshbyFileHandler initialized:", {
      hasStatusService: !!this.statusService,
      apiHost: this.apiHost,
      aiBaseUrl: this.aiBaseUrl,
    });
  }

  /**
   * Handle all file uploads in the form with duplicate prevention
   */
  /**
   * Handle all file uploads in the form with enhanced debugging
   */
  async handleFileUploads(form, userDetails, jobDescription) {
    try {
      if (!form) {
        this.showStatus("No form provided for file uploads", "error");
        return false;
      }

      if (!userDetails) {
        this.showStatus("No user details provided for file uploads", "error");
        return false;
      }

      console.log("👤 User details structure:", {
        hasResumeUrl: !!userDetails.resumeUrl,
        hasResumeUrls: !!userDetails.resumeUrls,
        resumeUrlsType: typeof userDetails.resumeUrls,
        resumeUrlsLength: userDetails.resumeUrls?.length,
        hasCoverLetterUrl: !!userDetails.coverLetterUrl,
        userName: userDetails.name || userDetails.firstName,
      });

      // Find all file input fields
      const fileInputs = form.querySelectorAll('input[type="file"]');

      if (fileInputs.length === 0) {
        this.showStatus("No file input fields found", "info");
        return true;
      }

      console.log(`📁 Found ${fileInputs.length} file input(s)`);

      let uploadCount = 0;
      let successCount = 0;

      for (const fileInput of fileInputs) {
        const inputId = this.getInputIdentifier(fileInput);
        if (this.processedInputs.has(inputId)) {
          console.log(`⏭️ Skipping already processed input: ${inputId}`);
          continue;
        }

        if (!this.isFileInputAccessible(fileInput)) {
          console.log(`⏭️ Skipping inaccessible input: ${inputId}`);
          continue;
        }

        uploadCount++;
        this.processedInputs.add(inputId);

        try {
          const result = await this.handleSingleFileUpload(
            fileInput,
            userDetails,
            jobDescription
          );

          if (result) {
            successCount++;
            this.showStatus(
              `✅ File input ${uploadCount} processed successfully`,
              "success"
            );
          } else {
            this.showStatus(
              `⚠️ File input ${uploadCount} processing failed`,
              "warning"
            );
          }
        } catch (error) {
          console.error(`❌ File upload ${uploadCount} failed:`, error);
          this.showStatus(
            `File upload ${uploadCount} failed: ${error.message}`,
            "warning"
          );
        }
      }

      if (successCount > 0) {
        this.showStatus(
          `${successCount}/${uploadCount} file uploads completed`,
          "success"
        );
      } else if (uploadCount > 0) {
        this.showStatus("File uploads failed", "error");
      }

      return successCount > 0;
    } catch (error) {
      console.error("❌ File upload process failed:", error);
      this.showStatus("File upload process failed: " + error.message, "error");
      return false;
    }
  }

  /**
   * Get a unique identifier for file input to prevent duplicate processing
   */
  getInputIdentifier(fileInput) {
    return (
      fileInput.id ||
      fileInput.name ||
      fileInput.getAttribute("data-testid") ||
      `input-${Array.from(
        fileInput.form?.querySelectorAll('input[type="file"]') || []
      ).indexOf(fileInput)}`
    );
  }

  /**
   * Handle a single file upload field - Ashby specific
   */
  async handleSingleFileUpload(fileInput, userDetails, jobDescription) {
    try {
      console.log("🔍 Processing Ashby file upload field:", {
        inputId: fileInput.id,
        inputName: fileInput.name,
        isHidden: fileInput.style.display === "none",
      });

      const fileType = this.determineFileType(fileInput);
      let fileUrls = this.getFileUrls(userDetails, fileType);

      console.log("📋 File URLs retrieved:", {
        fileType,
        urlCount: fileUrls.length,
        firstUrl: fileUrls[0]?.substring(0, 100) + "..." || "No URLs",
      });

      if (!fileUrls || fileUrls.length === 0) {
        this.showStatus(`No ${fileType} files available`, "warning");
        return false;
      }

      // Ensure we have valid URLs (not nested arrays)
      if (typeof fileUrls[0] !== "string") {
        console.error("❌ File URLs are not strings:", fileUrls);
        this.showStatus(`Invalid file URL format for ${fileType}`, "error");
        return false;
      }

      if (fileType === "resume" && jobDescription) {
        return await this.handleResumeUpload(
          fileInput,
          userDetails,
          jobDescription,
          fileUrls
        );
      } else if (fileType === "coverLetter" && jobDescription) {
        return await this.handleCoverLetterUpload(
          fileInput,
          userDetails,
          jobDescription,
          fileUrls
        );
      } else {
        return await this.uploadFileFromUrl(fileInput, fileUrls[0]);
      }
    } catch (error) {
      console.error("❌ Error in handleSingleFileUpload:", error);
      this.showStatus("Single file upload failed: " + error.message, "error");
      return false;
    }
  }
  /**
   * Handle resume upload with AI optimization
   */
  async handleResumeUpload(fileInput, userDetails, jobDescription, fileUrls) {
    try {
      if (
        userDetails.plan === "unlimited" &&
        userDetails.jobPreferences?.useCustomResume === true
      ) {
        this.showStatus("Generating custom resume, please wait...", "info");
        return await this.generateAndUploadCustomResume(
          fileInput,
          userDetails,
          jobDescription,
          fileUrls
        );
      } else {
        this.showStatus(
          "Matching resume to job description, please wait...",
          "info"
        );
        return await this.matchAndUploadResume(
          fileInput,
          userDetails,
          jobDescription,
          fileUrls
        );
      }
    } catch (error) {
      this.showStatus("Resume upload failed: " + error.message, "error");
      return false;
    }
  }

  /**
   * Generate and upload custom resume for unlimited users
   */
  async generateAndUploadCustomResume(
    fileInput,
    userDetails,
    jobDescription,
    fileUrls
  ) {
    try {
      this.showStatus("Generating custom resume, please wait...", "info");

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
        this.showStatus("Failed to generate resume, please try again", "error");
        throw new Error(`Resume generation failed: ${generateResponse.status}`);
      }

      const blob = await generateResponse.blob();

      if (blob.size === 0) {
        throw new Error("Generated PDF is empty");
      }

      const fileName = `${userDetails.name || "resume"}.pdf`;
      await this.uploadBlob(fileInput, blob, fileName);

      this.showStatus("Custom resume generated successfully", "success");
      return true;
    } catch (error) {
      this.showStatus(
        "Custom resume generation failed, using existing resume",
        "warning"
      );
      return await this.uploadFileFromUrl(fileInput, fileUrls[0]);
    }
  }

  /**
   * Match and upload best resume for the job
   */
  async matchAndUploadResume(fileInput, userDetails, jobDescription, fileUrls) {
    try {
      this.showStatus(
        "Matching resume to job description, please wait...",
        "info"
      );

      const matchResponse = await fetch(`${this.aiBaseUrl}/match`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          resume_urls: fileUrls,
          job_description: jobDescription,
        }),
      });

      if (!matchResponse.ok) {
        throw new Error(`Resume matching failed: ${matchResponse.status}`);
      }

      const matchData = await matchResponse.json();
      const bestResumeUrl = matchData.highest_ranking_resume;

      this.showStatus("Uploading matched resume...", "info");

      const success = await this.uploadFileFromUrl(fileInput, bestResumeUrl);

      if (success) {
        this.showStatus("Resume uploaded successfully", "success");
      }

      return success;
    } catch (error) {
      this.showStatus(
        "Resume matching failed, using default resume",
        "warning"
      );
      return await this.uploadFileFromUrl(fileInput, fileUrls[0]);
    }
  }

  /**
   * Handle cover letter upload
   */
  async handleCoverLetterUpload(
    fileInput,
    userDetails,
    jobDescription,
    fileUrls
  ) {
    try {
      if (fileUrls.length > 0) {
        return await this.uploadFileFromUrl(fileInput, fileUrls[0]);
      }
      return false;
    } catch (error) {
      console.error("Error handling cover letter upload:", error);
      return false;
    }
  }

  /**
   * Upload file from URL
   */
  async uploadFileFromUrl(fileInput, fileUrl) {
    try {
      if (!fileUrl) {
        this.showStatus("No file URL provided", "error");
        return false;
      }

      if (!fileInput) {
        this.showStatus("No file input provided", "error");
        return false;
      }

      this.showStatus("Downloading file...", "info");

      const proxyUrl = `${this.apiHost}/api/proxy-file?url=${encodeURIComponent(
        fileUrl
      )}`;

      const response = await fetch(proxyUrl);

      if (!response.ok) {
        throw new Error(
          `Failed to fetch file: ${response.status} ${response.statusText}`
        );
      }

      const blob = await response.blob();

      if (blob.size === 0) {
        throw new Error("Downloaded file is empty");
      }

      const fileName = this.extractFileNameFromUrl(fileUrl);

      this.showStatus("Uploading file to form...", "info");
      const uploadResult = await this.uploadBlob(fileInput, blob, fileName);

      if (uploadResult) {
        this.showStatus("File uploaded successfully", "success");
      }

      return uploadResult;
    } catch (error) {
      console.error("❌ Error uploading file from URL:", error);
      this.showStatus("File upload failed: " + error.message, "error");
      return false;
    }
  }

  /**
   * Wait for Ashby upload process to complete
   */
  async waitForAshbyUploadProcess(fileInput, container, timeout = 30000) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let checkCount = 0;

      const checkUpload = () => {
        checkCount++;
        const elapsed = Date.now() - startTime;

        console.log(
          `🔍 Checking Ashby upload progress (attempt ${checkCount})`
        );

        // Check if files are set on the input
        if (fileInput.files && fileInput.files.length > 0) {
          console.log("✅ Files are set on input:", fileInput.files[0].name);

          // Look for success indicators in Ashby's structure
          if (container) {
            // Check if upload button text changed
            const uploadButton = container.querySelector("button");
            if (uploadButton) {
              const buttonText = uploadButton.textContent.toLowerCase();
              console.log("📝 Upload button text:", buttonText);

              if (
                buttonText.includes("uploaded") ||
                buttonText.includes("selected") ||
                buttonText.includes(fileInput.files[0].name.toLowerCase())
              ) {
                console.log("✅ Upload button shows success state");
                resolve(true);
                return;
              }
            }

            // Check for filename display
            const fileNameDisplay = container.querySelector(
              '[class*="fileName"], [class*="file-name"], .uploaded-file'
            );
            if (fileNameDisplay && fileNameDisplay.textContent.trim()) {
              console.log(
                "✅ File name displayed:",
                fileNameDisplay.textContent
              );
              resolve(true);
              return;
            }

            // Check for any success indicators
            const successElements = container.querySelectorAll(
              '[class*="success"], [class*="uploaded"], [class*="complete"]'
            );
            if (successElements.length > 0) {
              console.log("✅ Found success indicators");
              resolve(true);
              return;
            }
          }

          // If we have files but no visual confirmation after reasonable time, assume success
          if (elapsed > 10000) {
            console.log(
              "✅ Assuming upload success after 10 seconds with files present"
            );
            resolve(true);
            return;
          }
        }

        // Check for error indicators
        if (container) {
          const errorElements = container.querySelectorAll(
            '[class*="error"], [class*="failed"]'
          );
          if (errorElements.length > 0) {
            console.log("❌ Found error indicators");
            resolve(false);
            return;
          }
        }

        if (elapsed > timeout) {
          console.log("⏰ Upload timeout reached");
          // If files are present, assume partial success
          resolve(fileInput.files && fileInput.files.length > 0);
          return;
        }

        setTimeout(checkUpload, 1000);
      };

      checkUpload();
    });
  }

  /**
   * Upload blob to Ashby file input (handles hidden inputs)
   */
  async uploadBlob(fileInput, blob, originalFileName) {
    try {
      if (blob.size === 0) {
        throw new Error("File is empty");
      }

      const cleanFileName = this.extractFileNameFromUrl(originalFileName);

      const file = new File([blob], cleanFileName, {
        type: blob.type || "application/pdf",
        lastModified: Date.now(),
      });

      console.log("📎 Uploading to Ashby file input:", {
        fileName: cleanFileName,
        fileSize: file.size,
        inputId: fileInput.id,
        isHidden: fileInput.style.display === "none",
      });

      // Find the file input container
      const container =
        fileInput.closest("._container_6k3nb_71") ||
        fileInput.closest("._fieldEntry_hkyf8_29") ||
        fileInput.parentElement;

      // Create DataTransfer and set files on the hidden input
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;

      console.log(
        "✅ File set on hidden input, files length:",
        fileInput.files.length
      );

      // Dispatch events on the hidden file input
      await this.dispatchFileEvents(fileInput);

      // For Ashby, we need to simulate the file being selected through their custom UI
      // Try to trigger their custom file handler
      if (container) {
        // Look for the custom upload button
        const uploadButton = container.querySelector(
          '._button_6k3nb_107, button[class*="button"]'
        );

        if (
          uploadButton &&
          uploadButton.textContent.toLowerCase().includes("upload")
        ) {
          console.log(
            "🔘 Found Ashby upload button, simulating file selection"
          );

          // Create a custom event to simulate file selection
          const changeEvent = new Event("change", { bubbles: true });
          Object.defineProperty(changeEvent, "target", {
            writable: false,
            value: fileInput,
          });

          // Dispatch on the container to trigger Ashby's handlers
          container.dispatchEvent(changeEvent);
          await this.wait(500);
        }

        // Also try triggering drop event in case Ashby listens for that
        const dropEvent = new DragEvent("drop", {
          bubbles: true,
          dataTransfer: dataTransfer,
        });
        container.dispatchEvent(dropEvent);
        await this.wait(200);
      }

      // Wait for Ashby's upload processing
      const uploadSuccess = await this.waitForAshbyUploadProcess(
        fileInput,
        container
      );

      if (uploadSuccess) {
        console.log(`✅ Successfully uploaded to Ashby: ${cleanFileName}`);
        this.showStatus(`File uploaded: ${cleanFileName}`, "success");
      } else {
        console.warn(`⚠️ Ashby upload may have failed: ${cleanFileName}`);
        this.showStatus(`Upload may have failed: ${cleanFileName}`, "warning");
      }

      return uploadSuccess;
    } catch (error) {
      console.error("❌ Error uploading to Ashby:", error);
      this.showStatus("Ashby upload failed: " + error.message, "error");
      return false;
    }
  }

  /**
   * Enhanced filename extraction with proper URL decoding
   */
  extractFileNameFromUrl(url) {
    try {
      const decodedUrl = decodeURIComponent(url);

      const urlObj = new URL(decodedUrl);
      let fileName = urlObj.pathname.split("/").pop();

      if (!fileName || !fileName.includes(".") || fileName.includes("%")) {
        const pathParts = decodedUrl.split("/");
        for (let i = pathParts.length - 1; i >= 0; i--) {
          const part = pathParts[i];
          if (part.includes(".pdf") || part.includes(".doc")) {
            fileName = part;
            break;
          }
        }
      }

      if (fileName && fileName.includes(".")) {
        fileName = fileName
          .replace(/%[0-9A-F]{2}/gi, "")
          .replace(/[^\w\s.-]/gi, "")
          .replace(/\s+/g, "_")
          .trim();

        if (!fileName.match(/\.(pdf|doc|docx)$/i)) {
          fileName += ".pdf";
        }

        return fileName;
      }

      return `resume_${Date.now()}.pdf`;
    } catch (error) {
      console.error("Error extracting filename:", error);
      return `resume_${Date.now()}.pdf`;
    }
  }

  /**
   * Wait for upload process to complete
   */
  async waitForUploadProcess(fileInput, timeout = 30000) {
    return new Promise((resolve) => {
      const startTime = Date.now();
      let checkCount = 0;

      const checkUpload = () => {
        checkCount++;
        const elapsed = Date.now() - startTime;

        const container =
          fileInput.closest("form, .form-field") || fileInput.parentElement;

        // Look for success indicators
        const successSelectors = [
          ".upload-success",
          ".file-uploaded",
          ".upload-complete",
          ".success-message",
          ".file-success",
          ".uploaded",
          ".file-name",
          ".filename",
          ".selected-file",
        ];

        for (const selector of successSelectors) {
          const element = container?.querySelector(selector);
          if (element && element.textContent.trim()) {
            resolve(true);
            return;
          }
        }

        // Check if the filename is displayed
        if (fileInput.files && fileInput.files.length > 0) {
          const fileName = fileInput.files[0].name;
          const containerText = container?.textContent || "";
          if (containerText.includes(fileName.split(".")[0])) {
            resolve(true);
            return;
          }
        }

        // Check for errors
        const errorSelectors = [
          ".upload-error",
          ".file-error",
          ".error-message",
          ".upload-failed",
          ".file-failed",
          ".error",
          ".validation-error",
        ];

        for (const selector of errorSelectors) {
          const element = container?.querySelector(selector);
          if (element && element.textContent.trim()) {
            const errorText = element.textContent.trim();

            const ignoredErrors = [
              "File exceeds the maximum upload size of 100MB",
              "Please select a file",
              "Invalid file type",
            ];

            const isIgnoredError = ignoredErrors.some((ignored) =>
              errorText.includes(ignored)
            );

            if (!isIgnoredError) {
              resolve(false);
              return;
            }
          }
        }

        // Check for file input state
        if (fileInput.files && fileInput.files.length > 0) {
          if (elapsed > 10000) {
            resolve(true);
            return;
          }
        }

        if (elapsed > timeout) {
          if (fileInput.files && fileInput.files.length > 0) {
            resolve(true);
          } else {
            resolve(false);
          }
          return;
        }

        setTimeout(checkUpload, 500);
      };

      checkUpload();
    });
  }

  /**
   * Enhanced dispatch file events for Ashby
   */
  async dispatchFileEvents(fileInput) {
    try {
      console.log("🎯 Dispatching Ashby file events");

      // Standard file events
      const changeEvent = new Event("change", { bubbles: true });
      fileInput.dispatchEvent(changeEvent);

      const inputEvent = new Event("input", { bubbles: true });
      fileInput.dispatchEvent(inputEvent);

      // Focus/blur cycle
      try {
        fileInput.focus();
        await this.wait(50);
        fileInput.blur();
      } catch (e) {
        // Hidden inputs can't be focused, that's ok
      }

      // Additional events that Ashby might listen for
      const loadEvent = new Event("load", { bubbles: true });
      fileInput.dispatchEvent(loadEvent);

      await this.wait(100);
      console.log("✅ Ashby file events dispatched");
    } catch (error) {
      console.error("❌ Error dispatching Ashby file events:", error);
    }
  }

  /**
   * Check if file input is accessible (handles Ashby hidden inputs)
   */
  isFileInputAccessible(fileInput) {
    if (!fileInput) return false;

    // For Ashby, the file input is hidden but still functional
    if (fileInput.style.display === "none" && fileInput.type === "file") {
      // Check if the container is visible
      const container =
        fileInput.closest("._container_6k3nb_71") ||
        fileInput.closest("._fieldEntry_hkyf8_29");
      return container && this.isElementVisible(container);
    }

    return this.isElementVisible(fileInput);
  }

  /**
   * Determine file type based on input field context
   */
  determineFileType(fileInput) {
    try {
      const name = (fileInput.name || "").toLowerCase();
      const id = (fileInput.id || "").toLowerCase();

      if (
        name.includes("resume") ||
        id.includes("resume") ||
        name.includes("cv") ||
        id.includes("cv")
      ) {
        return "resume";
      }

      if (
        name.includes("cover") ||
        id.includes("cover") ||
        name.includes("letter") ||
        id.includes("letter")
      ) {
        return "coverLetter";
      }

      // Check surrounding context
      const container =
        fileInput.closest(".form-field") || fileInput.parentElement;
      if (container) {
        const containerText = container.textContent.toLowerCase();

        if (containerText.includes("resume") || containerText.includes("cv")) {
          return "resume";
        }

        if (
          containerText.includes("cover letter") ||
          containerText.includes("cover")
        ) {
          return "coverLetter";
        }
      }

      // Check label
      const label = this.getFileInputLabel(fileInput);
      if (label) {
        const labelText = label.toLowerCase();

        if (labelText.includes("resume") || labelText.includes("cv")) {
          return "resume";
        }

        if (labelText.includes("cover") || labelText.includes("letter")) {
          return "coverLetter";
        }
      }

      return "resume";
    } catch (error) {
      console.error("Error determining file type:", error);
      return "resume";
    }
  }

  /**
   * Get label for file input
   */
  getFileInputLabel(fileInput) {
    try {
      if (fileInput.id) {
        const label = document.querySelector(`label[for="${fileInput.id}"]`);
        if (label) {
          return label.textContent.trim();
        }
      }

      const parentLabel = fileInput.closest("label");
      if (parentLabel) {
        return parentLabel.textContent.trim();
      }

      const formField = fileInput.closest(".form-field");
      if (formField) {
        const label = formField.querySelector(
          "label, .form-label, .field-label"
        );
        if (label) {
          return label.textContent.trim();
        }
      }

      return "";
    } catch (error) {
      return "";
    }
  }

  /**
   * Get file URLs from user details with enhanced debugging
   */
  getFileUrls(userDetails, fileType) {
    let urls = [];

    switch (fileType) {
      case "resume":
        if (userDetails.resumeUrl) {
          urls = [userDetails.resumeUrl];
        } else if (userDetails.resumeUrls) {
          urls = userDetails.resumeUrls;
        }
        break;

      case "coverLetter":
        if (userDetails.coverLetterUrl) {
          urls = [userDetails.coverLetterUrl];
        }
        break;

      default:
        if (userDetails.resumeUrl) {
          urls = [userDetails.resumeUrl];
        } else if (userDetails.resumeUrls) {
          urls = userDetails.resumeUrls;
        }
        break;
    }

    // Flatten nested arrays - handle case where resumeUrls contains arrays
    const flattenUrls = (arr) => {
      if (!Array.isArray(arr)) return [];

      const result = [];
      for (const item of arr) {
        if (Array.isArray(item)) {
          result.push(...flattenUrls(item)); // Recursively flatten
        } else if (typeof item === "string" && item.trim()) {
          result.push(item.trim());
        }
      }
      return result;
    };

    const flatUrls = flattenUrls(urls);

    console.log("📎 File URLs processed:", {
      fileType,
      originalUrls: urls,
      flattenedUrls: flatUrls,
      count: flatUrls.length,
    });

    return flatUrls;
  }

  /**
   * Show status message
   */
  showStatus(message, type = "info") {
    console.log(`[${type.toUpperCase()}] ${message}`);

    if (
      this.statusService &&
      typeof this.statusService.addMessage === "function"
    ) {
      this.statusService.addMessage(message, type);
    } else if (
      this.statusService &&
      typeof this.statusService.show === "function"
    ) {
      this.statusService.show(message, type);
    }
  }

  /**
   * Check if element is visible
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
   * Wait utility
   */
  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
