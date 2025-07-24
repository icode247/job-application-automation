// background/platforms/ziprecruiter.js

export default class ZipRecruiterAutomationHandler {
  constructor(messageHandler) {
    this.messageHandler = messageHandler;
    this.platform = "ziprecruiter";
    this.portConnections = new Map();
    this.activeAutomations = new Map();
    this.tabSessions = new Map();

    // ZipRecruiter specific state
    this.state = {
      started: false,
      applicationInProgress: false,
      applicationUrl: null,
      applicationStartTime: null,
      jobsLimit: 100,
      jobsApplied: 0,
      searchDomain: ["ziprecruiter.com"],
      submittedLinks: [],
      lastActivity: Date.now(),
      searchTabId: null,
      applyTabId: null,
      windowId: null,
    };

    this.log("🎯 ZipRecruiter automation handler initialized");
  }

  handlePortConnection(port) {
    try {
      this.log(`📨 New port connection: ${port.name}`);

      const portParts = port.name.split("-");
      if (portParts.length >= 3) {
        const tabId = parseInt(portParts[2]);
        this.portConnections.set(tabId, port);

        // Set up port message handler
        port.onMessage.addListener((message) => {
          this.handlePortMessage(message, port);
        });

        // Handle port disconnection
        port.onDisconnect.addListener(() => {
          this.log(`📨 Port disconnected for tab ${tabId}`);
          this.portConnections.delete(tabId);
        });

        // Send connection established message
        this.sendPortResponse(port, {
          type: "CONNECTION_ESTABLISHED",
          data: { tabId, platform: this.platform },
        });
      }
    } catch (error) {
      this.log(`❌ Error handling port connection: ${error.message}`);
    }
  }

  async handlePortMessage(message, port) {
    try {
      this.log(`📨 Port message received:`, message);
      this.state.lastActivity = Date.now();

      const { type, data, requestId } = message || {};

      switch (type) {
        case "GET_SEARCH_TASK":
          this.handleGetSearchTask(port);
          break;

        case "GET_PROFILE_DATA":
          await this.handleGetProfileData(data?.url, port);
          break;

        case "GET_APPLICATION_TASK":
          this.handleGetApplicationTask(port);
          break;

        case "START_APPLICATION":
          await this.handleStartApplication(data, port, requestId);
          break;

        case "APPLICATION_COMPLETED":
          await this.handleApplicationCompleted(data, port);
          break;

        case "APPLICATION_ERROR":
          await this.handleApplicationError(data, port);
          break;

        case "APPLICATION_SKIPPED":
          await this.handleApplicationSkipped(data, port);
          break;

        case "SEARCH_COMPLETED":
          this.handleSearchCompleted();
          break;

        case "CHECK_APPLICATION_STATUS":
          this.handleCheckApplicationStatus(port, requestId);
          break;

        case "KEEPALIVE":
          this.sendPortResponse(port, {
            type: "KEEPALIVE_RESPONSE",
            data: { timestamp: Date.now() },
          });
          break;

        default:
          this.log(`❓ Unhandled port message type: ${type}`);
          break;
      }
    } catch (error) {
      this.log(`❌ Error handling port message: ${error.message}`);
      this.sendPortResponse(port, {
        type: "ERROR",
        message: error.message,
      });
    }
  }

  handleGetSearchTask(port) {
    try {
      const searchLinkPattern =
        /^https:\/\/(www\.)?ziprecruiter\.com\/(job|jobs|jz|apply).*$/;

      this.sendPortResponse(port, {
        type: "SEARCH_TASK_DATA",
        data: {
          limit: this.state.jobsLimit,
          current: this.state.jobsApplied,
          domain: this.state.searchDomain,
          submittedLinks: this.state.submittedLinks,
          searchLinkPattern: searchLinkPattern.toString(),
        },
      });

      this.log("📤 Sent search task data to content script");
    } catch (error) {
      this.log(`❌ Error handling get search task: ${error.message}`);
      this.sendPortResponse(port, {
        type: "ERROR",
        message: error.message,
      });
    }
  }

