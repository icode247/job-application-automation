// // core/automation-manager.js

// export default class AutomationManager {
//   constructor() {
//     this.platforms = new Map();
//     this.activePlatform = null;
//     this.isInitialized = false;
//     this.config = {
//       enabledPlatforms: [
//         "linkedin",
//         "indeed",
//         "recruitee",
//         "glassdoor",
//         "workday",
//       ],
//       autoAdvance: true,
//       fillDelay: 1000,
//       debug: false,
//       maxConcurrentSessions: 1,
//       retryAttempts: 3,
//       delayBetweenApplications: { min: 3000, max: 8000 },
//     };
//     this.activeSessions = new Map();
//     this.errorHandler = null;
//     this.healthMonitor = null;
//   }

//   async initialize() {
//     if (this.isInitialized) return;

//     try {
//       // Load configuration from storage
//       await this.loadConfig();

//       // Initialize error handler and health monitor
//       await this.initializeCore();

//       // Initialize all platform modules
//       await this.initializePlatforms();

//       // Set up global listeners
//       this.setupGlobalListeners();

//       this.isInitialized = true;
//       this.log("✅ Automation Manager initialized successfully");
//     } catch (error) {
//       console.error("❌ Failed to initialize Automation Manager:", error);
//     }
//   }

//   async initializeCore() {
//     const { default: ErrorHandler } = await import("./error-handler.js");
//     const { default: HealthMonitor } = await import("./health-monitor.js");
//     const { default: Logger } = await import("./logger.js");

//     this.logger = new Logger("AutomationManager");
//     this.errorHandler = new ErrorHandler(this.logger);
//     this.healthMonitor = new HealthMonitor(this.logger);

//     this.healthMonitor.startMonitoring();
//   }

//   async loadConfig() {
//     try {
//       const result = await chrome.storage.local.get("automationConfig");
//       if (result.automationConfig) {
//         this.config = { ...this.config, ...result.automationConfig };
//       }
//     } catch (error) {
//       this.log("Warning: Could not load config, using defaults");
//     }
//   }

//   async saveConfig() {
//     try {
//       await chrome.storage.local.set({ automationConfig: this.config });
//     } catch (error) {
//       console.error("Failed to save config:", error);
//     }
//   }

//   async initializePlatforms() {
//     // Import and register all platform modules
//     const platformModules = {
//       linkedin: () => import("../platforms/linkedin/linkedin.js"),
//       indeed: () => import("../platforms/indeed/indeed.js"),
//       recruitee: () => import("../platforms/recruitee/recruitee.js"),
//       glassdoor: () => import("../platforms/glassdoor/glassdoor.js"),
//       workday: () => import("../platforms/workday/workday.js"),
//     };

//     for (const [platformName, importFn] of Object.entries(platformModules)) {
//       if (this.config.enabledPlatforms.includes(platformName)) {
//         try {
//           const module = await importFn();
//           this.platforms.set(platformName, module.default);
//           this.log(`📦 Registered platform: ${platformName}`);
//         } catch (error) {
//           console.warn(`⚠️ Failed to load platform ${platformName}:`, error);
//         }
//       }
//     }
//   }

//   setupGlobalListeners() {
//     // Listen for tab updates to monitor automation progress
//     chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
//       this.handleTabUpdate(tabId, changeInfo, tab);
//     });

//     // Listen for window closes
//     chrome.windows.onRemoved.addListener((windowId) => {
//       this.handleWindowClosed(windowId);
//     });

//     // Periodic health checks
//     setInterval(() => {
//       this.performHealthCheck();
//     }, 60000); // Every minute
//   }

//   async createAutomationSession(params) {
//     const {
//       platform,
//       userId,
//       jobsToApply,
//       submittedLinks = [],
//       preferences = {},
//       sessionId,
//     } = params;

//     try {
//       // Check if platform is supported
//       if (!this.platforms.has(platform)) {
//         throw new Error(`Platform ${platform} is not supported or enabled`);
//       }

//       // Check concurrent session limits
//       if (this.activeSessions.size >= this.config.maxConcurrentSessions) {
//         throw new Error("Maximum concurrent sessions reached");
//       }

