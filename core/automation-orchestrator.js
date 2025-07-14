// core/automation-orchestrator.js
import WindowManager from "../background/window-manager.js";
import Logger from "./logger.js";
//03:21:15 PMSkipping job " NodeJs Developer" - doesn't match preferences

export default class AutomationOrchestrator {
  constructor() {
    this.windowManager = new WindowManager();
    this.logger = new Logger();
    this.activeAutomations = new Map();
  }

  async startAutomation(params) {
    const {
      sessionId,
      platform,
      userId,
      jobsToApply,
      preferences = {},
      apiHost,
    } = params;

    try {
      this.logger.info(`🚀 Starting automation for platform: ${platform}`, {
        sessionId,
        userId,
        jobsToApply,
        preferences,
      });

      // Pass preferences as-is without modification
      this.logger.info(`📋 Using user preferences:`, preferences);

      // Create automation window with user preferences
      const automationWindow = await this.createAutomationWindow(
        platform,
        sessionId,
        userId,
        preferences
      );

      if (!automationWindow) {
        throw new Error("Failed to create automation window");
      }

      const fullParams = {
        ...params,
        preferences: preferences, // Pass through user preferences unchanged
        apiHost: apiHost || "http://localhost:3000",
      };

      // Create automation session
      const automationSession = new AutomationSession({
        sessionId,
        platform,
        userId,
        windowId: automationWindow.id,
        params: fullParams,
        orchestrator: this,
      });

      // Store active automation
      this.activeAutomations.set(sessionId, automationSession);

      this.logger.info(`✅ Automation started successfully`, {
        sessionId,
        platform,
        windowId: automationWindow.id,
        userId,
        preferences,
      });

      return {
        success: true,
        automationInstance: automationSession,
        windowId: automationWindow.id,
      };
    } catch (error) {
      this.logger.error(`❌ Failed to start automation: ${error.message}`, {
        sessionId,
        platform,
        userId,
        error: error.stack,
      });

      return {
        success: false,
        error: error.message,
      };
    }
  }

  async createAutomationWindow(platform, sessionId, userId, preferences) {
    try {
      // Get platform-specific starting URL with user preferences
      const startUrl = this.buildStartingUrl(platform, preferences);

      const window = await chrome.windows.create({
        url: startUrl,
        type: "normal",
        focused: true,
        width: 1200,
        height: 800,
      });

      // Register as automation window
      await this.windowManager.registerAutomationWindow(window.id, {
        sessionId,
        platform,
        userId,
        preferences,
        createdAt: Date.now(),
      });

      // Inject automation context with preferences
      setTimeout(async () => {
        try {
          if (window.tabs && window.tabs[0]) {
            await chrome.scripting.executeScript({
              target: { tabId: window.tabs[0].id },
              func: (sessionId, platform, userId, preferences) => {
                // Set window properties
                window.automationSessionId = sessionId;
                window.automationPlatform = platform;
                window.automationUserId = userId;
                window.automationPreferences = preferences;
                window.isAutomationWindow = true;

                // Set session storage
                sessionStorage.setItem("automationSessionId", sessionId);
                sessionStorage.setItem("automationPlatform", platform);
                sessionStorage.setItem("automationUserId", userId);
                sessionStorage.setItem(
                  "automationPreferences",
                  JSON.stringify(preferences)
                );
                sessionStorage.setItem("automationWindow", "true");

                console.log("🚀 Automation context injected with preferences", {
                  sessionId,
                  platform,
                  userId,
                  preferences,
                });
              },
              args: [sessionId, platform, userId, preferences],
            });
          }
        } catch (error) {
          console.error("Error injecting automation context:", error);
        }
      }, 500);

      return window;
    } catch (error) {
      throw new Error(`Failed to create automation window: ${error.message}`);
    }
  }

  buildWellfoundUrl(preferences) {
    return "https://wellfound.com/jobs";
  }

