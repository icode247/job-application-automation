// bundler.js
const fs = require('fs');
const path = require('path');
const chokidar = require('chokidar');
const JavaScriptObfuscator = require('javascript-obfuscator');

class SimpleBundler {
  constructor(options = {}) {
    this.sourceDir = options.sourceDir || '.';
    this.outputDir = options.outputDir || './dist';
    this.obfuscate = options.obfuscate !== false;
    this.watch = options.watch || false;
    
    this.obfuscatorOptions = {
      compact: true,
      controlFlowFlattening: true,
      controlFlowFlatteningThreshold: 0.5,
      numbersToExpressions: true,
      simplify: true,
      stringArray: true,
      stringArrayShuffle: true,
      splitStrings: true,
      stringArrayThreshold: 0.75
    };

    // Files/folders to exclude
    this.excludePatterns = [
      'node_modules',
      '.git',
      'dist',
      '.DS_Store',
      '*.md',
      'package*.json',
      '.eslintrc.js',
      'webpack.config.js',
      'bundler.js',
      'build.sh',
      'obfuscate.js'
    ];

    // Files that should NOT be obfuscated
    this.noObfuscatePatterns = [
      'manifest.json',
      '*.png',
      '*.ico',
      '*.css',
      '*.html'
    ];
  }

  shouldExclude(filePath) {
    const relativePath = path.relative(this.sourceDir, filePath);
    return this.excludePatterns.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace('*', '.*'));
        return regex.test(relativePath);
      }
      return relativePath.includes(pattern);
    });
  }

  shouldObfuscate(filePath) {
    if (!this.obfuscate) return false;
    if (!filePath.endsWith('.js')) return false;
    
    const relativePath = path.relative(this.sourceDir, filePath);
    return !this.noObfuscatePatterns.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace('*', '.*'));
        return regex.test(relativePath);
      }
      return relativePath.includes(pattern);
    });
  }

  copyFile(src, dest) {
    const destDir = path.dirname(dest);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
    }

    if (this.shouldObfuscate(src)) {
      this.obfuscateFile(src, dest);
    } else {
      fs.copyFileSync(src, dest);
      console.log(`📄 ${path.relative(this.sourceDir, src)}`);
    }
  }

  obfuscateFile(src, dest) {
    try {
      const code = fs.readFileSync(src, 'utf8');
      const obfuscated = JavaScriptObfuscator.obfuscate(code, this.obfuscatorOptions);
      fs.writeFileSync(dest, obfuscated.getObfuscatedCode());
      console.log(`🔐 ${path.relative(this.sourceDir, src)}`);
    } catch (error) {
      console.error(`❌ Error obfuscating ${src}:`, error.message);
      // Fallback to regular copy
      fs.copyFileSync(src, dest);
    }
  }

  copyDirectory(src, dest) {
    if (!fs.existsSync(dest)) {
      fs.mkdirSync(dest, { recursive: true });
    }

    const items = fs.readdirSync(src);
    
    for (const item of items) {
      const srcPath = path.join(src, item);
      const destPath = path.join(dest, item);

      if (this.shouldExclude(srcPath)) {
        continue;
      }

      if (fs.statSync(srcPath).isDirectory()) {
        this.copyDirectory(srcPath, destPath);
      } else {
        this.copyFile(srcPath, destPath);
      }
    }
  }

  clean() {
    if (fs.existsSync(this.outputDir)) {
      fs.rmSync(this.outputDir, { recursive: true });
    }
    console.log(`🧹 Cleaned ${this.outputDir}`);
  }

  build() {
    console.log('🚀 Building extension...');
    this.clean();
    this.copyDirectory(this.sourceDir, this.outputDir);
    console.log(`✅ Build complete! Output: ${this.outputDir}`);
  }

  startWatcher() {
    console.log('👀 Watching for changes...');
    
    const watcher = chokidar.watch('.', {
      ignored: [
        'node_modules/**',
        'dist/**',
        '.git/**',
        '**/.DS_Store'
      ],
      persistent: true
    });

    watcher.on('change', (filePath) => {
      if (this.shouldExclude(filePath)) return;
      
      const relativePath = path.relative(this.sourceDir, filePath);
      const destPath = path.join(this.outputDir, relativePath);
      
      console.log(`📝 Changed: ${relativePath}`);
      this.copyFile(filePath, destPath);
    });

    watcher.on('add', (filePath) => {
      if (this.shouldExclude(filePath)) return;
      
      const relativePath = path.relative(this.sourceDir, filePath);
      const destPath = path.join(this.outputDir, relativePath);
      
      console.log(`➕ Added: ${relativePath}`);
      this.copyFile(filePath, destPath);
    });

    watcher.on('unlink', (filePath) => {
      const relativePath = path.relative(this.sourceDir, filePath);
      const destPath = path.join(this.outputDir, relativePath);
      
      if (fs.existsSync(destPath)) {
        fs.unlinkSync(destPath);
        console.log(`🗑️  Removed: ${relativePath}`);
      }
    });

    console.log('Press Ctrl+C to stop watching');
  }

  run() {
    this.build();
    
    if (this.watch) {
      this.startWatcher();
    }
  }
}

// CLI handling
const args = process.argv.slice(2);
const options = {
  watch: args.includes('--watch') || args.includes('-w'),
  obfuscate: !args.includes('--no-obfuscate'),
  outputDir: args.find(arg => arg.startsWith('--output='))?.split('=')[1] || './dist'
};

const bundler = new SimpleBundler(options);
bundler.run();