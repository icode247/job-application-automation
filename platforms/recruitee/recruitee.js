// // content/content-main.js
// class ContentScriptManager {
//   constructor() {
//     this.isInitialized = false;
//     this.automationActive = false;
//     this.sessionId = null;
//     this.platform = null;
//     this.platformAutomation = null;
//     this.domObserver = null;
//     this.indicator = null;
//     this.config = {};
//   }

//   async initialize() {
//     if (this.isInitialized) return;

//     try {
//       // Check if this is an automation window
//       const isAutomationWindow = await this.checkIfAutomationWindow();
      
//       if (isAutomationWindow) {
//         this.automationActive = true;
//         this.sessionId = this.getSessionId();
//         this.platform = this.getPlatform();
        
//         if (this.platform && this.platform !== 'unknown') {
//           await this.setupAutomation();
//           this.isInitialized = true;
          
//           console.log(`🤖 Content script initialized for ${this.platform}`, {
//             sessionId: this.sessionId,
//             url: window.location.href
//           });
//         }
//       }
//     } catch (error) {
//       console.error('❌ Error initializing content script:', error);
//     }
//   }

//   async checkIfAutomationWindow() {
//     // Method 1: Check window flags set by background script
//     if (window.isAutomationWindow && window.automationSessionId) {
//       return true;
//     }

//     // Method 2: Check sessionStorage
//     const sessionId = sessionStorage.getItem('automationSessionId');
//     const platform = sessionStorage.getItem('automationPlatform');
//     if (sessionId && platform) {
//       window.automationSessionId = sessionId;
//       window.automationPlatform = platform;
//       window.isAutomationWindow = true;
//       return true;
//     }

//     // Method 3: Ask background script
//     try {
//       const response = await this.sendMessageToBackground({
//         action: 'checkIfAutomationWindow'
//       });
      
//       if (response && response.isAutomationWindow) {
//         window.isAutomationWindow = true;
//         return true;
//       }
//     } catch (error) {
//       console.error('Error checking automation window status:', error);
//     }

//     return false;
//   }

//   getSessionId() {
//     return window.automationSessionId || 
//            sessionStorage.getItem('automationSessionId') || 
//            null;
//   }

//   getPlatform() {
//     return window.automationPlatform || 
//            sessionStorage.getItem('automationPlatform') || 
//            this.detectPlatformFromUrl();
//   }

//   detectPlatformFromUrl() {
//     const url = window.location.href.toLowerCase();
    
//     if (url.includes('linkedin.com')) return 'linkedin';
//     if (url.includes('indeed.com')) return 'indeed';
//     if (url.includes('recruitee.com')) return 'recruitee';
//     if (url.includes('glassdoor.com')) return 'glassdoor';
//     if (url.includes('myworkdayjobs.com')) return 'workday';
//     if (url.includes('lever.co')) return 'lever';
//     if (url.includes('greenhouse.io')) return 'greenhouse';
    
//     // Handle Google search for specific platforms
//     if (url.includes('google.com/search')) {
//       if (url.includes('site:recruitee.com') || url.includes('recruitee.com')) return 'recruitee';
//       if (url.includes('site:myworkdayjobs.com') || url.includes('myworkdayjobs.com')) return 'workday';
//       if (url.includes('site:lever.co') || url.includes('lever.co')) return 'lever';
//     }
    
//     return 'unknown';
//   }

//   async setupAutomation() {
//     try {
//       // Load platform-specific automation module
//       const PlatformClass = await this.loadPlatformModule(this.platform);
      
//       if (!PlatformClass) {
//         throw new Error(`Platform ${this.platform} not supported`);
//       }

//       // Create platform automation instance
//       this.platformAutomation = new PlatformClass({
//         sessionId: this.sessionId,
//         platform: this.platform,
//         contentScript: this,
//         config: this.config
//       });

//       // Set up automation UI
//       this.addAutomationIndicator();
//       this.setupMessageListeners();
//       this.setupDOMObserver();
//       this.setupNavigationListeners();
      
//       // Notify background script that content script is ready
//       this.notifyBackgroundReady();
      
//       // Start platform automation
//       await this.platformAutomation.initialize();

//     } catch (error) {
//       console.error(`❌ Failed to setup automation for ${this.platform}:`, error);
//       this.notifyBackgroundError(error);
//     }
//   }

