// Platform-specific automation handlers
class LeverAutomationHandler {
  constructor(messageHandler) {
    this.messageHandler = messageHandler;
    this.portConnections = new Map();
    this.sessionPorts = new Map();
    this.activeConnections = new Set();
    this.lastKeepalive = new Map();
    this.errorCounts = new Map();
    this.maxErrors = 3;
    this.processingMessages = new Set();
  }

  startPeriodicCleanup() {
    setInterval(() => {
      const now = Date.now();
      const staleThreshold = 120000; // 2 minutes

      // Clean up stale keepalive entries
      for (const [portName, lastSeen] of this.lastKeepalive.entries()) {
        if (now - lastSeen > staleThreshold) {
          console.log(`🧹 Cleaning up stale port: ${portName}`);
          this.lastKeepalive.delete(portName);
          this.activeConnections.delete(portName);

          // Find and disconnect the port
          for (const [tabId, port] of this.portConnections.entries()) {
            if (port.name === portName) {
              try {
                port.disconnect();
              } catch (e) {
                // Ignore
              }
              this.portConnections.delete(tabId);
              break;
            }
          }
        }
      }

      // Clean up old processed completions
      if (this.processedCompletions && this.processedCompletions.size > 100) {
        const entries = Array.from(this.processedCompletions);
        this.processedCompletions = new Set(entries.slice(-50));
      }
    }, 60000); // Run every minute
  }

  cleanup() {
    console.log("🧹 Starting LeverAutomationHandler cleanup");

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

    console.log("✅ LeverAutomationHandler cleanup completed");
  }

  safePortSend(port, message) {
    try {
      if (port && port.sender && this.isPortAlive(port)) {
        port.postMessage(message);
        return true;
      } else {
        console.warn(
          "⚠️ Cannot send message to disconnected/invalid port:",
          message.type
        );
        return false;
      }
    } catch (error) {
      console.warn("⚠️ Failed to send port message:", error);
      // Clean up the port if it's dead
      if (port) {
        this.activeConnections.delete(port.name);
      }
      return false;
    }
  }

  isPortAlive(port) {
    try {
      // Check if port is still connected and hasn't been cleaned up
      return (
        port &&
        port.sender &&
        !chrome.runtime.lastError &&
        this.activeConnections.has(port.name)
      );
    } catch (error) {
      return false;
    }
  }

  async sendSearchNextMessage(windowId, data, retryCount = 0) {
    const maxRetries = 1; // Reduced retries

    try {
      console.log(
        `📤 Sending SEARCH_NEXT message to Lever window ${windowId}:`,
        data
      );

      const tabs = await chrome.tabs.query({ windowId: windowId });

      for (const tab of tabs) {
        if (tab.url && tab.url.includes("google.com/search")) {
          // Try port first
          const port = this.portConnections.get(tab.id);
          if (port && this.isPortAlive(port)) {
            try {
              this.safePortSend(port, {
                type: "SEARCH_NEXT",
                data: data,
              });
              console.log(
                `✅ Sent SEARCH_NEXT via port to Lever tab ${tab.id}`
              );
              return true;
            } catch (error) {
              console.warn("⚠️ Port message failed, trying tabs API:", error);
            }
          }

          // Fallback to tabs API
          try {
            await chrome.tabs.sendMessage(tab.id, {
              type: "SEARCH_NEXT",
              data: data,
            });
            console.log(
              `✅ Sent SEARCH_NEXT via tabs API to Lever tab ${tab.id}`
            );
            return true;
          } catch (error) {
            console.warn("⚠️ Tabs API message failed:", error);
            if (retryCount < maxRetries) {
              // Retry after delay
              setTimeout(() => {
                this.sendSearchNextMessage(windowId, data, retryCount + 1);
              }, 3000 * (retryCount + 1));
              return true;
            }
          }
        }
      }

      console.warn(
        "⚠️ Could not find Lever search tab to send SEARCH_NEXT message"
      );
      return false;
    } catch (error) {
      console.error("❌ Error sending Lever SEARCH_NEXT message:", error);
      return false;
    }
  }
  getSessionIdFromPort(port) {
    // Try to extract session ID from port name or find it from active automations
    const portName = port.name;
    const sessionFromName = this.extractSessionFromPortName(portName);
    if (sessionFromName) return sessionFromName;

    // Fallback: look up by window ID
    const windowId = port.sender?.tab?.windowId;
    if (windowId) {
      for (const [
        sessionId,
        automation,
      ] of this.messageHandler.activeAutomations.entries()) {
        if (automation.windowId === windowId) {
          return sessionId;
        }
      }
    }

    return null;
  }

