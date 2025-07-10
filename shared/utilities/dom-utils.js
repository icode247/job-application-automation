// shared/utilities/dom-utils.js
export class DomUtils {
  /**
   * Check if element is visible
   */
  static isElementVisible(element) {
    if (!element) return false;

    try {
      const style = window.getComputedStyle(element);

      if (
        style.display === "none" ||
        style.visibility === "hidden" ||
        style.opacity === "0"
      ) {
        return false;
      }

      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) {
        return false;
      }

      // Check if any parent is hidden
      let parent = element.parentElement;
      while (parent) {
        const parentStyle = window.getComputedStyle(parent);
        if (
          parentStyle.display === "none" ||
          parentStyle.visibility === "hidden" ||
          parentStyle.opacity === "0"
        ) {
          return false;
        }
        parent = parent.parentElement;
      }

      return true;
    } catch (error) {
      return true; // Default to true on error
    }
  }

  /**
   * Scroll element into view
   */
  static scrollToElement(element, options = {}) {
    if (!element) return;

    try {
      const scrollOptions = {
        behavior: "smooth",
        block: "center",
        inline: "nearest",
        ...options,
      };

      element.scrollIntoView(scrollOptions);
    } catch (error) {
      try {
        element.scrollIntoView();
      } catch (e) {
        // Silent fail
      }
    }
  }

  /**
   * Wait for element to appear
   */
  static waitForElement(selector, timeout = 10000) {
    return new Promise((resolve) => {
      const element = document.querySelector(selector);
      if (element) {
        resolve(element);
        return;
      }

      const observer = new MutationObserver((mutations, obs) => {
        const element = document.querySelector(selector);
        if (element) {
          obs.disconnect();
          resolve(element);
        }
      });

      observer.observe(document, {
        childList: true,
        subtree: true,
      });

      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeout);
    });
  }

  /**
   * Get text content from multiple possible selectors
   */
  static extractText(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element.textContent?.trim() || "";
      }
    }
    return "";
  }

  /**
   * Find form by multiple strategies
   */
  static findForm(platformSelectors = []) {
    // Try platform-specific selectors first
    for (const selector of platformSelectors) {
      const forms = document.querySelectorAll(selector);
      for (const form of forms) {
        if (this.isElementVisible(form) && this.isValidForm(form)) {
          return form;
        }
      }
    }

    // Try generic form detection
    const allForms = document.querySelectorAll("form");
    for (const form of allForms) {
      if (this.isElementVisible(form) && this.isValidForm(form)) {
        return form;
      }
    }

    return null;
  }

  /**
   * Check if form is valid (has enough inputs)
   */
  static isValidForm(form) {
    try {
      const inputs = form.querySelectorAll("input, select, textarea");
      const visibleInputs = Array.from(inputs).filter(
        (input) => input.type !== "hidden" && this.isElementVisible(input)
      );
      return visibleInputs.length >= 2;
    } catch (e) {
      return false;
    }
  }
}
