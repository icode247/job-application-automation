// background/message-handler.js
import AutomationOrchestrator from "../core/automation-orchestrator.js";
import SessionManager from "./session-manager.js";
import WindowManager from "./window-manager.js";
import LeverAutomationHandler from "./platforms/lever.js";
import RecruiteeAutomationHandler from "./platforms/recruitee.js";
import LinkedInAutomationHandler from "./platforms/linkedin.js";
import BreezyAutomationHandler from "./platforms/breezy.js";
import ZipRecruiterAutomationHandler from "./platforms/ziprecruiter.js";
import AshbyAutomationHandler from "./platforms/ashby.js";
import IndeedAutomationHandler from "./platforms/indeed.js";
import GlassdoorAutomationHandler from "./platforms/glassdoor.js";
import WorkableAutomationHandler from "./platforms/workable.js";
import WellfoundAutomationHandler from "./platforms/wellfound.js";

export default class MessageHandler {
  constructor() {
    this.orchestrator = new AutomationOrchestrator();
    this.sessionManager = new SessionManager();
    this.windowManager = new WindowManager();

    this.activeAutomations = new Map();
    this.portConnections = new Map();
    this.platformHandlers = new Map();
    this.tabSessions = new Map();
    this.pendingRequests = new Set();

    this.profileInjectionStatus = new Map();

    this.setupPortHandlers();
    this.setupTabListeners();
  }