  async handleSendCvTaskError(port, data) {
    try {
      const windowId = port.sender?.tab?.windowId;
      const tabId = port.sender?.tab?.id;
      const sessionId = this.getSessionIdFromPort(port);

      console.log(`❌ Lever job application failed in tab ${tabId}:`, data);

      // FIXED: Check for completion ID to prevent duplicate processing
      if (data && data.completionId) {
        const completionKey = `${sessionId}-${data.completionId}`;
        if (
          this.processedCompletions &&
          this.processedCompletions.has(completionKey)
        ) {
          console.log(
            `⚠️ Completion ${data.completionId} already processed, ignoring`
          );
          return;
        }

        if (!this.processedCompletions) {
          this.processedCompletions = new Set();
        }
        this.processedCompletions.add(completionKey);

        // Clean up old completions (keep only last 50)
        if (this.processedCompletions.size > 50) {
          const entries = Array.from(this.processedCompletions);
          this.processedCompletions = new Set(entries.slice(-50));
        }
      }

      // Increment error count with session-based tracking
      const errorCount = (this.errorCounts.get(sessionId) || 0) + 1;
      this.errorCounts.set(sessionId, errorCount);

      // Check if too many errors for this session
      if (errorCount >= this.maxErrors) {
        console.error(
          `🚨 Too many errors (${errorCount}) for session ${sessionId}, stopping automation`
        );
        this.safePortSend(port, {
          type: "AUTOMATION_STOPPED",
          message: `Too many errors (${errorCount}), automation stopped`,
        });

        // Clean up this session's error count
        this.errorCounts.delete(sessionId);
        return;
      }

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

        // Close job tab if it exists
        if (automation.platformState.currentJobTabId) {
          try {
            await chrome.tabs.remove(automation.platformState.currentJobTabId);
          } catch (error) {
            console.warn("⚠️ Error closing job tab:", error);
          }
        }

        // Reset processing state
        automation.platformState.isProcessingJob = false;
        const oldUrl = automation.platformState.currentJobUrl;
        automation.platformState.currentJobUrl = null;
        automation.platformState.currentJobTabId = null;
        automation.platformState.applicationStartTime = null;

        // Send search next with exponential backoff delay
        if (errorCount < this.maxErrors) {
          const delay = Math.min(2000 * errorCount, 10000); // Max 10 second delay
          console.log(
            `⏳ Waiting ${delay}ms before continuing due to error (count: ${errorCount})`
          );

          setTimeout(async () => {
            await this.sendSearchNextMessage(windowId, {
              url: oldUrl,
              status: "ERROR",
              message: typeof data === "string" ? data : "Application error",
              errorCount: errorCount,
            });
          }, delay);
        }
      }

      this.safePortSend(port, {
        type: "SUCCESS",
        message: "Error acknowledged",
      });
    } catch (error) {
      console.error("❌ Error handling Lever SEND_CV_TASK_ERROR:", error);
      // Don't send another error response to avoid recursion
    }
  }

  async handleKeepalive(port, data) {
    // Simply respond to keepalive
    this.safePortSend(port, {
      type: "KEEPALIVE_RESPONSE",
      data: { timestamp: Date.now() },
    });
  }

  cleanupPort(port, tabId, sessionId) {
    // Remove from active connections
    this.activeConnections.delete(port.name);

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

    this.lastKeepalive.delete(port.name);
  }

  cleanupPortsForTab(tabId) {
    const existingPort = this.portConnections.get(tabId);
    if (existingPort) {
      console.log(`🧹 Cleaning up existing port for tab ${tabId}`);

      // Remove from active connections
      this.activeConnections.delete(existingPort.name);

      try {
        existingPort.disconnect();
      } catch (e) {
        // Ignore errors when disconnecting
      }
      this.portConnections.delete(tabId);
    }
  }

  extractSessionFromPortName(portName) {
    // Extract session from port name like "lever-apply-123456-abc123"
    const parts = portName.split("-");
    return parts.length > 3 ? parts[3] : null;
  }
  handlePortConnection(port) {
    const portNameParts = port.name.split("-");
    const portType = portNameParts[1]; // 'search' or 'apply'
    const tabId = parseInt(portNameParts[2]) || port.sender?.tab?.id;
    const sessionId = this.extractSessionFromPortName(port.name);

    // FIXED: Prevent duplicate connections
    if (this.activeConnections.has(port.name)) {
      console.log(
        `⚠️ Port ${port.name} already exists, ignoring duplicate connection`
      );
      try {
        port.disconnect();
      } catch (e) {
        // Ignore errors
      }
      return;
    }

    // FIXED: Clean up existing connections for this tab before creating new one
    if (tabId) {
      this.cleanupPortsForTab(tabId);
    }

    console.log(
      `📝 Registering Lever ${portType} port for tab ${tabId}, session ${sessionId}`
    );

    // Mark connection as active
    this.activeConnections.add(port.name);

    if (tabId) {
      this.portConnections.set(tabId, port);

      // Track by session
      if (sessionId) {
        if (!this.sessionPorts.has(sessionId)) {
          this.sessionPorts.set(sessionId, new Set());
        }
        this.sessionPorts.get(sessionId).add(port);
      }
    }

    // Set initial keepalive
    this.lastKeepalive.set(port.name, Date.now());

    // FIXED: Add error handling to message listener
    port.onMessage.addListener((message) => {
      // Prevent duplicate message processing
      const messageId = `${port.name}-${message.type}-${Date.now()}`;
      if (this.processingMessages.has(messageId)) {
        console.log(
          `⚠️ Duplicate message ${message.type} from ${port.name}, ignoring`
        );
        return;
      }

      this.processingMessages.add(messageId);

      try {
        this.handlePortMessage(message, port);
      } catch (error) {
        console.error(
          `❌ Error handling message ${message.type} from ${port.name}:`,
          error
        );
      } finally {
        // Clean up after processing
        setTimeout(() => {
          this.processingMessages.delete(messageId);
        }, 1000);
      }
    });

    port.onDisconnect.addListener(() => {
      console.log("📪 Lever port disconnected:", port.name);
      this.cleanupPort(port, tabId, sessionId);
    });

    // Send initial connection confirmation
    this.safePortSend(port, {
      type: "CONNECTION_ESTABLISHED",
      data: { tabId, sessionId, portType },
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
            platformState.searchData.searchLinkPattern.toString(),
        };

        // Update search tab ID
        platformState.searchTabId = tabId;
        break;
      }
    }

    this.messageHandler.sendPortResponse(port, {
      type: "SUCCESS",
      data: sessionData || {},
    });
  }

  async handleGetSendCvTask(port, data) {
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

    this.messageHandler.sendPortResponse(port, {
      type: "SUCCESS",
      data: sessionData || {},
    });
  }

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
        throw new Error("No automation session found");
      }

      if (automation.platformState.isProcessingJob) {
        this.messageHandler.sendPortResponse(port, {
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
        this.messageHandler.sendPortResponse(port, {
          type: "DUPLICATE",
          message: "This job has already been processed",
          data: { url },
        });
        return;
      }

      // Create new tab for job application
      const tab = await chrome.tabs.create({
        url: url.endsWith("/apply") ? url : url + "/apply",
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

      this.messageHandler.sendPortResponse(port, {
        type: "SUCCESS",
        message: "Apply tab will be created",
      });

      console.log(`✅ Lever job tab created: ${tab.id} for URL: ${url}`);
    } catch (error) {
      console.error("❌ Error handling Lever SEND_CV_TASK:", error);
      this.messageHandler.sendPortResponse(port, {
        type: "ERROR",
        message: error.message,
      });
    }
  }

  async handleSendCvTaskDone(port, data) {
    try {
      const windowId = port.sender?.tab?.windowId;
      const tabId = port.sender?.tab?.id;

      console.log(
        `✅ Lever job application completed successfully in tab ${tabId}`
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
            console.warn("⚠️ Error closing job tab:", error);
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

      this.messageHandler.sendPortResponse(port, {
        type: "SUCCESS",
        message: "Application completed",
      });
    } catch (error) {
      console.error("❌ Error handling Lever SEND_CV_TASK_DONE:", error);
      this.messageHandler.sendPortResponse(port, {
        type: "ERROR",
        message: error.message,
      });
    }
  }

  async handleSendCvTaskSkip(port, data) {
    try {
      const windowId = port.sender?.tab?.windowId;
      const tabId = port.sender?.tab?.id;

      console.log(`⏭️ Lever job application skipped in tab ${tabId}:`, data);

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
            console.warn("⚠️ Error closing job tab:", error);
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

      this.messageHandler.sendPortResponse(port, {
        type: "SUCCESS",
        message: "Skip acknowledged",
      });
    } catch (error) {
      console.error("❌ Error handling Lever SEND_CV_TASK_SKIP:", error);
    }
  }

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

    this.messageHandler.sendPortResponse(port, {
      type: "APPLICATION_STATUS_RESPONSE",
      data: {
        active: isActive,
        url: automation?.platformState.currentJobUrl || null,
        tabId: automation?.platformState.currentJobTabId || null,
      },
    });
  }

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

    this.messageHandler.sendPortResponse(port, {
      type: "JOB_TAB_STATUS",
      data: {
        isOpen: isOpen,
        tabId: automation?.platformState.currentJobTabId || null,
        isProcessing: isOpen,
      },
    });
  }

  async handleSearchNextReady(port, data) {
    console.log("🔄 Lever search ready for next job");

    this.messageHandler.sendPortResponse(port, {
      type: "NEXT_READY_ACKNOWLEDGED",
      data: { status: "success" },
    });
  }

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

    this.messageHandler.sendPortResponse(port, {
      type: "SUCCESS",
      message: "Search completion acknowledged",
    });
  }

  handlePortConnection(port) {
    const portNameParts = port.name.split("-");
    const portType = portNameParts[1]; // 'search' or 'apply'
    const tabId = parseInt(portNameParts[2]) || port.sender?.tab?.id;
    const sessionId = this.extractSessionFromPortName(port.name);

    console.log(
      `📝 Registering Lever ${portType} port for tab ${tabId}, session ${sessionId}`
    );

    // Clean up existing ports for this tab
    this.cleanupPortsForTab(tabId);

    if (tabId) {
      this.portConnections.set(tabId, port);

      // Track by session
      if (sessionId) {
        if (!this.sessionPorts.has(sessionId)) {
          this.sessionPorts.set(sessionId, new Set());
        }
        this.sessionPorts.get(sessionId).add(port);
      }
    }

    // Set initial keepalive
    this.lastKeepalive.set(port.name, Date.now());

    port.onMessage.addListener((message) => {
      this.handlePortMessage(message, port);
    });

    port.onDisconnect.addListener(() => {
      console.log("📪 Lever port disconnected:", port.name);
      this.cleanupPort(port, tabId, sessionId);
    });

    // Send initial connection confirmation
    this.safePortSend(port, {
      type: "CONNECTION_ESTABLISHED",
      data: { tabId, sessionId, portType },
    });
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

        case "GET_SEND_CV_TASK":
          await this.handleGetSendCvTask(port, data);
          break;

        case "SEND_CV_TASK":
          await this.handleSendCvTask(port, data);
          break;

        case "SEND_CV_TASK_DONE":
          await this.handleSendCvTaskDone(port, data);
          break;

        case "SEND_CV_TASK_ERROR":
          await this.handleSendCvTaskError(port, data);
          break;

        case "SEND_CV_TASK_SKIP":
          await this.handleSendCvTaskSkip(port, data);
          break;

        case "SEARCH_TASK_DONE":
          await this.handleSearchTaskDone(port, data);
          break;

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
          console.log(`❓ Unhandled Lever port message type: ${type}`);
          this.safePortSend(port, {
            type: "ERROR",
            message: `Unknown message type: ${type}`,
          });
      }
    } catch (error) {
      console.error(
        `❌ Error handling Lever port message type ${type}:`,
        error
      );
      this.safePortSend(port, {
        type: "ERROR",
        message: `Error processing ${type}: ${error.message}`,
      });
    }
  }

  async handleSendCvTaskError(port, data) {
    try {
      const windowId = port.sender?.tab?.windowId;
      const tabId = port.sender?.tab?.id;
      const sessionId = this.getSessionIdFromPort(port);

      console.log(`❌ Lever job application failed in tab ${tabId}:`, data);

      // Increment error count
      const errorCount = (this.errorCounts.get(sessionId) || 0) + 1;
      this.errorCounts.set(sessionId, errorCount);

      // Check if too many errors
      if (errorCount >= this.maxErrors) {
        console.error(
          `🚨 Too many errors (${errorCount}) for session ${sessionId}, stopping automation`
        );
        this.safePortSend(port, {
          type: "AUTOMATION_STOPPED",
          message: "Too many errors, automation stopped",
        });
        return;
      }

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

        // Close job tab if it exists
        if (automation.platformState.currentJobTabId) {
          try {
            await chrome.tabs.remove(automation.platformState.currentJobTabId);
          } catch (error) {
            console.warn("⚠️ Error closing job tab:", error);
          }
        }

        // Reset processing state
        automation.platformState.isProcessingJob = false;
        const oldUrl = automation.platformState.currentJobUrl;
        automation.platformState.currentJobUrl = null;
        automation.platformState.currentJobTabId = null;
        automation.platformState.applicationStartTime = null;

        // Only send search next if error count is not too high
        if (errorCount < this.maxErrors) {
          // Add delay to prevent rapid fire errors
          const delay = Math.min(5000 * errorCount, 30000); // Increasing delay up to 30s
          setTimeout(async () => {
            await this.sendSearchNextMessage(windowId, {
              url: oldUrl,
              status: "ERROR",
              message: typeof data === "string" ? data : "Application error",
              errorCount: errorCount,
            });
          }, delay);
        }
      }

      this.safePortSend(port, {
        type: "SUCCESS",
        message: "Error acknowledged",
      });
    } catch (error) {
      console.error("❌ Error handling Lever SEND_CV_TASK_ERROR:", error);
      // Don't send another error response to avoid recursion
    }
  }

  // Add the rest of the methods with similar error handling patterns...
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

        platformState.searchTabId = tabId;
        break;
      }
    }

    this.safePortSend(port, {
      type: "SUCCESS",
      data: sessionData || {},
    });
  }

  async handleGetSendCvTask(port, data) {
    const tabId = port.sender?.tab?.id;
    const windowId = port.sender?.tab?.windowId;

    let sessionData = null;
    for (const [
      sessionId,
      automation,
    ] of this.messageHandler.activeAutomations.entries()) {
      console.log("AUTOMATION", automation.windowId, windowId);
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
    console.log("SESSION DATA", sessionData);
    this.safePortSend(port, {
      type: "SUCCESS",
      data: sessionData || {},
    });
  }
}

export default LeverAutomationHandler;
