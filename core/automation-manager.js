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
