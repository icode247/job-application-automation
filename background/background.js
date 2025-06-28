// background/background.js - Simplified approach based on working code
import WindowManager from "./window-manager.js";
import MessageHandler from "./message-handler.js";
import SessionManager from "./session-manager.js";

class BackgroundService {
  constructor() {
    this.windowManager = new WindowManager();
    this.messageHandler = new MessageHandler();
    this.sessionManager = new SessionManager();
    this.isInitialized = false;
    
    // Simple automation windows tracking (like the working code)
    this.automationWindows = new Set();
    this.AUTOMATION_WINDOWS_KEY = 'automationWindows';
  }

  async initialize() {
    if (this.isInitialized) return;

    try {
      // Load automation windows from storage
      await this.loadAutomationWindows();
      
      // Initialize managers
      await this.windowManager.initialize();
      await this.sessionManager.initialize();

      // Connect message handler to this background service
      this.messageHandler.setBackgroundService(this);

      // Set up message handling
      this.setupMessageHandling();

      // Set up window event listeners (simplified)
      this.setupWindowEvents();

      // Set up periodic cleanup
      this.setupPeriodicCleanup();

      this.isInitialized = true;
      console.log("✅ Simplified background service initialized");
    } catch (error) {
      console.error("❌ Background service initialization failed:", error);
    }
  }

  // Load automation windows from storage (from working code pattern)
  async loadAutomationWindows() {
    try {
      const result = await chrome.storage.local.get(this.AUTOMATION_WINDOWS_KEY);
      if (result[this.AUTOMATION_WINDOWS_KEY]) {
        this.automationWindows = new Set(result[this.AUTOMATION_WINDOWS_KEY]);
      }
    } catch (error) {
      console.error('Error loading automation windows:', error);
    }
  }

  // Save automation windows to storage (from working code pattern)
  async saveAutomationWindows() {
    try {
      await chrome.storage.local.set({
        [this.AUTOMATION_WINDOWS_KEY]: Array.from(this.automationWindows)
      });
    } catch (error) {
      console.error('Error saving automation windows:', error);
    }
  }

  setupMessageHandling() {
    // Handle messages from your frontend web app
    chrome.runtime.onMessageExternal.addListener(
      (request, sender, sendResponse) => {
        return this.messageHandler.handleExternalMessage(
          request,
          sender,
          sendResponse
        );
      }
    );

    // Handle internal messages from content scripts (simplified)
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      (async () => {
        switch (request.action) {
          case 'checkIfAutomationWindow':
            // Simple check like in working code
            const isAutomationWindow = sender.tab ? this.automationWindows.has(sender.tab.windowId) : false;
            sendResponse({ 
              isAutomationWindow,
              windowId: sender.tab?.windowId,
              tabId: sender.tab?.id
            });
            break;
            
          default:
            // Delegate other messages to message handler
            return this.messageHandler.handleInternalMessage(request, sender, sendResponse);
        }
      })();
      
      return true; // Keep message channel open for async response
    });
  }

  setupWindowEvents() {
    // Clean up when windows are closed (from working code)
    chrome.windows.onRemoved.addListener(async (windowId) => {
      if (this.automationWindows.has(windowId)) {
        this.automationWindows.delete(windowId);
        await this.saveAutomationWindows();
        console.log(`🧹 Cleaned up automation window ${windowId}`);
      }
      
      // Also clean up in managers
      await this.windowManager.handleWindowClosed(windowId);
      await this.sessionManager.handleWindowClosed(windowId);
    });
  }

  // Set up periodic cleanup (from working code pattern)
  setupPeriodicCleanup() {
    // Clean up invalid window IDs periodically
    setInterval(async () => {
      try {
        const allWindows = await chrome.windows.getAll();
        const validWindowIds = new Set(allWindows.map(w => w.id));
        
        let hasChanges = false;
        for (const windowId of this.automationWindows) {
          if (!validWindowIds.has(windowId)) {
            this.automationWindows.delete(windowId);
            hasChanges = true;
          }
        }
        
        if (hasChanges) {
          await this.saveAutomationWindows();
        }
      } catch (error) {
        console.error('Error cleaning up automation windows:', error);
      }
    }, 30000); // Clean up every 30 seconds
  }

  // Add window to automation tracking (called by orchestrator)
  async addAutomationWindow(windowId, sessionData) {
    this.automationWindows.add(windowId);
    await this.saveAutomationWindows();
    
    // Also register with window manager for additional tracking
    await this.windowManager.registerAutomationWindow(windowId, sessionData);
    
    console.log(`📝 Added automation window ${windowId}`);
  }

  // Check if window is automation window
  isAutomationWindow(windowId) {
    return this.automationWindows.has(windowId);
  }

  // Get automation windows count
  getAutomationWindowsCount() {
    return this.automationWindows.size;
  }
}

// Initialize background service
const backgroundService = new BackgroundService();

chrome.runtime.onStartup.addListener(() => {
  backgroundService.initialize();
});

chrome.runtime.onInstalled.addListener(() => {
  backgroundService.initialize();
});

// Immediate initialization
backgroundService.initialize();

// Export the instance for use by other modules
if (typeof globalThis !== 'undefined') {
  globalThis.backgroundService = backgroundService;
}