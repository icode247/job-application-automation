// background/platforms/wellfound.js
import BaseBackgroundHandler from "../../shared/base/base-background-handler.js";

export default class WellfoundAutomationHandler extends BaseBackgroundHandler {
  constructor(messageHandler) {
    super(messageHandler, "wellfound");

    this.platformConfig = {
      domains: ["https://wellfound.com"],
      searchLinkPattern: /^https:\/\/wellfound\.com\/jobs\/(\d+)/,
      jobsPagePattern: /^https:\/\/wellfound\.com\/jobs(\?.*)?$/,
    };

    this.applicationTimeouts = new Map();
    this.processedCompletions = new Set();

    this.log("🚀 WellfoundAutomationHandler initialized");
  }

  /**
   * Handle platform-specific messages from content scripts
   */
  async handlePlatformSpecificMessage(type, data, port) {
    const sessionId = this.getSessionIdFromPort(port);
    const windowId = port.sender?.tab?.windowId;
    const tabId = port.sender?.tab?.id;

    console.log(
      `📨 Handling Wellfound message: ${type} for session ${sessionId}, tab ${tabId}`
    );

    switch (type) {
      case "GET_SEARCH_TASK":
        await this.handleGetSearchTask(port, data);
        break;

      case "GET_SEND_CV_TASK":
      case "GET_APPLICATION_TASK":
        await this.handleGetSendCvTask(port, data);
        break;

      case "START_APPLICATION":
        await this.handleStartApplication(
          port,
          data,
          sessionId,
          windowId,
          tabId
        );
        break;

      case "APPLICATION_SUCCESS":
        await this.handleTaskCompletion(port, data, "SUCCESS");
        break;

      case "APPLICATION_ERROR":
        await this.handleTaskCompletion(port, data, "ERROR");
        break;

      case "APPLICATION_SKIPPED":
        await this.handleTaskCompletion(port, data, "SKIPPED");
        break;

      case "CHECK_APPLICATION_STATUS":
        await this.handleCheckApplicationStatus(port, sessionId);
        break;

      case "SEARCH_NEXT_READY":
        await this.handleSearchNextReady(port, sessionId);
        break;

      case "SEARCH_COMPLETED":
        await this.handleSearchCompleted(port, sessionId, windowId);
        break;

      default:
        console.warn(`❓ Unknown Wellfound message type: ${type}`);
        this.safePortSend(port, {
          type: "ERROR",
          message: `Unknown message type: ${type}`,
        });
    }
  }

  async handleGetSearchTask(port, data) {
    const tabId = port.sender?.tab?.id;
    const windowId = port.sender?.tab?.windowId;

    console.log(
      `🔍 GET_SEARCH_TASK request from Wellfound tab ${tabId}, window ${windowId}`
    );

    let sessionData = null;
    let automation = null;

    // Find automation by window ID
    for (const [
      sessionId,
      auto,
    ] of this.messageHandler.activeAutomations.entries()) {
      if (auto.windowId === windowId) {
        automation = auto;
        console.log(`✅ Found Wellfound automation session: ${sessionId}`);
        break;
      }
    }

    if (automation) {
      const platformState = automation.platformState;

      // Add safety check for searchLinkPattern
      let searchLinkPatternString = "";
      try {
        if (platformState.searchData.searchLinkPattern) {
          searchLinkPatternString =
            platformState.searchData.searchLinkPattern.toString();
        } else {
          console.warn("⚠️ searchLinkPattern is null, using empty string");
          searchLinkPatternString = "";
        }
      } catch (error) {
        console.error(
          "❌ Error converting searchLinkPattern to string:",
          error
        );
        searchLinkPatternString = "";
      }

      sessionData = {
        tabId: tabId,
        limit: platformState.searchData.limit,
        current: platformState.searchData.current,
        domain: platformState.searchData.domain,
        submittedLinks: platformState.submittedLinks || [],
        searchLinkPattern: searchLinkPatternString,
      };

      // Update search tab ID
      platformState.searchTabId = tabId;
      console.log(`📊 Wellfound session data prepared:`, sessionData);
    } else {
      console.warn(`⚠️ No Wellfound automation found for window ${windowId}`);
      console.log(
        `Active automations:`,
        Array.from(this.messageHandler.activeAutomations.keys())
      );
      
      // Provide default data structure to prevent empty data
      sessionData = {
        tabId: tabId,
        limit: 10,
        current: 0,
        domain: ["https://wellfound.com"],
        submittedLinks: [],
        searchLinkPattern: "",
      };
    }

    // Send response with proper data structure
    const sent = this.safePortSend(port, {
      type: "SEARCH_TASK_DATA", // Use specific type instead of generic SUCCESS
      data: sessionData,
    });

    if (!sent) {
      console.error(
        `❌ Failed to send Wellfound search task data to port ${port.name}`
      );
    } else {
      console.log(
        `✅ Wellfound search task data sent successfully to tab ${tabId}`
      );
    }
  }

