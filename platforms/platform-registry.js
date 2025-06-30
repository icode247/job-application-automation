// platforms/platform-registry.js
import LinkedInPlatform from "./linkedin/linkedin.js";
import IndeedPlatform from "./indeed/indeed.js";
import RecruiteePlatform from "./recruitee/recruitee.js";
import GlassdoorPlatform from "./glassdoor/glassdoor.js";
import WorkdayPlatform from "./workday/workday.js";
import LeverPlatform from "./lever/lever.js";
supportedPlatforms
export default class PlatformRegistry {
  constructor() {
    this.platforms = new Map();
    this.initialized = false;
  }

  async initialize() {
    if (this.initialized) return;

    try {
      // Register all platform modules
      this.registerPlatforms();
      this.initialized = true;
      console.log("✅ Platform registry initialized");
    } catch (error) {
      console.error("❌ Failed to initialize platform registry:", error);
    }
  }

  registerPlatforms() {
    // Replace dynamic imports with static references
    const platformModules = {
      linkedin: LinkedInPlatform,
      indeed: IndeedPlatform,
      recruitee: RecruiteePlatform,
      glassdoor: GlassdoorPlatform,
      workday: WorkdayPlatform,
      lever: LeverPlatform,
    };

    for (const [name, PlatformClass] of Object.entries(platformModules)) {
      try {
        this.platforms.set(name, PlatformClass);
        console.log(`📦 Registered platform: ${name}`);
      } catch (error) {
        console.warn(`⚠️ Failed to load platform ${name}:`, error);
      }
    }
  }

  async getPlatform(name) {
    if (!this.initialized) {
      await this.initialize();
    }

    return this.platforms.get(name);
  }

  getSupportedPlatforms() {
    return Array.from(this.platforms.keys());
  }

  isPlatformSupported(name) {
    return this.platforms.has(name);
  }
}
