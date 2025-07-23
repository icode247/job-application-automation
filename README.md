# Multi-Platform Job Automation Chrome Extension

A robust, scalable Chrome extension that automates job applications across multiple platforms including LinkedIn, Indeed, Recruitee, Glassdoor, and Workday. Designed to integrate seamlessly with your existing web application frontend.

## 🏗️ Architecture Overview

### Core Components

- **Background Service**: Handles message routing, session management, and window coordination
- **Platform Registry**: Modular system for adding new job platforms
- **Automation Orchestrator**: Coordinates automation sessions across platforms
- **Content Scripts**: Platform-specific automation logic injected into job sites
- **Error Handling**: Comprehensive error recovery and retry mechanisms
- **Health Monitoring**: Real-time system health and performance tracking

### Platform Support

- ✅ **LinkedIn** - Easy Apply automation with multi-step form handling
- ✅ **Indeed** - Indeed Apply and external site application support
- ✅ **Recruitee** - Google search-based job discovery and application
- ✅ **Glassdoor** - Easy Apply with form automation
- ✅ **Workday** - Multi-step application flow handling
- 🔧 **Extensible** - Easy to add new platforms

## 📁 Project Structure

```
chrome-extension/
├── manifest.json
├── background/
│   ├── background.js           # Main background service
│   ├── message-handler.js      # Message routing and handling
│   ├── window-manager.js       # Window tracking and management
│   └── session-manager.js      # Automation session persistence
├── core/
│   ├── automation-orchestrator.js  # Main automation coordinator
│   ├── error-handler.js        # Error handling and recovery
│   ├── health-monitor.js       # System health monitoring
│   ├── logger.js               # Enhanced logging system
│   └── constants.js            # Platform configurations
├── platforms/
│   ├── base-platform.js        # Abstract base class for platforms
│   ├── platform-registry.js    # Platform registration system
│   ├── linkedin/
│   │   ├── linkedin.js         # LinkedIn automation logic
│   │   └── linkedin-config.js  # LinkedIn-specific configuration
│   ├── indeed/
│   │   ├── indeed.js           # Indeed automation logic
│   │   └── indeed-config.js    # Indeed-specific configuration
│   ├── recruitee/
│   │   ├── recruitee.js        # Recruitee automation logic
│   │   └── recruitee-config.js # Recruitee-specific configuration
│   ├── glassdoor/
│   │   ├── glassdoor.js        # Glassdoor automation logic
│   │   └── glassdoor-config.js # Glassdoor-specific configuration
│   └── workday/
│       ├── workday.js          # Workday automation logic
│       └── workday-config.js   # Workday-specific configuration
├── content/
│   ├── content-main.js         # Main content script coordinator
│   └── dom-observer.js         # DOM change monitoring
├── ui/
│   ├── components/
│   │   ├── automation-indicator.js  # Visual automation feedback
│   │   ├── form-filler.js      # Intelligent form filling
│   │   └── progress-tracker.js # Progress display component
│   └── styles/
│       └── automation.css      # Styling for UI components
├── data/
│   ├── resume-manager.js       # Resume handling and upload
│   ├── application-tracker.js  # Application tracking and analytics
│   └── form-templates.js       # Form field mapping templates
├── tests/
│   └── platform-tester.js      # Automated platform testing
└── utils/
    └── debug-tools.js          # Development and debugging utilities
```

## 🚀 Installation & Setup

### 1. Clone and Prepare Extension

```bash
# Clone your project
git clone <your-repo-url>
cd chrome-extension

# No build step required - uses ES6 modules
```

### 2. Update Manifest for Your Domain

Edit `manifest.json` to include your frontend domain:

```json
{
  "externally_connectable": {
    "matches": [
      "https://fastapply.co/*",
      "https://*.fastapply.co/*",
      "http://localhost:*/*"
    ]
  }
}
```

### 3. Load Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable "Developer mode" in the top right
3. Click "Load unpacked" and select your extension folder
4. Note the Extension ID from the loaded extension

### 4. Update Your Frontend

In your existing frontend code, update the extension ID:

```javascript
// Update this line in your startJobSearch function
const extensionId = "your-actual-extension-id-here";

// Your existing message sending code remains the same
window.chrome.runtime.sendMessage(extensionId, message, (response) => {
  // Handle response
});
```

## 🔧 Configuration

### User Preferences

The extension expects user preferences in this format:

```javascript
const userPreferences = {
  // Personal Information
  firstName: "John",
  lastName: "Doe",
  email: "john.doe@email.com",
  phone: "(555) 123-4567",

  // Address Information
  address: "123 Main St",
  city: "San Francisco",
  zipCode: "94105",
  country: "United States",

  // Professional Information
  linkedin: "https://linkedin.com/in/johndoe",
  website: "https://johndoe.dev",

  // Application Preferences
  coverLetter: "I am excited to apply for this position...",
  resumeUrl: "https://your-domain.com/resume.pdf",

  // Work Authorization
  workAuthorization: "yes", // or "no"
  visaSponsorship: "no", // or "yes"

  // Salary Expectations
  salary: "120000",
};
```

### Platform-Specific Settings

```javascript
// Platform-specific configurations
const platformSettings = {
  linkedin: {
    enabled: true,
    easyApplyOnly: true,
    maxApplicationsPerSession: 50,
  },
  indeed: {
    enabled: true,
    skipExternalSites: false,
    maxApplicationsPerSession: 30,
  },
  recruitee: {
    enabled: true,
    searchQuery: "software engineer",
    maxApplicationsPerSession: 20,
  },
};
```

## 📝 API Reference

### Frontend Integration

#### Starting Automation

```javascript
const message = {
  action: "startApplying",
  platform: "linkedin", // Target platform
  userId: "user123", // Your user identifier
  jobsToApply: 10, // Number of jobs to apply to
  submittedLinks: [], // Previously applied job URLs
  devMode: false, // Development mode flag
  country: "US", // User's country
  userPlan: "pro", // User's subscription plan
  userCredits: 50, // Available credits
  dailyRemaining: 25, // Daily applications remaining

  // Optional parameters
  resumeUrl: "https://...", // Resume URL
  coverLetterTemplate: "...", // Cover letter text
  preferences: userPreferences, // User preferences object
};

window.chrome.runtime.sendMessage(extensionId, message, (response) => {
  if (response.status === "started") {
    console.log("Automation started successfully");
    // Handle success
  } else if (response.status === "error") {
    console.error("Error:", response.message);
    // Handle error
  }
});
```

#### Monitoring Progress

```javascript
// Get automation status
const statusMessage = {
  action: "getStatus",
  sessionId: "session_id_from_start_response",
};

window.chrome.runtime.sendMessage(extensionId, statusMessage, (response) => {
  if (response.status === "success") {
    const { session, progress } = response;
    console.log("Progress:", progress);
    // Update UI with progress
  }
});
```

#### Controlling Automation

```javascript
// Pause automation
const pauseMessage = {
  action: "pauseApplying",
  sessionId: "session_id",
};

// Stop automation
const stopMessage = {
  action: "stopApplying",
  sessionId: "session_id",
};

window.chrome.runtime.sendMessage(extensionId, pauseMessage, callback);
```

### Response Format

#### Success Response

```javascript
{
  status: "started",
  platform: "linkedin",
  sessionId: "session_abc123",
  message: "Job search started for linkedin! Applying to 10 jobs."
}
```

#### Progress Update

```javascript
{
  status: "progress",
  sessionId: "session_abc123",
  progress: {
    total: 10,
    completed: 3,
    failed: 1,
    skipped: 2,
    current: "Applying to Software Engineer at Google"
  }
}
```

#### Error Response

```javascript
{
  status: "error",
  message: "Platform linkedin not supported",
  code: "UNSUPPORTED_PLATFORM"
}
```

## 🛠️ Development

### Adding a New Platform

1. **Create Platform Directory**

```bash
mkdir platforms/newplatform
```

2. **Implement Platform Class**

```javascript
// platforms/newplatform/newplatform.js
import BasePlatform from "../base-platform.js";

export default class NewPlatform extends BasePlatform {
  constructor(config) {
    super(config);
    this.platform = "newplatform";
  }

  async start() {
    // Implementation
  }

  async findJobs() {
    // Implementation
  }

  async applyToJob(jobData) {
    // Implementation
  }
}
```

