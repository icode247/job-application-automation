// background/platforms/ziprecruiter.js - FIXED VERSION following Glassdoor pattern
import BaseBackgroundHandler from "../../shared/base/base-background-handler.js";

/**
 * ZipRecruiter Automation Handler
 * Handles automation of job applications on ZipRecruiter platform
 */
export default class ZipRecruiterAutomationHandler extends BaseBackgroundHandler {
  constructor(messageHandler) {
    const devMode = messageHandler.devMode;
    super(messageHandler, "ziprecruiter", devMode);
    
    // Platform configuration
    this.platformConfig = {
      domains: ["ziprecruiter.com"],
      searchLinkPattern: /^https:\/\/(www\.)?ziprecruiter\.com\/(job|jobs|jz|apply).*$/,
      jobsPagePattern: /^https:\/\/(www\.)?ziprecruiter\.com\/job\/.*$/,
    };

    // Track application timeouts and states
    this.applicationTimeouts = new Map();
    this.processedCompletions = new Set();

    this.log("🚀 ZipRecruiterAutomationHandler initialized");
  }

  /**
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
        case "APPLICATION_SUCCESS":
          await this.handleTaskCompletion(port, data, "SUCCESS");
          break;

        case "APPLICATION_ERROR":
          await this.handleTaskCompletion(port, data, "ERROR");
          break;

        case "APPLICATION_SKIPPED":
          await this.handleTaskCompletion(port, data, "SKIPPED");
          break;

        case "SEARCH_COMPLETED":
          await this.handleSearchCompleted(port, sessionId, windowId);
          break;

        case "CHECK_APPLICATION_STATUS":
          await this.handleCheckApplicationStatus(port, data?.requestId);
          break;

        case "SEARCH_NEXT_READY":
          await this.handleSearchNextReady(port, sessionId);
          break;

        case "KEEPALIVE":
          this.safePortSend(port, {
            type: "KEEPALIVE_RESPONSE",
            data: { timestamp: Date.now() },
          });
          break;

        default:
          this.log(`❓ Unhandled ZipRecruiter message type: ${type}`);
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

    let sessionData = null;
    let automation = null;

    // Find automation by window ID
    for (const [sessionId, auto] of this.messageHandler.activeAutomations.entries()) {
      if (auto.windowId === windowId) {
        automation = auto;
        this.log(`✅ Found ZipRecruiter automation session: ${sessionId}`);
        break;
      }
    }

    if (automation) {
      const platformState = automation.platformState;

      // Safety check for searchLinkPattern
      let searchLinkPatternString = "";
      try {
        if (platformState.searchData.searchLinkPattern) {
          searchLinkPatternString = platformState.searchData.searchLinkPattern.toString();
        } else {
          this.log("⚠️ searchLinkPattern is null, using default pattern");
          searchLinkPatternString = this.platformConfig.searchLinkPattern.toString();
        }
      } catch (error) {
        this.log("❌ Error converting searchLinkPattern to string:", error);
        searchLinkPatternString = this.platformConfig.searchLinkPattern.toString();
      }

      sessionData = {
        tabId: tabId,
        limit: platformState.searchData.limit,
        current: platformState.searchData.current,
        domain: platformState.searchData.domain,
        submittedLinks: platformState.submittedLinks || [],
        searchLinkPattern: searchLinkPatternString,
      };

      // Store the search tab ID properly
      platformState.searchTabId = tabId;
      automation.searchTabId = tabId;

      this.log(`📊 ZipRecruiter session data prepared:`, sessionData);
    } else {
      this.log(`⚠️ No ZipRecruiter automation found for window ${windowId}`);

      // Provide default data structure to prevent errors
      sessionData = {
        tabId: tabId,
        limit: 100,
        current: 0,
        domain: this.platformConfig.domains,
        submittedLinks: [],
        searchLinkPattern: this.platformConfig.searchLinkPattern.toString(),
      };
    }

    // Send response with specific type
    const sent = this.safePortSend(port, {
      type: "SEARCH_TASK_DATA",
      data: sessionData,
    });

    if (!sent) {
      this.log(`❌ Failed to send ZipRecruiter search task data to port ${port.name}`);
    } else {
      this.log(`✅ ZipRecruiter search task data sent successfully to tab ${tabId}`);
    }
  }

  /**
   * Handle profile data request
   */
  async handleGetProfileData(url, port) {
    try {
      // Get user profile from message handler
      const sessionContext = this.messageHandler.getTabSessionContext(
        this.getTabIdFromPort(port)
      );

      if (sessionContext && sessionContext.userProfile) {
        this.safePortSend(port, {
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

      this.safePortSend(port, {
        type: "PROFILE_DATA",
        data: userData,
      });

      this.log("📤 Sent profile data from API");
    } catch (error) {
      this.log(`❌ Error getting profile data: ${error.message}`);
      this.safePortSend(port, {
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

    let sessionData = null;
    let automation = null;

    // Find automation by window ID
    for (const [sessionId, auto] of this.messageHandler.activeAutomations.entries()) {
      if (auto.windowId === windowId) {
        automation = auto;
        this.log(`✅ Found ZipRecruiter automation session: ${sessionId}`);
        break;
      }
    }

    if (automation) {
      // Ensure we have user profile data
      let userProfile = automation.userProfile;

      // If no user profile in automation, try to fetch from user service
      if (!userProfile && automation.userId) {
        try {
          this.log(`📡 Fetching user profile for ZipRecruiter user ${automation.userId}`);
          const { default: UserService } = await import("../../services/user-service.js");
          const userService = new UserService({ userId: automation.userId });
          userProfile = await userService.getUserDetails();

          // Cache it in automation for future use
          automation.userProfile = userProfile;
          this.log(`✅ User profile fetched and cached for ZipRecruiter`);
        } catch (error) {
          this.log(`❌ Failed to fetch user profile for ZipRecruiter:`, error);
        }
      }

      sessionData = {
        devMode: automation.params?.devMode || false,
        profile: userProfile || null,
        session: automation.sessionConfig || null,
        apiHost: automation.apiHost || null,
        userId: automation.userId,
        sessionId: automation.sessionId || null,
        platform: "ziprecruiter",
      };

      this.log(`📊 ZipRecruiter application session data prepared:`, {
        hasProfile: !!sessionData.profile,
        hasSession: !!sessionData.session,
        userId: sessionData.userId,
        devMode: sessionData.devMode,
      });
    } else {
      this.log(`⚠️ No ZipRecruiter automation found for window ${windowId}`);

      // Provide default data structure
      sessionData = {
        devMode: false,
        profile: null,
        session: null,
        apiHost: null,
        userId: null,
        sessionId: null,
        platform: "ziprecruiter",
      };
    }

    // Send response with specific type
    const sent = this.safePortSend(port, {
      type: "APPLICATION_TASK_DATA",
      data: sessionData,
    });

    if (!sent) {
      this.log(`❌ Failed to send ZipRecruiter application task data to port ${port.name}`);
    } else {
      this.log(`✅ ZipRecruiter application task data sent successfully to tab ${tabId}`);
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
      // Find the automation instance
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

      // Check if already processing
      if (automation.platformState.isProcessingJob) {
        this.log(`⚠️ ZipRecruiter automation already processing job, ignoring duplicate request`);
        this.safePortSend(port, {
          type: "DUPLICATE",
          message: "Already processing a job application",
        });
        return;
      }

      // Check for duplicate application
      const normalizedUrl = this.messageHandler.normalizeUrl(url);
      const alreadyApplied = automation.platformState.submittedLinks.some(
        (link) => this.messageHandler.normalizeUrl(link.url) === normalizedUrl
      );

      if (alreadyApplied) {
        const message = `Job already applied: ${title || url}`;
        this.log(`⚠️ ${message}`);
        
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

      // Set processing state
      automation.platformState.isProcessingJob = true;
      automation.platformState.currentJobUrl = url;
      automation.platformState.applicationStartTime = Date.now();

      // Set application timeout (15 minutes)
      const timeoutId = setTimeout(() => {
        this.log(`⏰ ZipRecruiter application timeout for ${url}`);
        this.handleApplicationTimeout(automation, url, tabId);
      }, 15 * 60 * 1000); // 15 minutes

      this.applicationTimeouts.set(url, timeoutId);

      // Create new tab for application or use current tab depending on ZipRecruiter behavior
      let jobTabId = tabId;
      if (url !== port.sender?.tab?.url) {
        const jobTab = await chrome.tabs.create({
          url: url,
          windowId: windowId,
          active: false,
        });
        jobTabId = jobTab.id;
        automation.platformState.currentJobTabId = jobTabId;
      }

      // Send response
      this.log(`✅ Started application process for: ${title || url}`);
      this.safePortSend(port, {
        type: "APPLICATION_START_RESPONSE",
        requestId,
        success: true,
        message: "Application process started",
        data: { url, title, company, tabId: jobTabId },
      });

      // Notify session manager
      await this.messageHandler.sessionManager.addNotification(sessionId, {
        type: "application_started",
        jobUrl: url,
        jobTitle: title,
        tabId: jobTabId,
      });

    } catch (error) {
      this.log(`❌ Error in handleStartApplication:`, error);
      
      // Clean up on error
      const automation = this.findAutomationByWindow(windowId);
      if (automation) {
        automation.platformState.isProcessingJob = false;
        automation.platformState.currentJobUrl = null;
        automation.platformState.applicationStartTime = null;
      }
      
      // Clear any timeout
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
   * Handle application timeout
   */
  async handleApplicationTimeout(automation, url, tabId) {
    try {
      this.log(`⏰ ZipRecruiter application timeout for ${url} in tab ${tabId}`);

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
          this.log(`⚠️ Error closing timeout tab ${tabId}:`, error);
        }
      }

      // Reset automation state
      automation.platformState.isProcessingJob = false;
      automation.platformState.currentJobUrl = null;
      automation.platformState.currentJobTabId = null;
      automation.platformState.applicationStartTime = null;

      // Mark as timeout in submitted links
      automation.platformState.submittedLinks.push({
        url,
        status: "TIMEOUT",
        message: "Application timed out after 15 minutes",
        timestamp: Date.now(),
      });

      // Send search next to continue automation
      await this.sendSearchNextMessage(automation.windowId, {
        url,
        status: "TIMEOUT",
        message: "Application timed out",
      });

      this.log(`❌ Application timed out: ${url}`);
    } catch (error) {
      this.log("❌ Error handling application timeout:", error);
    }
  }

  /**
   * Handle check application status
   */
  async handleCheckApplicationStatus(port, requestId) {
    try {
      const tabId = port?.sender?.tab?.id;
      const windowId = port?.sender?.tab?.windowId;
      
      const automation = this.findAutomationByWindow(windowId);
      if (!automation) {
        this.safePortSend(port, {
          type: "ERROR",
          message: "Automation session not found",
        });
        return;
      }

      const statusData = {
        inProgress: automation.platformState.isProcessingJob,
        url: automation.platformState.currentJobUrl,
        tabId: automation.platformState.currentJobTabId,
        applicationStartTime: automation.platformState.applicationStartTime,
      };

      this.safePortSend(port, {
        type: "APPLICATION_STATUS",
        requestId: requestId,
        data: statusData,
      });

      // Also send via chrome.tabs.sendMessage for redundancy
      if (requestId && tabId) {
        try {
          chrome.tabs.sendMessage(tabId, {
            type: "APPLICATION_STATUS",
            requestId: requestId,
            data: statusData,
          });
        } catch (error) {
          this.log("Error sending redundant status message:", error);
        }
      }
    } catch (error) {
      this.log(`❌ Error checking ZipRecruiter application status:`, error);
      this.safePortSend(port, {
        type: "ERROR",
        message: "Failed to check application status",
      });
    }
  }

  /**
   * Handle search next ready notification
   */
  async handleSearchNextReady(port, sessionId) {
    this.log(`📋 ZipRecruiter search ready for session ${sessionId}`);
    this.safePortSend(port, {
      type: "SUCCESS",
      message: "Search next ready acknowledged",
    });
  }

  /**
   * Handle search completion
   */
  async handleSearchCompleted(port, sessionId, windowId) {
    try {
      this.log(`🏁 ZipRecruiter search completed for session ${sessionId}`);

      const automation = this.findAutomationBySession(sessionId);
      if (automation) {
        // Mark automation as completed
        automation.status = "completed";
        automation.endTime = Date.now();

        // Update session
        await this.messageHandler.sessionManager.updateSession(sessionId, {
          status: "completed",
          completedAt: Date.now(),
        });

        // Notify session manager
        await this.messageHandler.sessionManager.addNotification(sessionId, {
          type: "automation_completed",
          completedJobs: automation.platformState.submittedLinks.length,
          totalTime: Date.now() - automation.startTime,
        });
      }

      // Show completion notification
      try {
        chrome.notifications.create({
          type: "basic",
          iconUrl: "icon.png",
          title: "ZipRecruiter Job Search Completed",
          message: `Successfully completed job application automation.`,
        });
      } catch (error) {
        this.log("Error showing notification:", error);
      }

      this.safePortSend(port, {
        type: "SUCCESS",
        message: "Search completion acknowledged",
      });
    } catch (error) {
      this.log(`❌ Error handling ZipRecruiter search completion:`, error);
      this.safePortSend(port, {
        type: "ERROR",
        message: "Failed to handle search completion",
      });
    }
  }

  /**
   * Override task completion handling for ZipRecruiter-specific logic
   */
  async handleTaskCompletion(port, data, status) {
    try {
      // Clear any application timeout
      if (data && data.url && this.applicationTimeouts.has(data.url)) {
        clearTimeout(this.applicationTimeouts.get(data.url));
        this.applicationTimeouts.delete(data.url);
      }

      // Track job application via API for successful applications
      if (status === "SUCCESS") {
        try {
          const tabId = port.sender?.tab?.id;
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
      }

      // Call parent method for common completion logic
      await super.handleTaskCompletion(port, data, status);
    } catch (error) {
      this.log(`❌ Error handling ZipRecruiter task completion:`, error);
    }
  }

  /**
   * Find automation by session ID
   */
  findAutomationBySession(sessionId) {
    return this.messageHandler.activeAutomations.get(sessionId);
  }

  /**
   * Find automation by window ID
   */
  findAutomationByWindow(windowId) {
    for (const automation of this.messageHandler.activeAutomations.values()) {
      if (automation.windowId === windowId) {
        return automation;
      }
    }
    return null;
  }

  /**
   * Override base class method to provide ZipRecruiter-specific continuation logic
   */
  async continueOrComplete(automation, windowId, status, data) {
    if (status === "SUCCESS") {
      automation.platformState.searchData.current++;
    }

    const oldUrl = automation.platformState.currentJobUrl;
    const errorCount = this.logCounts.get(automation.sessionId) || 0;
    const delay = status === "ERROR" ? Math.min(3000 * errorCount, 15000) : 0;

    setTimeout(async () => {
      const searchTabId = automation.searchTabId || automation.platformState.searchTabId;

      if (searchTabId) {
        try {
          await chrome.tabs.sendMessage(searchTabId, {
            action: "platformMessage",
            type: "SEARCH_NEXT",
            data: {
              url: oldUrl,
              status: status,
              data: data,
              message: typeof data === "string" 
                ? data 
                : status === "ERROR" 
                ? "Application error" 
                : undefined,
              submittedLinks: automation.platformState.submittedLinks || [],
              current: automation.platformState.searchData.current || 0,
            },
          });
          this.log(`✅ Sent SEARCH_NEXT with updated data to ZipRecruiter search tab ${searchTabId}`);
        } catch (error) {
          this.log(`❌ Failed to send SEARCH_NEXT to tab ${searchTabId}:`, error);
        }
      } else {
        this.log("❌ No search tab ID available for ZipRecruiter");
      }
    }, delay);
  }

  /**
   * Enhanced cleanup for ZipRecruiter-specific resources
   */
  cleanup() {
    this.log("🧹 Starting ZipRecruiterAutomationHandler cleanup");

    // Clear all application timeouts
    for (const timeoutId of this.applicationTimeouts.values()) {
      clearTimeout(timeoutId);
    }
    this.applicationTimeouts.clear();

    // Clear processed completions
    this.processedCompletions.clear();

    // Call parent cleanup
    super.cleanup();

    this.log("✅ ZipRecruiterAutomationHandler cleanup completed");
  }
}