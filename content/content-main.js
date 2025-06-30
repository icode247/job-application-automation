// content/content-main.js
class ContentScriptManager {
  constructor() {
    this.isInitialized = false;
    this.automationActive = false;
    this.sessionId = null;
    this.platform = null;
    this.userId = null; // Add userId tracking
    this.platformAutomation = null;
    this.domObserver = null;
    this.indicator = null;
    this.config = {};
    this.initializationTimeout = null;
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      // Check if this is an automation window
      const isAutomationWindow = await this.checkIfAutomationWindow();

      if (isAutomationWindow) {
        this.automationActive = true;
        this.sessionId = this.getSessionId();
        this.platform = this.getPlatform();
        this.userId = this.getUserId(); // Get userId

        if (this.platform && this.platform !== "unknown") {
          await this.setupAutomation();
          this.isInitialized = true;

          console.log(`🤖 Content script initialized for ${this.platform}`, {
            sessionId: this.sessionId,
            userId: this.userId,
            url: window.location.href,
          });

          // Notify background that content script is ready
          this.notifyBackgroundReady();

          // Set a timeout to auto-start if no message received
          this.setAutoStartTimeout();
        }
      }
    } catch (error) {
      console.error("❌ Error initializing content script:", error);
    }
  }

  async checkIfAutomationWindow() {
    // Method 1: Check window flags set by background script
    if (window.isAutomationWindow && window.automationSessionId) {
      return true;
    }

    // Method 2: Check sessionStorage
    const sessionId = sessionStorage.getItem("automationSessionId");
    const platform = sessionStorage.getItem("automationPlatform");
    const userId = sessionStorage.getItem("automationUserId");

    if (sessionId && platform) {
      window.automationSessionId = sessionId;
      window.automationPlatform = platform;
      window.automationUserId = userId;
      window.isAutomationWindow = true;
      return true;
    }

    // Method 3: Ask background script
    try {
      const response = await this.sendMessageToBackground({
        action: "checkIfAutomationWindow",
      });

      if (response && response.isAutomationWindow) {
        window.isAutomationWindow = true;
        return true;
      }
    } catch (error) {
      console.error("Error checking automation window status:", error);
    }

    return false;
  }

  getSessionId() {
    return (
      window.automationSessionId ||
      sessionStorage.getItem("automationSessionId") ||
      null
    );
  }

  getPlatform() {
    return (
      window.automationPlatform ||
      sessionStorage.getItem("automationPlatform") ||
      this.detectPlatformFromUrl()
    );
  }

  getUserId() {
    return (
      window.automationUserId ||
      sessionStorage.getItem("automationUserId") ||
      null
    );
  }

  detectPlatformFromUrl() {
    const url = window.location.href.toLowerCase();

    if (url.includes("linkedin.com")) return "linkedin";
    if (url.includes("indeed.com")) return "indeed";
    if (url.includes("recruitee.com")) return "recruitee";
    if (url.includes("glassdoor.com")) return "glassdoor";
    if (url.includes("myworkdayjobs.com")) return "workday";
    if (url.includes("lever.co")) return "lever";
    if (url.includes("greenhouse.io")) return "greenhouse";

    // Handle Google search for specific platforms
    if (url.includes("google.com/search")) {
      if (url.includes("site:recruitee.com") || url.includes("recruitee.com"))
        return "recruitee";
      if (
        url.includes("site:myworkdayjobs.com") ||
        url.includes("myworkdayjobs.com")
      )
        return "workday";
      if (url.includes("site:lever.co") || url.includes("lever.co"))
        return "lever";
    }

    return "unknown";
  }

  async setupAutomation() {
    try {
      // Load platform-specific automation module
      const PlatformClass = await this.loadPlatformModule(this.platform);
      console.log("PlatformClass", PlatformClass);

      if (!PlatformClass) {
        throw new Error(`Platform ${this.platform} not supported`);
      }

      // Create platform automation instance with userId
      this.platformAutomation = new PlatformClass({
        sessionId: this.sessionId,
        platform: this.platform,
        userId: this.userId, // Pass userId to platform
        contentScript: this,
        config: this.config,
      });

      // Set up automation UI
      this.addAutomationIndicator();
      this.setupMessageListeners();
      this.setupDOMObserver();
      this.setupNavigationListeners();

      // Initialize platform automation
      await this.platformAutomation.initialize();
      await this.platformAutomation.start(this.config);
    } catch (error) {
      console.error(
        `❌ Failed to setup automation for ${this.platform}:`,
        error
      );
      this.notifyBackgroundError(error);
    }
  }

  async loadPlatformModule(platform) {
    try {
      switch (platform) {
        case "linkedin":
          const { default: LinkedInPlatform } = await import(
            "../platforms/linkedin/linkedin.js"
          );
          return LinkedInPlatform;

        case "indeed":
          const { default: IndeedPlatform } = await import(
            "../platforms/indeed/indeed.js"
          );
          return IndeedPlatform;

        case "recruitee":
          const { default: RecruiteePlatform } = await import(
            "../platforms/recruitee/recruitee.js"
          );
          return RecruiteePlatform;

        case "glassdoor":
          const { default: GlassdoorPlatform } = await import(
            "../platforms/glassdoor/glassdoor.js"
          );
          return GlassdoorPlatform;

        case "workday":
          const { default: WorkdayPlatform } = await import(
            "../platforms/workday/workday.js"
          );
          return WorkdayPlatform;

        case "lever":
          const { default: LeverPlatform } = await import(
            "../platforms/lever/lever.js"
          );
          return LeverPlatform;

        default:
          console.warn(`Platform ${platform} not supported`);
          return null;
      }
    } catch (error) {
      console.error(`Failed to load platform module for ${platform}:`, error);
      return null;
    }
  }

  setupMessageListeners() {
    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true; // Keep message channel open for async responses
    });
  }

  async handleMessage(request, sender, sendResponse) {
    try {
      switch (request.action) {
        case "startAutomation":
          await this.handleStartAutomation(request, sendResponse);
          break;

        case "pauseAutomation":
          await this.handlePauseAutomation(request, sendResponse);
          break;

        case "resumeAutomation":
          await this.handleResumeAutomation(request, sendResponse);
          break;

        case "stopAutomation":
          await this.handleStopAutomation(request, sendResponse);
          break;

        case "getPageData":
          this.handleGetPageData(sendResponse);
          break;

        case "executeAction":
          await this.handleExecuteAction(request, sendResponse);
          break;

        case "extractJobData":
          this.handleExtractJobData(sendResponse);
          break;

        default:
          sendResponse({ success: false, error: "Unknown action" });
      }
    } catch (error) {
      console.error("Error handling message:", error);
      sendResponse({ success: false, error: error.message });
    }
  }

  async handleStartAutomation(request, sendResponse) {
    try {
      if (this.platformAutomation) {
        // Clear any existing timeout
        if (this.initializationTimeout) {
          clearTimeout(this.initializationTimeout);
          this.initializationTimeout = null;
        }

        // Update config and start automation
        this.config = { ...this.config, ...request.config };
        this.log(
          `🤖 Starting automation for ${this.platform} with config:`,
          this.config
        );
        this.log("🚀 Starting platform automation in content script");
        await this.platformAutomation.start(this.config);

        sendResponse({
          success: true,
          message: "Automation started in content script",
        });
      } else {
        sendResponse({
          success: false,
          error: "Platform automation not initialized",
        });
      }
    } catch (error) {
      this.log(`❌ Error starting automation: ${error.message}`);
      sendResponse({ success: false, error: error.message });
    }
  }

  setAutoStartTimeout() {
    // Auto-start after 10 seconds if no start message received
    this.initializationTimeout = setTimeout(async () => {
      if (this.platformAutomation && !this.platformAutomation.isRunning) {
        this.log("🔄 Auto-starting automation with basic config");
        try {
          await this.platformAutomation.start({
            jobsToApply: 10, // Default value
            submittedLinks: [],
            preferences: {},
            userId: this.userId, // Include userId
          });
        } catch (error) {
          this.log(`❌ Auto-start failed: ${error.message}`);
        }
      }
    }, 10000);
  }

  addAutomationIndicator() {
    // Remove existing indicator
    const existing = document.getElementById("automation-indicator");
    if (existing) existing.remove();

    const indicator = document.createElement("div");
    indicator.id = "automation-indicator";
    indicator.innerHTML = `
      <div style="
        position: fixed;
        top: 10px;
        right: 10px;
        background: linear-gradient(135deg, #4CAF50, #45a049);
        color: white;
        padding: 12px 16px;
        border-radius: 8px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
        font-size: 13px;
        font-weight: 600;
        z-index: 999999;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        border: 1px solid rgba(255,255,255,0.2);
        backdrop-filter: blur(10px);
        cursor: pointer;
        transition: all 0.3s ease;
      " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 16px;">🤖</span>
          <div>
            <div style="font-weight: 700;">AUTOMATION ACTIVE</div>
            <div style="font-size: 11px; opacity: 0.9;">${this.platform?.toUpperCase()} • ${this.sessionId?.slice(
      -6
    )}</div>
          </div>
        </div>
      </div>
    `;

    // Add click handler to show status
    indicator.addEventListener("click", () => {
      this.showAutomationStatus();
    });

    document.documentElement.appendChild(indicator);
    this.indicator = indicator;
  }

  notifyBackgroundReady() {
    this.sendMessageToBackground({
      action: "contentScriptReady",
      sessionId: this.sessionId,
      platform: this.platform,
      userId: this.userId, // Include userId
      url: window.location.href,
    }).catch(console.error);
  }

  // Rest of the methods remain the same...
  async handlePauseAutomation(request, sendResponse) {
    if (this.platformAutomation && this.platformAutomation.pause) {
      await this.platformAutomation.pause();
      sendResponse({ success: true, message: "Automation paused" });
    } else {
      sendResponse({ success: false, error: "Cannot pause automation" });
    }
  }

  async handleResumeAutomation(request, sendResponse) {
    if (this.platformAutomation && this.platformAutomation.resume) {
      await this.platformAutomation.resume();
      sendResponse({ success: true, message: "Automation resumed" });
    } else {
      sendResponse({ success: false, error: "Cannot resume automation" });
    }
  }

  async handleStopAutomation(request, sendResponse) {
    if (this.platformAutomation && this.platformAutomation.stop) {
      await this.platformAutomation.stop();
      sendResponse({ success: true, message: "Automation stopped" });
    } else {
      sendResponse({ success: false, error: "Cannot stop automation" });
    }
  }

  handleGetPageData(sendResponse) {
    const pageData = {
      url: window.location.href,
      title: document.title,
      platform: this.platform,
      sessionId: this.sessionId,
      userId: this.userId,
      readyState: document.readyState,
      timestamp: Date.now(),
    };

    sendResponse({ success: true, data: pageData });
  }

  async handleExecuteAction(request, sendResponse) {
    const { actionType, selector, value, options = {} } = request;

    try {
      let result = false;

      switch (actionType) {
        case "click":
          result = await this.clickElement(selector, options);
          break;

        case "fill":
          result = await this.fillElement(selector, value, options);
          break;

        case "wait":
          result = await this.waitForElement(
            selector,
            options.timeout || 10000
          );
          break;

        case "scroll":
          result = await this.scrollToElement(selector, options);
          break;

        default:
          throw new Error(`Unknown action type: ${actionType}`);
      }

      sendResponse({ success: true, result });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  }

  handleExtractJobData(sendResponse) {
    try {
      const jobData = this.extractCurrentJobData();
      sendResponse({ success: true, data: jobData });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  }

  setupDOMObserver() {
    // Set up MutationObserver to detect significant DOM changes
    this.domObserver = new MutationObserver((mutations) => {
      this.handleDOMChanges(mutations);
    });

    this.domObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
    });
  }

  handleDOMChanges(mutations) {
    let significantChange = false;

    for (const mutation of mutations) {
      if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
        // Check if new content suggests page change or important updates
        const addedElements = Array.from(mutation.addedNodes).filter(
          (node) => node.nodeType === 1
        );

        if (addedElements.some((el) => this.isSignificantElement(el))) {
          significantChange = true;
          break;
        }
      }
    }

    if (significantChange) {
      this.notifyDOMChange();

      // Notify platform automation of DOM changes
      if (this.platformAutomation && this.platformAutomation.onDOMChange) {
        this.platformAutomation.onDOMChange();
      }
    }
  }

  isSignificantElement(element) {
    const significantSelectors = [
      "form",
      ".job",
      ".application",
      ".modal",
      ".dialog",
      '[class*="job"]',
      '[class*="apply"]',
      '[class*="form"]',
    ];

    return significantSelectors.some((selector) => {
      try {
        return (
          element.matches &&
          (element.matches(selector) || element.querySelector(selector))
        );
      } catch (e) {
        return false;
      }
    });
  }

  setupNavigationListeners() {
    // Listen for URL changes (for SPAs)
    let currentUrl = window.location.href;

    const checkUrlChange = () => {
      if (window.location.href !== currentUrl) {
        const oldUrl = currentUrl;
        currentUrl = window.location.href;

        console.log(`🔄 Navigation detected: ${oldUrl} → ${currentUrl}`);
        this.notifyNavigation(oldUrl, currentUrl);

        // Notify platform automation of navigation
        if (this.platformAutomation && this.platformAutomation.onNavigation) {
          this.platformAutomation.onNavigation(oldUrl, currentUrl);
        }
      }
    };

    // Check for URL changes periodically
    setInterval(checkUrlChange, 1000);

    // Listen for popstate events
    window.addEventListener("popstate", checkUrlChange);

    // Override pushState and replaceState to catch programmatic navigation
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      setTimeout(checkUrlChange, 100);
    };

    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      setTimeout(checkUrlChange, 100);
    };
  }

  // Utility methods for DOM manipulation
  async clickElement(selector, options = {}) {
    const element = document.querySelector(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    // Scroll into view
    element.scrollIntoView({ behavior: "smooth", block: "center" });

    // Wait a bit for scroll
    await this.delay(options.delay || 500);

    // Click the element
    element.click();

    return true;
  }

  async fillElement(selector, value, options = {}) {
    const element = document.querySelector(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    // Focus and fill
    element.focus();
    element.value = value;

    // Trigger events
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));

    if (options.blur) {
      element.blur();
    }

    return true;
  }

  async scrollToElement(selector, options = {}) {
    const element = document.querySelector(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    const scrollOptions = {
      behavior: "smooth",
      block: "center",
      inline: "nearest",
      ...options,
    };

    element.scrollIntoView(scrollOptions);
    return true;
  }

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

      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  extractCurrentJobData() {
    // Extract job information from current page
    const jobData = {
      title: this.extractText([
        "h1",
        ".job-title",
        '[data-testid="job-title"]',
        ".jobsearch-JobInfoHeader-title",
      ]),
      company: this.extractText([
        ".company",
        ".company-name",
        '[data-testid="company-name"]',
        ".jobsearch-InlineCompanyRating",
      ]),
      location: this.extractText([
        ".location",
        ".job-location",
        '[data-testid="job-location"]',
        ".jobsearch-JobLocation",
      ]),
      description: this.extractText([
        ".job-description",
        ".description",
        '[data-testid="job-description"]',
      ]),
      url: window.location.href,
      platform: this.platform,
      userId: this.userId,
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

  // Communication methods
  async sendMessageToBackground(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  notifyBackgroundError(error) {
    this.sendMessageToBackground({
      action: "contentScriptError",
      sessionId: this.sessionId,
      platform: this.platform,
      userId: this.userId,
      error: error.message,
      url: window.location.href,
    }).catch(console.error);
  }

  notifyDOMChange() {
    this.sendMessageToBackground({
      action: "domChanged",
      sessionId: this.sessionId,
      url: window.location.href,
      timestamp: Date.now(),
    }).catch(console.error);
  }

  notifyNavigation(oldUrl, newUrl) {
    this.sendMessageToBackground({
      action: "navigationDetected",
      sessionId: this.sessionId,
      oldUrl,
      newUrl,
      timestamp: Date.now(),
    }).catch(console.error);
  }

  showAutomationStatus() {
    // Show modal with current automation status
    const modal = document.createElement("div");
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.5); z-index: 1000000; display: flex;
      align-items: center; justify-content: center;
    `;

    modal.innerHTML = `
      <div style="background: white; padding: 24px; border-radius: 12px; max-width: 400px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);">
        <h3 style="margin: 0 0 16px 0; color: #333;">Automation Status</h3>
        <p><strong>Platform:</strong> ${this.platform}</p>
        <p><strong>Session ID:</strong> ${this.sessionId}</p>
        <p><strong>User ID:</strong> ${this.userId}</p>
        <p><strong>Current URL:</strong> ${window.location.href}</p>
        <p><strong>Status:</strong> ${
          this.automationActive ? "Active" : "Inactive"
        }</p>
        <button onclick="this.closest('div').remove()" style="
          background: #4CAF50; color: white; border: none; padding: 8px 16px;
          border-radius: 4px; cursor: pointer; margin-top: 16px;
        ">Close</button>
      </div>
    `;

    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });

    document.body.appendChild(modal);
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  log(message, data = {}) {
    console.log(`🤖 [ContentScript-${this.platform}] ${message}`, data);
  }

  cleanup() {
    // Clear timeout
    if (this.initializationTimeout) {
      clearTimeout(this.initializationTimeout);
      this.initializationTimeout = null;
    }

    // Remove automation indicator
    if (this.indicator) {
      this.indicator.remove();
      this.indicator = null;
    }

    // Disconnect DOM observer
    if (this.domObserver) {
      this.domObserver.disconnect();
      this.domObserver = null;
    }

    // Stop platform automation
    if (this.platformAutomation && this.platformAutomation.cleanup) {
      this.platformAutomation.cleanup();
    }

    this.isInitialized = false;
    this.automationActive = false;
  }
}

// Initialize content script manager
const contentManager = new ContentScriptManager();
console.log("📝 Content script manager created");
// Initialize when DOM is ready
const initializeWhenReady = () => {
  console.log("📝 Initializing content script manager...");
  if (document.readyState === "complete") {
    contentManager.initialize();
    console.log("✅ Content script manager initialized");
  } else {
    setTimeout(initializeWhenReady, 100);
  }
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => {
    setTimeout(() => contentManager.initialize(), 1000);
  });
} else {
  setTimeout(() => contentManager.initialize(), 1000);
}

// Also initialize on page show (for back/forward navigation)
window.addEventListener("pageshow", () => {
  setTimeout(() => contentManager.initialize(), 1000);
});

// Cleanup on page unload
window.addEventListener("beforeunload", () => contentManager.cleanup());