  buildZipRecruiterUrl(preferences) {
    const params = new URLSearchParams();

    // Keywords from positions
    if (preferences.positions?.length) {
      params.set("search", preferences.positions.join(" OR "));
    }

    // Location
    if (preferences.location?.length && !preferences.remoteOnly) {
      params.set("location", preferences.location[0]);
    }

    // Remote work
    if (preferences.remoteOnly || preferences.workMode?.includes("Remote")) {
      params.set("refine_by_location_type", "only_remote");
    } else {
      params.set("refine_by_location_type", ""); // For in-person jobs
    }

    // Date posted
    const datePostedMap = {
      "Any time": "",
      "Past month": "30",
      "Past week": "7",
      "Past 24 hours": "1",
      "Few Minutes Ago": "1",
    };

    if (preferences.datePosted && datePostedMap[preferences.datePosted]) {
      params.set("days", datePostedMap[preferences.datePosted]);
    }

    // Job type
    const jobTypeMap = {
      "Full-time": "full_time",
      "Part-time": "part_time",
      Contract: "contract",
      Temporary: "temp",
      Internship: "internship",
    };

    if (preferences.jobType?.length) {
      const zipRecruiterJobType = preferences.jobType
        .map((type) => jobTypeMap[type])
        .filter(Boolean)[0]; // ZipRecruiter typically takes one job type

      if (zipRecruiterJobType) {
        params.set(
          "refine_by_employment",
          `employment_type:${zipRecruiterJobType}`
        );
      }
    }

    // Salary filters
    if (preferences.salary?.length === 2) {
      const [minSalary, maxSalary] = preferences.salary;
      if (minSalary > 0) {
        params.set("refine_by_salary", minSalary.toString());
      }
      if (maxSalary > 0) {
        params.set("refine_by_salary_ceil", maxSalary.toString());
      }
    }

    // Default search radius
    params.set("radius", "25");

    return `https://www.ziprecruiter.com/jobs-search?${params.toString()}`;
  }

  buildStartingUrl(platform, preferences) {
    switch (platform) {
      case "linkedin":
        return this.buildLinkedInUrl(preferences);
      case "indeed":
        return this.buildIndeedUrl(preferences);
      case "ziprecruiter":
        return this.buildZipRecruiterUrl(preferences);
      case "glassdoor":
        return this.buildGlassdoorUrl(preferences);
      case "workday":
        return this.buildWorkdayUrl(preferences);
      case "recruitee":
        return this.buildRecruiteeUrl(preferences);
      case "lever":
        return this.buildLeverUrl(preferences);
      case "breezy":
        return this.buildBreezyUrl(preferences);
      case "ashby":
        return this.buildAshbyUrl(preferences);
      case "wellfound":
        return this.buildWellfoundUrl(preferences);
      case "workable":
        return this.buildWorkableUrl(preferences);
      default:
        return this.buildGenericSearchUrl(preferences);
    }
  }

  buildWorkableUrl(preferences) {
    const keywords = preferences.positions?.length
      ? preferences.positions.join(" OR ")
      : "software engineer";
    const location =
      preferences.location?.length && !preferences.remoteOnly
        ? ` "${preferences.location[0]}"`
        : "";
    const remoteKeyword =
      preferences.remoteOnly || preferences.workMode?.includes("Remote")
        ? " remote"
        : "";

    return `https://www.google.com/search?q=site:workable.com+"${encodeURIComponent(
      keywords
    )}"${location}${remoteKeyword}`;
  }

  buildAshbyUrl(preferences) {
    const keywords = preferences.positions?.length
      ? preferences.positions.join(" OR ")
      : "software engineer";
    const location =
      preferences.location?.length && !preferences.remoteOnly
        ? ` "${preferences.location[0]}"`
        : "";
    const remoteKeyword =
      preferences.remoteOnly || preferences.workMode?.includes("Remote")
        ? " remote"
        : "";

    return `https://www.google.com/search?q=site:ashbyhq.com+"${encodeURIComponent(
      keywords
    )}"${location}${remoteKeyword}`;
  }

  buildBreezyUrl(preferences) {
    const keywords = preferences.positions?.length
      ? preferences.positions.join(" OR ")
      : "software engineer";
    const location =
      preferences.location?.length && !preferences.remoteOnly
        ? ` "${preferences.location[0]}"`
        : "";
    const remoteKeyword =
      preferences.remoteOnly || preferences.workMode?.includes("Remote")
        ? " remote"
        : "";

    return `https://www.google.com/search?q=site:breezy.hr+"${encodeURIComponent(
      keywords
    )}"${location}${remoteKeyword}`;
  }

