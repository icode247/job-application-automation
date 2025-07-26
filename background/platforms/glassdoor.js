// background/platforms/glassdoor.js - FIXED VERSION following Wellfound pattern
import BaseBackgroundHandler from "../../shared/base/base-background-handler.js";

export default class GlassdoorAutomationHandler extends BaseBackgroundHandler {
  constructor(messageHandler) {
    super(messageHandler, "glassdoor");

    this.platformConfig = {
      domains: ["https://www.glassdoor.com"],
      searchLinkPattern:
        /^https:\/\/(www\.)?glassdoor\.com\/(job|Job|partner|apply).*$/,
      jobsPagePattern: /^https:\/\/(www\.)?glassdoor\.com\/Job\/.*-jobs-.*$/,
      smartApplyPattern: /^https:\/\/smartapply\.indeed\.com/,
    };

    // Track application timeouts and states
    this.applicationTimeouts = new Map();
    this.processedCompletions = new Set();

    this.log("🚀 GlassdoorAutomationHandler initialized with correct patterns");
  }

  /**
   * Handle platform-specific messages from content scripts
   */
  async handlePlatformSpecificMessage(type, data, port) {
    const sessionId = this.getSessionIdFromPort(port);
    const windowId = port.sender?.tab?.windowId;
    const tabId = port.sender?.tab?.id;

    this.log(
      `📨 Handling Glassdoor message: ${type} for session ${sessionId}, tab ${tabId}`
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
        this.log.warn(`❓ Unknown Glassdoor message type: ${type}`);
        this.safePortSend(port, {
          type: "ERROR",
          message: `Unknown message type: ${type}`,
        });
    }
  }

  /**
   * Handle search task request - Glassdoor specific data structure
   */
  async handleGetSearchTask(port, data) {
    const tabId = port.sender?.tab?.id;
    const windowId = port.sender?.tab?.windowId;

    this.log(
      `🔍 GET_SEARCH_TASK request from Glassdoor tab ${tabId}, window ${windowId}`
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
        this.log(`✅ Found Glassdoor automation session: ${sessionId}`);
        break;
      }
    }

    if (automation) {
      const platformState = automation.platformState;

      // Safety check for searchLinkPattern
      let searchLinkPatternString = "";
      try {
        if (platformState.searchData.searchLinkPattern) {
          searchLinkPatternString =
            platformState.searchData.searchLinkPattern.toString();
        } else {
          this.log.warn("⚠️ searchLinkPattern is null, using default pattern");
          searchLinkPatternString =
            this.platformConfig.searchLinkPattern.toString();
        }
      } catch (error) {
        this.log.error(
          "❌ Error converting searchLinkPattern to string:",
          error
        );
        searchLinkPatternString =
          this.platformConfig.searchLinkPattern.toString();
      }

      sessionData = {
        tabId: tabId,
        limit: platformState.searchData.limit,
        current: platformState.searchData.current,
        domain: platformState.searchData.domain,
        submittedLinks: platformState.submittedLinks || [],
        searchLinkPattern: searchLinkPatternString,
      };

      // Store the search tab ID properly
      platformState.searchTabId = tabId;
      automation.searchTabId = tabId;

      this.log(`📊 Glassdoor session data prepared:`, sessionData);
    } else {
      this.log.warn(`⚠️ No Glassdoor automation found for window ${windowId}`);

      // Provide default data structure to prevent errors
      sessionData = {
        tabId: tabId,
        limit: 10,
        current: 0,
        domain: this.platformConfig.domains,
        submittedLinks: [],
        searchLinkPattern: this.platformConfig.searchLinkPattern.toString(),
      };
    }

    // Send response with specific type
    const sent = this.safePortSend(port, {
      type: "SEARCH_TASK_DATA",
      data: sessionData,
    });

