// platforms/breezy/breezy-file-handler.js
//Extract
export class BreezyFileHandler {
  constructor(config = {}) {
    this.statusService = config.statusService;
    this.apiHost = config.apiHost;
    this.aiBaseUrl = "https://resumify-6b8b3d9b7428.herokuapp.com/api";
    this.processedInputs = new Set();
  }

  /**
   * Handle all file uploads in the form with duplicate prevention
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

      // Find all file input fields
      const fileInputs = form.querySelectorAll('input[type="file"]');
      if (fileInputs.length === 0) {
        this.showStatus("No file input fields found", "info");
        return true;
      }

      let uploadCount = 0;
      let successCount = 0;

      for (const fileInput of fileInputs) {
        const inputId = this.getInputIdentifier(fileInput);
        if (this.processedInputs.has(inputId)) {
          console.log(`⏭️ Skipping already processed input: ${inputId}`);
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
      fileInput.getAttribute("data-qa") ||
      `input-${Array.from(
        fileInput.form?.querySelectorAll('input[type="file"]') || []
      ).indexOf(fileInput)}`
    );
  }

  /**
   * Handle a single file upload field
   */
  async handleSingleFileUpload(fileInput, userDetails, jobDescription) {
    try {
      const fileType = this.determineFileType(fileInput);
      const fileUrls = userDetails.resumeUrl;
      if (!fileUrls || fileUrls.length === 0) {
        this.showStatus(`No ${fileType} files available`, "warning");
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
        return await this.uploadFileFromUrl(
          fileInput,
          fileUrls[fileUrls.length - 1]
        );
      }
    } catch (error) {
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
   * Upload blob to file input
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

      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      fileInput.files = dataTransfer.files;

      await this.dispatchFileEvents(fileInput);

      const uploadSuccess = await this.waitForUploadProcess(fileInput);

      if (uploadSuccess) {
        console.log(`✅ Successfully uploaded: ${cleanFileName}`);
      } else {
        console.warn(`⚠️ Upload may have failed: ${cleanFileName}`);
      }

      return uploadSuccess;
    } catch (error) {
      console.error("❌ Error uploading blob:", error);
      this.showStatus("Blob upload failed: " + error.message, "error");
      return false;
    }
  }

  /**
   * Enhanced filename extraction with proper URL decoding
   */
  extractFileNameFromUrl(url) {
    try {
      if (!url || typeof url !== "string") {
        return `resume_${Date.now()}.pdf`;
      }

      let workingUrl = url.trim();

      if (
        !workingUrl.startsWith("http://") &&
        !workingUrl.startsWith("https://")
      ) {
        workingUrl = "https://" + workingUrl;
      }

      let decodedUrl;
      try {
        decodedUrl = decodeURIComponent(workingUrl);
      } catch (decodeError) {
        decodedUrl = workingUrl;
      }

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
          fileInput.closest("form, .form-group") || fileInput.parentElement;

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
   * Dispatch file events on input element
   */
  async dispatchFileEvents(fileInput) {
    try {
      const changeEvent = new Event("change", { bubbles: true });
      fileInput.dispatchEvent(changeEvent);

      const inputEvent = new Event("input", { bubbles: true });
      fileInput.dispatchEvent(inputEvent);

      const blurEvent = new Event("blur", { bubbles: true });
      fileInput.dispatchEvent(blurEvent);

      fileInput.focus();
      await this.wait(50);
      fileInput.blur();

      await this.wait(100);
    } catch (error) {
      console.error("❌ Error dispatching file events:", error);
    }
  }

  /**
   * Check if file input is accessible
   */
  isFileInputAccessible(fileInput) {
    if (!fileInput) return false;

    // For Breezy's file inputs
    if (
      fileInput.classList.contains("file-input") ||
      fileInput.classList.contains("application-file-input")
    ) {
      return !fileInput.disabled && fileInput.offsetParent !== null;
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
        fileInput.closest(".form-group") || fileInput.parentElement;
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

      const formGroup = fileInput.closest(".form-group");
      if (formGroup) {
        const label = formGroup.querySelector(
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
   * Get file URLs from user details
   */
  getFileUrls(userDetails, fileType) {
    switch (fileType) {
      case "resume":
        if (userDetails.resumeUrl) {
          return [userDetails.resumeUrl];
        }

        // Handle nested array structure: [[url1, url2, url3]]
        if (userDetails.resumeUrls) {
          const urls = userDetails.resumeUrls;
          // Flatten the array if it's nested
          return Array.isArray(urls) ? urls.flat() : [];
        }

        return [];

      case "coverLetter":
        if (userDetails.coverLetterUrl) {
          return [userDetails.coverLetterUrl];
        }

        // Handle nested array structure for cover letters
        if (userDetails.coverLetterUrls) {
          const urls = userDetails.coverLetterUrls;
          return Array.isArray(urls) ? urls.flat() : [];
        }

        return [];

      default:
        // Default to resume handling
        if (userDetails.resumeUrl) {
          return [userDetails.resumeUrl];
        }

        if (userDetails.resumeUrls) {
          const urls = userDetails.resumeUrls;
          return Array.isArray(urls) ? urls.flat() : [];
        }

        return [];
    }
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
