// core/utils.js
export default class Utils {
  // Delay utilities
  static delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  static randomDelay(min, max) {
    const delay = Math.floor(Math.random() * (max - min + 1)) + min;
    return this.delay(delay);
  }

  // DOM utilities
  static async waitForElement(selector, timeout = 10000, interval = 500) {
    return new Promise((resolve) => {
      const startTime = Date.now();

      const checkElement = () => {
        const element = document.querySelector(selector);
        if (element) {
          resolve(element);
          return;
        }

        if (Date.now() - startTime >= timeout) {
          resolve(null);
          return;
        }

        setTimeout(checkElement, interval);
      };

      checkElement();
    });
  }

  static async waitForElements(selector, minCount = 1, timeout = 10000) {
    return new Promise((resolve) => {
      const startTime = Date.now();

      const checkElements = () => {
        const elements = document.querySelectorAll(selector);
        if (elements.length >= minCount) {
          resolve(Array.from(elements));
          return;
        }

        if (Date.now() - startTime >= timeout) {
          resolve([]);
          return;
        }

        setTimeout(checkElements, 500);
      };

      checkElements();
    });
  }

  static scrollIntoView(element, options = {}) {
    const defaultOptions = {
      behavior: "smooth",
      block: "center",
      inline: "nearest",
    };

    element.scrollIntoView({ ...defaultOptions, ...options });
  }

  // String utilities
  static normalizeString(str) {
    return str?.toLowerCase().trim().replace(/\s+/g, " ") || "";
  }

