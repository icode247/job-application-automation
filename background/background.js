// background/background.js
import WindowManager from "./window-manager.js";
import MessageHandler from "./message-handler.js";
import SessionManager from "./session-manager.js";
//setupWindowEvents
class BackgroundService {
  constructor() {
    this.windowManager = new WindowManager();
    this.messageHandler = new MessageHandler();
    this.sessionManager = new SessionManager();
    this.isInitialized = false;
    this.listenersSetup = false;
    this.windowListenersSetup = false;
  }

  async initialize() {
    if (this.isInitialized) {
      console.log("⚠️ Background service already initialized");
      return;
    }

    try {
      // Initialize managers
      await this.windowManager.initialize();
      await this.sessionManager.initialize();

      // Set up message handling
      this.setupMessageHandling();

      // Set up window event listeners
      this.setupWindowEvents();

      this.isInitialized = true;
      console.log("✅ Background service initialized");
    } catch (error) {
      console.error("❌ Background service initialization failed:", error);
    }
  }

  setupMessageHandling() {
    if (this.listenersSetup) {
      console.log("⚠️ Message listeners already set up, skipping");
      return;
    }

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

    // Handle internal messages from content scripts
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      return this.messageHandler.handleInternalMessage(
        request,
        sender,
        sendResponse
      );
    });

    this.listenersSetup = true; // ✅ ADD: Mark listeners as set up
    console.log("✅ Message listeners set up");
  }

  setupWindowEvents() {
    if (this.windowListenersSetup) {
      console.log("⚠️ Window listeners already set up, skipping");
      return;
    }

    chrome.windows.onRemoved.addListener(async (windowId) => {
      try {
        console.log(
          `🪟 Window ${windowId} removed - starting comprehensive cleanup`
        );

        // Parallel cleanup for better performance
        const cleanupPromises = [
          this.windowManager.handleWindowClosed(windowId),
          this.sessionManager.handleWindowClosed(windowId),
          this.messageHandler.handleWindowClosed(windowId),
        ];

        // Wait for all cleanup to complete
        await Promise.allSettled(cleanupPromises);

        console.log(`✅ All cleanup completed for window ${windowId}`);
      } catch (error) {
        console.error(
          `❌ Error in window close cleanup for ${windowId}:`,
          error
        );

        // Force cleanup even if there are errors
        try {
          await this.messageHandler.handleWindowClosed(windowId);
        } catch (fallbackError) {
          console.error(`❌ Fallback cleanup also failed:`, fallbackError);
        }
      }
    });

    chrome.windows.onFocusChanged.addListener(async (windowId) => {
      if (windowId === chrome.windows.WINDOW_ID_NONE) {
        console.log("👁️ User switched away from Chrome");
      }
    });

    // Handle tab updates
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (changeInfo.status === "complete" && tab.windowId) {
        await this.sessionManager.handleTabUpdated(tabId, tab);
      }
    });

    this.windowListenersSetup = true;
    console.log("✅ Enhanced window listeners set up");
  }
}

// Create single instance
let backgroundService = null;

// Initialize background service
async function initializeService() {
  if (!backgroundService) {
    backgroundService = new BackgroundService();
  }
  await backgroundService.initialize();
}

chrome.runtime.onStartup.addListener(() => {
  initializeService();
});

chrome.runtime.onInstalled.addListener(() => {
  initializeService();
});

// Immediate initialization
initializeService();