3. **Register Platform**

```javascript
// Update platforms/platform-registry.js
const platformModules = {
  // existing platforms...
  newplatform: () => import("./newplatform/newplatform.js"),
};
```

### Testing

#### Run Platform Tests

```javascript
// In browser console
import PlatformTester from "./tests/platform-tester.js";
const tester = new PlatformTester(platformInstance);
const results = await tester.runTests();
console.log(results);
```

#### Enable Debug Mode

```javascript
// In browser console
import DebugTools from "./utils/debug-tools.js";
const debug = new DebugTools();
debug.enable();
```

## 🔍 Monitoring & Analytics

### Health Monitoring

The extension includes built-in health monitoring:

```javascript
// Access health data
chrome.runtime.sendMessage(
  {
    action: "getHealthStatus",
  },
  (response) => {
    console.log("Health:", response.healthReport);
  }
);
```
### Bundling
Development (readable code, fast rebuilds)

```
npm run dev          # Build once (no obfuscation)
npm run watch:dev    # Watch mode (no obfuscation) 
npm start           # Same as watch:dev

```

Production (obfuscated code)
```
npm run build       # Build once (obfuscated)
npm run watch       # Watch mode (obfuscated)
npm run package     # Build + create ZIP
````
### Application Tracking

All applications are automatically tracked:

```javascript
// Get application statistics
chrome.runtime.sendMessage(
  {
    action: "getApplicationStats",
    timeframe: "week", // today, week, month, all
  },
  (response) => {
    console.log("Stats:", response.stats);
  }
);
```

## 🚨 Error Handling

The extension includes comprehensive error handling:

- **Network Errors**: Automatic retry with exponential backoff
- **Element Not Found**: Wait and retry with DOM monitoring
- **Form Errors**: Clear and refill forms automatically
- **Page Load Issues**: Refresh and retry
- **Rate Limiting**: Intelligent delay management

## 🔧 Troubleshooting

### Common Issues

#### Extension Not Responding

```javascript
// Check if extension is loaded
if (window.chrome?.runtime?.sendMessage) {
  console.log("Extension available");
} else {
  console.log("Extension not available - check if loaded");
}
```

#### Platform Not Working

1. Check browser console for errors
2. Enable debug mode
3. Run platform tests
4. Check if platform UI has changed

#### Form Filling Issues

1. Verify user preferences are set
2. Check platform-specific field mappings
3. Test with debug mode enabled

### Debug Information

```javascript
// Get debug information
chrome.runtime.sendMessage(
  {
    action: "getDebugInfo",
  },
  (response) => {
    console.log("Debug Info:", response);
  }
);
```

## 📈 Performance Optimization

### Best Practices

1. **Limit Concurrent Applications**: Don't run multiple platforms simultaneously
2. **Use Appropriate Delays**: Respect platform rate limits
3. **Monitor Memory Usage**: Check health reports regularly
4. **Clean Up Old Data**: Regularly clean old sessions and applications

### Memory Management

```javascript
// Clean up old data
chrome.runtime.sendMessage({
  action: "cleanup",
  maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
});
```

## 🔒 Security Considerations

- **No Sensitive Data Storage**: User credentials are never stored
- **Secure Communication**: All messages are validated
- **Permission Management**: Minimal required permissions
- **Content Isolation**: Each platform runs in isolation

## 📊 Analytics Integration

### Track Application Events

```javascript
// Custom analytics integration
chrome.runtime.onMessage.addListener((message) => {
  if (message.type === "application_submitted") {
    // Send to your analytics service
    analytics.track("job_application_submitted", {
      platform: message.platform,
      sessionId: message.sessionId,
    });
  }
});
```

## 🎯 Roadmap

- [ ] AI-powered job matching
- [ ] Resume optimization suggestions
- [ ] Interview scheduling automation
- [ ] Application follow-up automation
- [ ] Advanced analytics dashboard
- [ ] Mobile app integration

## 📄 License

[Your License Here]

## 🤝 Contributing

[Contributing Guidelines Here]

---

For support, please contact [your-support-email] or create an issue in the repository.
