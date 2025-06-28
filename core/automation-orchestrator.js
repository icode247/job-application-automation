// core/automation-orchestrator.js
import WindowManager from '../background/window-manager.js';
import Logger from './logger.js';

export default class AutomationOrchestrator {
  constructor() {
    this.windowManager = new WindowManager();
    this.logger = new Logger();
    this.activeSessions = new Map();
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

      // Create session tracking object (no platform automation here)
      const sessionTracker = new AutomationSessionTracker({
        sessionId,
        platform,
        windowId: automationWindow.id,
        params,
        orchestrator: this
      });

      // Store active session
      this.activeSessions.set(sessionId, sessionTracker);

      // Wait for content script to load, then send start message
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
            dailyRemaining,
            userId,
            devMode,
            country
          }
        });
      }, 2000);

      this.logger.info(`✅ Automation session created successfully`, { sessionId, platform });

      return {
        success: true,
        sessionId,
        windowId: automationWindow.id,
        sessionTracker
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
      
      // Retry after a delay
      setTimeout(() => {
        this.sendStartMessageToContentScript(windowId, automationConfig);
      }, 2000);
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
    const sessionTracker = this.activeSessions.get(sessionId);
    if (sessionTracker) {
      await sessionTracker.stop();
      this.activeSessions.delete(sessionId);
      return true;
    }
    return false;
  }

  async pauseAutomation(sessionId) {
    const sessionTracker = this.activeSessions.get(sessionId);
    if (sessionTracker) {
      await sessionTracker.pause();
      return true;
    }
    return false;
  }

  async resumeAutomation(sessionId) {
    const sessionTracker = this.activeSessions.get(sessionId);
    if (sessionTracker) {
      await sessionTracker.resume();
      return true;
    }
    return false;
  }

  getAutomationStatus(sessionId) {
    const sessionTracker = this.activeSessions.get(sessionId);
    return sessionTracker ? sessionTracker.getStatus() : null;
  }

  // Handle progress updates from content script
  handleProgressUpdate(sessionId, progress) {
    const sessionTracker = this.activeSessions.get(sessionId);
    if (sessionTracker) {
      sessionTracker.updateProgress(progress);
    }
  }

  // Handle error reports from content script
  handleErrorReport(sessionId, error, context) {
    const sessionTracker = this.activeSessions.get(sessionId);
    if (sessionTracker) {
      sessionTracker.addError(error, context);
    }
  }

  // Handle application submissions from content script
  handleApplicationSubmitted(sessionId, jobData, applicationData) {
    const sessionTracker = this.activeSessions.get(sessionId);
    if (sessionTracker) {
      sessionTracker.addApplication(jobData, applicationData);
    }
  }

  // Clean up automation when window is closed
  async handleWindowClosed(windowId) {
    for (const [sessionId, sessionTracker] of this.activeSessions.entries()) {
      if (sessionTracker.windowId === windowId) {
        await sessionTracker.stop();
        this.activeSessions.delete(sessionId);
        this.logger.info(`🧹 Cleaned up automation for closed window`, { sessionId, windowId });
      }
    }
  }
}

// Session tracking class (runs in background, tracks state only)
class AutomationSessionTracker {
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
      total: params.jobsToApply || 0,
      completed: 0,
      failed: 0,
      skipped: 0,
      current: null
    };
    this.errors = [];
    this.applications = [];
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
    this.status = 'running';
  }

  addError(error, context) {
    this.errors.push({
      message: error.message || error,
      context,
      timestamp: Date.now()
    });
  }

  addApplication(jobData, applicationData) {
    this.applications.push({
      jobData,
      applicationData,
      timestamp: Date.now()
    });
    this.progress.completed = this.applications.length;
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
      applications: this.applications,
      isPaused: this.isPaused,
      windowId: this.windowId
    };
  }

  getProgress() {
    return {
      ...this.progress,
      status: this.status,
      isPaused: this.isPaused,
      duration: this.startTime ? Date.now() - this.startTime : 0,
      errorCount: this.errors.length
    };
  }
}