  buildLinkedInUrl(preferences) {
    const baseUrl = "https://www.linkedin.com/jobs/search/?";
    const joinWithOR = (arr) => (arr ? arr.join(" OR ") : "");
    const params = new URLSearchParams();
    params.append("f_AL", "true"); // Easy Apply filter

    // Handle positions
    if (preferences.positions?.length) {
      params.append("keywords", joinWithOR(preferences.positions));
    }

    // Handle location with GeoId mapping (fixed: treat as single value, not array)
    if (preferences.location) {
      const geoIdMap = {
        Nigeria: "105365761",
        Netherlands: "102890719",
        "United States": "103644278",
        "United Kingdom": "101165590",
        Canada: "101174742",
        Australia: "101452733",
        Germany: "101282230",
        France: "105015875",
        India: "102713980",
        Singapore: "102454443",
        "South Africa": "104035573",
        Ireland: "104738515",
        "New Zealand": "105490917",
      };

      if (preferences.location === "Remote") {
        params.append("f_WT", "2");
      } else if (geoIdMap[preferences.location]) {
        params.append("geoId", geoIdMap[preferences.location]);
      } else {
        params.append("location", preferences.location);
      }
    }

    // Handle work mode (removed conflicting remoteOnly logic)
    const workModeMap = {
      Remote: "2",
      Hybrid: "3",
      "On-site": "1",
    };

    if (preferences.workMode?.length) {
      const workModeCodes = preferences.workMode
        .map((mode) => workModeMap[mode])
        .filter(Boolean);
      if (workModeCodes.length) {
        params.append("f_WT", workModeCodes.join(","));
      }
    }

    // Handle date posted
    const datePostedMap = {
      "Any time": "",
      "Past month": "r2592000",
      "Past week": "r604800",
      "Past 24 hours": "r86400",
      "Few Minutes Ago": "r3600",
    };

    if (preferences.datePosted) {
      const dateCode = datePostedMap[preferences.datePosted];
      if (dateCode) {
        params.append("f_TPR", dateCode);
      }
    }

    // Handle experience level
    const experienceLevelMap = {
      Internship: "1",
      "Entry level": "2",
      Associate: "3",
      "Mid-Senior level": "4",
      Director: "5",
      Executive: "6",
    };

    if (preferences.experience?.length) {
      const experienceCodes = preferences.experience
        .map((level) => experienceLevelMap[level])
        .filter(Boolean);
      if (experienceCodes.length) {
        params.append("f_E", experienceCodes.join(","));
      }
    }

    // Handle job type
    const jobTypeMap = {
      "Full-time": "F",
      "Part-time": "P",
      Contract: "C",
      Temporary: "T",
      Internship: "I",
      Volunteer: "V",
    };

    if (preferences.jobType?.length) {
      const jobTypeCodes = preferences.jobType
        .map((type) => jobTypeMap[type])
        .filter(Boolean);
      if (jobTypeCodes.length) {
        params.append("f_JT", jobTypeCodes.join(","));
      }
    }

    // Handle salary range
    if (preferences.salary?.length === 2) {
      const [min] = preferences.salary;
      const salaryBuckets = {
        40000: "1",
        60000: "2",
        80000: "3",
        100000: "4",
        120000: "5",
        140000: "6",
        160000: "7",
        180000: "8",
        200000: "9",
      };

      const bucketValue = Object.entries(salaryBuckets)
        .reverse()
        .find(([threshold]) => min >= parseInt(threshold))?.[1];

      if (bucketValue) {
        params.append("f_SB", bucketValue);
      }
    }

    // Sorting
    params.append("sortBy", "R");

    return baseUrl + params.toString();
  }

