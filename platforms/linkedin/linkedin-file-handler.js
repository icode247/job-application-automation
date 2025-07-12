// platforms/linkedin/linkedin-file-handler.js
import { AI_BASE_URL, API_HOST_URL } from "../../services/constants.js";

export default class LinkedInFileHandler {
  constructor(config) {
    this.AI_BASE_URL = AI_BASE_URL;
    this.API_HOST_URL = API_HOST_URL;
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
      let fileUrls = this.getFileUrls(userDetails, fileType);

      if (Array.isArray(fileUrls) && Array.isArray(fileUrls[0])) {
        fileUrls = fileUrls[0];
      }

      if (!fileUrls || fileUrls.length === 0) {
        console.log(`No ${fileType} file available for user`);
        return false;
      }

      // Handle resume uploads with tailored generation
      if (fileType === "resume" && jobDescription) {
        return await this.uploadFileFromURL(
          fileInput,
          fileUrls,
          userDetails,
          jobDescription
        );
      }

      // Handle cover letter uploads
      if (fileType === "coverLetter" && jobDescription) {
        return await this.handleTailoredCoverLetter(
          fileInput,
          userDetails,
          jobDescription
        );
      }

      // Fallback to simple file upload
      return await this.uploadFileFromUrl(fileInput, fileUrls[0]);
    } catch (error) {
      console.error("Error handling file upload:", error);
      return false;
    }
  }

  async uploadFileFromURL(fileInput, fileUrls, userDetails, jobDescription) {
    try {
      // Check if user has unlimited plan and prefers custom resume
      if (
        userDetails.plan === "unlimited" &&
        userDetails.jobPreferences &&
        userDetails.jobPreferences.useCustomResume === true
      ) {
        // Show status and start loader
        if (this.statusManager) {
          this.statusManager.show(
            "Generating resume, Please wait while we generate your resume",
            "info"
          );
        }

        // 3-step resume generation process
        const [parseURL, optimizeURL, generateURL] = [
          `${this.AI_BASE_URL}/parse-resume`,
          `${this.AI_BASE_URL}/optimize-resume`,
          `${this.AI_BASE_URL}/generate-resume-pdf`,
        ];

        // Step 1: Parse Resume from URL
        const parseResponse = await fetch(parseURL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ file_url: fileUrls[fileUrls.length - 1] }),
        });

        if (!parseResponse.ok) {
          throw new Error(`Parse Resume Failed: ${parseResponse.status}`);
        }

        const { text: parsedResumeText } = await parseResponse.json();

        // Step 2: Optimize Resume
        const optimizeResponse = await fetch(optimizeURL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            resume_text: parsedResumeText,
            job_description: jobDescription || "",
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
        });

        if (!optimizeResponse.ok) {
          throw new Error(`Optimize Resume Failed: ${optimizeResponse.status}`);
        }

        const resumeData = await optimizeResponse.json();

        // Step 3: Generate Resume PDF
        const generateResponse = await fetch(generateURL, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            user_data: {
              author: userDetails.name,
              email: userDetails.email,
              phone: `${userDetails.phoneCountryCode || ""}${
                userDetails.phoneNumber || ""
              }`,
              address: userDetails.streetAddress || userDetails.country,
            },
            resume_data: resumeData.data,
          }),
        });

        if (!generateResponse.ok) {
          if (this.statusManager) {
            this.statusManager.show(
              "Failed to generate resume, Please try again later",
              "error"
            );
          }
          throw new Error(`Generate Resume Failed: ${generateResponse.status}`);
        }

        // The response is already the PDF content, not JSON
        const blob = await generateResponse.blob();
        const fileName = `${userDetails.name.toLowerCase()} resume.pdf`;

        const file = new File([blob], fileName, {
          type: "application/pdf",
          lastModified: Date.now(),
        });

        if (file.size === 0) {
          throw new Error("Generated PDF file is empty");
        }

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;

        if (this.statusManager) {
          this.statusManager.show("Resume generated successfully", "success");
        }
      } else {
        // Use existing matching service for non-unlimited plans
        if (this.statusManager) {
          this.statusManager.show(
            "Matching your resume to the job description, Please wait",
            "info"
          );
        }

        const matchedUrl = `${this.AI_BASE_URL}/match`;
        const res = await fetch(matchedUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            resume_urls: fileUrls,
            job_description: jobDescription,
          }),
        });

        if (!res.ok) {
          throw new Error(`Resume matching service failed: ${res.status}`);
        }

        if (this.statusManager) {
          this.statusManager.show(
            "Uploading your resume, Please wait while we upload your resume",
            "info"
          );
        }

        const data = await res.json();
        const proxyURL = `${
          this.API_HOST_URL
        }/api/proxy-file?url=${encodeURIComponent(
          data.highest_ranking_resume
        )}`;

        const response = await fetch(proxyURL);
        if (!response.ok) {
          throw new Error(`Failed to fetch file: ${response.statusText}`);
        }

        const blob = await response.blob();
        let filename = `${userDetails.firstName || ""} ${
          userDetails.lastName || ""
        } resume.pdf`;

        // Get filename from Content-Disposition header
        const contentDisposition = response.headers.get("content-disposition");
        if (contentDisposition) {
          const matches = /filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/.exec(
            contentDisposition
          );
          if (matches?.[1]) {
            filename = matches[1].replace(/['"]/g, "");
          }
        }

        // Create file object
        const file = new File([blob], filename, {
          type: blob.type || "application/pdf",
          lastModified: Date.now(),
        });

        if (file.size === 0) {
          throw new Error("Created file is empty");
        }

        const dataTransfer = new DataTransfer();
        dataTransfer.items.add(file);
        fileInput.files = dataTransfer.files;
      }

      // Common code for both paths - dispatch events and wait for upload
      await this.dispatchFileEvents(fileInput);
      await this.waitForUploadProcess(fileInput);
      return true;
    } catch (error) {
      console.error("Upload failed:", error.message);
      try {
        fileInput.value = "";
      } catch (e) {
        console.error("Could not clear file input:", e);
      }
      return false;
    }
  }

  async dispatchFileEvents(fileInput) {
    // Trigger events to notify the page that a file has been selected
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    fileInput.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async waitForUploadProcess(fileInput, timeout = 30000) {
    // Wait for the upload to complete or fail
    return new Promise((resolve) => {
      const startTime = Date.now();

      const checkUpload = () => {
        // Check for success or error indicators
        const container = fileInput.closest("form") || fileInput.parentElement;
        const successElement = container?.querySelector(
          ".artdeco-inline-feedback--success"
        );
        const errorElement = container?.querySelector(
          ".artdeco-inline-feedback--error"
        );

        if (successElement) {
          resolve(true);
        } else if (errorElement) {
          resolve(false);
        } else if (Date.now() - startTime > timeout) {
          resolve(true); // Assume success after timeout
        } else {
          setTimeout(checkUpload, 500);
        }
      };

      checkUpload();
    });
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

  async handleTailoredCoverLetter(fileInput, userDetails, jobDescription) {
    try {
      // Show status message
      if (this.statusManager) {
        this.statusManager.show(
          "Generating cover letter, Please wait while we create your personalized cover letter",
          "info"
        );
      }

      // Generate the cover letter PDF
      const response = await fetch(
        `${this.AI_BASE_URL}/generate-cover-letter-pdf`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fullName: userDetails.firstName,
            skills: userDetails.skills,
            education: userDetails.education,
            jobDescription: jobDescription,
            tone: "Professional",
            fullPositions: userDetails.fullPositions,
          }),
        }
      );

      if (!response.ok) {
        throw new Error(
          `Failed to generate tailored cover letter: ${response.status}`
        );
      }

      // The response is the PDF blob directly
      const blob = await response.blob();
      const fileName = `${userDetails.firstName.toLowerCase()}_cover_letter.pdf`;

      // Create File object from the generated PDF
      const file = new File([blob], fileName, {
        type: "application/pdf",
        lastModified: Date.now(),
      });

      if (file.size === 0) {
        throw new Error("Generated cover letter PDF is empty");
      }

      // Create DataTransfer to simulate file selection
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);

      // Set files on input
      fileInput.files = dataTransfer.files;

      // Trigger events to notify the page that a file has been selected
      await this.dispatchFileEvents(fileInput);

      // Wait for upload to complete
      await this.waitForUploadProcess(fileInput);

      if (this.statusManager) {
        this.statusManager.show(
          "Cover letter generated and uploaded successfully",
          "success"
        );
      }

      console.log(
        `Successfully generated and uploaded cover letter: ${fileName}`
      );
      return true;
    } catch (error) {
      console.error("Error generating tailored cover letter:", error);

      if (this.statusManager) {
        this.statusManager.show(
          "Failed to generate cover letter, using fallback",
          "warning"
        );
      }

      // Fallback to regular cover letter if available
      const coverLetterUrls = this.getFileUrls(userDetails, "coverLetter");
      if (coverLetterUrls.length > 0) {
        return await this.uploadFileFromUrl(fileInput, coverLetterUrls[0]);
      }

      if (this.statusManager) {
        this.statusManager.show("No cover letter available", "error");
      }

      return false;
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
      await this.dispatchFileEvents(fileInput);

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

  // Set status manager for progress updates
  setStatusManager(statusManager) {
    this.statusManager = statusManager;
  }
}
