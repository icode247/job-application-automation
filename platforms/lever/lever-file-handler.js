// platforms/lever/lever-file-handler.js
export default class LeverFileHandler {
  constructor(config = {}) {
    this.statusService = config.statusService;
    this.apiHost = config.apiHost || "http://localhost:3000";
    this.aiBaseUrl = "https://resumify-6b8b3d9b7428.herokuapp.com/api";
  }

  /**
   * Handle all file uploads in the form
   */
  async handleFileUploads(form, userDetails, jobDescription) {
    try {
      // Find all file input fields
      const fileInputs = form.querySelectorAll('input[type="file"]');

      if (fileInputs.length === 0) {
        console.log("No file input fields found");
        return true;
      }

      console.log(`Found ${fileInputs.length} file input field(s)`);

      for (const fileInput of fileInputs) {
        if (!this.isElementVisible(fileInput)) continue;

        try {
          await this.handleSingleFileUpload(
            fileInput,
            userDetails,
            jobDescription
          );
        } catch (error) {
          console.error("Error handling file upload:", error);
          // Continue with other file inputs even if one fails
        }
      }

      return true;
    } catch (error) {
      console.error("Error in handleFileUploads:", error);
      return false;
    }
  }

  /**
   * Handle a single file upload field
   */
  async handleSingleFileUpload(fileInput, userDetails, jobDescription) {
    try {
      // Determine what type of file this input expects
      const fileType = this.determineFileType(fileInput);
      console.log(`Processing ${fileType} file input`);

      // Get appropriate file URLs
      const fileUrls = this.getFileUrls(userDetails, fileType);

      if (!fileUrls || fileUrls.length === 0) {
        console.log(`No ${fileType} files available for user`);
        return false;
      }

      // Handle different file types
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
        // Fallback to simple file upload
        return await this.uploadFileFromUrl(fileInput, fileUrls[0]);
      }
    } catch (error) {
      console.error("Error handling single file upload:", error);
      return false;
    }
  }

  /**
   * Handle resume upload with AI optimization
   */
  async handleResumeUpload(fileInput, userDetails, jobDescription, fileUrls) {
    try {
      // Check if user has unlimited plan and prefers custom resume
      if (
        userDetails.plan === "unlimited" &&
        userDetails.jobPreferences?.useCustomResume === true
      ) {
        return await this.generateAndUploadCustomResume(
          fileInput,
          userDetails,
          jobDescription,
          fileUrls
        );
      } else {
        // Use existing matching service
        return await this.matchAndUploadResume(
          fileInput,
          userDetails,
          jobDescription,
          fileUrls
        );
      }
    } catch (error) {
      console.error("Error handling resume upload:", error);
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

      // Step 1: Parse existing resume
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

      // Step 2: Optimize resume for job
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

      // Step 3: Generate PDF
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

      // Get PDF blob
      const blob = await generateResponse.blob();

      if (blob.size === 0) {
        throw new Error("Generated PDF is empty");
      }

      // Create file and upload
      const fileName = `${userDetails.name || "resume"}.pdf`;
      await this.uploadBlob(fileInput, blob, fileName);

      this.showStatus("Custom resume generated successfully", "success");
      return true;
    } catch (error) {
      console.error("Error generating custom resume:", error);
      this.showStatus(
        "Custom resume generation failed, using existing resume",
        "warning"
      );

      // Fallback to regular resume
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

      // Upload the best matching resume
      const success = await this.uploadFileFromUrl(fileInput, bestResumeUrl);

      if (success) {
        this.showStatus("Resume uploaded successfully", "success");
      }

      return success;
    } catch (error) {
      console.error("Error matching resume:", error);
      this.showStatus(
        "Resume matching failed, using default resume",
        "warning"
      );

      // Fallback to first resume
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
      // For now, just upload the existing cover letter
      // TODO: Implement AI-generated cover letters for Lever
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
        console.log("No file URL provided");
        return false;
      }

      // Use proxy to fetch file
      const proxyUrl = `${this.apiHost}/api/proxy-file?url=${encodeURIComponent(
        fileUrl
      )}`;
      const response = await fetch(proxyUrl);

      if (!response.ok) {
        throw new Error(`Failed to fetch file: ${response.statusText}`);
      }

      const blob = await response.blob();
      const fileName = this.extractFileNameFromUrl(fileUrl);

      return await this.uploadBlob(fileInput, blob, fileName);
    } catch (error) {
      console.error("Error uploading file from URL:", error);
      return false;
    }
  }

  /**
   * Upload blob to file input
   */
  async uploadBlob(fileInput, blob, fileName) {
    try {
      if (blob.size === 0) {
        throw new Error("File is empty");
      }

      // Create File object
      const file = new File([blob], fileName, {
        type: blob.type || "application/pdf",
        lastModified: Date.now(),
      });

      // Create DataTransfer to simulate file selection
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      // Set files on input
      fileInput.files = dataTransfer.files;

      // Trigger events
      await this.dispatchFileEvents(fileInput);

      // Wait for upload to process
      await this.waitForUploadProcess(fileInput);

      console.log(`Successfully uploaded: ${fileName}`);
      return true;
    } catch (error) {
      console.error("Error uploading blob:", error);
      return false;
    }
  }

  /**
   * Dispatch file events to notify the page
   */
  async dispatchFileEvents(fileInput) {
    try {
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      fileInput.dispatchEvent(new Event("input", { bubbles: true }));

      // Additional events for Lever forms
      fileInput.dispatchEvent(new Event("blur", { bubbles: true }));

      await this.wait(100);
    } catch (error) {
      console.error("Error dispatching file events:", error);
    }
  }

  /**
   * Wait for upload process to complete
   */
  async waitForUploadProcess(fileInput, timeout = 30000) {
    return new Promise((resolve) => {
      const startTime = Date.now();

      const checkUpload = () => {
        // Check for success or error indicators
        const container =
          fileInput.closest("form, .lever-form-field, .form-group") ||
          fileInput.parentElement;

        // Look for success indicators
        const successSelectors = [
          ".upload-success",
          ".file-uploaded",
          ".upload-complete",
          ".success-message",
        ];

        const errorSelectors = [
          ".upload-error",
          ".file-error",
          ".error-message",
          ".upload-failed",
        ];

        for (const selector of successSelectors) {
          if (container?.querySelector(selector)) {
            resolve(true);
            return;
          }
        }

        for (const selector of errorSelectors) {
          if (container?.querySelector(selector)) {
            resolve(false);
            return;
          }
        }

        // Check if filename is displayed (common success indicator)
        const fileNameDisplay = container?.querySelector(
          ".filename, .file-name, .uploaded-file"
        );
        if (fileNameDisplay && fileNameDisplay.textContent.trim()) {
          resolve(true);
          return;
        }

        // Timeout check
        if (Date.now() - startTime > timeout) {
          resolve(true); // Assume success after timeout
          return;
        }

        setTimeout(checkUpload, 500);
      };

      checkUpload();
    });
  }

  /**
   * Determine file type based on input field context
   */
  determineFileType(fileInput) {
    try {
      // Check input attributes
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
        fileInput.closest(".lever-form-field, .form-group") ||
        fileInput.parentElement;
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

      // Default to resume
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
      // Method 1: Associated label
      if (fileInput.id) {
        const label = document.querySelector(`label[for="${fileInput.id}"]`);
        if (label) {
          return label.textContent.trim();
        }
      }

      // Method 2: Parent label
      const parentLabel = fileInput.closest("label");
      if (parentLabel) {
        return parentLabel.textContent.trim();
      }

      // Method 3: Lever-specific structure
      const leverField = fileInput.closest(".lever-form-field");
      if (leverField) {
        const label = leverField.querySelector(
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
    try {
      switch (fileType) {
        case "resume":
          if (userDetails.resumeUrl) {
            return [userDetails.resumeUrl];
          }
          if (userDetails.resumeUrls && Array.isArray(userDetails.resumeUrls)) {
            return userDetails.resumeUrls;
          }
          return [];

        case "coverLetter":
          if (userDetails.coverLetterUrl) {
            return [userDetails.coverLetterUrl];
          }
          if (
            userDetails.coverLetterUrls &&
            Array.isArray(userDetails.coverLetterUrls)
          ) {
            return userDetails.coverLetterUrls;
          }
          return [];

        default:
          return userDetails.resumeUrl
            ? [userDetails.resumeUrl]
            : userDetails.resumeUrls || [];
      }
    } catch (error) {
      console.error("Error getting file URLs:", error);
      return [];
    }
  }

  /**
   * Extract filename from URL
   */
  extractFileNameFromUrl(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const fileName = pathname.split("/").pop();

      if (fileName && fileName.includes(".")) {
        return fileName;
      }

      return "document.pdf";
    } catch (error) {
      return "document.pdf";
    }
  }

  /**
   * Show status message
   */
  showStatus(message, type = "info") {
    if (this.statusService) {
      this.statusService.show(message, type);
    } else {
      console.log(`[${type.toUpperCase()}] ${message}`);
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
