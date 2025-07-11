// shared/base/base-platform-automation.js - FIXED VERSION

import BasePlatform from "../../platforms/base-platform.js";
import { StatusOverlay } from "../../services/index.js";

export default class BasePlatformAutomation extends BasePlatform {
  constructor(config) {
    super(config);

    // Initialize user profile from multiple sources
    this.userProfile =
      config.userProfile || config.sessionContext?.userProfile || null;
    this.sessionContext = config.sessionContext || null;
    this.hasSessionContext = !!this.sessionContext;

    // Communication state
    this.port = null;
    this.connectionRetries = 0;
    this.maxRetries = 3;

    // Application state
    this.applicationState = {
      isApplicationInProgress: false,
      applicationStartTime: null,
      applicationUrl: null,
      processedUrls: new Set(),
      processedLinksCount: 0,
    };

    // Search data - platform implementations will override domains and patterns
    this.searchData = {
      limit: 0,
      current: 0,
      domain: this.getPlatformDomains(), // Abstract method
      submittedLinks: [],
      searchLinkPattern: this.getSearchLinkPattern(), // Abstract method
    };

    // Timers
    this.healthCheckTimer = null;
    this.keepAliveInterval = null;
    this.sendCvPageNotRespondTimeout = null;
    this.stuckStateTimer = null;
    this.stateVerificationInterval = null;
  }

  /**
   * Abstract methods - must be implemented by platform classes
   */
  getPlatformDomains() {
    throw new Error(
      "getPlatformDomains() must be implemented by platform class"
    );
  }

  getSearchLinkPattern() {
    throw new Error(
      "getSearchLinkPattern() must be implemented by platform class"
    );
  }

  isValidJobPage(url) {
    throw new Error("isValidJobPage() must be implemented by platform class");
  }

  getApiHost() {
    throw new Error("getApiHost() must be implemented by platform class");
  }

  /**
   * Initialize platform automation
   */
  async initialize() {
    await super.initialize();

    // Create status overlay
    this.statusOverlay = new StatusOverlay({
      id: `${this.platform}-status-overlay`,
      title: `${this.platform.toUpperCase()} AUTOMATION`,
      icon: "🤖",
      position: { top: "10px", right: "10px" },
    });
    this.statusOverlay.create();

    // Set up communication and monitoring
    this.initializePortConnection();
    this.startHealthCheck();
    this.startStateVerification();

    this.statusOverlay.addSuccess(`${this.platform} automation initialized`);
  }

  /**
   * Common port connection initialization
   */
  initializePortConnection() {
    try {
      this.statusOverlay.addInfo(
        "📡 Initializing port connection with background script"
      );

      // Disconnect existing port if any
      if (this.port) {
        try {
          this.port.disconnect();
        } catch (e) {
          // Ignore errors when disconnecting
        }
      }

      // Determine port name based on page type and session
      const isApplyPage = this.isApplicationPage(window.location.href);
      const sessionSuffix = this.sessionId
        ? `-${this.sessionId.slice(-6)}`
        : "";
      const timestamp = Date.now();
      const portName = isApplyPage
        ? `${this.platform}-apply-${timestamp}${sessionSuffix}`
        : `${this.platform}-search-${timestamp}${sessionSuffix}`;

      this.log(`🔌 Creating connection with port name: ${portName}`);

      // Create the connection
      this.port = chrome.runtime.connect({ name: portName });

      if (!this.port) {
        throw new Error(
          "Failed to establish connection with background script"
        );
      }

      // Set up message handler
      this.port.onMessage.addListener((message) => {
        this.handlePortMessage(message);
      });

      // Handle port disconnection
      this.port.onDisconnect.addListener(() => {
        const error = chrome.runtime.lastError;
        if (error) {
          this.log("❌ Port disconnected due to error:", error);
        } else {
          this.log("🔌 Port disconnected");
        }

        this.port = null;

        // Attempt to reconnect
        if (this.connectionRetries < this.maxRetries) {
          this.connectionRetries++;
          this.log(
            `🔄 Attempting to reconnect (${this.connectionRetries}/${this.maxRetries})...`
          );
          setTimeout(() => this.initializePortConnection(), 5000);
        }
      });

      // Start keep-alive interval
      this.startKeepAliveInterval();

      this.connectionRetries = 0;
      this.log("✅ Port connection established successfully");
      this.statusOverlay.addSuccess("Connection established");
    } catch (error) {
      this.log("❌ Error initializing port connection:", error);
      this.statusOverlay.addError("Connection failed: " + error.message);
      if (this.connectionRetries < this.maxRetries) {
        this.connectionRetries++;
        setTimeout(() => this.initializePortConnection(), 5000);
      }
    }
  }

