// background/platforms/ashby.js
import BaseBackgroundHandler from "../../shared/base/base-background-handler.js";

export default class AshbyAutomationHandler extends BaseBackgroundHandler {
  constructor(messageHandler) {
    const devMode = messageHandler.devMode;
    super(messageHandler, "ashby", devMode);
  }

  /**
   * Platform-specific message handling - only Ashby-specific logic here
   */
  async handlePlatformSpecificMessage(type, data, port) {
    switch (type) {
      case "GET_SEARCH_TASK":
        await this.handleGetSearchTask(port, data);
        break;

      case "GET_SEND_CV_TASK":
      case "GET_APPLICATION_TASK":
        await this.handleGetSendCvTask(port, data);
        break;

      case "SEND_CV_TASK":
      case "START_APPLICATION":
        await this.handleSendCvTask(port, data);
        break;

      case "SEND_CV_TASK_DONE":
      case "APPLICATION_COMPLETED":
        await this.handleTaskCompletion(port, data, "SUCCESS");
        break;

      case "SEND_CV_TASK_ERROR":
      case "APPLICATION_ERROR":
        await this.handleTaskCompletion(port, data, "ERROR");
        break;

      case "SEND_CV_TASK_SKIP":
      case "APPLICATION_SKIPPED":
        await this.handleTaskCompletion(port, data, "SKIPPED");
        break;

      case "SEARCH_TASK_DONE":
      case "SEARCH_COMPLETED":
        await this.handleSearchTaskDone(port, data);
        break;

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

      default:
        this.log(`❓ Unhandled Ashby port message type: ${type}`);
        this.safePortSend(port, {
          type: "ERROR",
          message: `Unknown message type: ${type}`,
        });
    }
  }

  async handleGetSearchTask(port, data) {
    const tabId = port.sender?.tab?.id;
    const windowId = port.sender?.tab?.windowId;

    this.log(
      `🔍 GET_SEARCH_TASK request from Ashby tab ${tabId}, window ${windowId}`
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
        this.log(`✅ Found Ashby automation session: ${sessionId}`);
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
          this.log("⚠️ searchLinkPattern is null, using empty string");
          searchLinkPatternString = "";
        }
      } catch (error) {
        this.log(
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
      this.log(`📊 Ashby session data prepared:`, sessionData);
    } else {
      this.log(`⚠️ No Ashby automation found for window ${windowId}`);
      this.log(
        `Active automations:`,
        Array.from(this.messageHandler.activeAutomations.keys())
      );
    }

    // Send response
    const sent = this.safePortSend(port, {
      type: "SUCCESS",
      data: sessionData || {},
    });

    if (!sent) {
      this.log(
        `❌ Failed to send Ashby search task data to port ${port.name}`
      );
    } else {
      this.log(
        `✅ Ashby search task data sent successfully to tab ${tabId}`
      );
    }
  }

  /**
   * Handle CV task request - Ashby specific data structure
   */
  async handleGetSendCvTask(port, data) {
    const tabId = port.sender?.tab?.id;
    const windowId = port.sender?.tab?.windowId;

    this.log(
      `🔍 GET_SEND_CV_TASK request from Ashby tab ${tabId}, window ${windowId}`
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
        this.log(`✅ Found Ashby automation session: ${sessionId}`);
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
            `📡 Fetching user profile for Ashby user ${automation.userId}`
          );
          const { default: UserService } = await import(
            "../../services/user-service.js"
          );
          const userService = new UserService({ userId: automation.userId });
          userProfile = await userService.getUserDetails();

          // Cache it in automation for future use
          automation.userProfile = userProfile;
          this.log(`✅ User profile fetched and cached for Ashby`);
        } catch (error) {
          this.log(`❌ Failed to fetch user profile for Ashby:`, error);
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

      this.log(`📊 Ashby session data prepared:`, {
        hasProfile: !!sessionData.profile,
        hasSession: !!sessionData.session,
        userId: sessionData.userId,
        devMode: sessionData.devMode,
      });
    } else {
      this.log(`⚠️ No Ashby automation found for window ${windowId}`);
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
      this.log(
        `❌ Failed to send Ashby CV task data to port ${port.name}`
      );
    } else {
      this.log(`✅ Ashby CV task data sent successfully to tab ${tabId}`);
    }
  }

  /**
   * Handle CV task (opening job in new tab) - Ashby specific logic
   */
  async handleSendCvTask(port, data) {
    try {
      const { url, title } = data;
      const windowId = port.sender?.tab?.windowId;

      this.log(`🎯 Opening Ashby job in new tab: ${url}`);

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
        throw new Error("No Ashby automation session found");
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

      // Create new tab for job application
      const tab = await chrome.tabs.create({
        url: url,
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
        message: "Ashby apply tab will be created",
      });

      this.log(`✅ Ashby job tab created: ${tab.id} for URL: ${url}`);
    } catch (error) {
      this.log("❌ Error handling Ashby SEND_CV_TASK:", error);
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
    this.log(`🏁 Ashby search task completed for window ${windowId}`);

    try {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "Ashby Job Search Completed",
        message: "All job applications have been processed.",
      });
    } catch (error) {
      this.log("⚠️ Error showing notification:", error);
    }

    this.safePortSend(port, {
      type: "SUCCESS",
      message: "Ashby search completion acknowledged",
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
    this.log("🔄 Ashby search ready for next job");

    this.safePortSend(port, {
      type: "NEXT_READY_ACKNOWLEDGED",
      data: { status: "success" },
    });
  }

  /**
   * Override base class method to provide Ashby-specific continuation logic
   */
  async continueOrComplete(automation, windowId, status, data) {
    if (status === "SUCCESS") {
      automation.platformState.searchData.current++;
    }

    const oldUrl = automation.platformState.currentJobUrl;

    // Ashby-specific delay logic
    const errorCount = this.logCounts.get(automation.sessionId) || 0;
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