  /**
   * Handle CV task request - Wellfound specific data structure
   */
  async handleGetSendCvTask(port, data) {
    const tabId = port.sender?.tab?.id;
    const windowId = port.sender?.tab?.windowId;

    console.log(
      `🔍 GET_SEND_CV_TASK request from Wellfound tab ${tabId}, window ${windowId}`
    );

    let sessionData = null;
    let automation = null;

    // Find automation by window ID
    for (const [
      sessionId,
      auto,
    ] of this.messageHandler.activeAutomations.entries()) {
      if (auto.windowId === windowId) {
        automation = auto;
        console.log(`✅ Found Wellfound automation session: ${sessionId}`);
        break;
      }
    }

    if (automation) {
      // Ensure we have user profile data
      let userProfile = automation.userProfile;

      // If no user profile in automation, try to fetch from user service
      if (!userProfile && automation.userId) {
        try {
          console.log(
            `📡 Fetching user profile for Wellfound user ${automation.userId}`
          );
          const { default: UserService } = await import(
            "../../services/user-service.js"
          );
          const userService = new UserService({ userId: automation.userId });
          userProfile = await userService.getUserDetails();

          // Cache it in automation for future use
          automation.userProfile = userProfile;
          console.log(`✅ User profile fetched and cached for Wellfound`);
        } catch (error) {
          console.error(`❌ Failed to fetch user profile for Wellfound:`, error);
        }
      }

      sessionData = {
        devMode: automation.params?.devMode || false,
        profile: userProfile || null,
        session: automation.sessionConfig || null,
        avatarUrl: userProfile?.avatarUrl || null,
        userId: automation.userId,
        sessionId: automation.sessionId || null,
      };

      console.log(`📊 Wellfound session data prepared:`, {
        hasProfile: !!sessionData.profile,
        hasSession: !!sessionData.session,
        userId: sessionData.userId,
        devMode: sessionData.devMode,
      });
    } else {
      console.warn(`⚠️ No Wellfound automation found for window ${windowId}`);
      
      // Provide default data structure
      sessionData = {
        devMode: false,
        profile: null,
        session: null,
        avatarUrl: null,
        userId: null,
        sessionId: null,
      };
    }

    // Send response with specific type
    const sent = this.safePortSend(port, {
      type: "APPLICATION_TASK_DATA", // Use specific type instead of generic SUCCESS
      data: sessionData,
    });

    if (!sent) {
      console.error(
        `❌ Failed to send Wellfound CV task data to port ${port.name}`
      );
    } else {
      console.log(`✅ Wellfound CV task data sent successfully to tab ${tabId}`);
    }
  }

