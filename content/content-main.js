// content/content-main.js - Simplified approach based on working code
// Flag to prevent multiple initializations
let automationInitialized = false;

// Check if this is an automation window and initialize if needed
async function initializeAutomation() {
  if (automationInitialized) return;
  
  try {
    // Check multiple sources to determine if this is an automation window
    const isAutomationWindow = await checkIfAutomationWindow();
    
    if (isAutomationWindow) {
      automationInitialized = true;
      await runAutomation();
    }
  } catch (error) {
    console.error('Error initializing automation:', error);
  }
}

// Check if current window/tab is part of automation (based on working code)
async function checkIfAutomationWindow() {
  console.log('🔍 Checking automation window status...');
  
  // Method 1: Check window flag (set by background script)
  if (window.isAutomationWindow) {
    console.log('✅ Method 1: Window flag detected');
    return true;
  }
  
  // Method 2: Check sessionStorage flag (more persistent)
  const automationFlag = sessionStorage.getItem('automationWindow');
  const sessionId = sessionStorage.getItem('automationSessionId');
  const platform = sessionStorage.getItem('automationPlatform');
  
  console.log('🔍 SessionStorage check:', { automationFlag, sessionId, platform });
  
  if (automationFlag === 'true') {
    window.isAutomationWindow = true;
    // Also set the session data on window object
    if (sessionId) window.automationSessionId = sessionId;
    if (platform) window.automationPlatform = platform;
    console.log('✅ Method 2: SessionStorage flag detected');
    return true;
  }
  
  // Method 3: Ask background script to check window ID (like working code)
  try {
    console.log('🔍 Method 3: Asking background script...');
    const response = await chrome.runtime.sendMessage({
      action: 'checkIfAutomationWindow'
    });
    
    console.log('🔍 Background response:', response);
    
    if (response && response.isAutomationWindow) {
      window.isAutomationWindow = true;
      sessionStorage.setItem('automationWindow', 'true');
      console.log('✅ Method 3: Background confirmed automation window');
      return true;
    }
  } catch (error) {
    console.error('❌ Error checking automation window status:', error);
  }
  
  console.log('❌ Not an automation window');
  return false;
}

// Main automation logic - enhanced version of working code
async function runAutomation() {
  console.log('🤖 Automation is ACTIVE in this window!');
  
  // Get session data from multiple sources
  let sessionId = window.automationSessionId || sessionStorage.getItem('automationSessionId');
  let platform = window.automationPlatform || sessionStorage.getItem('automationPlatform');
  const preferencesJson = sessionStorage.getItem('automationPreferences');
  let preferences = {};
  
  // Try to parse preferences
  try {
    if (preferencesJson) {
      preferences = JSON.parse(preferencesJson);
    }
  } catch (e) {
    console.warn('Could not parse automation preferences');
  }
  
  console.log('🔍 Session data:', { sessionId, platform, preferences });
  
  // If we don't have session data yet, wait for it or detect platform
  if (!sessionId || !platform) {
    console.log('⏳ Missing session data, setting up listener and fallback detection...');
    
    // Set up listener for context injection
    window.addEventListener('automationContextReady', (event) => {
      console.log('🎯 Automation context ready event received:', event.detail);
      sessionId = event.detail.sessionId;
      platform = event.detail.platform;
      preferences = event.detail.preferences || {};
      
      // Update session storage
      sessionStorage.setItem('automationSessionId', sessionId);
      sessionStorage.setItem('automationPlatform', platform);
      
      // Re-run automation with new data
      setTimeout(() => {
        addAutomationIndicator(platform, sessionId);
        setupPageAutomation(platform, preferences);
      }, 500);
    });
    
    // Fallback: detect platform from URL
    platform = detectPlatformFromUrl(window.location.href);
    sessionId = sessionId || 'unknown-' + Date.now();
    
    console.log('🔄 Using fallback detection:', { platform, sessionId });
  }
  
  // Add visual indicator
  addAutomationIndicator(platform, sessionId);
  
  // Set up automation for current page
  await setupPageAutomation(platform, preferences);
  
  // Listen for navigation within the window
  setupNavigationListener(platform, preferences);
  
  // Handle new tabs opened in this window (simplified)
  setupNewTabHandler();
}

