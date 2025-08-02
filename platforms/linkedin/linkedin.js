// platforms/linkedin/linkedin.js
import BasePlatform from "../base-platform.js";
import AIService from "../../services/ai-service.js";
import ApplicationTrackerService from "../../services/application-tracker-service.js";
import UserService from "../../services/user-service.js";
import ChatbotStatusOverlay from "../../services/status-notification-service.js";
import LinkedInFileHandler from "./linkedin-file-handler.js";

export default class LinkedInPlatform extends BasePlatform {
  constructor(config) {
    super(config);
    this.platform = "linkedin";
    this.baseUrl = "https://www.linkedin.com";
    this.hasStarted = false;
    this.automationStarted = false;
    this.processedJobs = new Set();
    this.answerCache = new Map();

    this.userProfile = config.userProfile || null;

    const apiHost = config.apiHost || config.config?.apiHost;
    this.HOST = apiHost;

    this.aiService = new AIService({ apiHost });
    this.appTracker = new ApplicationTrackerService({
      apiHost,
      userId: config.userId,
    });
    this.userService = new UserService({ apiHost, userId: config.userId });

    this.fileHandler = new LinkedInFileHandler({ apiHost });

    this.statusOverlay = null;

    this.log("🔧 LinkedIn platform constructor completed");
  }

  updateConfig(newConfig) {
    this.config = { ...this.config, ...newConfig };

    const newApiHost = newConfig.apiHost || newConfig.config?.apiHost;
    if (newApiHost && newApiHost !== this.HOST) {
      this.HOST = newApiHost;

      this.aiService = new AIService({ apiHost: newApiHost });
      this.appTracker = new ApplicationTrackerService({
        apiHost: newApiHost,
        userId: this.userId,
      });
      this.userService = new UserService({
        apiHost: newApiHost,
        userId: this.userId
      });
      this.fileHandler = new LinkedInFileHandler({ apiHost: newApiHost });

      if (this.fileHandler && this.statusOverlay) {
        this.fileHandler.setStatusManager(this.statusOverlay);
      }

      this.log("🔧 Config updated - apiHost changed, services recreated:", {
        newApiHost,
        hasAiService: !!this.aiService,
        hasAppTracker: !!this.appTracker,
        hasUserService: !!this.userService,
        hasFileHandler: !!this.fileHandler
      });
    }

    this.log("✅ Config updated successfully:", {
      config: this.config,
      apiHost: this.HOST,
      preferences: this.config.preferences
    });
  }

  async setSessionContext(sessionContext) {
    try {
      this.sessionContext = sessionContext;

      if (sessionContext.sessionId) this.sessionId = sessionContext.sessionId;
      if (sessionContext.platform) this.platform = sessionContext.platform;
      if (sessionContext.userId) this.userId = sessionContext.userId;

      if (sessionContext.userProfile) {
        if (!this.userProfile || Object.keys(this.userProfile).length === 0) {
          this.userProfile = sessionContext.userProfile;
          this.log("👤 User profile loaded from session context");
        } else {
          this.userProfile = {
            ...this.userProfile,
            ...sessionContext.userProfile,
          };
          this.log("👤 User profile merged with session context");
        }
      }

      if (!this.userProfile && this.userId) {
        try {
          this.log("📡 No user profile in sessionContext, fetching from API...");
          this.userProfile = await this.userService.getUserDetails();
          this.log("✅ User profile fetched from API as fallback");
        } catch (error) {
          console.error("❌ Failed to fetch user profile from API:", error);
        }
      }

      if (sessionContext.userId && sessionContext.userId !== this.appTracker?.userId) {
        this.appTracker = new ApplicationTrackerService({
          apiHost: this.HOST,
          userId: sessionContext.userId,
        });
        this.userService = new UserService({
          apiHost: this.HOST,
          userId: sessionContext.userId,
        });
      }

      await this.createOrUpdateStatusOverlay();

      this.log("✅ LinkedIn session context set successfully", {
        hasUserProfile: !!this.userProfile,
        userId: this.userId,
        sessionId: this.sessionId,
        profileName: this.userProfile?.name || this.userProfile?.firstName,
        profileEmail: this.userProfile?.email,
        hasOverlay: !!this.statusOverlay,
        apiHost: this.HOST,
      });
    } catch (error) {
      console.error("❌ Error setting LinkedIn session context:", error);
      if (this.statusOverlay) {
        this.statusOverlay.addError("❌ Error setting session context: " + error.message);
      }
    }
  }

  async createOrUpdateStatusOverlay() {
    try {
      if (this.statusOverlay) {
        this.log("🔄 Destroying existing overlay to recreate with proper session data");
        this.statusOverlay.destroy();
        this.statusOverlay = null;
      }

      if (!this.sessionId || !this.userId) {
        console.warn("⚠️ Cannot create overlay without sessionId and userId");
        return;
      }

      this.statusOverlay = new ChatbotStatusOverlay({
        id: `${this.platform}-status-overlay`,
        platform: `${this.platform.toUpperCase()}`,
        sessionId: this.sessionId,
        userId: this.userId,
        icon: "🤖",
        position: { top: "10px", left: "10px" },
        persistMessages: false,
        enableControls: true,
        manual: false,
      });

      if (this.fileHandler) {
        this.fileHandler.setStatusManager(this.statusOverlay);
      }

      this.statusOverlay.addFormattedMessage("🔧 LinkedIn platform initialized:", {
        userId: this.userId,
        hasUserProfile: !!this.userProfile,
        profileName: this.userProfile?.name || this.userProfile?.firstName,
        apiHost: this.HOST,
      });

      this.log("✅ Status overlay created successfully with session data");
    } catch (error) {
      console.error("❌ Error creating status overlay:", error);
    }
  }

  async checkUserAuthorization() {
    try {
      this.statusOverlay.addInfo("Let me check if you're all set to apply...");

      if (!this.userProfile) {
        console.warn("⚠️ No user profile available for authorization check");
        this.statusOverlay.addWarning("No user profile available for authorization check");

        try {
          this.log("📡 Fetching user profile as last resort for authorization...");
          this.userProfile = await this.userService.getUserDetails();
        } catch (error) {
          throw new Error("Cannot check authorization without user profile");
        }
      }

      const canApply = await this.userService.canApplyMore();
      console.log("Can apply:", canApply);
      console.log("User profile:", this.userProfile);
      if (!canApply) {
        const remaining = await this.userService.getRemainingApplications();
        console.log("Remaining applications:", remaining);

        const message = this.userProfile.userRole === "credit"
          ? `Looks like you're running low on credits (${this.userProfile.credits} left). Time to top up! 💳`
          : `You've hit your daily limit! Don't worry, you have ${remaining} applications left overall. 📊`;

        this.statusOverlay.addWarning(message);
        throw new Error(`Cannot apply: ${message}`);
      }

      this.log("✅ User authorization check passed using existing profile");
      this.statusOverlay.addSuccess("Perfect! You're all authorized and ready to go!");
    } catch (error) {
      this.log("❌ User authorization check failed:", error.message);
      this.statusOverlay.addError("Hmm, there's an issue with your account permissions. " + error.message);
      throw error;
    }
  }

