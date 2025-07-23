// background/platforms/workable.js
import BaseBackgroundHandler from "../../shared/base/base-background-handler.js";

export default class WorkableAutomationHandler extends BaseBackgroundHandler {
  constructor(messageHandler) {
    super(messageHandler, "workable"); // Pass platform name to base class
  }

  /**
   * Platform-specific message handling - only Workable-specific logic here
   */
  async handlePlatformSpecificMessage(type, data, port) {
    switch (type) {
      case "GET_SEARCH_TASK":
        await this.handleGetSearchTask(port, data);
        break;

      case "GET_APPLICATION_TASK":
        await this.handleGetApplicationTask(port, data);
        break;

      case "START_APPLICATION":
        await this.handleStartApplication(port, data);
        break;

      case "APPLICATION_COMPLETED":
        await this.handleTaskCompletion(port, data, "SUCCESS");
        break;

      case "APPLICATION_ERROR":
        await this.handleTaskCompletion(port, data, "ERROR");
        break;

      case "APPLICATION_SKIPPED":
        await this.handleTaskCompletion(port, data, "SKIPPED");
        break;

      case "SEARCH_COMPLETED":
        await this.handleSearchCompleted(port, data);
        break;

      case "CHECK_APPLICATION_STATUS":
      case "VERIFY_APPLICATION_STATUS":
        await this.handleVerifyApplicationStatus(port, data);
        break;

      case "SEARCH_NEXT_READY":
        await this.handleSearchNextReady(port, data);
        break;

      default:
        console.log(`❓ Unhandled Workable port message type: ${type}`);
        this.safePortSend(port, {
          type: "ERROR",
          message: `Unknown message type: ${type}`,
        });
    }
  }

  /**
   * Handle search task request - Workable specific data structure
   */
  async handleGetSearchTask(port, data) {
    const tabId = port.sender?.tab?.id;
    const windowId = port.sender?.tab?.windowId;

    let sessionData = null;
    for (const [
      sessionId,
      automation,
    ] of this.messageHandler.activeAutomations.entries()) {
      if (automation.windowId === windowId) {
        const platformState = automation.platformState;
        sessionData = {
          tabId: tabId,
          limit: platformState.searchData.limit,
          current: platformState.searchData.current,
          domain: platformState.searchData.domain,
          submittedLinks: platformState.submittedLinks || [],
          searchLinkPattern:
            platformState.searchData.searchLinkPattern.toString(),
        };

        // Update search tab ID
        platformState.searchTabId = tabId;
        break;
      }
    }

    this.safePortSend(port, {
      type: "SUCCESS",
      data: sessionData || {},
    });
  }

  /**
   * Handle application task request - Workable specific data structure
   */
  async handleGetApplicationTask(port, data) {
    const tabId = port.sender?.tab?.id;
    const windowId = port.sender?.tab?.windowId;

    console.log(
      `🔍 GET_APPLICATION_TASK request from Workable tab ${tabId}, window ${windowId}`
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
        console.log(`✅ Found Workable automation session: ${sessionId}`);
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
            `📡 Fetching user profile for Workable user ${automation.userId}`
          );
          const { default: UserService } = await import(
            "../../services/user-service.js"
          );
          const userService = new UserService({ userId: automation.userId });
          userProfile = await userService.getUserDetails();

          // Cache it in automation for future use
          automation.userProfile = userProfile;
          console.log(`✅ User profile fetched and cached for Workable`);
        } catch (error) {
          console.error(`❌ Failed to fetch user profile for Workable:`, error);
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

      console.log(`📊 Workable session data prepared:`, {
        hasProfile: !!sessionData.profile,
        hasSession: !!sessionData.session,
        userId: sessionData.userId,
        devMode: sessionData.devMode,
      });
    } else {
      console.warn(`⚠️ No Workable automation found for window ${windowId}`);
      sessionData = {
        devMode: false,
        profile: null,
        session: null,
        avatarUrl: null,
        userId: null,
        sessionId: null,
      };
    }

    // Send response
    const sent = this.safePortSend(port, {
      type: "SUCCESS",
      data: sessionData,
    });

