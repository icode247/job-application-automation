// background/platforms/workable.js
import BaseBackgroundHandler from "../../shared/base/base-background-handler.js";
import {
  ApplicationTrackerService,
  UserService,
  StateManagerService,
} from "../../services/index.js";
import Utils from "../../utils/utils.js";

export default class WorkableAutomationHandler extends BaseBackgroundHandler {
  constructor(messageHandler) {
    super(messageHandler, "workable");

    // Initialize services - will be set per automation session
    this.applicationTracker = null;
    this.userService = null;
    this.stateManager = null;
  }

  /**
   * Initialize services for a specific automation session
   */
  initializeServicesForSession(automation) {
    if (!automation.userId) {
      console.warn("No userId available for service initialization");
      return;
    }

    // Initialize services if not already done for this session
    if (
      !this.applicationTracker ||
      this.applicationTracker.userId !== automation.userId
    ) {
      this.applicationTracker = new ApplicationTrackerService({
        userId: automation.userId,
      });
    }

    if (!this.userService || this.userService.userId !== automation.userId) {
      this.userService = new UserService({
        userId: automation.userId,
      });
    }

    if (!this.stateManager) {
      this.stateManager = new StateManagerService({
        sessionId: automation.sessionId,
        storageKey: `workable_automation_${automation.sessionId}`,
      });
    }
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
    const automation = this.findAutomationByWindow(windowId);

    if (automation) {
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
    }

    this.safePortSend(port, {
      type: "SUCCESS",
      data: sessionData || {},
    });
  }

