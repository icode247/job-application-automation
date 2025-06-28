// content/content-injector.js
export default class ContentInjector {
  constructor() {
    this.injectedScripts = new Set();
    this.observers = new Map();
    this.isInjecting = false;
  }

  async injectPlatformScript(platform, sessionId) {
    if (this.isInjecting) return;
    this.isInjecting = true;

    try {
      const scriptKey = `${platform}-${sessionId}`;

      if (this.injectedScripts.has(scriptKey)) {
        console.log(`Script already injected for ${platform}`);
        return true;
      }

      // Inject platform-specific automation scripts
      const success = await this.loadPlatformScript(platform, sessionId);

      if (success) {
        this.injectedScripts.add(scriptKey);
        console.log(`✅ Successfully injected ${platform} automation script`);
      }

      return success;
    } catch (error) {
      console.error(`❌ Failed to inject ${platform} script:`, error);
      return false;
    } finally {
      this.isInjecting = false;
    }
  }

  async loadPlatformScript(platform, sessionId) {
    try {
      // Create a script element that will handle platform-specific logic
      const script = document.createElement("script");
      script.type = "module";
      script.id = `automation-${platform}-${sessionId}`;

      // Inject the automation logic directly as a data URL
      const scriptContent = this.generatePlatformScript(platform, sessionId);
      const blob = new Blob([scriptContent], {
        type: "application/javascript",
      });
      script.src = URL.createObjectURL(blob);

      // Add to page
      document.head.appendChild(script);

      // Wait for script to load
      return new Promise((resolve) => {
        script.onload = () => {
          URL.revokeObjectURL(script.src);
          resolve(true);
        };
        script.onerror = () => {
          URL.revokeObjectURL(script.src);
          resolve(false);
        };
      });
    } catch (error) {
      console.error("Error loading platform script:", error);
      return false;
    }
  }

  generatePlatformScript(platform, sessionId) {
    return `
      // Platform-specific automation helper for ${platform}
      (function() {
        const platform = '${platform}';
        const sessionId = '${sessionId}';
        
        // Platform-specific selectors and configurations
        const config = ${JSON.stringify(this.getPlatformConfig(platform))};
        
        // Helper functions
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
            
            setTimeout(() => {
              observer.disconnect();
              resolve(null);
            }, timeout);
          });
        }
        
        function highlightElements(selectors) {
          selectors.forEach(selector => {
            const elements = document.querySelectorAll(selector);
            elements.forEach(el => {
              el.style.outline = '2px solid #4CAF50';
              el.style.backgroundColor = 'rgba(76, 175, 80, 0.1)';
            });
          });
        }
        
        function simulateHumanClick(element) {
          // Simulate more human-like clicking behavior
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
          
          setTimeout(() => {
            const rect = element.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top + rect.height / 2;
            
            // Dispatch mouse events
            ['mouseover', 'mousedown', 'mouseup', 'click'].forEach(eventType => {
              const event = new MouseEvent(eventType, {
                bubbles: true,
                cancelable: true,
                clientX: x,
                clientY: y
              });
              element.dispatchEvent(event);
            });
          }, Math.random() * 500 + 200);
        }
        
        function smartFormFill(formData) {
          const inputs = document.querySelectorAll('input, textarea, select');
          let filled = 0;
          
          inputs.forEach(input => {
            if (input.type === 'hidden' || input.disabled || input.readOnly) return;
            
            const fieldId = getFieldIdentifier(input);
            const value = getValueForField(fieldId, formData);
            
            if (value) {
              fillField(input, value);
              filled++;
            }
          });
          
          return filled;
        }
        
        function getFieldIdentifier(input) {
          const attributes = [
            input.name?.toLowerCase(),
            input.id?.toLowerCase(),
            input.placeholder?.toLowerCase(),
            input.getAttribute('aria-label')?.toLowerCase(),
            input.closest('label')?.textContent?.toLowerCase()
          ].filter(Boolean).join(' ');
          
          return attributes;
        }
        
        function getValueForField(fieldId, formData) {
          const mappings = {
            'first name': formData.firstName,
            'last name': formData.lastName,
            'email': formData.email,
            'phone': formData.phone,
            'cover letter': formData.coverLetter,
            'message': formData.coverLetter,
            'why': formData.coverLetter
          };
          
          for (const [key, value] of Object.entries(mappings)) {
            if (fieldId.includes(key) && value) {
              return value;
            }
          }
          
          return null;
        }
        
        function fillField(input, value) {
          input.focus();
          input.value = value;
          
          ['input', 'change', 'blur'].forEach(eventType => {
            input.dispatchEvent(new Event(eventType, { bubbles: true }));
          });
        }
        
        // Platform-specific initialization
        function initializePlatform() {
          console.log(\`🤖 Platform automation helper loaded for \${platform}\`);
          
          // Highlight important elements based on platform
          if (config.highlightSelectors) {
            highlightElements(config.highlightSelectors);
          }
          
          // Set up platform-specific event listeners
          setupPlatformEventListeners();
        }
        
        function setupPlatformEventListeners() {
          // Listen for form submissions
          document.addEventListener('submit', (e) => {
            console.log('Form submission detected:', e.target);
            // Send message to content script about form submission
            window.dispatchEvent(new CustomEvent('automation-form-submit', {
              detail: { form: e.target, platform, sessionId }
            }));
          });
          
          // Listen for navigation
          let currentUrl = window.location.href;
          setInterval(() => {
            if (window.location.href !== currentUrl) {
              console.log('Navigation detected:', currentUrl, '->', window.location.href);
              currentUrl = window.location.href;
              
              window.dispatchEvent(new CustomEvent('automation-navigation', {
                detail: { oldUrl: currentUrl, newUrl: window.location.href, platform, sessionId }
              }));
            }
          }, 1000);
        }
        
        // Make functions available globally for the content script
        window.automationHelper = {
          waitForElement,
          highlightElements,
          simulateHumanClick,
          smartFormFill,
          platform,
          sessionId,
          config
        };
        
        // Initialize when DOM is ready
        if (document.readyState === 'loading') {
          document.addEventListener('DOMContentLoaded', initializePlatform);
        } else {
          initializePlatform();
        }
      })();
    `;
  }

