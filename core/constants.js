// core/constants.js
export const PLATFORMS = {
  LINKEDIN: "linkedin",
  INDEED: "indeed",
  RECRUITEE: "recruitee",
  GLASSDOOR: "glassdoor",
  WORKDAY: "workday",
};

export const AUTOMATION_STATUS = {
  CREATED: "created",
  STARTING: "starting",
  RUNNING: "running",
  PAUSED: "paused",
  STOPPED: "stopped",
  COMPLETED: "completed",
  FAILED: "failed",
  INTERRUPTED: "interrupted",
};

export const APPLICATION_STATUS = {
  PENDING: "pending",
  SUBMITTED: "submitted",
  FAILED: "failed",
  SKIPPED: "skipped",
};

export const DELAYS = {
  BETWEEN_APPLICATIONS: { min: 3000, max: 8000 },
  BETWEEN_PAGES: { min: 2000, max: 5000 },
  FORM_FILLING: { min: 500, max: 1500 },
  PAGE_LOAD: { min: 2000, max: 10000 },
};

export const SELECTORS = {
  // Common selectors across platforms
  APPLY_BUTTON: [
    'button[aria-label*="apply" i]',
    'button[class*="apply" i]',
    'a[class*="apply" i]',
    'input[value*="apply" i]',
  ],

  JOB_TITLE: [
    "h1",
    ".job-title",
    '[data-testid="job-title"]',
    ".jobsearch-JobInfoHeader-title",
  ],

  COMPANY_NAME: [
    ".company",
    ".company-name",
    '[data-testid="company-name"]',
    ".jobsearch-InlineCompanyRating",
  ],
};