//       // Get platform class
//       const PlatformClass = this.platforms.get(platform);

//       // Create platform instance
//       const platformInstance = new PlatformClass({
//         ...params,
//         sessionId,
//         logger: this.logger,
//         errorHandler: this.errorHandler,
//         healthMonitor: this.healthMonitor,
//       });

//       // Create session wrapper
//       const session = new AutomationSession({
//         sessionId,
//         platform,
//         platformInstance,
//         params,
//         manager: this,
//       });

//       // Store active session
//       this.activeSessions.set(sessionId, session);

//       this.log(`🚀 Created automation session for ${platform}`, { sessionId });
//       return session;
//     } catch (error) {
//       this.log(`❌ Failed to create automation session: ${error.message}`, {
//         platform,
//         sessionId,
//       });
//       throw error;
//     }
//   }

//   async startAutomation(sessionId) {
//     const session = this.activeSessions.get(sessionId);
//     if (!session) {
//       throw new Error(`Session ${sessionId} not found`);
//     }

//     try {
//       await session.start();
//       this.healthMonitor.recordMetric("sessionStarted");
//       this.log(`▶️ Started automation session ${sessionId}`);
//       return true;
//     } catch (error) {
//       this.log(`❌ Failed to start session ${sessionId}: ${error.message}`);
//       this.healthMonitor.recordMetric("sessionStartFailed");
//       throw error;
//     }
//   }

//   async pauseAutomation(sessionId) {
//     const session = this.activeSessions.get(sessionId);
//     if (!session) {
//       throw new Error(`Session ${sessionId} not found`);
//     }

//     await session.pause();
//     this.log(`⏸️ Paused automation session ${sessionId}`);
//     return true;
//   }

//   async resumeAutomation(sessionId) {
//     const session = this.activeSessions.get(sessionId);
//     if (!session) {
//       throw new Error(`Session ${sessionId} not found`);
//     }

//     await session.resume();
//     this.log(`▶️ Resumed automation session ${sessionId}`);
//     return true;
//   }

//   async stopAutomation(sessionId) {
//     const session = this.activeSessions.get(sessionId);
//     if (!session) {
//       throw new Error(`Session ${sessionId} not found`);
//     }

//     await session.stop();
//     this.activeSessions.delete(sessionId);
//     this.log(`⏹️ Stopped automation session ${sessionId}`);
//     return true;
//   }

//   getSessionStatus(sessionId) {
//     const session = this.activeSessions.get(sessionId);
//     return session ? session.getStatus() : null;
//   }

//   getAllSessionStatuses() {
//     const statuses = {};
//     for (const [sessionId, session] of this.activeSessions.entries()) {
//       statuses[sessionId] = session.getStatus();
//     }
//     return statuses;
//   }

//   async handleTabUpdate(tabId, changeInfo, tab) {
//     // Notify active sessions about tab updates
//     for (const session of this.activeSessions.values()) {
//       if (session.windowId === tab.windowId) {
//         await session.handleTabUpdate(tabId, changeInfo, tab);
//       }
//     }
//   }

//   async handleWindowClosed(windowId) {
//     // Stop sessions associated with closed window
//     const sessionsToStop = [];

//     for (const [sessionId, session] of this.activeSessions.entries()) {
//       if (session.windowId === windowId) {
//         sessionsToStop.push(sessionId);
//       }
//     }

//     for (const sessionId of sessionsToStop) {
//       try {
//         await this.stopAutomation(sessionId);
//         this.log(
//           `🧹 Cleaned up session ${sessionId} for closed window ${windowId}`
//         );
//       } catch (error) {
//         this.log(`⚠️ Error cleaning up session ${sessionId}: ${error.message}`);
//       }
//     }
//   }

//   async performHealthCheck() {
//     if (!this.healthMonitor) return;

//     try {
//       const healthReport = await this.healthMonitor.performHealthCheck();

//       // Take action based on health status
//       if (healthReport.status === "critical") {
//         this.log("🚨 Critical health issue detected", healthReport);

