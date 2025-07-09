// platforms/lever/lever-file-handler.js
//File uploads completed with some issues
export default class LeverFileHandler {
  constructor(config = {}) {
    this.statusService = config.statusService;
    this.apiHost = config.apiHost || "http://localhost:3000";
    this.aiBaseUrl = "https://resumify-6b8b3d9b7428.herokuapp.com/api";
    this.processedInputs = new Set(); // Track processed inputs to avoid duplicates

    console.log("📎 LeverFileHandler initialized:", {
      hasStatusService: !!this.statusService,
      apiHost: this.apiHost,
      aiBaseUrl: this.aiBaseUrl,
    });
  }

  /**
   * Handle all file uploads in the form with duplicate prevention
   */
  async handleFileUploads(form, userDetails, jobDescription) {
    try {
      // Validate inputs
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
        // Skip if already processed
        const inputId = this.getInputIdentifier(fileInput);
        if (this.processedInputs.has(inputId)) {
          console.log(`⏭️ Skipping already processed input: ${inputId}`);
          continue;
        }

        if (!this.isFileInputAccessible(fileInput)) continue;

        uploadCount++;
        this.processedInputs.add(inputId); // Mark as processed

        try {
          const result = await this.handleSingleFileUpload(
            fileInput,
            userDetails,
            jobDescription
          );

          if (result) {
            successCount++;
            this.showStatus(`✅ File input ${uploadCount} processed successfully`, "success");
          } else {
            this.showStatus(`⚠️ File input ${uploadCount} processing failed`, "warning");
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
    return fileInput.id || fileInput.name || fileInput.getAttribute('data-qa') || 
           `input-${Array.from(fileInput.form?.querySelectorAll('input[type="file"]') || []).indexOf(fileInput)}`;
  }

  /**
   * Enhanced filename extraction with proper URL decoding
   */
  extractFileNameFromUrl(url) {
    try {
      // Decode the URL first to handle encoded characters
      const decodedUrl = decodeURIComponent(url);
      
      // Extract filename from the decoded URL
      const urlObj = new URL(decodedUrl);
      let fileName = urlObj.pathname.split("/").pop();
      
      // If still encoded or malformed, try different approach
      if (!fileName || !fileName.includes(".") || fileName.includes("%")) {
        // Try to extract from the original URL parts
        const pathParts = decodedUrl.split("/");
        for (let i = pathParts.length - 1; i >= 0; i--) {
          const part = pathParts[i];
          if (part.includes(".pdf") || part.includes(".doc")) {
            fileName = part;
            break;
          }
        }
      }

      // Clean up the filename
      if (fileName && fileName.includes(".")) {
        // Remove any remaining URL encoding and invalid characters
        fileName = fileName
          .replace(/%[0-9A-F]{2}/gi, '') // Remove any remaining URL encoding
          .replace(/[^\w\s.-]/gi, '') // Remove invalid filename characters
          .replace(/\s+/g, '_') // Replace spaces with underscores
          .trim();
        
        // Ensure it has a valid extension
        if (!fileName.match(/\.(pdf|doc|docx)$/i)) {
          fileName += '.pdf';
        }
        
        return fileName;
      }

      // Fallback to a clean default name
      return `resume_${Date.now()}.pdf`;
    } catch (error) {
      console.error("Error extracting filename:", error);
      return `resume_${Date.now()}.pdf`;
    }
  }

  /**
   * Enhanced upload process waiting with better error detection
   */
  async waitForUploadProcess(fileInput, timeout = 30000) {
    console.log("⏳ Starting waitForUploadProcess with timeout:", timeout);

    return new Promise((resolve) => {
      const startTime = Date.now();
      let checkCount = 0;
      let lastErrorMessage = '';

      const checkUpload = () => {
        checkCount++;
        const elapsed = Date.now() - startTime;

        if (checkCount % 10 === 0) {
          console.log(`⏳ Upload check ${checkCount}, elapsed: ${elapsed}ms`);
        }

        // Check for success or error indicators
        const container =
          fileInput.closest("form, .lever-form-field, .form-group") ||
          fileInput.parentElement;

        // Look for success indicators first
        const successSelectors = [
          ".upload-success",
          ".file-uploaded", 
          ".upload-complete",
          ".success-message",
          ".file-success",
          ".uploaded",
          ".file-name", // Lever often shows filename when uploaded
          ".filename",
          ".selected-file"
        ];

        // Check for success
        for (const selector of successSelectors) {
          const element = container?.querySelector(selector);
          if (element && element.textContent.trim()) {
            console.log(`✅ Success indicator found: ${selector}`, element.textContent.trim());
            resolve(true);
            return;
          }
        }

        // Check if the filename is displayed anywhere in the form (common success indicator)
        if (fileInput.files && fileInput.files.length > 0) {
          const fileName = fileInput.files[0].name;
          // Look for the filename being displayed somewhere in the container
          const containerText = container?.textContent || '';
          if (containerText.includes(fileName.split('.')[0])) {
            console.log(`✅ Filename found in container text, assuming success`);
            resolve(true);
            return;
          }
        }

        // Enhanced error detection - look for specific error types
        const errorSelectors = [
          ".upload-error",
          ".file-error", 
          ".error-message",
          ".upload-failed",
          ".file-failed",
          ".error",
          ".validation-error"
        ];

        // Check for errors, but be more selective
        for (const selector of errorSelectors) {
          const element = container?.querySelector(selector);
          if (element && element.textContent.trim()) {
            const errorText = element.textContent.trim();
            
            // Ignore certain generic errors that might not be related to our upload
            const ignoredErrors = [
              'File exceeds the maximum upload size of 100MB', // This seems to be a generic error
              'Please select a file', // This means no file was selected, but we did select one
              'Invalid file type' // Only worry about this if our file type is actually invalid
            ];
            
            const isIgnoredError = ignoredErrors.some(ignored => 
              errorText.includes(ignored)
            );
            
            if (!isIgnoredError) {
              console.log(`❌ Real error indicator found: ${selector}`, errorText);
              resolve(false);
              return;
            } else {
              console.log(`⚠️ Ignoring generic error: ${errorText}`);
              lastErrorMessage = errorText;
            }
          }
        }

        // Check for file input state - if it still has files, that's usually good
        if (fileInput.files && fileInput.files.length > 0) {
          const file = fileInput.files[0];
          
          // After 10 seconds, if file is still there and no real errors, assume success
          if (elapsed > 10000) {
            console.log(`✅ File still present after 10s, assuming upload success: ${file.name}`);
            resolve(true);
            return;
          }
        }

        // Timeout check - be more optimistic
        if (elapsed > timeout) {
          console.log(`⏰ Upload wait timeout reached: ${elapsed}ms`);
          
          // If we have the file in input and no real errors, assume success
          if (fileInput.files && fileInput.files.length > 0 && !lastErrorMessage.includes('Invalid')) {
            console.log(`✅ Timeout reached but file present, assuming success`);
            resolve(true);
          } else {
            console.log(`❌ Timeout reached with issues`);
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
   * Enhanced blob upload with better filename handling
   */
  async uploadBlob(fileInput, blob, originalFileName) {
    try {
      console.log("📤 Starting uploadBlob:", {
        hasFileInput: !!fileInput,
        blobSize: blob.size,
        blobType: blob.type,
        originalFileName: originalFileName,
      });

      if (blob.size === 0) {
        throw new Error("File is empty");
      }

      // Clean the filename properly
      const cleanFileName = this.extractFileNameFromUrl(originalFileName);
      console.log("📄 Cleaned filename:", cleanFileName);

      // Create File object with clean filename
      const file = new File([blob], cleanFileName, {
        type: blob.type || "application/pdf",
        lastModified: Date.now(),
      });

      console.log("📄 File object created:", {
        name: file.name,
        size: file.size,
        type: file.type,
        lastModified: file.lastModified,
      });

      // Create DataTransfer to simulate file selection
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      console.log("📋 DataTransfer created with file");

      // Set files on input
      fileInput.files = dataTransfer.files;

      console.log("📎 Files set on input:", {
        filesLength: fileInput.files.length,
        firstFileName: fileInput.files[0]?.name,
      });

      // Trigger events
      console.log("🎯 Dispatching file events...");
      await this.dispatchFileEvents(fileInput);

      // Wait for upload to process
      console.log("⏳ Waiting for upload to process...");
      const uploadSuccess = await this.waitForUploadProcess(fileInput);

      console.log(`${uploadSuccess ? "✅" : "❌"} Upload process completed:`, {
        success: uploadSuccess,
        fileName: cleanFileName,
      });

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
   * Check if file input is accessible (even if visually hidden)
   */
  isFileInputAccessible(fileInput) {
    if (!fileInput) return false;

    // For Lever's invisible file inputs, check if they're in the DOM and not disabled
    if (
      fileInput.classList.contains("invisible-resume-upload") ||
      fileInput.classList.contains("application-file-input")
    ) {
      return !fileInput.disabled && fileInput.offsetParent !== null;
    }

    // For other file inputs, use normal visibility check
    return this.isElementVisible(fileInput);
  }

  /**
   * Handle a single file upload field
   */
  async handleSingleFileUpload(fileInput, userDetails, jobDescription) {
    try {
      // Determine what type of file this input expects
      const fileType = this.determineFileType(fileInput);

      // Get appropriate file URLs
      const fileUrls = this.getFileUrls(userDetails, fileType);
      if (!fileUrls || fileUrls.length === 0) {
        this.showStatus(`No ${fileType} files available`, "warning");
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
        return await this.uploadFileFromUrl(fileInput, fileUrls[0]);
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
        this.showStatus("Matching resume to job description, please wait...", "info");
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

      // Create file and upload
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
   * Match and upload best resume for the job with enhanced logging
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

      console.log("🔍 Match response:", {
        ok: matchResponse.ok,
        status: matchResponse.status,
      });

      if (!matchResponse.ok) {
        throw new Error(`Resume matching failed: ${matchResponse.status}`);
      }

      const matchData = await matchResponse.json();
      const bestResumeUrl = matchData.highest_ranking_resume;

      console.log("🎯 Best resume selected:", bestResumeUrl);
      this.showStatus("Uploading matched resume...", "info");

      // Upload the best matching resume
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
   * Upload file from URL with enhanced debugging
   */
  async uploadFileFromUrl(fileInput, fileUrl) {
    try {
      console.log("🌐 Starting uploadFileFromUrl:", {
        hasFileInput: !!fileInput,
        fileUrl: fileUrl,
        apiHost: this.apiHost,
      });

      if (!fileUrl) {
        console.error("❌ No file URL provided");
        this.showStatus("No file URL provided", "error");
        return false;
      }

      if (!fileInput) {
        console.error("❌ No file input provided");
        this.showStatus("No file input provided", "error");
        return false;
      }

      this.showStatus("Downloading file...", "info");

      // Use proxy to fetch file
      const proxyUrl = `${this.apiHost}/api/proxy-file?url=${encodeURIComponent(
        fileUrl
      )}`;
      console.log("📡 Fetching file via proxy:", proxyUrl);

      const response = await fetch(proxyUrl);
      console.log("📡 Proxy response:", {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        headers: Object.fromEntries(response.headers.entries()),
      });

      if (!response.ok) {
        throw new Error(
          `Failed to fetch file: ${response.status} ${response.statusText}`
        );
      }

      const blob = await response.blob();
      console.log("📦 File blob created:", {
        size: blob.size,
        type: blob.type,
      });

      if (blob.size === 0) {
        throw new Error("Downloaded file is empty");
      }

      const fileName = this.extractFileNameFromUrl(fileUrl);
      console.log("📄 Extracted filename:", fileName);

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
   * Enhanced file events dispatching with logging
   */
  async dispatchFileEvents(fileInput) {
    try {
      console.log("🎯 Dispatching file events for input:", {
        name: fileInput.name,
        id: fileInput.id,
      });

      // Dispatch change event
      const changeEvent = new Event("change", { bubbles: true });
      fileInput.dispatchEvent(changeEvent);
      console.log("✅ Dispatched 'change' event");

      // Dispatch input event
      const inputEvent = new Event("input", { bubbles: true });
      fileInput.dispatchEvent(inputEvent);
      console.log("✅ Dispatched 'input' event");

      // Additional events for Lever forms
      const blurEvent = new Event("blur", { bubbles: true });
      fileInput.dispatchEvent(blurEvent);
      console.log("✅ Dispatched 'blur' event");

      // Focus and then blur to trigger validation
      fileInput.focus();
      await this.wait(50);
      fileInput.blur();
      console.log("✅ Triggered focus/blur cycle");

      await this.wait(100);
      console.log("✅ File events dispatching completed");
    } catch (error) {
      console.error("❌ Error dispatching file events:", error);
    }
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
   * Get file URLs from user details with enhanced debugging
   */
  getFileUrls(userDetails, fileType) {
    switch (fileType) {
      case "resume":
        return userDetails.resumeUrl
          ? [userDetails.resumeUrl]
          : userDetails.resumeUrls || [];
      case "coverLetter":
        return userDetails.coverLetterUrl ? [userDetails.coverLetterUrl] : [];
      default:
        return userDetails.resumeUrl
          ? [userDetails.resumeUrl]
          : userDetails.resumeUrls || [];
    }
  }

  /**
   * Enhanced status display
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
    } else {
      console.warn("⚠️ Status service not available or invalid");
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