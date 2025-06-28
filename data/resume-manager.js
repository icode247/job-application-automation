// data/resume-manager.js
export default class ResumeManager {
  constructor() {
    this.resumeData = null;
    this.resumeUrl = null;
    this.storageKey = "userResumeData";
  }

  async initialize() {
    await this.loadResumeData();
    console.log("📄 Resume manager initialized");
  }

  async loadResumeData() {
    try {
      const result = await chrome.storage.local.get(this.storageKey);
      if (result[this.storageKey]) {
        this.resumeData = result[this.storageKey];
      }
    } catch (error) {
      console.error("Error loading resume data:", error);
    }
  }

  async saveResumeData(data) {
    try {
      this.resumeData = data;
      await chrome.storage.local.set({
        [this.storageKey]: data,
      });
    } catch (error) {
      console.error("Error saving resume data:", error);
    }
  }

  async setResumeUrl(url) {
    this.resumeUrl = url;
    if (this.resumeData) {
      this.resumeData.url = url;
      await this.saveResumeData(this.resumeData);
    }
  }

  async uploadResume(fileInput) {
    return new Promise((resolve, reject) => {
      const file = fileInput.files[0];
      if (!file) {
        reject(new Error("No file selected"));
        return;
      }

      // Validate file type
      const allowedTypes = [
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ];

      if (!allowedTypes.includes(file.type)) {
        reject(
          new Error("Invalid file type. Please use PDF or Word documents.")
        );
        return;
      }

      // Validate file size (max 5MB)
      if (file.size > 5 * 1024 * 1024) {
        reject(new Error("File too large. Maximum size is 5MB."));
        return;
      }

      // Create file URL for temporary use
      const fileUrl = URL.createObjectURL(file);

      const resumeData = {
        name: file.name,
        size: file.size,
        type: file.type,
        url: fileUrl,
        uploadedAt: Date.now(),
      };

      this.saveResumeData(resumeData)
        .then(() => {
          resolve(resumeData);
        })
        .catch(reject);
    });
  }

  async handleResumeUpload(platform, fileSelector) {
    try {
      const fileInput = document.querySelector(fileSelector);

      if (!fileInput) {
        throw new Error("Resume upload field not found");
      }

      if (!this.resumeUrl && !this.resumeData?.url) {
        throw new Error("No resume file available");
      }

      // Platform-specific upload handling
      switch (platform) {
        case "linkedin":
          return await this.handleLinkedInResumeUpload(fileInput);
        case "indeed":
          return await this.handleIndeedResumeUpload(fileInput);
        case "workday":
          return await this.handleWorkdayResumeUpload(fileInput);
        default:
          return await this.handleGenericResumeUpload(fileInput);
      }
    } catch (error) {
      console.error("Resume upload error:", error);
      return false;
    }
  }

  async handleLinkedInResumeUpload(fileInput) {
    // LinkedIn typically handles resume from profile
    // Check if resume is already attached
    const existingResume = document.querySelector(".resume-file-name");
    if (existingResume) {
      console.log("Resume already attached from LinkedIn profile");
      return true;
    }

    return await this.handleGenericResumeUpload(fileInput);
  }

  async handleIndeedResumeUpload(fileInput) {
    // Indeed often has a "upload resume" button
    const uploadButton = document.querySelector(
      'button[data-testid="resume-upload"]'
    );
    if (uploadButton) {
      uploadButton.click();
      await this.delay(1000);
    }

    return await this.handleGenericResumeUpload(fileInput);
  }

  async handleWorkdayResumeUpload(fileInput) {
    // Workday typically has drag-and-drop or browse functionality
    const browseButton = document.querySelector(
      '[data-automation-id*="file-upload-browse"]'
    );
    if (browseButton) {
      browseButton.click();
      await this.delay(1000);
    }

    return await this.handleGenericResumeUpload(fileInput);
  }

  async handleGenericResumeUpload(fileInput) {
    // Note: Direct file upload via content script is limited
    // This is a placeholder for the upload logic

    console.log(
      "Resume upload initiated (requires user interaction for security)"
    );

    // Highlight the upload field for user attention
    fileInput.style.border = "3px solid #FF9800";
    fileInput.style.boxShadow = "0 0 10px #FF9800";

    // Create a temporary tooltip
    const tooltip = document.createElement("div");
    tooltip.style.cssText = `
      position: absolute;
      background: #FF9800;
      color: white;
      padding: 8px 12px;
      border-radius: 4px;
      font-size: 12px;
      z-index: 10000;
      pointer-events: none;
    `;
    tooltip.textContent = "Please upload your resume here";

    const rect = fileInput.getBoundingClientRect();
    tooltip.style.top = rect.top - 40 + "px";
    tooltip.style.left = rect.left + "px";

    document.body.appendChild(tooltip);

    // Remove tooltip after 5 seconds
    setTimeout(() => {
      tooltip.remove();
      fileInput.style.border = "";
      fileInput.style.boxShadow = "";
    }, 5000);

    return true; // Assume success for now
  }

  getResumeData() {
    return this.resumeData;
  }

  getResumeUrl() {
    return this.resumeUrl || this.resumeData?.url;
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