//   async loadPlatformModule(platform) {
//     try {
//       switch (platform) {
//         case 'linkedin':
//           const { default: LinkedInPlatform } = await import('../platforms/linkedin/linkedin.js');
//           return LinkedInPlatform;
          
//         case 'indeed':
//           const { default: IndeedPlatform } = await import('../platforms/indeed/indeed.js');
//           return IndeedPlatform;
          
//         case 'recruitee':
//           const { default: RecruiteePlatform } = await import('../platforms/recruitee/recruitee.js');
//           return RecruiteePlatform;
          
//         case 'glassdoor':
//           const { default: GlassdoorPlatform } = await import('../platforms/glassdoor/glassdoor.js');
//           return GlassdoorPlatform;
          
//         case 'workday':
//           const { default: WorkdayPlatform } = await import('../platforms/workday/workday.js');
//           return WorkdayPlatform;
          
//         default:
//           console.warn(`Platform ${platform} not supported`);
//           return null;
//       }
//     } catch (error) {
//       console.error(`Failed to load platform module for ${platform}:`, error);
//       return null;
//     }
//   }

//   addAutomationIndicator() {
//     // Remove existing indicator
//     const existing = document.getElementById('automation-indicator');
//     if (existing) existing.remove();

//     const indicator = document.createElement('div');
//     indicator.id = 'automation-indicator';
//     indicator.innerHTML = `
//       <div style="
//         position: fixed;
//         top: 10px;
//         right: 10px;
//         background: linear-gradient(135deg, #4CAF50, #45a049);
//         color: white;
//         padding: 12px 16px;
//         border-radius: 8px;
//         font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
//         font-size: 13px;
//         font-weight: 600;
//         z-index: 999999;
//         box-shadow: 0 4px 12px rgba(0,0,0,0.15);
//         border: 1px solid rgba(255,255,255,0.2);
//         backdrop-filter: blur(10px);
//         cursor: pointer;
//         transition: all 0.3s ease;
//       " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
//         <div style="display: flex; align-items: center; gap: 8px;">
//           <span style="font-size: 16px;">🤖</span>
//           <div>
//             <div style="font-weight: 700;">AUTOMATION ACTIVE</div>
//             <div style="font-size: 11px; opacity: 0.9;">${this.platform?.toUpperCase()} • ${this.sessionId?.slice(-6)}</div>
//           </div>
//         </div>
//       </div>
//     `;
    
//     // Add click handler to show status
//     indicator.addEventListener('click', () => {
//       this.showAutomationStatus();
//     });

//     document.documentElement.appendChild(indicator);
//     this.indicator = indicator;
//   }

//   setupMessageListeners() {
//     // Listen for messages from background script
//     chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
//       this.handleMessage(request, sender, sendResponse);
//       return true; // Keep message channel open for async responses
//     });
//   }

//   async handleMessage(request, sender, sendResponse) {
//     try {
//       switch (request.action) {
//         case 'startAutomation':
//           await this.handleStartAutomation(request, sendResponse);
//           break;
          
//         case 'pauseAutomation':
//           await this.handlePauseAutomation(request, sendResponse);
//           break;
          
//         case 'resumeAutomation':
//           await this.handleResumeAutomation(request, sendResponse);
//           break;
          
//         case 'stopAutomation':
//           await this.handleStopAutomation(request, sendResponse);
//           break;
          
//         case 'getPageData':
//           this.handleGetPageData(sendResponse);
//           break;
          
//         case 'executeAction':
//           await this.handleExecuteAction(request, sendResponse);
//           break;
          
//         case 'extractJobData':
//           this.handleExtractJobData(sendResponse);
//           break;
          
//         default:
//           sendResponse({ success: false, error: 'Unknown action' });
//       }
//     } catch (error) {
//       console.error('Error handling message:', error);
//       sendResponse({ success: false, error: error.message });
//     }
//   }

//   async handleStartAutomation(request, sendResponse) {
//     if (this.platformAutomation) {
//       this.config = { ...this.config, ...request.config };
//       await this.platformAutomation.start(request.params);
//       sendResponse({ success: true, message: 'Automation started' });
//     } else {
//       sendResponse({ success: false, error: 'Platform automation not initialized' });
//     }
//   }