  async initialize() {
    await super.initialize();
    this.log("🔗 LinkedIn platform initialized");

    if (!this.statusOverlay) {
      this.log("🔄 No overlay found in initialize, creating fallback overlay");

      this.statusOverlay = new ChatbotStatusOverlay({
        id: `${this.platform}-status-overlay-fallback`,
        platform: `${this.platform.toUpperCase()}`,
        sessionId: this.sessionId || `fallback-${Date.now()}`,
        userId: this.userId || "unknown",
        icon: "🤖",
        position: { top: "10px", left: "10px" },
        persistMessages: false,
        enableControls: true,
        manual: false,
      });

      if (this.fileHandler) {
        this.fileHandler.setStatusManager(this.statusOverlay);
      }

      this.statusOverlay.addWarning("Overlay created with fallback data - some features may be limited");
    }

    if (this.statusOverlay && !this.statusOverlay.isDestroyed) {
      this.statusOverlay.show();
      this.log("✅ LinkedIn platform initialized with working overlay");
    } else {
      console.warn("⚠️ LinkedIn platform initialized but overlay is not functional");
    }
  }

  async start(params = {}) {
    if (this.hasStarted) {
      this.log("⚠️ LinkedIn automation already started, ignoring duplicate start request");
      this.statusOverlay.addWarning("Hey! I'm already working on finding you jobs. Let me finish this round first! 😊");
      return;
    }

    this.updateConfig(params);

    this.hasStarted = true;
    this.isRunning = true;
    this.log("🚀 Starting LinkedIn automation with user profile from sessionContext");
    this.statusOverlay.addInfo("Alright, let's get you some amazing job opportunities! Let me start searching based on your preferences...");

    try {
      if (!this.userProfile) {
        throw new Error("Cannot start LinkedIn automation without user profile");
      }

      this.log("🚀 Starting LinkedIn automation with profile:", {
        name: this.userProfile.name || this.userProfile.firstName,
        email: this.userProfile.email,
        hasResumeUrl: !!this.userProfile.resumeUrl,
        userId: this.userProfile.userId || this.userId,
        apiHost: this.HOST,
      });

      if (!this.config.jobsToApply || this.config.jobsToApply <= 0) {
        const errorMessage = "I need to know how many jobs you want me to apply to!";
        this.statusOverlay.addError(errorMessage);
        throw new Error(errorMessage);
      }

      await this.checkUserAuthorization();

      this.updateProgress({ total: this.config.jobsToApply });
      await this.waitForPageLoad();
      this.log("📄 Basic page loaded, current URL:", window.location.href);

      const currentUrl = window.location.href.toLowerCase();
      if (!currentUrl.includes("linkedin.com/jobs")) {
        this.log("📍 Navigating to LinkedIn Jobs with user preferences");
        this.statusOverlay.addInfo("Let me take you to the LinkedIn jobs page where all the magic happens! ✨");
        await this.navigateToLinkedInJobs();
      } else {
        this.log("✅ Already on LinkedIn Jobs page");
        this.statusOverlay.addSuccess("Great! We're already on LinkedIn Jobs. Now let me fine-tune the search for you...");
        await this.applyAdditionalFilters();
      }

      await this.waitForSearchResultsLoad();

      this.automationStarted = true;
      this.statusOverlay.updateStatus("applying", "Finding perfect matches for you");
      await this.processJobs({ jobsToApply: this.config.jobsToApply });
    } catch (error) {
      this.hasStarted = false;
      this.reportError(error, { phase: "start" });
    }
  }

  async navigateToLinkedInJobs() {
    const searchUrl = await this.generateComprehensiveSearchUrl(this.config.preferences || {});
    this.log(`🔗 Navigating to: ${searchUrl}`);

    window.location.href = searchUrl;
    await this.delay(5000);
    await this.waitForPageLoad();
    this.log("✅ Navigation completed with user preferences applied");
    this.statusOverlay.addSuccess("Perfect! I've set up the search with all your preferences. Let's see what we found!");
  }

  determineApplyType(applyButton) {
    if (!applyButton) return null;

    const buttonText = applyButton.textContent?.trim().toLowerCase() || "";
    const buttonAriaLabel = applyButton.getAttribute("aria-label")?.toLowerCase() || "";

    if (buttonText.includes("easy apply") || buttonAriaLabel.includes("easy apply")) {
      return "easy_apply";
    }

    if (buttonText.includes("apply") || buttonAriaLabel.includes("apply")) {
      return "external_apply";
    }

    return "unknown";
  }