  setupTabListeners() {
    chrome.tabs.onCreated.addListener((tab) => {
      this.handleTabCreated(tab);
    });

    chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
      if (changeInfo.status === "complete") {
        this.handleTabUpdated(tab);
      }
    });

    chrome.tabs.onRemoved.addListener((tabId) => {
      this.tabSessions.delete(tabId);
      this.portConnections.delete(tabId);
      this.profileInjectionStatus.delete(tabId);
    });
  }

  handleTabCreated(tab) {
    const sessionId = this.orchestrator.getSessionForWindow(tab.windowId);

    if (sessionId) {
      console.log(
        `🆕 New tab ${tab.id} created in automation window ${tab.windowId}`
      );

      const automation = this.activeAutomations.get(sessionId);
      if (automation) {
        if (
          automation.userProfile &&
          !automation.userProfile.userId &&
          automation.userId
        ) {
          automation.userProfile.userId = automation.userId;
          console.log(
            `🔧 Added missing userId to automation profile: ${automation.userId}`
          );
        }

        const sessionContext = {
          sessionId: sessionId,
          platform: automation.platform,
          userId: automation.userId,
          windowId: tab.windowId,
          isAutomationTab: true,
          createdAt: Date.now(),
          parentSessionId: sessionId,
          userProfile: automation.userProfile,
          sessionConfig: automation.sessionConfig,
          apiHost: automation.sessionConfig?.apiHost,
          preferences: automation.sessionConfig?.preferences || {},
        };

        this.tabSessions.set(tab.id, sessionContext);

        this.profileInjectionStatus.set(tab.id, {
          injected: false,
          attempts: 0,
          lastAttempt: 0,
        });

        console.log(`✅ Session context stored for tab ${tab.id}:`, {
          sessionId,
          platform: automation.platform,
          hasUserProfile: !!sessionContext.userProfile,
          hasSessionConfig: !!sessionContext.sessionConfig,
        });

        if (
          sessionContext.userProfile &&
          this.isUserProfileComplete(sessionContext.userProfile)
        ) {
          this.scheduleProfileInjection(tab.id, sessionContext, 500);
        }

        this.orchestrator.handleTabCreated(tab.id, tab.windowId);
      }
    }
  }

  async handleTabUpdated(tab) {
    const sessionData = this.tabSessions.get(tab.id);
    const isAutomationWindow = this.orchestrator.isAutomationWindow(
      tab.windowId
    );

    if ((sessionData || isAutomationWindow) && tab.url) {
      try {
        let contextToInject = sessionData;

        if (!contextToInject && isAutomationWindow) {
          const sessionId = this.orchestrator.getSessionForWindow(tab.windowId);
          const automation = this.activeAutomations.get(sessionId);

          if (automation) {
            if (
              automation.userProfile &&
              !automation.userProfile.userId &&
              automation.userId
            ) {
              automation.userProfile.userId = automation.userId;
              console.log(
                `🔧 Added missing userId to automation profile: ${automation.userId}`
              );
            }

            contextToInject = {
              sessionId: sessionId,
              platform: automation.platform,
              userId: automation.userId,
              windowId: tab.windowId,
              isAutomationTab: true,
              userProfile: automation.userProfile,
              sessionConfig: automation.sessionConfig,
              apiHost: automation.sessionConfig?.apiHost,
              preferences: automation.sessionConfig?.preferences || {},
            };

            this.tabSessions.set(tab.id, contextToInject);

            if (!this.profileInjectionStatus.has(tab.id)) {
              this.profileInjectionStatus.set(tab.id, {
                injected: false,
                attempts: 0,
                lastAttempt: 0,
              });
            }
          }
        }

        if (
          contextToInject &&
          this.isUserProfileComplete(contextToInject.userProfile)
        ) {
          const injectionStatus = this.profileInjectionStatus.get(tab.id);
          const shouldInject =
            !injectionStatus?.injected ||
            injectionStatus.attempts < 3 ||
            Date.now() - injectionStatus.lastAttempt > 10000;

          if (shouldInject) {
            console.log(
              `🔄 Tab ${tab.id} updated, scheduling profile injection`
            );
            this.scheduleProfileInjection(tab.id, contextToInject, 1000);
          } else {
            console.log(
              `⏭️ Skipping profile injection for tab ${tab.id} - already injected`
            );
          }
        }
      } catch (error) {
        console.error(`❌ Error in handleTabUpdated for tab ${tab.id}:`, error);
      }
    }
  }

  scheduleProfileInjection(tabId, sessionContext, delay = 1000) {
    setTimeout(async () => {
      try {
        const injectionStatus = this.profileInjectionStatus.get(tabId) || {
          injected: false,
          attempts: 0,
          lastAttempt: 0,
        };

        if (
          injectionStatus.injected &&
          Date.now() - injectionStatus.lastAttempt < 5000
        ) {
          console.log(
            `⏭️ Skipping profile injection for tab ${tabId} - recently injected`
          );
          return;
        }

        if (injectionStatus.attempts >= 5) {
          console.log(
            `⏭️ Skipping profile injection for tab ${tabId} - max attempts reached`
          );
          return;
        }

        console.log(
          `💉 Attempting profile injection for tab ${tabId} (attempt ${
            injectionStatus.attempts + 1
          })`
        );

        const success = await this.injectEnhancedSessionContext(
          tabId,
          sessionContext
        );

        // Update injection status
        this.profileInjectionStatus.set(tabId, {
          injected: success,
          attempts: injectionStatus.attempts + 1,
          lastAttempt: Date.now(),
        });

        if (success) {
          console.log(`✅ Profile injection successful for tab ${tabId}`);
        } else {
          console.warn(`⚠️ Profile injection failed for tab ${tabId}`);

          // Retry with exponential backoff
          if (injectionStatus.attempts < 3) {
            const retryDelay = Math.min(
              2000 * Math.pow(2, injectionStatus.attempts),
              10000
            );
            console.log(
              `🔄 Retrying profile injection for tab ${tabId} in ${retryDelay}ms`
            );
            this.scheduleProfileInjection(tabId, sessionContext, retryDelay);
          }
        }
      } catch (error) {
        console.error(
          `❌ Error in scheduled profile injection for tab ${tabId}:`,
          error
        );
      }
    }, delay);
  }

  async injectEnhancedSessionContext(tabId, sessionData) {
    try {
      if (!sessionData || !sessionData.sessionId || !sessionData.platform) {
        console.warn(
          `⚠️ Invalid session data for tab ${tabId}, skipping injection`
        );
        return false;
      }

      if (!this.isUserProfileComplete(sessionData.userProfile)) {
        console.warn(`⚠️ Incomplete user profile for tab ${tabId}:`, {
          hasProfile: !!sessionData.userProfile,
          hasUserId: !!sessionData.userProfile?.userId,
          hasEmail: !!sessionData.userProfile?.email,
          hasName: !!(
            sessionData.userProfile?.name || sessionData.userProfile?.firstName
          ),
        });
        return false;
      }

      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        func: (sessionData) => {
          try {
            // ✅ FIXED: More robust injection with validation
            console.log("🔧 Injecting enhanced session context:", {
              sessionId: sessionData.sessionId,
              platform: sessionData.platform,
              hasUserProfile: !!sessionData.userProfile,
              userProfileKeys: sessionData.userProfile
                ? Object.keys(sessionData.userProfile)
                : [],
            });

            // Store session data in window (highest priority)
            window.automationSessionId = sessionData.sessionId;
            window.automationPlatform = sessionData.platform;
            window.automationUserId = sessionData.userId;
            window.isAutomationWindow = true;
            window.isAutomationTab = true;
            window.parentSessionId = sessionData.parentSessionId;

            if (
              sessionData.userProfile &&
              sessionData.userProfile.userId &&
              sessionData.userProfile.email &&
              (sessionData.userProfile.name ||
                sessionData.userProfile.firstName)
            ) {
              window.automationUserProfile = sessionData.userProfile;
              console.log("✅ User profile injected into window:", {
                userId: sessionData.userProfile.userId,
                email: sessionData.userProfile.email,
                name:
                  sessionData.userProfile.name ||
                  sessionData.userProfile.firstName,
              });
            } else {
              console.warn(
                "⚠️ User profile validation failed during injection"
              );
            }

            // Store session config and API host
            if (sessionData.sessionConfig) {
              window.automationSessionConfig = sessionData.sessionConfig;
            }
            if (sessionData.apiHost) {
              window.automationApiHost = sessionData.apiHost;
            }

            try {
              sessionStorage.setItem(
                "automationSessionId",
                sessionData.sessionId
              );
              sessionStorage.setItem(
                "automationPlatform",
                sessionData.platform
              );
              sessionStorage.setItem("automationUserId", sessionData.userId);
              sessionStorage.setItem("isAutomationWindow", "true");
              sessionStorage.setItem("isAutomationTab", "true");
              sessionStorage.setItem(
                "parentSessionId",
                sessionData.parentSessionId
              );

              if (
                sessionData.userProfile &&
                sessionData.userProfile.userId &&
                sessionData.userProfile.email
              ) {
                sessionStorage.setItem(
                  "automationUserProfile",
                  JSON.stringify(sessionData.userProfile)
                );
                console.log("✅ User profile stored in sessionStorage");
              }

              if (sessionData.sessionConfig) {
                sessionStorage.setItem(
                  "automationSessionConfig",
                  JSON.stringify(sessionData.sessionConfig)
                );
              }
              if (sessionData.apiHost) {
                sessionStorage.setItem(
                  "automationApiHost",
                  sessionData.apiHost
                );
              }
            } catch (storageError) {
              console.warn(
                "⚠️ Failed to store in sessionStorage:",
                storageError
              );
            }

            // Set injection markers
            window.automationContextInjected = true;
            window.automationContextTimestamp = Date.now();
            window.automationProfileInjected = !!sessionData.userProfile;

            console.log("✅ Enhanced session context injection completed");
            return true;
          } catch (error) {
            console.error("❌ Error during context injection:", error);
            return false;
          }
        },
        args: [sessionData],
      });

      return true;
    } catch (error) {
      console.error(
        `❌ Failed to inject session context into tab ${tabId}:`,
        error
      );
      return false;
    }
  }

  isUserProfileComplete(profile) {
    if (!profile || typeof profile !== "object") {
      console.warn("⚠️ Profile validation failed: No profile object provided");
      return false;
    }

    const requiredFields = ["userId", "email"];
    const missingFields = [];

    for (const field of requiredFields) {
      if (!profile[field] || profile[field].toString().trim() === "") {
        missingFields.push(field);
      }
    }

    const hasName = profile.name || profile.firstName || profile.fullName;
    if (!hasName) {
      missingFields.push("name/firstName/fullName");
    }

    if (missingFields.length > 0) {
      console.warn(
        "⚠️ Profile validation failed - missing fields:",
        missingFields
      );
      console.warn("⚠️ Available profile fields:", Object.keys(profile));
      return false;
    }

    return true;
  }

  async handleStartApplying(request, sendResponse) {
    try {
      console.log("📨 Start applying request received:", request);

      const validation = this.validateStartApplyingRequest(request);
      if (!validation.valid) {
        sendResponse({ status: "error", message: validation.error });
        return;
      }

      const {
        platform,
        userId,
        jobsToApply,
        submittedLinks = [],
        userPlan,
        userCredits,
        dailyRemaining,
        preferences = {},
        apiHost = "https://fastapply.co",
      } = request;

      let userProfile = null;
      try {
        console.log(`📡 Fetching user profile for user ${userId}`);
        const response = await fetch(`${apiHost}/api/user/${userId}`);
        if (response.ok) {
          userProfile = await response.json();

          if (userProfile && !userProfile.userId) {
            userProfile.userId = userId;
            console.log(`🔧 Added missing userId to user profile: ${userId}`);
          }

          if (this.isUserProfileComplete(userProfile)) {
          } else {
            console.warn(`⚠️ Incomplete user profile fetched:`, {
              hasUserId: !!userProfile?.userId,
              hasEmail: !!userProfile?.email,
              hasName: !!(userProfile?.name || userProfile?.firstName),
              profileKeys: userProfile
                ? Object.keys(userProfile).slice(0, 10)
                : [], // Show first 10 keys
              profileSample: userProfile
                ? {
                    userId: userProfile.userId,
                    email: userProfile.email,
                    name: userProfile.name,
                    firstName: userProfile.firstName,
                  }
                : null,
            });
          }
        } else {
          console.warn(`⚠️ Failed to fetch user profile: ${response.status}`);
        }
      } catch (error) {
        console.error(`❌ Error fetching user profile:`, error);
      }

      if (!this.isUserProfileComplete(userProfile)) {
        const missingFields = [];
        if (!userProfile?.userId) missingFields.push("userId");
        if (!userProfile?.email) missingFields.push("email");
        if (
          !userProfile?.name &&
          !userProfile?.firstName &&
          !userProfile?.fullName
        )
          missingFields.push("name");

        const errorMessage = `Network Error, Please check your internet and try again....`;
        console.error("❌ " + errorMessage);
        console.error(
          "❌ Available profile fields:",
          userProfile ? Object.keys(userProfile) : "No profile"
        );
        sendResponse({ status: "error", message: errorMessage });
        return;
      }

      // Create automation session
      const sessionId = await this.sessionManager.createSession({
        userId,
        platform,
        jobsToApply,
        submittedLinks,
        userPlan,
        userCredits,
        dailyRemaining,
        userProfile,
        startTime: Date.now(),
        status: "starting",
      });

      // Start automation with user profile
      const result = await this.orchestrator.startAutomation({
        sessionId,
        platform,
        userId,
        jobsToApply,
        preferences,
        apiHost,
        userProfile,
      });

      if (result.success) {
        const automationInstance = result.automationInstance;

        automationInstance.platform = platform;
        automationInstance.userId = userId;

        if (userProfile && !userProfile.userId) {
          userProfile.userId = userId;
          console.log(
            `🔧 Added missing userId to user profile before storing: ${userId}`
          );
        }

        automationInstance.userProfile = userProfile;
        automationInstance.sessionConfig = {
          sessionId,
          platform,
          userId,
          userProfile,
          apiHost,
          preferences,
        };

        automationInstance.platformState = {
          isProcessingJob: false,
          currentJobUrl: null,
          currentJobTabId: null,
          applicationStartTime: null,
          submittedLinks: submittedLinks || [],
          searchTabId: null,
          searchData: {
            limit: jobsToApply,
            current: 0,
            domain: this.getPlatformDomains(platform),
            searchLinkPattern: this.getPlatformLinkPattern(platform),
          },
        };

        this.activeAutomations.set(sessionId, automationInstance);

        console.log(
          `🪟 Window ${result.windowId} mapped to session ${sessionId}`
        );
        console.log(`👤 Complete user profile stored in automation:`, {
          hasProfile: !!automationInstance.userProfile,
          userId: automationInstance.userProfile?.userId,
          email: automationInstance.userProfile?.email,
          name:
            automationInstance.userProfile?.name ||
            automationInstance.userProfile?.firstName,
        });

        await this.injectProfileIntoWindowTabs(result.windowId, {
          sessionId,
          platform,
          userId,
          userProfile,
          sessionConfig: automationInstance.sessionConfig,
          apiHost,
          preferences,
        });

        sendResponse({
          status: "started",
          platform: platform,
          sessionId: sessionId,
          windowId: result.windowId,
          message: `Job search started for ${platform}! Applying to ${jobsToApply} jobs.`,
        });

        this.notifyFrontend({
          type: "automation_started",
          sessionId,
          platform,
          jobsToApply,
        });
      } else {
        await this.sessionManager.updateSession(sessionId, {
          status: "failed",
          error: result.error,
        });

        sendResponse({
          status: "error",
          message: result.error || "Failed to start automation",
        });
      }
    } catch (error) {
      console.error("Error in handleStartApplying:", error);
      sendResponse({
        status: "error",
        message: "An unexpected error occurred while starting automation",
      });
    }
  }

  async injectProfileIntoWindowTabs(windowId, sessionContext) {
    try {
      const tabs = await chrome.tabs.query({ windowId: windowId });

      for (const tab of tabs) {
        if (tab.url && !tab.url.startsWith("chrome://")) {
          console.log(`💉 Injecting profile into existing tab ${tab.id}`);

          // Store tab session
          this.tabSessions.set(tab.id, {
            ...sessionContext,
            windowId: tab.windowId,
            isAutomationTab: true,
            createdAt: Date.now(),
          });

          // Initialize injection tracking
          this.profileInjectionStatus.set(tab.id, {
            injected: false,
            attempts: 0,
            lastAttempt: 0,
          });

          // Schedule immediate injection
          this.scheduleProfileInjection(tab.id, sessionContext, 100);
        }
      }
    } catch (error) {
      console.error("❌ Error injecting profile into window tabs:", error);
    }
  }

  handleInternalMessage(request, sender, sendResponse) {
    switch (request.action) {
      case "checkIfAutomationWindow":
        return this.handleCheckIfAutomationWindow(sender, sendResponse);

      case "getFullSessionContext":
        return this.handleGetFullSessionContext(request, sender, sendResponse);

      case "contentScriptReady":
        this.handleContentScriptReady(request, sender, sendResponse);
        break;

      case "reportProgress":
        this.handleProgressReport(request, sender, sendResponse);
        break;

      case "reportError":
        this.handleErrorReport(request, sender, sendResponse);
        break;

      case "applicationSubmitted":
        this.handleApplicationSubmitted(request, sender, sendResponse);
        break;

      default:
        sendResponse({ error: "Unknown internal action" });
    }

    return true;
  }

  async handleCheckIfAutomationWindow(sender, sendResponse) {
    try {
      let isAutomationWindow = false;
      let sessionContext = null;

      if (sender.tab) {
        const windowManagerCheck = this.windowManager.isAutomationWindow(
          sender.tab.windowId
        );
        const orchestratorCheck = this.orchestrator.isAutomationWindow(
          sender.tab.windowId
        );
        const hasTabSession = this.tabSessions.has(sender.tab.id);

        isAutomationWindow =
          windowManagerCheck || orchestratorCheck || hasTabSession;

        console.log(
          `🔍 Automation window check for window ${sender.tab.windowId}, tab ${sender.tab.id}:`,
          {
            windowManagerCheck,
            orchestratorCheck,
            hasTabSession,
            isAutomationWindow,
          }
        );

        if (isAutomationWindow && !hasTabSession) {
          const sessionId = this.orchestrator.getSessionForWindow(
            sender.tab.windowId
          );
          if (sessionId) {
            const automation = this.activeAutomations.get(sessionId);
            if (
              automation &&
              this.isUserProfileComplete(automation.userProfile)
            ) {
              if (!automation.userProfile.userId && automation.userId) {
                automation.userProfile.userId = automation.userId;
                console.log(
                  `🔧 Added missing userId to automation profile: ${automation.userId}`
                );
              }

              sessionContext = {
                sessionId,
                platform: automation.platform,
                userId: automation.userId,
                windowId: sender.tab.windowId,
                isAutomationTab: true,
                userProfile: automation.userProfile,
                sessionConfig: automation.sessionConfig,
                apiHost: automation.sessionConfig?.apiHost,
                preferences: automation.sessionConfig?.preferences || {},
              };

              this.tabSessions.set(sender.tab.id, sessionContext);
              console.log(
                `✅ Created missing tab session for tab ${sender.tab.id}`
              );

              // Schedule profile injection
              this.scheduleProfileInjection(sender.tab.id, sessionContext, 500);
            }
          }
        }
      }

      sendResponse({
        isAutomationWindow,
        sessionContext: sessionContext || this.tabSessions.get(sender.tab?.id),
      });
      return true;
    } catch (error) {
      console.error("Error checking automation window:", error);
      sendResponse({ isAutomationWindow: false, error: error.message });
      return true;
    }
  }

  async handleGetFullSessionContext(request, sender, sendResponse) {
    try {
      const tabId = sender.tab?.id;
      const windowId = sender.tab?.windowId;

      if (!tabId || !windowId) {
        sendResponse({ error: "Invalid tab or window ID" });
        return true;
      }

      let sessionContext = this.tabSessions.get(tabId);

      if (!sessionContext) {
        const sessionId = this.orchestrator.getSessionForWindow(windowId);
        if (sessionId) {
          const automation = this.activeAutomations.get(sessionId);
          if (
            automation &&
            this.isUserProfileComplete(automation.userProfile)
          ) {
            sessionContext = {
              sessionId,
              platform: automation.platform,
              userId: automation.userId,
              windowId: windowId,
              isAutomationTab: true,
              userProfile: automation.userProfile,
              sessionConfig: automation.sessionConfig,
              apiHost: automation.sessionConfig?.apiHost,
              preferences: automation.sessionConfig?.preferences || {},
            };

            this.tabSessions.set(tabId, sessionContext);
            console.log(`✅ Created session context for tab ${tabId}`);
          }
        }
      }

      sendResponse({
        sessionContext: sessionContext || null,
        success: !!sessionContext,
      });
      return true;
    } catch (error) {
      console.error("Error getting full session context:", error);
      sendResponse({ error: error.message });
      return true;
    }
  }

  handleContentScriptReady(request, sender, sendResponse) {
    const { sessionId, platform, url, userId, profileComplete } = request;
    console.log(
      `📱 Content script ready: ${platform} session ${sessionId} tab ${sender.tab?.id}`
    );

    if (sender.tab && !this.tabSessions.has(sender.tab.id)) {
      const automation =
        this.activeAutomations.get(sessionId) ||
        this.findAutomationByWindow(sender.tab.windowId);

      if (automation && this.isUserProfileComplete(automation.userProfile)) {
        if (!automation.userProfile.userId && automation.userId) {
          automation.userProfile.userId = automation.userId;
          console.log(
            `🔧 Added missing userId to automation profile: ${automation.userId}`
          );
        }

        const sessionContext = {
          sessionId: sessionId || automation.sessionId,
          platform: platform || automation.platform,
          userId: userId || automation.userId,
          windowId: sender.tab.windowId,
          isAutomationTab: true,
          createdAt: Date.now(),
          userProfile: automation.userProfile,
          sessionConfig: automation.sessionConfig,
          apiHost: automation.sessionConfig?.apiHost,
          preferences: automation.sessionConfig?.preferences || {},
        };

        this.tabSessions.set(sender.tab.id, sessionContext);
        console.log(`📊 Session context stored for ready tab ${sender.tab.id}`);
      }
    }

    const automation =
      this.activeAutomations.get(sessionId) ||
      this.findAutomationByWindow(sender.tab?.windowId);

    if (
      automation &&
      sender.tab &&
      this.isUserProfileComplete(automation.userProfile)
    ) {
      setTimeout(async () => {
        try {
          const sessionContext = {
            sessionId: sessionId || automation.sessionId,
            platform: platform || automation.platform,
            userId: userId || automation.userId,
            userProfile: automation.userProfile,
            sessionConfig: automation.sessionConfig,
            preferences: automation.sessionConfig?.preferences || {},
            apiHost: automation.sessionConfig?.apiHost,
          };

          await chrome.tabs.sendMessage(sender.tab.id, {
            action: "startAutomation",
            sessionId: sessionContext.sessionId,
            config: automation.getConfig ? automation.getConfig() : {},
            sessionContext: sessionContext,
          });

          console.log(
            `📤 Sent start message with full context to content script for session ${sessionContext.sessionId}`
          );
        } catch (error) {
          console.error(
            `❌ Failed to send start message to content script:`,
            error
          );
        }
      }, 1000);
    }

    sendResponse({ success: true });
  }

  findAutomationByWindow(windowId) {
    if (!windowId) return null;

    const sessionId = this.orchestrator.getSessionForWindow(windowId);
    if (sessionId) {
      return this.activeAutomations.get(sessionId);
    }

    return null;
  }

  getTabSessionContext(tabId) {
    const sessionData = this.tabSessions.get(tabId);
    if (!sessionData) return null;

    const automation = this.activeAutomations.get(sessionData.sessionId);
    if (!automation) return null;

    return {
      sessionId: sessionData.sessionId,
      platform: sessionData.platform,
      userId: sessionData.userId,
      userProfile: automation.userProfile,
      sessionConfig: automation.sessionConfig,
      preferences: automation.sessionConfig?.preferences || {},
      apiHost: automation.sessionConfig?.apiHost,
    };
  }

  async handleWindowClosed(windowId) {
    console.log(`🪟 Window ${windowId} closed, performing thorough cleanup...`);

    const sessionId = this.orchestrator.getSessionForWindow(windowId);

    if (sessionId) {
      const automation = this.activeAutomations.get(sessionId);
      if (automation) {
        console.log(
          `🛑 Properly stopping automation ${sessionId} for closed window ${windowId}`
        );

        // ✅ CRITICAL FIX: Properly stop the automation instead of just deleting it
        try {
          // Call the automation's stop method to clean up properly
          await automation.stop();

          // Update session status in database
          await this.sessionManager.updateSession(sessionId, {
            status: "stopped",
            stoppedAt: Date.now(),
            reason: "Window closed by user",
            endTime: Date.now(),
          });

          // Notify frontend about the stop
          this.notifyFrontend({
            type: "automation_stopped",
            sessionId,
            platform: automation.platform,
            reason: "Window closed",
            timestamp: Date.now(),
          });

          console.log(
            `✅ Automation ${sessionId} properly stopped and cleaned up`
          );
        } catch (error) {
          console.error(`❌ Error stopping automation ${sessionId}:`, error);

          // Force cleanup even if stop() fails
          await this.sessionManager.updateSession(sessionId, {
            status: "interrupted",
            interruptedAt: Date.now(),
            reason: "Window closed - forced cleanup",
            error: error.message,
          });
        }

        // Remove from active automations after proper cleanup
        this.activeAutomations.delete(sessionId);

        // Clear any pending requests
        const platform = automation.platform;
        const userId = automation.userId;
        const requestKey = `startApplying_${userId}_${platform}`;

        if (this.pendingRequests.has(requestKey)) {
          this.pendingRequests.delete(requestKey);
          console.log(`🧹 Cleaned up pending request: ${requestKey}`);
        }
      }
    }

    // Clean up tab sessions for this window
    const tabsToRemove = [];
    for (const [tabId, sessionData] of this.tabSessions.entries()) {
      if (sessionData.windowId === windowId) {
        tabsToRemove.push(tabId);
      }
    }

    for (const tabId of tabsToRemove) {
      this.tabSessions.delete(tabId);
      this.profileInjectionStatus.delete(tabId);
      console.log(`🧹 Cleaned up tab ${tabId} session and injection tracking`);
    }

    // Clean up orchestrator and window manager
    await this.orchestrator.handleWindowClosed(windowId);
    await this.windowManager.handleWindowClosed(windowId);

    console.log(`✅ Complete cleanup finished for window ${windowId}`);
  }

  initializePlatformHandler(platform) {
    if (this.platformHandlers.has(platform)) {
      return this.platformHandlers.get(platform);
    }

    console.log(`🔧 Initializing platform handler for: ${platform}`);

    let handler = null;

    switch (platform) {
      case "lever":
        handler = new LeverAutomationHandler(this);
        break;
      case "workable":
        handler = new WorkableAutomationHandler(this);
        break;
      case "recruitee":
        handler = new RecruiteeAutomationHandler(this);
        break;
      case "linkedin":
        handler = new LinkedInAutomationHandler(this);
        break;
      case "breezy":
        handler = new BreezyAutomationHandler(this);
        break;
      case "ziprecruiter":
        handler = new ZipRecruiterAutomationHandler(this);
        break;
      case "ashby":
        handler = new AshbyAutomationHandler(this);
        break;
      case "indeed":
        handler = new IndeedAutomationHandler(this);
        break;
      case "glassdoor":
        handler = new GlassdoorAutomationHandler(this);
        break;
      case "wellfound":
        handler = new WellfoundAutomationHandler(this);
        break;
      default:
        console.error(`❌ Unsupported platform: ${platform}`);
        return null;
    }

    if (handler) {
      this.platformHandlers.set(platform, handler);
      console.log(`✅ Platform handler initialized for: ${platform}`);
    }

    return handler;
  }

  getPlatformDomains(platform) {
    const domainMap = {
      lever: ["https://jobs.lever.co"],
      workable: ["https://apply.workable.com", "https://jobs.workable.com"],
      recruitee: ["https://recruitee.com"],
      greenhouse: ["https://boards.greenhouse.io"],
      breezy: ["breezy.hr", "app.breezy.hr"],
      ziprecruiter: ["https://www.ziprecruiter.com"],
      ashby: ["ashbyhq.com", "jobs.ashbyhq.com"],
      indeed: ["https://www.indeed.com", "https://smartapply.indeed.com"],
      glassdoor: ["https://www.glassdoor.com"],
      wellfound: ["https://wellfound.com"],
    };

    return domainMap[platform] || [];
  }

  getPlatformLinkPattern(platform) {
    const patternMap = {
      ziprecruiter:
        /^https:\/\/(www\.)?ziprecruiter\.com\/(job|jobs|jz|apply).*$/,
      lever: /^https:\/\/jobs\.lever\.co\/[^\/]+\/[^\/]+\/?.*$/,
      workable: /^https:\/\/apply\.workable\.com\/[^\/]+\/[^\/]+\/?.*$/,
      recruitee: /^https:\/\/.*\.recruitee\.com\/o\/[^\/]+\/?.*$/,
      greenhouse:
        /^https:\/\/boards\.greenhouse\.io\/[^\/]+\/jobs\/[^\/]+\/?.*$/,
      breezy:
        /^https:\/\/([\w-]+\.breezy\.hr\/p\/|app\.breezy\.hr\/jobs\/)([^\/]+)\/?.*$/,
      ashby:
        /^https:\/\/(jobs\.ashbyhq\.com\/[^\/]+\/[^\/]+|[^\/]+\.ashbyhq\.com\/[^\/]+)\/?.*$/,
      indeed: /^https:\/\/(www\.)?indeed\.com\/(viewjob|job|jobs|apply).*$/,
      glassdoor:
        /^https:\/\/(www\.)?glassdoor\.com\/(job|Job|partner|apply).*$/,
      wellfound: /^https:\/\/wellfound\.com\/jobs\/\d+/,
    };

    return patternMap[platform] || null;
  }

  getPlatformHandler(platform) {
    return (
      this.platformHandlers.get(platform) ||
      this.initializePlatformHandler(platform)
    );
  }

  setupPortHandlers() {
    chrome.runtime.onConnect.addListener((port) => {
      console.log("📨 New port connection established:", port.name);

      const portParts = port.name.split("-");
      if (portParts.length >= 3) {
        const platform = portParts[0];
        const handler = this.getPlatformHandler(platform);

        if (handler) {
          handler.handlePortConnection(port);
        } else {
          console.warn(`No handler found for platform: ${platform}`);
        }
      }
    });
  }

  async handlePlatformPortMessage(message, port, platform) {
    try {
      console.log(`📨 ${platform} port message received:`, message);

      const handler = this.getPlatformHandler(platform);
      if (handler) {
        await handler.handlePortMessage(message, port);
      } else {
        console.error(`No handler for platform: ${platform}`);
        this.sendPortResponse(port, {
          type: "ERROR",
          message: `Unsupported platform: ${platform}`,
        });
      }
    } catch (error) {
      console.error(`❌ Error handling ${platform} port message:`, error);
      this.sendPortResponse(port, {
        type: "ERROR",
        message: error.message,
      });
    }
  }

  sendPortResponse(port, message) {
    try {
      if (port && port.sender) {
        port.postMessage(message);
      }
    } catch (error) {
      console.warn("⚠️ Failed to send port response:", error);
    }
  }

  normalizeUrl(url) {
    try {
      if (!url) return "";

      if (!url.startsWith("http")) {
        url = "https://" + url;
      }

      url = url.replace(/\/apply$/, "");

      const urlObj = new URL(url);
      return (urlObj.origin + urlObj.pathname)
        .toLowerCase()
        .trim()
        .replace(/\/+$/, "");
    } catch (e) {
      console.warn("⚠️ Error normalizing URL:", e);
      return url.toLowerCase().trim();
    }
  }

  // Handle messages from your frontend web application
  handleExternalMessage(request, sender, sendResponse) {
    console.log("📨 External message received:", request);

    const requestKey = `${request.action}_${request.userId}_${request.platform}`;
    if (this.pendingRequests.has(requestKey)) {
      console.log("🔄 Duplicate request detected, ignoring");
      sendResponse({
        status: "error",
        message: "Duplicate request already in progress",
      });
      return true;
    }

    switch (request.action) {
      case "startApplying":
        this.pendingRequests.add(requestKey);
        this.handleStartApplying(request, sendResponse).finally(() => {
          this.pendingRequests.delete(requestKey);
        });
        break;

      case "pauseApplying":
        this.handlePauseApplying(request, sendResponse);
        break;

      case "stopApplying":
        this.handleStopApplying(request, sendResponse);
        break;

      case "getStatus":
        this.handleGetStatus(request, sendResponse);
        break;

      default:
        sendResponse({
          status: "error",
          message: `Unknown action: ${request.action}`,
        });
    }

    return true;
  }

  // Handle other methods (pause, stop, status, etc.)
  async handlePauseApplying(request, sendResponse) {
    const { sessionId } = request;

    if (this.activeAutomations.has(sessionId)) {
      const automation = this.activeAutomations.get(sessionId);
      await automation.pause();

      await this.sessionManager.updateSession(sessionId, {
        status: "paused",
        pausedAt: Date.now(),
      });

      sendResponse({ status: "paused", sessionId });
    } else {
      sendResponse({
        status: "error",
        message: "No active automation found for session",
      });
    }
  }

  async handleStopApplying(request, sendResponse) {
    const { sessionId } = request;

    if (this.activeAutomations.has(sessionId)) {
      const automation = this.activeAutomations.get(sessionId);
      await automation.stop();
      this.activeAutomations.delete(sessionId);

      await this.sessionManager.updateSession(sessionId, {
        status: "stopped",
        stoppedAt: Date.now(),
      });

      sendResponse({ status: "stopped", sessionId });
    } else {
      sendResponse({
        status: "error",
        message: "No active automation found for session",
      });
    }
  }

  async handleGetStatus(request, sendResponse) {
    const { sessionId } = request;

    try {
      const session = await this.sessionManager.getSession(sessionId);
      const automation = this.activeAutomations.get(sessionId);

      let progress = null;
      if (automation) {
        progress = automation.getProgress();
      }

      sendResponse({ status: "success", session, progress });
    } catch (error) {
      sendResponse({
        status: "error",
        message: "Failed to get automation status",
      });
    }
  }

  // Handle progress, error, and application reports
  handleProgressReport(request, sender, sendResponse) {
    const { sessionId, progress } = request;

    this.sessionManager.updateSession(sessionId, {
      progress,
      lastActivity: Date.now(),
    });

    this.notifyFrontend({
      type: "progress_update",
      sessionId,
      progress,
    });

    sendResponse({ success: true });
  }

  handleErrorReport(request, sender, sendResponse) {
    const { sessionId, error, context } = request;

    console.error(`Automation error in session ${sessionId}:`, error);

    this.sessionManager.updateSession(sessionId, {
      status: "error",
      error,
      errorContext: context,
      errorTime: Date.now(),
    });

    this.notifyFrontend({
      type: "automation_error",
      sessionId,
      error,
      context,
    });

    sendResponse({ success: true });
  }

  handleApplicationSubmitted(request, sender, sendResponse) {
    const { sessionId, jobData, applicationData } = request;

    this.sessionManager.addApplication(sessionId, {
      jobData,
      applicationData,
      submittedAt: Date.now(),
      tabId: sender.tab?.id,
      url: sender.tab?.url,
    });

    this.notifyFrontend({
      type: "application_submitted",
      sessionId,
      jobData,
      applicationData,
    });

    sendResponse({ success: true });
  }

  // Validation method
  validateStartApplyingRequest(request) {
    const required = ["platform", "userId", "jobsToApply"];

    for (const field of required) {
      if (!request[field]) {
        return {
          valid: false,
          error: `Missing required field: ${field}`,
        };
      }
    }

    if (!Number.isInteger(request.jobsToApply) || request.jobsToApply <= 0) {
      return {
        valid: false,
        error: "jobsToApply must be a positive integer",
      };
    }

    const supportedPlatforms = [
      "linkedin",
      "indeed",
      "ziprecruiter",
      "recruitee",
      "glassdoor",
      "workday",
      "lever",
      "workable",
      "greenhouse",
      "breezy",
      "ashby",
      "wellfound",
    ];

    if (!supportedPlatforms.includes(request.platform)) {
      return {
        valid: false,
        error: `Unsupported platform: ${
          request.platform
        }. Supported platforms: ${supportedPlatforms.join(", ")}`,
      };
    }

    return { valid: true };
  }

  // Notify frontend
  notifyFrontend(data) {
    console.log("📤 Notifying frontend:", data);
    // Implementation depends on your frontend communication method
  }
}
