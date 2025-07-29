// shared/base/base-background-handler.js
import Logger from "../../core/logger.js";

export default class BaseBackgroundHandler {
  constructor(messageHandler, platformName, devMode = false) {
    this.messageHandler = messageHandler;
    this.platformName = platformName;
    this.portConnections = new Map();
    this.sessionPorts = new Map();
    this.activeConnections = new Set();
    this.lastKeepalive = new Map();
    this.errorCounts = new Map();
    this.maxErrors = 5;
    this.processingMessages = new Set();
    this.processedCompletions = new Set();
    this.devMode = devMode;
    // Start cleanup process
    this.startPeriodicCleanup();
    this.logger = new Logger(`${this.platformName}Handler`, this.devMode);
  }

  /**
   * Handle new port connections - common logic for all platforms
   */
  handlePortConnection(port) {
    const portNameParts = port.name.split("-");
    const platform = portNameParts[0];
    const portType = portNameParts[1]; // 'search' or 'apply'
    const timestamp = portNameParts[2];
    const sessionId = portNameParts[3];
    const tabId = port.sender?.tab?.id;

    // Validate platform matches
    if (platform !== this.platformName) {
      (this.log
        `Platform mismatch: expected ${this.platformName}, got ${platform}`
      );
      this.safePortDisconnect(port);
      return;
    }

    // Prevent duplicate connections
    if (this.activeConnections.has(port.name)) {
      this.log(
        `⚠️ Duplicate ${this.platformName} port connection attempt: ${port.name}`
      );
      this.safePortDisconnect(port);
      return;
    }

    this.log(
      `📝 Registering ${this.platformName} ${portType} port for tab ${tabId}, session ${sessionId}`
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

    // Set up message handler with error protection
    port.onMessage.addListener((message) => {
      this.handlePortMessageWithDuplicateProtection(message, port);
    });

    // Handle disconnection
    port.onDisconnect.addListener(() => {
      this.log(`📪 ${this.platformName} port disconnected: ${port.name}`);
      this.cleanupPort(port, tabId, sessionId);
    });

    // Send connection confirmation
    setTimeout(() => {
      if (this.activeConnections.has(port.name)) {
        this.safePortSend(port, {
          type: "CONNECTION_ESTABLISHED",
          data: { tabId, sessionId, portType, platform: this.platformName },
        });
      }
    }, 100);
  }

  /**
   * Handle port messages with duplicate protection
   */
  handlePortMessageWithDuplicateProtection(message, port) {
    const messageId = `${port.name}-${message.type}-${Date.now()}`;

    if (this.processingMessages.has(messageId)) {
      this.log(
        `⚠️ Duplicate message ignored: ${message.type} from ${port.name}`
      );
      return;
    }

    this.processingMessages.add(messageId);

    try {
      this.handlePortMessage(message, port);
    } catch (error) {
      this.log(
        `❌ Error handling ${this.platformName} message ${message.type}:`,
        error
      );
      this.safePortSend(port, {
        type: "ERROR",
        message: `Error processing ${message.type}: ${error.message}`,
      });
    } finally {
      // Clean up after 1 second
      setTimeout(() => this.processingMessages.delete(messageId), 1000);
    }
  }

  /**
   * Abstract method - must be implemented by platform-specific handlers
   */
  async handlePortMessage(message, port) {
    const { type, data } = message || {};
    if (!type) return;

    // Update keepalive timestamp
    this.lastKeepalive.set(port.name, Date.now());

    // Common message types
    switch (type) {
      case "KEEPALIVE":
        await this.handleKeepalive(port, data);
        break;

      default:
        // Delegate to platform-specific handler
        await this.handlePlatformSpecificMessage(type, data, port);
    }
  }

  /**
   * Abstract method for platform-specific message handling
   */
  async handlePlatformSpecificMessage(type, data, port) {
    throw new Error(
      `Platform-specific message handler not implemented for type: ${type}`
    );
  }

  /**
   * Safe port message sending with connection validation
   */
  safePortSend(port, message) {
    try {
      if (!port || !port.name || !this.activeConnections.has(port.name)) {
        this.log(
          `⚠️ Cannot send message to disconnected/invalid ${this.platformName} port: ${message.type}`
        );
        return false;
      }

      if (!port.sender || !port.sender.tab) {
        this.log(
          `⚠️ ${this.platformName} port sender no longer exists: ${message.type}`
        );
        this.activeConnections.delete(port.name);
        return false;
      }

      port.postMessage(message);
      this.lastKeepalive.set(port.name, Date.now());
      return true;
    } catch (error) {
      this.log(
        `⚠️ Failed to send ${this.platformName} port message (${message.type}):`,
        error.message
      );

      if (port && port.name) {
        this.activeConnections.delete(port.name);
        this.lastKeepalive.delete(port.name);
      }

      return false;
    }
  }

  /**
   * Safe port disconnection
   */
  safePortDisconnect(port) {
    try {
      if (port && typeof port.disconnect === "function") {
        port.disconnect();
      }
    } catch (error) {
      // Ignore disconnection errors
    }
  }

  /**
   * Clean up port connections
   */
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

  /**
   * Handle keepalive messages
   */
  async handleKeepalive(port, data) {
    this.safePortSend(port, {
      type: "KEEPALIVE_RESPONSE",
      data: { timestamp: Date.now() },
    });
  }

  /**
   * Start periodic cleanup process
   */
  startPeriodicCleanup() {
    setInterval(() => {
      const now = Date.now();
      const staleThreshold = 120000; // 2 minutes

      // Clean up stale ports
      for (const [portName, lastSeen] of this.lastKeepalive.entries()) {
        if (now - lastSeen > staleThreshold) {
          this.log(
            `🧹 Cleaning up stale ${this.platformName} port: ${portName}`
          );
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

  /**
   * Get session ID from port name
   */
  getSessionIdFromPort(port) {
    const portName = port.name;
    const parts = portName.split("-");
    return parts.length > 3 ? parts[3] : null;
  }

  /**
   * Send search next message to appropriate tabs
   */
  async sendSearchNextMessage(windowId, data, retryCount = 0) {
    const maxRetries = 1;

    try {
      this.log(
        `📤 Sending SEARCH_NEXT message to ${this.platformName} window ${windowId}:`,
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
              this.log(
                `✅ Sent SEARCH_NEXT via port to ${this.platformName} tab ${tab.id}`
              );
              return true;
            } catch (error) {
              this.log("⚠️ Port message failed, trying tabs API:", error);
            }
          }

          // Fallback to tabs API
          try {
            await chrome.tabs.sendMessage(tab.id, {
              type: "SEARCH_NEXT",
              data: data,
            });
            this.log(
              `✅ Sent SEARCH_NEXT via tabs API to ${this.platformName} tab ${tab.id}`
            );
            return true;
          } catch (error) {
            this.log("⚠️ Tabs API message failed:", error);
            if (retryCount < maxRetries) {
              setTimeout(() => {
                this.sendSearchNextMessage(windowId, data, retryCount + 1);
              }, 3000 * (retryCount + 1));
              return true;
            }
          }
        }
      }

      this.log(
        `⚠️ Could not find ${this.platformName} search tab to send SEARCH_NEXT message`
      );
      return false;
    } catch (error) {
      this.log(
        `❌ Error sending ${this.platformName} SEARCH_NEXT message:`,
        error
      );
      return false;
    }
  }

  /**
   * Check if port is still alive
   */
  isPortAlive(port) {
    try {
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

  /**
   * Complete cleanup of all resources
   */
  cleanup() {
    this.log(`🧹 Starting ${this.platformName}AutomationHandler cleanup`);

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

    this.log(`✅ ${this.platformName}AutomationHandler cleanup completed`);
  }

  /**
   * Handle automation completion with error tracking
   */
  async handleTaskCompletion(port, data, status) {
    try {
      const windowId = port.sender?.tab?.windowId;
      const tabId = port.sender?.tab?.id;
      const sessionId = this.getSessionIdFromPort(port);

      this.log(
        `${status === "SUCCESS" ? "✅" : "❌"} ${this.platformName
        } job application ${status.toLowerCase()} in tab ${tabId}`
      );

      // Track errors if applicable
      if (status === "ERROR") {
        const errorCount = (this.errorCounts.get(sessionId) || 0) + 1;
        this.errorCounts.set(sessionId, errorCount);

        if (errorCount >= this.maxErrors) {
          this.log(
            `🚨 Too many errors (${errorCount}) for ${this.platformName} session ${sessionId}, stopping automation`
          );
          this.safePortSend(port, {
            type: "AUTOMATION_STOPPED",
            message: `Too many errors (${errorCount}), automation stopped`,
          });
          this.errorCounts.delete(sessionId);
          return;
        }
      }

      // Find automation and update state
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
        await this.updateAutomationState(automation, status, data);
        await this.closeJobTabIfExists(automation);
        this.resetAutomationProcessing(automation);

        // Continue with next job or handle completion
        await this.continueOrComplete(automation, windowId, status, data);
      }

      this.safePortSend(port, {
        type: "SUCCESS",
        message: `${status} acknowledged`,
      });
    } catch (error) {
      this.logger.error(
        `❌ Error handling ${this.platformName} task completion:`,
        error
      );
    }
  }

  /**
   * Update automation state based on completion status
   */
  async updateAutomationState(automation, status, data) {
    const url = automation.platformState.currentJobUrl;
    if (url && automation.platformState.submittedLinks) {
      const linkIndex = automation.platformState.submittedLinks.findIndex(
        (link) =>
          this.messageHandler.normalizeUrl(link.url) ===
          this.messageHandler.normalizeUrl(url)
      );
      if (linkIndex >= 0) {
        automation.platformState.submittedLinks[linkIndex].status = status;
        if (status === "SUCCESS") {
          automation.platformState.submittedLinks[linkIndex].details = data;
        } else {
          automation.platformState.submittedLinks[linkIndex].error = data;
        }
      }
    }
  }

  /**
   * Close job tab if it exists
   */
  async closeJobTabIfExists(automation) {
    if (automation.platformState.currentJobTabId) {
      try {
        await chrome.tabs.remove(automation.platformState.currentJobTabId);
      } catch (error) {
        this.logger.warn(`⚠️ Error closing ${this.platformName} job tab:`, error);
      }
    }
  }

  /**
   * Reset automation processing state
   */
  resetAutomationProcessing(automation) {
    automation.platformState.isProcessingJob = false;
    automation.platformState.currentJobUrl = null;
    automation.platformState.currentJobTabId = null;
    automation.platformState.applicationStartTime = null;
  }

  /**
   * Continue automation or complete
   */
  async continueOrComplete(automation, windowId, status, data) {
    if (status === "SUCCESS") {
      automation.platformState.searchData.current++;
    }

    const oldUrl = automation.platformState.currentJobUrl;

    // Add delay for errors
    const delay =
      status === "ERROR"
        ? Math.min(
          3000 * (this.errorCounts.get(automation.sessionId) || 1),
          15000
        )
        : 0;

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
 * Logging with platform context
 */
  log(message, data = {}) {
    const sessionInfo = this.sessionId
      ? `[Session: ${this.sessionId.slice(-6)}]`
      : "[No Session]";
    const contextInfo = this.hasSessionContext
      ? "[Context: ✓]"
      : "[Context: ✗]";
    const profileInfo = this.userProfile ? "[Profile: ✓]" : "[Profile: ✗]";

    this.logger.log(
      `🤖 [${this.platform}${sessionInfo}${contextInfo}${profileInfo}] ${message}`,
      data
    );
  }
}
