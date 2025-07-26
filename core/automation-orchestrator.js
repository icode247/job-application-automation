// core/automation-orchestrator.js
import WindowManager from "../background/window-manager.js";
import {
  getGlassdoorJobURL,
  getIndeedJobURL,
  COUNTRY_CODES,
} from "../shared/utilities/url-resolver.js";

export default class AutomationOrchestrator {
  constructor(logger, devMode = false) {
    this.logger = logger;
    this.devMode = devMode;
    this.windowManager = new WindowManager(logger, devMode);
    this.activeAutomations = new Map();
    this.windowSessions = new Map();
  }

  async startAutomation(params) {
    const {
      sessionId,
      platform,
      userId,
      jobsToApply,
      preferences = {},
      apiHost,
      userProfile,
      devMode = false,
    } = params;

    try {
      this.logger.info(`🚀 Starting automation for platform: ${platform}`, {
        sessionId,
        userId,
        jobsToApply,
        preferences,
      });

      const automationWindow = await this.createAutomationWindow(
        platform,
        sessionId,
        userId,
        preferences,
        userProfile.country
      );

      if (!automationWindow) {
        throw new Error("Failed to create automation window");
      }

      const fullParams = {
        ...params,
        preferences: preferences,
        apiHost: apiHost,
        devMode: devMode,
      };

      const automationSession = new AutomationSession({
        sessionId,
        platform,
        userId,
        windowId: automationWindow.id,
        params: fullParams,
        orchestrator: this,
        logger: this.logger,
        devMode: devMode,
      });

      this.activeAutomations.set(sessionId, automationSession);

      this.windowSessions.set(automationWindow.id, sessionId);

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

  async createAutomationWindow(
    platform,
    sessionId,
    userId,
    preferences,
    country
  ) {
    try {
      const startUrl = this.buildStartingUrl(platform, preferences, country);

      const window = await chrome.windows.create({
        url: startUrl,
        type: "normal",
        focused: true,
        width: 1200,
        height: 800,
      });

      await this.windowManager.registerAutomationWindow(window.id, {
        sessionId,
        platform,
        userId,
        preferences,
        createdAt: Date.now(),
      });

      this.windowSessions.set(window.id, sessionId);

      await this.injectAutomationContextWithRetry(
        window,
        sessionId,
        platform,
        userId,
        preferences
      );

      return window;
    } catch (error) {
      throw new Error(`Failed to create automation window: ${error.message}`);
    }
  }

  async injectAutomationContextWithRetry(
    window,
    sessionId,
    platform,
    userId,
    preferences,
    maxRetries = 3
  ) {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        await this.delay(1000 + attempt * 500);

        if (window.tabs && window.tabs[0]) {
          await chrome.scripting.executeScript({
            target: { tabId: window.tabs[0].id },
            func: (sessionId, platform, userId, preferences) => {
              window.automationSessionId = sessionId;
              window.automationPlatform = platform;
              window.automationUserId = userId;
              window.automationPreferences = preferences;
              window.isAutomationWindow = true;
              window.isAutomationTab = true;

              sessionStorage.setItem("automationSessionId", sessionId);
              sessionStorage.setItem("automationPlatform", platform);
              sessionStorage.setItem("automationUserId", userId);
              sessionStorage.setItem(
                "automationPreferences",
                JSON.stringify(preferences)
              );
              sessionStorage.setItem("automationWindow", "true");
              sessionStorage.setItem("isAutomationWindow", "true");
              sessionStorage.setItem("isAutomationTab", "true");

              window.automationContextInjected = true;
            },
            args: [sessionId, platform, userId, preferences],
          });

          const verification = await chrome.scripting.executeScript({
            target: { tabId: window.tabs[0].id },
            func: () => window.automationContextInjected === true,
          });

          if (verification[0]?.result) {
            this.logger.log(
              `✅ Context injection verified on attempt ${attempt + 1}`
            );
            return;
          }
        }
      } catch (error) {
        this.logger.warn(
          `⚠️ Context injection attempt ${attempt + 1} failed:`,
          error
        );

        if (attempt === maxRetries - 1) {
          throw new Error(
            `Failed to inject automation context after ${maxRetries} attempts`
          );
        }
      }
    }
  }