  /**
   * Abstract method to determine if current page is an application page
   */
  isApplicationPage(url) {
    // Default implementation - platforms can override
    return url.includes("/apply") || url.includes("/application");
  }

  /**
   * Start keep-alive interval
   */
  startKeepAliveInterval() {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
    }

    this.keepAliveInterval = setInterval(() => {
      try {
        if (this.port) {
          this.safeSendPortMessage({ type: "KEEPALIVE" });
        } else {
          this.log("🔄 Port is null during keepalive, attempting to reconnect");
          this.initializePortConnection();
        }
      } catch (error) {
        this.log("❌ Error sending keepalive, reconnecting:", error);
        this.initializePortConnection();
      }
    }, 25000);
  }

  /**
   * Start health monitoring
   */
  startHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }

    this.healthCheckTimer = setInterval(() => this.checkHealth(), 60000);
  }

  /**
   * Start state verification
   */
  startStateVerification() {
    if (this.stateVerificationInterval) {
      clearInterval(this.stateVerificationInterval);
    }

    this.stateVerificationInterval = setInterval(() => {
      if (this.applicationState.isApplicationInProgress && this.port) {
        try {
          this.log("Verifying application status with background script");
          this.safeSendPortMessage({ type: "CHECK_APPLICATION_STATUS" });
        } catch (e) {
          this.log("Error in periodic state verification:", e);
        }
      }
    }, 30000);
  }

  /**
   * Health check for stuck applications
   */
  checkHealth() {
    try {
      const now = Date.now();

      // Check for stuck application
      if (
        this.applicationState.isApplicationInProgress &&
        this.applicationState.applicationStartTime
      ) {
        const applicationTime =
          now - this.applicationState.applicationStartTime;

        if (applicationTime > 5 * 60 * 1000) {
          this.log("🚨 Application stuck for over 5 minutes, forcing reset");
          this.applicationState.isApplicationInProgress = false;
          this.applicationState.applicationStartTime = null;
          this.statusOverlay.addWarning(
            "Application timeout detected - resetting state"
          );
          setTimeout(() => this.searchNext(), 1000);
        }
      }
    } catch (error) {
      this.log("❌ Health check error", error);
    }
  }

  /**
   * Safe port message sending
   */
  safeSendPortMessage(message) {
    try {
      if (!this.port) {
        this.log("⚠️ Port not available, attempting to reconnect");
        this.initializePortConnection();
        return false;
      }

      this.port.postMessage(message);
      return true;
    } catch (error) {
      this.log("❌ Error sending port message:", error);
      this.initializePortConnection();
      return false;
    }
  }

  /**
   * ✅ FIXED: Common port message handling with platform-specific delegation
   */
  handlePortMessage(message) {
    try {
      this.log("📨 Received port message:", message);

      const { type, data } = message || {};
      if (!type) {
        this.log("⚠️ Received message without type, ignoring");
        return;
      }

      // Common message types handled by base class
      switch (type) {
        case "SEARCH_NEXT":
          this.handleSearchNext(data);
          break;

        case "DUPLICATE":
          this.handleDuplicateJob(data);
          break;

        case "ERROR":
          this.handleErrorMessage(message);
          break;

        case "KEEPALIVE_RESPONSE":
          // Just acknowledge keepalive
          break;

        // ✅ REMOVED: SUCCESS case that was causing the issue
        // case "SUCCESS":
        //   this.handleSuccessMessage(data);  // This method doesn't exist in base class
        //   break;

        default:
          // ✅ FIX: All other messages (including SUCCESS) go to platform-specific handler
          this.handlePlatformSpecificMessage(type, data);
      }
    } catch (error) {
      this.log("❌ Error handling port message:", error);
    }
  }

  /**
   * Abstract method for platform-specific message handling
   */
  handlePlatformSpecificMessage(type, data) {
    this.log(`❓ Unhandled message type: ${type}`);
  }

  /**
   * Common search next handling
   */
  handleSearchNext(data) {
    this.log("🔄 Received search next notification", data);

    // Clear timeout first
    if (this.sendCvPageNotRespondTimeout) {
      clearTimeout(this.sendCvPageNotRespondTimeout);
      this.sendCvPageNotRespondTimeout = null;
    }

    // Reset application state
    this.applicationState.isApplicationInProgress = false;
    this.applicationState.applicationStartTime = null;
    this.applicationState.processedLinksCount++;

    // Notify background we're ready for next job
    this.safeSendPortMessage({ type: "SEARCH_NEXT_READY" });

    if (!data || !data.url) {
      this.log("No URL data in handleSearchNext");
      this.statusOverlay.addInfo("Job processed, searching next...");
      setTimeout(() => this.searchNext(), 2500);
      return;
    }

    this.updateLinkStatus(data);
    this.recordSubmission(data);
    setTimeout(() => this.searchNext(), 2500);
  }

  /**
   * Update visual link status
   */
  updateLinkStatus(data) {
    const normalizedUrl = this.normalizeUrlFully(data.url);
    const links = this.findAllLinksElements();

    for (let i = 0; i < links.length; i++) {
      const linkUrl = this.normalizeUrlFully(links[i].href);

      if (this.urlsMatch(linkUrl, normalizedUrl)) {
        if (data.status === "SUCCESS") {
          this.markLinkAsColor(links[i], "orange", "Completed");
          this.statusOverlay.addSuccess("Successfully submitted: " + data.url);
        } else if (data.status === "ERROR") {
          this.markLinkAsColor(links[i], "red", "Error");
          this.statusOverlay.addError(
            "Error with: " +
              data.url +
              (data.message ? ` - ${data.message}` : "")
          );
        } else {
          this.markLinkAsColor(links[i], "orange", "Skipped");
          this.statusOverlay.addWarning(
            "Skipped: " + data.url + (data.message ? ` - ${data.message}` : "")
          );
        }
        break;
      }
    }
  }

  /**
   * Record submission in search data
   */
  recordSubmission(data) {
    const normalizedUrl = this.normalizeUrlFully(data.url);

    if (
      !this.searchData.submittedLinks.some((link) => {
        const linkUrl = this.normalizeUrlFully(link.url);
        return this.urlsMatch(linkUrl, normalizedUrl);
      })
    ) {
      this.searchData.submittedLinks.push({ ...data });
    }
  }

  /**
   * Common duplicate job handling
   */
  handleDuplicateJob(data) {
    this.log("⚠️ Duplicate job detected, resetting application state");
    this.applicationState.isApplicationInProgress = false;
    this.applicationState.applicationStartTime = null;
    this.statusOverlay.addWarning(
      `Job already processed: ${data?.url || "Unknown URL"}`
    );

    setTimeout(() => this.searchNext(), 1000);
  }

  /**
   * Common error message handling
   */
  handleErrorMessage(errorMessage) {
    const actualMessage =
      errorMessage?.message ||
      errorMessage?.data?.message ||
      "Unknown error from background script";

    this.log("❌ Error from background script:", actualMessage);
    this.statusOverlay.addError("Background error: " + actualMessage);
  }

  /**
   * Common search logic - can be overridden by platforms
   */
  async searchNext() {
    try {
      this.log("Executing searchNext");

      // Critical: If an application is in progress, do not continue
      if (this.applicationState.isApplicationInProgress) {
        this.log("Application in progress, not searching for next link");
        this.statusOverlay.addInfo(
          "Application in progress, waiting to complete..."
        );
        this.safeSendPortMessage({ type: "CHECK_APPLICATION_STATUS" });
        return;
      }

      this.statusOverlay.addInfo("Searching for job links...");

      // Find all matching links
      let links = this.findAllLinksElements();
      this.log(`Found ${links.length} links`);

      // Process links
      const unprocessedLink = this.findUnprocessedLink(links);

      if (unprocessedLink) {
        await this.processJobLink(unprocessedLink);
      } else {
        await this.handleNoUnprocessedLinks();
      }
    } catch (err) {
      this.log("Error in searchNext:", err);
      this.statusOverlay.addError("Error in search: " + err.message);
      this.resetApplicationStateOnError();
      setTimeout(() => this.searchNext(), 5000);
    }
  }

  /**
   * Find unprocessed link from the list
   */
  findUnprocessedLink(links) {
    for (let i = 0; i < links.length; i++) {
      const url = this.normalizeUrlFully(links[i].href);

      // Check if already processed
      if (this.isLinkProcessed(url)) {
        this.markProcessedLink(links[i]);
        continue;
      }

      // Check if matches pattern
      if (!this.matchesSearchPattern(url)) {
        this.markInvalidLink(links[i], url);
        continue;
      }

      // Found valid unprocessed link
      return { link: links[i], url };
    }

    return null;
  }

  /**
   * Check if link is already processed
   */
  isLinkProcessed(url) {
    const alreadyProcessed = this.searchData.submittedLinks.some((link) => {
      if (!link.url) return false;
      const normalizedLinkUrl = this.normalizeUrlFully(link.url);
      return this.urlsMatch(normalizedLinkUrl, url);
    });

    const inLocalCache =
      this.applicationState.processedUrls &&
      this.applicationState.processedUrls.has(url);

    return alreadyProcessed || inLocalCache;
  }

  /**
   * Check if URL matches search pattern
   */
  matchesSearchPattern(url) {
    if (!this.searchData.searchLinkPattern) return true;

    const pattern =
      typeof this.searchData.searchLinkPattern === "string"
        ? new RegExp(
            this.searchData.searchLinkPattern.replace(/^\/|\/[gimy]*$/g, "")
          )
        : this.searchData.searchLinkPattern;

    return pattern.test(url);
  }

  /**
   * Mark link as already processed
   */
  markProcessedLink(linkElement) {
    this.markLinkAsColor(linkElement, "orange", "Completed");
  }

  /**
   * Mark link as invalid
   */
  markInvalidLink(linkElement, url) {
    this.markLinkAsColor(linkElement, "red", "Invalid");

    if (!this.applicationState.processedUrls) {
      this.applicationState.processedUrls = new Set();
    }
    this.applicationState.processedUrls.add(url);

    this.searchData.submittedLinks.push({
      url,
      status: "SKIP",
      message: "Link does not match pattern",
    });
  }

  /**
   * Process a job link
   */
  async processJobLink({ link, url }) {
    this.statusOverlay.addSuccess("Found job to apply: " + url);

    if (this.applicationState.isApplicationInProgress) {
      this.log("Application became in progress, aborting new task");
      return;
    }

    // Mark as processing
    this.markLinkAsColor(link, "green", "In Progress");

    // Set application state
    this.applicationState.isApplicationInProgress = true;
    this.applicationState.applicationStartTime = Date.now();

    // Add to local cache
    if (!this.applicationState.processedUrls) {
      this.applicationState.processedUrls = new Set();
    }
    this.applicationState.processedUrls.add(url);

    // Set timeout for stuck detection
    this.setStuckDetectionTimeout();

    // Send to background script
    try {
      this.safeSendPortMessage({
        type: this.getJobTaskMessageType(),
        data: {
          url,
          title: link.textContent.trim() || "Job Application",
        },
      });
    } catch (err) {
      this.handleJobTaskError(err, url, link);
    }
  }

  /**
   * Abstract method to get job task message type - platforms implement
   */
  getJobTaskMessageType() {
    return "START_APPLICATION"; // Default implementation
  }

  /**
   * Set timeout for stuck application detection
   */
  setStuckDetectionTimeout() {
    if (this.sendCvPageNotRespondTimeout) {
      clearTimeout(this.sendCvPageNotRespondTimeout);
    }

    this.sendCvPageNotRespondTimeout = setTimeout(() => {
      if (this.applicationState.isApplicationInProgress) {
        this.statusOverlay.addWarning(
          "No response from job page, resuming search"
        );
        this.applicationState.isApplicationInProgress = false;
        this.applicationState.applicationStartTime = null;
        setTimeout(() => this.searchNext(), 2000);
      }
    }, 180000);
  }

  /**
   * Handle job task error
   */
  handleJobTaskError(err, url, link) {
    this.log(`Error sending job task for ${url}:`, err);
    this.statusOverlay.addError("Error sending job task: " + err.message);

    // Reset flags on error
    this.resetApplicationStateOnError();

    // Remove from processed URLs since we couldn't process it
    if (this.applicationState.processedUrls) {
      this.applicationState.processedUrls.delete(url);
    }

    // Mark as error
    this.markLinkAsColor(link, "red", "Error");
  }

  /**
   * Handle case when no unprocessed links found
   */
  async handleNoUnprocessedLinks() {
    if (this.applicationState.isApplicationInProgress) {
      this.log("Application became in progress, aborting navigation");
      return;
    }

    this.statusOverlay.addInfo(
      "No new job links found, trying to load more..."
    );
    const loadMoreBtn = this.findLoadMoreElement();

    if (loadMoreBtn) {
      if (this.applicationState.isApplicationInProgress) {
        this.log("Application became in progress, aborting navigation");
        return;
      }

      this.statusOverlay.addInfo('Clicking "More results" button');
      loadMoreBtn.click();

      setTimeout(() => {
        if (!this.applicationState.isApplicationInProgress) {
          this.searchNext();
        }
      }, 3000);
    } else {
      this.statusOverlay.addSuccess("All jobs processed, search completed!");
      this.safeSendPortMessage({ type: "SEARCH_COMPLETED" });
    }
  }

  /**
   * Reset application state on error
   */
  resetApplicationStateOnError() {
    this.applicationState.isApplicationInProgress = false;
    this.applicationState.applicationStartTime = null;

    if (this.sendCvPageNotRespondTimeout) {
      clearTimeout(this.sendCvPageNotRespondTimeout);
      this.sendCvPageNotRespondTimeout = null;
    }
  }

  /**
   * Common utility methods
   */

  /**
   * Find all job links on the page
   */
  findAllLinksElements() {
    try {
      const domains = Array.isArray(this.searchData.domain)
        ? this.searchData.domain
        : [this.searchData.domain];

      if (!domains || domains.length === 0) {
        this.log("No domains specified for link search");
        return [];
      }

      const selectors = domains.map((domain) => {
        const cleanDomain = domain
          .replace(/^https?:\/\//, "")
          .replace(/\/$/, "");
        return `#rso a[href*="${cleanDomain}"], #botstuff a[href*="${cleanDomain}"]`;
      });

      const selector = selectors.join(",");
      const links = document.querySelectorAll(selector);

      this.log(`Found ${links.length} matching links`);
      return Array.from(links);
    } catch (err) {
      this.log("Error finding links:", err);
      return [];
    }
  }

  /**
   * Find load more button
   */
  findLoadMoreElement() {
    try {
      // Check if we're on the last page
      if (
        document.getElementById("pnprev") &&
        !document.getElementById("pnnext")
      ) {
        return null;
      }

      // Find "More results" button
      const moreResultsBtn = Array.from(document.querySelectorAll("a")).find(
        (a) => a.textContent.includes("More results")
      );

      if (moreResultsBtn) return moreResultsBtn;

      // Look for "Next" button
      const nextBtn = document.getElementById("pnnext");
      if (nextBtn) return nextBtn;

      // Try to find any navigation button at the bottom
      const navLinks = [
        ...document.querySelectorAll(
          "#botstuff table a[href^='/search?q=site:']"
        ),
      ];
      return navLinks[navLinks.length - 1];
    } catch (err) {
      this.log("Error finding load more button:", err);
      return null;
    }
  }

  /**
   * Normalize URL for comparison
   */
  normalizeUrlFully(url) {
    try {
      if (!url) return "";

      if (!url.startsWith("http")) {
        url = "https://" + url;
      }

      // Platform-specific URL normalization can be overridden
      url = this.platformSpecificUrlNormalization(url);

      const urlObj = new URL(url);
      return (urlObj.origin + urlObj.pathname)
        .toLowerCase()
        .trim()
        .replace(/\/+$/, "");
    } catch (e) {
      this.log("Error normalizing URL:", e);
      return url.toLowerCase().trim();
    }
  }

  /**
   * Platform-specific URL normalization - can be overridden
   */
  platformSpecificUrlNormalization(url) {
    return url; // Default: no platform-specific normalization
  }

  /**
   * Check if two URLs match
   */
  urlsMatch(url1, url2) {
    return url1 === url2 || url1.includes(url2) || url2.includes(url1);
  }

  /**
   * Mark link with color - utility function
   */
  markLinkAsColor(element, color, status) {
    try {
      if (!element) return;

      // Create or update status indicator
      let indicator = element.querySelector(".job-status-indicator");
      if (!indicator) {
        indicator = document.createElement("span");
        indicator.className = "job-status-indicator";
        indicator.style.cssText = `
          display: inline-block;
          margin-left: 8px;
          padding: 2px 6px;
          border-radius: 3px;
          font-size: 11px;
          font-weight: bold;
          color: white;
        `;
        element.appendChild(indicator);
      }

      // Set color and status
      const colors = {
        green: "#4CAF50",
        orange: "#FF9800",
        red: "#F44336",
        blue: "#2196F3",
      };

      indicator.style.backgroundColor = colors[color] || color;
      indicator.textContent = status || color;

      // Also add border to the link
      element.style.borderLeft = `3px solid ${colors[color] || color}`;
      element.style.paddingLeft = "8px";
    } catch (error) {
      console.warn("Error marking link color:", error);
    }
  }

  /**
   * Wait utility
   */
  wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Logging with platform context
   */
  log(message, data = {}) {
    const sessionInfo = this.sessionId
      ? `[Session: ${this.sessionId.slice(-6)}]`
      : "[No Session]";
    const contextInfo = this.hasSessionContext
      ? "[Context: ✓]"
      : "[Context: ✗]";
    const profileInfo = this.userProfile ? "[Profile: ✓]" : "[Profile: ✗]";

    console.log(
      `🤖 [${this.platform}${sessionInfo}${contextInfo}${profileInfo}] ${message}`,
      data
    );
  }

  /**
   * Cleanup all resources
   */
  cleanup() {
    // Clear timers
    if (this.healthCheckTimer) clearInterval(this.healthCheckTimer);
    if (this.keepAliveInterval) clearInterval(this.keepAliveInterval);
    if (this.stateVerificationInterval)
      clearInterval(this.stateVerificationInterval);
    if (this.sendCvPageNotRespondTimeout)
      clearTimeout(this.sendCvPageNotRespondTimeout);

    // Disconnect port
    if (this.port) {
      try {
        this.port.disconnect();
      } catch (e) {
        // Ignore errors
      }
      this.port = null;
    }

    // Cleanup status overlay
    if (this.statusOverlay) {
      this.statusOverlay.destroy();
      this.statusOverlay = null;
    }

    // Reset state
    this.applicationState.isApplicationInProgress = false;
    this.applicationState.applicationStartTime = null;
    this.applicationState.applicationUrl = null;

    super.cleanup();
    this.log("🧹 Platform cleanup completed");
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
}