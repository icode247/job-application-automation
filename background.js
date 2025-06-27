// Storage key for tracking automation windows
const AUTOMATION_WINDOWS_KEY = 'automationWindows';

// Track automation windows in memory for faster access
let automationWindows = new Set();

// Initialize automation windows from storage
chrome.runtime.onStartup.addListener(async () => {
  await loadAutomationWindows();
});

chrome.runtime.onInstalled.addListener(async () => {
  await loadAutomationWindows();
});

// Load automation windows from storage
async function loadAutomationWindows() {
  try {
    const result = await chrome.storage.local.get(AUTOMATION_WINDOWS_KEY);
    if (result[AUTOMATION_WINDOWS_KEY]) {
      automationWindows = new Set(result[AUTOMATION_WINDOWS_KEY]);
    }
  } catch (error) {
    console.error('Error loading automation windows:', error);
  }
}

// Save automation windows to storage
async function saveAutomationWindows() {
  try {
    await chrome.storage.local.set({
      [AUTOMATION_WINDOWS_KEY]: Array.from(automationWindows)
    });
  } catch (error) {
    console.error('Error saving automation windows:', error);
  }
}

// Handle messages from popup and content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    switch (request.action) {
      case 'openAutomationWindow':
        await openAutomationWindow(request.searchQuery);
        sendResponse({ success: true });
        break;
        
      case 'checkIfAutomationWindow':
        const isAutomationWindow = sender.tab ? automationWindows.has(sender.tab.windowId) : false;
        sendResponse({ isAutomationWindow });
        break;
        
      case 'getAutomationWindowsCount':
        sendResponse({ count: automationWindows.size });
        break;
        
      default:
        sendResponse({ error: 'Unknown action' });
    }
  })();
  
  return true; // Keep message channel open for async response
});

// Open a new window for automation
async function openAutomationWindow(searchQuery = 'site:recruitee.com Software Engineer San Francisco') {
  try {
    const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(searchQuery)}`;
    
    const window = await chrome.windows.create({
      url: searchUrl,
      type: 'normal',
      focused: true
    });
    
    // Track this window as an automation window
    automationWindows.add(window.id);
    await saveAutomationWindows();
    
    console.log(`Opened automation window ${window.id} with search: ${searchQuery}`);
    
    // Inject automation flag into the window
    setTimeout(async () => {
      try {
        if (window.tabs && window.tabs[0]) {
          await chrome.scripting.executeScript({
            target: { tabId: window.tabs[0].id },
            func: () => {
              window.isAutomationWindow = true;
              sessionStorage.setItem('automationWindow', 'true');
            }
          });
        }
      } catch (error) {
        console.error('Error injecting automation flag:', error);
      }
    }, 100);
    
  } catch (error) {
    console.error('Error opening automation window:', error);
  }
}

// Clean up when windows are closed
chrome.windows.onRemoved.addListener(async (windowId) => {
  if (automationWindows.has(windowId)) {
    automationWindows.delete(windowId);
    await saveAutomationWindows();
    console.log(`Cleaned up automation window ${windowId}`);
  }
});

// Clean up invalid window IDs periodically
setInterval(async () => {
  try {
    const allWindows = await chrome.windows.getAll();
    const validWindowIds = new Set(allWindows.map(w => w.id));
    
    let hasChanges = false;
    for (const windowId of automationWindows) {
      if (!validWindowIds.has(windowId)) {
        automationWindows.delete(windowId);
        hasChanges = true;
      }
    }
    
    if (hasChanges) {
      await saveAutomationWindows();
    }
  } catch (error) {
    console.error('Error cleaning up automation windows:', error);
  }
}, 30000); // Clean up every 30 seconds