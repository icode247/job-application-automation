// background/platforms/lever.js - ENHANCED VERSION WITH APPLICATION TRACKING
import BaseBackgroundHandler from "../../shared/base/base-background-handler.js";
import {
  ApplicationTrackerService,
  UserService,
} from "../../services/index.js";

export default class LeverAutomationHandler extends BaseBackgroundHandler {
  constructor(messageHandler) {
    const devMode = messageHandler.devMode;
    super(messageHandler, "lever", devMode);

    this.messageHandler = messageHandler;

    if (!this.logCounts) {
      this.logCounts = new Map();
    }
  }

  getApiHost() {
    return this.messageHandler.apiHost;
  }

  async handlePlatformSpecificMessage(type, data, port) {
    switch (type) {
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
        await this.handleTaskCompletion(port, data, "SUCCESS");
        break;

      case "SEND_CV_TASK_ERROR":
        await this.handleTaskCompletion(port, data, "ERROR");
        break;

      case "SEND_CV_TASK_SKIP":
        await this.handleTaskCompletion(port, data, "SKIPPED");
        break;

      case "SEARCH_TASK_DONE":
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

      case "SEARCH_COMPLETED":
        await this.handleSearchCompleted(port, data);
        break;

      default:
        this.log(`❓ Unhandled Lever port message type: ${type}`);
        this.safePortSend(port, {
          type: "ERROR",
          message: `Unknown message type: ${type}`,
        });
    }
  }

  async handleSendCvTask(port, data) {
    try {
      const { url, title } = data;
      const windowId = port.sender?.tab?.windowId;

      this.log(`🎯 Processing Lever job application: ${url}`);

      let automation = null;
      for (const [sessionId, auto] of this.messageHandler.activeAutomations.entries()) {
        if (auto.windowId === windowId) {
          automation = auto;
          break;
        }
      }

      if (!automation) {
        throw new Error("No Lever automation session found");
      }

      if (!automation.applicationTracker) {
        automation.applicationTracker = new ApplicationTrackerService({
          userId: automation.userId,
          apiHost: this.getApiHost(),
        });
      }

      if (!automation.userService) {
        automation.userService = new UserService({
          userId: automation.userId,
          apiHost: this.getApiHost(),
        });
      }

      const jobId = this.extractJobIdFromUrl(url);
      if (!jobId) {
        this.log(`⚠️ Could not extract job ID from URL: ${url}`);
      }

      this.log(`🔍 Checking if user can apply more jobs...`);
      const canApply = await automation.userService.canApplyMore();
      if (!canApply) {
        this.log(`❌ User has reached application limit`);
        this.safePortSend(port, {
          type: "LIMIT_REACHED",
          message: "You have reached your application limit for this billing period",
          data: { url, reason: "APPLICATION_LIMIT_REACHED" }
        });
        return;
      }

      if (jobId) {
        this.log(`🔍 Checking if already applied to job: ${jobId}`);
        const alreadyApplied = await automation.applicationTracker.checkIfAlreadyApplied(jobId);
        if (alreadyApplied) {
          this.log(`⚠️ Job already applied: ${jobId}`);
          this.safePortSend(port, {
            type: "ALREADY_APPLIED",
            message: "You have already applied to this job",
            data: { url, jobId, reason: "ALREADY_APPLIED" }
          });
          return;
        }
      }

      const normalizedUrl = this.messageHandler.normalizeUrl(url);
      if (automation.platformState.submittedLinks?.some(
        (link) => this.messageHandler.normalizeUrl(link.url) === normalizedUrl
      )) {
        this.safePortSend(port, {
          type: "DUPLICATE",
          message: "This job has already been processed in this session",
          data: { url, reason: "SESSION_DUPLICATE" },
        });
        return;
      }

      if (automation.platformState.isProcessingJob) {
        this.safePortSend(port, {
          type: "ERROR",
          message: "Already processing another job",
          data: { url, reason: "PROCESSING_IN_PROGRESS" }
        });
        return;
      }

      this.log(`✅ All validation checks passed, proceeding with application`);

      const leverApplyUrl = url.endsWith("/apply") ? url : url + "/apply";
      const tab = await chrome.tabs.create({
        url: leverApplyUrl,
        windowId: windowId,
        active: true,
      });

      automation.platformState.isProcessingJob = true;
      automation.platformState.currentJobUrl = url;
      automation.platformState.currentJobTabId = tab.id;
      automation.platformState.currentJobId = jobId;
      automation.platformState.applicationStartTime = Date.now();

      if (!automation.platformState.submittedLinks) {
        automation.platformState.submittedLinks = [];
      }
      automation.platformState.submittedLinks.push({
        url: url,
        jobId: jobId,
        status: "PROCESSING",
        timestamp: Date.now(),
      });

      this.safePortSend(port, {
        type: "SUCCESS",
        message: "Lever apply tab will be created",
        data: { url, jobId, tabId: tab.id }
      });

      this.log(`✅ Lever job tab created: ${tab.id} for URL: ${url}`);
    } catch (error) {
      this.log("❌ Error handling Lever SEND_CV_TASK:", error);
      this.safePortSend(port, {
        type: "ERROR",
        message: error.message,
        data: { url: data.url, error: error.message }
      });
    }
  }

