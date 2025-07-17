//content/content-main.js - COMPLETE FIXED VERSION
class ContentScriptManager {
  constructor() {
    this.isInitialized = false;
    this.automationActive = false;
    this.sessionId = null;
    this.platform = null;
    this.userId = null;
    this.platformAutomation = null;
    this.domObserver = null;
    this.indicator = null;
    this.config = {};
    this.initializationTimeout = null;
    this.sessionContext = null;
    this.userProfile = null;
    this.maxInitializationAttempts = 5;
    this.initializationAttempts = 0;

    // Duplicate prevention flags
    this.initializationInProgress = false;
    this.startInProgress = false;
    this.lastInitialization = 0;
    this.processedUrls = new Set();
    this.profileLoaded = false;
    this.profileLoadAttempts = 0;
    this.maxProfileLoadAttempts = 10;
    this.waitingForProfile = false;
    this.contextVerified = false;
    this.verificationAttempts = 0;
    this.maxVerificationAttempts = 10;
  }

  async initialize() {
    if (this.isInitialized || this.initializationInProgress) {
      console.log(
        "🔄 Initialization already completed or in progress, skipping"
      );
      return;
    }

    const now = Date.now();
    if (now - this.lastInitialization < 3000) {
      console.log("🔄 Too soon since last initialization, skipping");
      return;
    }

    this.initializationInProgress = true;
    this.lastInitialization = now;

    try {
      this.initializationAttempts++;
      console.log(
        `📝 Content script initialization attempt ${this.initializationAttempts}`
      );

      const isAutomationWindow = await this.checkIfAutomationWindowWithRetry();
      console.log("🔍 Automation window check result:", isAutomationWindow);

      if (isAutomationWindow) {
        this.automationActive = true;

        const sessionContext = await this.getSessionContextWithProfile();
        console.log("📊 Session context retrieved:", sessionContext);

        if (sessionContext && sessionContext.sessionId) {
          this.sessionContext = sessionContext;
          this.sessionId = sessionContext.sessionId;
          this.platform = sessionContext.platform;
          this.userId = sessionContext.userId;
          console.log("Session context established:", sessionContext)
          if (
            sessionContext.userProfile &&
            this.isUserProfileComplete(sessionContext.userProfile)
          ) {
            this.userProfile = sessionContext.userProfile;
            this.profileLoaded = true;
            console.log(`👤 User profile loaded successfully:`, {
              name: this.userProfile.name || this.userProfile.firstName,
              email: this.userProfile.email,
              hasResumeUrl: !!this.userProfile.resumeUrl,
            });
          } else {
            console.warn(
              "⚠️ No complete user profile in session context, attempting to fetch..."
            );
            await this.waitForUserProfile();
          }

          console.log(`🤖 Session context established:`, {
            sessionId: this.sessionId,
            platform: this.platform,
            userId: this.userId,
            hasUserProfile: !!this.userProfile,
            profileLoaded: this.profileLoaded,
            url: window.location.href,
          });

          if (this.platform && this.platform !== "unknown") {
            await this.setupAutomation();
            this.isInitialized = true;

            console.log(`✅ Content script initialized for ${this.platform}`);
            this.notifyBackgroundReady();

            if (
              this.profileLoaded &&
              this.isUserProfileComplete(this.userProfile)
            ) {
              this.setConditionalAutoStart();
            } else {
              console.warn(
                "⚠️ Auto-start disabled - user profile not loaded or incomplete"
              );
            }
          }
        } else {
          throw new Error("Failed to retrieve session context");
        }
      } else {
        console.log("❌ Not an automation window, skipping initialization");
      }
    } catch (error) {
      console.error("❌ Error initializing content script:", error);

      if (this.initializationAttempts < this.maxInitializationAttempts) {
        const retryDelay = 2000 + this.initializationAttempts * 1000;
        console.log(`🔄 Retrying initialization in ${retryDelay}ms...`);
        setTimeout(() => {
          this.initializationInProgress = false;
          this.initialize();
        }, retryDelay);
      } else {
        console.log("❌ Max initialization attempts reached, giving up");
      }
    } finally {
      if (
        this.initializationAttempts >= this.maxInitializationAttempts ||
        this.isInitialized
      ) {
        this.initializationInProgress = false;
      }
    }
  }

  // ✅ NEW: Enhanced automation window check with retries
  async checkIfAutomationWindowWithRetry(maxAttempts = 3) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        console.log(`🔍 Automation window check attempt ${attempt + 1}`);

        // Method 1: Check window flags set by background script
        if (window.isAutomationWindow && window.automationSessionId) {
          console.log("✅ Automation window detected via window flags");
          return true;
        }

        // Method 2: Check sessionStorage
        const sessionId = sessionStorage.getItem("automationSessionId");
        const platform = sessionStorage.getItem("automationPlatform");
        const userId = sessionStorage.getItem("automationUserId");

        if (sessionId && platform) {
          console.log("✅ Automation window detected via sessionStorage");
          window.automationSessionId = sessionId;
          window.automationPlatform = platform;
          window.automationUserId = userId;
          window.isAutomationWindow = true;
          return true;
        }