// Add visual indicator that automation is active (enhanced from working code)
function addAutomationIndicator(platform, sessionId) {
  // Remove existing indicator if present
  const existing = document.getElementById('automation-indicator');
  if (existing) existing.remove();
  
  // Handle undefined/null values
  const displayPlatform = platform && platform !== 'unknown' ? platform.toUpperCase() : 'UNKNOWN';
  const displaySessionId = sessionId && sessionId !== 'unknown' ? sessionId.slice(-6) : 'NO-ID';
  
  console.log(`🎯 Adding indicator: ${displayPlatform} • ${displaySessionId}`);
  
  const indicator = document.createElement('div');
  indicator.id = 'automation-indicator';
  indicator.innerHTML = `
    <div style="
      position: fixed;
      top: 10px;
      right: 10px;
      background: linear-gradient(135deg, #4CAF50, #45a049);
      color: white;
      padding: 12px 16px;
      border-radius: 8px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
      font-size: 13px;
      font-weight: 600;
      z-index: 999999;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      border: 1px solid rgba(255,255,255,0.2);
      backdrop-filter: blur(10px);
      cursor: pointer;
      transition: all 0.3s ease;
    " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
      <div style="display: flex; align-items: center; gap: 8px;">
        <span style="font-size: 16px;">🤖</span>
        <div>
          <div style="font-weight: 700;">AUTOMATION ACTIVE</div>
          <div style="font-size: 11px; opacity: 0.9;">${displayPlatform} • ${displaySessionId}</div>
        </div>
      </div>
    </div>
  `;
  
  // Add click handler to show debug info
  indicator.addEventListener('click', () => {
    console.log('🔍 Debug Info:', {
      platform,
      sessionId,
      url: window.location.href,
      windowFlags: {
        isAutomationWindow: window.isAutomationWindow,
        automationSessionId: window.automationSessionId,
        automationPlatform: window.automationPlatform
      },
      sessionStorage: {
        automationWindow: sessionStorage.getItem('automationWindow'),
        automationSessionId: sessionStorage.getItem('automationSessionId'),
        automationPlatform: sessionStorage.getItem('automationPlatform')
      }
    });
  });
  
  document.documentElement.appendChild(indicator);
}

// Set up automation for the current page (enhanced from working code)
async function setupPageAutomation(platform, preferences = {}) {
  const currentUrl = window.location.href;
  console.log(`🔧 Setting up automation for: ${currentUrl}`);
  console.log(`🔧 Platform: ${platform}, Preferences:`, preferences);
  
  // Detect platform from URL if not provided or unknown
  let detectedPlatform = platform;
  if (!platform || platform === 'unknown') {
    detectedPlatform = detectPlatformFromUrl(currentUrl);
    console.log(`🔍 Detected platform from URL: ${detectedPlatform}`);
  }
  
  // Load and run platform-specific automation
  try {
    console.log(`📦 Attempting to load platform module: ${detectedPlatform}`);
    const PlatformClass = await loadPlatformModule(detectedPlatform);
    
    if (PlatformClass) {
      console.log(`✅ Platform module loaded: ${detectedPlatform}`);
      const platformAutomation = new PlatformClass({
        sessionId: sessionStorage.getItem('automationSessionId'),
        platform: detectedPlatform,
        preferences: preferences,
        config: preferences
      });
      
      await platformAutomation.initialize();
      
      // Store platform automation globally for navigation events
      window.currentPlatformAutomation = platformAutomation;
      
      // Start platform automation if it has a start method
      if (platformAutomation.start) {
        console.log(`🚀 Starting platform automation: ${detectedPlatform}`);
        await platformAutomation.start(preferences);
      }
    } else {
      console.log(`⚠️ No platform module for ${detectedPlatform}, using generic automation`);
      // Fallback to basic automation for unsupported platforms
      await handleGenericJob(currentUrl);
    }
  } catch (error) {
    console.error(`❌ Error setting up platform automation for ${detectedPlatform}:`, error);
    console.log(`🔄 Falling back to generic automation`);
    // Fallback to basic automation
    await handleGenericJob(currentUrl);
  }
}

