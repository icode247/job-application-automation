// services/application-tracker-service.js
import { API_HOST_URL } from "./constants.js";

export default class ApplicationTrackerService {
  constructor(config) {
    this.apiHost = API_HOST_URL;
    this.userId = config.userId
  }

  async checkIfAlreadyApplied(jobId) {
    try {
      const response = await fetch(
        `${this.apiHost}/api/applied-jobs?userId=${this.userId}&jobId=${jobId}`
      );
      if (!response.ok) {
        throw new Error(
          `Failed to check application status: ${response.statusText}`
        );
      }
      const data = await response.json();
      return data.applied;
    } catch (error) {
      console.error("Error checking if job is already applied:", error);
      return false;
    }
  }

  async saveAppliedJob(applicationData) {
    try {
      const payload = {
        userId: this.userId,
        jobId: applicationData.jobId,
        title: applicationData.title,
        company: applicationData.company,
        location: applicationData.location,
        jobUrl: applicationData.jobUrl || window.location.href,
        salary: applicationData.salary || "Not specified",
        workplace: applicationData.workplace,
        postedDate: applicationData.postedDate,
        applicants: applicationData.applicants,
        appliedAt: Date.now(),
        platform: applicationData.platform,
      };

      const response = await fetch(`${this.apiHost}/api/applied-jobs`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        throw new Error(`Failed to save applied job: ${response.statusText}`);
      }

      return true;
    } catch (error) {
      console.error("Error saving applied job:", error);
      return false;
    }
  }

  async updateApplicationCount() {
    try {
      const response = await fetch(`${this.apiHost}/api/applications`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          userId: this.userId,
        }),
      });

      if (!response.ok) {
        throw new Error(
          `Failed to update application count: ${response.statusText}`
        );
      }

      return true;
    } catch (error) {
      console.error("Error updating application count:", error);
      return false;
    }
  }

  async getApplicationStats() {
    try {
      const response = await fetch(
        `${this.apiHost}/api/applications/stats?userId=${this.userId}`
      );
      if (!response.ok) {
        throw new Error(
          `Failed to get application stats: ${response.statusText}`
        );
      }
      return await response.json();
    } catch (error) {
      console.error("Error getting application stats:", error);
      return null;
    }
  }
}
