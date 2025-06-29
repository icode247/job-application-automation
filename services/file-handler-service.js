// services/file-handler-service.js
export default class FileHandlerService {
  constructor(config) {
    this.apiHost = config.apiHost || "https://api.yourdomain.com";
  }

  async handleFileUpload(container, userDetails, jobDescription) {
    try {
      const fileInput = container.querySelector('input[type="file"]');
      if (!fileInput) {
        console.log("No file input found in container");
        return false;
      }

      // Determine file type needed
      const fileType = this.determineFileType(container);
      const fileUrl = this.getFileUrl(userDetails, fileType);

      if (!fileUrl) {
        console.log(`No ${fileType} file available for user`);
        return false;
      }

      // For tailored resumes/cover letters, generate them first
      if (fileType === "resume" && jobDescription) {
        return await this.handleTailoredResume(
          fileInput,
          userDetails,
          jobDescription
        );
      } else if (fileType === "coverLetter" && jobDescription) {
        return await this.handleTailoredCoverLetter(
          fileInput,
          userDetails,
          jobDescription
        );
      }

      // Handle regular file upload
      return await this.uploadFileFromUrl(fileInput, fileUrl);
    } catch (error) {
      console.error("Error handling file upload:", error);
      return false;
    }
  }

  determineFileType(container) {
    const containerText = container.textContent.toLowerCase();
    const containerHTML = container.innerHTML.toLowerCase();

    if (
      containerText.includes("cover letter") ||
      containerHTML.includes("cover")
    ) {
      return "coverLetter";
    } else if (
      containerText.includes("resume") ||
      containerText.includes("cv")
    ) {
      return "resume";
    }

    // Default to resume
    return "resume";
  }

  getFileUrl(userDetails, fileType) {
    switch (fileType) {
      case "resume":
        return userDetails.resumeUrl;
      case "coverLetter":
        return userDetails.coverLetterUrl;
      default:
        return userDetails.resumeUrl;
    }
  }

  async handleTailoredResume(fileInput, userDetails, jobDescription) {
    try {
      const response = await fetch(
        `${this.apiHost}/api/generate-tailored-resume`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userId: userDetails.id,
            jobDescription: jobDescription,
            userProfile: userDetails,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to generate tailored resume");
      }

      const data = await response.json();
      return await this.uploadFileFromUrl(fileInput, data.resumeUrl);
    } catch (error) {
      console.error("Error generating tailored resume:", error);
      // Fallback to regular resume
      return await this.uploadFileFromUrl(fileInput, userDetails.resumeUrl);
    }
  }

  async handleTailoredCoverLetter(fileInput, userDetails, jobDescription) {
    try {
      const response = await fetch(
        `${this.apiHost}/api/generate-tailored-cover-letter`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            userId: userDetails.id,
            jobDescription: jobDescription,
            userProfile: userDetails,
          }),
        }
      );

      if (!response.ok) {
        throw new Error("Failed to generate tailored cover letter");
      }

      const data = await response.json();
      return await this.uploadFileFromUrl(fileInput, data.coverLetterUrl);
    } catch (error) {
      console.error("Error generating tailored cover letter:", error);
      // Fallback to regular cover letter
      return await this.uploadFileFromUrl(
        fileInput,
        userDetails.coverLetterUrl
      );
    }
  }

  async uploadFileFromUrl(fileInput, fileUrl) {
    try {
      if (!fileUrl) {
        console.log("No file URL provided");
        return false;
      }

      // Fetch the file
      const response = await fetch(fileUrl);
      if (!response.ok) {
        throw new Error("Failed to fetch file");
      }

      const blob = await response.blob();
      const fileName = this.extractFileNameFromUrl(fileUrl);

      // Create File object
      const file = new File([blob], fileName, { type: blob.type });

      // Create DataTransfer to simulate file selection
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      // Set files on input
      fileInput.files = dataTransfer.files;

      // Trigger events
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));
      fileInput.dispatchEvent(new Event("input", { bubbles: true }));

      console.log(`Successfully uploaded file: ${fileName}`);
      return true;
    } catch (error) {
      console.error("Error uploading file from URL:", error);
      return false;
    }
  }

  extractFileNameFromUrl(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const fileName = pathname.split("/").pop();
      return fileName || "document.pdf";
    } catch (error) {
      return "document.pdf";
    }
  }

  async waitForUploadProcessing(container, timeout = 30000) {
    return new Promise((resolve) => {
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === "childList") {
            const successMessage = container.querySelector(
              ".artdeco-inline-feedback--success"
            );
            const errorMessage = container.querySelector(
              ".artdeco-inline-feedback--error"
            );

            if (successMessage) {
              observer.disconnect();
              resolve("success");
            } else if (errorMessage) {
              observer.disconnect();
              resolve("error");
            }
          }
        }
      });

      observer.observe(container, { childList: true, subtree: true });

      // Set timeout
      setTimeout(() => {
        observer.disconnect();
        resolve("timeout");
      }, timeout);
    });
  }
}