  async handleTaskCompletion(port, data, status) {
    const windowId = port.sender?.tab?.windowId;

    let automation = null;
    for (const [sessionId, auto] of this.messageHandler.activeAutomations.entries()) {
      if (auto.windowId === windowId) {
        automation = auto;
        break;
      }
    }

    if (!automation) {
      this.log(`⚠️ No automation found for task completion`);
      return;
    }

    const currentJobUrl = automation.platformState.currentJobUrl;
    const currentJobId = automation.platformState.currentJobId;
    try {
      if (status === "SUCCESS") {
        console.log(`✅ Job application successful: ${currentJobUrl}`);

        if (automation.applicationTracker && currentJobId) {
          const applicationData = {
            jobId: currentJobId,
            title: data.title || "Job on Lever",
            company: data.company || this.extractCompanyFromUrl(currentJobUrl),
            location: data.location || "Not specified",
            jobUrl: currentJobUrl,
            salary: data.salary || "Not specified",
            workplace: data.workplace || "Not specified",
            postedDate: data.postedDate || null,
            applicants: data.applicants || null,
            platform: "lever",
          };

          const saved = await automation.applicationTracker.saveAppliedJob(applicationData);
          if (saved) {
            console.log(`✅ Applied job saved to database: ${currentJobId}`);
          } else {
            console.log(`⚠️ Failed to save applied job: ${currentJobId}`);
          }
        }

        if (automation.userService) {
          const updated = await automation.userService.updateApplicationCount();
          if (updated) {
            console.log(`✅ Application count updated successfully`);
          } else {
            console.log(`⚠️ Failed to update application count`);
          }
        }

        if (automation.platformState.submittedLinks && currentJobUrl) {
          const linkIndex = automation.platformState.submittedLinks.findIndex(
            link => this.messageHandler.normalizeUrl(link.url) === this.messageHandler.normalizeUrl(currentJobUrl)
          );
          if (linkIndex !== -1) {
            automation.platformState.submittedLinks[linkIndex].status = "SUCCESS";
            automation.platformState.submittedLinks[linkIndex].completedAt = Date.now();
          }
        }

      } else if (status === "ERROR") {
        console.log(`❌ Job application failed: ${currentJobUrl}`);

        if (automation.platformState.submittedLinks && currentJobUrl) {
          const linkIndex = automation.platformState.submittedLinks.findIndex(
            link => this.messageHandler.normalizeUrl(link.url) === this.messageHandler.normalizeUrl(currentJobUrl)
          );
          if (linkIndex !== -1) {
            automation.platformState.submittedLinks[linkIndex].status = "ERROR";
            automation.platformState.submittedLinks[linkIndex].error = data;
            automation.platformState.submittedLinks[linkIndex].completedAt = Date.now();
          }
        }

      } else if (status === "SKIPPED") {
        this.log(`⚠️ Job application skipped: ${currentJobUrl}`);

        if (automation.platformState.submittedLinks && currentJobUrl) {
          const linkIndex = automation.platformState.submittedLinks.findIndex(
            link => this.messageHandler.normalizeUrl(link.url) === this.messageHandler.normalizeUrl(currentJobUrl)
          );
          if (linkIndex !== -1) {
            automation.platformState.submittedLinks[linkIndex].status = "SKIPPED";
            automation.platformState.submittedLinks[linkIndex].reason = data;
            automation.platformState.submittedLinks[linkIndex].completedAt = Date.now();
          }
        }
      }

    } catch (error) {
      this.log(`❌ Error in task completion handling:`, error);
    } finally {
      automation.platformState.isProcessingJob = false;
      automation.platformState.currentJobUrl = null;
      automation.platformState.currentJobTabId = null;
      automation.platformState.currentJobId = null;
      automation.platformState.applicationStartTime = null;
      

      await this.continueOrComplete(automation, windowId, status, data);
    }

    this.safePortSend(port, {
      type: "TASK_COMPLETION_ACKNOWLEDGED",
      data: { status, url: currentJobUrl }
    });
  }

