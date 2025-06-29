// platforms/base-platform.js
export default class BasePlatform {
  constructor(config) {
    this.sessionId = config.sessionId;
    this.platform = config.platform;
    this.contentScript = config.contentScript;
    this.config = config.config || {};

    // State
    this.isRunning = false;
    this.isPaused = false;
    this.currentJob = null;
    this.progress = {
      total: this.config.jobsToApply || 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      current: null,
    };

    // Callbacks
    this.onProgress = null;
    this.onError = null;
    this.onComplete = null;
    this.onApplicationSubmitted = null;
    this.onDOMChange = null;
    this.onNavigation = null;
  }

  // Abstract methods - must be implemented by platform-specific classes
  async initialize() {
    this.log("🚀 Initializing platform automation");
  }

  async start(params = {}) {
    throw new Error("start() method must be implemented by platform class");
  }

  async findJobs() {
    throw new Error("findJobs() method must be implemented by platform class");
  }

  async applyToJob(jobElement) {
    throw new Error(
      "applyToJob() method must be implemented by platform class"
    );
  }

  // Common utility methods
  async pause() {
    this.isPaused = true;
    this.isRunning = false;
    this.log("⏸️ Automation paused");
  }

  async resume() {
    this.isPaused = false;
    this.isRunning = true;
    this.log("▶️ Automation resumed");
  }

  async stop() {
    this.isRunning = false;
    this.isPaused = false;
    this.log("⏹️ Automation stopped");
  }

  // Progress reporting
  updateProgress(updates) {
    this.progress = { ...this.progress, ...updates };

    if (this.onProgress) {
      this.onProgress(this.progress);
    }

    // Notify content script
    this.notifyContentScript("progress", this.progress);
  }

  reportError(error, context = {}) {
    const errorInfo = {
      message: error.message || error,
      context,
      timestamp: Date.now(),
      sessionId: this.sessionId,
      platform: this.platform,
    };

    this.log(`❌ Error: ${errorInfo.message}`, errorInfo);

    if (this.onError) {
      this.onError(errorInfo);
    }

    // Notify content script
    this.notifyContentScript("error", errorInfo);
  }

  reportComplete() {
    this.isRunning = false;
    this.log("✅ Automation completed");

    if (this.onComplete) {
      this.onComplete();
    }

    // Notify content script
    this.notifyContentScript("complete", {
      sessionId: this.sessionId,
      progress: this.progress,
    });
  }

  reportApplicationSubmitted(jobData, applicationData) {
    this.progress.completed++;
    this.updateProgress({
      completed: this.progress.completed,
      current: null,
    });

    this.log(
      `📝 Application submitted: ${jobData.title} at ${jobData.company}`
    );

    if (this.onApplicationSubmitted) {
      this.onApplicationSubmitted(jobData, applicationData);
    }

    // Notify content script
    this.notifyContentScript("applicationSubmitted", {
      jobData,
      applicationData,
      sessionId: this.sessionId,
    });
  }

  // DOM utility methods (work directly in content script context)
  async waitForElement(selector, timeout = 10000) {
    return new Promise((resolve) => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      const observer = new MutationObserver((mutations, obs) => {
        const element = document.querySelector(selector);
        if (element) {
          obs.disconnect();
          resolve(element);
        }
      });

      observer.observe(document, {
        childList: true,
        subtree: true,
      });

      // Timeout
      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  async clickElement(selector) {
    const element = document.querySelector(selector);
    if (element) {
      element.scrollIntoView({ behavior: "smooth", block: "center" });
      await this.delay(500); // Wait for scroll
      element.click();
      return true;
    }
    return false;
  }

  async fillInput(selector, value) {
    const element = document.querySelector(selector);
    if (element) {
      element.focus();
      element.value = value;
      element.dispatchEvent(new Event("input", { bubbles: true }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
    return false;
  }

  async delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // Navigation methods (work directly in content script)
  async navigateToUrl(url) {
    try {
      window.location.href = url;
      return true;
    } catch (error) {
      this.reportError(error, { action: "navigateToUrl", url });
      return false;
    }
  }

  async waitForPageLoad(timeout = 30000) {
    return new Promise((resolve) => {
      if (document.readyState === "complete") {
        resolve(true);
        return;
      }

      const checkComplete = () => {
        if (document.readyState === "complete") {
          resolve(true);
        } else {
          setTimeout(checkComplete, 100);
        }
      };

      checkComplete();
      setTimeout(() => resolve(false), timeout);
    });
  }

  // Element finding and interaction
  findElements(selector) {
    return Array.from(document.querySelectorAll(selector));
  }

  findElement(selector) {
    return document.querySelector(selector);
  }

  isElementVisible(element) {
    if (!element) return false;

    const rect = element.getBoundingClientRect();
    return (
      rect.width > 0 &&
      rect.height > 0 &&
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= window.innerHeight &&
      rect.right <= window.innerWidth
    );
  }

  scrollToElement(element, options = {}) {
    if (!element) return false;

    const defaultOptions = {
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    };

    element.scrollIntoView({ ...defaultOptions, ...options });
    return true;
  }

  // Communication with content script and background
  async notifyContentScript(type, data) {
    if (this.contentScript && this.contentScript.sendMessageToBackground) {
      try {
        await this.contentScript.sendMessageToBackground({
          action: "platformNotification",
          type,
          data,
          sessionId: this.sessionId,
          platform: this.platform,
        });
      } catch (error) {
        console.error("Error notifying content script:", error);
      }
    }
  }

  // Utility methods
  log(message, data = {}) {
    const logEntry = `🤖 [${this.platform}-${this.sessionId?.slice(
      -6
    )}] ${message}`;
    console.log(logEntry, data);
  }

  shouldSkipJob(jobUrl) {
    const submittedLinks = this.config.submittedLinks || [];
    return submittedLinks.some(
      (link) => jobUrl.includes(link) || link.includes(jobUrl)
    );
  }

  extractJobData() {
    // Extract job information from current page
    const jobData = {
      title: this.extractText([
        "h1",
        ".job-title",
        '[data-testid="job-title"]',
      ]),
      company: this.extractText([
        ".company",
        ".company-name",
        '[data-testid="company-name"]',
      ]),
      location: this.extractText([
        ".location",
        ".job-location",
        '[data-testid="job-location"]',
      ]),
      description: this.extractText([".job-description", ".description"]),
      url: window.location.href,
      platform: this.platform,
      extractedAt: Date.now(),
    };

    return jobData;
  }

  extractText(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element.textContent?.trim() || "";
      }
    }
    return "";
  }

  getRandomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  cleanup() {
    this.isRunning = false;
    this.isPaused = false;
    this.log("🧹 Platform cleanup completed");
  }
}
