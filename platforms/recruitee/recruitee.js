// platforms/recruitee/recruitee.js
//setSessionContext
import BasePlatform from "../base-platform.js";
import { RecruiteeJobAutomation } from "./recruitee-automation.js";
import {
  AIService,
  ApplicationTrackerService,
  UserService,
  StatusOverlay,
} from "../../services/index.js";
import { markLinkAsColor } from "../../utils/mark-links.js";

// Updated RecruiteePlatform constructor and methods

export default class RecruiteePlatform extends BasePlatform {
  constructor(config) {
    super(config);
    this.platform = "recruitee";
    this.baseUrl = "https://jobs.recruitee.co";

    // Initialize user profile from multiple sources
    this.userProfile =
      config.userProfile || config.sessionContext?.userProfile || null;
    this.sessionContext = config.sessionContext || null;

    console.log(
      `🔧 Recruitee platform constructor - User profile available: ${!!this
        .userProfile}`
    );
    if (this.userProfile) {
      console.log(`👤 User profile details:`, {
        name: this.userProfile.name || this.userProfile.firstName,
        email: this.userProfile.email,
        hasResumeUrl: !!this.userProfile.resumeUrl,
        resumeUrls: this.userProfile.resumeUrls?.length || 0,
      });
    }

    this.aiService = new AIService({ apiHost: this.getApiHost() });
    this.applicationTracker = new ApplicationTrackerService({
      userId: this.userId,
    });
    this.userService = new UserService({ userId: this.userId });

    this.statusOverlay = new StatusOverlay({
      id: "recruitee-status-overlay",
      title: "RECRUITEE AUTOMATION",
      icon: "🤖",
      position: { top: "10px", right: "10px" },
    });

    this.fileHandler = null;
    this.formHandler = null;

    // Communication state
    this.port = null;
    this.connectionRetries = 0;
    this.maxRetries = 3;
    this.hasSessionContext = !!this.sessionContext;

    // Application state
    this.applicationState = {
      isApplicationInProgress: false,
      applicationStartTime: null,
      applicationUrl: null,
      processedUrls: new Set(),
      processedLinksCount: 0,
    };

    // Search data
    this.searchData = {
      limit: 0,
      current: 0,
      domain: ["recruitee.co"],
      submittedLinks: [],
      searchLinkPattern: null,
    };

    // Timers
    this.healthCheckTimer = null;
    this.keepAliveInterval = null;
    this.sendCvPageNotRespondTimeout = null;
    this.stuckStateTimer = null;
    this.stateVerificationInterval = null;

    this.markLinkAsColor = markLinkAsColor;
  }

  async setSessionContext(sessionContext) {
    try {
      this.sessionContext = sessionContext;
      this.hasSessionContext = true;

      // Update basic properties
      if (sessionContext.sessionId) this.sessionId = sessionContext.sessionId;
      if (sessionContext.platform) this.platform = sessionContext.platform;
      if (sessionContext.userId) this.userId = sessionContext.userId;

      // Set user profile with priority handling
      if (sessionContext.userProfile) {
        if (!this.userProfile || Object.keys(this.userProfile).length === 0) {
          this.userProfile = sessionContext.userProfile;
          console.log("👤 User profile loaded from session context");
        } else {
          // Merge profiles, preferring non-null values
          this.userProfile = {
            ...this.userProfile,
            ...sessionContext.userProfile,
          };
          console.log("👤 User profile merged with session context");
        }
      }

      // Fetch user profile if still missing
      if (!this.userProfile && this.userId) {
        try {
          console.log("📡 Fetching user profile from user service...");
          this.userProfile = await this.userService.getUserDetails();
          console.log("✅ User profile fetched successfully");
        } catch (error) {
          console.error("❌ Failed to fetch user profile:", error);
          this.statusOverlay?.addError(
            "Failed to fetch user profile: " + error.message
          );
        }
      }

      // Update services with user context
      if (this.userId) {
        this.applicationTracker = new ApplicationTrackerService({
          userId: this.userId,
        });
        this.userService = new UserService({ userId: this.userId });
      }

      // Store API host from session context
      if (sessionContext.apiHost) {
        this.sessionApiHost = sessionContext.apiHost;
      }

      // Pass session context to automation if it exists
      if (this.automation && this.automation.setSessionContext) {
        await this.automation.setSessionContext(sessionContext);
      }

      console.log("✅ Recruitee session context set successfully", {
        hasUserProfile: !!this.userProfile,
        userId: this.userId,
        sessionId: this.sessionId,
        profileName: this.userProfile?.name || this.userProfile?.firstName,
        profileEmail: this.userProfile?.email,
      });
    } catch (error) {
      console.error("❌ Error setting Recruitee session context:", error);
      this.statusOverlay?.addError(
        "❌ Error setting session context: " + error.message
      );
    }
  }