//   async handlePauseAutomation(request, sendResponse) {
//     if (this.platformAutomation && this.platformAutomation.pause) {
//       await this.platformAutomation.pause();
//       sendResponse({ success: true, message: 'Automation paused' });
//     } else {
//       sendResponse({ success: false, error: 'Cannot pause automation' });
//     }
//   }

//   async handleResumeAutomation(request, sendResponse) {
//     if (this.platformAutomation && this.platformAutomation.resume) {
//       await this.platformAutomation.resume();
//       sendResponse({ success: true, message: 'Automation resumed' });
//     } else {
//       sendResponse({ success: false, error: 'Cannot resume automation' });
//     }
//   }

//   async handleStopAutomation(request, sendResponse) {
//     if (this.platformAutomation && this.platformAutomation.stop) {
//       await this.platformAutomation.stop();
//       sendResponse({ success: true, message: 'Automation stopped' });
//     } else {
//       sendResponse({ success: false, error: 'Cannot stop automation' });
//     }
//   }

//   handleGetPageData(sendResponse) {
//     const pageData = {
//       url: window.location.href,
//       title: document.title,
//       platform: this.platform,
//       sessionId: this.sessionId,
//       readyState: document.readyState,
//       timestamp: Date.now()
//     };
    
//     sendResponse({ success: true, data: pageData });
//   }

//   async handleExecuteAction(request, sendResponse) {
//     const { actionType, selector, value, options = {} } = request;
    
//     try {
//       let result = false;
      
//       switch (actionType) {
//         case 'click':
//           result = await this.clickElement(selector, options);
//           break;
          
//         case 'fill':
//           result = await this.fillElement(selector, value, options);
//           break;
          
//         case 'wait':
//           result = await this.waitForElement(selector, options.timeout || 10000);
//           break;
          
//         case 'scroll':
//           result = await this.scrollToElement(selector, options);
//           break;
          
//         default:
//           throw new Error(`Unknown action type: ${actionType}`);
//       }
      
//       sendResponse({ success: true, result });
//     } catch (error) {
//       sendResponse({ success: false, error: error.message });
//     }
//   }

//   handleExtractJobData(sendResponse) {
//     try {
//       const jobData = this.extractCurrentJobData();
//       sendResponse({ success: true, data: jobData });
//     } catch (error) {
//       sendResponse({ success: false, error: error.message });
//     }
//   }

//   setupDOMObserver() {
//     // Set up MutationObserver to detect significant DOM changes
//     this.domObserver = new MutationObserver((mutations) => {
//       this.handleDOMChanges(mutations);
//     });

//     this.domObserver.observe(document.body, {
//       childList: true,
//       subtree: true,
//       attributes: false
//     });
//   }

//   handleDOMChanges(mutations) {
//     let significantChange = false;
    
//     for (const mutation of mutations) {
//       if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
//         // Check if new content suggests page change or important updates
//         const addedElements = Array.from(mutation.addedNodes)
//           .filter(node => node.nodeType === 1);
        
//         if (addedElements.some(el => this.isSignificantElement(el))) {
//           significantChange = true;
//           break;
//         }
//       }
//     }
    
//     if (significantChange) {
//       this.notifyDOMChange();
      
//       // Notify platform automation of DOM changes
//       if (this.platformAutomation && this.platformAutomation.onDOMChange) {
//         this.platformAutomation.onDOMChange();
//       }
//     }
//   }

//   isSignificantElement(element) {
//     const significantSelectors = [
//       'form', '.job', '.application', '.modal', '.dialog',
//       '[class*="job"]', '[class*="apply"]', '[class*="form"]'
//     ];
    
//     return significantSelectors.some(selector => {
//       try {
//         return element.matches && (element.matches(selector) || element.querySelector(selector));
//       } catch (e) {
//         return false;
//       }
//     });
//   }

//   setupNavigationListeners() {
//     // Listen for URL changes (for SPAs)
//     let currentUrl = window.location.href;
    
//     const checkUrlChange = () => {
//       if (window.location.href !== currentUrl) {
//         const oldUrl = currentUrl;
//         currentUrl = window.location.href;
        
//         console.log(`🔄 Navigation detected: ${oldUrl} → ${currentUrl}`);
//         this.notifyNavigation(oldUrl, currentUrl);
        
