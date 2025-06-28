# Chrome Extension Integration Guide
This guide shows how to integrate the multi-platform job automation Chrome extension with your existing frontend application.

## 🔌 Frontend Integration Steps

### 1. Update Your Existing `startJobSearch` Function

Your current function is already well-structured. Here are the minimal changes needed:

```javascript
// Update your existing startJobSearch function
export const startJobSearch = (
  userId: string,
  extensionId: string, // Get this from the loaded extension
  jobsToApply: number,
  platform: string,
  applications: string[],
  currentPlan: string,
  session: any,
  getPlanLimits: (plan: string) => any,
  getTodaysApplications: () => number,
  enqueueSnackbar: (message: React.ReactNode, options?: any) => void,
  setCreditModalOpen: (open: boolean) => void,
  setCreditModalError: (error: string) => void,
  userPreferences?: any // Add this parameter for form filling
): void => {

  // Your existing validation logic remains the same...

  try {
    const user = session.data?.user;

    // Enhanced message with user preferences
    const message = {
      action: "startApplying",
      platform,
      userId,
      jobsToApply: actualJobsToApply,
      submittedLinks: applications,
      devMode: false,
      country: user?.country as string,
      userPlan: currentPlan,
      userCredits: userCredits,
      dailyRemaining: currentPlan === "unlimited" ? Infinity : dailyRemaining,

      // New fields for enhanced automation
      preferences: userPreferences || {
        firstName: user?.firstName,
        lastName: user?.lastName,
        email: user?.email,
        phone: user?.phone,
        linkedin: user?.linkedinUrl,
        coverLetter: user?.defaultCoverLetter,
        workAuthorization: user?.workAuthorization || 'yes',
        visaSponsorship: user?.visaSponsorship || 'no'
      },
      resumeUrl: user?.resumeUrl,
      coverLetterTemplate: user?.coverLetterTemplate
    };

    console.log("Sending message to extension:", message);

    window.chrome.runtime.sendMessage(extensionId, message, (response) => {
      let chrome = window.chrome as any;

      if (chrome.runtime.lastError) {
        console.error("Chrome extension error:", chrome.runtime.lastError);
        enqueueSnackbar(
          "Failed to communicate with extension. Please refresh the page and try again.",
          { variant: "error" }
        );
        return;
      }

      // Enhanced response handling
      if (response && response.status === "started") {
        enqueueSnackbar(
          `🚀 Job search started for ${response.platform}! Session: ${response.sessionId}`,
          { variant: "success" }
        );

        // Store session ID for progress tracking
        localStorage.setItem('activeAutomationSession', response.sessionId);

        // Start progress monitoring
        startProgressMonitoring(response.sessionId, enqueueSnackbar);

      } else if (response && response.status === "error") {
        console.error("Extension returned error:", response.message);
        enqueueSnackbar(response.message || "Error starting job search. Please try again.", { variant: "error" });
      }
    });

  } catch (error) {
    console.error("Error in startJobSearch:", error);
    enqueueSnackbar("An unexpected error occurred. Please try again.", { variant: "error" });
  }
};
```

### 2. Add Progress Monitoring

```javascript
// Add this new function to monitor automation progress
function startProgressMonitoring(sessionId: string, enqueueSnackbar: any) {
  const extensionId = "your-extension-id-here";

  const checkProgress = () => {
    window.chrome.runtime.sendMessage(
      extensionId,
      {
        action: "getStatus",
        sessionId: sessionId,
      },
      (response) => {
        if (response && response.status === "success") {
          const { progress } = response;

          // Update UI with progress
          updateProgressUI(progress);

          // Continue monitoring if still running
          if (progress.status === "running") {
            setTimeout(checkProgress, 5000); // Check every 5 seconds
          } else if (progress.status === "completed") {
            enqueueSnackbar(
              `✅ Automation completed! Applied to ${progress.completed} jobs.`,
              { variant: "success" }
            );
            localStorage.removeItem("activeAutomationSession");
          } else if (progress.status === "failed") {
            enqueueSnackbar(
              `❌ Automation failed. Applied to ${progress.completed} jobs before stopping.`,
              { variant: "error" }
            );
            localStorage.removeItem("activeAutomationSession");
          }
        }
      }
    );
  };

  // Start monitoring after a short delay
  setTimeout(checkProgress, 2000);
}

function updateProgressUI(progress: any) {
  // Update your UI components with progress data
  console.log("Progress update:", progress);

  // Example: Update a progress bar
  // setProgressBarValue((progress.completed / progress.total) * 100);

  // Example: Update status text
  // setStatusText(progress.current || `${progress.completed}/${progress.total} applications completed`);
}
```

### 3. Add Session Control Functions