// Load platform-specific automation module
async function loadPlatformModule(platform) {
  try {
    switch (platform) {
      case 'linkedin':
        const { default: LinkedInPlatform } = await import('../platforms/linkedin/linkedin.js');
        return LinkedInPlatform;
        
      case 'indeed':
        const { default: IndeedPlatform } = await import('../platforms/indeed/indeed.js');
        return IndeedPlatform;
        
      case 'recruitee':
        const { default: RecruiteePlatform } = await import('../platforms/recruitee/recruitee.js');
        return RecruiteePlatform;
        
      case 'glassdoor':
        const { default: GlassdoorPlatform } = await import('../platforms/glassdoor/glassdoor.js');
        return GlassdoorPlatform;
        
      case 'workday':
        const { default: WorkdayPlatform } = await import('../platforms/workday/workday.js');
        return WorkdayPlatform;
        
      default:
        console.warn(`Platform ${platform} not supported, using generic automation`);
        return null;
    }
  } catch (error) {
    console.error(`Failed to load platform module for ${platform}:`, error);
    return null;
  }
}

// Detect platform from URL
function detectPlatformFromUrl(url) {
  const urlLower = url.toLowerCase();
  
  if (urlLower.includes('linkedin.com')) return 'linkedin';
  if (urlLower.includes('indeed.com')) return 'indeed';
  if (urlLower.includes('recruitee.com')) return 'recruitee';
  if (urlLower.includes('glassdoor.com')) return 'glassdoor';
  if (urlLower.includes('myworkdayjobs.com')) return 'workday';
  if (urlLower.includes('lever.co')) return 'lever';
  if (urlLower.includes('greenhouse.io')) return 'greenhouse';
  
  // Handle Google search for specific platforms
  if (urlLower.includes('google.com/search')) {
    const urlObj = new URL(url);
    const query = urlObj.searchParams.get('q') || '';
    
    if (query.includes('site:recruitee.com') || query.includes('recruitee.com')) return 'recruitee';
    if (query.includes('site:myworkdayjobs.com') || query.includes('myworkdayjobs.com')) return 'workday';
    if (query.includes('site:lever.co') || query.includes('lever.co')) return 'lever';
    if (query.includes('site:linkedin.com') || query.includes('linkedin.com/jobs')) return 'linkedin';
    if (query.includes('site:indeed.com') || query.includes('indeed.com')) return 'indeed';
    if (query.includes('site:glassdoor.com') || query.includes('glassdoor.com')) return 'glassdoor';
  }
  
  return 'unknown';
}

// Handle Google search page (from working code)
async function handleGoogleSearch() {
  console.log('🔍 Automating Google search page');
  
  // Wait for search results to load
  await waitForElement('.g');
  
  // Highlight job-related links
  const jobLinks = document.querySelectorAll('a[href*="recruitee"], a[href*="linkedin.com/jobs"], a[href*="indeed"], a[href*="glassdoor"], a[href*="myworkdayjobs"], a[href*="lever.co"]');
  
  jobLinks.forEach((link, index) => {
    link.style.border = '2px solid #4CAF50';
    link.style.backgroundColor = '#e8f5e8';
    
    // Auto-click first job link after 3 seconds (demo purposes)
    if (index === 0) {
      setTimeout(() => {
        console.log('🎯 Auto-clicking first job link');
        link.click();
      }, 3000);
    }
  });
}

// Handle Recruitee job pages (from working code)
async function handleRecruiteeJob() {
  console.log('💼 Automating Recruitee job page');
  
  // Wait for apply button
  await waitForElement('[data-testid="apply-button"], .apply-button, button[type="submit"]');
  
  // Highlight apply button
  const applyButton = document.querySelector('[data-testid="apply-button"], .apply-button, button[type="submit"]');
  if (applyButton) {
    applyButton.style.border = '3px solid #FF9800';
    applyButton.style.boxShadow = '0 0 10px #FF9800';
    
    // Add click handler (for demo - in real automation you'd fill forms first)
    applyButton.addEventListener('click', (e) => {
      console.log('📝 Apply button clicked - automation would handle form filling here');
    });
  }
}

// Handle LinkedIn job pages (from working code)
async function handleLinkedInJob() {
  console.log('💼 Automating LinkedIn job page');
  
  // Similar to Recruitee but with LinkedIn-specific selectors
  await waitForElement('.jobs-apply-button, .jobs-s-apply__button');
  
  const applyButton = document.querySelector('.jobs-apply-button, .jobs-s-apply__button');
  if (applyButton) {
    applyButton.style.border = '3px solid #0077B5';
    applyButton.style.boxShadow = '0 0 10px #0077B5';
  }
}