  async initialize() {
    await super.initialize();

    // FIXED: Ensure user profile is available before initializing automation
    if (!this.userProfile && this.userId) {
      try {
        console.log(
          "🔄 Attempting to fetch user profile during initialization..."
        );
        this.userProfile = await this.userService.getUserDetails();
        console.log("✅ User profile fetched during initialization");
      } catch (error) {
        console.error(
          "❌ Failed to fetch user profile during initialization:",
          error
        );
      }
    }

    this.log("🚀 Initializing Recruitee platform automation");
    this.automation = new RecruiteeJobAutomation({
      ...this.config,
      userProfile: this.userProfile,
      sessionContext: this.sessionContext,
    });

    return true;
  }

  async start(params = {}) {
    try {
      this.isRunning = true;
      this.log("▶️ Starting Recruitee automation");

      // FIXED: Final check for user profile before starting
      if (!this.userProfile && this.userId) {
        console.log("⚠️ Making final attempt to fetch user profile...");
        try {
          this.userProfile = await this.userService.getUserDetails();
          console.log("✅ User profile fetched just before start");

          // Update automation with profile if it exists
          if (this.automation && this.userProfile) {
            this.automation.userProfile = this.userProfile;
          }
        } catch (error) {
          console.error("❌ Final user profile fetch failed:", error);
        }
      }

      // Validate we have necessary data
      if (!this.userProfile) {
        this.log(
          "⚠️ Starting automation without user profile - this may cause issues"
        );
      } else {
        this.log("✅ Starting automation with user profile:", {
          name: this.userProfile.name || this.userProfile.firstName,
          email: this.userProfile.email,
          hasResumeUrl: !!this.userProfile.resumeUrl,
        });
      }

      // Update progress
      this.updateProgress({
        total: params.jobsToApply || 0,
        completed: 0,
        current: "Starting automation...",
      });

      // The automation will handle everything via the content script
      return true;
    } catch (error) {
      this.reportError(error, { action: "start" });
      return false;
    }
  }

  // Rest of the methods remain the same...
  getApiHost() {
    return (
      this.sessionApiHost ||
      this.sessionContext?.apiHost ||
      this.config.apiHost ||
      "http://localhost:3000"
    );
  }

  async findJobs() {
    return [];
  }

  async applyToJob(jobElement) {
    return false;
  }

  onDOMChange() {
    if (this.automation && this.automation.onDOMChange) {
      this.automation.onDOMChange();
    }
  }

  onNavigation(oldUrl, newUrl) {
    if (this.automation && this.automation.onNavigation) {
      this.automation.onNavigation(oldUrl, newUrl);
    }
  }

  async pause() {
    await super.pause();
    if (this.automation && this.automation.pause) {
      await this.automation.pause();
    }
  }

  async resume() {
    await super.resume();
    if (this.automation && this.automation.resume) {
      await this.automation.resume();
    }
  }

  async stop() {
    await super.stop();
    if (this.automation && this.automation.stop) {
      await this.automation.stop();
    }
  }

  cleanup() {
    if (this.automation && this.automation.cleanup) {
      this.automation.cleanup();
    }
    super.cleanup();
  }
}