        // Method 3: Ask background script
        try {
          const response = await this.sendMessageToBackground({
            action: "checkIfAutomationWindow",
            tabId: await this.getTabId(),
            windowId: await this.getWindowId(),
          });

          if (response && response.isAutomationWindow) {
            console.log("✅ Automation window detected via background script");
            window.isAutomationWindow = true;

            // Store session context if provided
            if (response.sessionContext) {
              this.storeSessionContextInStorage(response.sessionContext);
            }

            return true;
          }
        } catch (error) {
          console.warn(
            `⚠️ Background check attempt ${attempt + 1} failed:`,
            error
          );

          if (attempt < maxAttempts - 1) {
            await this.delay(1000 * (attempt + 1));
            continue;
          }
        }

        // If not the last attempt, wait before retrying
        if (attempt < maxAttempts - 1) {
          await this.delay(1500);
        }
      } catch (error) {
        console.error(
          `❌ Error in automation window check attempt ${attempt + 1}:`,
          error
        );
        if (attempt < maxAttempts - 1) {
          await this.delay(1500);
        }
      }
    }

    console.log("❌ All automation window check attempts failed");
    return false;
  }

  // ✅ NEW: Enhanced session context retrieval with profile waiting
  async getSessionContextWithProfile(maxAttempts = 8) {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        console.log(`📊 Session context retrieval attempt ${attempt + 1}`);

        // First try to get from storage
        let context = this.getSessionContextFromStorage();

        if (context && context.sessionId) {
          console.log("📊 Session context found in storage");

          // ✅ FIXED: Check if profile is complete
          if (this.isUserProfileComplete(context.userProfile)) {
            console.log("✅ Complete user profile found in context");
            this.contextVerified = true;
            return context;
          } else {
            console.log(
              "⚠️ User profile incomplete, requesting from background..."
            );
          }
        }

        // Request full session context from background script
        try {
          console.log(
            "📡 Requesting full session context from background script"
          );
          const response = await this.sendMessageToBackground({
            action: "getFullSessionContext",
            tabId: await this.getTabId(),
            windowId: await this.getWindowId(),
            url: window.location.href,
          });

          if (response && response.sessionContext) {
            console.log("📊 Full session context received from background");
            this.storeSessionContextInStorage(response.sessionContext);

            if (
              this.isUserProfileComplete(response.sessionContext.userProfile)
            ) {
              this.contextVerified = true;
              return response.sessionContext;
            }
          }
        } catch (error) {
          console.warn(
            `⚠️ Background context request attempt ${attempt + 1} failed:`,
            error
          );
        }

        // Try platform detection as fallback
        const detectedPlatform = this.detectPlatformFromUrl();
        if (detectedPlatform !== "unknown") {
          try {
            console.log(
              `🔍 Detected platform: ${detectedPlatform}, requesting session assignment`
            );
            const response = await this.sendMessageToBackground({
              action: "assignSessionToTab",
              platform: detectedPlatform,
              url: window.location.href,
              tabId: await this.getTabId(),
              windowId: await this.getWindowId(),
            });

            if (response && response.sessionContext) {
              console.log("📊 Session assigned by background script");
              this.storeSessionContextInStorage(response.sessionContext);

              if (
                this.isUserProfileComplete(response.sessionContext.userProfile)
              ) {
                this.contextVerified = true;
                return response.sessionContext;
              }
            }
          } catch (error) {
            console.warn(
              `⚠️ Session assignment attempt ${attempt + 1} failed:`,
              error
            );
          }
        }

        // Wait before next attempt
        if (attempt < maxAttempts - 1) {
          await this.delay(2000 + attempt * 1000);
        }
      } catch (error) {
        console.error(
          `❌ Error in session context retrieval attempt ${attempt + 1}:`,
          error
        );
        if (attempt < maxAttempts - 1) {
          await this.delay(2000);
        }
      }
    }

    console.log("❌ All session context retrieval attempts failed");
    return null;
  }

  // ✅ NEW: Wait for user profile with polling
  async waitForUserProfile(timeout = 30000) {
    if (this.waitingForProfile) {
      console.log("⏳ Already waiting for user profile");
      return;
    }

    this.waitingForProfile = true;
    const startTime = Date.now();

    console.log("⏳ Waiting for user profile to be injected...");

    while (Date.now() - startTime < timeout) {
      // Check if profile appeared in storage
      const context = this.getSessionContextFromStorage();
      if (this.isUserProfileComplete(context?.userProfile)) {
        this.userProfile = context.userProfile;
        this.profileLoaded = true;
        console.log("✅ User profile loaded during wait");
        this.waitingForProfile = false;
        return;
      }

      // Check window/sessionStorage directly
      if (
        window.automationUserProfile &&
        this.isUserProfileComplete(window.automationUserProfile)
      ) {
        this.userProfile = window.automationUserProfile;
        this.profileLoaded = true;
        console.log("✅ User profile found in window during wait");
        this.waitingForProfile = false;
        return;
      }

      await this.delay(1000);
    }

    console.warn("⚠️ Timeout waiting for user profile");
    this.waitingForProfile = false;
  }

  // ✅ NEW: Check if user profile is complete
  isUserProfileComplete(profile) {
    if (!profile || typeof profile !== "object") return false;

    const requiredFields = ["userId", "email"];
    const hasRequiredFields = requiredFields.every(
      (field) => profile[field] && profile[field].toString().trim() !== ""
    );

    const hasName = profile.name || profile.firstName || profile.fullName;

    return hasRequiredFields && hasName;
  }

  async getTabId() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { action: "getCurrentTabId" },
          (response) => {
            resolve(response?.tabId || null);
          }
        );
      } catch (error) {
        resolve(null);
      }
    });
  }

  async getWindowId() {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(
          { action: "getCurrentWindowId" },
          (response) => {
            resolve(response?.windowId || null);
          }
        );
      } catch (error) {
        resolve(null);
      }
    });
  }

  // ✅ FIXED: Enhanced session context retrieval from storage
  getSessionContextFromStorage() {
    try {
      const baseContext = {
        sessionId:
          window.automationSessionId ||
          sessionStorage.getItem("automationSessionId"),
        platform:
          window.automationPlatform ||
          sessionStorage.getItem("automationPlatform"),
        userId:
          window.automationUserId || sessionStorage.getItem("automationUserId"),
        isAutomationTab:
          window.isAutomationTab ||
          sessionStorage.getItem("isAutomationTab") === "true",
        parentSessionId:
          window.parentSessionId || sessionStorage.getItem("parentSessionId"),
      };

      // ✅ FIXED: Enhanced user profile retrieval with validation
      let userProfile = null;
      try {
        // Try window first
        if (
          window.automationUserProfile &&
          this.isUserProfileComplete(window.automationUserProfile)
        ) {
          userProfile = window.automationUserProfile;
          console.log("👤 User profile loaded from window");
        } else {
          // Try sessionStorage
          const storedProfile = sessionStorage.getItem("automationUserProfile");
          if (storedProfile) {
            const parsedProfile = JSON.parse(storedProfile);
            if (this.isUserProfileComplete(parsedProfile)) {
              userProfile = parsedProfile;
              console.log("👤 User profile loaded from sessionStorage");
            } else {
              console.warn("⚠️ Stored user profile is incomplete");
            }
          }
        }
      } catch (error) {
        console.warn("⚠️ Error parsing stored user profile:", error);
      }

      // Session config
      let sessionConfig = null;
      try {
        if (window.automationSessionConfig) {
          sessionConfig = window.automationSessionConfig;
        } else {
          const storedConfig = sessionStorage.getItem(
            "automationSessionConfig"
          );
          if (storedConfig) {
            sessionConfig = JSON.parse(storedConfig);
          }
        }
      } catch (error) {
        console.warn("⚠️ Error parsing stored session config:", error);
      }

      const apiHost =
        window.automationApiHost || sessionStorage.getItem("automationApiHost");

      const context = {
        ...baseContext,
        userProfile,
        sessionConfig,
        apiHost,
        preferences: sessionConfig?.preferences || {},
        contextTimestamp: window.automationContextTimestamp || Date.now(),
      };

      if (context.sessionId && context.platform && context.userId) {
        console.log("✅ Session context found in storage:", {
          sessionId: context.sessionId,
          platform: context.platform,
          hasUserProfile: !!context.userProfile,
          profileComplete: this.isUserProfileComplete(context.userProfile),
        });
        return context;
      } else {
        console.log("⚠️ Incomplete session context in storage");
        return null;
      }
    } catch (error) {
      console.error("❌ Error getting session context from storage:", error);
      return null;
    }
  }

  // ✅ FIXED: Enhanced session context storage
  storeSessionContextInStorage(context) {
    try {
      // Store basic context in window
      window.automationSessionId = context.sessionId;
      window.automationPlatform = context.platform;
      window.automationUserId = context.userId;
      window.isAutomationWindow = true;
      window.isAutomationTab = true;
      window.automationContextTimestamp = Date.now();

      // ✅ FIXED: Always store user profile if available and complete
      if (
        context.userProfile &&
        this.isUserProfileComplete(context.userProfile)
      ) {
        window.automationUserProfile = context.userProfile;
        console.log("💾 User profile stored in window");
      }

      if (context.sessionConfig) {
        window.automationSessionConfig = context.sessionConfig;
      }
      if (context.apiHost) {
        window.automationApiHost = context.apiHost;
      }

      // Store in sessionStorage with error handling
      try {
        sessionStorage.setItem("automationSessionId", context.sessionId);
        sessionStorage.setItem("automationPlatform", context.platform);
        sessionStorage.setItem("automationUserId", context.userId);
        sessionStorage.setItem("isAutomationWindow", "true");
        sessionStorage.setItem("isAutomationTab", "true");

        if (
          context.userProfile &&
          this.isUserProfileComplete(context.userProfile)
        ) {
          sessionStorage.setItem(
            "automationUserProfile",
            JSON.stringify(context.userProfile)
          );
          console.log("💾 User profile stored in sessionStorage");
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
        if (context.parentSessionId) {
          window.parentSessionId = context.parentSessionId;
          sessionStorage.setItem("parentSessionId", context.parentSessionId);
        }
      } catch (storageError) {
        console.warn("⚠️ Failed to store in sessionStorage:", storageError);
      }

      console.log("💾 Enhanced session context stored successfully");
    } catch (error) {
      console.error("❌ Error storing session context:", error);
    }
  }

  async enrichSessionContext(basicContext) {
    // Try to get additional context data from background script
    try {
      const response = await this.sendMessageToBackground({
        action: "getFullSessionContext",
        sessionId: basicContext.sessionId,
      });

      if (response && response.sessionContext) {
        const enrichedContext = { ...basicContext, ...response.sessionContext };
        this.storeSessionContextInStorage(enrichedContext);
        return enrichedContext;
      }
    } catch (error) {
      console.warn("⚠️ Failed to enrich session context:", error);
    }

    return basicContext;
  }

  addAutomationIndicator() {
    const existing = document.getElementById("automation-indicator");
    if (existing) existing.remove();

    const indicator = document.createElement("div");
    indicator.id = "automation-indicator";

    const profileStatus = this.userProfile ? "✓" : "✗";
    const profileText = this.userProfile
      ? this.userProfile.name || this.userProfile.firstName || "Unknown"
      : "No Profile";

    // ✅ Enhanced indicator with more status info
    indicator.innerHTML = `
      <div style="
        position: fixed;
        top: 10px;
        right: 10px;
        background: linear-gradient(135deg, #4CAF50, #45a049);
        color: white;
        padding: 12px 16px;
        border-radius: 8px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
        font-size: 13px;
        font-weight: 600;
        z-index: 999999;
        box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        border: 1px solid rgba(255,255,255,0.2);
        backdrop-filter: blur(10px);
        cursor: pointer;
        transition: all 0.3s ease;
      " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
        <div style="display: flex; align-items: center; gap: 8px;">
          <span style="font-size: 16px;">🤖</span>
          <div>
            <div style="font-weight: 700;">AUTOMATION ACTIVE</div>
            <div style="font-size: 11px; opacity: 0.9;">
              ${this.platform?.toUpperCase()} • ${this.sessionId?.slice(
      -6
    )}<br/>
              Profile: ${profileStatus} ${profileText}<br/>
              Context: ${this.contextVerified ? "✅ Verified" : "⚠️ Pending"}
            </div>
          </div>
        </div>
      </div>
    `;

    indicator.addEventListener("click", () => this.showAutomationStatus());
    document.documentElement.appendChild(indicator);
    this.indicator = indicator;
  }

  getSessionId() {
    return (
      this.sessionContext?.sessionId ||
      window.automationSessionId ||
      sessionStorage.getItem("automationSessionId") ||
      null
    );
  }

  getPlatform() {
    return (
      this.sessionContext?.platform ||
      window.automationPlatform ||
      sessionStorage.getItem("automationPlatform") ||
      this.detectPlatformFromUrl()
    );
  }

  getUserId() {
    return (
      this.sessionContext?.userId ||
      window.automationUserId ||
      sessionStorage.getItem("automationUserId") ||
      null
    );
  }

  detectPlatformFromUrl() {
    const url = window.location.href.toLowerCase();

    if (url.includes("linkedin.com")) return "linkedin";
    if (url.includes("indeed.com")) return "indeed";
    if (url.includes("ziprecruiter.com")) return "ziprecruiter";
    if (url.includes("recruitee.com")) return "recruitee";
    if (url.includes("glassdoor.com")) return "glassdoor";
    if (url.includes("myworkdayjobs.com")) return "workday";
    if (url.includes("lever.co")) return "lever";
    if (url.includes("greenhouse.io")) return "greenhouse";
    if (url.includes("workable.com")) return "workable";
    if (url.includes("ashbyhq.com")) return "ashby";
    if (url.includes("wellfound.com")) return "wellfound";
    if (url.includes("breezy.hr")) return "breezy";

    // Handle Google search for specific platforms
    if (url.includes("google.com/search")) {
      if (url.includes("site:recruitee.com") || url.includes("recruitee.com"))
        return "recruitee";
      if (
        url.includes("site:ziprecruiter.com") ||
        url.includes("ziprecruiter.com")
      )
        return "ziprecruiter";
      if (
        url.includes("site:myworkdayjobs.com") ||
        url.includes("myworkdayjobs.com")
      )
        return "workday";
      if (url.includes("site:lever.co") || url.includes("lever.co"))
        return "lever";
      if (url.includes("site:workable.com") || url.includes("workable.com"))
        return "workable";
      if (url.includes("site:wellfound.com") || url.includes("wellfound.com"))
        return "wellfound";
      if (url.includes("site:ashbyhq.com") || url.includes("ashbyhq.com"))
        return "ashby";
      if (url.includes("site:breezy.hr") || url.includes("breezy.hr"))
        return "breezy";
    }

    return "unknown";
  }

  async setupAutomation() {
    try {
      const PlatformClass = await this.loadPlatformModule(this.platform);
      console.log("PlatformClass loaded:", PlatformClass?.name);

      if (!PlatformClass) {
        throw new Error(`Platform ${this.platform} not supported`);
      }

      // ✅ FIXED: Ensure user profile is available before creating automation
      if (!this.userProfile && this.profileLoaded) {
        console.warn("⚠️ Profile marked as loaded but userProfile is null");
      }

      const automationConfig = {
        sessionId: this.sessionId,
        platform: this.platform,
        userId: this.userId,
        contentScript: this,
        config: this.config,
        sessionContext: this.sessionContext,
        userProfile: this.userProfile, // Should be populated by now
      };

      console.log("Creating platform automation with config:", {
        sessionId: automationConfig.sessionId,
        platform: automationConfig.platform,
        userId: automationConfig.userId,
        hasSessionContext: !!automationConfig.sessionContext,
        hasUserProfile: !!automationConfig.userProfile,
        profileComplete: this.isUserProfileComplete(
          automationConfig.userProfile
        ),
      });

      this.platformAutomation = new PlatformClass(automationConfig);

      // Set up automation UI
      this.addAutomationIndicator();
      this.setupMessageListeners();
      this.setupDOMObserver();
      this.setupNavigationListeners();

      // Initialize platform automation
      await this.platformAutomation.initialize();

      // ✅ FIXED: Set session context with validated user profile
      if (this.sessionContext) {
        if (this.userProfile && !this.sessionContext.userProfile) {
          this.sessionContext.userProfile = this.userProfile;
        }
        await this.platformAutomation.setSessionContext(this.sessionContext);
      }

      console.log("✅ Platform automation setup completed");
    } catch (error) {
      console.error(
        `❌ Failed to setup automation for ${this.platform}:`,
        error
      );
      this.notifyBackgroundError(error);
    }
  }

  async updateSessionContext(newContext) {
    this.sessionContext = { ...this.sessionContext, ...newContext };

    // Update user profile if provided
    if (
      newContext.userProfile &&
      this.isUserProfileComplete(newContext.userProfile)
    ) {
      this.userProfile = newContext.userProfile;
      this.profileLoaded = true;
      console.log("👤 User profile updated from session context");
    }

    this.storeSessionContextInStorage(this.sessionContext);

    if (this.platformAutomation && this.platformAutomation.setSessionContext) {
      await this.platformAutomation.setSessionContext(this.sessionContext);
    }
  }

  async loadPlatformModule(platform) {
    try {
      switch (platform) {
        case "linkedin":
          const { default: LinkedInPlatform } = await import(
            "../platforms/linkedin/linkedin.js"
          );
          return LinkedInPlatform;

        case "indeed":
          const { default: IndeedPlatform } = await import(
            "../platforms/indeed/indeed.js"
          );
          return IndeedPlatform;

        case "ziprecruiter":
          const { default: ZipRecruiterPlatform } = await import(
            "../platforms/ziprecruiter/ziprecruiter.js"
          );
          return ZipRecruiterPlatform;

        case "recruitee":
          const { default: RecruiteePlatform } = await import(
            "../platforms/recruitee/recruitee.js"
          );
          return RecruiteePlatform;

        case "glassdoor":
          const { default: GlassdoorPlatform } = await import(
            "../platforms/glassdoor/glassdoor.js"
          );
          return GlassdoorPlatform;

        case "workday":
          const { default: WorkdayPlatform } = await import(
            "../platforms/workday/workday.js"
          );
          return WorkdayPlatform;

        case "lever":
          const { default: LeverPlatform } = await import(
            "../platforms/lever/lever.js"
          );
          return LeverPlatform;

        case "workable":
          const { default: WorkablePlatform } = await import(
            "../platforms/workable/workable.js"
          );
          return WorkablePlatform;

        case "breezy":
          const { default: BreezyPlatform } = await import(
            "../platforms/breezy/breezy.js"
          );
          return BreezyPlatform;

        case "ashby":
          const { default: AshbyPlatform } = await import(
            "../platforms/ashby/ashby.js"
          );
          return AshbyPlatform;

        case "wellfound":
          const { default: WellfoundPlatform } = await import(
            "../platforms/wellfound/wellfound.js"
          );
          return WellfoundPlatform;

        default:
          console.warn(`Platform ${platform} not supported`);
          return null;
      }
    } catch (error) {
      console.error(`Failed to load platform module for ${platform}:`, error);
      return null;
    }
  }

  setupMessageListeners() {
    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      this.handleMessage(request, sender, sendResponse);
      return true; // Keep message channel open for async responses
    });
  }

  async handleMessage(request, sender, sendResponse) {
    try {
      switch (request.action) {
        case "startAutomation":
          await this.handleStartAutomation(request, sendResponse);
          break;

        case "pauseAutomation":
          await this.handlePauseAutomation(request, sendResponse);
          break;

        case "resumeAutomation":
          await this.handleResumeAutomation(request, sendResponse);
          break;

        case "stopAutomation":
          await this.handleStopAutomation(request, sendResponse);
          break;

        case "getPageData":
          this.handleGetPageData(sendResponse);
          break;

        case "executeAction":
          await this.handleExecuteAction(request, sendResponse);
          break;

        case "extractJobData":
          this.handleExtractJobData(sendResponse);
          break;

        case "platformMessage":
          if (
            this.platformAutomation &&
            this.platformAutomation.handlePortMessage
          ) {
            this.platformAutomation.handlePortMessage(request);
          }
          sendResponse({ success: true });
          break;

        default:
          sendResponse({ success: false, error: "Unknown action" });
      }
    } catch (error) {
      console.error("Error handling message:", error);
      sendResponse({ success: false, error: error.message });
    }
  }

  // ✅ FIXED: Enhanced start handling with profile verification
  async handleStartAutomation(request, sendResponse) {
    try {
      if (this.startInProgress) {
        console.log("⚠️ Start already in progress, ignoring duplicate");
        sendResponse({ success: true, message: "Start already in progress" });
        return;
      }

      if (this.platformAutomation?.isRunning) {
        console.log("⚠️ Automation already running, ignoring duplicate start");
        sendResponse({ success: true, message: "Already running" });
        return;
      }

      this.startInProgress = true;

      if (this.platformAutomation) {
        // Clear any conflicting timeouts
        if (this.initializationTimeout) {
          clearTimeout(this.initializationTimeout);
          this.initializationTimeout = null;
          console.log("🔄 Cleared auto-start timeout to prevent conflict");
        }

        // Update config
        this.config = { ...this.config, ...request.config };

        // ✅ FIXED: Update session context and user profile
        if (request.sessionContext) {
          this.sessionContext = {
            ...this.sessionContext,
            ...request.sessionContext,
          };

          if (
            request.sessionContext.userProfile &&
            this.isUserProfileComplete(request.sessionContext.userProfile)
          ) {
            this.userProfile = request.sessionContext.userProfile;
            this.profileLoaded = true;
            console.log(`👤 User profile updated from start message:`, {
              name: this.userProfile.name || this.userProfile.firstName,
              email: this.userProfile.email,
            });
          }

          this.storeSessionContextInStorage(this.sessionContext);
          await this.platformAutomation.setSessionContext(this.sessionContext);
        }

        // Verify profile before starting
        if (
          !this.profileLoaded ||
          !this.isUserProfileComplete(this.userProfile)
        ) {
          console.warn("⚠️ Starting automation without complete user profile");
          sendResponse({
            success: false,
            error: "Cannot start automation without complete user profile",
          });
          return;
        }

        console.log(
          `🤖 Starting automation for ${this.platform} with profile:`,
          {
            hasConfig: !!this.config,
            hasUserProfile: !!this.userProfile,
            profileComplete: this.isUserProfileComplete(this.userProfile),
            jobsToApply: this.config.jobsToApply,
          }
        );

        await this.platformAutomation.start(this.config);

        sendResponse({
          success: true,
          message: "Automation started in content script",
        });
      } else {
        sendResponse({
          success: false,
          error: "Platform automation not initialized",
        });
      }
    } catch (error) {
      console.error(`❌ Error starting automation: ${error.message}`);
      sendResponse({ success: false, error: error.message });
    } finally {
      this.startInProgress = false;
    }
  }

  // ✅ FIXED: Conditional auto-start only if profile is loaded
  setConditionalAutoStart() {
    if (!this.profileLoaded || !this.isUserProfileComplete(this.userProfile)) {
      console.log(
        "🔄 Auto-start disabled - user profile not loaded or incomplete"
      );
      return;
    }

    if (this.platformAutomation?.isRunning) {
      console.log("🔄 Auto-start disabled - automation already running");
      return;
    }

    console.log("⏰ Setting conditional auto-start timer (15 seconds)");
    this.initializationTimeout = setTimeout(async () => {
      if (
        this.platformAutomation &&
        !this.platformAutomation.isRunning &&
        !this.startInProgress &&
        this.profileLoaded &&
        this.isUserProfileComplete(this.userProfile)
      ) {
        console.log("🔄 Auto-starting automation with complete profile");
        this.startInProgress = true;

        try {
          await this.platformAutomation.start({
            jobsToApply: 10,
            submittedLinks: [],
            preferences: {},
            userId: this.userId,
          });
        } catch (error) {
          console.log(`❌ Auto-start failed: ${error.message}`);
        } finally {
          this.startInProgress = false;
        }
      } else {
        console.log("🔄 Skipping auto-start - conditions not met", {
          hasPlatformAutomation: !!this.platformAutomation,
          isRunning: this.platformAutomation?.isRunning,
          startInProgress: this.startInProgress,
          profileLoaded: this.profileLoaded,
          profileComplete: this.isUserProfileComplete(this.userProfile),
        });
      }
    }, 15000); // Increased to 15 seconds to allow more time for profile loading
  }

  notifyBackgroundReady() {
    this.sendMessageToBackground({
      action: "contentScriptReady",
      sessionId: this.sessionId,
      platform: this.platform,
      userId: this.userId,
      url: window.location.href,
      sessionContext: this.sessionContext,
      hasUserProfile: !!this.userProfile,
      profileComplete: this.isUserProfileComplete(this.userProfile),
    }).catch(console.error);
  }

  async handlePauseAutomation(request, sendResponse) {
    if (this.platformAutomation && this.platformAutomation.pause) {
      await this.platformAutomation.pause();
      sendResponse({ success: true, message: "Automation paused" });
    } else {
      sendResponse({ success: false, error: "Cannot pause automation" });
    }
  }

  async handleResumeAutomation(request, sendResponse) {
    if (this.platformAutomation && this.platformAutomation.resume) {
      await this.platformAutomation.resume();
      sendResponse({ success: true, message: "Automation resumed" });
    } else {
      sendResponse({ success: false, error: "Cannot resume automation" });
    }
  }

  async handleStopAutomation(request, sendResponse) {
    if (this.platformAutomation && this.platformAutomation.stop) {
      await this.platformAutomation.stop();
      sendResponse({ success: true, message: "Automation stopped" });
    } else {
      sendResponse({ success: false, error: "Cannot stop automation" });
    }
  }

  handleGetPageData(sendResponse) {
    const pageData = {
      url: window.location.href,
      title: document.title,
      platform: this.platform,
      sessionId: this.sessionId,
      userId: this.userId,
      hasUserProfile: !!this.userProfile,
      profileComplete: this.isUserProfileComplete(this.userProfile),
      readyState: document.readyState,
      timestamp: Date.now(),
    };

    sendResponse({ success: true, data: pageData });
  }

  async handleExecuteAction(request, sendResponse) {
    const { actionType, selector, value, options = {} } = request;

    try {
      let result = false;

      switch (actionType) {
        case "click":
          result = await this.clickElement(selector, options);
          break;

        case "fill":
          result = await this.fillElement(selector, value, options);
          break;

        case "wait":
          result = await this.waitForElement(
            selector,
            options.timeout || 10000
          );
          break;

        case "scroll":
          result = await this.scrollToElement(selector, options);
          break;

        default:
          throw new Error(`Unknown action type: ${actionType}`);
      }

      sendResponse({ success: true, result });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  }

  handleExtractJobData(sendResponse) {
    try {
      const jobData = this.extractCurrentJobData();
      sendResponse({ success: true, data: jobData });
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
  }

  setupDOMObserver() {
    // Set up MutationObserver to detect significant DOM changes
    this.domObserver = new MutationObserver((mutations) => {
      this.handleDOMChanges(mutations);
    });

    this.domObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: false,
    });
  }

  handleDOMChanges(mutations) {
    let significantChange = false;

    for (const mutation of mutations) {
      if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
        const addedElements = Array.from(mutation.addedNodes).filter(
          (node) => node.nodeType === 1
        );

        if (addedElements.some((el) => this.isSignificantElement(el))) {
          significantChange = true;
          break;
        }
      }
    }

    if (significantChange) {
      this.notifyDOMChange();

      if (
        this.platformAutomation &&
        this.platformAutomation.onDOMChange &&
        !this.startInProgress
      ) {
        this.platformAutomation.onDOMChange();
      }
    }
  }

  isSignificantElement(element) {
    const significantSelectors = [
      "form",
      ".job",
      ".application",
      ".modal",
      ".dialog",
      '[class*="job"]',
      '[class*="apply"]',
      '[class*="form"]',
    ];

    return significantSelectors.some((selector) => {
      try {
        return (
          element.matches &&
          (element.matches(selector) || element.querySelector(selector))
        );
      } catch (e) {
        return false;
      }
    });
  }

  setupNavigationListeners() {
    let currentUrl = window.location.href;

    const checkUrlChange = () => {
      if (window.location.href !== currentUrl) {
        const oldUrl = currentUrl;
        currentUrl = window.location.href;

        if (this.processedUrls.has(currentUrl)) {
          console.log(`🔄 URL already processed: ${currentUrl}`);
          return;
        }

        console.log(`🔄 Navigation detected: ${oldUrl} → ${currentUrl}`);
        this.processedUrls.add(currentUrl);
        this.notifyNavigation(oldUrl, currentUrl);

        if (
          this.platformAutomation &&
          this.platformAutomation.onNavigation &&
          !this.startInProgress
        ) {
          this.platformAutomation.onNavigation(oldUrl, currentUrl);
        }
      }
    };

    // Check for URL changes periodically
    setInterval(checkUrlChange, 1000);

    // Listen for popstate events
    window.addEventListener("popstate", checkUrlChange);

    // Override pushState and replaceState
    const originalPushState = history.pushState;
    const originalReplaceState = history.replaceState;

    history.pushState = function (...args) {
      originalPushState.apply(this, args);
      setTimeout(checkUrlChange, 100);
    };

    history.replaceState = function (...args) {
      originalReplaceState.apply(this, args);
      setTimeout(checkUrlChange, 100);
    };
  }

  // Utility methods for DOM manipulation
  async clickElement(selector, options = {}) {
    const element = document.querySelector(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    element.scrollIntoView({ behavior: "smooth", block: "center" });
    await this.delay(options.delay || 500);
    element.click();

    return true;
  }

  async fillElement(selector, value, options = {}) {
    const element = document.querySelector(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    element.focus();
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));

    if (options.blur) {
      element.blur();
    }

    return true;
  }

  async scrollToElement(selector, options = {}) {
    const element = document.querySelector(selector);
    if (!element) {
      throw new Error(`Element not found: ${selector}`);
    }

    const scrollOptions = {
      behavior: "smooth",
      block: "center",
      inline: "nearest",
      ...options,
    };

    element.scrollIntoView(scrollOptions);
    return true;
  }

  async waitForElement(selector, timeout = 10000) {
    return new Promise((resolve) => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      const observer = new MutationObserver((mutations, obs) => {
        const element = document.querySelector(selector);
        if (element) {
          obs.disconnect();
          resolve(element);
        }
      });

      observer.observe(document, {
        childList: true,
        subtree: true,
      });

      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  extractCurrentJobData() {
    const jobData = {
      title: this.extractText([
        "h1",
        ".job-title",
        '[data-testid="job-title"]',
        ".jobsearch-JobInfoHeader-title",
      ]),
      company: this.extractText([
        ".company",
        ".company-name",
        '[data-testid="company-name"]',
        ".jobsearch-InlineCompanyRating",
      ]),
      location: this.extractText([
        ".location",
        ".job-location",
        '[data-testid="job-location"]',
        ".jobsearch-JobLocation",
      ]),
      description: this.extractText([
        ".job-description",
        ".description",
        '[data-testid="job-description"]',
      ]),
      url: window.location.href,
      platform: this.platform,
      userId: this.userId,
      extractedAt: Date.now(),
    };

    return jobData;
  }

  extractText(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element.textContent?.trim() || "";
      }
    }
    return "";
  }

  // Communication methods
  async sendMessageToBackground(message) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  }

  notifyBackgroundError(error) {
    this.sendMessageToBackground({
      action: "contentScriptError",
      sessionId: this.sessionId,
      platform: this.platform,
      userId: this.userId,
      error: error.message,
      url: window.location.href,
    }).catch(console.error);
  }

  notifyDOMChange() {
    this.sendMessageToBackground({
      action: "domChanged",
      sessionId: this.sessionId,
      url: window.location.href,
      timestamp: Date.now(),
    }).catch(console.error);
  }

  notifyNavigation(oldUrl, newUrl) {
    this.sendMessageToBackground({
      action: "navigationDetected",
      sessionId: this.sessionId,
      oldUrl,
      newUrl,
      timestamp: Date.now(),
    }).catch(console.error);
  }

  showAutomationStatus() {
    const modal = document.createElement("div");
    modal.style.cssText = `
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(0,0,0,0.5); z-index: 1000000; display: flex;
      align-items: center; justify-content: center;
    `;

    modal.innerHTML = `
      <div style="background: white; padding: 24px; border-radius: 12px; max-width: 500px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);">
        <h3 style="margin: 0 0 16px 0; color: #333;">Automation Status</h3>
        <p><strong>Platform:</strong> ${this.platform}</p>
        <p><strong>Session ID:</strong> ${this.sessionId}</p>
        <p><strong>User ID:</strong> ${this.userId}</p>
        <p><strong>User Profile:</strong> ${
          this.userProfile ? "✅ Loaded" : "❌ Missing"
        }</p>
        <p><strong>Profile Complete:</strong> ${
          this.isUserProfileComplete(this.userProfile) ? "✅ Yes" : "❌ No"
        }</p>
        ${
          this.userProfile
            ? `
          <p><strong>Profile Name:</strong> ${
            this.userProfile.name || this.userProfile.firstName || "N/A"
          }</p>
          <p><strong>Profile Email:</strong> ${
            this.userProfile.email || "N/A"
          }</p>
          <p><strong>Resume URL:</strong> ${
            this.userProfile.resumeUrl ? "✅ Available" : "❌ Missing"
          }</p>
        `
            : ""
        }
        <p><strong>Current URL:</strong> ${window.location.href}</p>
        <p><strong>Status:</strong> ${
          this.automationActive ? "Active" : "Inactive"
        }</p>
        <p><strong>Context Verified:</strong> ${
          this.contextVerified ? "✅ Yes" : "⚠️ No"
        }</p>
        <p><strong>Profile Loaded:</strong> ${
          this.profileLoaded ? "✅ Yes" : "⚠️ No"
        }</p>
        <button onclick="this.closest('div').remove()" style="
          background: #4CAF50; color: white; border: none; padding: 8px 16px;
          border-radius: 4px; cursor: pointer; margin-top: 16px;
        ">Close</button>
      </div>
    `;

    modal.addEventListener("click", (e) => {
      if (e.target === modal) modal.remove();
    });

    document.body.appendChild(modal);
  }

  log(message, data = {}) {
    console.log(`🤖 [ContentScript-${this.platform}] ${message}`, data);
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  cleanup() {
    this.initializationInProgress = false;
    this.startInProgress = false;
    this.contextVerified = false;
    this.verificationAttempts = 0;
    this.processedUrls.clear();
    this.profileLoaded = false;
    this.waitingForProfile = false;

    if (this.initializationTimeout) {
      clearTimeout(this.initializationTimeout);
      this.initializationTimeout = null;
    }

    if (this.indicator) {
      this.indicator.remove();
      this.indicator = null;
    }

    if (this.domObserver) {
      this.domObserver.disconnect();
      this.domObserver = null;
    }

    if (this.platformAutomation && this.platformAutomation.cleanup) {
      this.platformAutomation.cleanup();
    }

    this.isInitialized = false;
    this.automationActive = false;
  }
}

