// data/application-tracker.js
export default class ApplicationTracker {
  constructor() {
    this.applications = new Map();
    this.storageKey = "trackedApplications";
    this.maxApplications = 10000;
  }

  async initialize() {
    await this.loadApplications();
    console.log("📊 Application tracker initialized");
  }

  async loadApplications() {
    try {
      const result = await chrome.storage.local.get(this.storageKey);
      if (result[this.storageKey]) {
        const applicationsArray = result[this.storageKey];
        for (const app of applicationsArray) {
          this.applications.set(app.id, app);
        }
      }
    } catch (error) {
      console.error("Error loading applications:", error);
    }
  }

  async saveApplications() {
    try {
      const applicationsArray = Array.from(this.applications.values());
      // Keep only recent applications to avoid storage limits
      const recentApplications = applicationsArray
        .sort((a, b) => b.appliedAt - a.appliedAt)
        .slice(0, this.maxApplications);

      await chrome.storage.local.set({
        [this.storageKey]: recentApplications,
      });
    } catch (error) {
      console.error("Error saving applications:", error);
    }
  }

  async trackApplication(applicationData) {
    const application = {
      id: this.generateApplicationId(),
      ...applicationData,
      appliedAt: Date.now(),
      status: "submitted",
    };

    this.applications.set(application.id, application);
    await this.saveApplications();

    console.log(
      `📝 Tracked application: ${application.jobTitle} at ${application.company}`
    );
    return application.id;
  }

  async updateApplicationStatus(applicationId, status, notes = "") {
    const application = this.applications.get(applicationId);
    if (application) {
      application.status = status;
      application.lastUpdated = Date.now();
      if (notes) application.notes = notes;

      await this.saveApplications();
      return true;
    }
    return false;
  }

  getApplicationsBySession(sessionId) {
    return Array.from(this.applications.values()).filter(
      (app) => app.sessionId === sessionId
    );
  }

  getApplicationsByPlatform(platform) {
    return Array.from(this.applications.values()).filter(
      (app) => app.platform === platform
    );
  }

  getApplicationsByDateRange(startDate, endDate) {
    return Array.from(this.applications.values()).filter(
      (app) => app.appliedAt >= startDate && app.appliedAt <= endDate
    );
  }

  getApplicationStats(timeframe = "all") {
    const applications = Array.from(this.applications.values());
    let filteredApps = applications;

    // Apply timeframe filter
    if (timeframe !== "all") {
      const now = Date.now();
      const timeframes = {
        today: 24 * 60 * 60 * 1000,
        week: 7 * 24 * 60 * 60 * 1000,
        month: 30 * 24 * 60 * 60 * 1000,
      };

      const cutoff = now - timeframes[timeframe];
      filteredApps = applications.filter((app) => app.appliedAt >= cutoff);
    }

    const stats = {
      total: filteredApps.length,
      byPlatform: {},
      byStatus: {},
      successRate: 0,
      averagePerDay: 0,
    };

    // Calculate platform distribution
    filteredApps.forEach((app) => {
      stats.byPlatform[app.platform] =
        (stats.byPlatform[app.platform] || 0) + 1;
      stats.byStatus[app.status] = (stats.byStatus[app.status] || 0) + 1;
    });

    // Calculate success rate (interviews + offers / total)
    const successful =
      (stats.byStatus.interview || 0) + (stats.byStatus.offer || 0);
    stats.successRate =
      stats.total > 0 ? ((successful / stats.total) * 100).toFixed(1) : 0;

    // Calculate average per day
    if (filteredApps.length > 0) {
      const oldestApp = Math.min(...filteredApps.map((app) => app.appliedAt));
      const daysDiff = Math.max(
        1,
        Math.ceil((Date.now() - oldestApp) / (24 * 60 * 60 * 1000))
      );
      stats.averagePerDay = (filteredApps.length / daysDiff).toFixed(1);
    }

    return stats;
  }

  isAlreadyApplied(jobUrl, companyName) {
    return Array.from(this.applications.values()).some(
      (app) =>
        app.jobUrl === jobUrl ||
        (app.company.toLowerCase() === companyName.toLowerCase() &&
          Math.abs(app.appliedAt - Date.now()) < 24 * 60 * 60 * 1000) // Same company within 24 hours
    );
  }

  generateApplicationId() {
    return (
      "app_" +
      Date.now().toString(36) +
      "_" +
      Math.random().toString(36).substr(2, 9)
    );
  }

  async exportApplications(format = "json") {
    const applications = Array.from(this.applications.values());

    switch (format) {
      case "csv":
        return this.exportToCSV(applications);
      case "json":
        return this.exportToJSON(applications);
      default:
        throw new Error("Unsupported export format");
    }
  }

  exportToJSON(applications) {
    return JSON.stringify(applications, null, 2);
  }

  exportToCSV(applications) {
    if (applications.length === 0) return "";

    const headers = [
      "Applied Date",
      "Job Title",
      "Company",
      "Platform",
      "Location",
      "Status",
      "Job URL",
      "Session ID",
    ];

    const csvRows = [headers.join(",")];

    applications.forEach((app) => {
      const row = [
        new Date(app.appliedAt).toLocaleDateString(),
        `"${app.jobTitle || ""}"`,
        `"${app.company || ""}"`,
        app.platform || "",
        `"${app.location || ""}"`,
        app.status || "",
        `"${app.jobUrl || ""}"`,
        app.sessionId || "",
      ];
      csvRows.push(row.join(","));
    });

    return csvRows.join("\n");
  }

  async cleanupOldApplications(maxAge = 90 * 24 * 60 * 60 * 1000) {
    // 90 days
    const cutoff = Date.now() - maxAge;
    let cleaned = 0;

    for (const [id, app] of this.applications.entries()) {
      if (app.appliedAt < cutoff) {
        this.applications.delete(id);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      await this.saveApplications();
      console.log(`🧹 Cleaned up ${cleaned} old applications`);
    }

    return cleaned;
  }
}