  /**
   * Handle application start request - Wellfound specific logic
   */
  async handleStartApplication(port, data, sessionId, windowId, tabId) {
    try {
      const { url, title, location, compensation } = data;

      console.log(
        `🎯 Starting Wellfound application for: ${title} (${url}) in tab ${tabId}`
      );

      // Find the automation instance
      let automation = null;
      for (const [
        sid,
        auto,
      ] of this.messageHandler.activeAutomations.entries()) {
        if (auto.windowId === windowId) {
          automation = auto;
          break;
        }
      }

      if (!automation) {
        throw new Error(`No automation found for window ${windowId}`);
      }

      // Check if already processing
      if (automation.platformState.isProcessingJob) {
        console.log(
          `⚠️ Wellfound automation already processing job, ignoring duplicate request`
        );
        this.safePortSend(port, {
          type: "DUPLICATE",
          message: "Already processing a job application",
        });
        return;
      }

      // Validate URL format
      if (!this.isValidWellfoundJobUrl(url)) {
        throw new Error(`Invalid Wellfound job URL: ${url}`);
      }

      // Check if already applied
      const normalizedUrl = this.messageHandler.normalizeUrl(url);
      const alreadyApplied = automation.platformState.submittedLinks.some(
        (link) => this.messageHandler.normalizeUrl(link.url) === normalizedUrl
      );

      if (alreadyApplied) {
        console.log(`🔄 Job already applied: ${url}`);
        this.safePortSend(port, {
          type: "DUPLICATE",
          data: { url, message: "Already applied to this job" },
        });
        return;
      }

      // Set processing state
      automation.platformState.isProcessingJob = true;
      automation.platformState.currentJobUrl = url;
      automation.platformState.applicationStartTime = Date.now();

      // Set application timeout
      const timeoutId = setTimeout(() => {
        console.log(`⏰ Wellfound application timeout for ${url}`);
        this.handleApplicationTimeout(automation, url, tabId);
      }, 300000); // 5 minute timeout

      this.applicationTimeouts.set(url, timeoutId);

      // Create new tab for application
      const jobTab = await chrome.tabs.create({
        url: url,
        windowId: windowId,
        active: false,
      });

      automation.platformState.currentJobTabId = jobTab.id;

      console.log(
        `✅ Created Wellfound job tab ${jobTab.id} for ${url} in window ${windowId}`
      );

      // Send confirmation
      this.safePortSend(port, {
        type: "SUCCESS",
        message: `Started application for ${title}`,
        data: { url, tabId: jobTab.id },
      });

      // Notify session manager
      await this.messageHandler.sessionManager.addNotification(sessionId, {
        type: "application_started",
        jobUrl: url,
        jobTitle: title,
        tabId: jobTab.id,
      });
    } catch (error) {
      console.error(`❌ Error starting Wellfound application:`, error);

      this.safePortSend(port, {
        type: "ERROR",
        message: `Failed to start application: ${error.message}`,
        data: { url: data.url },
      });

      // Clean up on error
      const automation = this.findAutomationByWindow(windowId);
      if (automation) {
        automation.platformState.isProcessingJob = false;
        automation.platformState.currentJobUrl = null;
        automation.platformState.applicationStartTime = null;
      }
    }
  }

  /**
   * Handle application timeout
   */
  async handleApplicationTimeout(automation, url, tabId) {
    try {
      console.log(
        `⏰ Wellfound application timeout for ${url} in tab ${tabId}`
      );

      // Clear timeout
      if (this.applicationTimeouts.has(url)) {
        clearTimeout(this.applicationTimeouts.get(url));
        this.applicationTimeouts.delete(url);
      }

      // Close the tab
      if (tabId) {
        try {
          await chrome.tabs.remove(tabId);
        } catch (error) {
          console.warn(`⚠️ Error closing timeout tab ${tabId}:`, error);
        }
      }

      // Reset automation state
      automation.platformState.isProcessingJob = false;
      automation.platformState.currentJobUrl = null;
      automation.platformState.currentJobTabId = null;
      automation.platformState.applicationStartTime = null;

      // Mark as timeout in submitted links
      automation.platformState.submittedLinks.push({
        url,
        status: "TIMEOUT",
        message: "Application timed out after 5 minutes",
        timestamp: Date.now(),
      });

      // Send search next to continue automation
      await this.sendSearchNextMessage(automation.windowId, {
        url,
        status: "TIMEOUT",
        message: "Application timed out",
      });
    } catch (error) {
      console.error(`❌ Error handling Wellfound application timeout:`, error);
    }
  }

  /**
   * Handle check application status
   */
  async handleCheckApplicationStatus(port, sessionId) {
    try {
      const automation = this.findAutomationBySession(sessionId);
      if (!automation) {
        this.safePortSend(port, {
          type: "ERROR",
          message: "Automation session not found",
        });
        return;
      }

      const status = {
        isProcessingJob: automation.platformState.isProcessingJob,
        currentJobUrl: automation.platformState.currentJobUrl,
        applicationStartTime: automation.platformState.applicationStartTime,
        currentJobTabId: automation.platformState.currentJobTabId,
      };

      this.safePortSend(port, {
        type: "APPLICATION_STATUS",
        data: status,
      });
    } catch (error) {
      console.error(`❌ Error checking Wellfound application status:`, error);
      this.safePortSend(port, {
        type: "ERROR",
        message: "Failed to check application status",
      });
    }
  }

  /**
   * Handle search next ready notification
   */
  async handleSearchNextReady(port, sessionId) {
    console.log(`📋 Wellfound search ready for session ${sessionId}`);
    // This is just an acknowledgment, no action needed
    this.safePortSend(port, {
      type: "SUCCESS",
      message: "Search next ready acknowledged",
    });
  }

