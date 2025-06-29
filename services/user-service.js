// services/user-service.js
export default class UserService {
  constructor(config) {
    this.apiHost = config.apiHost || "https://api.yourdomain.com";
    this.userId = config.userId;
    this.userDetailsCache = null;
  }

  async fetchUserDetails() {
    try {
      const response = await fetch(`${this.apiHost}/api/user/${this.userId}`);
      if (!response.ok) throw new Error("Failed to fetch user details");

      const data = await response.json();

      // Cache user details locally
      this.userDetailsCache = data;
      await chrome.storage.local.set({ userDetails: data });

      return data;
    } catch (error) {
      console.error("Error fetching user details:", error);
      throw error;
    }
  }

  async getUserDetails() {
    // Try cache first
    if (this.userDetailsCache) {
      return this.userDetailsCache;
    }

    // Try chrome storage
    try {
      const result = await chrome.storage.local.get(["userDetails"]);
      if (result.userDetails) {
        this.userDetailsCache = result.userDetails;
        return result.userDetails;
      }
    } catch (error) {
      console.error("Error getting cached user details:", error);
    }

    // Fetch from API as fallback
    return await this.fetchUserDetails();
  }

  async updateUserPreferences(preferences) {
    try {
      const response = await fetch(
        `${this.apiHost}/api/user/${this.userId}/preferences`,
        {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(preferences),
        }
      );

      if (!response.ok) throw new Error("Failed to update user preferences");

      // Update cache
      if (this.userDetailsCache) {
        this.userDetailsCache.jobPreferences = preferences;
        await chrome.storage.local.set({ userDetails: this.userDetailsCache });
      }

      return true;
    } catch (error) {
      console.error("Error updating user preferences:", error);
      return false;
    }
  }

  async checkUserRole() {
    try {
      const response = await fetch(
        `${this.apiHost}/api/user/${this.userId}/role`
      );
      if (!response.ok) throw new Error("Failed to check user role");

      const data = await response.json();
      return data;
    } catch (error) {
      console.error("Error checking user role:", error);
      throw error;
    }
  }

  async canApplyMore() {
    try {
      const response = await fetch(
        `${this.apiHost}/api/user/${this.userId}/can-apply`
      );
      if (!response.ok)
        throw new Error("Failed to check application eligibility");

      const data = await response.json();
      return data.canApply;
    } catch (error) {
      console.error("Error checking application eligibility:", error);
      return false;
    }
  }

  async getRemainingApplications() {
    try {
      const response = await fetch(
        `${this.apiHost}/api/user/${this.userId}/remaining-applications`
      );
      if (!response.ok) throw new Error("Failed to get remaining applications");

      const data = await response.json();
      return data.remaining;
    } catch (error) {
      console.error("Error getting remaining applications:", error);
      return 0;
    }
  }

  clearCache() {
    this.userDetailsCache = null;
  }
}
