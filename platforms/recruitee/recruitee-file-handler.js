// platforms/recruitee/recruitee-file-handler.js
export class RecruiteeFileHandler {
  constructor(options = {}) {
    this.show =
      options.show || ((message, type) => console.log(`[${type}] ${message}`));
  }

  async handleResumeUpload(userProfile, form) {
    try {
      // Find file input for resume
      const fileInput = form.querySelector('input[type="file"]');
      if (!fileInput) {
        console.log("No file input found for resume upload");
        return false;
      }

      // Check if user has resume URL
      const resumeUrl =
        userProfile.resumeUrl ||
        (userProfile.resumeUrls && userProfile.resumeUrls[0]);
      if (!resumeUrl) {
        console.log("No resume URL found in user profile");
        return false;
      }

      this.show("Uploading resume...", "info");

      // Fetch the resume file
      const response = await fetch(resumeUrl);
      if (!response.ok) {
        throw new Error("Failed to fetch resume file");
      }

      const blob = await response.blob();
      const fileName = this.extractFileNameFromUrl(resumeUrl);

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

      this.show("Resume uploaded successfully", "success");
      return true;
    } catch (error) {
      this.show(`Error uploading resume: ${error.message}`, "error");
      return false;
    }
  }

  extractFileNameFromUrl(url) {
    try {
      const urlObj = new URL(url);
      const pathname = urlObj.pathname;
      const fileName = pathname.split("/").pop();
      return fileName || "resume.pdf";
    } catch (error) {
      return "resume.pdf";
    }
  }
}