  async generateComprehensiveSearchUrl(preferences) {
    const baseUrl = "https://www.linkedin.com/jobs/search/?";

    const joinWithOR = (arr) => (arr ? arr.join(" OR ") : "");

    const params = new URLSearchParams();
    params.append("f_AL", "true");

    if (preferences.positions?.length) {
      params.append("keywords", joinWithOR(preferences.positions));
    }

    if (preferences.location?.length) {
      const location = preferences.location[0];

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

      if (location === "Remote" || preferences.remoteOnly) {
        params.append("f_WT", "2");
      } else if (geoIdMap[location]) {
        params.append("geoId", geoIdMap[location]);
      } else {
        params.append("location", location);
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
    } else if (preferences.remoteOnly) {
      params.append("f_WT", "2");
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

    params.append("sortBy", "R");

    const finalUrl = baseUrl + params.toString();
    this.log("🔍 Generated search URL with preferences:", {
      url: finalUrl,
      preferences: preferences,
    });

    return finalUrl;
  }

  async applyAdditionalFilters() {
    try {
      const preferences = this.config.preferences || {};

      if (preferences.companyRating && preferences.companyRating !== "") {
        this.statusOverlay.addInfo(`I'm adding a company rating filter to only show companies rated ${preferences.companyRating}+ stars! ⭐`);
        await this.applyCompanyRatingFilter(preferences.companyRating);
      }

      this.log("✅ Additional filters applied successfully");
      this.statusOverlay.addSuccess("All your filters are now applied! Let's find you some top-quality opportunities!");
    } catch (error) {
      this.log("⚠️ Failed to apply some additional filters:", error.message);
      this.statusOverlay.addWarning("I had trouble with some of the advanced filters, but don't worry - the main search is working great!");
    }
  }

  async applyCompanyRatingFilter(minRating) {
    try {
      this.log(`🏢 Attempting to apply company rating filter: ${minRating}+`);

      const moreFiltersButton = await this.waitForElement(
        'button[aria-label*="Show more filters"], button[data-control-name="filter_show_more"]',
        5000
      );

      if (moreFiltersButton) {
        moreFiltersButton.click();
        await this.delay(1000);

        const ratingSelector = `button[aria-label*="${minRating}"], input[value="${minRating}"]`;
        const ratingElement = await this.waitForElement(ratingSelector, 3000);

        if (ratingElement) {
          ratingElement.click();
          await this.delay(500);

          const applyButton = await this.waitForElement('button[data-control-name="filter_show_results"]', 3000);

          if (applyButton) {
            applyButton.click();
            await this.delay(2000);
            this.log("✅ Company rating filter applied");
            this.statusOverlay.addSuccess("Company rating filter applied successfully!");
          }
        }
      }
    } catch (error) {
      this.log("Failed to apply company rating filter:", error.message);
      this.statusOverlay.addWarning("Couldn't apply the company rating filter, but the other filters are working fine!");
    }
  }

  doesJobMatchPreferences(jobDetails) {
    const preferences = this.config.preferences || {};

    // if (preferences.salary?.length === 2) {
    //   const [minSalary, maxSalary] = preferences.salary;
    //   const jobSalary = this.extractSalaryFromJobDetails(jobDetails);

    //   if (jobSalary && (jobSalary < minSalary || jobSalary > maxSalary)) {
    //     this.log(`❌ Job salary ${jobSalary} outside range ${minSalary}-${maxSalary}`);
    //     return false;
    //   }
    // }

    if (preferences.positions?.length) {
      const jobTitle = jobDetails.title?.toLowerCase() || "";
      const hasMatchingPosition = preferences.positions.some((position) =>
        jobTitle.includes(position.toLowerCase())
      );

      if (!hasMatchingPosition) {
        this.log(`❌ Job title "${jobDetails.title}" doesn't match required positions`);
        return false;
      }
    }

    return true;
  }

  extractSalaryFromJobDetails(jobDetails) {
    const salaryText = jobDetails.salary || jobDetails.description || "";
    const salaryMatch = salaryText.match(/\$(\d{1,3}(?:,\d{3})*(?:\.\d{2})?)/);
    return salaryMatch ? parseInt(salaryMatch[1].replace(/,/g, "")) : null;
  }

  isRemoteJob(jobDetails) {
    const workplace = jobDetails.workplace?.toLowerCase() || "";
    const location = jobDetails.location?.toLowerCase() || "";
    const description = jobDetails.description?.toLowerCase() || "";

    const remoteKeywords = ["remote", "work from home", "wfh", "telecommute"];

    return remoteKeywords.some(
      (keyword) =>
        workplace.includes(keyword) ||
        location.includes(keyword) ||
        description.includes(keyword)
    );
  }

  async saveExternalJob(jobDetails) {
    try {
      const externalJobData = {
        jobId: jobDetails.jobId,
        title: jobDetails.title,
        company: jobDetails.company,
        location: jobDetails.location,
        jobUrl: window.location.href,
        salary: jobDetails.salary || "Not specified",
        workplace: jobDetails.workplace,
        postedDate: jobDetails.postedDate,
        applicants: jobDetails.applications,
        platform: this.platform,
        applyType: "external",
        dateFound: new Date().toISOString(),
      };

      this.log(`📝 External job logged: ${jobDetails.title} at ${jobDetails.company}`);
      this.statusOverlay.addInfo(`I found an interesting job at ${jobDetails.company} but it requires applying on their website. I'll save it for you! 📝`);

      return true;
    } catch (error) {
      console.error("Error saving external job:", error);
      this.log(`❌ Error saving external job: ${error.message}`);
      return false;
    }
  }

  async processJobs({ jobsToApply }) {
    let processedCount = 0;
    let appliedCount = 0;
    let skippedCount = 0;
    let filteredCount = 0; // Track jobs filtered out by preferences
    let processedJobs = new Set();
    let currentPage = 1;
    let noNewJobsCount = 0;
    const MAX_NO_NEW_JOBS = 3;

    try {
      this.log(`Starting to process jobs with user preferences. Target: ${jobsToApply} jobs`);
      this.log(`User preferences:`, this.config.preferences);
      this.statusOverlay.addInfo(`Alright! I'm going to help you apply to ${jobsToApply} jobs. Let me start scanning through the opportunities...`);

      await this.initialScroll();

      while (appliedCount < jobsToApply) {
        const jobCards = await this.getJobCards();
        this.log(`Found ${jobCards.length} job cards on page ${currentPage}`);

        if (jobCards.length === 0) {
          this.log("No job cards found, trying to scroll first before pagination");
          this.statusOverlay.addInfo("Hmm, let me scroll down to load more jobs...");
          if (await this.scrollAndWaitForNewJobs()) {
            this.log("Scrolling loaded new jobs, continuing on same page");
            continue;
          }

          const hasNextPage = await this.goToNextPage(currentPage);
          if (hasNextPage) {
            currentPage++;
            noNewJobsCount = 0;
            this.statusOverlay.addInfo(`Moving to page ${currentPage} to find more opportunities!`);
            await this.waitForPageLoad();
            continue;
          } else {
            this.log("No more pages available");
            this.statusOverlay.addWarning("Looks like I've reached the end of available jobs for your search criteria!");
            break;
          }
        }

        let newJobsFound = false;
        let newApplicableJobsFound = false;

        this.log(`Processing ${jobCards.length} job cards on page ${currentPage}`);
        this.statusOverlay.addInfo(`Great! I found ${jobCards.length} jobs on page ${currentPage}. Let me check each one...`);

        for (const jobCard of jobCards) {
          if (appliedCount >= jobsToApply) {
            this.log(`Reached target of ${jobsToApply} jobs`);
            this.statusOverlay.addSuccess(`Amazing! I've successfully applied to your target of ${jobsToApply} jobs! 🎉`);
            break;
          }

          const jobId = this.getJobIdFromCard(jobCard);

          if (!jobId || processedJobs.has(jobId)) {
            continue;
          }

          processedJobs.add(jobId);
          newJobsFound = true;
          processedCount++;

          try {
            if (!this.isElementInViewport(jobCard)) {
              jobCard.scrollIntoView({ behavior: "smooth", block: "center" });
              await this.sleep(1000);
            }

            await this.clickJobCard(jobCard);
            await this.waitForJobDetailsLoad();

            const jobDetails = this.getJobProperties();

            // Check if job matches user preferences BEFORE checking apply button
            if (!this.doesJobMatchPreferences(jobDetails)) {
              this.log(`❌ Job "${jobDetails.title}" at ${jobDetails.company} doesn't match user preferences, skipping.`);
              this.statusOverlay.addInfo(`Skipping "${jobDetails.title}" - it doesn't match your preferences perfectly 🎯`);
              filteredCount++;
              continue;
            }

            this.log(`✅ Job "${jobDetails.title}" at ${jobDetails.company} matches user preferences!`);
            this.statusOverlay.addSuccess(`Great match! "${jobDetails.title}" at ${jobDetails.company} fits your criteria perfectly! ✨`);

            const applyButton = await this.findEasyApplyButton();
            if (!applyButton) {
              this.log(`Already applied to job ${jobId}, skipping.`);
              skippedCount++;
              continue;
            }

            const applyType = this.determineApplyType(applyButton);

            if (applyType === "external_apply") {
              this.log(`External apply job found: ${jobDetails.title} - Logging as external job`);
              this.statusOverlay.addInfo(`"${jobDetails.title}" at ${jobDetails.company} requires applying on their company website. I'll save this one for you to apply manually later! 📌`);

              await this.saveExternalJob(jobDetails);
              skippedCount++;
              continue;
            } else if (applyType === "easy_apply") {
              this.log(`Easy Apply job found: ${jobDetails.title} - Proceeding with application`);
              this.statusOverlay.addSuccess(`Perfect! "${jobDetails.title}" at ${jobDetails.company} has Easy Apply! Let me apply for you right now...`);

              const alreadyApplied = await this.appTracker.checkIfAlreadyApplied(jobId);
              if (alreadyApplied) {
                this.log(`Already applied to job ${jobId} (from database), skipping.`);
                skippedCount++;
                continue;
              }

              newApplicableJobsFound = true;

              this.updateProgress({
                current: `Applying to: ${jobDetails.title} at ${jobDetails.company}`,
              });

              const success = await this.applyToJob(applyButton, jobDetails);

              if (success) {
                appliedCount++;
                this.progress.completed = appliedCount;
                this.updateProgress({ completed: appliedCount });

                await this.userService.updateApplicationCount();

                this.log(`Successfully applied to job ${appliedCount}/${jobsToApply} (${skippedCount} jobs skipped, ${filteredCount} filtered out)`);
                this.statusOverlay.addSuccess(`Woohoo! Just applied to "${jobDetails.title}" at ${jobDetails.company}! That's ${appliedCount} down, ${jobsToApply - appliedCount} to go! 🎯`);

                this.reportApplicationSubmitted(jobDetails, {
                  method: "Easy Apply",
                  userId: this.config.userId || this.userId,
                  matchedPreferences: true,
                });
              } else {
                this.progress.failed++;
                this.updateProgress({ failed: this.progress.failed });
                this.statusOverlay.addError(`Oops! Had trouble applying to "${jobDetails.title}". Don't worry, I'll keep going with the next ones!`);
              }
            } else {
              this.log(`Unknown apply button type for job ${jobId}, skipping.`);
              this.statusOverlay.addWarning(`I'm not sure how to apply to "${jobDetails.title}" - the apply button looks different than usual.`);
              skippedCount++;
              continue;
            }

            await this.sleep(2000);
          } catch (error) {
            this.log(`Error processing job ${jobId} on page ${currentPage}`);
            this.statusOverlay.addError(`Had a little hiccup with one of the jobs, but I'm keeping going! 💪`);
            console.error(`Error processing job ${jobId}:`, error);
            continue;
          }
        }

        if (!newApplicableJobsFound) {
          this.log(`No new applicable jobs found on page ${currentPage}, trying to scroll for more jobs...`);
          if (await this.scrollAndWaitForNewJobs()) {
            noNewJobsCount = 0;
            this.log(`Scrolling loaded new jobs on page ${currentPage}, continuing processing...`);
            continue;
          }

          this.log(`No more jobs loaded by scrolling on page ${currentPage}, moving to next page...`);
          const hasNextPage = await this.goToNextPage(currentPage);
          if (hasNextPage) {
            currentPage++;
            noNewJobsCount = 0;
            this.log(`Successfully moved to page ${currentPage}`);
            this.statusOverlay.addInfo(`Let me check page ${currentPage} for more opportunities!`);
            await this.waitForPageLoad();
          } else {
            noNewJobsCount++;
            if (noNewJobsCount >= MAX_NO_NEW_JOBS) {
              this.log(`No more applicable jobs to apply. Applied to ${appliedCount}/${jobsToApply} (${skippedCount} jobs skipped, ${filteredCount} filtered out)`);
              this.statusOverlay.addSuccess(`I've looked everywhere and applied to ${appliedCount} out of ${jobsToApply} jobs! I filtered out ${filteredCount} jobs that didn't match your preferences and skipped ${skippedCount} others. 🎯`);
              break;
            }
          }
        } else {
          noNewJobsCount = 0;
          this.log(`Found and processed applicable jobs on page ${currentPage}, continuing...`);
        }
      }

      const completionStatus = appliedCount >= jobsToApply ? "target_reached" : "no_more_jobs";
      const message = appliedCount >= jobsToApply
        ? `Mission accomplished! 🎉 I successfully applied to all ${appliedCount} jobs you wanted! We looked through ${processedCount} total opportunities across ${currentPage} pages and filtered out ${filteredCount} jobs that didn't match your criteria.`
        : `Great work! I applied to ${appliedCount} out of ${jobsToApply} jobs. I looked through ${processedCount} opportunities, filtered out ${filteredCount} that didn't match your preferences, and skipped ${skippedCount} others that weren't quite right.`;

      this.log(message);
      this.statusOverlay.addSuccess(message);
      this.reportComplete();

      return {
        status: completionStatus,
        message,
        appliedCount,
        processedCount,
        skippedCount,
        filteredCount, // New field to track preference filtering
        totalPages: currentPage,
        preferencesUsed: this.config.preferences,
      };
    } catch (error) {
      console.error("Error in processJobs:", error);
      this.statusOverlay.addError("Something went wrong during the job application process. Don't worry though - I saved your progress!");
      this.reportError(error, { phase: "processJobs" });
      throw error;
    }
  }

  async applyToJob(applyButton, jobDetails) {
    try {
      this.statusOverlay.addInfo(`Starting my application magic for "${jobDetails.title}"... ✨`);

      applyButton.click();

      let currentStep = "initial";
      let attempts = 0;
      const maxAttempts = 20;

      while (currentStep !== "submitted" && attempts < maxAttempts) {
        await this.fillCurrentStep();
        currentStep = await this.moveToNextStep();
        attempts++;

        if (currentStep === "submitted") {
          await this.handlePostSubmissionModal();
        }
      }

      if (attempts >= maxAttempts) {
        this.statusOverlay.addError("This application had too many steps, so I had to skip it. Don't worry, I'll keep going!");
        await this.closeApplication();
        await this.sleep(1000);
        return false;
      }

      await this.saveAppliedJob(jobDetails);
      this.statusOverlay.addSuccess(`Successfully submitted your application to "${jobDetails.title}"! 🚀`);
      return true;
    } catch (error) {
      this.statusOverlay.addError(`Had trouble with this application, but I'm moving on to the next one!`);
      await this.handleErrorState();
      await this.sleep(1000);
      return false;
    }
  }

  async fillCurrentStep() {
    const fileUploadContainers = document.querySelectorAll(".js-jobs-document-upload__container");
    if (fileUploadContainers.length) {
      this.statusOverlay.addInfo("Time to upload your resume! Let me handle that for you...");

      for (const container of fileUploadContainers) {
        try {
          const jobDescription = this.scrapeJobDescription();
          const success = await this.fileHandler.handleFileUpload(container, this.userProfile, jobDescription);

          if (success) {
            this.log(`✅ File uploaded successfully for container`);
            this.statusOverlay.addSuccess("Resume uploaded perfectly! 📄");
          } else {
            this.log(`⚠️ File upload failed for container`);
            this.statusOverlay.addWarning("Had a small issue with the resume upload, but continuing...");
          }
        } catch (error) {
          this.log(`❌ File upload error: ${error.message}`);
          this.statusOverlay.addError("Resume upload had an issue, but I'll keep going!");
        }
      }
    }

    const questions = document.querySelectorAll(".fb-dash-form-element");
    for (const question of questions) {
      await this.handleQuestion(question);
    }
  }

  async handleQuestion(question) {
    if (question.classList.contains("js-jobs-document-upload__container") || question.hasAttribute("data-processed")) {
      return;
    }

    const questionHandlers = {
      select: this.handleSelectQuestion,
      radio: this.handleRadioQuestion,
      text: this.handleTextQuestion,
      textarea: this.handleTextAreaQuestion,
      checkbox: this.handleCheckboxQuestion,
    };

    for (const [type, handler] of Object.entries(questionHandlers)) {
      const element = question.querySelector(this.getQuestionSelector(type));
      if (element) {
        await handler.call(this, element);
        question.setAttribute("data-processed", "true");
        return;
      }
    }
  }

  getQuestionSelector(type) {
    const selectors = {
      select: "select",
      radio: 'fieldset[data-test-form-builder-radio-button-form-component="true"]',
      text: "input[type='text']",
      textarea: "textarea",
      checkbox: "input[type='checkbox']",
    };
    return selectors[type];
  }

  async handleSelectQuestion(select) {
    const container = select.closest(".fb-dash-form-element");
    const labelElement = container.querySelector(".fb-dash-form-element__label");
    const label = labelElement?.textContent?.trim();

    const options = Array.from(select.options)
      .filter((opt) => opt.value !== "Select an option")
      .map((opt) => opt.text.trim());

    const answer = await this.getAnswer(label, options);
    select.value = answer;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  }

  async handleRadioQuestion(radio) {
    const label = this.getQuestionLabel(radio);
    const options = Array.from(radio.querySelectorAll('input[type="radio"]')).map((input) => {
      const labelElement = document.querySelector(`label[for="${input.id}"]`);
      return labelElement ? labelElement.textContent : "Unknown";
    });
    const answer = await this.getAnswer(label, options);

    const answerElement = Array.from(radio.querySelectorAll("label")).find((el) => el.textContent.includes(answer));
    if (answerElement) answerElement.click();
  }

  async handleTextQuestion(textInput) {
    const label = this.getQuestionLabel(textInput);
    const answer = await this.getAnswer(label);

    const isDateField = textInput.getAttribute("placeholder") === "mm/dd/yyyy" ||
      textInput.getAttribute("name") === "artdeco-date" ||
      label.toLowerCase().includes("date");

    if (isDateField) {
      const formattedDate = this.formatDateForInput(answer);
      textInput.value = formattedDate;
      textInput.dispatchEvent(new Event("input", { bubbles: true }));
      textInput.dispatchEvent(new Event("blur", { bubbles: true }));
      return;
    }

    const isTypeahead = textInput.getAttribute("role") === "combobox";
    textInput.value = answer;
    textInput.dispatchEvent(new Event("input", { bubbles: true }));

    if (isTypeahead) {
      await this.sleep(1000);
      textInput.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown" }));
      await this.sleep(500);
      textInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    }
  }

  async handleTextAreaQuestion(textArea) {
    const label = this.getQuestionLabel(textArea);
    const answer = await this.getAnswer(label);
    textArea.value = answer;
    textArea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  async handleCheckboxQuestion(checkbox) {
    const label = this.getQuestionLabel(checkbox);
    const answer = (await this.getAnswer(label, ["Yes", "No"])) === "Yes";
    checkbox.checked = answer;
    checkbox.dispatchEvent(new Event("change", { bubbles: true }));
  }

  getQuestionLabel(element) {
    const container = element.closest(".fb-dash-form-element");
    if (!container) return "Unknown";

    const label = container.querySelector("label, legend, .fb-dash-form-element__label");
    if (!label) return "Unknown";

    return label.textContent.trim().replace(/\s+/g, " ");
  }

  async getAnswer(label, options = []) {
    const normalizedLabel = label?.toLowerCase()?.trim() || "";

    if (this.answerCache.has(normalizedLabel)) {
      return this.answerCache.get(normalizedLabel);
    }

    try {
      this.statusOverlay.addInfo(`Thinking about how to answer: "${label}"...`);

      // Use the standardized method from base platform
      const answer = await this.getAIAnswer(label, options, null, {
        fieldContext: `LinkedIn Easy Apply form field`
      });

      if (answer !== null && answer !== undefined && answer !== "") {
        this.statusOverlay.addSuccess(`Got the perfect answer for that question! ✨`);
        this.answerCache.set(normalizedLabel, answer);
        return answer;
      } else {
        this.statusOverlay.addWarning(`Couldn't find a good answer for that question`);
        return null;
      }
    } catch (error) {
      console.error("AI Answer Error:", error);
      this.statusOverlay.addError(`Had trouble answering that question, but I'll keep going!`);
      throw error;
    }
  }

  // Helper methods to add to the LinkedIn class

  determineFieldType(label, options) {
    if (this.isSalaryField(label)) return "salary";
    if (this.isDateField(label)) return "date";
    if (this.isLocationField(label)) return "location";
    if (this.isHowDidYouHearField(label)) return "source";
    if (options && options.length > 0) return "select";
    return "text";
  }

  buildFieldContext(label, options) {
    let context = `Field label: "${label}"`;

    if (options && options.length > 0) {
      context += `. Available options: ${options.join(", ")}`;
    }

    if (this.isSalaryField(label)) {
      context += ". This is a salary/compensation field requiring numeric input only.";
    }

    if (this.isDateField(label)) {
      context += ". This is a date field requiring MM/DD/YYYY format.";
    }

    if (this.isLocationField(label)) {
      context += ". This is a location field that should use user's location data.";
    }

    return context;
  }

  isSalaryField(label) {
    const salaryPatterns = [
      /salary/i,
      /compensation/i,
      /expected.*salary/i,
      /salary.*expectation/i,
      /pay.*range/i,
      /wage/i,
      /rate.*hour/i,
      /hourly.*rate/i,
      /annual.*income/i,
      /desired.*salary/i
    ];

    return salaryPatterns.some(pattern => pattern.test(label));
  }

  isDateField(label) {
    const datePatterns = [
      /date.*available/i,
      /start.*date/i,
      /available.*date/i,
      /graduation.*date/i,
      /end.*date/i,
      /when.*available/i,
      /notice.*period/i
    ];

    return datePatterns.some(pattern => pattern.test(label));
  }

  isLocationField(label) {
    const locationPatterns = [
      /location/i,
      /where.*located/i,
      /city.*state/i,
      /address/i,
      /where.*live/i,
      /residence/i,
      /geographic/i
    ];

    return locationPatterns.some(pattern => pattern.test(label));
  }

  isHowDidYouHearField(label) {
    const hearPatterns = [
      /how.*did.*you.*hear/i,
      /how.*did.*you.*find/i,
      /source.*referral/i,
      /referred.*by/i,
      /how.*learn.*about/i
    ];

    return hearPatterns.some(pattern => pattern.test(label));
  }

  getUserLocationData() {
    const userData = this.userProfile;

    // Try different location combinations like Ashby
    if (userData.streetAddress) {
      return userData.streetAddress;
    }

    // Combine city, state, country
    const parts = [];
    if (userData.city) parts.push(userData.city);
    if (userData.state) parts.push(userData.state);
    if (userData.country && userData.country !== "United States") {
      parts.push(userData.country);
    }

    if (parts.length > 0) {
      return parts.join(", ");
    }

    // State and country only
    if (userData.state) {
      let location = userData.state;
      if (userData.country && userData.country !== "United States") {
        location += ", " + userData.country;
      }
      return location;
    }

    // Country only
    if (userData.country) {
      return userData.country;
    }

    return "";
  }

  /**
   * Extract numeric salary value from AI response (copied from Ashby)
   */
  extractNumericSalary(salaryText) {
    if (!salaryText || salaryText === null || salaryText === undefined) {
      this.log("❌ No salary text provided");
      return null;
    }

    // Convert to string and clean
    const cleaned = String(salaryText)
      .replace(/[$,\s]/g, "") // Remove dollar signs, commas, spaces
      .replace(/[^\d.]/g, ""); // Keep only digits and decimal points

    // Extract first number found
    const match = cleaned.match(/\d+\.?\d*/);
    if (match) {
      const number = parseFloat(match[0]);
      if (!isNaN(number) && number > 0) {
        const result = Math.round(number).toString();
        this.log(`✅ Extracted salary: ${salaryText} -> ${result}`);
        return result;
      }
    }

    this.log(`❌ Could not extract valid salary from: ${salaryText}`);
    return null;
  }


  /**
  * Extract numeric salary value from AI response
  */
  extractNumericSalary(salaryText) {
    if (!salaryText || salaryText === null || salaryText === undefined) {
      this.logger("❌ No salary text provided");
      return null;
    }

    // Convert to string and clean
    const cleaned = String(salaryText)
      .replace(/[$,\s]/g, "") // Remove dollar signs, commas, spaces
      .replace(/[^\d.]/g, ""); // Keep only digits and decimal points

    // Extract first number found
    const match = cleaned.match(/\d+\.?\d*/);
    if (match) {
      const number = parseFloat(match[0]);
      if (!isNaN(number) && number > 0) {
        const result = Math.round(number).toString();
        this.logger(`✅ Extracted salary: ${salaryText} -> ${result}`);
        return result;
      }
    }

    this.logger(`❌ Could not extract valid salary from: ${salaryText}`);
    return null;
  }

  formatDateForInput(dateStr) {
    try {
      const date = new Date(dateStr);
      const mm = String(date.getMonth() + 1).padStart(2, "0");
      const dd = String(date.getDate()).padStart(2, "0");
      const yyyy = date.getFullYear();
      return `${mm}/${dd}/${yyyy}`;
    } catch (error) {
      return dateStr;
    }
  }

  scrapeJobDescription() {
    const descriptionElement = document.querySelector(".jobs-description-content__text");
    if (!descriptionElement) return "No job description found";

    const cleanDescription = Array.from(descriptionElement.children)
      .map((element) => {
        if (element.tagName === "UL" || element.tagName === "OL") {
          return Array.from(element.children)
            .map((li) => `• ${li.textContent.trim()}`)
            .join("\n");
        }
        return element.textContent.trim();
      })
      .filter((text) => text)
      .join("\n\n");

    return cleanDescription;
  }

  async moveToNextStep() {
    try {
      const buttonSelectors = {
        next: 'button[aria-label="Continue to next step"]',
        preview: 'button[aria-label="Review your application"]',
        submit: 'button[aria-label="Submit application"]',
        dismiss: 'button[aria-label="Dismiss"]',
        done: 'button[aria-label="Done"]',
        close: 'button[aria-label="Close"]',
        continueApplying: 'button[aria-label*="Easy Apply"][aria-label*="Continue applying"]',
        continueTips: 'button[aria-label="I understand the tips and want to continue the apply process"]',
        saveJob: 'button[data-control-name="save_application_btn"]',
      };

      await this.waitForAnyElement(Object.values(buttonSelectors));

      if (await this.findAndClickButton(buttonSelectors.continueTips)) {
        await this.sleep(2000);
        return "continue";
      }

      if (await this.findAndClickButton(buttonSelectors.continueApplying)) {
        await this.sleep(2000);
        return "continue";
      }

      if (await this.findAndClickButton(buttonSelectors.saveJob)) {
        await this.sleep(2000);
        return "saved";
      }

      if (await this.findAndClickButton(buttonSelectors.submit)) {
        this.statusOverlay.addInfo("Submitting your application now... 🚀");
        await this.sleep(2000);
        return "submitted";
      }

      if (await this.findAndClickButton(buttonSelectors.preview)) {
        await this.sleep(2000);
        return "preview";
      }

      if (await this.findAndClickButton(buttonSelectors.next)) {
        await this.sleep(2000);
        return "next";
      }

      if ((await this.findAndClickButton(buttonSelectors.dismiss)) ||
        (await this.findAndClickButton(buttonSelectors.done)) ||
        (await this.findAndClickButton(buttonSelectors.close))) {
        await this.sleep(2000);
        return "modal-closed";
      }
      return "error";
    } catch (error) {
      return "error";
    }
  }

  async goToNextPage(currentPage) {
    try {
      this.log(`Attempting to go to next page after page ${currentPage}`);

      const nextButton = document.querySelector("button.jobs-search-pagination__button--next");
      if (nextButton) {
        this.log("Found next button, clicking it");
        nextButton.click();
        await this.waitForPageLoad();
        return true;
      }

      const paginationContainer = document.querySelector(".jobs-search-pagination__pages");
      if (!paginationContainer) {
        this.log("No pagination found");
        return false;
      }

      const activeButton = paginationContainer.querySelector(".jobs-search-pagination__indicator-button--active");
      if (!activeButton) {
        this.log("No active page button found");
        return false;
      }

      const currentPageNum = parseInt(activeButton.querySelector("span").textContent);
      this.log(`Current page number: ${currentPageNum}`);

      const pageIndicators = paginationContainer.querySelectorAll(".jobs-search-pagination__indicator");
      let nextPageButton = null;

      pageIndicators.forEach((indicator) => {
        const button = indicator.querySelector("button");
        const span = button.querySelector("span");
        const pageNum = span.textContent;

        if (pageNum !== "…" && parseInt(pageNum) === currentPageNum + 1) {
          nextPageButton = button;
        }
      });

      if (nextPageButton) {
        this.log(`Found next page button for page ${currentPageNum + 1}`);
        nextPageButton.click();
        await this.waitForPageLoad();
        return true;
      }

      this.log("No next page available");
      return false;
    } catch (error) {
      console.error("Error navigating to next page:", error);
      this.statusOverlay.addError("Had trouble turning the page, but I'll keep trying!");
      return false;
    }
  }

  async initialScroll() {
    const jobsList = document.querySelector(".job-card-list ");
    if (!jobsList) return;

    const totalHeight = jobsList.scrollHeight;
    const increment = Math.floor(totalHeight / 4);

    for (let i = 0; i <= totalHeight; i += increment) {
      jobsList.scrollTo(0, i);
      await this.sleep(500);
    }

    jobsList.scrollTo(0, 0);
    await this.sleep(1000);
  }

  async scrollAndWaitForNewJobs() {
    const jobsList = document.querySelector(".job-card-list ");
    if (!jobsList) return false;

    const previousHeight = jobsList.scrollHeight;
    const previousJobCount = document.querySelectorAll(".job-card-list  [data-occludable-job-id]").length;

    const currentScroll = jobsList.scrollTop;
    const targetScroll = currentScroll + window.innerHeight * 0.75;

    jobsList.scrollTo({ top: targetScroll, behavior: "smooth" });

    await this.sleep(2000);

    const newHeight = jobsList.scrollHeight;
    const newJobCount = document.querySelectorAll(".job-card-list  [data-occludable-job-id]").length;

    this.log(`Scroll check - Previous jobs: ${previousJobCount}, New jobs: ${newJobCount}`);

    return newHeight > previousHeight || newJobCount > previousJobCount;
  }

  async waitForPageLoad() {
    try {
      await this.waitForElement(".job-card-list ");
      await this.sleep(2000);

      const spinner = document.querySelector(".artdeco-loader");
      if (spinner) {
        await new Promise((resolve) => {
          const observer = new MutationObserver(() => {
            if (!document.contains(spinner)) {
              observer.disconnect();
              resolve();
            }
          });
          observer.observe(document.body, { childList: true, subtree: true });
        });
      }
    } catch (error) {
      console.error("Error waiting for page load:", error);
    }
  }

  async waitForSearchResultsLoad() {
    return new Promise((resolve) => {
      const checkSearchResults = () => {
        if (document.querySelector(".job-card-list ")) {
          this.log("Search results loaded");
          this.statusOverlay.addSuccess("Awesome! I found some job listings for you!");
          resolve();
        } else {
          setTimeout(checkSearchResults, 500);
        }
      };
      checkSearchResults();
    });
  }

  async getJobCards() {
    const jobCards = document.querySelectorAll(".scaffold-layout__list-item[data-occludable-job-id]");
    return jobCards;
  }

  getJobIdFromCard(jobCard) {
    const jobLink = jobCard.querySelector("a[href*='jobs/view']");
    if (jobLink) {
      const href = jobLink.href;
      const match = href.match(/view\/(\d+)/);
      return match ? match[1] : null;
    }
    return jobCard.dataset.jobId || null;
  }

  async findEasyApplyButton() {
    try {
      const button = await this.waitForElement(".jobs-apply-button", 5000);
      return button;
    } catch (error) {
      this.log("Easy Apply button not found");
      return null;
    }
  }

  getJobProperties() {
    const company = document.querySelector(".job-details-jobs-unified-top-card__company-name")?.textContent || "N/A";
    const title = document.querySelector(".job-details-jobs-unified-top-card__job-title")?.textContent || "N/A";
    const urlParams = new URLSearchParams(window.location.search);
    const jobId = urlParams.get("currentJobId");

    const detailsContainer = document.querySelector(".job-details-jobs-unified-top-card__primary-description-container .t-black--light.mt2");
    const detailsText = detailsContainer ? detailsContainer.textContent : "";
    const location = detailsText.match(/^(.*?)\s·/)?.[1] || "Not specified";
    const postedDate = detailsText.match(/·\s(.*?)\s·/)?.[1] || "Not specified";
    const applications = detailsText.match(/·\s([^·]+)$/)?.[1] || "Not specified";

    const workplaceElem = document.querySelector(".job-details-preferences-and-skills__pill");
    const workplace = workplaceElem ? workplaceElem.textContent.trim() : "Not specified";

    return {
      title,
      jobId,
      company,
      location,
      postedDate,
      applications,
      workplace,
    };
  }

  async clickJobCard(jobCard) {
    try {
      const clickableElement = jobCard.querySelector("a[href*='jobs/view'], .job-card-list__title, .job-card-container__link");

      if (!clickableElement) {
        throw new Error("No clickable element found in job card");
      }

      this.log("Found clickable element:", clickableElement.tagName);

      const clickEvent = new MouseEvent("click", {
        bubbles: true,
        cancelable: true,
        view: window,
      });

      clickEvent.preventDefault();
      clickableElement.dispatchEvent(clickEvent);
      this.log("Click event dispatched");

      await this.waitForJobDetailsLoad();
      this.log("Job details loaded successfully");

      return true;
    } catch (error) {
      console.error("Error clicking job card:", error);
      throw error;
    }
  }

  async waitForJobDetailsLoad() {
    try {
      this.log("Waiting for job details to load");
      const element = await this.waitForElement(".job-details-jobs-unified-top-card__job-title", 10000);
      this.log("Job details title element found");
      await this.sleep(1000);
      return element;
    } catch (error) {
      console.error("Error waiting for job details:", error);
      throw new Error("Job details failed to load");
    }
  }

  async sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async waitForElement(selector, timeout = 10000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      const element = document.querySelector(selector);
      if (element) return element;
      await this.sleep(100);
    }
    throw new Error(`Element not found: ${selector}`);
  }

  async waitForAnyElement(selectors, timeout = 5000) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
      for (const selector of selectors) {
        const element = document.querySelector(selector);
        if (element && this.isElementVisible(element)) {
          return element;
        }
      }
      await this.sleep(100);
    }
    throw new Error(`None of the elements found: ${selectors.join(", ")}`);
  }