  async handleGetProfileData(url, port) {
    try {
      // Get user profile from message handler
      const sessionContext = this.messageHandler.getTabSessionContext(
        this.getTabIdFromPort(port)
      );

      if (sessionContext && sessionContext.userProfile) {
        this.sendPortResponse(port, {
          type: "PROFILE_DATA",
          data: sessionContext.userProfile,
        });
        this.log("📤 Sent profile data from session context");
        return;
      }

      // Fallback to fetch from API
      const userId = sessionContext?.userId;
      if (!userId) {
        throw new Error("User ID not available");
      }

      const apiHost = sessionContext?.apiHost || "https://fastapply.co";
      const response = await fetch(`${apiHost}/api/user/${userId}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch user details: ${response.status}`);
      }

      const userData = await response.json();

      this.sendPortResponse(port, {
        type: "PROFILE_DATA",
        data: userData,
      });

      this.log("📤 Sent profile data from API");
    } catch (error) {
      this.log(`❌ Error getting profile data: ${error.message}`);
      this.sendPortResponse(port, {
        type: "ERROR",
        message: "Failed to get profile data: " + error.message,
      });
    }
  }

  handleGetApplicationTask(port) {
    try {
      const sessionContext = this.messageHandler.getTabSessionContext(
        this.getTabIdFromPort(port)
      );

      this.sendPortResponse(port, {
        type: "APPLICATION_TASK_DATA",
        data: {
          devMode: sessionContext?.devMode || false,
          profile: sessionContext?.userProfile,
          session: sessionContext?.sessionConfig,
          apiHost: sessionContext?.apiHost || "https://fastapply.co",
        },
      });

      this.log("📤 Sent application task data");
    } catch (error) {
      this.log(`❌ Error handling get application task: ${error.message}`);
      this.sendPortResponse(port, {
        type: "ERROR",
        message: error.message,
      });
    }
  }

  async handleStartApplication(data, port, requestId) {
    try {
      const url = data.url;

      // Check if already processing an application
      if (this.state.applicationInProgress) {
        this.log("Already have an active application, ignoring new request");

        if (requestId && this.getTabIdFromPort(port)) {
          chrome.tabs.sendMessage(this.getTabIdFromPort(port), {
            type: "APPLICATION_START_RESPONSE",
            requestId,
            success: false,
            message: "An application is already in progress",
          });
        }
        return;
      }

      // Check if URL already processed
      const isDuplicate = this.state.submittedLinks.some((link) =>
        this.isUrlMatch(link.url, url)
      );

      if (isDuplicate) {
        this.log("URL already processed:", url);

        this.sendPortResponse(port, {
          type: "DUPLICATE",
          message: "This job has already been processed",
          data: { url },
        });

        if (requestId && this.getTabIdFromPort(port)) {
          chrome.tabs.sendMessage(this.getTabIdFromPort(port), {
            type: "APPLICATION_START_RESPONSE",
            requestId,
            success: false,
            duplicate: true,
            message: "This job has already been processed",
          });
        }
        return;
      }

      // Set state
      this.state.applicationInProgress = true;
      this.state.applicationUrl = url;
      this.state.applicationStartTime = Date.now();

      // Add to submitted links with PROCESSING status
      this.state.submittedLinks.push({
        url,
        status: "PROCESSING",
        timestamp: Date.now(),
      });

      // Acknowledge the request
      this.sendPortResponse(port, {
        type: "APPLICATION_STARTING",
        data: { url },
      });

      if (requestId && this.getTabIdFromPort(port)) {
        chrome.tabs.sendMessage(this.getTabIdFromPort(port), {
          type: "APPLICATION_START_RESPONSE",
          requestId,
          success: true,
          data: { url },
        });
      }

      this.log(`✅ Started application for: ${url}`);
    } catch (error) {
      this.log(`❌ Error starting application: ${error.message}`);

      this.sendPortResponse(port, {
        type: "ERROR",
        message: "Error starting application: " + error.message,
      });

      if (requestId && this.getTabIdFromPort(port)) {
        chrome.tabs.sendMessage(this.getTabIdFromPort(port), {
          type: "APPLICATION_START_RESPONSE",
          requestId,
          success: false,
          message: "Error starting application: " + error.message,
        });
      }

      this.resetApplicationState();
    }
  }

  async handleApplicationCompleted(data, port) {
    try {
      const url = this.state.applicationUrl || data.url;

      this.log("Received applicationCompleted message:", {
        url: url,
        data: data ? { ...data } : null,
      });

      // Check for duplicate
      const isDuplicate = this.state.submittedLinks.some(
        (link) => this.isUrlMatch(link.url, url) && link.status === "SUCCESS"
      );

      if (isDuplicate) {
        this.log("Ignoring duplicate application completion for URL:", url);
        this.sendPortResponse(port, {
          type: "SUCCESS",
          duplicate: true,
        });
        return;
      }

      // Update submitted links
      this.state.submittedLinks.push({
        url,
        details: data || null,
        status: "SUCCESS",
        timestamp: Date.now(),
      });

      // Track job application via API
      const sessionContext = this.messageHandler.getTabSessionContext(
        this.getTabIdFromPort(port)
      );
      const userId = sessionContext?.userId;
      const apiHost = sessionContext?.apiHost || "https://fastapply.co";

      if (userId) {
        const apiPromises = [];

        // Update application count
        apiPromises.push(
          fetch(`${apiHost}/api/applications`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ userId }),
          }).catch((e) => this.log("API applications error:", e))
        );

        // Save applied job
        if (data) {
          apiPromises.push(
            fetch(`${apiHost}/api/applied-jobs`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                ...data,
                userId,
                applicationPlatform: "ziprecruiter",
              }),
            }).catch((e) => this.log("API applied-jobs error:", e))
          );
        }

        // Execute API calls in parallel
        if (apiPromises.length > 0) {
          Promise.all(apiPromises).catch((error) => {
            this.log("Error in API calls:", error);
          });
        }
      }

      // Increment count
      this.state.jobsApplied++;

      // Send success response
      this.sendPortResponse(port, {
        type: "SUCCESS",
        message: "Application completed successfully",
      });

      // Reset application state
      this.resetApplicationState();

      // Check if reached limit
      if (this.state.jobsApplied >= this.state.jobsLimit) {
        this.completeSearch("Reached application limit");
      } else {
        this.notifySearchNext({
          url,
          status: "SUCCESS",
        });
      }

      this.log(`✅ Application completed successfully for: ${url}`);
    } catch (error) {
      this.log(`❌ Error handling application completion: ${error.message}`);
      this.sendPortResponse(port, {
        type: "ERROR",
        message: error.message,
      });

      this.resetApplicationState();
      this.notifySearchNext({
        url: this.state.applicationUrl,
        status: "ERROR",
        message: error.message,
      });
    }
  }

  async handleApplicationError(data, port) {
    try {
      const url = this.state.applicationUrl || data.url;

      // Update submitted links
      this.state.submittedLinks.push({
        url,
        error: data.message || data,
        status: "ERROR",
        timestamp: Date.now(),
      });

      this.sendPortResponse(port, {
        type: "SUCCESS",
        message: "Error acknowledged",
      });

      this.resetApplicationState();
      this.notifySearchNext({
        url,
        status: "ERROR",
        message:
          typeof data === "string" ? data : data.message || "Application error",
      });

      this.log(`❌ Application error for: ${url}`);
    } catch (error) {
      this.log(`❌ Error handling application error: ${error.message}`);
      this.sendPortResponse(port, {
        type: "ERROR",
        message: error.message,
      });
    }
  }

  async handleApplicationSkipped(data, port) {
    try {
      const url = this.state.applicationUrl || data.url;

      // Update submitted links
      this.state.submittedLinks.push({
        url,
        reason: data.message || data,
        status: "SKIPPED",
        timestamp: Date.now(),
      });

      this.sendPortResponse(port, {
        type: "SUCCESS",
        message: "Skip acknowledged",
      });

      this.resetApplicationState();
      this.notifySearchNext({
        url,
        status: "SKIPPED",
        message: data.message || data || "Application skipped",
      });

      this.log(`⏭️ Application skipped for: ${url}`);
    } catch (error) {
      this.log(`❌ Error handling application skip: ${error.message}`);
      this.sendPortResponse(port, {
        type: "ERROR",
        message: error.message,
      });
    }
  }

  handleSearchCompleted() {
    this.completeSearch("Search completed by content script");
  }

  handleCheckApplicationStatus(port, requestId) {
    const statusData = {
      inProgress: this.state.applicationInProgress,
      url: this.state.applicationUrl,
      tabId: this.state.applyTabId,
    };

    this.sendPortResponse(port, {
      type: "APPLICATION_STATUS",
      requestId: requestId,
      data: statusData,
    });

    // Also send via chrome.tabs.sendMessage for redundancy
    if (requestId && this.getTabIdFromPort(port)) {
      try {
        chrome.tabs.sendMessage(this.getTabIdFromPort(port), {
          type: "APPLICATION_STATUS",
          requestId: requestId,
          data: statusData,
        });
      } catch (error) {
        this.log("Error sending redundant status message:", error);
      }
    }
  }

  // Helper methods
  resetApplicationState() {
    this.state.applicationInProgress = false;
    this.state.applicationUrl = null;
    this.state.applicationStartTime = null;
    this.state.applyTabId = null;
  }

  completeSearch(reason) {
    try {
      this.log("Search completed:", reason);

      // Show completion notification
      try {
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icon.png",
          title: "ZipRecruiter Job Search Completed",
          message: `Successfully completed ${this.state.jobsApplied} applications.`,
        });
      } catch (error) {
        this.log("Error showing notification:", error);
      }

      this.state.started = false;
      this.log("All tasks completed successfully");
    } catch (error) {
      this.log("Error in completeSearch:", error);
    }
  }

  notifySearchNext(data) {
    try {
      if (this.state.searchTabId) {
        chrome.tabs.sendMessage(this.state.searchTabId, {
          type: "SEARCH_NEXT",
          data,
        });
      }
    } catch (error) {
      this.log("Error sending SEARCH_NEXT message:", error);
    }
  }

  isUrlMatch(url1, url2) {
    if (!url1 || !url2) return false;

    try {
      const normalize = (url) => {
        if (!url.startsWith("http")) {
          url = "https://" + url;
        }

        try {
          const urlObj = new URL(url);
          return (urlObj.origin + urlObj.pathname)
            .toLowerCase()
            .trim()
            .replace(/\/+$/, "");
        } catch (e) {
          return url.toLowerCase().trim();
        }
      };

      const normalized1 = normalize(url1);
      const normalized2 = normalize(url2);

      return (
        normalized1 === normalized2 ||
        normalized1.includes(normalized2) ||
        normalized2.includes(normalized1)
      );
    } catch (e) {
      this.log("Error comparing URLs:", e);
      return false;
    }
  }

  getTabIdFromPort(port) {
    try {
      if (port && port.sender && port.sender.tab) {
        return port.sender.tab.id;
      }

      if (port && port.name) {
        const parts = port.name.split("-");
        if (parts.length >= 3 && !isNaN(parseInt(parts[parts.length - 1]))) {
          return parseInt(parts[parts.length - 1]);
        }
      }

      return null;
    } catch (error) {
      this.log("Error extracting tab ID from port:", error);
      return null;
    }
  }

  sendPortResponse(port, message) {
    try {
      if (port && port.sender) {
        port.postMessage(message);
      }
    } catch (error) {
      this.log("Failed to send port response:", error);
    }
  }

  log(message, data = {}) {
    console.log(`🎯 [ZipRecruiter Handler] ${message}`, data);
  }

  // Cleanup method
  cleanup() {
    this.portConnections.clear();
    this.activeAutomations.clear();
    this.tabSessions.clear();
    this.resetApplicationState();
    this.log("🧹 ZipRecruiter handler cleanup completed");
  }
}
