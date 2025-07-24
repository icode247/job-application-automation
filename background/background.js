// background/background.js
import WindowManager from "./window-manager.js";
import MessageHandler from "./message-handler.js";
import SessionManager from "./session-manager.js";

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

      // ✅ NEW: Set up extension action (icon click) listener
      this.setupExtensionActionListener();

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

    this.listenersSetup = true;
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

  setupExtensionActionListener() {
    chrome.action.onClicked.addListener(async (tab) => {
      try {
        console.log("🔗 Extension icon clicked - opening FastApply website");
        await this.openFastApplyWebsite();
      } catch (error) {
        console.error(
          "❌ Error opening FastApply website on icon click:",
          error
        );
      }
    });
    console.log("✅ Extension action listener set up");
  }

  // ✅ NEW: Open FastApply website
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
        console.log(`✅ Focused existing FastApply tab: ${existingTab.id}`);
      } else {
        // If not open, create a new tab
        const newTab = await chrome.tabs.create({
          url: url,
          active: true,
        });
        console.log(`✅ Created new FastApply tab: ${newTab.id}`);
      }
    } catch (error) {
      console.error("❌ Error opening FastApply website:", error);
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

chrome.runtime.onStartup.addListener(async () => {
  console.log("🚀 Extension startup detected");
  await initializeService();
});

chrome.runtime.onInstalled.addListener(async (details) => {
  console.log("📦 Extension installed/updated:", details.reason);

  await initializeService();

  // Open FastApply website on fresh install or extension update
  if (details.reason === "install") {
    console.log("🎉 Fresh installation - opening FastApply website");
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
  } else if (details.reason === "update") {
    console.log("🔄 Extension updated - optionally open FastApply website");
  }
});

initializeService();
