// Production configuration (config/production.js)
export const PRODUCTION_CONFIG = {
  // Extension settings
  extensionId: "your-production-extension-id",

  // API endpoints
  apiBaseUrl: "https://fastapply.co",
  webhookUrl: "https://fastapply.co/automation/webhook",

  // Rate limiting
  requestDelay: { min: 3000, max: 8000 },
  maxConcurrentSessions: 1,
  maxApplicationsPerSession: 100,

  // Error handling
  maxRetries: 3,
  retryDelay: 5000,

  // Platform-specific settings
  platforms: {
    linkedin: {
      enabled: true,
      maxApplicationsPerDay: 50,
      easyApplyOnly: true,
    },
    indeed: {
      enabled: true,
      maxApplicationsPerDay: 30,
      skipExternalSites: false,
    },
    glassdoor: {
      enabled: true,
      maxApplicationsPerDay: 25,
      easyApplyOnly: true,
    },
    recruitee: {
      enabled: true,
      maxApplicationsPerDay: 20,
      searchQuery: "software engineer",
    },
    workday: {
      enabled: true,
      maxApplicationsPerDay: 15,
      searchQuery: "software engineer",
    },
  },

  // Monitoring
  healthCheckInterval: 60000, // 1 minute
  progressReportInterval: 5000, // 5 seconds

  // Security
  enableAntiDetection: true,
  randomizeTimings: true,
  humanLikeDelays: true,
};