    if (!sent) {
      this.log.error(
        `❌ Failed to send Glassdoor search task data to port ${port.name}`
      );
    } else {
      this.log(
        `✅ Glassdoor search task data sent successfully to tab ${tabId}`
      );
    }
  }

  /**
   * Handle CV/Application task request - Glassdoor specific data structure
   */
  async handleGetSendCvTask(port, data) {
    const tabId = port.sender?.tab?.id;
    const windowId = port.sender?.tab?.windowId;

    this.log(
      `🔍 GET_SEND_CV_TASK request from Glassdoor tab ${tabId}, window ${windowId}`
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
        this.log(`✅ Found Glassdoor automation session: ${sessionId}`);
        break;
      }
    }

    if (automation) {
      // Ensure we have user profile data
      let userProfile = automation.userProfile;

      // If no user profile in automation, try to fetch from user service
      if (!userProfile && automation.userId) {
        try {
          this.log(
            `📡 Fetching user profile for Glassdoor user ${automation.userId}`
          );
          const { default: UserService } = await import(
            "../../services/user-service.js"
          );
          const userService = new UserService({ userId: automation.userId });
          userProfile = await userService.getUserDetails();

          // Cache it in automation for future use
          automation.userProfile = userProfile;
          this.log(`✅ User profile fetched and cached for Glassdoor`);
        } catch (error) {
          this.log.error(
            `❌ Failed to fetch user profile for Glassdoor:`,
            error
          );
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

      this.log(`📊 Glassdoor application session data prepared:`, {
        hasProfile: !!sessionData.profile,
        hasSession: !!sessionData.session,
        userId: sessionData.userId,
        devMode: sessionData.devMode,
      });
    } else {
      this.log.warn(`⚠️ No Glassdoor automation found for window ${windowId}`);

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
      type: "APPLICATION_TASK_DATA",
      data: sessionData,
    });

    if (!sent) {
      this.log.error(
        `❌ Failed to send Glassdoor CV task data to port ${port.name}`
      );
    } else {
      this.log(
        `✅ Glassdoor CV task data sent successfully to tab ${tabId}`
      );
    }
  }

  /**
   * Handle application start request - Glassdoor specific logic (following Wellfound pattern)
   */
  async handleStartApplication(port, data, sessionId, windowId, tabId) {
    try {
      const { url, title, company, location, salary } = data;

      this.log(
        `🎯 Starting Glassdoor application for: ${title} (${url}) in tab ${tabId}`
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
        this.log(
          `⚠️ Glassdoor automation already processing job, ignoring duplicate request`
        );
        this.safePortSend(port, {
          type: "DUPLICATE",
          message: "Already processing a job application",
        });
        return;
      }

      // Validate URL format
      if (!this.isValidGlassdoorJobUrl(url)) {
        throw new Error(`Invalid Glassdoor job URL: ${url}`);
      }

      // Check if already applied
      const normalizedUrl = this.messageHandler.normalizeUrl(url);
      const alreadyApplied = automation.platformState.submittedLinks.some(
        (link) => this.messageHandler.normalizeUrl(link.url) === normalizedUrl
      );

      if (alreadyApplied) {
        this.log(`🔄 Job already applied: ${url}`);
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

      // Set application timeout (5 minutes)
      const timeoutId = setTimeout(() => {
        this.log(`⏰ Glassdoor application timeout for ${url}`);
        this.handleApplicationTimeout(automation, url, null);
      }, 300000);

      this.applicationTimeouts.set(url, timeoutId);

      // Create new tab for application (key difference from modal approach)
      const jobTab = await chrome.tabs.create({
        url: url,
        windowId: windowId,
        active: false, // Don't steal focus from search tab
      });

      automation.platformState.currentJobTabId = jobTab.id;

      this.log(
        `✅ Created Glassdoor job tab ${jobTab.id} for ${url} in window ${windowId}`
      );

      // Send confirmation to search tab
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
      this.log.error(`❌ Error starting Glassdoor application:`, error);

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
      this.log(
        `⏰ Glassdoor application timeout for ${url} in tab ${tabId}`
      );

      // Clear timeout
      if (this.applicationTimeouts.has(url)) {
        clearTimeout(this.applicationTimeouts.get(url));
        this.applicationTimeouts.delete(url);
      }

      // Close the tab if it exists
      if (tabId) {
        try {
          await chrome.tabs.remove(tabId);
        } catch (error) {
          this.log.warn(`⚠️ Error closing timeout tab ${tabId}:`, error);
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
      this.log.error(`❌ Error handling Glassdoor application timeout:`, error);
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
      this.log.error(`❌ Error checking Glassdoor application status:`, error);
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
    this.log(`📋 Glassdoor search ready for session ${sessionId}`);
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
      this.log(`🏁 Glassdoor search completed for session ${sessionId}`);

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

      // Show completion notification
      try {
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icons/icon48.png",
          title: "Glassdoor Job Automation Completed",
          message: "All job applications have been processed.",
        });
      } catch (error) {
        this.log.warn("⚠️ Error showing notification:", error);
      }

      this.safePortSend(port, {
        type: "SUCCESS",
        message: "Search completion acknowledged",
      });
    } catch (error) {
      this.log.error(`❌ Error handling Glassdoor search completion:`, error);
      this.safePortSend(port, {
        type: "ERROR",
        message: "Failed to handle search completion",
      });
    }
  }

  /**
   * Override task completion handling for Glassdoor-specific logic
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
          this.log(`✅ Closed Glassdoor application tab ${tabId}`);
        } catch (error) {
          this.log.warn(`⚠️ Error closing application tab ${tabId}:`, error);
        }
      }

      // Call parent method for common completion logic
      await super.handleTaskCompletion(port, data, status);
    } catch (error) {
      this.log.error(`❌ Error handling Glassdoor task completion:`, error);
    }
  }

  /**
   * Validate Glassdoor job URL
   */
  isValidGlassdoorJobUrl(url) {
    try {
      if (!url) return false;

      // Check if it's a Glassdoor domain or SmartApply
      if (
        !url.includes("glassdoor.com") &&
        !url.includes("smartapply.indeed.com")
      ) {
        return false;
      }

      // Check if it matches job URL pattern
      return (
        this.platformConfig.searchLinkPattern.test(url) ||
        this.platformConfig.smartApplyPattern.test(url)
      );
    } catch (error) {
      this.log.error("Error validating Glassdoor URL:", error);
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
   * Override base class method to provide Glassdoor-specific continuation logic
   */
  async continueOrComplete(automation, windowId, status, data) {
    if (status === "SUCCESS") {
      automation.platformState.searchData.current++;
    }

    const oldUrl = automation.platformState.currentJobUrl;
    const errorCount = this.log.errorCounts.get(automation.sessionId) || 0;
    const delay = status === "ERROR" ? Math.min(3000 * errorCount, 15000) : 0;

    setTimeout(async () => {
      const searchTabId =
        automation.searchTabId || automation.platformState.searchTabId;

      if (searchTabId) {
        try {
          await chrome.tabs.sendMessage(searchTabId, {
            action: "platformMessage",
            type: "SEARCH_NEXT",
            data: {
              url: oldUrl,
              status: status,
              data: data,
              message:
                typeof data === "string"
                  ? data
                  : status === "ERROR"
                  ? "Application error"
                  : undefined,
              submittedLinks: automation.platformState.submittedLinks || [],
              current: automation.platformState.searchData.current || 0,
            },
          });
          this.log(
            `✅ Sent SEARCH_NEXT with updated data to Glassdoor search tab ${searchTabId}`
          );
        } catch (error) {
          this.log.error(
            `❌ Failed to send SEARCH_NEXT to tab ${searchTabId}:`,
            error
          );
        }
      } else {
        this.log.error("❌ No search tab ID available for Glassdoor");
      }
    }, delay);
  }

  /**
   * Enhanced cleanup for Glassdoor-specific resources
   */
  cleanup() {
    this.log("🧹 Starting GlassdoorAutomationHandler cleanup");

    // Clear all application timeouts
    for (const timeoutId of this.applicationTimeouts.values()) {
      clearTimeout(timeoutId);
    }
    this.applicationTimeouts.clear();

    // Clear processed completions
    this.processedCompletions.clear();

    // Call parent cleanup
    super.cleanup();

    this.log("✅ GlassdoorAutomationHandler cleanup completed");
  }
}