//         // Stop all sessions if critical issues
//         for (const sessionId of this.activeSessions.keys()) {
//           await this.stopAutomation(sessionId);
//         }
//       } else if (healthReport.status === "warning") {
//         this.log("⚠️ Health warning detected", healthReport);
//       }
//     } catch (error) {
//       this.log("❌ Health check failed", { error: error.message });
//     }
//   }

//   async updateConfig(newConfig) {
//     this.config = { ...this.config, ...newConfig };
//     await this.saveConfig();
//     this.log("⚙️ Configuration updated", newConfig);

//     // Reinitialize platforms if enabled platforms changed
//     if (newConfig.enabledPlatforms) {
//       await this.initializePlatforms();
//     }
//   }

//   getSupportedPlatforms() {
//     return Array.from(this.platforms.keys());
//   }

//   isPlatformSupported(platform) {
//     return this.platforms.has(platform);
//   }

//   getManagerStats() {
//     return {
//       initialized: this.isInitialized,
//       supportedPlatforms: this.getSupportedPlatforms(),
//       activeSessions: this.activeSessions.size,
//       config: this.config,
//       healthStatus: this.healthMonitor?.getHealthReport()?.summary || null,
//     };
//   }

//   log(message, data = {}) {
//     if (this.logger) {
//       this.logger.info(message, data);
//     } else {
//       console.log(`[AutomationManager] ${message}`, data);
//     }
//   }

//   async cleanup() {
//     // Stop all active sessions
//     const sessionIds = Array.from(this.activeSessions.keys());
//     for (const sessionId of sessionIds) {
//       await this.stopAutomation(sessionId);
//     }

//     // Stop health monitoring
//     if (this.healthMonitor) {
//       this.healthMonitor.stopMonitoring();
//     }

//     this.isInitialized = false;
//     this.log("🧹 Automation Manager cleanup completed");
//   }
// }

// class AutomationSession {
//   constructor({ sessionId, platform, platformInstance, params, manager }) {
//     this.sessionId = sessionId;
//     this.platform = platform;
//     this.platformInstance = platformInstance;
//     this.params = params;
//     this.manager = manager;
//     this.windowId = null;

//     this.status = "created";
//     this.startTime = null;
//     this.endTime = null;
//     this.isPaused = false;

//     this.progress = {
//       total: params.jobsToApply || 0,
//       completed: 0,
//       failed: 0,
//       skipped: 0,
//       current: null,
//     };

//     this.applications = [];
//     this.errors = [];
//   }

//   async start() {
//     try {
//       this.status = "starting";
//       this.startTime = Date.now();

//       // Create automation window
//       this.windowId = await this.createAutomationWindow();

//       // Set up platform callbacks
//       this.setupPlatformCallbacks();

//       // Start platform automation
//       await this.platformInstance.start();

//       this.status = "running";
//       this.manager.log(`✅ Session ${this.sessionId} started successfully`);
//     } catch (error) {
//       this.status = "failed";
//       this.errors.push({
//         message: error.message,
//         timestamp: Date.now(),
//         context: "start",
//       });

//       this.manager.log(
//         `❌ Session ${this.sessionId} failed to start: ${error.message}`
//       );
//       throw error;
//     }
//   }

//   async createAutomationWindow() {
//     const { default: WindowManager } = await import(
//       "../background/window-manager.js"
//     );
//     const windowManager = new WindowManager();

//     // Get platform-specific starting URL
//     const startUrl = this.getStartingUrl();

//     const window = await chrome.windows.create({
//       url: startUrl,
//       type: "normal",
//       focused: true,
//       width: 1200,
//       height: 800,
//     });

//     // Register as automation window
//     await windowManager.registerAutomationWindow(window.id, {
//       sessionId: this.sessionId,
//       platform: this.platform,
//       createdAt: Date.now(),
//     });

