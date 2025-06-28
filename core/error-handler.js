// core/error-handler.js
export default class ErrorHandler {
  constructor(logger) {
    this.logger = logger;
    this.errorCounts = new Map();
    this.maxRetries = 3;
    this.retryDelays = [1000, 3000, 5000]; // Progressive delays
  }

  async handleError(error, context = {}) {
    const errorKey = this.getErrorKey(error, context);
    const errorCount = this.errorCounts.get(errorKey) || 0;

    this.errorCounts.set(errorKey, errorCount + 1);

    this.logger.error(`Error occurred: ${error.message}`, {
      error: error.stack,
      context,
      attempt: errorCount + 1,
      errorKey,
    });

    // Determine if error is recoverable
    const recoveryStrategy = this.determineRecoveryStrategy(
      error,
      context,
      errorCount
    );

    if (recoveryStrategy) {
      return await this.executeRecoveryStrategy(
        recoveryStrategy,
        error,
        context
      );
    }

    return { success: false, fatal: true };
  }

  getErrorKey(error, context) {
    return `${error.name}:${context.platform}:${context.action}`;
  }

  determineRecoveryStrategy(error, context, attempt) {
    if (attempt >= this.maxRetries) {
      return null; // No more retries
    }

    // Network errors - retry with delay
    if (this.isNetworkError(error)) {
      return {
        type: "retry",
        delay: this.retryDelays[Math.min(attempt, this.retryDelays.length - 1)],
        action: "reload_page",
      };
    }

    // Element not found - wait and retry
    if (this.isElementNotFoundError(error)) {
      return {
        type: "retry",
        delay: 2000,
        action: "wait_for_element",
      };
    }

    // Form submission failed - clear and retry
    if (this.isFormError(error)) {
      return {
        type: "retry",
        delay: 1000,
        action: "clear_and_refill",
      };
    }

    // Page load timeout - refresh and retry
    if (this.isTimeoutError(error)) {
      return {
        type: "retry",
        delay: 3000,
        action: "refresh_page",
      };
    }

    // Unknown error - generic retry
    return {
      type: "retry",
      delay: 2000,
      action: "generic_retry",
    };
  }

  async executeRecoveryStrategy(strategy, error, context) {
    this.logger.info(`Executing recovery strategy: ${strategy.action}`, {
      strategy,
      error: error.message,
      context,
    });

    try {
      // Wait before attempting recovery
      if (strategy.delay) {
        await this.delay(strategy.delay);
      }

      switch (strategy.action) {
        case "reload_page":
          return await this.reloadPage(context);

        case "refresh_page":
          return await this.refreshPage(context);

        case "wait_for_element":
          return await this.waitForElement(context);

        case "clear_and_refill":
          return await this.clearAndRefillForm(context);

        case "generic_retry":
          return await this.genericRetry(context);

        default:
          return { success: false, fatal: false };
      }
    } catch (recoveryError) {
      this.logger.error("Recovery strategy failed", {
        strategy,
        originalError: error.message,
        recoveryError: recoveryError.message,
        context,
      });

      return { success: false, fatal: false };
    }
  }

  async reloadPage(context) {
    if (context.tabId) {
      await chrome.tabs.reload(context.tabId);
      await this.delay(5000); // Wait for page to load
      return { success: true, action: "reloaded" };
    }
    return { success: false, fatal: false };
  }

  async refreshPage(context) {
    if (context.tabId) {
      await chrome.scripting.executeScript({
        target: { tabId: context.tabId },
        func: () => window.location.reload(),
      });
      await this.delay(5000);
      return { success: true, action: "refreshed" };
    }
    return { success: false, fatal: false };
  }

  async waitForElement(context) {
    if (context.tabId && context.selector) {
      const found = await this.executeScript(
        context.tabId,
        (selector) => {
          return new Promise((resolve) => {
            const checkElement = () => {
              const element = document.querySelector(selector);
              if (element) {
                resolve(true);
              } else {
                setTimeout(checkElement, 500);
              }
            };
            checkElement();
            setTimeout(() => resolve(false), 10000); // 10 second timeout
          });
        },
        [context.selector]
      );

      return { success: found, action: "waited_for_element" };
    }
    return { success: false, fatal: false };
  }

  async clearAndRefillForm(context) {
    if (context.tabId) {
      const cleared = await this.executeScript(context.tabId, () => {
        const inputs = document.querySelectorAll("input, textarea");
        inputs.forEach((input) => {
          if (input.type !== "hidden" && input.type !== "submit") {
            input.value = "";
          }
        });
        return true;
      });

      if (cleared) {
        await this.delay(1000);
        return { success: true, action: "cleared_form" };
      }
    }
    return { success: false, fatal: false };
  }

  async genericRetry(context) {
    // Just wait and signal that retry is possible
    return { success: true, action: "generic_retry" };
  }

  async executeScript(tabId, func, args = []) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func,
        args,
      });
      return results[0]?.result;
    } catch (error) {
      return null;
    }
  }

  // Error type detection methods
  isNetworkError(error) {
    const networkKeywords = [
      "network",
      "fetch",
      "connection",
      "timeout",
      "net::",
      "dns",
    ];
    return networkKeywords.some((keyword) =>
      error.message.toLowerCase().includes(keyword)
    );
  }

  isElementNotFoundError(error) {
    const elementKeywords = [
      "element not found",
      "cannot find element",
      "selector",
      "querySelector",
    ];
    return elementKeywords.some((keyword) =>
      error.message.toLowerCase().includes(keyword)
    );
  }

  isFormError(error) {
    const formKeywords = ["form", "submit", "validation", "required field"];
    return formKeywords.some((keyword) =>
      error.message.toLowerCase().includes(keyword)
    );
  }

  isTimeoutError(error) {
    const timeoutKeywords = ["timeout", "timed out", "time out"];
    return timeoutKeywords.some((keyword) =>
      error.message.toLowerCase().includes(keyword)
    );
  }

  delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  reset() {
    this.errorCounts.clear();
  }

  getErrorStats() {
    const stats = {};
    for (const [errorKey, count] of this.errorCounts.entries()) {
      stats[errorKey] = count;
    }
    return stats;
  }
}
