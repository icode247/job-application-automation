// Deployment script (scripts/deploy.sh)
#!/bin/bash

echo "🚀 Building Chrome Extension for Production..."

# Clean previous builds
rm -rf dist/
rm -rf packages/

# Create distribution directory
mkdir -p dist/

# Copy source files
echo "📁 Copying source files..."
cp -r background/ dist/
cp -r content/ dist/
cp -r core/ dist/
cp -r platforms/ dist/
cp -r ui/ dist/
cp -r data/ dist/
cp -r utils/ dist/
cp -r icons/ dist/
cp -r rules/ dist/
cp manifest.json dist/

# Remove development files
echo "🧹 Removing development files..."
find dist/ -name "*.test.js" -delete
find dist/ -name "*.spec.js" -delete
find dist/ -name "*.md" -delete

# Validate extension
echo "✅ Validating extension..."
npx web-ext lint --source-dir=dist/

if [ $? -eq 0 ]; then
    echo "✅ Validation passed!"
    
    # Package extension
    echo "📦 Packaging extension..."
    mkdir -p packages/
    npx web-ext build --source-dir=dist/ --artifacts-dir=packages/
    
    echo "🎉 Extension built successfully!"
    echo "📁 Package location: packages/"
    ls -la packages/
else
    echo "❌ Validation failed!"
    exit 1
fi

// GitHub Actions workflow (.github/workflows/build.yml)
name: Build and Test Chrome Extension

on:
  push:
    branches: [ main, develop ]
  pull_request:
    branches: [ main ]

jobs:
  build:
    runs-on: ubuntu-latest
    
    steps:
    - uses: actions/checkout@v3
    
    - name: Setup Node.js
      uses: actions/setup-node@v3
      with:
        node-version: '18'
        cache: 'npm'
    
    - name: Install dependencies
      run: npm ci
    
    - name: Lint code
      run: npm run lint
    
    - name: Run tests
      run: npm test
    
    - name: Build extension
      run: npm run build
    
    - name: Validate extension
      run: npx web-ext lint --source-dir=dist/
    
    - name: Package extension
      run: npm run package
    
    - name: Upload artifacts
      uses: actions/upload-artifact@v3
      with:
        name: chrome-extension
        path: packages/*.zip
