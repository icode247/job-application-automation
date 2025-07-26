// background/window-manager.js

export default class WindowManager {
  constructor(logger, devMode = false) {
    this.automationWindows = new Map();
    this.storageKey = "automationWindows";
    this.logger = logger;
    this.devMode = devMode;
  }

  async initialize() {
    await this.loadAutomationWindows();
    this.logger.log("🪟 Window manager initialized");
  }

  async loadAutomationWindows() {
    try {
      const result = await chrome.storage.local.get(this.storageKey);
      if (result[this.storageKey]) {
        const windowsArray = result[this.storageKey];
        for (const windowData of windowsArray) {
          this.automationWindows.set(windowData.windowId, windowData);
        }
      }
    } catch (error) {
      this.logger.error("Error loading automation windows:", error);
    }
  }

  async saveAutomationWindows() {
    try {
      const windowsArray = Array.from(this.automationWindows.values());
      await chrome.storage.local.set({
        [this.storageKey]: windowsArray,
      });
    } catch (error) {
      this.logger.error("Error saving automation windows:", error);
    }
  }

  async registerAutomationWindow(windowId, metadata) {
    const windowData = {
      windowId,
      ...metadata,
      registeredAt: Date.now(),
    };

    this.automationWindows.set(windowId, windowData);
    await this.saveAutomationWindows();

    this.logger.log(`🪟 Registered automation window ${windowId}`, windowData);
  }

  async checkIfAutomationWindow(sender, sendResponse) {
    const isAutomationWindow = sender.tab
      ? this.automationWindows.has(sender.tab.windowId)
      : false;

    sendResponse({ isAutomationWindow });
    return true;
  }

  async handleWindowClosed(windowId) {
    if (this.automationWindows.has(windowId)) {
      this.automationWindows.delete(windowId);
      await this.saveAutomationWindows();
      this.logger.log(`🪟 Cleaned up automation window ${windowId}`);
    }
  }

  isAutomationWindow(windowId) {
    return this.automationWindows.has(windowId);
  }

  getAutomationWindowData(windowId) {
    return this.automationWindows.get(windowId);
  }

  async cleanupInvalidWindows() {
    try {
      const allWindows = await chrome.windows.getAll();
      const validWindowIds = new Set(allWindows.map((w) => w.id));

      let hasChanges = false;
      for (const windowId of this.automationWindows.keys()) {
        if (!validWindowIds.has(windowId)) {
          this.automationWindows.delete(windowId);
          hasChanges = true;
        }
      }

      if (hasChanges) {
        await this.saveAutomationWindows();
        this.logger.log("🧹 Cleaned up invalid automation windows");
      }
    } catch (error) {
      this.logger.error("Error cleaning up windows:", error);
    }
  }
}
