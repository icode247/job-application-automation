// core/automation-orchestrator.js - Simplified approach
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

      // Create automation window with simplified approach
      const automationWindow = await this.createAutomationWindow(platform, sessionId, preferences);
      if (!automationWindow) {
        throw new Error('Failed to create automation window');
      }

      // Register window with background service
      if (globalThis.backgroundService) {
        await globalThis.backgroundService.addAutomationWindow(automationWindow.id, {
          sessionId,
          platform,
          createdAt: Date.now(),
          preferences,
          jobsToApply,
          submittedLinks
        });
      }

      // Create automation session
      const automationSession = new AutomationSession({
        sessionId,
        platform,
        windowId: automationWindow.id,
        params,
        orchestrator: this
      });

      // Store active automation
      this.activeAutomations.set(sessionId, automationSession);

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

  async createAutomationWindow(platform, sessionId, preferences = {}) {
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

      // Enhanced: Inject automation context with better timing and debugging
      await this.injectAutomationContextWithRetry(window, sessionId, platform, preferences);

      return window;

    } catch (error) {
      throw new Error(`Failed to create automation window: ${error.message}`);
    }
  }

  // Enhanced context injection with retry logic
  async injectAutomationContextWithRetry(window, sessionId, platform, preferences = {}) {
    const maxAttempts = 3;
    let attempt = 0;

    const attemptInjection = async () => {
      try {
        attempt++;
        console.log(`🎯 Attempting context injection ${attempt}/${maxAttempts} for ${platform} session ${sessionId.slice(-6)}`);
        
        if (!window.tabs || window.tabs.length === 0) {
          if (attempt <= maxAttempts) {
            console.log(`⏳ No tabs yet, waiting... (attempt ${attempt})`);
            setTimeout(attemptInjection, 1000);
            return;
          } else {
            throw new Error('No tabs available after maximum attempts');
          }
        }

        const tabId = window.tabs[0].id;
        
        // Inject automation context
        await chrome.scripting.executeScript({
          target: { tabId },
          func: (sessionId, platform, preferences) => {
            console.log(`🎯 Injecting context: sessionId=${sessionId}, platform=${platform}`);
            
            // Set window-level flags
            window.isAutomationWindow = true;
            window.automationSessionId = sessionId;
            window.automationPlatform = platform;
            
            // Store in sessionStorage (more persistent for tab navigation)
            sessionStorage.setItem('automationWindow', 'true');
            sessionStorage.setItem('automationSessionId', sessionId);
            sessionStorage.setItem('automationPlatform', platform);
            
            // Store preferences if available
            if (preferences && Object.keys(preferences).length > 0) {
              sessionStorage.setItem('automationPreferences', JSON.stringify(preferences));
            }
            
            // Verify storage
            const storedSessionId = sessionStorage.getItem('automationSessionId');
            const storedPlatform = sessionStorage.getItem('automationPlatform');
            console.log(`✅ Context stored: sessionId=${storedSessionId}, platform=${storedPlatform}`);
            
            // Dispatch event to notify any existing content scripts
            window.dispatchEvent(new CustomEvent('automationContextReady', {
              detail: { sessionId, platform, preferences }
            }));
          },
          args: [sessionId, platform, preferences]
        });

        console.log(`✅ Successfully injected automation context for ${platform} session ${sessionId.slice(-6)}`);
        return true;

      } catch (error) {
        console.error(`❌ Context injection attempt ${attempt} failed:`, error);
        if (attempt < maxAttempts) {
          setTimeout(attemptInjection, 1000);
        } else {
          throw error;
        }
      }
    };

    // Start injection immediately
    await attemptInjection();
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
  constructor({
    sessionId,
    platform,
    windowId,
    params,
    orchestrator,
  }) {
    this.sessionId = sessionId;
    this.platform = platform;
    this.windowId = windowId;
    this.params = params;
    this.orchestrator = orchestrator;

    this.status = "created";
    this.startTime = null;
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

  async start() {
    try {
      this.status = "running";
      this.startTime = Date.now();
      
      // The automation will be handled by content scripts in each tab
      // This session just tracks the state
      
    } catch (error) {
      this.status = "failed";
      this.errors.push({
        message: error.message,
        timestamp: Date.now(),
        context: "start",
      });
      throw error;
    }
  }

  async pause() {
    this.isPaused = true;
    this.status = "paused";
  }

  async resume() {
    this.isPaused = false;
    this.status = "running";
  }

  async stop() {
    this.status = "stopped";
    this.endTime = Date.now();
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

  handleComplete() {
    this.status = "completed";
    this.endTime = Date.now();
  }

  getProgress() {
    return {
      ...this.progress,
      status: this.status,
      isPaused: this.isPaused,
      duration: this.startTime ? Date.now() - this.startTime : 0,
      errors: this.errors,
    };
  }

  getStatus() {
    return {
      sessionId: this.sessionId,
      platform: this.platform,
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
    };
  }
}