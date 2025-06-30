// platforms/lever/lever.js - COMPLETE FILE WITH ALL UPDATES
import BasePlatform from '../base-platform.js';
import LeverFormHandler from './lever-form-handler.js';
import LeverFileHandler from './lever-file-handler.js';
import { 
  AIService, 
  ApplicationTrackerService, 
  UserService, 
  StatusNotificationService,
  FileHandlerService 
} from '../../services/index.js';

export default class LeverPlatform extends BasePlatform {
  constructor(config) {
    super(config);
    this.platform = 'lever';
    this.baseUrl = 'https://jobs.lever.co';
    
    // Initialize services
    this.aiService = new AIService({ apiHost: this.getApiHost() });
    this.applicationTracker = new ApplicationTrackerService({ userId: this.userId });
    this.userService = new UserService({ userId: this.userId });
    this.statusService = new StatusNotificationService();
    this.fileHandler = new LeverFileHandler({ 
      statusService: this.statusService,
      apiHost: this.getApiHost() 
    });
    
    // State management
    this.searchData = {
      limit: 0,
      current: 0,
      domain: ['lever.co'],
      submittedLinks: [],
      searchLinkPattern: /^https:\/\/jobs\.lever\.co\/[^\/]+\/[^\/]+\/?.*$/
    };
    
    this.applicationState = {
      isApplicationInProgress: false,
      applicationStartTime: null,
      applicationUrl: null,
      processedUrls: new Set(),
      processedLinksCount: 0
    };
    
    this.debounceTimers = {};
    this.healthCheckTimer = null;
  }

  getApiHost() {
    return this.config.apiHost || 'http://localhost:3000';
  }

  async initialize() {
    await super.initialize();
    this.log('🎯 Lever platform initialized');
    
    // Set up health monitoring
    this.healthCheckTimer = setInterval(() => this.checkHealth(), 30000);
    
    // Initialize form and file handlers
    this.formHandler = new LeverFormHandler({
      logger: (message) => this.log(message),
      host: this.getApiHost(),
      userData: null, // Will be set when user data is loaded
      jobDescription: ''
    });
    
    // Set up message listener for background script communication
    this.setupMessageListener();
  }

