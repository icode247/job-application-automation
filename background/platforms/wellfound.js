import BaseBackgroundHandler from "../../shared/base/base-background-handler.js";

export default class WellfoundAutomationHandler extends BaseBackgroundHandler {
  constructor(messageHandler) {
    const devMode = messageHandler.devMode;
    super(messageHandler, "wellfound", devMode);

    this.platformConfig = {
      domains: ["https://wellfound.com"],
      searchLinkPattern: /^https:\/\/wellfound\.com\/jobs\/(\d+)/,
      jobsPagePattern: /^https:\/\/wellfound\.com\/jobs(\?.*)?$/,
    };

    this.applicationTimeouts = new Map();
    this.processedCompletions = new Set();

    this.log("🚀 WellfoundAutomationHandler initialized");
  }

  async handlePlatformSpecificMessage(type, data, port) {
    const sessionId = this.getSessionIdFromPort(port);
    const windowId = port.sender?.tab?.windowId;
    const tabId = port.sender?.tab?.id;

    this.log(
      `📨 Handling Wellfound message: ${type} for session ${sessionId}, tab ${tabId}`
    );

    try {
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
          this.log(`❓ Unknown Wellfound message type: ${type}`);
          this.safePortSend(port, {
            type: "ERROR",
            message: `Unknown message type: ${type}`,
          });
      }
    } catch (error) {
      this.log(`❌ Error handling message ${type}:`, error);
      this.safePortSend(port, {
        type: "ERROR",
        message: `Error handling ${type}: ${error.message}`,
      });
    }
  }

  async handleGetSearchTask(port, data) {
    const tabId = port.sender?.tab?.id;
    const windowId = port.sender?.tab?.windowId;

    this.log(
      `🔍 GET_SEARCH_TASK request from Wellfound tab ${tabId}, window ${windowId}`
    );

    let sessionData = null;
    let automation = null;

    for (const [sessionId, auto] of this.messageHandler.activeAutomations.entries()) {
      if (auto.windowId === windowId) {
        automation = auto;
        this.log(`✅ Found Wellfound automation session: ${sessionId}`);
        break;
      }
    }

    if (automation) {
      const platformState = automation.platformState;

      let searchLinkPatternString = "";
      try {
        if (platformState.searchData?.searchLinkPattern) {
          searchLinkPatternString = platformState.searchData.searchLinkPattern.toString();
        } else {
          searchLinkPatternString = this.platformConfig.searchLinkPattern.toString();
        }
      } catch (error) {
        this.log("❌ Error converting searchLinkPattern to string:", error);
        searchLinkPatternString = this.platformConfig.searchLinkPattern.toString();
      }

      sessionData = {
        tabId: tabId,
        limit: platformState.searchData?.limit || 10,
        current: platformState.searchData?.current || 0,
        domain: platformState.searchData?.domain || this.platformConfig.domains,
        submittedLinks: platformState.submittedLinks || [],
        searchLinkPattern: searchLinkPatternString,
        profile: automation.userProfile || null,
      };

      platformState.searchTabId = tabId;
      automation.searchTabId = tabId;

      this.log(`📊 Wellfound session data prepared:`, sessionData);
      this.log(`📌 Search tab ID stored: ${tabId}`);
    } else {
      this.log(`⚠️ No Wellfound automation found for window ${windowId}`);

      sessionData = {
        tabId: tabId,
        limit: 10,
        current: 0,
        domain: this.platformConfig.domains,
        submittedLinks: [],
        searchLinkPattern: this.platformConfig.searchLinkPattern.toString(),
        profile: null,
      };
    }

    const sent = this.safePortSend(port, {
      type: "SEARCH_TASK_DATA",
      data: sessionData,
    });

    if (!sent) {
      this.log(`❌ Failed to send Wellfound search task data to port ${port.name}`);
    } else {
      this.log(`✅ Wellfound search task data sent successfully to tab ${tabId}`);
    }
  }

  async handleGetSendCvTask(port, data) {
    const tabId = port.sender?.tab?.id;
    const windowId = port.sender?.tab?.windowId;

    this.log(`🔍 GET_SEND_CV_TASK request from Wellfound tab ${tabId}, window ${windowId}`);

    let sessionData = null;
    let automation = null;

    for (const [sessionId, auto] of this.messageHandler.activeAutomations.entries()) {
      if (auto.windowId === windowId) {
        automation = auto;
        this.log(`✅ Found Wellfound automation session: ${sessionId}`);
        break;
      }
    }

    if (automation) {
      let userProfile = automation.userProfile;

      if (!userProfile && automation.userId) {
        try {
          this.log(`📡 Fetching user profile for Wellfound user ${automation.userId}`);
          const { default: UserService } = await import("../../services/user-service.js");
          const userService = new UserService({ userId: automation.userId });
          userProfile = await userService.getUserDetails();

          automation.userProfile = userProfile;
          this.log(`✅ User profile fetched and cached for Wellfound`);
        } catch (error) {
          this.log(`❌ Failed to fetch user profile for Wellfound:`, error);
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

      this.log(`📊 Wellfound session data prepared:`, {
        hasProfile: !!sessionData.profile,
        hasSession: !!sessionData.session,
        userId: sessionData.userId,
        devMode: sessionData.devMode,
      });
    } else {
      this.log(`⚠️ No Wellfound automation found for window ${windowId}`);

      sessionData = {
        devMode: false,
        profile: null,
        session: null,
        avatarUrl: null,
        userId: null,
        sessionId: null,
      };
    }

    const sent = this.safePortSend(port, {
      type: "APPLICATION_TASK_DATA",
      data: sessionData,
    });

    if (!sent) {
      this.log(`❌ Failed to send Wellfound CV task data to port ${port.name}`);
    } else {
      this.log(`✅ Wellfound CV task data sent successfully to tab ${tabId}`);
    }
  }

  async handleStartApplication(port, data, sessionId, windowId, tabId) {
    try {
      const { url, title, location, compensation } = data || {};

      if (!url) {
        throw new Error("No URL provided for application");
      }

      this.log(`🎯 Starting Wellfound application for: ${title} (${url}) in tab ${tabId}`);

      let automation = null;
      for (const [sid, auto] of this.messageHandler.activeAutomations.entries()) {
        if (auto.windowId === windowId) {
          automation = auto;
          break;
        }
      }

      if (!automation) {
        throw new Error(`No automation found for window ${windowId}`);
      }

      if (!automation.platformState) {
        automation.platformState = {
          submittedLinks: [],
          isProcessingJob: false,
          currentJobUrl: null,
          currentJobTabId: null,
          applicationStartTime: null,
          searchData: { current: 0, limit: 10 },
        };
      }

      if (automation.platformState.isProcessingJob) {
        this.log(`⚠️ Wellfound automation already processing job, ignoring duplicate request`);
        this.safePortSend(port, {
          type: "DUPLICATE",
          message: "Already processing a job application",
        });
        return;
      }

      if (!this.isValidWellfoundJobUrl(url)) {
        throw new Error(`Invalid Wellfound job URL: ${url}`);
      }

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

      automation.platformState.isProcessingJob = true;
      automation.platformState.currentJobUrl = url;
      automation.platformState.applicationStartTime = Date.now();

      const timeoutId = setTimeout(() => {
        this.log(`⏰ Wellfound application timeout for ${url}`);
        this.handleApplicationTimeout(automation, url, tabId);
      }, 300000);

      this.applicationTimeouts.set(url, timeoutId);

      const jobTab = await chrome.tabs.create({
        url: url,
        windowId: windowId,
        active: false,
      });

      automation.platformState.currentJobTabId = jobTab.id;

      this.log(`✅ Created Wellfound job tab ${jobTab.id} for ${url} in window ${windowId}`);

      this.safePortSend(port, {
        type: "APPLICATION_STARTING",
        data: { url, tabId: jobTab.id, title, location, compensation },
      });

      if (this.messageHandler.sessionManager) {
        await this.messageHandler.sessionManager.addNotification(sessionId, {
          type: "application_started",
          jobUrl: url,
          jobTitle: title,
          tabId: jobTab.id,
        });
      }
    } catch (error) {
      this.log(`❌ Error starting Wellfound application:`, error);

      this.safePortSend(port, {
        type: "ERROR",
        message: `Failed to start application: ${error.message}`,
        data: { url: data?.url },
      });

      const automation = this.findAutomationByWindow(windowId);
      if (automation && automation.platformState) {
        automation.platformState.isProcessingJob = false;
        automation.platformState.currentJobUrl = null;
        automation.platformState.applicationStartTime = null;
      }
    }
  }

  async handleApplicationTimeout(automation, url, tabId) {
    try {
      this.log(`⏰ Wellfound application timeout for ${url} in tab ${tabId}`);

      if (this.applicationTimeouts.has(url)) {
        clearTimeout(this.applicationTimeouts.get(url));
        this.applicationTimeouts.delete(url);
      }

      if (tabId) {
        try {
          await chrome.tabs.remove(tabId);
        } catch (error) {
          this.log(`⚠️ Error closing timeout tab ${tabId}:`, error);
        }
      }

      automation.platformState.isProcessingJob = false;
      automation.platformState.currentJobUrl = null;
      automation.platformState.currentJobTabId = null;
      automation.platformState.applicationStartTime = null;

      automation.platformState.submittedLinks.push({
        url,
        status: "TIMEOUT",
        message: "Application timed out after 5 minutes",
        timestamp: Date.now(),
      });

      await this.sendSearchNextMessage(automation, {
        url,
        status: "TIMEOUT",
        message: "Application timed out",
      });
    } catch (error) {
      this.log(`❌ Error handling Wellfound application timeout:`, error);
    }
  }

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
        isProcessingJob: automation.platformState?.isProcessingJob || false,
        currentJobUrl: automation.platformState?.currentJobUrl || null,
        applicationStartTime: automation.platformState?.applicationStartTime || null,
        currentJobTabId: automation.platformState?.currentJobTabId || null,
      };

      this.safePortSend(port, {
        type: "APPLICATION_STATUS",
        data: status,
      });
    } catch (error) {
      this.log(`❌ Error checking Wellfound application status:`, error);
      this.safePortSend(port, {
        type: "ERROR",
        message: "Failed to check application status",
      });
    }
  }

  async handleSearchNextReady(port, sessionId) {
    this.log(`📋 Wellfound search ready for session ${sessionId}`);
    this.safePortSend(port, {
      type: "SUCCESS",
      message: "Search next ready acknowledged",
    });
  }

  async handleSearchCompleted(port, sessionId, windowId) {
    try {
      this.log(`🏁 Wellfound search completed for session ${sessionId}`);

      const automation = this.findAutomationBySession(sessionId);
      if (automation) {
        automation.status = "completed";
        automation.endTime = Date.now();

        if (this.messageHandler.sessionManager) {
          await this.messageHandler.sessionManager.updateSession(sessionId, {
            status: "completed",
            completedAt: Date.now(),
          });

          await this.messageHandler.sessionManager.addNotification(sessionId, {
            type: "automation_completed",
            completedJobs: automation.platformState?.submittedLinks?.length || 0,
            totalTime: Date.now() - automation.startTime,
          });
        }
      }

      this.safePortSend(port, {
        type: "SUCCESS",
        message: "Search completion acknowledged",
      });
    } catch (error) {
      this.log(`❌ Error handling Wellfound search completion:`, error);
      this.safePortSend(port, {
        type: "ERROR",
        message: "Failed to handle search completion",
      });
    }
  }

  async handleTaskCompletion(port, data, status) {
    try {
      this.log(`🏁 Handling Wellfound task completion: ${status}`, data);

      const tabId = port.sender?.tab?.id;
      const windowId = port.sender?.tab?.windowId;

      if (data?.url && this.applicationTimeouts.has(data.url)) {
        clearTimeout(this.applicationTimeouts.get(data.url));
        this.applicationTimeouts.delete(data.url);
      }

      if (tabId) {
        try {
          await chrome.tabs.remove(tabId);
          this.log(`✅ Closed Wellfound application tab ${tabId}`);
        } catch (error) {
          this.log(`⚠️ Error closing application tab ${tabId}:`, error);
        }
      }

      const automation = this.findAutomationByWindow(windowId);
      if (!automation) {
        this.log(`❌ No automation found for window ${windowId}`);
        return;
      }

      if (!automation.platformState) {
        automation.platformState = {
          submittedLinks: [],
          isProcessingJob: false,
          currentJobUrl: null,
          currentJobTabId: null,
          applicationStartTime: null,
          searchData: { current: 0, limit: 10 },
        };
      }

      const jobUrl = automation.platformState.currentJobUrl || data?.jobUrl || data?.url;

      if (jobUrl) {
        const submissionRecord = {
          url: jobUrl,
          status: status,
          message: data?.message || `Application ${status.toLowerCase()}`,
          timestamp: Date.now(),
          ...(data || {}),
        };

        automation.platformState.submittedLinks.push(submissionRecord);
        this.log(`📊 Added submission record:`, submissionRecord);
      }

      automation.platformState.isProcessingJob = false;
      automation.platformState.currentJobUrl = null;
      automation.platformState.currentJobTabId = null;
      automation.platformState.applicationStartTime = null;

      await this.sendSearchNextMessage(automation, {
        url: jobUrl,
        status: status,
        data: data,
        message: data?.message || `Application ${status.toLowerCase()}`,
      });

    } catch (error) {
      this.log(`❌ Error handling Wellfound task completion:`, error);
    }
  }

  async sendSearchNextMessage(automation, completionData) {
    try {
      if (completionData.status === "SUCCESS") {
        automation.platformState.searchData.current =
          (automation.platformState.searchData.current || 0) + 1;
      }

      const searchTabId = automation.searchTabId || automation.platformState?.searchTabId;

      if (!searchTabId) {
        this.log(`❌ No search tab ID available for automation`);
        return;
      }

      const messageData = {
        url: completionData.url,
        status: completionData.status,
        data: completionData.data,
        message: completionData.message,
        submittedLinks: automation.platformState.submittedLinks || [],
        current: automation.platformState.searchData.current || 0,
      };

      this.log(`📤 Sending SEARCH_NEXT to tab ${searchTabId}:`, messageData);

      try {
        await chrome.tabs.sendMessage(searchTabId, {
          action: "platformMessage",
          type: "SEARCH_NEXT",
          data: messageData,
        });
        this.log(`✅ Successfully sent SEARCH_NEXT to search tab ${searchTabId}`);
      } catch (messageError) {
        this.log(`❌ Failed to send SEARCH_NEXT to tab ${searchTabId}:`, messageError);

        try {
          const tab = await chrome.tabs.get(searchTabId);
          if (tab && tab.url && tab.url.includes('wellfound.com/jobs')) {
            this.log(`🔄 Search tab exists, retrying message...`);
            setTimeout(async () => {
              try {
                await chrome.tabs.sendMessage(searchTabId, {
                  action: "platformMessage",
                  type: "SEARCH_NEXT",
                  data: messageData,
                });
                this.log(`✅ Retry successful for tab ${searchTabId}`);
              } catch (retryError) {
                this.log(`❌ Retry failed for tab ${searchTabId}:`, retryError);
              }
            }, 2000);
          }
        } catch (tabError) {
          this.log(`❌ Search tab ${searchTabId} no longer exists:`, tabError);
        }
      }

    } catch (error) {
      this.log(`❌ Error sending search next message:`, error);
    }
  }

  isValidWellfoundJobUrl(url) {
    try {
      if (!url) return false;
      if (!url.includes("wellfound.com")) return false;
      return this.platformConfig.searchLinkPattern.test(url);
    } catch (error) {
      this.log("Error validating Wellfound URL:", error);
      return false;
    }
  }

  findAutomationBySession(sessionId) {
    return this.messageHandler.activeAutomations.get(sessionId);
  }

  findAutomationByWindow(windowId) {
    for (const automation of this.messageHandler.activeAutomations.values()) {
      if (automation.windowId === windowId) {
        return automation;
      }
    }
    return null;
  }

  async continueOrComplete(automation, windowId, status, data) {
    this.log(`🔄 Continue or complete called with status: ${status}`);

    await this.sendSearchNextMessage(automation, {
      url: automation.platformState?.currentJobUrl || data?.url,
      status: status,
      data: data,
      message: typeof data === "string" ? data :
        status === "ERROR" ? "Application error" :
          `Application ${status.toLowerCase()}`,
    });
  }

  cleanup() {
    this.log("🧹 Starting WellfoundAutomationHandler cleanup");

    for (const timeoutId of this.applicationTimeouts.values()) {
      clearTimeout(timeoutId);
    }
    this.applicationTimeouts.clear();

    this.processedCompletions.clear();

    if (super.cleanup) {
      super.cleanup();
    }

    this.log("✅ WellfoundAutomationHandler cleanup completed");
  }

  log(message, data = null) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [WellfoundHandler] ${message}`;

    if (data) {
      console.log(logMessage, data);
    } else {
      console.log(logMessage);
    }
  }

  safePortSend(port, message) {
    try {
      if (port && port.postMessage && !port.disconnected) {
        port.postMessage(message);
        return true;
      } else {
        this.log("❌ Port not available or disconnected for message:", message);
        return false;
      }
    } catch (error) {
      this.log("❌ Error sending port message:", error);
      return false;
    }
  }

  getSessionIdFromPort(port) {
    return port.name || 'unknown-session';
  }
}