// Handle other job sites (from working code)
async function handleGenericJob(currentUrl) {
  console.log('🌐 Automating generic job page');
  
  // Handle specific platforms first
  if (currentUrl.includes('google.com/search')) {
    return await handleGoogleSearch();
  } else if (currentUrl.includes('recruitee.com')) {
    return await handleRecruiteeJob();
  } else if (currentUrl.includes('linkedin.com/jobs')) {
    return await handleLinkedInJob();
  }
  
  // Look for common apply button patterns
  const applySelectors = [
    'button[class*="apply"]',
    'a[class*="apply"]',
    'button[id*="apply"]',
    'a[href*="apply"]',
    'input[value*="Apply"]'
  ];
  
  for (const selector of applySelectors) {
    const button = document.querySelector(selector);
    if (button) {
      button.style.border = '3px solid #9C27B0';
      button.style.boxShadow = '0 0 10px #9C27B0';
      break;
    }
  }
}

// Set up listener for navigation within the automation window (from working code)
function setupNavigationListener(platform, preferences) {
  // Listen for URL changes (for SPAs)
  let currentUrl = window.location.href;
  
  const urlChangeObserver = new MutationObserver(() => {
    if (window.location.href !== currentUrl) {
      const oldUrl = currentUrl;
      currentUrl = window.location.href;
      console.log(`🔄 Navigation detected: ${oldUrl} → ${currentUrl}`);
      
      // Re-run automation for new page
      setTimeout(() => setupPageAutomation(platform, preferences), 1000);
    }
  });
  
  urlChangeObserver.observe(document, {
    subtree: true,
    childList: true
  });

  // Also listen for popstate events
  window.addEventListener('popstate', () => {
    setTimeout(() => setupPageAutomation(platform, preferences), 1000);
  });
}

// Handle new tabs opened within the automation window (from working code)
function setupNewTabHandler() {
  // Override window.open to mark new tabs as automation tabs
  const originalOpen = window.open;
  window.open = function(...args) {
    const newWindow = originalOpen.apply(this, args);
    
    // Try to set automation flag in new window (might be blocked by CORS)
    try {
      if (newWindow) {
        setTimeout(() => {
          try {
            newWindow.isAutomationWindow = true;
            newWindow.sessionStorage.setItem('automationWindow', 'true');
            
            // Also transfer session data
            const sessionId = sessionStorage.getItem('automationSessionId');
            const platform = sessionStorage.getItem('automationPlatform');
            const preferences = sessionStorage.getItem('automationPreferences');
            
            if (sessionId) newWindow.sessionStorage.setItem('automationSessionId', sessionId);
            if (platform) newWindow.sessionStorage.setItem('automationPlatform', platform);
            if (preferences) newWindow.sessionStorage.setItem('automationPreferences', preferences);
          } catch (e) {
            // Silently fail if blocked by CORS
          }
        }, 100);
      }
    } catch (e) {
      // Silently fail
    }
    
    return newWindow;
  };
  
  // Also handle clicks on links that open in new tabs
  document.addEventListener('click', (e) => {
    const link = e.target.closest('a');
    if (link && (link.target === '_blank' || e.ctrlKey || e.metaKey)) {
      // Link will open in new tab - the new tab should inherit automation status
      // through sessionStorage or background script tracking
      console.log('🔗 Link opening in new tab detected');
    }
  });
}

// Utility function to wait for an element (from working code)
function waitForElement(selector, timeout = 10000) {
  return new Promise((resolve) => {
    const element = document.querySelector(selector);
    if (element) {
      resolve(element);
      return;
    }
    
    const observer = new MutationObserver((mutations, obs) => {
      const element = document.querySelector(selector);
      if (element) {
        obs.disconnect();
        resolve(element);
      }
    });
    
    observer.observe(document, {
      childList: true,
      subtree: true
    });
    
    // Timeout fallback
    setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeout);
  });
}

// Initialize automation when page loads (from working code)
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeAutomation);
} else {
  initializeAutomation();
}

// Also initialize on page show (for back/forward navigation)
window.addEventListener('pageshow', initializeAutomation);

// Re-initialize after a short delay (for dynamic content)
setTimeout(initializeAutomation, 1000);

// Mark content script as loaded
window.contentScriptLoaded = true;