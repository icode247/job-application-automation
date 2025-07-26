// background/background.js
import WindowManager from "./window-manager.js";
import MessageHandler from "./message-handler.js";
import SessionManager from "./session-manager.js";
import Logger from "../core/logger.js";

class BackgroundService {
  constructor(devMode = false) {
    this.devMode = devMode;

    this.logger = new Logger("BackgroundService", this.devMode);

    // Initialize managers with shared logger context
    this.windowManager = new WindowManager(this.logger, this.devMode);
    this.sessionManager = new SessionManager(this.logger, this.devMode);
    this.messageHandler = new MessageHandler(this.logger, this.sessionManager, this.windowManager, this.devMode);

    this.isInitialized = false;
    this.listenersSetup = false;
    this.windowListenersSetup = false;
  }

  async initialize() {
    if (this.isInitialized) {
      this.logger.warn("⚠️ Background service already initialized");
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

      // ✅ NEW: Set up extension action (icon click) listener
      this.setupExtensionActionListener();

      this.isInitialized = true;
      this.logger.log("✅ Background service initialized");
    } catch (error) {
      this.logger.error("❌ Background service initialization failed:", error);
    }
  }

  setupMessageHandling() {
    if (this.listenersSetup) {
      this.logger.warn("⚠️ Message listeners already set up, skipping");
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

    this.listenersSetup = true;
    this.logger.log("✅ Message listeners set up");
  }

  setupWindowEvents() {
    if (this.windowListenersSetup) {
      this.logger.warn("⚠️ Window listeners already set up, skipping");
      return;
    }

    chrome.windows.onRemoved.addListener(async (windowId) => {
      try {
        this.logger.log(
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

        this.logger.log(`✅ All cleanup completed for window ${windowId}`);
      } catch (error) {
        this.logger.error(
          `❌ Error in window close cleanup for ${windowId}:`,
          error
        );

        // Force cleanup even if there are errors
        try {
          await this.messageHandler.handleWindowClosed(windowId);
        } catch (fallbackError) {
          this.logger.error(`❌ Fallback cleanup also failed:`, fallbackError);
        }
      }
    });

    chrome.windows.onFocusChanged.addListener(async (windowId) => {
      if (windowId === chrome.windows.WINDOW_ID_NONE) {
        this.logger.log("👁️ User switched away from Chrome");
      }
    });

    // Handle tab updates
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      if (changeInfo.status === "complete" && tab.windowId) {
        await this.sessionManager.handleTabUpdated(tabId, tab);
      }
    });

    this.windowListenersSetup = true;
    this.logger.log("✅ Enhanced window listeners set up");
  }

  setupExtensionActionListener() {
    chrome.action.onClicked.addListener(async (tab) => {
      try {
        this.logger.log("🔗 Extension icon clicked - opening FastApply website");
        await this.openFastApplyWebsite();
      } catch (error) {
        this.logger.error(
          "❌ Error opening FastApply website on icon click:",
          error
        );
      }
    });
    this.logger.log("✅ Extension action listener set up");
  }

  async openFastApplyWebsite() {
    try {
      const url = "https://fastapply.co";

      // Check if the website is already open in any tab
      const tabs = await chrome.tabs.query({ url: `${url}/*` });

      if (tabs.length > 0) {
        // If already open, focus on the existing tab
        const existingTab = tabs[0];
        await chrome.tabs.update(existingTab.id, { active: true });
        await chrome.windows.update(existingTab.windowId, { focused: true });
        this.logger.log(`✅ Focused existing FastApply tab: ${existingTab.id}`);
      } else {
        // If not open, create a new tab
        const newTab = await chrome.tabs.create({
          url: url,
          active: true,
        });
        this.logger.log(`✅ Created new FastApply tab: ${newTab.id}`);
      }
    } catch (error) {
      this.logger.error("❌ Error opening FastApply website:", error);
    }
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

function updateDevMode(newDevMode) {
  if (backgroundService) {
    backgroundService.devMode = newDevMode;
    backgroundService.logger = new Logger("BackgroundService", newDevMode);

    // Update all sub-components
    backgroundService.windowManager.devMode = newDevMode;
    backgroundService.sessionManager.devMode = newDevMode;
    backgroundService.messageHandler.devMode = newDevMode;
    backgroundService.messageHandler.orchestrator.devMode = newDevMode;
  }
}

chrome.runtime.onStartup.addListener(async () => {
  await initializeService();
});

chrome.runtime.onInstalled.addListener(async (details) => {

  await initializeService();

  // Open FastApply website on fresh install or extension update
  if (details.reason === "install") {
    try {
      // Wait a moment for the service to fully initialize
      setTimeout(async () => {
        if (backgroundService) {
          await backgroundService.openFastApplyWebsite();
        }
      }, 1000);
    } catch (error) {
      console.error("❌ Error opening website on install:", error);
    }
  }
});

chrome.runtime.onMessageExternal.addListener((request, sender, sendResponse) => {
  if (request.devMode !== undefined && backgroundService) {
    updateDevMode(request.devMode);
  }
});

initializeService();