//     // Inject automation context
//     setTimeout(async () => {
//       try {
//         if (window.tabs && window.tabs[0]) {
//           await chrome.scripting.executeScript({
//             target: { tabId: window.tabs[0].id },
//             func: (sessionId, platform) => {
//               window.automationSessionId = sessionId;
//               window.automationPlatform = platform;
//               window.isAutomationWindow = true;
//               sessionStorage.setItem("automationSessionId", sessionId);
//               sessionStorage.setItem("automationPlatform", platform);
//               sessionStorage.setItem("automationWindow", "true");
//             },
//             args: [this.sessionId, this.platform],
//           });
//         }
//       } catch (error) {
//         console.error("Error injecting automation context:", error);
//       }
//     }, 100);

//     return window.id;
//   }

//   getStartingUrl() {
//     const urls = {
//       linkedin: "https://www.linkedin.com/jobs/search/",
//       indeed: "https://www.indeed.com/jobs",
//       recruitee:
//         "https://www.google.com/search?q=site:recruitee.com+software+engineer",
//       glassdoor: "https://www.glassdoor.com/Job/index.htm",
//       workday:
//         "https://www.google.com/search?q=site:myworkdayjobs.com+software+engineer",
//     };

//     return (
//       urls[this.platform] ||
//       "https://www.google.com/search?q=software+engineer+jobs"
//     );
//   }

//   setupPlatformCallbacks() {
//     if (this.platformInstance.onProgress) {
//       this.platformInstance.onProgress = (progress) => {
//         this.updateProgress(progress);
//       };
//     }

//     if (this.platformInstance.onError) {
//       this.platformInstance.onError = (error) => {
//         this.handleError(error);
//       };
//     }

//     if (this.platformInstance.onApplicationSubmitted) {
//       this.platformInstance.onApplicationSubmitted = (
//         jobData,
//         applicationData
//       ) => {
//         this.handleApplicationSubmitted(jobData, applicationData);
//       };
//     }

//     if (this.platformInstance.onComplete) {
//       this.platformInstance.onComplete = () => {
//         this.handleComplete();
//       };
//     }
//   }

//   updateProgress(progressUpdate) {
//     this.progress = { ...this.progress, ...progressUpdate };
//     this.manager.healthMonitor?.recordMetric("progressUpdate");
//   }

//   handleError(error) {
//     this.errors.push({
//       message: error.message,
//       timestamp: Date.now(),
//       context: error.context || "unknown",
//     });

//     this.manager.healthMonitor?.recordMetric("error");
//     this.manager.log(
//       `⚠️ Error in session ${this.sessionId}: ${error.message}`,
//       error
//     );
//   }

//   handleApplicationSubmitted(jobData, applicationData) {
//     this.applications.push({
//       id: this.generateApplicationId(),
//       jobData,
//       applicationData,
//       submittedAt: Date.now(),
//       sessionId: this.sessionId,
//       platform: this.platform,
//     });

//     this.progress.completed++;
//     this.updateProgress({ completed: this.progress.completed });

//     this.manager.healthMonitor?.recordMetric("applicationSuccess");
//     this.manager.log(
//       `📝 Application submitted in session ${this.sessionId}`,
//       jobData
//     );
//   }

//   handleComplete() {
//     this.status = "completed";
//     this.endTime = Date.now();
//     this.manager.log(`✅ Session ${this.sessionId} completed`);
//   }

//   async pause() {
//     this.isPaused = true;
//     this.status = "paused";

//     if (this.platformInstance.pause) {
//       await this.platformInstance.pause();
//     }
//   }

//   async resume() {
//     this.isPaused = false;
//     this.status = "running";

//     if (this.platformInstance.resume) {
//       await this.platformInstance.resume();
//     }
//   }

//   async stop() {
//     this.status = "stopped";
//     this.endTime = Date.now();

//     if (this.platformInstance.stop) {
//       await this.platformInstance.stop();
//     }

//     // Close automation window
//     if (this.windowId) {
//       try {
//         await chrome.windows.remove(this.windowId);
//       } catch (error) {
//         // Window might already be closed
//       }
//     }
//   }

//   async handleTabUpdate(tabId, changeInfo, tab) {
//     // Platform can handle tab updates if needed
//     if (this.platformInstance.handleTabUpdate) {
//       await this.platformInstance.handleTabUpdate(tabId, changeInfo, tab);
//     }
//   }