  getPlatformConfig(platform) {
    const configs = {
      linkedin: {
        highlightSelectors: [
          ".jobs-apply-button",
          ".jobs-easy-apply-modal",
          ".artdeco-button--primary",
        ],
        importantElements: [
          ".jobs-search-results-list",
          ".jobs-details",
          ".jobs-easy-apply-modal",
        ],
      },
      indeed: {
        highlightSelectors: [
          '[data-testid="apply-button"]',
          'button[aria-label*="apply" i]',
          ".ia-BasePage-sidebar button",
        ],
        importantElements: [
          "[data-jk]",
          ".jobsearch-SerpJobCard",
          ".jobsearch-JobComponent",
        ],
      },
      glassdoor: {
        highlightSelectors: [
          '[data-test="easy-apply-button"]',
          ".css-1gqc91l button",
          ".apply-btn",
        ],
        importantElements: [
          '[data-test="job-link"]',
          ".react-job-listing",
          ".jobDetailsContainer",
        ],
      },
      recruitee: {
        highlightSelectors: [
          'button[type="submit"]',
          ".apply-button",
          'a[href*="apply"]',
        ],
        importantElements: [
          ".job-listing",
          ".job-details",
          ".application-form",
        ],
      },
      workday: {
        highlightSelectors: [
          'button[data-automation-id*="apply"]',
          'a[data-automation-id*="apply"]',
          ".css-1psaude button",
        ],
        importantElements: [
          '[data-automation-id="jobPostingHeader"]',
          '[data-automation-id="jobDescription"]',
          ".css-k008qs",
        ],
      },
    };

    return (
      configs[platform] || { highlightSelectors: [], importantElements: [] }
    );
  }

  removeInjectedScript(platform, sessionId) {
    const scriptKey = `${platform}-${sessionId}`;
    const scriptId = `automation-${platform}-${sessionId}`;

    const script = document.getElementById(scriptId);
    if (script) {
      script.remove();
    }

    this.injectedScripts.delete(scriptKey);

    // Clean up global automation helper
    if (window.automationHelper?.sessionId === sessionId) {
      delete window.automationHelper;
    }
  }

  cleanup() {
    // Remove all injected scripts
    for (const scriptKey of this.injectedScripts) {
      const [platform, sessionId] = scriptKey.split("-");
      this.removeInjectedScript(platform, sessionId);
    }

    this.injectedScripts.clear();
  }
}
