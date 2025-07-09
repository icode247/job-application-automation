// background/platforms/recruitee.js
class RecruiteeAutomationHandler {
  constructor(messageHandler) {
    this.messageHandler = messageHandler;
    this.portConnections = new Map();
    this.sessionPorts = new Map();
    this.activeConnections = new Set();
    this.lastKeepalive = new Map();
    this.errorCounts = new Map();
    this.maxErrors = 5;
    this.processingMessages = new Set();
    this.processedCompletions = new Set();
    // Start cleanup process
    this.startPeriodicCleanup();
  }
  startPeriodicCleanup() {
    setInterval(() => {
      const now = Date.now();
      const staleThreshold = 120000; // 2 minutes
      // Clean up stale ports
      for (const [portName, lastSeen] of this.lastKeepalive.entries()) {
        if (now - lastSeen > staleThreshold) {
          console.log(`🧹 Cleaning up stale Recruitee port: ${portName}`);
          this.activeConnections.delete(portName);
          this.lastKeepalive.delete(portName);
        }
      }

      // Clean up old completions
      if (this.processedCompletions.size > 100) {
        const entries = Array.from(this.processedCompletions);
        this.processedCompletions = new Set(entries.slice(-50));
      }
    }, 60000);
  }
  cleanup() {
    console.log("🧹 Starting RecruiteeAutomationHandler cleanup");
    // Clear all port connections
    for (const port of this.portConnections.values()) {
      try {
        this.activeConnections.delete(port.name);
        port.disconnect();
      } catch (e) {
        // Ignore errors
      }
    }

    this.portConnections.clear();
    this.sessionPorts.clear();
    this.activeConnections.clear();
    this.lastKeepalive.clear();
    this.errorCounts.clear();
    this.processingMessages.clear();

    if (this.processedCompletions) {
      this.processedCompletions.clear();
    }

    console.log("✅ RecruiteeAutomationHandler cleanup completed");
  }
  safePortSend(port, message) {
    try {
      if (!port || !port.name || !this.activeConnections.has(port.name)) {
        console.warn(
          `⚠️ Cannot send message to disconnected/invalid Recruitee port: ${message.type}`
        );
        return false;
      }
      if (!port.sender || !port.sender.tab) {
        console.warn(
          `⚠️ Recruitee port sender no longer exists: ${message.type}`
        );
        this.activeConnections.delete(port.name);
        return false;
      }

      port.postMessage(message);
      this.lastKeepalive.set(port.name, Date.now());
      return true;
    } catch (error) {
      console.warn(
        `⚠️ Failed to send Recruitee port message (${message.type}):`,
        error.message
      );
      if (port && port.name) {
        this.activeConnections.delete(port.name);
        this.lastKeepalive.delete(port.name);
      }
      return false;
    }
  }
  handlePortConnection(port) {
    const portNameParts = port.name.split("-");
    const portType = portNameParts[1]; // 'search' or 'apply'
    const timestamp = portNameParts[2];
    const sessionId = portNameParts[3];
    const tabId = port.sender?.tab?.id;
    // Prevent duplicate connections
    if (this.activeConnections.has(port.name)) {
      console.log(
        `⚠️ Duplicate Recruitee port connection attempt: ${port.name}`
      );
      try {
        port.disconnect();
      } catch (e) {
        // Ignore errors
      }
      return;
    }

    console.log(
      `📝 Registering Recruitee ${portType} port for tab ${tabId}, session ${sessionId}`
    );

    // Clean up existing port for this tab
    if (tabId && this.portConnections.has(tabId)) {
      const existingPort = this.portConnections.get(tabId);
      this.cleanupPort(existingPort, tabId, sessionId);
    }

    // Register new port
    this.activeConnections.add(port.name);
    if (tabId) {
      this.portConnections.set(tabId, port);
    }

    // Track by session
    if (sessionId) {
      if (!this.sessionPorts.has(sessionId)) {
        this.sessionPorts.set(sessionId, new Set());
      }
      this.sessionPorts.get(sessionId).add(port);
    }

    // Set initial keepalive
    this.lastKeepalive.set(port.name, Date.now());

    // Set up message handler
    port.onMessage.addListener((message) => {
      const messageId = `${port.name}-${message.type}-${Date.now()}`;

      if (this.processingMessages.has(messageId)) {
        console.log(
          `⚠️ Duplicate Recruitee message ignored: ${message.type} from ${port.name}`
        );
        return;
      }

      this.processingMessages.add(messageId);

      try {
        this.handlePortMessage(message, port);
      } catch (error) {
        console.error(
          `❌ Error handling Recruitee message ${message.type}:`,
          error
        );
        this.safePortSend(port, {
          type: "ERROR",
          message: `Error processing ${message.type}: ${error.message}`,
        });
      } finally {
        setTimeout(() => this.processingMessages.delete(messageId), 1000);
      }
    });

    // Handle disconnection
    port.onDisconnect.addListener(() => {
      console.log(`📪 Recruitee port disconnected: ${port.name}`);
      this.cleanupPort(port, tabId, sessionId);
    });

    // Send connection confirmation
    setTimeout(() => {
      if (this.activeConnections.has(port.name)) {
        this.safePortSend(port, {
          type: "CONNECTION_ESTABLISHED",
          data: { tabId, sessionId, portType },
        });
      }
    }, 100);
  }
  cleanupPort(port, tabId, sessionId) {
    if (port && port.name) {
      this.activeConnections.delete(port.name);
      this.lastKeepalive.delete(port.name);
    }
    if (tabId) {
      this.portConnections.delete(tabId);
    }

    if (sessionId) {
      const sessionPortSet = this.sessionPorts.get(sessionId);
      if (sessionPortSet) {
        sessionPortSet.delete(port);
        if (sessionPortSet.size === 0) {
          this.sessionPorts.delete(sessionId);
        }
      }
    }
  }
  async handlePortMessage(message, port) {
    const { type, data } = message || {};
    if (!type) return;
    // Update keepalive timestamp
    this.lastKeepalive.set(port.name, Date.now());

    try {
      switch (type) {
        case "KEEPALIVE":
          await this.handleKeepalive(port, data);
          break;

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
          await this.handleApplicationCompleted(port, data);
          break;

        case "APPLICATION_ERROR":
          await this.handleApplicationError(port, data);
          break;

        case "APPLICATION_SKIPPED":
          await this.handleApplicationSkipped(port, data);
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
          console.log(`❓ Unhandled Recruitee port message type: ${type}`);
          this.safePortSend(port, {
            type: "ERROR",
            message: `Unknown message type: ${type}`,
          });
      }
    } catch (error) {
      console.error(
        `❌ Error handling Recruitee port message type ${type}:`,
        error
      );
      this.safePortSend(port, {
        type: "ERROR",
        message: `Error processing ${type}: ${error.message}`,
      });
    }
  }
  async handleKeepalive(port, data) {
    this.safePortSend(port, {
      type: "KEEPALIVE_RESPONSE",
      data: { timestamp: Date.now() },
    });
  }
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
            platformState.searchData.searchLinkPattern?.toString() ||
            "/^https:\\/\\/.*\\.recruitee\\.com\\/(o|career)\\/([^\\/]+)\\/?.*$/",
        };

        platformState.searchTabId = tabId;
        break;
      }
    }

    this.safePortSend(port, {
      type: "SEARCH_TASK_DATA",
      data: sessionData || {},
    });
  }
  async handleGetApplicationTask(port, data) {
    const tabId = port.sender?.tab?.id;
    const windowId = port.sender?.tab?.windowId;
    let sessionData = null;
    for (const [
      sessionId,
      automation,
    ] of this.messageHandler.activeAutomations.entries()) {
      if (automation.windowId === windowId) {
        sessionData = {
          devMode: automation.params?.devMode || false,
          profile: automation.userProfile,
          session: automation.sessionConfig,
          avatarUrl: automation.userProfile?.avatarUrl,
        };
        break;
      }
    }

    this.safePortSend(port, {
      type: "APPLICATION_TASK_DATA",
      data: sessionData || {},
    });
  }
  async handleStartApplication(port, data) {
    try {
      const { url, title } = data;
      const windowId = port.sender?.tab?.windowId;
      console.log(`🎯 Opening Recruitee job in new tab: ${url}`);

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
        throw new Error("No automation session found");
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
        type: "APPLICATION_STARTING",
        data: { url },
      });

      console.log(`✅ Recruitee job tab created: ${tab.id} for URL: ${url}`);
    } catch (error) {
      console.error("❌ Error handling Recruitee START_APPLICATION:", error);
      this.safePortSend(port, {
        type: "ERROR",
        message: error.message,
      });
    }
  }
  async handleApplicationCompleted(port, data) {
    try {
      const windowId = port.sender?.tab?.windowId;
      const tabId = port.sender?.tab?.id;
      console.log(
        `✅ Recruitee job application completed successfully in tab ${tabId}`
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

      if (automation) {
        const url = automation.platformState.currentJobUrl;
        if (url && automation.platformState.submittedLinks) {
          const linkIndex = automation.platformState.submittedLinks.findIndex(
            (link) =>
              this.messageHandler.normalizeUrl(link.url) ===
              this.messageHandler.normalizeUrl(url)
          );
          if (linkIndex >= 0) {
            automation.platformState.submittedLinks[linkIndex].status =
              "SUCCESS";
            automation.platformState.submittedLinks[linkIndex].details = data;
          }
        }

        // Close the job tab
        if (automation.platformState.currentJobTabId) {
          try {
            await chrome.tabs.remove(automation.platformState.currentJobTabId);
          } catch (error) {
            console.warn("⚠️ Error closing Recruitee job tab:", error);
          }
        }

        // Reset processing state
        automation.platformState.isProcessingJob = false;
        const oldUrl = automation.platformState.currentJobUrl;
        automation.platformState.currentJobUrl = null;
        automation.platformState.currentJobTabId = null;
        automation.platformState.applicationStartTime = null;

        // Increment current count
        automation.platformState.searchData.current++;

        // Notify search tab to continue
        await this.sendSearchNextMessage(windowId, {
          url: oldUrl,
          status: "SUCCESS",
          data: data,
        });
      }

      this.safePortSend(port, {
        type: "SUCCESS",
        message: "Application completed",
      });
    } catch (error) {
      console.error(
        "❌ Error handling Recruitee APPLICATION_COMPLETED:",
        error
      );
      this.safePortSend(port, {
        type: "ERROR",
        message: error.message,
      });
    }
  }
  async handleApplicationError(port, data) {
    try {
      const windowId = port.sender?.tab?.windowId;
      const tabId = port.sender?.tab?.id;
      console.log(`❌ Recruitee job application failed in tab ${tabId}:`, data);

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

      if (automation) {
        const url = automation.platformState.currentJobUrl;
        if (url && automation.platformState.submittedLinks) {
          const linkIndex = automation.platformState.submittedLinks.findIndex(
            (link) =>
              this.messageHandler.normalizeUrl(link.url) ===
              this.messageHandler.normalizeUrl(url)
          );
          if (linkIndex >= 0) {
            automation.platformState.submittedLinks[linkIndex].status = "ERROR";
            automation.platformState.submittedLinks[linkIndex].error = data;
          }
        }

        // Close the job tab
        if (automation.platformState.currentJobTabId) {
          try {
            await chrome.tabs.remove(automation.platformState.currentJobTabId);
          } catch (error) {
            console.warn("⚠️ Error closing Recruitee job tab:", error);
          }
        }

        // Reset processing state
        automation.platformState.isProcessingJob = false;
        const oldUrl = automation.platformState.currentJobUrl;
        automation.platformState.currentJobUrl = null;
        automation.platformState.currentJobTabId = null;
        automation.platformState.applicationStartTime = null;

        // Notify search tab to continue
        await this.sendSearchNextMessage(windowId, {
          url: oldUrl,
          status: "ERROR",
          message: typeof data === "string" ? data : "Application error",
        });
      }

      this.safePortSend(port, {
        type: "SUCCESS",
        message: "Error acknowledged",
      });
    } catch (error) {
      console.error("❌ Error handling Recruitee APPLICATION_ERROR:", error);
    }
  }
  async handleApplicationSkipped(port, data) {
    try {
      const windowId = port.sender?.tab?.windowId;
      const tabId = port.sender?.tab?.id;
      console.log(
        `⏭️ Recruitee job application skipped in tab ${tabId}:`,
        data
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

      if (automation) {
        const url = automation.platformState.currentJobUrl;
        if (url && automation.platformState.submittedLinks) {
          const linkIndex = automation.platformState.submittedLinks.findIndex(
            (link) =>
              this.messageHandler.normalizeUrl(link.url) ===
              this.messageHandler.normalizeUrl(url)
          );
          if (linkIndex >= 0) {
            automation.platformState.submittedLinks[linkIndex].status =
              "SKIPPED";
            automation.platformState.submittedLinks[linkIndex].reason = data;
          }
        }

        if (automation.platformState.currentJobTabId) {
          try {
            await chrome.tabs.remove(automation.platformState.currentJobTabId);
          } catch (error) {
            console.warn("⚠️ Error closing Recruitee job tab:", error);
          }
        }

        automation.platformState.isProcessingJob = false;
        const oldUrl = automation.platformState.currentJobUrl;
        automation.platformState.currentJobUrl = null;
        automation.platformState.currentJobTabId = null;
        automation.platformState.applicationStartTime = null;

        await this.sendSearchNextMessage(windowId, {
          url: oldUrl,
          status: "SKIPPED",
          message: data,
        });
      }

      this.safePortSend(port, {
        type: "SUCCESS",
        message: "Skip acknowledged",
      });
    } catch (error) {
      console.error("❌ Error handling Recruitee APPLICATION_SKIPPED:", error);
    }
  }
  async handleSearchCompleted(port, data) {
    const windowId = port.sender?.tab?.windowId;
    console.log(`🏁 Recruitee search task completed for window ${windowId}`);

    try {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "Recruitee Job Search Completed",
        message: "All job applications have been processed.",
      });
    } catch (error) {
      console.warn("⚠️ Error showing notification:", error);
    }

    this.safePortSend(port, {
      type: "SUCCESS",
      message: "Search completion acknowledged",
    });
  }
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
  async handleSearchNextReady(port, data) {
    console.log("🔄 Recruitee search ready for next job");
    this.safePortSend(port, {
      type: "NEXT_READY_ACKNOWLEDGED",
      data: { status: "success" },
    });
  }
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
  async sendSearchNextMessage(windowId, data) {
    try {
      console.log(
        `📤 Sending SEARCH_NEXT message to Recruitee window ${windowId}:`,
        data
      );
      const tabs = await chrome.tabs.query({ windowId: windowId });

      for (const tab of tabs) {
        if (tab.url && tab.url.includes("google.com/search")) {
          // Try port first
          const port = this.portConnections.get(tab.id);
          if (port && this.activeConnections.has(port.name)) {
            try {
              this.safePortSend(port, {
                type: "SEARCH_NEXT",
                data: data,
              });
              console.log(
                `✅ Sent SEARCH_NEXT via port to Recruitee tab ${tab.id}`
              );
              return true;
            } catch (error) {
              console.warn(
                "⚠️ Recruitee port message failed, trying tabs API:",
                error
              );
            }
          }

          // Fallback to tabs API
          try {
            await chrome.tabs.sendMessage(tab.id, {
              type: "SEARCH_NEXT",
              data: data,
            });
            console.log(
              `✅ Sent SEARCH_NEXT via tabs API to Recruitee tab ${tab.id}`
            );
            return true;
          } catch (error) {
            console.warn("⚠️ Recruitee tabs API message failed:", error);
          }
        }
      }

      console.warn(
        "⚠️ Could not find Recruitee search tab to send SEARCH_NEXT message"
      );
      return false;
    } catch (error) {
      console.error("❌ Error sending Recruitee SEARCH_NEXT message:", error);
      return false;
    }
  }
}
export default RecruiteeAutomationHandler;
