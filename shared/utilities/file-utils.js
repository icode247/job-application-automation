// shared/utilities/file-utils.js
export class FileUtils {
  /**
   * Extract clean filename from URL
   */
  static extractFileNameFromUrl(url) {
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
          .replace(/%[0-9A-F]{2}/gi, "") // Remove any remaining URL encoding
          .replace(/[^\w\s.-]/gi, "") // Remove invalid filename characters
          .replace(/\s+/g, "_") // Replace spaces with underscores
          .trim();

        // Ensure it has a valid extension
        if (!fileName.match(/\.(pdf|doc|docx)$/i)) {
          fileName += ".pdf";
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
   * Create File object from blob with clean filename
   */
  static createFileFromBlob(
    blob,
    originalFileName,
    defaultType = "application/pdf"
  ) {
    const cleanFileName = this.extractFileNameFromUrl(originalFileName);

    return new File([blob], cleanFileName, {
      type: blob.type || defaultType,
      lastModified: Date.now(),
    });
  }

  /**
   * Dispatch file events on input element
   */
  static async dispatchFileEvents(fileInput) {
    try {
      console.log("🎯 Dispatching file events for input:", {
        name: fileInput.name,
        id: fileInput.id,
      });

      // Dispatch change event
      fileInput.dispatchEvent(new Event("change", { bubbles: true }));

      // Dispatch input event
      fileInput.dispatchEvent(new Event("input", { bubbles: true }));

      // Additional events for better compatibility
      fileInput.dispatchEvent(new Event("blur", { bubbles: true }));

      // Focus and then blur to trigger validation
      fileInput.focus();
      await this.wait(50);
      fileInput.blur();

      await this.wait(100);
      console.log("✅ File events dispatching completed");
    } catch (error) {
      console.error("❌ Error dispatching file events:", error);
    }
  }

  /**
   * Set files on input using DataTransfer
   */
  static setFilesOnInput(fileInput, files) {
    try {
      const dataTransfer = new DataTransfer();

      // Add files to DataTransfer
      if (Array.isArray(files)) {
        files.forEach((file) => dataTransfer.items.add(file));
      } else {
        dataTransfer.items.add(files);
      }

      // Set files on input
      fileInput.files = dataTransfer.files;

      console.log("📎 Files set on input:", {
        filesLength: fileInput.files.length,
        firstFileName: fileInput.files[0]?.name,
      });

      return true;
    } catch (error) {
      console.error("❌ Error setting files on input:", error);
      return false;
    }
  }

  /**
   * Utility wait function
   */
  static wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