    if (!sent) {
      console.error(
        `❌ Failed to send Workable application task data to port ${port.name}`
      );
    } else {
      console.log(
        `✅ Workable application task data sent successfully to tab ${tabId}`
      );
    }
  }

  /**
   * Handle start application request - Workable specific logic
   */
  async handleStartApplication(port, data) {
    try {
      const { url, title, requestId } = data;
      const windowId = port.sender?.tab?.windowId;
      const searchTabId = port.sender?.tab?.id;

      console.log(
        `🎯 START_APPLICATION request: ${url} (requestId: ${requestId})`
      );

      // Find automation session
      let automation = null;
      for (const [
        sessionId,
        auto,
      ] of this.messageHandler.activeAutomations.entries()) {
        if (auto.windowId === windowId) {
          automation = auto;
          break;
        }
      }

      if (!automation) {
        const errorMsg = "No Workable automation session found";
        this.safePortSend(port, {
          type: "ERROR",
          message: errorMsg,
        });

        // Send specific response if requestId provided
        if (requestId && searchTabId) {
          chrome.tabs.sendMessage(searchTabId, {
            type: "APPLICATION_START_RESPONSE",
            requestId,
            success: false,
            message: errorMsg,
          });
        }
        return;
      }

      // Check if already processing
      if (automation.platformState.isProcessingJob) {
        const errorMsg = "Already processing another job";
        console.log(
          `⚠️ ${errorMsg} - current: ${automation.platformState.currentJobUrl}`
        );

        this.safePortSend(port, {
          type: "ERROR",
          message: errorMsg,
        });

        if (requestId && searchTabId) {
          chrome.tabs.sendMessage(searchTabId, {
            type: "APPLICATION_START_RESPONSE",
            requestId,
            success: false,
            message: errorMsg,
          });
        }
        return;
      }

      // Check for duplicates
      const normalizedUrl = this.messageHandler.normalizeUrl(url);
      const isDuplicate = automation.platformState.submittedLinks?.some(
        (link) => this.messageHandler.normalizeUrl(link.url) === normalizedUrl
      );

      if (isDuplicate) {
        console.log(`🔄 Duplicate job detected: ${url}`);

        this.safePortSend(port, {
          type: "DUPLICATE",
          message: "This job has already been processed",
          data: { url },
        });

        if (requestId && searchTabId) {
          chrome.tabs.sendMessage(searchTabId, {
            type: "APPLICATION_START_RESPONSE",
            requestId,
            success: false,
            duplicate: true,
            message: "This job has already been processed",
          });
        }
        return;
      }

      // Set processing state BEFORE creating tab
      automation.platformState.isProcessingJob = true;
      automation.platformState.currentJobUrl = url;
      automation.platformState.applicationStartTime = Date.now();

      // Add to submitted links with PROCESSING status
      if (!automation.platformState.submittedLinks) {
        automation.platformState.submittedLinks = [];
      }
      automation.platformState.submittedLinks.push({
        url: url,
        status: "PROCESSING",
        timestamp: Date.now(),
      });

      // Send starting confirmation
      this.safePortSend(port, {
        type: "APPLICATION_STARTING",
        data: { url },
      });

      if (requestId && searchTabId) {
        chrome.tabs.sendMessage(searchTabId, {
          type: "APPLICATION_START_RESPONSE",
          requestId,
          success: true,
          data: { url },
        });
      }

      // Create application tab
      try {
        const tab = await chrome.tabs.create({
          url: url,
          windowId: windowId,
          active: true,
        });

        automation.platformState.currentJobTabId = tab.id;
        console.log(`✅ Application tab created: ${tab.id} for ${url}`);
      } catch (tabError) {
        console.error("❌ Error creating application tab:", tabError);

        // Reset state on error
        automation.platformState.isProcessingJob = false;
        automation.platformState.currentJobUrl = null;
        automation.platformState.applicationStartTime = null;

        // Remove from submitted links
        automation.platformState.submittedLinks =
          automation.platformState.submittedLinks.filter(
            (link) =>
              this.messageHandler.normalizeUrl(link.url) !== normalizedUrl
          );

        // Notify of error
        await this.sendSearchNextMessage(windowId, {
          url,
          status: "ERROR",
          message: "Failed to create application tab: " + tabError.message,
        });
      }
    } catch (error) {
      console.error("❌ Error in handleStartApplication:", error);
      this.safePortSend(port, {
        type: "ERROR",
        message: "Error starting application: " + error.message,
      });

      if (data?.requestId && port.sender?.tab?.id) {
        chrome.tabs.sendMessage(port.sender.tab.id, {
          type: "APPLICATION_START_RESPONSE",
          requestId: data.requestId,
          success: false,
          message: "Error starting application: " + error.message,
        });
      }
    }
  }

  /**
   * Handle search completion
   */
  async handleSearchCompleted(port, data) {
    const windowId = port.sender?.tab?.windowId;
    console.log(`🏁 Workable search completed for window ${windowId}`);

    try {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "Workable Job Search Completed",
        message: "All job applications have been processed.",
      });
    } catch (error) {
      console.warn("⚠️ Error showing notification:", error);
    }

    this.safePortSend(port, {
      type: "SUCCESS",
      message: "Workable search completion acknowledged",
    });
  }

  /**
   * Handle application status verification
   */
  async handleVerifyApplicationStatus(port, data) {
    const windowId = port.sender?.tab?.windowId;
    const tabId = port.sender?.tab?.id;
    const requestId = data?.requestId;

    console.log(
      `🔍 Verifying application status for window ${windowId}, tab ${tabId}`
    );

    let automation = null;
    for (const [
      sessionId,
      auto,
    ] of this.messageHandler.activeAutomations.entries()) {
      if (auto.windowId === windowId) {
        automation = auto;
        break;
      }
    }

    const statusData = {
      inProgress: automation ? automation.platformState.isProcessingJob : false,
      url: automation?.platformState.currentJobUrl || null,
      tabId: automation?.platformState.currentJobTabId || null,
      startTime: automation?.platformState.applicationStartTime || null,
    };

    const response = {
      type: "APPLICATION_STATUS",
      data: statusData,
    };

    // Include requestId if provided for correlation
    if (requestId) {
      response.requestId = requestId;
    }

    console.log(`📊 Sending application status:`, statusData);

    this.safePortSend(port, response);

    if (tabId) {
      try {
        chrome.tabs.sendMessage(tabId, response);
      } catch (error) {
        console.warn("⚠️ Error sending redundant status message:", error);
      }
    }
  }

  /**
   * Handle search next ready notification
   */
  async handleSearchNextReady(port, data) {
    console.log("🔄 Workable search ready for next job");

    this.safePortSend(port, {
      type: "NEXT_READY_ACKNOWLEDGED",
      data: { status: "success" },
    });
  }

  /**
   * Override base class method to provide Workable-specific continuation logic
   */
  async continueOrComplete(automation, windowId, status, data) {
    try {
      // Update counters based on status
      if (status === "SUCCESS") {
        automation.platformState.searchData.current++;
      }

      const oldUrl = automation.platformState.currentJobUrl;

      // Check if we've reached the limit
      if (
        automation.platformState.searchData.current >=
        automation.platformState.searchData.limit
      ) {
        console.log(
          `🏁 Reached application limit (${automation.platformState.searchData.limit})`
        );

        try {
          chrome.notifications.create({
            type: "basic",
            iconUrl: "icons/icon48.png",
            title: "Workable Automation Complete",
            message: `Successfully completed ${automation.platformState.searchData.current} applications.`,
          });
        } catch (notifError) {
          console.warn("⚠️ Error showing completion notification:", notifError);
        }
        return;
      }

      // Calculate delay based on error count
      const errorCount =
        this.messageHandler.getErrorCount?.(automation.sessionId) || 0;
      const delay =
        status === "ERROR" ? Math.min(3000 * errorCount, 15000) : 1000;

      console.log(
        `⏱️ Continuing automation after ${delay}ms delay (status: ${status})`
      );

      // Continue with next job after delay
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
              : status === "SKIPPED"
              ? "Application skipped"
              : undefined,
        });
      }, delay);
    } catch (error) {
      console.error("❌ Error in continueOrComplete:", error);
    }
  }

  /**
   * Enhanced task completion with better state management
   */
  async handleTaskCompletion(port, data, status) {
    try {
      const windowId = port.sender?.tab?.windowId;
      const tabId = port.sender?.tab?.id;

      console.log(`🎯 Handling ${status} completion for window ${windowId}`);

      // Find the automation session
      let automation = null;
      for (const [
        sessionId,
        auto,
      ] of this.messageHandler.activeAutomations.entries()) {
        if (auto.windowId === windowId) {
          automation = auto;
          break;
        }
      }

      if (!automation) {
        console.warn(`⚠️ No automation found for window ${windowId}`);
        this.safePortSend(port, {
          type: "ERROR",
          message: "No automation session found",
        });
        return;
      }

      const currentUrl = automation.platformState.currentJobUrl;

      // Update submitted links
      if (!automation.platformState.submittedLinks) {
        automation.platformState.submittedLinks = [];
      }

      // Remove any existing PROCESSING entry for this URL
      automation.platformState.submittedLinks =
        automation.platformState.submittedLinks.filter(
          (link) =>
            this.messageHandler.normalizeUrl(link.url) !==
            this.messageHandler.normalizeUrl(currentUrl)
        );

      // Add the completion entry
      automation.platformState.submittedLinks.push({
        url: currentUrl,
        status: status,
        timestamp: Date.now(),
        data: status === "SUCCESS" ? data : undefined,
        error: status === "ERROR" ? data : undefined,
        reason: status === "SKIPPED" ? data : undefined,
      });

      // Handle API calls for successful applications
      if (status === "SUCCESS" && automation.userId) {
        try {
          // Track application count
          const appResponse = await fetch(
            `${this.messageHandler.serverHost}/api/applications`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId: automation.userId }),
            }
          );

          // Add job details if provided
          if (data && typeof data === "object") {
            const jobResponse = await fetch(
              `${this.messageHandler.serverHost}/api/applied-jobs`,
              {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ...data,
                  userId: automation.userId,
                  applicationPlatform: "Workable",
                }),
              }
            );
          }

          console.log("✅ API tracking completed successfully");
        } catch (apiError) {
          console.error("❌ API tracking failed:", apiError);
          // Don't fail the entire process for API errors
        }
      }

      // Close the application tab
      try {
        if (automation.platformState.currentJobTabId) {
          await chrome.tabs.remove(automation.platformState.currentJobTabId);
          console.log(
            `🗑️ Closed application tab ${automation.platformState.currentJobTabId}`
          );
        }
      } catch (tabError) {
        console.warn("⚠️ Error closing application tab:", tabError);
      }

      // Reset application state
      automation.platformState.isProcessingJob = false;
      automation.platformState.currentJobUrl = null;
      automation.platformState.currentJobTabId = null;
      automation.platformState.applicationStartTime = null;

      // Increment counter for successful applications
      if (status === "SUCCESS") {
        automation.platformState.searchData.current++;
      }

      // Send acknowledgment
      this.safePortSend(port, {
        type: "SUCCESS",
        message: `${status} completion acknowledged`,
      });

      // Continue automation or complete
      await this.continueOrComplete(automation, windowId, status, data);

      console.log(`✅ ${status} completion handled successfully`);
    } catch (error) {
      console.error(`❌ Error handling ${status} completion:`, error);
      this.safePortSend(port, {
        type: "ERROR",
        message: `Error processing ${status}: ${error.message}`,
      });
    }
  }
  /**
   * Send SEARCH_NEXT message to continue automation
   */
  async sendSearchNextMessage(windowId, data) {
    try {
      // Find search tab for this window
      const tabs = await chrome.tabs.query({ windowId: windowId });
      const searchTab = tabs.find(
        (tab) =>
          tab.url.includes("google.com/search") &&
          tab.url.includes("site:workable.com")
      );

      if (searchTab) {
        console.log(`🔄 Sending SEARCH_NEXT to tab ${searchTab.id}`);
        await chrome.tabs.sendMessage(searchTab.id, {
          type: "SEARCH_NEXT",
          data: data,
        });
      } else {
        console.warn(`⚠️ No search tab found for window ${windowId}`);
      }
    } catch (error) {
      console.error("❌ Error sending SEARCH_NEXT message:", error);
    }
  }
}

//sendSearchNextMessage