  buildIndeedUrl(preferences) {
    const params = new URLSearchParams();

    // Keywords from positions
    if (preferences.positions?.length) {
      params.set("q", preferences.positions.join(" OR "));
    }

    // Location
    if (preferences.location?.length && !preferences.remoteOnly) {
      params.set("l", preferences.location[0]);
    }

    // Remote work
    if (preferences.remoteOnly || preferences.workMode?.includes("Remote")) {
      params.set("remotejob", "1");
    }

    // Date posted
    const datePostedMap = {
      "Any time": "",
      "Past month": "14",
      "Past week": "7",
      "Past 24 hours": "1",
      "Few Minutes Ago": "1",
    };

    if (preferences.datePosted && datePostedMap[preferences.datePosted]) {
      params.set("fromage", datePostedMap[preferences.datePosted]);
    }

    // Job type
    const jobTypeMap = {
      "Full-time": "fulltime",
      "Part-time": "parttime",
      Contract: "contract",
      Temporary: "temporary",
      Internship: "internship",
    };

    if (preferences.jobType?.length) {
      const indeedJobType = preferences.jobType
        .map((type) => jobTypeMap[type])
        .filter(Boolean)[0]; // Indeed typically takes one job type

      if (indeedJobType) {
        params.set("jt", indeedJobType);
      }
    }

    // Salary
    if (preferences.salary?.length === 2) {
      const [minSalary] = preferences.salary;
      if (minSalary > 0) {
        params.set("salary", minSalary.toString());
      }
    }

    params.set("sort", "date");

    return `https://www.indeed.com/jobs?${params.toString()}`;
  }

  buildGlassdoorUrl(preferences) {
    const params = new URLSearchParams();

    // Keywords
    if (preferences.positions?.length) {
      const keywords = preferences.positions.join(" ");
      params.set("sc.keyword", keywords);
      params.set("typedKeyword", keywords);
    }

    // Location
    if (preferences.location?.length && !preferences.remoteOnly) {
      params.set("locT", "C");
      params.set("locId", preferences.location[0]);
    }

    // Job type
    const jobTypeMap = {
      "Full-time": "full-time",
      "Part-time": "part-time",
      Contract: "contract",
      Internship: "internship",
    };

    if (preferences.jobType?.length) {
      const glassdoorJobType = preferences.jobType
        .map((type) => jobTypeMap[type])
        .filter(Boolean)[0];

      if (glassdoorJobType) {
        params.set("jobType", glassdoorJobType);
      }
    }

    // Default params
    params.set("suggestCount", "0");
    params.set("suggestChosen", "false");
    params.set("clickSource", "searchBtn");

    return `https://www.glassdoor.com/Job/jobs.htm?${params.toString()}`;
  }

  buildWorkdayUrl(preferences) {
    const keywords = preferences.positions?.length
      ? preferences.positions.join(" OR ")
      : "software engineer";
    const location =
      preferences.location?.length && !preferences.remoteOnly
        ? ` "${preferences.location[0]}"`
        : "";

    return `https://www.google.com/search?q=site:myworkdayjobs.com+"${encodeURIComponent(
      keywords
    )}"${location}`;
  }

  buildRecruiteeUrl(preferences) {
    const keywords = preferences.positions?.length
      ? preferences.positions.join(" OR ")
      : "software engineer";
    const location =
      preferences.location?.length && !preferences.remoteOnly
        ? ` "${preferences.location[0]}"`
        : "";

    return `https://www.google.com/search?q=site:recruitee.com+"${encodeURIComponent(
      keywords
    )}"${location}`;
  }

  buildLeverUrl(preferences) {
    const keywords = preferences.positions?.length
      ? preferences.positions.join(" OR ")
      : "software engineer";
    const location =
      preferences.location?.length && !preferences.remoteOnly
        ? ` "${preferences.location[0]}"`
        : "";

    return `https://www.google.com/search?q=site:jobs.lever.co+"${encodeURIComponent(
      keywords
    )}"${location}`;
  }

  buildGenericSearchUrl(preferences) {
    const keywords = preferences.positions?.length
      ? preferences.positions.join(" OR ") + " jobs"
      : "software engineer jobs";
    const location =
      preferences.location?.length && !preferences.remoteOnly
        ? ` ${preferences.location[0]}`
        : "";

    return `https://www.google.com/search?q=${encodeURIComponent(
      keywords + location
    )}`;
  }

  async stopAutomation(sessionId) {
    const automation = this.activeAutomations.get(sessionId);
    if (automation) {
      await automation.stop();
      this.activeAutomations.delete(sessionId);

      try {
        await chrome.windows.remove(automation.windowId);
      } catch (error) {
        console.error("Error closing automation window:", error);
      }

      this.logger.info(`🛑 Automation stopped`, { sessionId });
      return true;
    }
    return false;
  }