//         // Notify platform automation of navigation
//         if (this.platformAutomation && this.platformAutomation.onNavigation) {
//           this.platformAutomation.onNavigation(oldUrl, currentUrl);
//         }
//       }
//     };
    
//     // Check for URL changes periodically
//     setInterval(checkUrlChange, 1000);
    
//     // Listen for popstate events
//     window.addEventListener('popstate', checkUrlChange);
    
//     // Override pushState and replaceState to catch programmatic navigation
//     const originalPushState = history.pushState;
//     const originalReplaceState = history.replaceState;
    
//     history.pushState = function(...args) {
//       originalPushState.apply(this, args);
//       setTimeout(checkUrlChange, 100);
//     };
    
//     history.replaceState = function(...args) {
//       originalReplaceState.apply(this, args);
//       setTimeout(checkUrlChange, 100);
//     };
//   }

//   // Utility methods for DOM manipulation
//   async clickElement(selector, options = {}) {
//     const element = document.querySelector(selector);
//     if (!element) {
//       throw new Error(`Element not found: ${selector}`);
//     }
    
//     // Scroll into view
//     element.scrollIntoView({ behavior: 'smooth', block: 'center' });
    
//     // Wait a bit for scroll
//     await this.delay(options.delay || 500);
    
//     // Click the element
//     element.click();
    
//     return true;
//   }

//   async fillElement(selector, value, options = {}) {
//     const element = document.querySelector(selector);
//     if (!element) {
//       throw new Error(`Element not found: ${selector}`);
//     }
    
//     // Focus and fill
//     element.focus();
//     element.value = value;
    
//     // Trigger events
//     element.dispatchEvent(new Event('input', { bubbles: true }));
//     element.dispatchEvent(new Event('change', { bubbles: true }));
    
//     if (options.blur) {
//       element.blur();
//     }
    
//     return true;
//   }

//   async scrollToElement(selector, options = {}) {
//     const element = document.querySelector(selector);
//     if (!element) {
//       throw new Error(`Element not found: ${selector}`);
//     }
    
//     const scrollOptions = {
//       behavior: 'smooth',
//       block: 'center',
//       inline: 'nearest',
//       ...options
//     };
    
//     element.scrollIntoView(scrollOptions);
//     return true;
//   }

//   async waitForElement(selector, timeout = 10000) {
//     return new Promise((resolve) => {
//       const element = document.querySelector(selector);
//       if (element) {
//         resolve(element);
//         return;
//       }
      
//       const observer = new MutationObserver((mutations, obs) => {
//         const element = document.querySelector(selector);
//         if (element) {
//           obs.disconnect();
//           resolve(element);
//         }
//       });
      
//       observer.observe(document, {
//         childList: true,
//         subtree: true
//       });
      
//       setTimeout(() => {
//         observer.disconnect();
//         resolve(null);
//       }, timeout);
//     });
//   }

//   extractCurrentJobData() {
//     // Extract job information from current page
//     const jobData = {
//       title: this.extractText(['h1', '.job-title', '[data-testid="job-title"]', '.jobsearch-JobInfoHeader-title']),
//       company: this.extractText(['.company', '.company-name', '[data-testid="company-name"]', '.jobsearch-InlineCompanyRating']),
//       location: this.extractText(['.location', '.job-location', '[data-testid="job-location"]', '.jobsearch-JobLocation']),
//       description: this.extractText(['.job-description', '.description', '[data-testid="job-description"]']),
//       url: window.location.href,
//       platform: this.platform,
//       extractedAt: Date.now()
//     };
    
//     return jobData;
//   }

//   extractText(selectors) {
//     for (const selector of selectors) {
//       const element = document.querySelector(selector);
//       if (element) {
//         return element.textContent?.trim() || '';
//       }
//     }
//     return '';
//   }

//   // Communication methods
//   async sendMessageToBackground(message) {
//     return new Promise((resolve, reject) => {
//       chrome.runtime.sendMessage(message, (response) => {
//         if (chrome.runtime.lastError) {
//           reject(new Error(chrome.runtime.lastError.message));
//         } else {
//           resolve(response);
//         }
//       });
//     });
//   }