//   getStatus() {
//     return {
//       sessionId: this.sessionId,
//       platform: this.platform,
//       status: this.status,
//       progress: this.progress,
//       startTime: this.startTime,
//       endTime: this.endTime,
//       duration: this.startTime
//         ? (this.endTime || Date.now()) - this.startTime
//         : 0,
//       errors: this.errors,
//       applications: this.applications,
//       isPaused: this.isPaused,
//       windowId: this.windowId,
//     };
//   }

//   generateApplicationId() {
//     return (
//       "app_" +
//       Date.now().toString(36) +
//       "_" +
//       Math.random().toString(36).substr(2, 5)
//     );
//   }
// }


// core/automation-orchestrator.js
import WindowManager from '../background/window-manager.js';
import Logger from './logger.js';

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
      submittedLinks,
      devMode,
      country,
      userPlan,
      userCredits,
      dailyRemaining,
      resumeUrl,
      coverLetterTemplate,
      preferences
    } = params;

    try {
      this.logger.info(`🚀 Starting automation for platform: ${platform}`, { sessionId });

      // Create automation window
      const automationWindow = await this.createAutomationWindow(platform, sessionId);
      if (!automationWindow) {
        throw new Error('Failed to create automation window');
      }

      // Create automation session (background tracking only)
      const automationSession = new AutomationSession({
        sessionId,
        platform,
        windowId: automationWindow.id,
        params,
        orchestrator: this
      });

      // Store active automation
      this.activeAutomations.set(sessionId, automationSession);

      // Wait a bit for content script to load, then send start message
      setTimeout(async () => {
        await this.sendStartMessageToContentScript(automationWindow.id, {
          sessionId,
          platform,
          config: {
            jobsToApply,
            submittedLinks,
            preferences,
            resumeUrl,
            coverLetterTemplate,
            userPlan,
            userCredits,
            dailyRemaining
          }
        });
      }, 2000);

      this.logger.info(`✅ Automation started successfully`, { sessionId, platform });

      return {
        success: true,
        automationInstance: automationSession,
        windowId: automationWindow.id
      };

    } catch (error) {
      this.logger.error(`❌ Failed to start automation: ${error.message}`, { 
        sessionId, 
        platform, 
        error: error.stack 
      });

      return {
        success: false,
        error: error.message
      };
    }
  }

  async createAutomationWindow(platform, sessionId) {
    try {
      // Get platform-specific starting URL
      const startUrl = this.getStartingUrl(platform);
      
      const window = await chrome.windows.create({
        url: startUrl,
        type: 'normal',
        focused: true,
        width: 1200,
        height: 800
      });

      // Register as automation window
      await this.windowManager.registerAutomationWindow(window.id, {
        sessionId,
        platform,
        createdAt: Date.now()
      });

      // Inject automation context
      setTimeout(async () => {
        try {
          if (window.tabs && window.tabs[0]) {
            await chrome.scripting.executeScript({
              target: { tabId: window.tabs[0].id },
              func: (sessionId, platform) => {
                window.automationSessionId = sessionId;
                window.automationPlatform = platform;
                window.isAutomationWindow = true;
                sessionStorage.setItem('automationSessionId', sessionId);
                sessionStorage.setItem('automationPlatform', platform);
                sessionStorage.setItem('automationWindow', 'true');
              },
              args: [sessionId, platform]
            });
          }
        } catch (error) {
          console.error('Error injecting automation context:', error);
        }
      }, 100);

      return window;

    } catch (error) {
      throw new Error(`Failed to create automation window: ${error.message}`);
    }
  }

  async sendStartMessageToContentScript(windowId, automationConfig) {
    try {
      // Get the active tab in the automation window
      const tabs = await chrome.tabs.query({ windowId: windowId, active: true });
      if (tabs.length === 0) {
        throw new Error('No active tab found in automation window');
      }

      const tabId = tabs[0].id;

      // Send message to content script to start automation
      await chrome.tabs.sendMessage(tabId, {
        action: 'startAutomation',
        config: automationConfig
      });

      this.logger.info('📤 Sent start message to content script', { windowId, tabId });

    } catch (error) {
      this.logger.error('❌ Failed to send start message to content script:', error);
    }
  }

  getStartingUrl(platform) {
    const urls = {
      linkedin: 'https://www.linkedin.com/jobs/search/',
      indeed: 'https://www.indeed.com/jobs',
      recruitee: 'https://www.google.com/search?q=site:recruitee.com+software+engineer',
      glassdoor: 'https://www.glassdoor.com/Job/index.htm',
      workday: 'https://www.google.com/search?q=site:myworkdayjobs.com+software+engineer'
    };

    return urls[platform] || 'https://www.google.com/search?q=software+engineer+jobs';
  }

  async stopAutomation(sessionId) {
    const automation = this.activeAutomations.get(sessionId);
    if (automation) {
      await automation.stop();
      this.activeAutomations.delete(sessionId);
      return true;
    }
    return false;
  }

  async pauseAutomation(sessionId) {
    const automation = this.activeAutomations.get(sessionId);
    if (automation) {
      await automation.pause();
      return true;
    }
    return false;
  }

  async resumeAutomation(sessionId) {
    const automation = this.activeAutomations.get(sessionId);
    if (automation) {
      await automation.resume();
      return true;
    }
    return false;
  }

  getAutomationStatus(sessionId) {
    const automation = this.activeAutomations.get(sessionId);
    return automation ? automation.getStatus() : null;
  }

  // Clean up automation when window is closed
  async handleWindowClosed(windowId) {
    for (const [sessionId, automation] of this.activeAutomations.entries()) {
      if (automation.windowId === windowId) {
        await automation.stop();
        this.activeAutomations.delete(sessionId);
        this.logger.info(`🧹 Cleaned up automation for closed window`, { sessionId, windowId });
      }
    }
  }
}

