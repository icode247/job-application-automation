// shared/utilities/url-utils.js
//getPlatformDomains
export class UrlUtils {
  /**
   * Normalize URL for consistent comparison
   */
  static normalizeUrl(url) {
    try {
      if (!url) return "";

      if (!url.startsWith("http")) {
        url = "https://" + url;
      }

      const urlObj = new URL(url);
      return (urlObj.origin + urlObj.pathname)
        .toLowerCase()
        .trim()
        .replace(/\/+$/, "");
    } catch (e) {
      return url.toLowerCase().trim();
    }
  }

  /**
   * Extract job ID from URL based on platform
   */
  static extractJobId(url, platform) {
    try {
      switch (platform) {
        case "lever":
          // Lever format: jobs.lever.co/company/[JOB_ID]
          const leverMatches = url.match(/\/([a-f0-9-]{36})\/?$/);
          return leverMatches && leverMatches[1]
            ? leverMatches[1]
            : `job-${Date.now()}`;

        case "recruitee":
          // Recruitee format: company.recruitee.com/o/[JOB_ID]
          const urlParts = url.split("/");
          return urlParts[urlParts.length - 1] || `job-${Date.now()}`;

        case "breezy":
          // Breezy format: company.breezy.hr/p/[JOB_ID] or app.breezy.hr/jobs/[JOB_ID]
          const breezyMatches = url.match(/\/p\/([^\/]+)|\/jobs\/([^\/]+)/);
          return breezyMatches && (breezyMatches[1] || breezyMatches[2])
            ? breezyMatches[1] || breezyMatches[2]
            : `job-${Date.now()}`;

        case "ashby":
          // Ashby format: jobs.ashbyhq.com/company/job-id or company.ashbyhq.com/job-id
          const ashbyMatches = url.match(/\/([a-f0-9-]{8,})\/?$/);
          return ashbyMatches && ashbyMatches[1]
            ? ashbyMatches[1]
            : `job-${Date.now()}`;
        default:
          return `job-${Date.now()}`;
      }
    } catch (error) {
      return `job-${Date.now()}`;
    }
  }

  /**
   * Extract company name from URL based on platform
   */
  static extractCompanyFromUrl(url, platform) {
    try {
      switch (platform) {
        case "lever":
          // Pattern: https://jobs.lever.co/[COMPANY]/...
          const leverMatches = url.match(/\/\/jobs\.lever\.co\/([^\/]+)/);
          if (leverMatches && leverMatches[1]) {
            return (
              leverMatches[1].charAt(0).toUpperCase() + leverMatches[1].slice(1)
            );
          }
          break;

        case "recruitee":
          // Pattern: https://[COMPANY].recruitee.com/...
          const recruiteeMatches = url.match(/\/\/(.+?)\.recruitee\.com\//);
          if (recruiteeMatches && recruiteeMatches[1]) {
            return (
              recruiteeMatches[1].charAt(0).toUpperCase() +
              recruiteeMatches[1].slice(1).replace(/-/g, " ")
            );
          }
          break;
        case "breezy":
          // Pattern: https://[COMPANY].breezy.hr/p/... or https://app.breezy.hr/jobs/[COMPANY]/...
          let breezyMatches = url.match(/\/\/(.+?)\.breezy\.hr\/p\//);
          if (breezyMatches && breezyMatches[1]) {
            return (
              breezyMatches[1].charAt(0).toUpperCase() +
              breezyMatches[1].slice(1).replace(/-/g, " ")
            );
          }

          // Try app.breezy.hr format
          breezyMatches = url.match(/\/\/app\.breezy\.hr\/jobs\/([^\/]+)/);
          if (breezyMatches && breezyMatches[1]) {
            return (
              breezyMatches[1].charAt(0).toUpperCase() +
              breezyMatches[1].slice(1).replace(/-/g, " ")
            );
          }
          break;

        case "ashby":
          // Pattern: https://jobs.ashbyhq.com/[COMPANY]/... or https://[COMPANY].ashbyhq.com/...
          let ashbyMatches = url.match(/\/\/jobs\.ashbyhq\.com\/([^\/]+)/);
          if (ashbyMatches && ashbyMatches[1]) {
            return (
              ashbyMatches[1].charAt(0).toUpperCase() +
              ashbyMatches[1].slice(1).replace(/-/g, " ")
            );
          }

          // Try company.ashbyhq.com format
          ashbyMatches = url.match(/\/\/(.+?)\.ashbyhq\.com\//);
          if (ashbyMatches && ashbyMatches[1] && ashbyMatches[1] !== "jobs") {
            return (
              ashbyMatches[1].charAt(0).toUpperCase() +
              ashbyMatches[1].slice(1).replace(/-/g, " ")
            );
          }
          break;
      }

      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Check if URL matches platform pattern
   */
  static matchesPlatformPattern(url, platform) {
    switch (platform) {
      case "lever":
        return /^https:\/\/jobs\.(eu\.)?lever\.co\/[^\/]+\/[^\/]+/.test(url);
      case "recruitee":
        return /recruitee\.com\/(o|career)\//.test(url);
      case "breezy":
        return /^https:\/\/([\w-]+\.breezy\.hr\/p\/|app\.breezy\.hr\/jobs\/)([^\/]+)/.test(
          url
        );
      case "ashby":
        return /^https:\/\/(jobs\.ashbyhq\.com\/[^\/]+\/[^\/]+|[^\/]+\.ashbyhq\.com\/[^\/]+)/.test(
          url
        );
      default:
        return false;
    }
  }

  /**
   * Get search link pattern for platform
   */
  static getSearchLinkPattern(platform) {
    switch (platform) {
      case "lever":
        return /^https:\/\/jobs\.(eu\.)?lever\.co\/([^\/]*)\/([^\/]*)\/?(.*)?$/;
      case "recruitee":
        return /^https:\/\/.*\.recruitee\.com\/(o|career)\/([^\/]+)\/?.*$/;

      case "breezy":
        return /^https:\/\/([\w-]+\.breezy\.hr\/p\/|app\.breezy\.hr\/jobs\/)([^\/]+)\/?.*$/;

      case "ashby":
        return /^https:\/\/(jobs\.ashbyhq\.com\/[^\/]+\/[^\/]+|[^\/]+\.ashbyhq\.com\/[^\/]+)\/?.*$/;
      default:
        return null;
    }
  }

  /**
   * Get platform domains
   */
  static getPlatformDomains(platform) {
    switch (platform) {
      case "lever":
        return ["https://jobs.lever.co"];
      case "recruitee":
        return ["recruitee.com"];
      case "breezy":
        return ["breezy.hr", "app.breezy.hr"];
      case "ashby":
        return ["ashbyhq.com", "jobs.ashbyhq.com"];
      default:
        return [];
    }
  }
}