//   notifyBackgroundReady() {
//     this.sendMessageToBackground({
//       action: 'contentScriptReady',
//       sessionId: this.sessionId,
//       platform: this.platform,
//       url: window.location.href
//     }).catch(console.error);
//   }

//   notifyBackgroundError(error) {
//     this.sendMessageToBackground({
//       action: 'contentScriptError',
//       sessionId: this.sessionId,
//       platform: this.platform,
//       error: error.message,
//       url: window.location.href
//     }).catch(console.error);
//   }

//   notifyDOMChange() {
//     this.sendMessageToBackground({
//       action: 'domChanged',
//       sessionId: this.sessionId,
//       url: window.location.href,
//       timestamp: Date.now()
//     }).catch(console.error);
//   }

//   notifyNavigation(oldUrl, newUrl) {
//     this.sendMessageToBackground({
//       action: 'navigationDetected',
//       sessionId: this.sessionId,
//       oldUrl,
//       newUrl,
//       timestamp: Date.now()
//     }).catch(console.error);
//   }

//   showAutomationStatus() {
//     // Show modal with current automation status
//     const modal = document.createElement('div');
//     modal.style.cssText = `
//       position: fixed; top: 0; left: 0; width: 100%; height: 100%;
//       background: rgba(0,0,0,0.5); z-index: 1000000; display: flex;
//       align-items: center; justify-content: center;
//     `;
    
//     modal.innerHTML = `
//       <div style="background: white; padding: 24px; border-radius: 12px; max-width: 400px; box-shadow: 0 8px 32px rgba(0,0,0,0.3);">
//         <h3 style="margin: 0 0 16px 0; color: #333;">Automation Status</h3>
//         <p><strong>Platform:</strong> ${this.platform}</p>
//         <p><strong>Session ID:</strong> ${this.sessionId}</p>
//         <p><strong>Current URL:</strong> ${window.location.href}</p>
//         <p><strong>Status:</strong> ${this.automationActive ? 'Active' : 'Inactive'}</p>
//         <button onclick="this.closest('div').remove()" style="
//           background: #4CAF50; color: white; border: none; padding: 8px 16px;
//           border-radius: 4px; cursor: pointer; margin-top: 16px;
//         ">Close</button>
//       </div>
//     `;
    
//     modal.addEventListener('click', (e) => {
//       if (e.target === modal) modal.remove();
//     });
    
//     document.body.appendChild(modal);
//   }

//   delay(ms) {
//     return new Promise(resolve => setTimeout(resolve, ms));
//   }

//   cleanup() {
//     // Remove automation indicator
//     if (this.indicator) {
//       this.indicator.remove();
//       this.indicator = null;
//     }

//     // Disconnect DOM observer
//     if (this.domObserver) {
//       this.domObserver.disconnect();
//       this.domObserver = null;
//     }

//     // Stop platform automation
//     if (this.platformAutomation && this.platformAutomation.cleanup) {
//       this.platformAutomation.cleanup();
//     }

//     this.isInitialized = false;
//     this.automationActive = false;
//   }
// }

// // Initialize content script manager
// const contentManager = new ContentScriptManager();

// // Initialize when DOM is ready
// if (document.readyState === 'loading') {
//   document.addEventListener('DOMContentLoaded', () => contentManager.initialize());
// } else {
//   contentManager.initialize();
// }

// // Also initialize on page show (for back/forward navigation)
// window.addEventListener('pageshow', () => contentManager.initialize());

// // Re-initialize after a short delay for dynamic content
// setTimeout(() => contentManager.initialize(), 1000);

// // Cleanup on page unload
// window.addEventListener('beforeunload', () => contentManager.cleanup());


// platforms/recruitee/recruitee.js
import BasePlatform from '../base-platform.js';

export default class RecruiteePlatform extends BasePlatform {
  constructor(config) {
    super(config);
    this.platform = 'recruitee';
    this.searchQuery = config.searchQuery || 'software engineer';
    this.jobsOnCurrentPage = [];
    this.currentPageIndex = 0;
    this.processedUrls = new Set();
  }

  async initialize() {
    await super.initialize();
    this.log('🔍 Recruitee platform initialized');
  }