class AutomationSession {
  constructor({ sessionId, platform, windowId, params, orchestrator }) {
    this.sessionId = sessionId;
    this.platform = platform;
    this.windowId = windowId;
    this.params = params;
    this.orchestrator = orchestrator;
    
    this.status = 'created';
    this.startTime = Date.now();
    this.endTime = null;
    this.progress = {
      total: params.jobsToApply,
      completed: 0,
      failed: 0,
      skipped: 0,
      current: null
    };
    this.errors = [];
    this.isPaused = false;
  }

  async pause() {
    this.isPaused = true;
    this.status = 'paused';
    
    // Send pause message to content script
    await this.sendMessageToContentScript({
      action: 'pauseAutomation'
    });
  }

  async resume() {
    this.isPaused = false;
    this.status = 'running';
    
    // Send resume message to content script
    await this.sendMessageToContentScript({
      action: 'resumeAutomation'  
    });
  }

  async stop() {
    this.status = 'stopped';
    this.endTime = Date.now();
    
    // Send stop message to content script
    await this.sendMessageToContentScript({
      action: 'stopAutomation'
    });
  }

  async sendMessageToContentScript(message) {
    try {
      const tabs = await chrome.tabs.query({ windowId: this.windowId, active: true });
      if (tabs.length > 0) {
        await chrome.tabs.sendMessage(tabs[0].id, {
          ...message,
          sessionId: this.sessionId
        });
      }
    } catch (error) {
      console.error('Error sending message to content script:', error);
    }
  }

  updateProgress(progressUpdate) {
    this.progress = { ...this.progress, ...progressUpdate };
  }

  handleError(error) {
    this.errors.push({
      message: error.message,
      timestamp: Date.now(),
      context: error.context || 'unknown'
    });
  }

  getStatus() {
    return {
      sessionId: this.sessionId,
      platform: this.platform,
      status: this.status,
      progress: this.progress,
      startTime: this.startTime,
      endTime: this.endTime,
      duration: this.startTime ? (this.endTime || Date.now()) - this.startTime : 0,
      errors: this.errors,
      isPaused: this.isPaused,
      windowId: this.windowId
    };
  }
}
