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

// Check if current window/tab is part of automation
async function checkIfAutomationWindow() {
  // Method 1: Check window flag (set by background script)
  if (window.isAutomationWindow) {
    return true;
  }
  
  // Method 2: Check sessionStorage flag
  if (sessionStorage.getItem('automationWindow') === 'true') {
    window.isAutomationWindow = true;
    return true;
  }
  
  // Method 3: Ask background script to check window ID
  try {
    const response = await chrome.runtime.sendMessage({
      action: 'checkIfAutomationWindow'
    });
    
    if (response && response.isAutomationWindow) {
      window.isAutomationWindow = true;
      sessionStorage.setItem('automationWindow', 'true');
      return true;
    }
  } catch (error) {
    console.error('Error checking automation window status:', error);
  }
  
  return false;
}

// Main automation logic - this is where your job application automation would go
async function runAutomation() {
  console.log('🤖 Automation is ACTIVE in this window!');
  
  // Add visual indicator
  addAutomationIndicator();
  
  // Set up automation for current page
  await setupPageAutomation();
  
  // Listen for navigation within the window
  setupNavigationListener();
  
  // Handle new tabs opened in this window
  setupNewTabHandler();
}

// Add visual indicator that automation is active
function addAutomationIndicator() {
  // Remove existing indicator if present
  const existing = document.getElementById('automation-indicator');
  if (existing) existing.remove();
  
  const indicator = document.createElement('div');
  indicator.id = 'automation-indicator';
  indicator.innerHTML = `
    <div style="
      position: fixed;
      top: 10px;
      right: 10px;
      background: #4CAF50;
      color: white;
      padding: 8px 12px;
      border-radius: 4px;
      font-family: Arial, sans-serif;
      font-size: 12px;
      font-weight: bold;
      z-index: 10000;
      box-shadow: 0 2px 8px rgba(0,0,0,0.3);
      border: 2px solid #45a049;
    ">
      🤖 AUTOMATION ACTIVE
    </div>
  `;
  
  document.documentElement.appendChild(indicator);
}

// Set up automation for the current page
async function setupPageAutomation() {
  const currentUrl = window.location.href;
  console.log(`Setting up automation for: ${currentUrl}`);
  
  // Example automation based on current site
  if (currentUrl.includes('google.com/search')) {
    await handleGoogleSearch();
  } else if (currentUrl.includes('recruitee.com')) {
    await handleRecruiteeJob();
  } else if (currentUrl.includes('linkedin.com/jobs')) {
    await handleLinkedInJob();
  } else {
    await handleGenericJob();
  }
}

// Handle Google search page
async function handleGoogleSearch() {
  console.log('🔍 Automating Google search page');
  
  // Wait for search results to load
  await waitForElement('.g');
  
  // Highlight job-related links
  const jobLinks = document.querySelectorAll('a[href*="recruitee"], a[href*="linkedin.com/jobs"], a[href*="indeed"], a[href*="glassdoor"]');
  
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

// Handle Recruitee job pages
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

// Handle LinkedIn job pages
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

// Handle other job sites
async function handleGenericJob() {
  console.log('🌐 Automating generic job page');
  
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

// Set up listener for navigation within the automation window
function setupNavigationListener() {
  // Listen for URL changes (for SPAs)
  let currentUrl = window.location.href;
  
  const urlChangeObserver = new MutationObserver(() => {
    if (window.location.href !== currentUrl) {
      currentUrl = window.location.href;
      console.log(`🔄 Navigation detected: ${currentUrl}`);
      
      // Re-run automation for new page
      setTimeout(() => setupPageAutomation(), 1000);
    }
  });
  
  urlChangeObserver.observe(document, {
    subtree: true,
    childList: true
  });
}

// Handle new tabs opened within the automation window
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
    }
  });
}

// Utility function to wait for an element
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

// Initialize automation when page loads
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeAutomation);
} else {
  initializeAutomation();
}

// Also initialize on page show (for back/forward navigation)
window.addEventListener('pageshow', initializeAutomation);

// Re-initialize after a short delay (for dynamic content)
setTimeout(initializeAutomation, 1000);