  async start(params = {}) {
    this.isRunning = true;
    this.log('🚀 Starting Recruitee automation');

    try {
      // Update config with any new parameters  
      this.config = { ...this.config, ...params };

      // Ensure DOM is ready
      if (document.readyState !== 'complete') {
        this.log('⏳ Waiting for DOM to be ready...');
        await this.waitForPageLoad();
      }

      this.log('📍 Current URL: ' + window.location.href);

      // Determine if we're on Google search or Recruitee site
      if (window.location.href.includes('google.com')) {
        await this.handleGoogleSearchPage();
      } else if (window.location.href.includes('recruitee.com')) {
        await this.handleRecruiteePage();
      } else {
        // Navigate to Google search for Recruitee jobs
        await this.navigateToGoogleSearch();
      }

    } catch (error) {
      this.reportError(error, { phase: 'start' });
    }
  }

  async navigateToGoogleSearch() {
    const searchUrl = `https://www.google.com/search?q=site:recruitee.com+${encodeURIComponent(this.searchQuery)}`;
    this.log(`📍 Navigating to Google search: ${searchUrl}`);
    
    await this.navigateToUrl(searchUrl);
    await this.waitForPageLoad();
    await this.handleGoogleSearchPage();
  }

  async handleGoogleSearchPage() {
    this.log('🔍 Processing Google search results for Recruitee jobs');

    // Wait for search results
    await this.waitForElement('#search, .g');

    // Start automation loop for Google search results
    await this.googleSearchLoop();
  }

  async googleSearchLoop() {
    while (this.isRunning && this.progress.completed < this.progress.total) {
      if (this.isPaused) {
        await this.delay(1000);
        continue;
      }

      try {
        // Get Recruitee job links from current search page
        const jobLinks = await this.getRecruiteeJobLinks();
        
        if (jobLinks.length === 0) {
          this.log('❌ No Recruitee job links found on this page');
          break;
        }

        // Process each job link
        for (const jobLink of jobLinks) {
          if (!this.isRunning || this.progress.completed >= this.progress.total) {
            break;
          }

          if (this.isPaused) {
            await this.delay(1000);
            continue;
          }

          await this.processJobFromSearch(jobLink);
        }

        // Go to next page of search results
        const hasNextPage = await this.goToNextSearchPage();
        if (!hasNextPage) {
          this.log('📄 No more search result pages');
          break;
        }

      } catch (error) {
        this.reportError(error, { phase: 'googleSearchLoop' });
        await this.delay(5000);
      }
    }

    this.reportComplete();
  }

  async getRecruiteeJobLinks() {
    // Find all Google search result links that point to recruitee.com
    const searchResults = this.findElements('#search .g a[href*="recruitee.com"]');
    
    const jobLinks = [];
    
    for (const link of searchResults) {
      const href = link.href;
      
      // Filter for actual job pages (not company pages)
      if (href.includes('/careers/') || 
          href.includes('/jobs/') || 
          href.includes('/job/') ||
          href.includes('/vacancy/') ||
          href.includes('/position/')) {
        
        // Avoid duplicates
        if (!this.processedUrls.has(href)) {
          const title = link.textContent?.trim() || 'Unknown Job';
          
          jobLinks.push({
            url: href,
            title: title,
            source: 'google_search'
          });
          
          this.processedUrls.add(href);
        }
      }
    }
    
    this.log(`📊 Found ${jobLinks.length} new Recruitee job links`);
    return jobLinks.slice(0, 10); // Limit to first 10 per page
  }

  async processJobFromSearch(jobLink) {
    try {
      this.updateProgress({
        current: `Processing: ${jobLink.title}`
      });

      // Check if already applied
      if (this.shouldSkipJob(jobLink.url)) {
        this.log(`⏭️ Skipping already applied job: ${jobLink.title}`);
        this.progress.skipped++;
        this.updateProgress({ skipped: this.progress.skipped });
        return;
      }

      // Open job in new tab/window or navigate directly
      this.log(`🔗 Opening job: ${jobLink.url}`);
      await this.navigateToUrl(jobLink.url);
      await this.waitForPageLoad();
      await this.delay(2000);

      // Now we're on the Recruitee job page
      await this.handleRecruiteePage();

    } catch (error) {
      this.reportError(error, { jobLink });
      this.progress.failed++;
      this.updateProgress({ failed: this.progress.failed });
    }

    // Delay between job applications
    await this.delay(this.getRandomDelay(4000, 8000));
  }