  static extractCompanyName(text) {
    // Common patterns for company names
    const patterns = [
      /at\s+(.+?)(?:\s*-|\s*\||\s*\n|$)/i,
      /(.+?)\s*-\s*.+/i,
      /^(.+?)(?:\s*\||$)/i,
    ];

    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match && match[1]) {
        return match[1].trim();
      }
    }

    return text.trim();
  }

  static extractJobTitle(text) {
    // Remove common suffixes and clean up
    const cleanText = text
      .replace(/\s*-\s*.*$/, "") // Remove everything after dash
      .replace(/\s*\|.*$/, "") // Remove everything after pipe
      .replace(/\s*at\s+.*$/i, "") // Remove "at Company"
      .trim();

    return cleanText;
  }

  static extractLocation(text) {
    // Common location patterns
    const locationPatterns = [
      /([^,]+,\s*[A-Z]{2}(?:\s+\d{5})?)/i, // City, State ZIP
      /([^,]+,\s*[A-Z]{2})/i, // City, State
      /([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,?\s*[A-Z]{2,})/i, // City State/Country
    ];

    for (const pattern of locationPatterns) {
      const match = text.match(pattern);
      if (match) {
        return match[1].trim();
      }
    }

    return text.trim();
  }

  // URL utilities
  static isValidUrl(string) {
    try {
      new URL(string);
      return true;
    } catch (_) {
      return false;
    }
  }

  static extractDomainFromUrl(url) {
    try {
      return new URL(url).hostname;
    } catch (_) {
      return null;
    }
  }

  static normalizeUrl(url) {
    try {
      const urlObj = new URL(url);
      // Remove tracking parameters
      const trackingParams = [
        "utm_source",
        "utm_medium",
        "utm_campaign",
        "utm_term",
        "utm_content",
        "gclid",
        "fbclid",
        "ref",
        "referer",
        "source",
      ];

      trackingParams.forEach((param) => {
        urlObj.searchParams.delete(param);
      });

      return urlObj.toString();
    } catch (_) {
      return url;
    }
  }

  // Form utilities
  static triggerInputEvents(element, value) {
    element.focus();
    element.value = value;

    // Trigger multiple events to ensure detection
    const events = ["input", "change", "blur", "keyup"];
    events.forEach((eventType) => {
      element.dispatchEvent(new Event(eventType, { bubbles: true }));
    });
  }

  static findFormField(keywords, context = document) {
    const inputs = context.querySelectorAll("input, textarea, select");

    for (const input of inputs) {
      const fieldText = [
        input.name,
        input.id,
        input.placeholder,
        input.getAttribute("aria-label"),
        input.closest("label")?.textContent,
      ]
        .join(" ")
        .toLowerCase();

      for (const keyword of keywords) {
        if (fieldText.includes(keyword.toLowerCase())) {
          return input;
        }
      }
    }

    return null;
  }

  // Date utilities
  static formatDate(date, format = "YYYY-MM-DD") {
    const d = new Date(date);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    const hours = String(d.getHours()).padStart(2, "0");
    const minutes = String(d.getMinutes()).padStart(2, "0");
    const seconds = String(d.getSeconds()).padStart(2, "0");

    return format
      .replace("YYYY", year)
      .replace("MM", month)
      .replace("DD", day)
      .replace("HH", hours)
      .replace("mm", minutes)
      .replace("ss", seconds);
  }

  static getTimeAgo(timestamp) {
    const now = Date.now();
    const diff = now - timestamp;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days} day${days > 1 ? "s" : ""} ago`;
    if (hours > 0) return `${hours} hour${hours > 1 ? "s" : ""} ago`;
    if (minutes > 0) return `${minutes} minute${minutes > 1 ? "s" : ""} ago`;
    return "Just now";
  }

  // Storage utilities
  static async setStorageData(key, data) {
    try {
      await chrome.storage.local.set({ [key]: data });
      return true;
    } catch (error) {
      console.error(`Failed to save data to storage: ${key}`, error);
      return false;
    }
  }

  static async getStorageData(key, defaultValue = null) {
    try {
      const result = await chrome.storage.local.get(key);
      return result[key] !== undefined ? result[key] : defaultValue;
    } catch (error) {
      console.error(`Failed to get data from storage: ${key}`, error);
      return defaultValue;
    }
  }

  static async removeStorageData(key) {
    try {
      await chrome.storage.local.remove(key);
      return true;
    } catch (error) {
      console.error(`Failed to remove data from storage: ${key}`, error);
      return false;
    }
  }

  // Validation utilities
  static isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  static isValidPhoneNumber(phone) {
    // Remove all non-digits
    const digits = phone.replace(/\D/g, "");
    // Check if it's a valid length (10-15 digits)
    return digits.length >= 10 && digits.length <= 15;
  }

  static isValidLinkedInUrl(url) {
    return (
      url.includes("linkedin.com/in/") || url.includes("linkedin.com/pub/")
    );
  }

  // Platform detection utilities
  detectPlatformFromUrl() {
    const url = window.location.href.toLowerCase();

    if (url.includes("linkedin.com")) return "linkedin";
    if (url.includes("indeed.com")) return "indeed";
    if (url.includes("recruitee.com")) return "recruitee";
    if (url.includes("glassdoor.com")) return "glassdoor";
    if (url.includes("myworkdayjobs.com")) return "workday";
    if (url.includes("lever.co")) return "lever";
    if (url.includes("greenhouse.io")) return "greenhouse";

    // Handle Google search for specific platforms
    if (url.includes("google.com/search")) {
      if (url.includes("site:recruitee.com") || url.includes("recruitee.com"))
        return "recruitee";
      if (
        url.includes("site:myworkdayjobs.com") ||
        url.includes("myworkdayjobs.com")
      )
        return "workday";
      if (url.includes("site:lever.co") || url.includes("lever.co"))
        return "lever";
    }

    return "unknown";
  }

  static isJobBoardUrl(url) {
    const jobBoards = [
      "linkedin.com",
      "indeed.com",
      "glassdoor.com",
      "recruitee.com",
      "myworkdayjobs.com",
      "lever.co",
      "greenhouse.io",
      "jobvite.com",
      "smartrecruiters.com",
      "workable.com",
      "breezy.hr",
    ];

    const hostname = this.extractDomainFromUrl(url)?.toLowerCase();
    return jobBoards.some((board) => hostname?.includes(board));
  }

  // Error utilities
  static createError(message, code, context = {}) {
    const error = new Error(message);
    error.code = code;
    error.context = context;
    error.timestamp = Date.now();
    return error;
  }

  static isNetworkError(error) {
    const networkErrors = [
      "Failed to fetch",
      "Network request failed",
      "ERR_NETWORK",
      "ERR_INTERNET_DISCONNECTED",
      "ERR_CONNECTION_REFUSED",
    ];

    return networkErrors.some((networkError) =>
      error.message?.includes(networkError)
    );
  }

  static isTimeoutError(error) {
    const timeoutKeywords = ["timeout", "timed out", "time out"];
    return timeoutKeywords.some((keyword) =>
      error.message?.toLowerCase().includes(keyword)
    );
  }

  // Performance utilities
  static measurePerformance(name, fn) {
    return async (...args) => {
      const start = performance.now();
      try {
        const result = await fn(...args);
        const end = performance.now();
        console.log(`⏱️ ${name} took ${(end - start).toFixed(2)}ms`);
        return result;
      } catch (error) {
        const end = performance.now();
        console.error(
          `❌ ${name} failed after ${(end - start).toFixed(2)}ms:`,
          error
        );
        throw error;
      }
    };
  }

  static throttle(func, delay) {
    let timeoutId;
    let lastExecTime = 0;

    return function (...args) {
      const currentTime = Date.now();

      if (currentTime - lastExecTime > delay) {
        func.apply(this, args);
        lastExecTime = currentTime;
      } else {
        clearTimeout(timeoutId);
        timeoutId = setTimeout(() => {
          func.apply(this, args);
          lastExecTime = Date.now();
        }, delay - (currentTime - lastExecTime));
      }
    };
  }

  static debounce(func, delay) {
    let timeoutId;

    return function (...args) {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        func.apply(this, args);
      }, delay);
    };
  }

  // Array utilities
  static chunk(array, size) {
    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  static unique(array, key = null) {
    if (key) {
      const seen = new Set();
      return array.filter((item) => {
        const value = typeof key === "function" ? key(item) : item[key];
        if (seen.has(value)) {
          return false;
        }
        seen.add(value);
        return true;
      });
    }
    return [...new Set(array)];
  }

  static shuffle(array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  // Object utilities
  static deepMerge(target, source) {
    const result = { ...target };

    for (const key in source) {
      if (
        source[key] &&
        typeof source[key] === "object" &&
        !Array.isArray(source[key])
      ) {
        result[key] = this.deepMerge(result[key] || {}, source[key]);
      } else {
        result[key] = source[key];
      }
    }

    return result;
  }

  static pickProperties(obj, keys) {
    const result = {};
    for (const key of keys) {
      if (key in obj) {
        result[key] = obj[key];
      }
    }
    return result;
  }

  static omitProperties(obj, keys) {
    const result = { ...obj };
    for (const key of keys) {
      delete result[key];
    }
    return result;
  }

  // Crypto utilities (for generating IDs)
  static generateId(prefix = "", length = 8) {
    const chars =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    let result = prefix;

    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return result;
  }

  static generateSessionId() {
    return `session_${Date.now().toString(36)}_${this.generateId("", 6)}`;
  }

  static generateApplicationId() {
    return `app_${Date.now().toString(36)}_${this.generateId("", 4)}`;
  }

  // Browser utilities
  static getUserAgent() {
    return navigator.userAgent;
  }

  static getBrowserInfo() {
    const ua = navigator.userAgent;
    let browserName = "Unknown";
    let browserVersion = "Unknown";

    if (ua.includes("Chrome/")) {
      browserName = "Chrome";
      browserVersion = ua.match(/Chrome\/([0-9.]+)/)?.[1] || "Unknown";
    } else if (ua.includes("Firefox/")) {
      browserName = "Firefox";
      browserVersion = ua.match(/Firefox\/([0-9.]+)/)?.[1] || "Unknown";
    } else if (ua.includes("Safari/")) {
      browserName = "Safari";
      browserVersion = ua.match(/Version\/([0-9.]+)/)?.[1] || "Unknown";
    }

    return { browserName, browserVersion };
  }

  static getScreenInfo() {
    return {
      width: screen.width,
      height: screen.height,
      availWidth: screen.availWidth,
      availHeight: screen.availHeight,
      colorDepth: screen.colorDepth,
      pixelDepth: screen.pixelDepth,
    };
  }

  // Memory utilities
  static getMemoryUsage() {
    if ("memory" in performance) {
      return {
        usedJSHeapSize: performance.memory.usedJSHeapSize,
        totalJSHeapSize: performance.memory.totalJSHeapSize,
        jsHeapSizeLimit: performance.memory.jsHeapSizeLimit,
        percentUsed: (
          (performance.memory.usedJSHeapSize /
            performance.memory.jsHeapSizeLimit) *
          100
        ).toFixed(2),
      };
    }
    return null;
  }

  // Platform-specific utilities
  static getLinkedInJobId(url) {
    const match = url.match(/jobs\/view\/(\d+)/);
    return match ? match[1] : null;
  }

  static getIndeedJobKey(url) {
    const match = url.match(/jk=([a-f0-9]+)/);
    return match ? match[1] : null;
  }

  static formatSalary(salary) {
    if (typeof salary === "number") {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        minimumFractionDigits: 0,
      }).format(salary);
    }
    return salary;
  }

  // Export utilities
  static downloadJSON(data, filename) {
    const blob = new Blob([JSON.stringify(data, null, 2)], {
      type: "application/json",
    });
    this.downloadBlob(blob, filename);
  }

  static downloadCSV(data, filename) {
    const blob = new Blob([data], { type: "text/csv" });
    this.downloadBlob(blob, filename);
  }

  static downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  getUserDetailsForContext(userData) {
    const userDataForContext = {
      firstName: userData.firstName,
      lastName: userData.lastName,
      email: userData.email,
      phoneNumber: userData.phoneNumber,
      phoneCountryCode: userData.phoneCountryCode,
      country: userData.country,
      jobPreferences: userData.jobPreferences,
      cv: userData.cv,
      currentCompany: userData.currentCompany,
      yearsOfExperience: userData.yearsOfExperience,
      fullPosition: userData.fullPosition,
      linkedIn: userData.linkedIn,
      website: userData.website,
      github: userData.github,
      coverLetter: userData.coverLetter,
      currentCity: userData.currentCity,
      streetAddress: userData.streetAddress,
      desiredSalary: userData.desiredSalary,
      noticePeriod: userData.noticePeriod,
      education: userData.education,
      educationEndMonth: userData.educationEndMonth,
      educationEndYear: userData.educationEndYear,
      educationStartMonth: userData.educationStartMonth,
      educationStartYear: userData.educationStartYear,
      headline: userData.headline,
      summary: userData.summary,
      age: userData.age,
      race: userData.race,
      gender: userData.gender,
      needsSponsorship: userData.needsSponsorship,
      disabilityStatus: userData.disabilityStatus,
      veteranStatus: userData.veteranStatus,
      usCitizenship: userData.usCitizenship,
      parsedResumeText: userData.parsedResumeText,
      projects: userData.projects,
      skills: userData.skills,
      linkedinProfileUrl: userData.linkedinProfileUrl,
      extractedCertifications: userData.extractedCertifications,
      extractedSkills: userData.extractedSkills,
      extractedProjects: userData.extractedProjects,
      extractedExperience: userData.extractedExperience,
      githubURL: userData.githubURL,
    };
    return userDataForContext;
  }

  checkIfAlreadyAppliedToJob(jobId) {
    return this.applicationState.appliedJobs.has(jobId);
  }
}
