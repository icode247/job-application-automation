// background/platforms/ziprecruiter.js
/**
 * ZipRecruiter Automation Handler
 * Handles automation of job applications on ZipRecruiter platform
 */
export default class ZipRecruiterAutomationHandler {
  constructor(messageHandler) {
    const devMode = messageHandler.devMode;
    super(messageHandler, "ziprecruiter", devMode);
    
    // Platform configuration
    this.platformConfig = {
      domains: ["ziprecruiter.com"],
      searchLinkPattern: /^https:\/\/(www\.)?ziprecruiter\.com\/(job|jobs|jz|apply).*$/,
      jobsPagePattern: /^https:\/\/(www\.)?ziprecruiter\.com\/job\/.*$/,
    };

    // Connection and session management
    this.portConnections = new Map();
    this.activeAutomations = new Map();
    this.tabSessions = new Map();
    this.applicationTimeouts = new Map();
    this.processedCompletions = new Set();

    // Platform state
    this.state = {
      started: false,
      applicationInProgress: false,
      applicationUrl: null,
      applicationStartTime: null,
      jobsLimit: 100,
      jobsApplied: 0,
      submittedLinks: [],
      lastActivity: Date.now(),
      searchTabId: null,
      applyTabId: null,
      windowId: null,
    };

    this.log("🚀 ZipRecruiterAutomationHandler initialized");
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

  async  /**
   * Handle platform-specific messages from content scripts
   */
  async handlePlatformSpecificMessage(type, data, port) {
    const sessionId = this.getSessionIdFromPort(port);
    const windowId = port?.sender?.tab?.windowId;
    const tabId = port?.sender?.tab?.id;

    this.log(
      `📨 Handling ZipRecruiter message: ${type} for session ${sessionId}, tab ${tabId}`
    );

    try {
      this.state.lastActivity = Date.now();

      switch (type) {
        case "GET_SEARCH_TASK":
          await this.handleGetSearchTask(port, data);
          break;

        case "GET_PROFILE_DATA":
          await this.handleGetProfileData(data?.url, port);
          break;

        case "GET_APPLICATION_TASK":
          await this.handleGetApplicationTask(port, data);
          break;

        case "START_APPLICATION":
          await this.handleStartApplication(port, data, sessionId, windowId, tabId);
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
          await this.handleSearchCompleted(port, sessionId, windowId);
          break;

        case "CHECK_APPLICATION_STATUS":
          await this.handleCheckApplicationStatus(port, data?.requestId);
          break;

        case "KEEPALIVE":
          this.safePortSend(port, {
            type: "KEEPALIVE_RESPONSE",
            data: { timestamp: Date.now() },
          });
          break;

        default:
          this.log.warn(`❓ Unhandled ZipRecruiter message type: ${type}`);
          this.safePortSend(port, {
            type: "ERROR",
            message: `Unknown message type: ${type}`,
          });
          break;
      }
    } catch (error) {
      this.log(`❌ Error handling ZipRecruiter message:`, error);
      this.safePortSend(port, {
        type: "ERROR",
        message: `Failed to process ${type}: ${error.message}`,
      });
    }
  }

  /**
   * Handle search task request - ZipRecruiter specific data structure
   */
  async handleGetSearchTask(port, data) {
    const tabId = port?.sender?.tab?.id;
    const windowId = port?.sender?.tab?.windowId;

    this.log(
      `🔍 GET_SEARCH_TASK request from ZipRecruiter tab ${tabId}, window ${windowId}`
    );

    try {
      const sessionData = {
        tabId,
        limit: this.state.jobsLimit,
        current: this.state.jobsApplied,
        domain: this.platformConfig.domains,
        submittedLinks: this.state.submittedLinks,
        searchLinkPattern: this.platformConfig.searchLinkPattern.toString(),
      };

      this.log("📤 Sending search task data:", sessionData);
      
      const sent = this.safePortSend(port, {
        type: "SEARCH_TASK_DATA",
        data: sessionData,
      });

      if (!sent) {
        throw new Error("Failed to send search task data");
      }
    } catch (error) {
      this.log(`❌ Error handling GET_SEARCH_TASK:`, error);
      this.safePortSend(port, {
        type: "ERROR",
        message: `Failed to get search task: ${error.message}`,
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

      const apiHost = sessionContext?.apiHost;
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

  /**
   * Handle application task request - ZipRecruiter specific data structure
   */
  async handleGetApplicationTask(port, data) {
    const tabId = port?.sender?.tab?.id;
    const windowId = port?.sender?.tab?.windowId;

    this.log(
      `🔍 GET_APPLICATION_TASK request from ZipRecruiter tab ${tabId}, window ${windowId}`
    );

    try {
      const sessionContext = this.messageHandler.getTabSessionContext(tabId);
      const applicationData = {
        devMode: sessionContext?.devMode || false,
        profile: sessionContext?.userProfile,
        session: sessionContext?.sessionConfig,
        apiHost: sessionContext?.apiHost,
        // Include any ZipRecruiter specific application data
        platform: "ziprecruiter",
      };

      this.log("📤 Sending application task data");
      
      const sent = this.safePortSend(port, {
        type: "APPLICATION_TASK_DATA",
        data: applicationData,
      });

      if (!sent) {
        throw new Error("Failed to send application task data");
      }
    } catch (error) {
      this.log(`❌ Error handling GET_APPLICATION_TASK:`, error);
      this.safePortSend(port, {
        type: "ERROR",
        message: `Failed to get application task: ${error.message}`,
      });
    }
  }

  /**
   * Handle application start request - ZipRecruiter specific logic
   */
  async handleStartApplication(port, data, sessionId, windowId, tabId) {
    const { url, title, company, location, requestId } = data || {};
    
    if (!url) {
      this.log("❌ No URL provided for application start");
      this.safePortSend(port, {
        type: "ERROR",
        message: "No URL provided for application start",
      });
      return;
    }

    this.log(`🎯 Starting ZipRecruiter application for: ${title || url}`, {
      url,
      title,
      company,
      location,
      tabId,
      windowId,
    });

    try {
      // Check if already processing an application
      if (this.state.applicationInProgress) {
        const message = "An application is already in progress";
        this.log.warn(`⚠️ ${message}`);
        
        this.safePortSend(port, {
          type: "APPLICATION_START_RESPONSE",
          requestId,
          success: false,
          message,
        });
        return;
      }

      // Check for duplicate application
      const isDuplicate = this.state.submittedLinks.some(link => 
        this.isUrlMatch(link.url, url) && link.status === "SUCCESS"
      );

      if (isDuplicate) {
        const message = `Job already applied: ${title || url}`;
        this.log.warn(`⚠️ ${message}`);
        
        this.safePortSend(port, {
          type: "APPLICATION_START_RESPONSE",
          requestId,
          success: false,
          duplicate: true,
          message,
          data: { url, title, company },
        });
        return;
      }

      // Update state
      this.state.applicationInProgress = true;
      this.state.applicationUrl = url;
      this.state.applicationStartTime = Date.now();
      this.state.applyTabId = tabId;

      // Add to submitted links
      this.state.submittedLinks.push({
        url,
        title,
        company,
        location,
        status: "PROCESSING",
        timestamp: Date.now(),
      });

      // Set application timeout (15 minutes)
      const timeoutId = setTimeout(() => {
        this.log(`⏰ Application timeout for: ${url}`);
        this.handleApplicationTimeout(sessionId, url, tabId);
      }, 15 * 60 * 1000); // 15 minutes

      this.applicationTimeouts.set(url, timeoutId);

      // Send response
      this.log(`✅ Started application process for: ${title || url}`);
      this.safePortSend(port, {
        type: "APPLICATION_START_RESPONSE",
        requestId,
        success: true,
        message: "Application process started",
        data: { url, title, company },
      });

    } catch (error) {
      this.log(`❌ Error in handleStartApplication:`, error);
      
      // Reset state on error
      this.resetApplicationState();
      
      // Clean up any timeout
      if (this.applicationTimeouts.has(url)) {
        clearTimeout(this.applicationTimeouts.get(url));
        this.applicationTimeouts.delete(url);
      }

      // Send error response
      this.safePortSend(port, {
        type: "APPLICATION_START_RESPONSE",
        requestId,
        success: false,
        message: `Failed to start application: ${error.message}`,
        data: { url, title, company },
      });
    }
  }

  /**
   * Handle successful application completion
   */
  async handleApplicationCompleted(data, port) {
    const tabId = port?.sender?.tab?.id;
    const url = this.state.applicationUrl || data?.url;
    
    if (!url) {
      this.log("❌ No URL provided for application completion");
      this.safePortSend(port, {
        type: "ERROR",
        message: "No URL provided for application completion",
      });
      return;
    }

    this.log(`✅ Application completed for: ${url}`, {
      tabId,
      data: data ? { ...data } : null,
    });

    try {
      // Check for duplicate completion
      const isDuplicate = this.state.submittedLinks.some(
        link => this.isUrlMatch(link.url, url) && link.status === "SUCCESS"
      );

      if (isDuplicate) {
        this.log.warn(`⚠️ Ignoring duplicate completion for: ${url}`);
        this.safePortSend(port, {
          type: "SUCCESS",
          duplicate: true,
          message: "Application already marked as completed",
        });
        return;
      }

      // Clear any existing timeout
      if (this.applicationTimeouts.has(url)) {
        clearTimeout(this.applicationTimeouts.get(url));
        this.applicationTimeouts.delete(url);
      }

      // Update submitted links with completion status
      const applicationData = {
        ...data,
        status: "SUCCESS",
        timestamp: Date.now(),
        endTime: Date.now(),
        duration: this.state.applicationStartTime 
          ? Date.now() - this.state.applicationStartTime 
          : null,
      };

      this.state.submittedLinks.push(applicationData);

      // Track job application via API
      try {
        const sessionContext = this.messageHandler.getTabSessionContext(tabId);
        const userId = sessionContext?.userId;
        const apiHost = sessionContext?.apiHost;

        if (userId && apiHost) {
          const apiPromises = [];

          // Update application count
          apiPromises.push(
            fetch(`${apiHost}/api/applications`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ userId }),
            }).catch(e => this.log("API applications error:", e))
          );

          // Save applied job details
          if (data) {
            apiPromises.push(
              fetch(`${apiHost}/api/applied-jobs`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  ...data,
                  userId,
                  applicationPlatform: "ziprecruiter",
                  appliedAt: new Date().toISOString(),
                }),
              }).catch(e => this.log("API applied-jobs error:", e))
            );
          }

          // Execute API calls in parallel and don't wait for completion
          if (apiPromises.length > 0) {
            Promise.all(apiPromises).catch(error => {
              this.log("Error in API calls:", error);
            });
          }
        }
      } catch (apiError) {
        this.log("Error tracking application via API:", apiError);
        // Continue with the flow even if API tracking fails
      }

      // Increment successful applications counter
      this.state.jobsApplied++;

      // Send response
      this.safePortSend(port, {
        type: "APPLICATION_COMPLETED",
        success: true,
        message: "Application completed successfully",
        data: applicationData,
      });

      // Reset application state
      this.resetApplicationState();

      // Check if we've reached the application limit
      if (this.state.jobsApplied >= this.state.jobsLimit) {
        this.completeSearch("Reached application limit");
      } else {
        // Notify search to continue with next job
        this.notifySearchNext({
          url,
          status: "SUCCESS",
          data: {
            title: data?.title,
            company: data?.company,
            location: data?.location,
          },
        });
      }

      this.log(`✅ Successfully processed application completion for: ${url}`);
    } catch (error) {
      this.log(`❌ Error handling application completion for ${url}:`, error);
      
      // Clean up on error
      this.resetApplicationState();
      
      // Clear any existing timeout
      if (this.applicationTimeouts.has(url)) {
        clearTimeout(this.applicationTimeouts.get(url));
        this.applicationTimeouts.delete(url);
      }

      // Send error response
      this.safePortSend(port, {
        type: "APPLICATION_COMPLETED",
        success: false,
        message: `Failed to process application completion: ${error.message}`,
      });

      // Notify search about the error
      this.notifySearchNext({
        url,
        status: "ERROR",
        message: error.message,
      });
    }
  }

  /**
   * Handle application error
   */
  async handleApplicationError(data, port) {
    const tabId = port?.sender?.tab?.id;
    const url = this.state.applicationUrl || data?.url;
    const errorMessage = data?.message || "Unknown error during application";
    const errorType = data?.type || "APPLICATION_ERROR";
    
    if (!url) {
      this.log("❌ No URL provided for application error");
      this.safePortSend(port, {
        type: "ERROR",
        message: "No URL provided for application error",
      });
      return;
    }

    this.log(`❌ Application error for ${url}: ${errorMessage}`, {
      tabId,
      errorType,
      errorData: data?.error || null,
    });

    try {
      // Clear any existing timeout
      if (this.applicationTimeouts.has(url)) {
        clearTimeout(this.applicationTimeouts.get(url));
        this.applicationTimeouts.delete(url);
      }

      // Update submitted links with error status
      this.state.submittedLinks.push({
        url,
        title: data?.title,
        company: data?.company,
        location: data?.location,
        status: "ERROR",
        error: errorMessage,
        errorType,
        timestamp: Date.now(),
        endTime: Date.now(),
        duration: this.state.applicationStartTime 
          ? Date.now() - this.state.applicationStartTime 
          : null,
      });

      // Send error response
      this.safePortSend(port, {
        type: "APPLICATION_ERROR",
        success: false,
        message: errorMessage,
        errorType,
        data: {
          url,
          title: data?.title,
          company: data?.company,
        },
      });

      // Reset application state
      this.resetApplicationState();

      // Notify search to continue with next job
      this.notifySearchNext({
        url,
        status: "ERROR",
        message: errorMessage,
        errorType,
        data: {
          title: data?.title,
          company: data?.company,
          location: data?.location,
        },
      });

      this.log(`✅ Successfully processed application error for: ${url}`);
    } catch (error) {
      this.log(`❌ Error handling application error for ${url}:`, error);
      
      // Still try to reset state and notify even if error handling fails
      this.resetApplicationState();
      
      // Clear any existing timeout
      if (this.applicationTimeouts.has(url)) {
        clearTimeout(this.applicationTimeouts.get(url));
        this.applicationTimeouts.delete(url);
      }

      // Try to send error response
      this.safePortSend(port, {
        type: "APPLICATION_ERROR",
        success: false,
        message: `Failed to process application error: ${error.message}`,
        originalError: errorMessage,
      });
    }
  }

  /**
   * Handle skipped application
   */
  async handleApplicationSkipped(data, port) {
    const tabId = port?.sender?.tab?.id;
    const url = data?.url;
    const reason = data?.reason || "Application skipped";
    const skipType = data?.skipType || "SKIPPED";
    
    if (!url) {
      this.log.warn("⚠️ No URL provided for skipped application");
      this.safePortSend(port, {
        type: "ERROR",
        message: "No URL provided for skipped application",
      });
      return;
    }

    this.log(`⏭️ Application ${skipType.toLowerCase()} for ${url}: ${reason}`, {
      tabId,
      skipType,
      data: data || null,
    });

    try {
      // Clear any existing timeout
      if (this.applicationTimeouts.has(url)) {
        clearTimeout(this.applicationTimeouts.get(url));
        this.applicationTimeouts.delete(url);
      }

      // Update submitted links with skipped status
      this.state.submittedLinks.push({
        url,
        title: data?.title,
        company: data?.company,
        location: data?.location,
        status: skipType,
        reason,
        timestamp: Date.now(),
        endTime: Date.now(),
        duration: this.state.applicationStartTime 
          ? Date.now() - this.state.applicationStartTime 
          : null,
      });

      // Send response
      this.safePortSend(port, {
        type: "APPLICATION_SKIPPED",
        success: true,
        skipType,
        message: reason,
        data: {
          url,
          title: data?.title,
          company: data?.company,
          location: data?.location,
        },
      });

      // Reset application state if this was the current application
      if (this.state.applicationInProgress && this.state.applicationUrl === url) {
        this.resetApplicationState();
      }

      // Notify search to continue with next job
      this.notifySearchNext({
        url,
        status: skipType,
        message: reason,
        data: {
          title: data?.title,
          company: data?.company,
          location: data?.location,
        },
      });

      this.log(`✅ Successfully processed ${skipType.toLowerCase()} for: ${url}`);
    } catch (error) {
      this.log(`❌ Error handling ${skipType.toLowerCase()} for ${url}:`, error);
      
      // Still try to clean up even if error handling fails
      if (this.applicationTimeouts.has(url)) {
        clearTimeout(this.applicationTimeouts.get(url));
        this.applicationTimeouts.delete(url);
      }

      if (this.state.applicationInProgress) {
        this.resetApplicationState();
      }

      // Try to send error response
      this.safePortSend(port, {
        type: "ERROR",
        success: false,
        message: `Failed to process ${skipType.toLowerCase()}: ${error.message}`,
        originalReason: reason,
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

  /**
   * Handle application timeout
   */
  async handleApplicationTimeout(sessionId, url, tabId) {
    try {
      this.log(`⏰ Application timeout for ${url} in tab ${tabId}`);

      // Clear the timeout
      if (this.applicationTimeouts.has(url)) {
        clearTimeout(this.applicationTimeouts.get(url));
        this.applicationTimeouts.delete(url);
      }

      // Close the tab if it exists
      if (tabId) {
        try {
          await chrome.tabs.remove(tabId);
          this.log(`✅ Closed timed out application tab ${tabId}`);
        } catch (error) {
          this.log.warn(`⚠️ Error closing timeout tab ${tabId}:`, error);
        }
      }

      // Update submitted links with timeout status
      const jobIndex = this.state.submittedLinks.findIndex(link => 
        this.isUrlMatch(link.url, url) && link.status === "PROCESSING"
      );

      if (jobIndex !== -1) {
        this.state.submittedLinks[jobIndex] = {
          ...this.state.submittedLinks[jobIndex],
          status: "TIMEOUT",
          error: "Application timed out after 15 minutes",
          endTime: Date.now(),
        };
      }

      // Reset application state
      this.resetApplicationState();

      // Notify about the timeout
      this.notifySearchNext({
        url,
        status: "TIMEOUT",
        message: "Application timed out after 15 minutes",
      });

      this.log(`❌ Application timed out: ${url}`);
    } catch (error) {
      this.log("❌ Error handling application timeout:", error);
    }
  }

  /**
   * Reset the application state
   */
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

  // Cleanup method
  cleanup() {
    this.portConnections.clear();
    this.activeAutomations.clear();
    this.tabSessions.clear();
    this.resetApplicationState();
    this.log("🧹 ZipRecruiter handler cleanup completed");
  }
}