  /**
   * Handle search completion
   */
  async handleSearchCompleted(port, sessionId, windowId) {
    try {
      console.log(`🏁 Wellfound search completed for session ${sessionId}`);

      const automation = this.findAutomationBySession(sessionId);
      if (automation) {
        // Mark automation as completed
        automation.status = "completed";
        automation.endTime = Date.now();

        // Update session
        await this.messageHandler.sessionManager.updateSession(sessionId, {
          status: "completed",
          completedAt: Date.now(),
        });

        // Notify session manager
        await this.messageHandler.sessionManager.addNotification(sessionId, {
          type: "automation_completed",
          completedJobs: automation.platformState.submittedLinks.length,
          totalTime: Date.now() - automation.startTime,
        });
      }

      this.safePortSend(port, {
        type: "SUCCESS",
        message: "Search completion acknowledged",
      });
    } catch (error) {
      console.error(`❌ Error handling Wellfound search completion:`, error);
      this.safePortSend(port, {
        type: "ERROR",
        message: "Failed to handle search completion",
      });
    }
  }

  /**
   * Override task completion handling for Wellfound-specific logic
   */
  async handleTaskCompletion(port, data, status) {
    try {
      // Clear any application timeout
      if (data && data.url && this.applicationTimeouts.has(data.url)) {
        clearTimeout(this.applicationTimeouts.get(data.url));
        this.applicationTimeouts.delete(data.url);
      }

      // Close the application tab if it exists
      const tabId = port.sender?.tab?.id;
      if (tabId) {
        try {
          await chrome.tabs.remove(tabId);
          console.log(`✅ Closed Wellfound application tab ${tabId}`);
        } catch (error) {
          console.warn(`⚠️ Error closing application tab ${tabId}:`, error);
        }
      }

      // Call parent method for common completion logic
      await super.handleTaskCompletion(port, data, status);
    } catch (error) {
      console.error(`❌ Error handling Wellfound task completion:`, error);
    }
  }

  /**
   * Validate Wellfound job URL
   */
  isValidWellfoundJobUrl(url) {
    try {
      if (!url) return false;

      // Check if it's a Wellfound domain
      if (!url.includes("wellfound.com")) {
        return false;
      }

      // Check if it matches job URL pattern
      return this.platformConfig.searchLinkPattern.test(url);
    } catch (error) {
      console.error("Error validating Wellfound URL:", error);
      return false;
    }
  }

  /**
   * Find automation by session ID
   */
  findAutomationBySession(sessionId) {
    return this.messageHandler.activeAutomations.get(sessionId);
  }

  /**
   * Find automation by window ID
   */
  findAutomationByWindow(windowId) {
    for (const automation of this.messageHandler.activeAutomations.values()) {
      if (automation.windowId === windowId) {
        return automation;
      }
    }
    return null;
  }

  /**
   * Override base class method to provide Wellfound-specific continuation logic
   */
  async continueOrComplete(automation, windowId, status, data) {
    if (status === "SUCCESS") {
      automation.platformState.searchData.current++;
    }

    const oldUrl = automation.platformState.currentJobUrl;

    // Wellfound-specific delay logic
    const errorCount = this.errorCounts.get(automation.sessionId) || 0;
    const delay = status === "ERROR" ? Math.min(3000 * errorCount, 15000) : 0;

    setTimeout(async () => {
      await this.sendSearchNextMessage(windowId, {
        url: oldUrl,
        status: status,
        data: data,
        message:
          typeof data === "string"
            ? data
            : status === "ERROR"
            ? "Application error"
            : undefined,
      });
    }, delay);
  }

  /**
   * Enhanced cleanup for Wellfound-specific resources
   */
  cleanup() {
    console.log("🧹 Starting WellfoundAutomationHandler cleanup");

    // Clear all application timeouts
    for (const timeoutId of this.applicationTimeouts.values()) {
      clearTimeout(timeoutId);
    }
    this.applicationTimeouts.clear();

    // Clear processed completions
    this.processedCompletions.clear();

    // Call parent cleanup
    super.cleanup();

    console.log("✅ WellfoundAutomationHandler cleanup completed");
  }

  /**
   * Logging with platform context
   */
  log(message, data = {}) {
    console.log(`🚀 [WellfoundHandler] ${message}`, data);
  }
}