  isElementVisible(element) {
    if (!element) return false;

    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") {
      return false;
    }

    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return false;
    }

    return element.offsetParent !== null;
  }

  isElementInViewport(element) {
    const rect = element.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
  }

  async findAndClickButton(selector, options = {}) {
    const { dryRun = false } = options;

    const button = document.querySelector(selector);
    if (button && this.isElementVisible(button)) {
      try {
        if (dryRun) {
          this.statusOverlay.addInfo(`DRY RUN: Would have clicked button: ${selector}`);
          return true;
        }
        button.click();
        return true;
      } catch (error) {
        return false;
      }
    }
    return false;
  }

  async handlePostSubmissionModal() {
    try {
      await this.sleep(2000);

      const modalSelectors = [
        'button[aria-label="Dismiss"]',
        'button[aria-label="Done"]',
        'button[aria-label="Close"]',
        ".artdeco-modal__dismiss",
        ".jobs-applied-modal__dismiss-btn",
      ];

      for (const selector of modalSelectors) {
        const button = document.querySelector(selector);
        if (button && this.isElementVisible(button)) {
          button.click();
          await this.sleep(1000);
          return true;
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async closeApplication() {
    try {
      const closeButton = document.querySelector("button[data-test-modal-close-btn]");
      if (closeButton && this.isElementVisible(closeButton)) {
        closeButton.click();
        await this.sleep(1000);

        const discardButton = document.querySelector('button[data-control-name="discard_application_confirm_btn"]');
        if (discardButton && this.isElementVisible(discardButton)) {
          this.log("Found save dialog, clicking discard");
          discardButton.click();
          await this.sleep(1000);
        }
        return true;
      }

      const fallbackSelectors = [
        ".artdeco-modal__dismiss",
        'button[aria-label="Dismiss"]',
        'button[aria-label="Close"]',
      ];

      for (const selector of fallbackSelectors) {
        const button = document.querySelector(selector);
        if (button && this.isElementVisible(button)) {
          button.click();
          await this.sleep(1000);
          return true;
        }
      }
      return false;
    } catch (error) {
      return false;
    }
  }

  async handleErrorState() {
    try {
      const closeButtons = [
        'button[aria-label="Dismiss"]',
        'button[aria-label="Close"]',
        ".artdeco-modal__dismiss",
        ".jobs-applied-modal__dismiss-btn",
      ];

      for (const selector of closeButtons) {
        const button = document.querySelector(selector);
        if (button && this.isElementVisible(button)) {
          button.click();
          await this.sleep(1000);
        }
      }
    } catch (error) {
      console.error("Error handling error state:", error);
    }
  }

  async saveAppliedJob(jobDetails) {
    try {
      const success = await this.appTracker.saveAppliedJob({
        jobId: jobDetails.jobId,
        title: jobDetails.title,
        company: jobDetails.company,
        location: jobDetails.location,
        jobUrl: window.location.href,
        salary: jobDetails.salary || "Not specified",
        workplace: jobDetails.workplace,
        postedDate: jobDetails.postedDate,
        applicants: jobDetails.applications,
        platform: this.platform,
        userId: this.userProfile?.userId || this.userId,
      });

      if (success) {
        await this.appTracker.updateApplicationCount();
        this.log(`✅ Job application saved to database: ${jobDetails.title}`);
        this.statusOverlay.addSuccess(`I've saved "${jobDetails.title}" to your application history! 📝`);
        return true;
      } else {
        this.log(`⚠️ Failed to save job application: ${jobDetails.title}`);
        this.statusOverlay.addWarning(`Had trouble saving "${jobDetails.title}" to your history, but the application went through!`);
        return false;
      }
    } catch (error) {
      console.error("Error saving applied job:", error);
      this.log(`❌ Error saving job application: ${error.message}`);
      this.statusOverlay.addError("Couldn't save this application to your history, but don't worry - it was submitted!");
      return false;
    }
  }

  onDOMChange() {
    if (this.automationStarted && this.isRunning && !this.isPaused) {
    }
  }

  onNavigation(oldUrl, newUrl) {
    this.log(`🔄 Navigation detected: ${oldUrl} → ${newUrl}`);
    this.statusOverlay.addInfo("I noticed we moved to a different page...");

    if (!newUrl.includes("linkedin.com/jobs") && this.automationStarted && this.isRunning) {
      this.log("⚠️ Navigated away from LinkedIn Jobs, attempting to return");
      this.statusOverlay.addWarning("Looks like we went off-track! Let me get us back to the jobs page...");
      setTimeout(() => {
        if (this.isRunning) {
          this.navigateToLinkedInJobs();
        }
      }, 3000);
    }
  }

  async pause() {
    await super.pause();
    this.log("⏸️ LinkedIn automation paused");
    this.statusOverlay.addWarning("Taking a little break! I'll be here when you're ready to continue. ⏸️");
  }

  async resume() {
    await super.resume();
    this.log("▶️ LinkedIn automation resumed");
    this.statusOverlay.addSuccess("I'm back! Let's continue finding you some great opportunities! 🚀");
  }

  async stop() {
    await super.stop();
    this.hasStarted = false;
    this.automationStarted = false;
    this.log("⏹️ LinkedIn automation stopped");
    this.statusOverlay.addWarning("All done for now! Thanks for letting me help with your job search. Good luck! 🍀");
  }

  cleanup() {
    if (this.statusOverlay && !this.statusOverlay.isDestroyed) {
      this.statusOverlay.addBotMessage("Session ended. Your progress has been saved! 💾", "info");
      this.statusOverlay.destroy();
      this.statusOverlay = null;
    }

    super.cleanup();

    this.processedJobs.clear();
    this.answerCache.clear();

    this.log("🧹 LinkedIn platform cleanup completed");
  }
}

if (typeof Element !== "undefined" && !Element.prototype.isVisible) {
  Element.prototype.isVisible = function () {
    return (
      window.getComputedStyle(this).display !== "none" &&
      window.getComputedStyle(this).visibility !== "hidden" &&
      this.offsetParent !== null
    );
  };
}

