document.addEventListener('DOMContentLoaded', async () => {
  const openButton = document.getElementById('openAutomationWindow');
  const searchInput = document.getElementById('searchQuery');
  const loadingDiv = document.getElementById('loading');
  const automationCount = document.getElementById('automationCount');
  const currentWindowStatus = document.getElementById('currentWindowStatus');
  const exampleQueries = document.querySelectorAll('.example-query');
  
  // Handle example query clicks
  exampleQueries.forEach(example => {
    example.addEventListener('click', () => {
      const query = example.getAttribute('data-query');
      searchInput.value = query;
    });
  });
  
  // Handle opening automation window
  openButton.addEventListener('click', async () => {
    const searchQuery = searchInput.value.trim();
    
    if (!searchQuery) {
      alert('Please enter a search query');
      return;
    }
    
    // Show loading state
    openButton.disabled = true;
    loadingDiv.style.display = 'block';
    openButton.textContent = 'Opening...';
    
    try {
      // Send message to background script to open automation window
      const response = await chrome.runtime.sendMessage({
        action: 'openAutomationWindow',
        searchQuery: searchQuery
      });
      
      if (response.success) {
        // Update status after a short delay
        setTimeout(updateStatus, 500);
        
        // Show success feedback
        openButton.textContent = '✅ Window Opened!';
        setTimeout(() => {
          openButton.textContent = '🚀 Open Automation Window';
          openButton.disabled = false;
        }, 2000);
      } else {
        throw new Error('Failed to open automation window');
      }
    } catch (error) {
      console.error('Error opening automation window:', error);
      alert('Error opening automation window. Please try again.');
      openButton.textContent = '🚀 Open Automation Window';
      openButton.disabled = false;
    } finally {
      loadingDiv.style.display = 'none';
    }
  });
  
  // Handle Enter key in search input
  searchInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      openButton.click();
    }
  });
  
  // Update status information
  async function updateStatus() {
    try {
      // Get automation windows count
      const countResponse = await chrome.runtime.sendMessage({
        action: 'getAutomationWindowsCount'
      });
      
      if (countResponse && typeof countResponse.count === 'number') {
        automationCount.textContent = countResponse.count;
        automationCount.style.color = countResponse.count > 0 ? '#4CAF50' : '#666';
      }
      
      // Check if current window/tab is an automation window
      const currentResponse = await chrome.runtime.sendMessage({
        action: 'checkIfAutomationWindow'
      });
      
      if (currentResponse && currentResponse.isAutomationWindow) {
        currentWindowStatus.innerHTML = '✅ <strong>This is an automation window</strong>';
        currentWindowStatus.style.color = '#4CAF50';
      } else {
        currentWindowStatus.innerHTML = '❌ This is a regular window';
        currentWindowStatus.style.color = '#666';
      }
    } catch (error) {
      console.error('Error updating status:', error);
      currentWindowStatus.innerHTML = '❓ Unable to check status';
      currentWindowStatus.style.color = '#f44336';
    }
  }
  
  // Initial status update
  await updateStatus();
  
  // Update status every 2 seconds
  setInterval(updateStatus, 2000);
  
  // Focus on search input for better UX
  searchInput.focus();
  searchInput.select();
});

// Handle messages from background script (if needed)
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'updatePopupStatus') {
    // Handle any status updates from background script
    console.log('Status update received:', request);
  }
});