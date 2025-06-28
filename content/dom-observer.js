// content/dom-observer.js
export default class DOMObserver {
  constructor() {
    this.observers = new Map();
    this.callbacks = new Map();
    this.debounceTimers = new Map();
    this.isObserving = false;
  }

  startObserving(sessionId, options = {}) {
    if (this.isObserving) return;

    const defaultOptions = {
      childList: true,
      subtree: true,
      attributes: false,
      attributeOldValue: false,
      characterData: false,
      characterDataOldValue: false,
    };

    const observerOptions = { ...defaultOptions, ...options };

    // Create main observer for significant DOM changes
    const observer = new MutationObserver((mutations) => {
      this.handleMutations(mutations, sessionId);
    });

    observer.observe(document.body, observerOptions);
    this.observers.set(sessionId, observer);
    this.isObserving = true;

    console.log(`👁️ DOM Observer started for session ${sessionId}`);
  }

  stopObserving(sessionId) {
    const observer = this.observers.get(sessionId);
    if (observer) {
      observer.disconnect();
      this.observers.delete(sessionId);
    }

    const timer = this.debounceTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.debounceTimers.delete(timer);
    }

    this.callbacks.delete(sessionId);

    if (this.observers.size === 0) {
      this.isObserving = false;
    }

    console.log(`👁️ DOM Observer stopped for session ${sessionId}`);
  }

  handleMutations(mutations, sessionId) {
    let significantChange = false;
    let changeTypes = new Set();

    for (const mutation of mutations) {
      if (this.isSignificantMutation(mutation)) {
        significantChange = true;
        changeTypes.add(this.classifyMutation(mutation));
      }
    }

    if (significantChange) {
      // Debounce the callback to avoid too many rapid fire events
      this.debouncedCallback(sessionId, changeTypes, 500);
    }
  }

  isSignificantMutation(mutation) {
    // Filter out mutations that are likely not important for automation
    const insignificantClasses = [
      "loading",
      "spinner",
      "hover",
      "focus",
      "active",
      "tooltip",
      "dropdown-open",
      "animation",
    ];

    const insignificantTags = ["SCRIPT", "STYLE", "META", "LINK"];

    if (mutation.type === "childList") {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          // Check if the added element is significant
          if (insignificantTags.includes(node.tagName)) {
            continue;
          }

          // Check for job-related elements
          if (this.isJobRelatedElement(node)) {
            return true;
          }

          // Check for form elements
          if (this.isFormRelatedElement(node)) {
            return true;
          }

          // Check for application-related elements
          if (this.isApplicationRelatedElement(node)) {
            return true;
          }
        }
      }
    }

    return false;
  }

  isJobRelatedElement(element) {
    const jobKeywords = [
      "job",
      "position",
      "role",
      "career",
      "employment",
      "vacancy",
      "opening",
      "opportunity",
      "listing",
      "posting",
    ];

    const elementText = (
      element.className +
      " " +
      element.id +
      " " +
      (element.textContent || "")
    ).toLowerCase();

    return jobKeywords.some((keyword) => elementText.includes(keyword));
  }

  isFormRelatedElement(element) {
    const formSelectors = [
      "form",
      "input",
      "textarea",
      "select",
      'button[type="submit"]',
      '[role="form"]',
      ".form",
      ".application-form",
    ];

    return formSelectors.some((selector) => {
      try {
        return element.matches(selector) || element.querySelector(selector);
      } catch (e) {
        return false;
      }
    });
  }

  isApplicationRelatedElement(element) {
    const appKeywords = [
      "apply",
      "application",
      "submit",
      "resume",
      "cv",
      "cover-letter",
      "easy-apply",
      "quick-apply",
      "one-click",
    ];

    const elementText = (
      element.className +
      " " +
      element.id +
      " " +
      (element.getAttribute("aria-label") || "") +
      " " +
      (element.textContent || "")
    ).toLowerCase();

    return appKeywords.some((keyword) => elementText.includes(keyword));
  }

  classifyMutation(mutation) {
    const addedElements = Array.from(mutation.addedNodes).filter(
      (node) => node.nodeType === Node.ELEMENT_NODE
    );

    if (addedElements.some((el) => this.isJobRelatedElement(el))) {
      return "job-content";
    }

    if (addedElements.some((el) => this.isFormRelatedElement(el))) {
      return "form-content";
    }

    if (addedElements.some((el) => this.isApplicationRelatedElement(el))) {
      return "application-content";
    }

    return "general-content";
  }

  debouncedCallback(sessionId, changeTypes, delay) {
    // Clear existing timer
    const existingTimer = this.debounceTimers.get(sessionId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new timer
    const timer = setTimeout(() => {
      this.notifyChanges(sessionId, changeTypes);
      this.debounceTimers.delete(sessionId);
    }, delay);

    this.debounceTimers.set(sessionId, timer);
  }

  notifyChanges(sessionId, changeTypes) {
    const callback = this.callbacks.get(sessionId);
    if (callback) {
      callback({
        sessionId,
        changeTypes: Array.from(changeTypes),
        timestamp: Date.now(),
        url: window.location.href,
      });
    }

    // Also send message to background script
    try {
      chrome.runtime.sendMessage({
        action: "domChanged",
        sessionId,
        changeTypes: Array.from(changeTypes),
        url: window.location.href,
        timestamp: Date.now(),
      });
    } catch (error) {
      console.error(
        "Failed to notify background script of DOM changes:",
        error
      );
    }
  }

  setChangeCallback(sessionId, callback) {
    this.callbacks.set(sessionId, callback);
  }

  // Specialized observers for specific elements
  observeElement(element, sessionId, callback, options = {}) {
    const observerId = `${sessionId}-${Date.now()}`;

    const observer = new MutationObserver((mutations) => {
      callback(mutations, element);
    });

    const defaultOptions = {
      childList: true,
      subtree: true,
      attributes: true,
    };

    observer.observe(element, { ...defaultOptions, ...options });
    this.observers.set(observerId, observer);

    return observerId;
  }

  stopObservingElement(observerId) {
    const observer = this.observers.get(observerId);
    if (observer) {
      observer.disconnect();
      this.observers.delete(observerId);
    }
  }

  // Monitor for specific element appearance
  waitForElement(selector, sessionId, timeout = 10000) {
    return new Promise((resolve) => {
      // Check if element already exists
      const existingElement = document.querySelector(selector);
      if (existingElement) {
        resolve(existingElement);
        return;
      }

      // Set up observer
      const observer = new MutationObserver((mutations) => {
        const element = document.querySelector(selector);
        if (element) {
          observer.disconnect();
          resolve(element);
        }
      });

      observer.observe(document, {
        childList: true,
        subtree: true,
      });

      // Set timeout
      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  // Monitor for page load completion
  waitForPageLoad(sessionId, timeout = 30000) {
    return new Promise((resolve) => {
      if (document.readyState === "complete") {
        resolve(true);
        return;
      }

      const checkComplete = () => {
        if (document.readyState === "complete") {
          resolve(true);
        } else {
          setTimeout(checkComplete, 100);
        }
      };

      checkComplete();

      // Set timeout
      setTimeout(() => {
        resolve(false);
      }, timeout);
    });
  }

  // Get current page statistics
  getPageStats() {
    const forms = document.querySelectorAll("form").length;
    const inputs = document.querySelectorAll("input, textarea, select").length;
    const buttons = document.querySelectorAll("button").length;
    const links = document.querySelectorAll("a").length;

    return {
      forms,
      inputs,
      buttons,
      links,
      totalElements: document.querySelectorAll("*").length,
      url: window.location.href,
      title: document.title,
      readyState: document.readyState,
    };
  }

  cleanup() {
    // Disconnect all observers
    for (const observer of this.observers.values()) {
      observer.disconnect();
    }

    // Clear all timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }

    this.observers.clear();
    this.callbacks.clear();
    this.debounceTimers.clear();
    this.isObserving = false;

    console.log("👁️ DOM Observer cleanup completed");
  }
}