```javascript
// Add functions to control automation sessions
export const pauseAutomation = (sessionId: string, enqueueSnackbar: any) => {
  const extensionId = "your-extension-id-here";

  window.chrome.runtime.sendMessage(
    extensionId,
    {
      action: "pauseApplying",
      sessionId: sessionId,
    },
    (response) => {
      if (response && response.status === "paused") {
        enqueueSnackbar("⏸️ Automation paused", { variant: "info" });
      }
    }
  );
};

export const resumeAutomation = (sessionId: string, enqueueSnackbar: any) => {
  const extensionId = "your-extension-id-here";

  window.chrome.runtime.sendMessage(
    extensionId,
    {
      action: "resumeApplying",
      sessionId: sessionId,
    },
    (response) => {
      if (response && response.status === "resumed") {
        enqueueSnackbar("▶️ Automation resumed", { variant: "info" });
      }
    }
  );
};

export const stopAutomation = (sessionId: string, enqueueSnackbar: any) => {
  const extensionId = "your-extension-id-here";

  window.chrome.runtime.sendMessage(
    extensionId,
    {
      action: "stopApplying",
      sessionId: sessionId,
    },
    (response) => {
      if (response && response.status === "stopped") {
        enqueueSnackbar("⏹️ Automation stopped", { variant: "info" });
        localStorage.removeItem("activeAutomationSession");
      }
    }
  );
};
```

### 4. Add User Preferences Management

```javascript
// Add interface for user preferences
interface UserPreferences {
  firstName?: string;
  lastName?: string;
  email?: string;
  phone?: string;
  address?: string;
  city?: string;
  zipCode?: string;
  country?: string;
  linkedin?: string;
  website?: string;
  coverLetter?: string;
  workAuthorization?: string;
  visaSponsorship?: string;
  salary?: string;
  resumeUrl?: string;
}

// Function to get user preferences
export const getUserPreferences = async (
  userId: string
): Promise<UserPreferences> => {
  // Fetch from your API or database
  const response = await fetch(`/api/users/${userId}/preferences`);
  return response.json();
};

// Function to update user preferences
export const updateUserPreferences = async (
  userId: string,
  preferences: UserPreferences
) => {
  await fetch(`/api/users/${userId}/preferences`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(preferences),
  });
};
```

### 5. Enhanced UI Components

```tsx
// Add a control panel component for automation
import React, { useState, useEffect } from "react";

interface AutomationControlPanelProps {
  sessionId?: string;
  onStart: (platform: string, jobsToApply: number) => void;
  onPause: () => void;
  onResume: () => void;
  onStop: () => void;
}

export const AutomationControlPanel: React.FC<AutomationControlPanelProps> = ({
  sessionId,
  onStart,
  onPause,
  onResume,
  onStop,
}) => {
  const [progress, setProgress] = useState<any>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    // Monitor progress if session is active
    if (sessionId) {
      const interval = setInterval(checkProgress, 3000);
      return () => clearInterval(interval);
    }
  }, [sessionId]);

  const checkProgress = async () => {
    if (!sessionId) return;

    // Get progress from extension
    window.chrome.runtime.sendMessage(
      "your-extension-id",
      {
        action: "getStatus",
        sessionId: sessionId,
      },
      (response) => {
        if (response && response.status === "success") {
          setProgress(response.progress);
          setIsRunning(response.progress.status === "running");
          setIsPaused(response.progress.isPaused);
        }
      }
    );
  };

  return (
    <div className="automation-control-panel">
      <h3>Job Application Automation</h3>

      {progress && (
        <div className="progress-section">
          <div className="progress-bar">
            <div
              className="progress-fill"
              style={{
                width: `${(progress.completed / progress.total) * 100}%`,
              }}
            />
          </div>
          <div className="progress-text">
            {progress.completed} / {progress.total} applications completed
            {progress.current && (
              <div className="current-action">{progress.current}</div>
            )}
          </div>
        </div>
      )}

      <div className="control-buttons">
        {!isRunning ? (
          <button onClick={() => onStart("linkedin", 10)} className="start-btn">
            Start Automation
          </button>
        ) : (
          <>
            {!isPaused ? (
              <button onClick={onPause} className="pause-btn">
                Pause
              </button>
            ) : (
              <button onClick={onResume} className="resume-btn">
                Resume
              </button>
            )}
            <button onClick={onStop} className="stop-btn">
              Stop
            </button>
          </>
        )}
      </div>

      {progress && progress.errors && progress.errors.length > 0 && (
        <div className="errors-section">
          <h4>Recent Errors:</h4>
          <ul>
            {progress.errors.slice(-3).map((error: any, index: number) => (
              <li key={index}>{error.message}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
```

### 6. Extension Detection and Health Check