// Initialize content script manager
const contentManager = new ContentScriptManager();
console.log("📝 Content script manager created");

// Single initialization with proper timing
const initializeOnce = (() => {
  let initialized = false;
  let scheduledInit = false;

  return (delay = 1000) => {
    if (initialized || scheduledInit) {
      console.log("🔄 Initialization already attempted or scheduled, skipping");
      return;
    }

    scheduledInit = true;
    console.log(`📝 Scheduling content script initialization in ${delay}ms...`);

    setTimeout(() => {
      initialized = true;
      contentManager.initialize();
    }, delay);
  };
})();

// Initialize based on document state
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", () => initializeOnce(1000));
} else if (document.readyState === "interactive") {
  initializeOnce(1500);
} else {
  initializeOnce(1000);
}

// Enhanced pageshow handler
window.addEventListener("pageshow", (event) => {
  console.log("📄 Page show event:", {
    persisted: event.persisted,
    readyState: document.readyState,
  });

  if (!event.persisted && !contentManager.isInitialized) {
    console.log("📝 New page detected, scheduling initialization...");
    setTimeout(() => initializeOnce(1000), 500);
  } else if (event.persisted && contentManager.isInitialized) {
    setTimeout(() => {
      if (!contentManager.contextVerified) {
        console.log(
          "🔄 Page from cache but context not verified, reinitializing..."
        );
        contentManager.isInitialized = false;
        initializeOnce(1000);
      }
    }, 500);
  }
});

// Safety net with profile check
setTimeout(() => {
  if (
    !contentManager.isInitialized &&
    !contentManager.initializationInProgress
  ) {
    console.log("🚨 Safety net: Content script not initialized, attempting...");
    initializeOnce(0);
  }
}, 8000);

// Cleanup on page unload
window.addEventListener("beforeunload", () => {
  console.log("🧹 Page unloading, cleaning up content script");
  contentManager.cleanup();
});