  /**
   * Handle application task request - Uses UserService
   */
  async handleGetApplicationTask(port, data) {
    const tabId = port.sender?.tab?.id;
    const windowId = port.sender?.tab?.windowId;

    console.log(
      `🔍 GET_APPLICATION_TASK request from Workable tab ${tabId}, window ${windowId}`
    );

    const automation = this.findAutomationByWindow(windowId);
    let sessionData = {
      devMode: false,
      profile: null,
      session: null,
      avatarUrl: null,
      userId: null,
      sessionId: null,
    };

    if (automation) {
      // Initialize services for this session
      this.initializeServicesForSession(automation);

      // Get user profile using UserService
      let userProfile = automation.userProfile;
      if (!userProfile && automation.userId && this.userService) {
        try {
          console.log(
            `📡 Fetching user profile using UserService for user ${automation.userId}`
          );
          userProfile = await this.userService.getUserDetails();

          // Cache it in automation for future use
          automation.userProfile = userProfile;
          console.log(`✅ User profile fetched and cached via UserService`);
        } catch (error) {
          console.error(
            `❌ Failed to fetch user profile via UserService:`,
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

      console.log(`📊 Workable session data prepared:`, {
        hasProfile: !!sessionData.profile,
        hasSession: !!sessionData.session,
        userId: sessionData.userId,
        devMode: sessionData.devMode,
      });
    } else {
      console.warn(`⚠️ No Workable automation found for window ${windowId}`);
    }

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
   * Handle start application request - Uses Utils for URL normalization
   */
  async handleStartApplication(port, data) {
    try {
      const { url, title, requestId } = data;
      const windowId = port.sender?.tab?.windowId;
      const searchTabId = port.sender?.tab?.id;

      console.log(
        `🎯 START_APPLICATION request: ${url} (requestId: ${requestId})`
      );

      const automation = this.findAutomationByWindow(windowId);
      if (!automation) {
        const errorMsg = "No Workable automation session found";
        return this.sendErrorResponse(port, searchTabId, requestId, errorMsg);
      }

      // Initialize services for this session
      this.initializeServicesForSession(automation);

      // Check if already processing using StateManager
      if (this.stateManager) {
        const state = await this.stateManager.getState();
        if (state?.isProcessing) {
          const errorMsg = "Already processing another job";
          console.log(
            `⚠️ ${errorMsg} - current: ${automation.platformState.currentJobUrl}`
          );
          return this.sendErrorResponse(port, searchTabId, requestId, errorMsg);
        }
      }

      // Check for duplicates using Utils.normalizeUrl
      const normalizedUrl = Utils.normalizeUrl(url);
      const isDuplicate = automation.platformState.submittedLinks?.some(
        (link) => Utils.normalizeUrl(link.url) === normalizedUrl
      );

      if (isDuplicate) {
        console.log(`🔄 Duplicate job detected: ${url}`);
        return this.sendDuplicateResponse(port, searchTabId, requestId, url);
      }

      // Set processing state using StateManager
      if (this.stateManager) {
        await this.stateManager.setProcessingStatus(true);
      }

      // Update automation state
      automation.platformState.isProcessingJob = true;
      automation.platformState.currentJobUrl = url;
      automation.platformState.applicationStartTime = Date.now();

      // Add to submitted links with PROCESSING status
      this.addToSubmittedLinks(automation, url, "PROCESSING");

      // Send starting confirmation
      this.sendSuccessResponse(
        port,
        searchTabId,
        requestId,
        { url },
        "APPLICATION_STARTING"
      );

      // Create application tab
      await this.createApplicationTab(automation, url, windowId);
    } catch (error) {
      console.error("❌ Error in handleStartApplication:", error);
      const errorMsg = "Error starting application: " + error.message;
      this.sendErrorResponse(
        port,
        data?.searchTabId,
        data?.requestId,
        errorMsg
      );
    }
  }

  /**
   * Enhanced task completion using ApplicationTrackerService
   */
  async handleTaskCompletion(port, data, status) {
    try {
      const windowId = port.sender?.tab?.windowId;
      const tabId = port.sender?.tab?.id;

      console.log(`🎯 Handling ${status} completion for window ${windowId}`);

      const automation = this.findAutomationByWindow(windowId);
      if (!automation) {
        console.warn(`⚠️ No automation found for window ${windowId}`);
        return this.safePortSend(port, {
          type: "ERROR",
          message: "No automation session found",
        });
      }

      // Initialize services for this session
      this.initializeServicesForSession(automation);

      const currentUrl = automation.platformState.currentJobUrl;

      // Update submitted links
      this.updateSubmittedLinks(automation, currentUrl, status, data);

      // Handle successful applications using services
      if (status === "SUCCESS" && automation.userId) {
        await this.handleSuccessfulApplication(automation, data);
      }

      // Close the application tab
      await this.closeApplicationTab(automation);

      // Reset application state using StateManager
      await this.resetApplicationState(automation);

      // Send acknowledgment
      this.safePortSend(port, {
        type: "SUCCESS",
        message: `${status} completion acknowledged`,
      });

      // IMPORTANT: Continue automation immediately after acknowledgment using setTimeout (browser-compatible)
      setTimeout(async () => {
        try {
          await this.continueOrComplete(automation, windowId, status, data);
        } catch (error) {
          console.error("❌ Error in delayed continuation:", error);
        }
      }, 0);

      console.log(
        `✅ ${status} completion handled successfully - continuing automation`
      );
    } catch (error) {
      console.error(`❌ Error handling ${status} completion:`, error);
      this.safePortSend(port, {
        type: "ERROR",
        message: `Error processing ${status}: ${error.message}`,
      });

      // Try to continue anyway after an error
      setTimeout(async () => {
        try {
          const automation = this.findAutomationByWindow(
            port.sender?.tab?.windowId
          );
          if (automation) {
            await this.continueOrComplete(
              automation,
              port.sender?.tab?.windowId,
              "ERROR",
              error.message
            );
          }
        } catch (continuationError) {
          console.error(
            "❌ Error in error recovery continuation:",
            continuationError
          );
        }
      }, 3000);
    }
  }

  /**
   * Handle successful application using ApplicationTrackerService
   */
  async handleSuccessfulApplication(automation, data) {
    try {
      // Update application count using ApplicationTrackerService
      if (this.applicationTracker) {
        await this.applicationTracker.updateApplicationCount();
        console.log(
          "✅ Application count updated via ApplicationTrackerService"
        );
      }

      // Save job details using ApplicationTrackerService
      if (data && typeof data === "object" && this.applicationTracker) {
        const applicationData = {
          ...data,
          userId: automation.userId,
          platform: "Workable",
          jobUrl: automation.platformState.currentJobUrl,
          appliedAt: Date.now(),
        };

        await this.applicationTracker.saveAppliedJob(applicationData);
        console.log("✅ Job details saved via ApplicationTrackerService");
      }

      // Update state using StateManager
      if (this.stateManager) {
        await this.stateManager.incrementApplicationsUsed();
      }
    } catch (error) {
      console.error("❌ Error handling successful application:", error);
      // Don't fail the entire process for API errors
    }
  }

  /**
   * Reset application state using StateManager
   */
  async resetApplicationState(automation) {
    // Reset StateManager processing status
    if (this.stateManager) {
      await this.stateManager.setProcessingStatus(false);
    }

    // Reset automation state
    automation.platformState.isProcessingJob = false;
    automation.platformState.currentJobUrl = null;
    automation.platformState.currentJobTabId = null;
    automation.platformState.applicationStartTime = null;
  }

  /**
   * Handle search completion with notification
   */
  async handleSearchCompleted(port, data) {
    const windowId = port.sender?.tab?.windowId;
    console.log(`🏁 Workable search completed for window ${windowId}`);

    try {
      await this.showNotification(
        "Workable Job Search Completed",
        "All job applications have been processed."
      );
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

    const automation = this.findAutomationByWindow(windowId);
    let statusData = {
      inProgress: false,
      url: null,
      tabId: null,
      startTime: null,
    };

    if (automation) {
      // Get status from StateManager if available
      if (this.stateManager) {
        const state = await this.stateManager.getState();
        statusData.inProgress =
          state?.isProcessing || automation.platformState.isProcessingJob;
      } else {
        statusData.inProgress = automation.platformState.isProcessingJob;
      }

      statusData.url = automation.platformState.currentJobUrl;
      statusData.tabId = automation.platformState.currentJobTabId;
      statusData.startTime = automation.platformState.applicationStartTime;
    }

    const response = {
      type: "APPLICATION_STATUS",
      data: statusData,
    };

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
      console.log(`🔄 Starting continuation process - Status: ${status}`);

      // Update counters based on status
      if (status === "SUCCESS") {
        automation.platformState.searchData.current++;
        console.log(
          `✅ Incremented counter to ${automation.platformState.searchData.current}`
        );
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

        await this.showNotification(
          "Workable Automation Complete",
          `Successfully completed ${automation.platformState.searchData.current} applications.`
        );
        return;
      }

      // Calculate delay based on error count and status
      const errorCount =
        this.messageHandler.getErrorCount?.(automation.sessionId) || 0;
      let delay;

      if (status === "ERROR") {
        delay = Math.min(2000 + 1000 * errorCount, 10000); // 2-10 seconds for errors
      } else if (status === "SKIPPED") {
        delay = 1000; // 1 second for skipped
      } else {
        delay = 1500; // 1.5 seconds for success
      }

      console.log(
        `⏱️ Continuing automation after ${delay}ms delay (status: ${status}, errors: ${errorCount})`
      );

      // Continue with next job after delay
      setTimeout(async () => {
        try {
          await this.sendSearchNextMessage(windowId, {
            url: oldUrl,
            status: status,
            data: data,
            message:
              typeof data === "string"
                ? data
                : status === "ERROR"
                ? "Application error - continuing to next job"
                : status === "SKIPPED"
                ? "Application skipped - continuing to next job"
                : "Application completed - continuing to next job",
          });
          console.log(`✅ SEARCH_NEXT message sent successfully`);
        } catch (error) {
          console.error(`❌ Error sending SEARCH_NEXT message:`, error);
        }
      }, delay);
    } catch (error) {
      console.error("❌ Error in continueOrComplete:", error);

      // Fallback: try to continue anyway after a longer delay
      setTimeout(async () => {
        try {
          await this.sendSearchNextMessage(windowId, {
            url: automation.platformState.currentJobUrl,
            status: "ERROR",
            message: "Error in continuation - attempting recovery",
          });
        } catch (fallbackError) {
          console.error("❌ Fallback continuation also failed:", fallbackError);
        }
      }, 5000);
    }
  }

  /**
   * Send SEARCH_NEXT message to continue automation
   */
  async sendSearchNextMessage(windowId, data) {
    try {
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

  // Helper methods

  /**
   * Find automation by window ID
   */
  findAutomationByWindow(windowId) {
    for (const [
      sessionId,
      automation,
    ] of this.messageHandler.activeAutomations.entries()) {
      if (automation.windowId === windowId) {
        return automation;
      }
    }
    return null;
  }

  /**
   * Add URL to submitted links
   */
  addToSubmittedLinks(automation, url, status) {
    if (!automation.platformState.submittedLinks) {
      automation.platformState.submittedLinks = [];
    }

    automation.platformState.submittedLinks.push({
      url: url,
      status: status,
      timestamp: Date.now(),
    });
  }

  /**
   * Update submitted links with completion status
   */
  updateSubmittedLinks(automation, currentUrl, status, data) {
    if (!automation.platformState.submittedLinks) {
      automation.platformState.submittedLinks = [];
    }

    const normalizedUrl = Utils.normalizeUrl(currentUrl);

    // Remove any existing PROCESSING entry for this URL
    automation.platformState.submittedLinks =
      automation.platformState.submittedLinks.filter(
        (link) => Utils.normalizeUrl(link.url) !== normalizedUrl
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
  }

  /**
   * Create application tab
   */
  async createApplicationTab(automation, url, windowId) {
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
      await this.resetApplicationState(automation);

      // Remove from submitted links
      const normalizedUrl = Utils.normalizeUrl(url);
      automation.platformState.submittedLinks =
        automation.platformState.submittedLinks.filter(
          (link) => Utils.normalizeUrl(link.url) !== normalizedUrl
        );

      // Notify of error
      await this.sendSearchNextMessage(windowId, {
        url,
        status: "ERROR",
        message: "Failed to create application tab: " + tabError.message,
      });
    }
  }

  /**
   * Close application tab
   */
  async closeApplicationTab(automation) {
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
  }

  /**
   * Show notification using Chrome notifications API
   */
  async showNotification(title, message) {
    try {
      await chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: title,
        message: message,
      });
    } catch (error) {
      console.warn("⚠️ Error showing notification:", error);
    }
  }

  /**
   * Send error response helper
   */
  sendErrorResponse(port, searchTabId, requestId, errorMsg) {
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
  }

  /**
   * Send duplicate response helper
   */
  sendDuplicateResponse(port, searchTabId, requestId, url) {
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
  }

  /**
   * Send success response helper
   */
  sendSuccessResponse(port, searchTabId, requestId, data, type = "SUCCESS") {
    this.safePortSend(port, {
      type: type,
      data: data,
    });

    if (requestId && searchTabId) {
      chrome.tabs.sendMessage(searchTabId, {
        type: "APPLICATION_START_RESPONSE",
        requestId,
        success: true,
        data: data,
      });
    }
  }
}
