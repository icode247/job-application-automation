// background/platforms/lever.js - REFACTORED VERSION
import BaseBackgroundHandler from "../../shared/base/base-background-handler.js";

export default class LeverAutomationHandler extends BaseBackgroundHandler {
  constructor(messageHandler) {
    super(messageHandler, "lever"); // Pass platform name to base class
  }

  /**
   * Platform-specific message handling - only Lever-specific logic here
   */
  async handlePlatformSpecificMessage(type, data, port) {
    switch (type) {
      case "GET_SEARCH_TASK":
        await this.handleGetSearchTask(port, data);
        break;

      case "GET_SEND_CV_TASK":
        await this.handleGetSendCvTask(port, data);
        break;

      case "SEND_CV_TASK":
        await this.handleSendCvTask(port, data);
        break;

      case "SEND_CV_TASK_DONE":
        await this.handleTaskCompletion(port, data, "SUCCESS");
        break;

      case "SEND_CV_TASK_ERROR":
        await this.handleTaskCompletion(port, data, "ERROR");
        break;

      case "SEND_CV_TASK_SKIP":
        await this.handleTaskCompletion(port, data, "SKIPPED");
        break;

      case "SEARCH_TASK_DONE":
        await this.handleSearchTaskDone(port, data);
        break;

      // ✅ FIX: Add missing message types that the frontend sends
      case "CHECK_APPLICATION_STATUS":
      case "VERIFY_APPLICATION_STATUS":
        await this.handleVerifyApplicationStatus(port, data);
        break;

      case "CHECK_JOB_TAB_STATUS":
        await this.handleCheckJobTabStatus(port, data);
        break;

      case "SEARCH_NEXT_READY":
        await this.handleSearchNextReady(port, data);
        break;

      // ✅ FIX: Add SEARCH_COMPLETED handler
      case "SEARCH_COMPLETED":
        await this.handleSearchCompleted(port, data);
        break;

      default:
        console.log(`❓ Unhandled Lever port message type: ${type}`);
        this.safePortSend(port, {
          type: "ERROR",
          message: `Unknown message type: ${type}`,
        });
    }
  }

