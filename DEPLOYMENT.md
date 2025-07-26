// Usage: node scripts/update-version.js 2.1.0

// Chrome Web Store deployment guide (DEPLOYMENT.md)

# Chrome Web Store Deployment

## Prerequisites

1. Google Chrome Developer Account ($5 one-time fee)
2. Built and tested extension
3. Store assets (screenshots, descriptions, icons)

## Steps

### 1. Prepare Store Assets

- Icon: 128x128px PNG
- Screenshots: 1280x800px or 640x400px
- Promotional tile: 440x280px (optional)
- Marquee promo tile: 1400x560px (optional)

### 2. Upload Extension

1. Go to Chrome Web Store Developer Dashboard
2. Click "Add new item"
3. Upload your .zip file from packages/
4. Fill in store listing information

### 3. Store Listing Information

```
Title: AI Job Application Assistant
Summary: Automate job applications across LinkedIn, Indeed, Glassdoor, and more
Description: [Detailed description with features and benefits]
Category: Productivity
Language: English
```
### ZIP
  
   zip -r fastapply.zip .

### 4. Privacy and Permissions

- Add privacy policy URL
- Justify all permissions in description
- Complete content ratings questionnaire

### 5. Review and Publish

- Submit for review
- Review process takes 1-7 days
- Address any feedback from Google

## Post-Deployment

1. Monitor reviews and ratings
2. Respond to user feedback
3. Plan updates and new features
4. Track usage analytics