  async handleTabCreated(tabId, windowId) {
    const sessionId = this.windowSessions.get(windowId);

    if (sessionId) {
      this.logger.log(
        `🆕 New tab ${tabId} created in automation window ${windowId}`
      );

      // Wait for tab to load before injecting context
      setTimeout(async () => {
        try {
          const automation = this.activeAutomations.get(sessionId);
          if (automation) {
            await this.injectAutomationContextIntoTab(tabId, {
              sessionId,
              platform: automation.platform,
              userId: automation.userId,
              preferences: automation.params.preferences || {},
              userProfile: automation.userProfile,
              sessionConfig: automation.sessionConfig,
              apiHost: automation.params.apiHost,
            });
          }
        } catch (error) {
          this.logger.error(
            `❌ Failed to inject context into new tab ${tabId}:`,
            error
          );
        }
      }, 1500);
    }
  }

  async injectAutomationContextIntoTab(tabId, context) {
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        func: (context) => {
          // Set all automation flags
          window.automationSessionId = context.sessionId;
          window.automationPlatform = context.platform;
          window.automationUserId = context.userId;
          window.automationPreferences = context.preferences;
          window.isAutomationWindow = true;
          window.isAutomationTab = true;

          if (context.userProfile) {
            window.automationUserProfile = context.userProfile;
          }
          if (context.sessionConfig) {
            window.automationSessionConfig = context.sessionConfig;
          }
          if (context.apiHost) {
            window.automationApiHost = context.apiHost;
          }

          // Set session storage
          sessionStorage.setItem("automationSessionId", context.sessionId);
          sessionStorage.setItem("automationPlatform", context.platform);
          sessionStorage.setItem("automationUserId", context.userId);
          sessionStorage.setItem(
            "automationPreferences",
            JSON.stringify(context.preferences)
          );
          sessionStorage.setItem("isAutomationWindow", "true");
          sessionStorage.setItem("isAutomationTab", "true");

          if (context.userProfile) {
            sessionStorage.setItem(
              "automationUserProfile",
              JSON.stringify(context.userProfile)
            );
          }
          if (context.sessionConfig) {
            sessionStorage.setItem(
              "automationSessionConfig",
              JSON.stringify(context.sessionConfig)
            );
          }
          if (context.apiHost) {
            sessionStorage.setItem("automationApiHost", context.apiHost);
          }
        },
        args: [context],
      });

      this.logger.log(
        `✅ Context injected into tab ${tabId} for session ${context.sessionId}`
      );
    } catch (error) {
      this.logger.error(`❌ Failed to inject context into tab ${tabId}:`, error);
    }
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  getSessionForWindow(windowId) {
    return this.windowSessions.get(windowId);
  }
  isAutomationWindow(windowId) {
    return this.windowSessions.has(windowId);
  }

  async handleWindowClosed(windowId) {
    this.logger.log(`🪟 Orchestrator handling window ${windowId} closure`);

    const sessionId = this.windowSessions.get(windowId);

    if (sessionId) {
      const automation = this.activeAutomations.get(sessionId);
      if (automation) {
        this.logger.log(
          `🛑 Orchestrator stopping automation ${sessionId} for closed window ${windowId}`
        );

        try {
          // Properly stop the automation session
          automation.status = "stopped";
          automation.endTime = Date.now();

          await automation.sendMessageToContentScript({
            action: "stopAutomation",
            reason: "Window closed",
          });

          // Call cleanup if available
          if (typeof automation.cleanup === "function") {
            await automation.cleanup();
          }
        } catch (error) {
          this.logger.error(
            `❌ Error in orchestrator window close cleanup:`,
            error
          );
        }

        this.activeAutomations.delete(sessionId);
      }

      // Clean up tracking
      this.windowSessions.delete(windowId);

      this.logger.log(
        `✅ Orchestrator cleanup completed for window ${windowId}, session ${sessionId}`
      );
    }
  }

  buildStartingUrl(platform, preferences, country) {
    switch (platform) {
      case "linkedin":
        return this.buildLinkedInUrl(preferences, country);
      case "indeed":
        return this.buildIndeedUrl(preferences, country);
      case "ziprecruiter":
        return this.buildZipRecruiterUrl(preferences);
      case "glassdoor":
        return this.buildGlassdoorUrl(preferences, country);
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

  getFirstOrString = (value) => {
    if (Array.isArray(value)) {
      return value.length > 0 ? value[value.length - 1] : null;
    }
    return value || null;
  };

  buildGlassdoorUrl(preferences, country) {
    const params = new URLSearchParams();

    params.set("applicationType", "1");
    if (preferences.remoteOnly === true) {
      params.set("remoteWorkType", "1");
    }

    if (
      preferences.salary &&
      Array.isArray(preferences.salary) &&
      preferences.salary.length === 2
    ) {
      const [minSalary, maxSalary] = preferences.salary;
      if (minSalary) {
        params.set("minSalary", minSalary.toString());
      }
      if (maxSalary) {
        params.set("maxSalary", maxSalary.toString());
      }
    }

    if (
      preferences.companyRating &&
      preferences.companyRating !== "Any rating"
    ) {
      const ratingMatch = preferences.companyRating.match(/(\d+(?:\.\d+)?)/);
      if (ratingMatch) {
        const rating = parseFloat(ratingMatch[1]);
        params.set("minRating", rating.toFixed(1));
      }
    }

    const datePostedMap = {
      "Past 24 hours": "1",
      "Past 3 days": "3",
      "Past week": "7",
      "Past 2 weeks": "14",
      "Past month": "30",
    };

    if (
      preferences.datePosted &&
      preferences.datePosted !== "Any time" &&
      datePostedMap[preferences.datePosted]
    ) {
      params.set("fromAge", datePostedMap[preferences.datePosted]);
    }

    const jobTypeMap = {
      "Full-time": "fulltime",
      "Part-time": "parttime",
      Contract: "contract",
      Internship: "internship",
    };

    if (
      preferences.jobType &&
      Array.isArray(preferences.jobType) &&
      preferences.jobType.length > 0
    ) {
      const glassdoorJobTypes = preferences.jobType
        .map((type) => jobTypeMap[type])
        .filter(Boolean);

      if (glassdoorJobTypes.length > 0) {
        params.set("jobType", glassdoorJobTypes.join(","));
      }
    }

    const experience = this.getFirstOrString(preferences.experience);
    if (experience) {
      const experienceMap = {
        "Entry level": "entrylevel",
        Associate: "associate",
        Internship: "internship",
        "Mid-Senior level": "midseniorlevel",
        Director: "director",
        Executive: "executive",
      };

      const glassdoorExperience = experienceMap[experience];
      if (glassdoorExperience) {
        params.set("seniorityType", glassdoorExperience);
      }
    }

    const firstLocation = this.getFirstOrString(preferences.location);
    const firstPosition = this.getFirstOrString(preferences.positions);

    let baseUrl = "https://www.glassdoor.com/Job/jobs.htm";
    // let baseUrl =  `${getGlassdoorJobURL(country)}/Job/jobs.htm`;

    if (firstLocation && firstPosition) {
      const locationSlug = firstLocation
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");

      const positionSlug = firstPosition
        .toLowerCase()
        .replace(/\s+/g, "-")
        .replace(/[^a-z0-9-]/g, "");

      const countryCode = COUNTRY_CODES[firstLocation] || "IN1";
      const locationLength = locationSlug.length;
      const positionStart = locationLength + 1;
      const positionEnd = positionStart + positionSlug.length;

      baseUrl = `https://www.glassdoor.com/Job/${locationSlug}-${positionSlug}-jobs-SRCH_IL.0,${locationLength}_${countryCode}_KO${positionStart},${positionEnd}.htm`;
    }

    return `${baseUrl}?${params.toString()}`;
  }

  buildLinkedInUrl(preferences, country) {
    const baseUrl = "https://www.linkedin.com/jobs/search/?";
    const joinWithOR = (arr) => (arr ? arr.join(" OR ") : "");
    const params = new URLSearchParams();

    params.append("f_AL", "true"); // Keep the Easy Apply filter

    // Handle positions
    if (preferences.positions?.length) {
      params.append("keywords", joinWithOR(preferences.positions));
    }

    if (preferences.location) {
      // GeoId mapping for countries
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

    // Job Type Mapping
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

    // Salary Range Mapping
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

  buildIndeedUrl(preferences, country) {
    const params = new URLSearchParams();

    // Keywords from positions
    if (preferences.positions?.length) {
      params.set("q", preferences.positions.join(" OR "));
    }

    // Location
    // if an array, show the first
    if (Array.isArray(preferences.location)) {
      params.set("l", preferences.location[0]);
    } else {
      params.set("l", preferences.location);
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
      "Past 3 days": "3",
      "Few Minutes Ago": "1",
    };

    if (preferences.datePosted && datePostedMap[preferences.datePosted]) {
      params.set("fromage", datePostedMap[preferences.datePosted]);
    }

    // Job type using sc parameter
    const jobTypeMap = {
      "Full-time": "CF3CP",
      "Part-time": "75GKK",
      Contract: "NJXCK",
      Temporary: "4HKF7",
      Internship: "internship",
    };

    if (preferences.jobType?.length) {
      const jobTypeCodes = preferences.jobType
        .map((type) => jobTypeMap[type])
        .filter(Boolean);

      if (jobTypeCodes.length > 0) {
        let scValue;
        if (jobTypeCodes.length === 1) {
          scValue = `0kf%3Aattr%28${jobTypeCodes[0]}%29%3B`;
        } else {
          const joinedCodes = jobTypeCodes.join("%7C");
          scValue = `0kf%3Aattr%28${joinedCodes}%252COR%29%3B`;
        }
        params.set("sc", scValue);
      }
    }

    if (preferences.salary?.length === 2) {
      const [minSalary] = preferences.salary;
      if (minSalary > 0) {
        params.set("salary", minSalary.toString());
      }
    }

    params.set("sort", "date");

    return `${getIndeedJobURL(country)}/jobs?${params.toString()}`;
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
    if (Array.isArray(preferences.location) && !preferences.remoteOnly) {
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

  buildWorkableUrl(preferences) {
    const keywords = this.getFirstOrString(preferences.positions);

    const location = this.getFirstOrString(preferences.location);
    const remoteKeyword =
      preferences.remoteOnly || preferences.workMode?.includes("Remote")
        ? " remote"
        : "";

    return `https://www.google.com/search?q=site:workable.com+"${encodeURIComponent(
      keywords
    )} "${location}${remoteKeyword}`;
  }

  buildAshbyUrl(preferences) {
    const keywords = this.getFirstOrString(preferences.positions);
    const location = this.getFirstOrString(preferences.location);
    const remoteKeyword =
      preferences.remoteOnly || preferences.workMode?.includes("Remote")
        ? " remote"
        : "";

    return `https://www.google.com/search?q=site:ashbyhq.com+"${encodeURIComponent(
      keywords
    )}"${location}${remoteKeyword}`;
  }

  buildBreezyUrl(preferences) {
    const keywords = this.getFirstOrString(preferences.positions);
    const location = this.getFirstOrString(preferences.location);
    const remoteKeyword =
      preferences.remoteOnly || preferences.workMode?.includes("Remote")
        ? " remote"
        : "";

    const fullQuery = `site:breezy.hr "${keywords}"${location}${remoteKeyword}`;
    return `https://www.google.com/search?q=${encodeURIComponent(fullQuery)}`;
  }

  buildWorkdayUrl(preferences) {
    const keywords = this.getFirstOrString(preferences.positions);
    const location = this.getFirstOrString(preferences.location);

    return `https://www.google.com/search?q=site:myworkdayjobs.com+"${encodeURIComponent(
      keywords
    )}"${location}`;
  }

  buildRecruiteeUrl(preferences) {
    const keywords = this.getFirstOrString(preferences.positions);
    const location = this.getFirstOrString(preferences.location);

    return `https://www.google.com/search?q=site:recruitee.com+"${encodeURIComponent(
      keywords
    )}"${location}`;
  }

  buildLeverUrl(preferences) {
    const keywords = this.getFirstOrString(preferences.positions);
    const location = this.getFirstOrString(preferences.location);

    return `https://www.google.com/search?q=site:jobs.lever.co+"${encodeURIComponent(
      keywords
    )}"${location}`;
  }

  async stopAutomation(sessionId) {
    const automation = this.activeAutomations.get(sessionId);
    if (automation) {
      await automation.stop();
      this.activeAutomations.delete(sessionId);

      try {
        await chrome.windows.remove(automation.windowId);
      } catch (error) {
        this.logger.error("Error closing automation window:", error);
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
}

class AutomationSession {
  constructor({ sessionId, platform, userId, windowId, params, orchestrator, logger, devMode = false }) {
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
    this.devMode = devMode;
    this.logger = logger;

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
      devMode: this.devMode,
      country: this.params.country || "US",
      apiHost: this.params.apiHost,
    };
  }

  getApiHost() {
    return this.params.apiHost;
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
      this.logger.error("Error sending message to content script:", error);
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