  async handleSearchCompleted(port, data) {
    const windowId = port.sender?.tab?.windowId;
    console.log(`🏁 Lever search completed for window ${windowId}`);

    try {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "Lever Job Search Completed",
        message: "All job applications have been processed.",
      });
    } catch (error) {
      console.warn("⚠️ Error showing notification:", error);
    }

    this.safePortSend(port, {
      type: "SUCCESS",
      message: "Lever search completion acknowledged",
    });
  }

  /**
   * Handle search task request - Lever specific data structure
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
   * Handle CV task request - Lever specific data structure
   */
  async handleGetSendCvTask(port, data) {
    const tabId = port.sender?.tab?.id;
    const windowId = port.sender?.tab?.windowId;

    console.log(
      `🔍 GET_SEND_CV_TASK request from Lever tab ${tabId}, window ${windowId}`
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
        console.log(`✅ Found Lever automation session: ${sessionId}`);
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
            `📡 Fetching user profile for Lever user ${automation.userId}`
          );
          const { default: UserService } = await import(
            "../../services/user-service.js"
          );
          const userService = new UserService({ userId: automation.userId });
          userProfile = await userService.getUserDetails();

          // Cache it in automation for future use
          automation.userProfile = userProfile;
          console.log(`✅ User profile fetched and cached for Lever`);
        } catch (error) {
          console.error(`❌ Failed to fetch user profile for Lever:`, error);
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

      console.log(`📊 Lever session data prepared:`, {
        hasProfile: !!sessionData.profile,
        hasSession: !!sessionData.session,
        userId: sessionData.userId,
        devMode: sessionData.devMode,
      });
    } else {
      console.warn(`⚠️ No Lever automation found for window ${windowId}`);
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
        `❌ Failed to send Lever CV task data to port ${port.name}`
      );
    } else {
      console.log(`✅ Lever CV task data sent successfully to tab ${tabId}`);
    }
  }

  /**
   * Handle CV task (opening job in new tab) - Lever specific logic
   */
  async handleSendCvTask(port, data) {
    try {
      const { url, title } = data;
      const windowId = port.sender?.tab?.windowId;

      console.log(`🎯 Opening Lever job in new tab: ${url}`);

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
        throw new Error("No Lever automation session found");
      }

      if (automation.platformState.isProcessingJob) {
        this.safePortSend(port, {
          type: "ERROR",
          message: "Already processing another job",
        });
        return;
      }

      // Check for duplicates
      const normalizedUrl = this.messageHandler.normalizeUrl(url);
      if (
        automation.platformState.submittedLinks?.some(
          (link) => this.messageHandler.normalizeUrl(link.url) === normalizedUrl
        )
      ) {
        this.safePortSend(port, {
          type: "DUPLICATE",
          message: "This job has already been processed",
          data: { url },
        });
        return;
      }

      // Create new tab for job application - Lever specific URL format
      const leverApplyUrl = url.endsWith("/apply") ? url : url + "/apply";
      const tab = await chrome.tabs.create({
        url: leverApplyUrl,
        windowId: windowId,
        active: true,
      });

      // Update automation state
      automation.platformState.isProcessingJob = true;
      automation.platformState.currentJobUrl = url;
      automation.platformState.currentJobTabId = tab.id;
      automation.platformState.applicationStartTime = Date.now();

      // Add to submitted links
      if (!automation.platformState.submittedLinks) {
        automation.platformState.submittedLinks = [];
      }
      automation.platformState.submittedLinks.push({
        url: url,
        status: "PROCESSING",
        timestamp: Date.now(),
      });

      this.safePortSend(port, {
        type: "SUCCESS",
        message: "Lever apply tab will be created",
      });

      console.log(`✅ Lever job tab created: ${tab.id} for URL: ${url}`);
    } catch (error) {
      console.error("❌ Error handling Lever SEND_CV_TASK:", error);
      this.safePortSend(port, {
        type: "ERROR",
        message: error.message,
      });
    }
  }

  /**
   * Handle search task completion
   */
  async handleSearchTaskDone(port, data) {
    const windowId = port.sender?.tab?.windowId;
    console.log(`🏁 Lever search task completed for window ${windowId}`);

    try {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "Lever Job Search Completed",
        message: "All job applications have been processed.",
      });
    } catch (error) {
      console.warn("⚠️ Error showing notification:", error);
    }

    this.safePortSend(port, {
      type: "SUCCESS",
      message: "Lever search completion acknowledged",
    });
  }

  /**
   * Handle application status verification
   */
  async handleVerifyApplicationStatus(port, data) {
    const windowId = port.sender?.tab?.windowId;

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

    const isActive = automation
      ? automation.platformState.isProcessingJob
      : false;

    this.safePortSend(port, {
      type: "APPLICATION_STATUS_RESPONSE",
      data: {
        active: isActive,
        url: automation?.platformState.currentJobUrl || null,
        tabId: automation?.platformState.currentJobTabId || null,
      },
    });
  }

  /**
   * Handle job tab status check
   */
  async handleCheckJobTabStatus(port, data) {
    const windowId = port.sender?.tab?.windowId;

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

    const isOpen = automation
      ? automation.platformState.isProcessingJob
      : false;

    this.safePortSend(port, {
      type: "JOB_TAB_STATUS",
      data: {
        isOpen: isOpen,
        tabId: automation?.platformState.currentJobTabId || null,
        isProcessing: isOpen,
      },
    });
  }

  /**
   * Handle search next ready notification
   */
  async handleSearchNextReady(port, data) {
    console.log("🔄 Lever search ready for next job");

    this.safePortSend(port, {
      type: "NEXT_READY_ACKNOWLEDGED",
      data: { status: "success" },
    });
  }

  /**
   * Override base class method to provide Lever-specific continuation logic
   */
  async continueOrComplete(automation, windowId, status, data) {
    if (status === "SUCCESS") {
      automation.platformState.searchData.current++;
    }

    const oldUrl = automation.platformState.currentJobUrl;

    // Lever-specific delay logic
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
}