  async handleRecruiteePage() {
    this.log('💼 Processing Recruitee job page');

    try {
      // Extract job data from the page
      const jobData = await this.extractRecruiteeJobData();
      
      // Look for apply button
      const applyButton = this.findApplyButton();
      
      if (!applyButton) {
        this.log(`⏭️ No apply button found for: ${jobData.title}`);
        this.progress.skipped++;
        this.updateProgress({ skipped: this.progress.skipped });
        return;
      }

      // Apply to the job
      const applied = await this.applyToRecruiteeJob(jobData);
      if (applied) {
        this.reportApplicationSubmitted(jobData, { method: 'Recruitee Application' });
      } else {
        this.progress.failed++;
        this.updateProgress({ failed: this.progress.failed });
      }

    } catch (error) {
      this.reportError(error, { action: 'handleRecruiteePage' });
      this.progress.failed++;
      this.updateProgress({ failed: this.progress.failed });
    }
  }

  findApplyButton() {
    const applySelectors = [
      'button[type="submit"]',
      '.apply-button',
      'a[href*="apply"]',
      'button[class*="apply"]',
      'a[class*="apply"]',
      '[data-testid="apply"]',
      '.btn-apply',
      '.application-button'
    ];

    for (const selector of applySelectors) {
      const button = this.findElement(selector);
      if (button) {
        const buttonText = button.textContent?.toLowerCase() || '';
        if (buttonText.includes('apply') || 
            buttonText.includes('solliciteren') || 
            buttonText.includes('postuler')) {
          return button;
        }
      }
    }

    return null;
  }

  async extractRecruiteeJobData() {
    // Try multiple selectors for job data extraction
    const titleSelectors = [
      'h1',
      '.job-title',
      '[data-test="job-title"]',
      '.position-title',
      '.vacancy-title'
    ];

    const companySelectors = [
      '.company-name',
      '[data-test="company-name"]',
      '.employer-name',
      '.organization-name'
    ];

    const locationSelectors = [
      '.location',
      '.job-location',
      '[data-test="location"]',
      '.workplace-location'
    ];

    return {
      title: this.extractText(titleSelectors) || 'Unknown Title',
      company: this.extractText(companySelectors) || 'Unknown Company',
      location: this.extractText(locationSelectors) || 'Unknown Location',
      url: window.location.href,
      platform: 'recruitee',
      extractedAt: Date.now()
    };
  }

  async applyToRecruiteeJob(jobData) {
    try {
      this.log(`📝 Applying to: ${jobData.title} at ${jobData.company}`);

      // Find and click apply button
      const applyButton = this.findApplyButton();
      if (!applyButton) {
        throw new Error('Apply button not found');
      }

      // Click apply button
      applyButton.click();
      await this.delay(3000);

      // Wait for application form or redirect
      await this.waitForElement('form, .application-form, [class*="form"]', 10000);

      // Fill application form
      await this.fillRecruiteeForm();

      // Submit form
      const submitted = await this.submitRecruiteeForm();
      
      if (submitted) {
        this.log('✅ Application submitted successfully');
        return true;
      } else {
        throw new Error('Failed to submit application');
      }

    } catch (error) {
      this.log(`❌ Failed to apply: ${error.message}`);
      return false;
    }
  }

  async fillRecruiteeForm() {
    const formData = this.config.preferences || {};
    
    // Use base platform form filling
    const result = await this.fillForm(formData);
    this.log(`📝 Filled ${result.fieldsFilled}/${result.fieldsFound} form fields`);

    // Handle Recruitee-specific fields
    await this.handleRecruiteeSpecificFields(formData);
  }

