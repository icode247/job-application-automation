// services/state-manager-service.js
export default class StateManagerService {
  constructor(config = {}) {
    this.storageKey = config.storageKey || 'automationState';
    this.sessionId = config.sessionId;
    this.state = null;
  }

  async getState() {
    if (this.state) {
      return this.state;
    }

    try {
      const result = await chrome.storage.local.get(this.storageKey);
      this.state = result[this.storageKey] || null;
      return this.state;
    } catch (error) {
      console.error('Error getting state:', error);
      return null;
    }
  }

  async saveState(state) {
    try {
      this.state = state;
      await chrome.storage.local.set({
        [this.storageKey]: state
      });
      return true;
    } catch (error) {
      console.error('Error saving state:', error);
      return false;
    }
  }

  async updateState(updates) {
    try {
      const currentState = await this.getState();
      const newState = {
        ...currentState,
        ...updates,
        updatedAt: Date.now()
      };

      return await this.saveState(newState);
    } catch (error) {
      console.error('Error updating state:', error);
      return false;
    }
  }

  async initializeState(initialState = {}) {
    const existingState = await this.getState();
    
    if (!existingState) {
      const defaultState = {
        userId: null,
        userRole: null,
        applicationLimit: 0,
        applicationsUsed: 0,
        availableCredits: 0,
        preferences: {},
        jobQueue: [],
        isProcessing: false,
        sessionId: this.sessionId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        ...initialState
      };

      await this.saveState(defaultState);
      return defaultState;
    }

    return existingState;
  }

  async clearState() {
    try {
      this.state = null;
      await chrome.storage.local.remove(this.storageKey);
      return true;
    } catch (error) {
      console.error('Error clearing state:', error);
      return false;
    }
  }

  async incrementApplicationsUsed() {
    const currentState = await this.getState();
    if (currentState) {
      return await this.updateState({
        applicationsUsed: (currentState.applicationsUsed || 0) + 1
      });
    }
    return false;
  }

  async decrementAvailableCredits() {
    const currentState = await this.getState();
    if (currentState && currentState.availableCredits > 0) {
      return await this.updateState({
        availableCredits: currentState.availableCredits - 1
      });
    }
    return false;
  }

  async canApplyMore() {
    const state = await this.getState();
    if (!state) return false;

    // Check based on user role
    if (state.userRole === 'free') {
      return state.applicationsUsed < (state.applicationLimit || 5);
    } else if (state.userRole === 'credit') {
      return state.availableCredits > 0;
    } else if (state.userRole === 'pro') {
      return state.applicationsUsed < (state.applicationLimit || 100);
    }

    return false;
  }

  async getRemainingApplications() {
    const state = await this.getState();
    if (!state) return 0;

    if (state.userRole === 'free') {
      return Math.max(0, (state.applicationLimit || 5) - (state.applicationsUsed || 0));
    } else if (state.userRole === 'credit') {
      return state.availableCredits || 0;
    } else if (state.userRole === 'pro') {
      return Math.max(0, (state.applicationLimit || 100) - (state.applicationsUsed || 0));
    }

    return 0;
  }

  async addJobToQueue(jobData) {
    const currentState = await this.getState();
    if (currentState) {
      const jobQueue = currentState.jobQueue || [];
      jobQueue.push({
        ...jobData,
        addedAt: Date.now()
      });

      return await this.updateState({ jobQueue });
    }
    return false;
  }

  async removeJobFromQueue(jobId) {
    const currentState = await this.getState();
    if (currentState && currentState.jobQueue) {
      const jobQueue = currentState.jobQueue.filter(job => job.jobId !== jobId);
      return await this.updateState({ jobQueue });
    }
    return false;
  }

  async setProcessingStatus(isProcessing) {
    return await this.updateState({ isProcessing });
  }

  // Utility methods
  isStateValid() {
    return this.state && this.state.userId && this.state.userRole;
  }

  getStateValue(key, defaultValue = null) {
    return this.state ? (this.state[key] ?? defaultValue) : defaultValue;
  }
}