  async pauseAutomation(sessionId) {
    const automation = this.activeAutomations.get(sessionId);
    if (automation) {
      await automation.pause();
      this.logger.info(`⏸️ Automation paused`, { sessionId });
      return true;
    }
    return false;
  }

  async resumeAutomation(sessionId) {
    const automation = this.activeAutomations.get(sessionId);
    if (automation) {
      await automation.resume();
      this.logger.info(`▶️ Automation resumed`, { sessionId });
      return true;
    }
    return false;
  }

  getAutomationStatus(sessionId) {
    const automation = this.activeAutomations.get(sessionId);
    return automation ? automation.getStatus() : null;
  }

  async handleWindowClosed(windowId) {
    for (const [sessionId, automation] of this.activeAutomations.entries()) {
      if (automation.windowId === windowId) {
        await automation.stop();
        this.activeAutomations.delete(sessionId);
        this.logger.info(`🧹 Cleaned up automation for closed window`, {
          sessionId,
          windowId,
          userId: automation.userId,
        });
      }
    }
  }
}

class AutomationSession {
  constructor({ sessionId, platform, userId, windowId, params, orchestrator }) {
    this.sessionId = sessionId;
    this.platform = platform;
    this.userId = userId;
    this.windowId = windowId;
    this.params = params;
    this.orchestrator = orchestrator;

    this.status = "created";
    this.startTime = Date.now();
    this.endTime = null;
    this.progress = {
      total: params.jobsToApply,
      completed: 0,
      failed: 0,
      skipped: 0,
      current: null,
    };
    this.errors = [];
    this.isPaused = false;
  }

  getConfig() {
    return {
      sessionId: this.sessionId,
      platform: this.platform,
      userId: this.userId,
      jobsToApply: this.params.jobsToApply,
      submittedLinks: this.params.submittedLinks || [],
      preferences: this.params.preferences || {},
      resumeUrl: this.params.resumeUrl,
      coverLetterTemplate: this.params.coverLetterTemplate,
      userPlan: this.params.userPlan,
      userCredits: this.params.userCredits,
      dailyRemaining: this.params.dailyRemaining,
      devMode: this.params.devMode || false,
      country: this.params.country || "US",
      apiHost: this.params.apiHost || "http://localhost:3000",
    };
  }

  getApiHost() {
    return (
      this.params.apiHost ||
      this.orchestrator.config?.apiHost ||
      process.env.API_HOST ||
      "http://localhost:3000"
    );
  }

  async pause() {
    this.isPaused = true;
    this.status = "paused";
    await this.sendMessageToContentScript({ action: "pauseAutomation" });
  }

  async resume() {
    this.isPaused = false;
    this.status = "running";
    await this.sendMessageToContentScript({ action: "resumeAutomation" });
  }

  async stop() {
    this.status = "stopped";
    this.endTime = Date.now();
    await this.sendMessageToContentScript({ action: "stopAutomation" });
  }

  async sendMessageToContentScript(message) {
    try {
      const tabs = await chrome.tabs.query({
        windowId: this.windowId,
        active: true,
      });
      if (tabs.length > 0) {
        await chrome.tabs.sendMessage(tabs[0].id, {
          ...message,
          sessionId: this.sessionId,
          userId: this.userId,
        });
      }
    } catch (error) {
      console.error("Error sending message to content script:", error);
    }
  }

  updateProgress(progressUpdate) {
    this.progress = { ...this.progress, ...progressUpdate };
  }

  handleError(error) {
    this.errors.push({
      message: error.message,
      timestamp: Date.now(),
      context: error.context || "unknown",
    });
  }

  getProgress() {
    return {
      ...this.progress,
      status: this.status,
      isPaused: this.isPaused,
      duration: this.startTime ? Date.now() - this.startTime : 0,
      errors: this.errors,
      userId: this.userId,
      preferences: this.params.preferences,
    };
  }

  getStatus() {
    return {
      sessionId: this.sessionId,
      platform: this.platform,
      userId: this.userId,
      status: this.status,
      progress: this.progress,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.startTime
        ? (this.endTime || Date.now()) - this.startTime
        : 0,
      errors: this.errors,
      isPaused: this.isPaused,
      windowId: this.windowId,
      preferences: this.params.preferences,
    };
  }
}