  async handleRecruiteeSpecificFields(formData) {
    // Cover letter / motivation letter
    const coverLetterSelectors = [
      'textarea[name*="cover"]',
      'textarea[name*="motivation"]',
      'textarea[id*="cover"]',
      'textarea[id*="motivation"]',
      'textarea[placeholder*="motivation"]'
    ];

    for (const selector of coverLetterSelectors) {
      const textarea = this.findElement(selector);
      if (textarea && formData.coverLetter) {
        await this.fillTextField(textarea, formData.coverLetter);
        break;
      }
    }

    // File upload for resume (highlight for user attention)
    const fileInputs = this.findElements('input[type="file"]');
    fileInputs.forEach(input => {
      if (input.accept?.includes('pdf') || input.name?.includes('cv') || input.name?.includes('resume')) {
        // Highlight the file input for user attention
        input.style.border = '3px solid #FF9800';
        input.style.boxShadow = '0 0 10px #FF9800';
        
        // Add tooltip
        const tooltip = document.createElement('div');
        tooltip.textContent = 'Please upload your resume here';
        tooltip.style.cssText = `
          position: absolute;
          background: #FF9800;
          color: white;
          padding: 4px 8px;
          border-radius: 4px;
          font-size: 12px;
          z-index: 10000;
          pointer-events: none;
        `;
        
        const rect = input.getBoundingClientRect();
        tooltip.style.top = (rect.top - 30) + 'px';
        tooltip.style.left = rect.left + 'px';
        
        document.body.appendChild(tooltip);
        
        // Remove highlight after 10 seconds
        setTimeout(() => {
          input.style.border = '';
          input.style.boxShadow = '';
          tooltip.remove();
        }, 10000);
      }
    });
  }

  async submitRecruiteeForm() {
    // Look for submit button
    const submitSelectors = [
      'button[type="submit"]',
      'input[type="submit"]',
      'button[class*="submit"]',
      'button[class*="send"]',
      '.submit-button',
      '.send-button'
    ];

    for (const selector of submitSelectors) {
      const button = this.findElement(selector);
      if (button) {
        const buttonText = button.textContent?.toLowerCase() || '';
        if (buttonText.includes('submit') || 
            buttonText.includes('send') || 
            buttonText.includes('apply') ||
            buttonText.includes('verstuur') ||
            buttonText.includes('envoyer')) {
          
          button.click();
          await this.delay(3000);
          
          // Check for success indication
          return await this.checkSubmissionSuccess();
        }
      }
    }

    return false;
  }

  async checkSubmissionSuccess() {
    // Look for success indicators
    const successSelectors = [
      '.success',
      '.confirmation',
      '.thank-you',
      '[class*="success"]',
      '[class*="confirmation"]',
      '[class*="thank"]'
    ];

    for (const selector of successSelectors) {
      if (this.findElement(selector)) {
        return true;
      }
    }

    // Check if URL changed to confirmation page
    if (window.location.href.includes('confirmation') || 
        window.location.href.includes('thank') ||
        window.location.href.includes('success')) {
      return true;
    }

    // Check page content for success messages
    const pageText = document.body.textContent?.toLowerCase() || '';
    const successKeywords = ['thank you', 'application submitted', 'successfully applied', 'received your application'];
    
    return successKeywords.some(keyword => pageText.includes(keyword));
  }

  async goToNextSearchPage() {
    try {
      // Look for next page button in Google search
      const nextButton = this.findElement('a[id="pnnext"], a[aria-label="Next"]');
      
      if (!nextButton) {
        return false;
      }

      // Click next page
      nextButton.click();
      await this.delay(3000);
      
      // Wait for new search results
      await this.waitForElement('#search, .g');

      this.currentPageIndex++;
      this.log(`📄 Navigated to search results page ${this.currentPageIndex + 1}`);

      return true;

    } catch (error) {
      this.reportError(error, { action: 'goToNextSearchPage' });
      return false;
    }
  }

  // Handle DOM changes (called by content script)
  onDOMChange() {
    // Re-scan for jobs if we're on Google search
    if (this.isRunning && !this.isPaused && window.location.href.includes('google.com')) {
      setTimeout(() => {
        this.getRecruiteeJobLinks().catch(console.error);
      }, 1000);
    }
  }

  // Handle navigation (called by content script)
  onNavigation(oldUrl, newUrl) {
    this.log(`🔄 Navigation detected: ${oldUrl} → ${newUrl}`);
    
    // Handle transitions between Google search and Recruitee pages
    if (newUrl.includes('recruitee.com') && oldUrl.includes('google.com')) {
      this.log('📍 Navigated from Google search to Recruitee job page');
    } else if (newUrl.includes('google.com') && oldUrl.includes('recruitee.com')) {
      this.log('📍 Navigated back to Google search from Recruitee');
    }
  }
}