  extractJobIdFromUrl(url) {
    try {
      const matches = url.match(/\/([a-f0-9-]{36}|[a-zA-Z0-9-]+)(?:\/apply)?(?:\?.*)?$/);
      return matches ? matches[1] : null;
    } catch (error) {
      this.log(`❌ Error extracting job ID from URL: ${url}`, error);
      return null;
    }
  }

  extractCompanyFromUrl(url) {
    try {
      const matches = url.match(/https:\/\/jobs\.(?:eu\.)?lever\.co\/([^\/]+)/);
      return matches ? matches[1] : "Company on Lever";
    } catch (error) {
      this.log(`❌ Error extracting company from URL: ${url}`, error);
      return "Company on Lever";
    }
  }

  async handleGetSearchTask(port, data) {
    const tabId = port.sender?.tab?.id;
    const windowId = port.sender?.tab?.windowId;

    let sessionData = null;
    for (const [sessionId, automation] of this.messageHandler.activeAutomations.entries()) {
      if (automation.windowId === windowId) {
        const platformState = automation.platformState;

        if (!automation.applicationTracker) {
          automation.applicationTracker = new ApplicationTrackerService({
            userId: automation.userId,
            apiHost: this.getApiHost(),
          });
        }

        sessionData = {
          tabId: tabId,
          limit: platformState.searchData.limit,
          current: platformState.searchData.current,
          domain: platformState.searchData.domain,
          submittedLinks: platformState.submittedLinks || [],
          searchLinkPattern: platformState.searchData.searchLinkPattern.toString(),
          userId: automation.userId,
          hasApplicationTracker: !!automation.applicationTracker,
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

  async handleSearchCompleted(port, data) {
    const windowId = port.sender?.tab?.windowId;
    this.log(`🏁 Lever search completed for window ${windowId}`);

    let automation = null;
    for (const [sessionId, auto] of this.messageHandler.activeAutomations.entries()) {
      if (auto.windowId === windowId) {
        automation = auto;
        break;
      }
    }

    let successCount = 0;
    let errorCount = 0;
    let skipCount = 0;

    if (automation?.platformState.submittedLinks) {
      automation.platformState.submittedLinks.forEach(link => {
        switch (link.status) {
          case "SUCCESS": successCount++; break;
          case "ERROR": errorCount++; break;
          case "SKIPPED": skipCount++; break;
        }
      });
    }

    try {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "Lever Job Search Completed",
        message: `Successfully applied: ${successCount}, Errors: ${errorCount}, Skipped: ${skipCount}`,
      });
    } catch (error) {
      this.log("⚠️ Error showing notification:", error);
    }

    this.safePortSend(port, {
      type: "SUCCESS",
      message: "Lever search completion acknowledged",
      data: { successCount, errorCount, skipCount }
    });
  }

  async handleGetSendCvTask(port, data) {
    const tabId = port.sender?.tab?.id;
    const windowId = port.sender?.tab?.windowId;

    console.log(this.getApiHost())

    this.log(`🔍 GET_SEND_CV_TASK request from Lever tab ${tabId}, window ${windowId}`);

    let sessionData = null;
    let automation = null;

    for (const [sessionId, auto] of this.messageHandler.activeAutomations.entries()) {
      if (auto.windowId === windowId) {
        automation = auto;
        this.log(`✅ Found Lever automation session: ${sessionId}`);
        break;
      }
    }

    if (automation) {
      let userProfile = automation.userProfile;

      if (!userProfile && automation.userId) {
        try {
          this.log(`📡 Fetching user profile for Lever user ${automation.userId}`);
          const { default: UserService } = await import("../../services/user-service.js");
          const userService = new UserService({
            userId: automation.userId,
            apiHost: this.getApiHost()
          });
          userProfile = await userService.getUserDetails();

          automation.userProfile = userProfile;
          this.log(`✅ User profile fetched and cached for Lever`);
        } catch (error) {
          this.log(`❌ Failed to fetch user profile for Lever:`, error);
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

      this.log(`📊 Lever session data prepared:`, {
        hasProfile: !!sessionData.profile,
        hasSession: !!sessionData.session,
        userId: sessionData.userId,
        devMode: sessionData.devMode,
      });
    } else {
      this.log(`⚠️ No Lever automation found for window ${windowId}`);
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
      type: "SUCCESS",
      data: sessionData,
    });

    if (!sent) {
      this.log(`❌ Failed to send Lever CV task data to port ${port.name}`);
    } else {
      this.log(`✅ Lever CV task data sent successfully to tab ${tabId}`);
    }
  }

  async handleSearchTaskDone(port, data) {
    const windowId = port.sender?.tab?.windowId;
    this.log(`🏁 Lever search task completed for window ${windowId}`);

    try {
      chrome.notifications.create({
        type: "basic",
        iconUrl: "icons/icon48.png",
        title: "Lever Job Search Completed",
        message: "All job applications have been processed.",
      });
    } catch (error) {
      this.log("⚠️ Error showing notification:", error);
    }

    this.safePortSend(port, {
      type: "SUCCESS",
      message: "Lever search completion acknowledged",
    });
  }

  async handleVerifyApplicationStatus(port, data) {
    const windowId = port.sender?.tab?.windowId;

    let automation = null;
    for (const [sessionId, auto] of this.messageHandler.activeAutomations.entries()) {
      if (auto.windowId === windowId) {
        automation = auto;
        break;
      }
    }

    const isActive = automation ? automation.platformState.isProcessingJob : false;

    this.safePortSend(port, {
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
    for (const [sessionId, auto] of this.messageHandler.activeAutomations.entries()) {
      if (auto.windowId === windowId) {
        automation = auto;
        break;
      }
    }

    const isOpen = automation ? automation.platformState.isProcessingJob : false;

    this.safePortSend(port, {
      type: "JOB_TAB_STATUS",
      data: {
        isOpen: isOpen,
        tabId: automation?.platformState.currentJobTabId || null,
        isProcessing: isOpen,
      },
    });
  }

  async handleSearchNextReady(port, data) {
    this.log("🔄 Lever search ready for next job");

    this.safePortSend(port, {
      type: "NEXT_READY_ACKNOWLEDGED",
      data: { status: "success" },
    });
  }

  async continueOrComplete(automation, windowId, status, data) {
    if (status === "SUCCESS") {
      automation.platformState.searchData.current++;
    }

    const oldUrl = automation.platformState.currentJobUrl;

    // Safe access to logCounts with fallback
    const sessionId = automation.sessionId || automation.sessionConfig?.sessionId;
    const errorCount = sessionId && this.logCounts ? this.logCounts.get(sessionId) || 0 : 0;
    const delay = status === "ERROR" ? Math.min(3000 * errorCount, 15000) : 0;

    setTimeout(async () => {
      await this.sendSearchNextMessage(windowId, {
        url: oldUrl,
        status: status,
        data: data,
        message: typeof data === "string" ? data : status === "ERROR" ? "Application error" : undefined,
      });
    }, delay);
  }
}