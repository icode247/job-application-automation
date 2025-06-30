// services/user-service.js

import { PLAN_LIMITS, API_HOST_URL } from "./constants.js";

export default class UserService {
  constructor(config) {
    this.apiHost = API_HOST_URL;
    this.userId = config.userId;
    this.userDetailsCache = null;
    this.PLAN_LIMITS = PLAN_LIMITS;
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
      if (!response.ok) throw new Error("Failed to fetch user role");

      const data = await response.json();

      // Calculate application limit based on plan (matching your logic)
      let applicationLimit;
      switch (data.userRole) {
        case "starter":
          applicationLimit = this.PLAN_LIMITS.STARTER;
          break;
        case "pro":
          applicationLimit = this.PLAN_LIMITS.PRO;
          break;
        case "unlimited":
          applicationLimit = this.PLAN_LIMITS.UNLIMITED;
          break;
        case "credit":
          applicationLimit = Math.floor(data.credits / 1);
          break;
        default:
          applicationLimit = this.PLAN_LIMITS.FREE;
      }

      // Update local storage with user state
      const userState = {
        userRole: data.userRole,
        applicationLimit,
        credits: data.credits || 0,
        subscription: data.subscription,
        applicationsUsed: data.applicationsUsed || 0,
      };

      await chrome.storage.local.set({ userState });
      return userState;
    } catch (error) {
      console.error("Error checking user role:", error);
      throw error;
    }
  }

  async canApplyMore() {
    try {
      // Get current user state
      const state = await this.getUserState();
      if (!state || !state.userRole) return false;

      // Check subscription expiration
      if (state.subscription) {
        const subscriptionEnd = new Date(state.subscription.currentPeriodEnd);
        if (subscriptionEnd < new Date()) {
          return false;
        }
      }

      // Check eligibility based on user role (matching your logic)
      switch (state.userRole) {
        case "unlimited":
          return true;

        case "starter":
          return state.applicationsUsed < this.PLAN_LIMITS.STARTER;

        case "pro":
          return state.applicationsUsed < this.PLAN_LIMITS.PRO;

        case "credit":
          return state.credits >= 1;

        case "free":
          return state.applicationsUsed < this.PLAN_LIMITS.FREE;

        default:
          return false;
      }
    } catch (error) {
      console.error("Error checking application eligibility:", error);
      return false;
    }
  }

  async getRemainingApplications() {
    try {
      // Get current user state
      const state = await this.getUserState();
      if (!state || !state.userRole) return 0;

      // Calculate remaining applications (matching your logic)
      switch (state.userRole) {
        case "unlimited":
          return Infinity;

        case "starter":
          return this.PLAN_LIMITS.STARTER - (state.applicationsUsed || 0);

        case "pro":
          return this.PLAN_LIMITS.PRO - (state.applicationsUsed || 0);

        case "credit":
          return Math.floor(state.credits / 1);

        case "free":
          return this.PLAN_LIMITS.FREE - (state.applicationsUsed || 0);

        default:
          return 0;
      }
    } catch (error) {
      console.error("Error getting remaining applications:", error);
      return 0;
    }
  }

  async getUserState() {
    try {
      // Try to get cached state first
      const result = await chrome.storage.local.get(["userState"]);

      if (result.userState) {
        return result.userState;
      }

      // If no cached state, fetch fresh from API
      return await this.checkUserRole();
    } catch (error) {
      console.error("Error getting user state:", error);
      return null;
    }
  }

  async updateApplicationCount() {
    try {
      // Call API to increment application count
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

      // Update local state
      const state = await this.getUserState();
      if (state) {
        state.applicationsUsed = (state.applicationsUsed || 0) + 1;

        // Decrease credits for credit-based users
        if (state.userRole === "credit") {
          state.credits = Math.max(0, (state.credits || 0) - 1);
        }

        await chrome.storage.local.set({ userState: state });
      }

      return true;
    } catch (error) {
      console.error("Error updating application count:", error);
      return false;
    }
  }

  clearCache() {
    this.userDetailsCache = null;
  }
}
