
// background/platforms/recruitee.js - REFACTORED VERSION
import BaseBackgroundHandler from "../../shared/base/base-background-handler.js";

export default class RecruiteeAutomationHandler extends BaseBackgroundHandler {
  constructor(messageHandler) {
    super(messageHandler, "recruitee"); // Pass platform name to base class
  }

  /**
   * Platform-specific message handling - only Recruitee-specific logic here
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
        await this.handleCheckApplicationStatus(port, data);
        break;

      case "SEARCH_NEXT_READY":
        await this.handleSearchNextReady(port, data);
        break;

      case "GET_PROFILE_DATA":
        await this.handleGetProfileData(port, data);
        break;

      default:
        this.log(`❓ Unhandled Recruitee port message type: ${type}`);
        this.safePortSend(port, {
          type: "ERROR",
          message: `Unknown message type: ${type}`,
        });
    }
  }

  /**
   * Handle search task request - Recruitee specific data structure
   */
  async handleGetSearchTask(port, data) {
    const tabId = port.sender?.tab?.id;
    const windowId = port.sender?.tab?.windowId;

    let sessionData = null;
    let automation = null;

    // Find automation by window ID
    for (const [
      sessionId,
      auto,
    ] of this.messageHandler.activeAutomations.entries()) {
      if (auto.windowId === windowId) {
        automation = auto;
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
            `📡 Fetching user profile for Recruitee user ${automation.userId}`
          );
          const { default: UserService } = await import(
            "../../services/user-service.js"
          );
          const userService = new UserService({ userId: automation.userId });
          userProfile = await userService.getUserDetails();

          // Cache it in automation for future use
          automation.userProfile = userProfile;
          this.log(`✅ User profile fetched and cached for Recruitee`);
        } catch (error) {
          this.log(
            `❌ Failed to fetch user profile for Recruitee:`,
            error
          );
        }
      }

      const platformState = automation.platformState;
      sessionData = {
        tabId: tabId,
        limit: platformState.searchData.limit,
        current: platformState.searchData.current,
        domain: platformState.searchData.domain,
        submittedLinks: platformState.submittedLinks || [],
        searchLinkPattern:
          platformState.searchData.searchLinkPattern?.toString() ||
          "/^https:\\/\\/.*\\.recruitee\\.com\\/(o|career)\\/([^\\/]+)\\/?.*$/",
        // Include user profile and session context
        profile: userProfile || null,
        session: automation.sessionConfig || null,
        userId: automation.userId,
        sessionId: automation.sessionId || null,
      };

      platformState.searchTabId = tabId;
    }

    this.safePortSend(port, {
      type: "SEARCH_TASK_DATA",
      data: sessionData || {},
    });
  }

  /**
   * Handle application task request - Recruitee specific data structure
   */
  async handleGetApplicationTask(port, data) {
    const tabId = port.sender?.tab?.id;
    const windowId = port.sender?.tab?.windowId;

    this.log(
      `🔍 GET_APPLICATION_TASK request from Recruitee tab ${tabId}, window ${windowId}`
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
        this.log(`✅ Found Recruitee automation session: ${sessionId}`);
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
            `📡 Fetching user profile for Recruitee user ${automation.userId}`
          );
          const { default: UserService } = await import(
            "../../services/user-service.js"
          );
          const userService = new UserService({ userId: automation.userId });
          userProfile = await userService.getUserDetails();

          // Cache it in automation for future use
          automation.userProfile = userProfile;
          this.log(`✅ User profile fetched and cached for Recruitee`);
        } catch (error) {
          this.log(
            `❌ Failed to fetch user profile for Recruitee:`,
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

      this.log(`📊 Recruitee session data prepared:`, {
        hasProfile: !!sessionData.profile,
        hasSession: !!sessionData.session,
        userId: sessionData.userId,
        devMode: sessionData.devMode,
      });
    } else {
      this.log(`⚠️ No Recruitee automation found for window ${windowId}`);
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
      type: "APPLICATION_TASK_DATA",
      data: sessionData,
    });

    if (!sent) {
      this.log(
        `❌ Failed to send Recruitee application task data to port ${port.name}`
      );
    } else {
      this.log(
        `✅ Recruitee application task data sent successfully to tab ${tabId}`
      );
    }
  }

  /**
   * Handle start application (opening job in new tab) - Recruitee specific logic
   */
  async handleStartApplication(port, data) {
    try {
      const { url, title } = data;
      const windowId = port.sender?.tab?.windowId;
      this.log(`🎯 Opening Recruitee job in new tab: ${url}`);

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
        throw new Error("No Recruitee automation session found");
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

      // Create new tab for job application - Recruitee uses direct URLs
      const tab = await chrome.tabs.create({
        url: url, // Recruitee doesn't need "/apply" suffix
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
        type: "APPLICATION_STARTING",
        data: { url },
      });

      this.log(`✅ Recruitee job tab created: ${tab.id} for URL: ${url}`);
    } catch (error) {
      this.log("❌ Error handling Recruitee START_APPLICATION:", error);
      this.safePortSend(port, {
        type: "ERROR",
        message: error.message,
      });
    }
  }

  /**
   * Handle search completion
   */
  async handleSearchCompleted(port, data) {
    const windowId = port.sender?.tab?.windowId;
    this.log(`🏁 Recruitee search task completed for window ${windowId}`);

    try {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "Recruitee Job Search Completed",
        message: "All job applications have been processed.",
      });
    } catch (error) {
      this.log("⚠️ Error showing notification:", error);
    }

    this.safePortSend(port, {
      type: "SUCCESS",
      message: "Recruitee search completion acknowledged",
    });
  }

  /**
   * Handle application status check
   */
  async handleCheckApplicationStatus(port, data) {
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
      type: "APPLICATION_STATUS",
      data: {
        inProgress: isActive,
        url: automation?.platformState.currentJobUrl || null,
        tabId: automation?.platformState.currentJobTabId || null,
      },
    });
  }

  /**
   * Handle search next ready notification
   */
  async handleSearchNextReady(port, data) {
    this.log("🔄 Recruitee search ready for next job");

    this.safePortSend(port, {
      type: "NEXT_READY_ACKNOWLEDGED",
      data: { status: "success" },
    });
  }

  /**
   * Handle profile data request
   */
  async handleGetProfileData(port, data) {
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

    if (automation && automation.userProfile) {
      this.safePortSend(port, {
        type: "PROFILE_DATA",
        data: automation.userProfile,
      });
    } else {
      this.safePortSend(port, {
        type: "ERROR",
        message: "No profile data available",
      });
    }
  }

  /**
   * Override base class method to provide Recruitee-specific continuation logic
   */
  async continueOrComplete(automation, windowId, status, data) {
    if (status === "SUCCESS") {
      automation.platformState.searchData.current++;
    }

    const oldUrl = automation.platformState.currentJobUrl;

    // Recruitee-specific delay logic (shorter delays than Lever)
    const errorCount = this.logounts.get(automation.sessionId) || 0;
    const delay = status === "ERROR" ? Math.min(2000 * errorCount, 10000) : 0;

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