```javascript
// Add extension health check
export const checkExtensionHealth = async (): Promise<boolean> => {
  return new Promise((resolve) => {
    if (!window.chrome?.runtime?.sendMessage) {
      resolve(false);
      return;
    }

    window.chrome.runtime.sendMessage(
      "your-extension-id",
      {
        action: "healthCheck",
      },
      (response) => {
        if (window.chrome.runtime.lastError) {
          resolve(false);
        } else {
          resolve(response && response.status === "healthy");
        }
      }
    );

    // Timeout after 3 seconds
    setTimeout(() => resolve(false), 3000);
  });
};

// Add this to your app initialization
export const initializeExtensionConnection = async () => {
  const isHealthy = await checkExtensionHealth();

  if (!isHealthy) {
    console.warn("Chrome extension not available or unhealthy");
    // Show user notification about extension status
    return false;
  }

  // Check for active sessions on page load
  const activeSessionId = localStorage.getItem("activeAutomationSession");
  if (activeSessionId) {
    // Resume monitoring existing session
    console.log("Resuming monitoring for session:", activeSessionId);
    // startProgressMonitoring(activeSessionId, enqueueSnackbar);
  }

  return true;
};
```

## 🔧 Environment Configuration

### Development Environment

```javascript
// config/development.js
export const EXTENSION_CONFIG = {
  extensionId: "your-dev-extension-id",
  debugMode: true,
  apiBaseUrl: "http://localhost:3000",
  pollInterval: 2000, // Faster polling in dev
};
```

### Production Environment

```javascript
// config/production.js
export const EXTENSION_CONFIG = {
  extensionId: "your-prod-extension-id",
  debugMode: false,
  apiBaseUrl: "https://your-domain.com",
  pollInterval: 5000,
};
```

## 📊 Analytics Integration

```javascript
// Add analytics tracking for automation events
export const trackAutomationEvent = (eventName: string, properties: any) => {
  // Your analytics service (e.g., Mixpanel, Amplitude, Google Analytics)
  analytics.track(eventName, {
    ...properties,
    timestamp: Date.now(),
    userAgent: navigator.userAgent,
  });
};

// Usage in your automation functions
const enhancedStartJobSearch = (...args) => {
  trackAutomationEvent("automation_started", {
    platform: args[3], // platform
    jobsToApply: args[2], // jobsToApply
    userPlan: args[6], // currentPlan
  });

  return startJobSearch(...args);
};
```

## 🚨 Error Handling and Recovery

```javascript
// Enhanced error handling
export const handleAutomationError = (error: any, context: any) => {
  console.error("Automation error:", error, context);

  // Log to your error tracking service
  if (window.Sentry) {
    window.Sentry.captureException(error, {
      tags: {
        component: "automation",
        platform: context.platform,
      },
      extra: context,
    });
  }

  // Attempt recovery based on error type
  if (error.message?.includes("Extension not found")) {
    // Guide user to install/enable extension
    showExtensionInstallationGuide();
  } else if (error.message?.includes("Session not found")) {
    // Clean up orphaned session
    localStorage.removeItem("activeAutomationSession");
  }
};

const showExtensionInstallationGuide = () => {
  // Show modal or notification with installation instructions
  console.log("Please install or enable the Job Automation Chrome Extension");
};
```

## 🔒 Security Considerations

```javascript
// Validate extension responses
const validateExtensionResponse = (response: any): boolean => {
  if (!response || typeof response !== "object") {
    return false;
  }

  // Check required fields
  const requiredFields = ["status"];
  for (const field of requiredFields) {
    if (!(field in response)) {
      return false;
    }
  }

  // Validate status values
  const validStatuses = [
    "started",
    "progress",
    "completed",
    "error",
    "paused",
    "stopped",
  ];
  if (!validStatuses.includes(response.status)) {
    return false;
  }

  return true;
};

// Use validation in message handling
window.chrome.runtime.sendMessage(extensionId, message, (response) => {
  if (!validateExtensionResponse(response)) {
    console.error("Invalid response from extension:", response);
    return;
  }

  // Process validated response
  handleValidatedResponse(response);
});
```

## 📱 Mobile Considerations

```javascript
// Detect mobile browsers and show appropriate message
const isMobile =
  /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
    navigator.userAgent
  );

if (isMobile) {
  console.log(
    "Mobile browser detected - Chrome extension features not available"
  );
  // Show mobile-specific UI or instructions
}
```

## 🧪 Testing Integration

```javascript
// Test automation integration
export const testExtensionIntegration = async () => {
  const tests = [
    {
      name: "Extension Connection",
      test: () => checkExtensionHealth(),
    },
    {
      name: "Message Handling",
      test: () =>
        new Promise((resolve) => {
          window.chrome.runtime.sendMessage(
            "your-extension-id",
            {
              action: "ping",
            },
            (response) => {
              resolve(response && response.status === "pong");
            }
          );
        }),
    },
  ];

  for (const test of tests) {
    try {
      const result = await test.test();
      console.log(`✅ ${test.name}: ${result ? "PASS" : "FAIL"}`);
    } catch (error) {
      console.log(`❌ ${test.name}: FAIL - ${error.message}`);
    }
  }
};
```

This integration guide maintains compatibility with your existing code while adding the enhanced functionality of the new multi-platform automation system. The key is to gradually adopt the new features without breaking existing functionality.