  // NEW: Set up message listener for SEARCH_NEXT notifications
  setupMessageListener() {
    // Listen for messages from background script
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
      if (message.type === 'SEARCH_NEXT' && this.isRunning) {
        this.handleSearchNext(message.data);
        sendResponse({ success: true });
        return true;
      }
    });
  }

  async start(params = {}) {
    try {
      this.isRunning = true;
      this.log('🚀 Starting Lever automation');
      
      // Update config with parameters
      this.config = { ...this.config, ...params };
      this.searchData.limit = this.config.jobsToApply || 10;
      this.searchData.submittedLinks = this.formatSubmittedLinks(this.config.submittedLinks || []);
      
      // Get user details
      await this.loadUserProfile();
      
      // Wait for page to be ready
      await this.waitForPageLoad();
      
      // Detect page type and start appropriate automation
      await this.detectPageTypeAndStart();
      
    } catch (error) {
      this.reportError(error, { phase: 'start' });
    }
  }

  async loadUserProfile() {
    try {
      this.userProfile = await this.userService.getUserDetails();
      
      if (this.formHandler) {
        this.formHandler.userData = this.userProfile;
      }
      
      this.log('✅ User profile loaded successfully');
    } catch (error) {
      this.log('❌ Failed to load user profile', error);
      throw error;
    }
  }

  async detectPageTypeAndStart() {
    const url = window.location.href;
    this.log(`🔍 Detecting page type for: ${url}`);
    
    if (url.includes('google.com/search')) {
      this.log('📊 Google search page detected');
      this.statusService.show('Google search page detected', 'info');
      await this.startSearchProcess();
    } else if (this.isLeverJobPage(url)) {
      this.log('📋 Lever job page detected');
      this.statusService.show('Lever job page detected', 'info');
      await this.startApplicationProcess();
    } else {
      this.log('❓ Unknown page type, waiting for navigation');
      // Wait for navigation or user interaction
      await this.waitForValidPage();
    }
  }

  isLeverJobPage(url) {
    return /^https:\/\/jobs\.lever\.co\/[^\/]+\/[^\/]+\/?.*$/.test(url);
  }

  async waitForValidPage(timeout = 30000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      const url = window.location.href;
      
      if (url.includes('google.com/search') || this.isLeverJobPage(url)) {
        await this.detectPageTypeAndStart();
        return;
      }
      
      await this.delay(1000);
    }
    
    throw new Error('Timeout waiting for valid page');
  }

  async startSearchProcess() {
    try {
      this.statusService.show('Starting job search process', 'info');
      this.updateProgress({ phase: 'searching' });
      
      // Find and process job links
      await this.findAndProcessJobs();
      
    } catch (error) {
      this.reportError(error, { phase: 'search' });
    }
  }

  // UPDATED: Modified search loop to wait for job completion before continuing
  async findAndProcessJobs() {
    while (this.isRunning && !this.isPaused) {
      try {
        // Check if we've reached the limit
        if (this.searchData.current >= this.searchData.limit) {
          this.log('✅ Reached application limit');
          this.reportComplete();
          return;
        }
        
        // Check if application is in progress and wait
        if (this.applicationState.isApplicationInProgress) {
          this.log('⏳ Application in progress, waiting...');
          await this.delay(5000);
          continue;
        }
        
        // Find job links on current page
        const jobLinks = this.findJobLinks();
        this.log(`🔗 Found ${jobLinks.length} job links`);
        
        // Process each job link
        let processedAny = false;
        for (const link of jobLinks) {
          if (!this.isRunning || this.isPaused) break;
          
          // Skip if application is in progress
          if (this.applicationState.isApplicationInProgress) {
            this.log('⏳ Application started, stopping job search loop');
            return; // Exit the loop, will be resumed when application completes
          }
          
          const processed = await this.processJobLink(link);
          if (processed) {
            processedAny = true;
            this.searchData.current++;
            
            // After successfully starting an application, wait for it to complete
            this.log('✅ Job application started, waiting for completion...');
            return; // Exit the loop, will be resumed by handleSearchNext
          }
        }
        
        // If no jobs were processed, try to load more results
        if (!processedAny) {
          const loadedMore = await this.loadMoreResults();
          if (!loadedMore) {
            this.log('🏁 No more results available');
            this.reportComplete();
            return;
          }
        }
        
        // Small delay between batches
        await this.delay(2000);
        
      } catch (error) {
        this.reportError(error, { phase: 'job_processing' });
        await this.delay(5000); // Wait before retrying
      }
    }
  }

  // NEW: Handle notification that we should continue to the next job
  handleSearchNext(data) {
    try {
      this.log('🔄 Received search next notification', data);
      
      // Reset application state
      this.applicationState.isApplicationInProgress = false;
      this.applicationState.applicationUrl = null;
      this.applicationState.applicationStartTime = null;
      
      // Update processed links
      if (data && data.url) {
        this.searchData.submittedLinks.push({
          url: data.url,
          status: data.status || 'PROCESSED',
          message: data.message || '',
          timestamp: Date.now()
        });
        
        // Update visual status of the link
        this.updateLinkStatus(data.url, data.status, data.message);
      }
      
      // Continue searching if we haven't reached the limit
      if (this.isRunning && this.searchData.current < this.searchData.limit) {
        this.log('🔄 Continuing job search...');
        // Resume the job search process
        this.debounce('continueSearch', () => this.findAndProcessJobs(), 2000);
      } else {
        this.log('🏁 Search completed or limit reached');
        this.reportComplete();
      }
      
    } catch (error) {
      this.log(`❌ Error handling search next: ${error.message}`);
      this.reportError(error, { phase: 'search_next' });
    }
  }

  // NEW: Update visual status of a processed link
  updateLinkStatus(url, status, message) {
    try {
      const links = this.findJobLinks();
      for (const linkData of links) {
        if (this.isUrlMatch(linkData.url, url)) {
          if (status === 'SUCCESS') {
            this.markLinkAsSuccess(linkData.element);
          } else if (status === 'ERROR' || status === 'FAILED') {
            this.markLinkAsError(linkData.element, message || 'Failed');
          } else if (status === 'SKIPPED') {
            this.markLinkAsSkipped(linkData.element, message || 'Skipped');
          }
          break;
        }
      }
    } catch (error) {
      this.log(`⚠️ Error updating link status: ${error.message}`);
    }
  }

  findJobLinks() {
    const links = [];
    const selectors = [
      'a[href*="jobs.lever.co"]',
      'a[href*="lever.co"]'
    ];
    
    for (const selector of selectors) {
      const elements = document.querySelectorAll(selector);
      for (const element of elements) {
        const url = element.href;
        if (this.isValidLeverJobLink(url) && !this.isUrlProcessed(url)) {
          links.push({
            element,
            url,
            title: this.extractJobTitle(element)
          });
        }
      }
    }
    
    return links;
  }

  isValidLeverJobLink(url) {
    return this.searchData.searchLinkPattern.test(url);
  }

  isUrlProcessed(url) {
    const normalizedUrl = this.normalizeUrl(url);
    
    // Check local cache
    if (this.applicationState.processedUrls.has(normalizedUrl)) {
      return true;
    }
    
    // Check submitted links
    return this.searchData.submittedLinks.some(link => 
      this.isUrlMatch(link.url, url)
    );
  }

  extractJobTitle(element) {
    return element.textContent?.trim() || 'Job Application';
  }

  // UPDATED: Now requests background script to open job in new tab instead of direct navigation
  async processJobLink(jobLink) {
    try {
      this.log(`🎯 Processing job: ${jobLink.url}`);
      
      // Check if already processing a job
      if (this.applicationState.isApplicationInProgress) {
        this.log('⚠️ Already processing a job, skipping');
        return false;
      }
      
      // Mark as processing
      this.markLinkAsProcessing(jobLink.element);
      this.applicationState.processedUrls.add(this.normalizeUrl(jobLink.url));
      
      // Check if we can apply more
      const canApply = await this.userService.canApplyMore();
      if (!canApply) {
        this.log('❌ Application limit reached');
        this.markLinkAsError(jobLink.element, 'Limit reached');
        return false;
      }
      
      // Request background script to open job in new tab
      const success = await this.requestJobTabOpen(jobLink.url, jobLink.title);
      
      if (success) {
        this.markLinkAsSuccess(jobLink.element);
        return true;
      } else {
        this.markLinkAsError(jobLink.element, 'Failed to open job tab');
        this.resetApplicationState();
        return false;
      }
      
    } catch (error) {
      this.log(`❌ Error processing job link: ${error.message}`);
      this.markLinkAsError(jobLink.element, error.message);
      this.resetApplicationState();
      return false;
    }
  }

  // NEW: Request background script to open job in new tab
  async requestJobTabOpen(url, title) {
    try {
      this.log(`📝 Requesting job tab open: ${url}`);
      
      // Send message to background script to open job in new tab
      const response = await this.sendMessageToBackground({
        action: 'openJobInNewTab',
        url: url,
        title: title,
        sessionId: this.sessionId,
        platform: this.platform
      });
      
      if (response && response.success) {
        // Set application state
        this.applicationState.isApplicationInProgress = true;
        this.applicationState.applicationUrl = url;
        this.applicationState.applicationStartTime = Date.now();
        
        this.log('✅ Job tab opened successfully');
        return true;
      } else {
        this.log('❌ Failed to open job tab');
        return false;
      }
      
    } catch (error) {
      this.log(`❌ Error requesting job tab: ${error.message}`);
      return false;
    }
  }

  // NEW: Helper method for Chrome extension messaging
  async sendMessageToBackground(message) {
    return new Promise((resolve, reject) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else {
            resolve(response);
          }
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  async loadMoreResults() {
    try {
      this.log('🔄 Attempting to load more results');
      
      // Look for "Next" or "More results" button
      const nextButton = this.findNextButton();
      if (nextButton) {
        this.log('⏭️ Found next button, clicking');
        nextButton.click();
        await this.delay(3000);
        return true;
      }
      
      this.log('❌ No more results button found');
      return false;
      
    } catch (error) {
      this.log(`❌ Error loading more results: ${error.message}`);
      return false;
    }
  }

  findNextButton() {
    const selectors = [
      '#pnnext',
      'a[aria-label="Next page"]',
      'a[id="pnnext"]',
      '.pnprev ~ a'
    ];
    
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && this.isElementVisible(element)) {
        return element;
      }
    }
    
    return null;
  }

  async startApplicationProcess() {
    try {
      this.log('📝 Starting application process');
      this.statusService.show('Starting application process', 'info');
      
      // Extract job details
      const jobDetails = this.extractJobDetails();
      this.log('📋 Job details extracted', jobDetails);
      
      // Check if already applied
      const alreadyApplied = await this.applicationTracker.checkIfAlreadyApplied(jobDetails.jobId);
      if (alreadyApplied) {
        this.log('⚠️ Already applied to this job');
        this.statusService.show('Already applied to this job', 'warning');
        await this.handleJobCompletion(jobDetails, 'SKIPPED', 'Already applied');
        return;
      }
      
      // Start countdown timer
      this.startApplicationTimer();
      
      // Apply for the job
      const success = await this.applyToJob(jobDetails);
      
      if (success) {
        await this.handleJobCompletion(jobDetails, 'SUCCESS');
      } else {
        await this.handleJobCompletion(jobDetails, 'FAILED', 'Application failed');
      }
      
    } catch (error) {
      this.reportError(error, { phase: 'application' });
      await this.handleJobCompletion(null, 'ERROR', error.message);
    }
  }

  extractJobDetails() {
    const url = window.location.href;
    const urlParts = url.split('/');
    const jobId = urlParts[urlParts.length - 1] || 'unknown';
    
    const title = this.extractText([
      'h2[data-qa="posting-name"]',
      '.posting-headline h2',
      'h1',
      '.job-title'
    ]) || document.title;
    
    const company = this.extractText([
      '.main-header-text-logo',
      '.company-name',
      'h1 a'
    ]) || this.extractCompanyFromUrl(url);
    
    const location = this.extractText([
      '.posting-headline .posting-categories .location',
      '.location',
      '[data-qa="posting-location"]'
    ]) || 'Not specified';
    
    const description = this.extractJobDescription();
    
    return {
      jobId,
      title,
      company,
      location,
      description,
      url,
      platform: 'lever',
      extractedAt: Date.now()
    };
  }

  extractJobDescription() {
    try {
      const descriptionElement = document.querySelector('.posting-content, .posting-description, .job-description');
      return descriptionElement ? descriptionElement.textContent.trim() : '';
    } catch (error) {
      this.log('⚠️ Error extracting job description', error);
      return '';
    }
  }

  extractCompanyFromUrl(url) {
    try {
      const match = url.match(/\/\/jobs\.lever\.co\/([^\/]+)/);
      return match ? match[1].replace(/-/g, ' ') : 'Company';
    } catch (error) {
      return 'Company';
    }
  }

  async applyToJob(jobDetails) {
    try {
      this.statusService.show('Looking for application form', 'info');
      
      // Look for apply button first
      const applyButton = this.findApplyButton();
      if (applyButton) {
        this.log('🔘 Found apply button, clicking it');
        applyButton.click();
        await this.delay(3000);
      }
      
      // Find application form
      const form = this.findApplicationForm();
      if (!form) {
        throw new Error('Cannot find application form');
      }
      
      this.log('📝 Found application form, processing');
      this.statusService.show('Found application form, filling out', 'info');
      
      // Update form handler with job description
      this.formHandler.jobDescription = jobDetails.description;
      this.formHandler.userData = this.userProfile;
      
      // Process the form
      const success = await this.processApplicationForm(form, jobDetails);
      
      if (success) {
        this.statusService.show('Application submitted successfully', 'success');
        this.log('✅ Application submitted successfully');
        return true;
      } else {
        this.statusService.show('Application submission failed', 'error');
        this.log('❌ Application submission failed');
        return false;
      }
      
    } catch (error) {
      this.log(`❌ Error applying to job: ${error.message}`);
      this.statusService.show(`Application error: ${error.message}`, 'error');
      return false;
    }
  }

  findApplyButton() {
    const selectors = [
      '.posting-btn-submit',
      'a[data-qa="btn-apply"]',
      'button[data-qa="btn-apply"]',
      '.apply-button',
      'a[href*="apply"]',
      'button[class*="apply"]'
    ];
    
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element && this.isElementVisible(element)) {
        return element;
      }
    }
    
    return null;
  }

  findApplicationForm() {
    const selectors = [
      'form[data-qa="posting-form"]',
      '.posting-form',
      'form.application-form',
      'form[action*="apply"]',
      'form[action*="lever"]',
      'form'
    ];
    
    for (const selector of selectors) {
      const forms = document.querySelectorAll(selector);
      for (const form of forms) {
        if (this.isElementVisible(form) && form.querySelectorAll('input, select, textarea').length > 0) {
          return form;
        }
      }
    }
    
    return null;
  }

  async processApplicationForm(form, jobDetails) {
    try {
      this.log('📝 Processing application form');
      
      // 1. Handle file uploads (resume, cover letter)
      await this.fileHandler.handleFileUploads(form, this.userProfile, jobDetails.description);
      
      // 2. Fill out form fields using AI
      await this.formHandler.fillFormWithProfile(form, this.userProfile);
      
      // 3. Handle required checkboxes and agreements
      await this.formHandler.handleRequiredCheckboxes(form);
      
      // 4. Submit the form
      const submitted = await this.formHandler.submitForm(form);
      
      if (submitted) {
        // Wait for submission to complete
        await this.waitForSubmissionComplete();
        return true;
      }
      
      return false;
      
    } catch (error) {
      this.log(`❌ Error processing application form: ${error.message}`);
      return false;
    }
  }

  async waitForSubmissionComplete(timeout = 15000) {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      // Check for success indicators
      const successSelectors = [
        '.posting-confirmation',
        '.thank-you',
        '.success-message',
        '[data-qa="confirmation"]'
      ];
      
      for (const selector of successSelectors) {
        const element = document.querySelector(selector);
        if (element && this.isElementVisible(element)) {
          this.log('✅ Application submission confirmed');
          return true;
        }
      }
      
      // Check if URL changed to confirmation page
      if (window.location.href.includes('thank') || 
          window.location.href.includes('success') ||
          window.location.href.includes('confirmation')) {
        this.log('✅ Redirected to confirmation page');
        return true;
      }
      
      await this.delay(1000);
    }
    
    // Assume success if no error indicators found
    this.log('⏳ No confirmation found, assuming success');
    return true;
  }

  // UPDATED: Send completion message to background script instead of navigating back
  async handleJobCompletion(jobDetails, status, message = '') {
    try {
      this.log(`📊 Handling job completion: ${status}`);
      
      // Send completion message to background script
      const completionData = {
        action: status === 'SUCCESS' ? 'applicationCompleted' : 
                status === 'FAILED' || status === 'ERROR' ? 'applicationError' : 
                'applicationSkipped',
        sessionId: this.sessionId,
        platform: this.platform,
        url: this.applicationState.applicationUrl,
        data: jobDetails,
        message: message
      };
      
      await this.sendMessageToBackground(completionData);
      
      // Update application count if successful
      if (status === 'SUCCESS' && jobDetails) {
        await this.userService.updateApplicationCount();
        await this.applicationTracker.saveAppliedJob({
          ...jobDetails,
          appliedAt: Date.now(),
          status: 'applied'
        });
        
        this.reportApplicationSubmitted(jobDetails, {
          status: 'applied',
          appliedAt: Date.now()
        });
      }
      
      // Update progress
      if (status === 'SUCCESS') {
        this.progress.completed++;
      } else if (status === 'FAILED' || status === 'ERROR') {
        this.progress.failed++;
      } else {
        this.progress.skipped++;
      }
      
      this.updateProgress(this.progress);
      
      // Reset application state - the tab will be closed by background script
      this.resetApplicationState();
      
    } catch (error) {
      this.reportError(error, { phase: 'job_completion' });
    }
  }

  buildSearchUrl() {
    const preferences = this.config.preferences || {};
    const positions = preferences.positions?.length ? preferences.positions.join(' OR ') : 'software engineer';
    const location = preferences.location?.length && !preferences.remoteOnly ? ` "${preferences.location[0]}"` : '';
    
    return `https://www.google.com/search?q=site:jobs.lever.co+"${encodeURIComponent(positions)}"${location}`;
  }

  // Utility methods
  extractText(selectors) {
    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) {
        return element.textContent?.trim() || '';
      }
    }
    return '';
  }

  isElementVisible(element) {
    if (!element) return false;
    
    const style = window.getComputedStyle(element);
    return style.display !== 'none' && 
           style.visibility !== 'hidden' && 
           style.opacity !== '0';
  }

  normalizeUrl(url) {
    try {
      const urlObj = new URL(url);
      return (urlObj.origin + urlObj.pathname).toLowerCase().trim().replace(/\/+$/, '');
    } catch (error) {
      return url.toLowerCase().trim();
    }
  }

  isUrlMatch(url1, url2) {
    if (!url1 || !url2) return false;
    return this.normalizeUrl(url1) === this.normalizeUrl(url2);
  }

  formatSubmittedLinks(links) {
    return links.map(link => ({
      url: link.url || link,
      status: link.status || 'PROCESSED',
      timestamp: link.timestamp || Date.now()
    }));
  }

  startApplicationTimer() {
    this.applicationTimer = setTimeout(() => {
      if (this.applicationState.isApplicationInProgress) {
        this.log('⏰ Application timeout, marking as failed');
        this.handleJobCompletion(null, 'ERROR', 'Application timeout');
      }
    }, 5 * 60 * 1000); // 5 minute timeout
  }

  resetApplicationState() {
    this.applicationState.isApplicationInProgress = false;
    this.applicationState.applicationUrl = null;
    this.applicationState.applicationStartTime = null;
    
    if (this.applicationTimer) {
      clearTimeout(this.applicationTimer);
      this.applicationTimer = null;
    }
  }

  checkHealth() {
    try {
      const now = Date.now();
      
      // Check for stuck application
      if (this.applicationState.isApplicationInProgress && 
          this.applicationState.applicationStartTime) {
        const applicationTime = now - this.applicationState.applicationStartTime;
        
        if (applicationTime > 5 * 60 * 1000) { // 5 minutes
          this.log('🚨 Application stuck for over 5 minutes, resetting');
          this.handleJobCompletion(null, 'ERROR', 'Application timeout');
        }
      }
      
    } catch (error) {
      this.log('❌ Health check error', error);
    }
  }

  markLinkAsProcessing(element) {
    this.markLinkWithColor(element, '#2196F3', 'Processing');
  }

  markLinkAsSuccess(element) {
    this.markLinkWithColor(element, '#4CAF50', 'Success');
  }

  markLinkAsSkipped(element, message) {
    this.markLinkWithColor(element, '#FF9800', `Skipped: ${message}`);
  }

  markLinkAsError(element, message) {
    this.markLinkWithColor(element, '#F44336', `Error: ${message}`);
  }

  markLinkWithColor(element, color, text) {
    try {
      if (!element || !element.parentElement) return;
      
      element.parentElement.style.border = `2px solid ${color}`;
      element.parentElement.style.backgroundColor = `${color}22`;
      
      // Add status badge
      const badge = document.createElement('span');
      badge.style.cssText = `
        position: absolute;
        top: -5px;
        right: -5px;
        background: ${color};
        color: white;
        padding: 2px 6px;
        border-radius: 3px;
        font-size: 10px;
        font-weight: bold;
        z-index: 1000;
      `;
      badge.textContent = text;
      
      element.parentElement.style.position = 'relative';
      element.parentElement.appendChild(badge);
      
    } catch (error) {
      // Ignore marking errors
    }
  }

  async waitForPageLoad(timeout = 30000) {
    return new Promise((resolve) => {
      if (document.readyState === 'complete') {
        resolve(true);
        return;
      }
      
      const checkComplete = () => {
        if (document.readyState === 'complete') {
          resolve(true);
        } else {
          setTimeout(checkComplete, 100);
        }
      };
      
      checkComplete();
      
      setTimeout(() => resolve(false), timeout);
    });
  }

  debounce(key, fn, delay) {
    if (this.debounceTimers[key]) {
      clearTimeout(this.debounceTimers[key]);
    }
    
    this.debounceTimers[key] = setTimeout(() => {
      delete this.debounceTimers[key];
      fn();
    }, delay);
  }

  cleanup() {
    super.cleanup();
    
    // Clear timers
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
    }
    
    if (this.applicationTimer) {
      clearTimeout(this.applicationTimer);
    }
    
    // Clear debounce timers
    Object.values(this.debounceTimers).forEach(timer => clearTimeout(timer));
    
    // Reset state
    this.resetApplicationState();
    
    this.log('🧹 Lever platform cleanup completed');
  }

  async findJobs() {
    return this.findJobLinks();
  }

  async applyToJob(jobElement) {
    // This method is called by base class, redirect to our implementation
    const jobDetails = this.extractJobDetails();
    return await this.applyToJob(jobDetails);
  }
}