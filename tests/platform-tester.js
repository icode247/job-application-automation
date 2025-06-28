// tests/platform-tester.js
export default class PlatformTester {
  constructor(platform) {
    this.platform = platform;
    this.testResults = [];
  }

  async runTests() {
    console.log(`🧪 Running tests for ${this.platform.platform} platform`);

    const tests = [
      this.testInitialization.bind(this),
      this.testJobDetection.bind(this),
      this.testFormFilling.bind(this),
      this.testApplicationFlow.bind(this),
      this.testErrorHandling.bind(this),
    ];

    for (const test of tests) {
      try {
        const result = await test();
        this.testResults.push(result);
      } catch (error) {
        this.testResults.push({
          name: test.name,
          status: "failed",
          error: error.message,
          timestamp: Date.now(),
        });
      }
    }

    return this.generateTestReport();
  }

  async testInitialization() {
    const startTime = Date.now();

    try {
      // Test platform initialization
      await this.platform.initialize?.();

      return {
        name: "Platform Initialization",
        status: "passed",
        duration: Date.now() - startTime,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        name: "Platform Initialization",
        status: "failed",
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: Date.now(),
      };
    }
  }

  async testJobDetection() {
    const startTime = Date.now();

    try {
      // Test if platform can detect jobs on the page
      const jobs = (await this.platform.findJobs?.()) || [];

      return {
        name: "Job Detection",
        status: jobs.length > 0 ? "passed" : "warning",
        details: `Found ${jobs.length} jobs`,
        duration: Date.now() - startTime,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        name: "Job Detection",
        status: "failed",
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: Date.now(),
      };
    }
  }

  async testFormFilling() {
    const startTime = Date.now();

    try {
      // Test form filling capability
      const testFormData = {
        firstName: "Test",
        lastName: "User",
        email: "test@example.com",
        phone: "555-0123",
      };

      const result = (await this.platform.fillForm?.(testFormData)) || {
        fieldsFound: 0,
        fieldsFilled: 0,
      };

      return {
        name: "Form Filling",
        status: result.fieldsFilled > 0 ? "passed" : "warning",
        details: `Filled ${result.fieldsFilled}/${result.fieldsFound} fields`,
        duration: Date.now() - startTime,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        name: "Form Filling",
        status: "failed",
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: Date.now(),
      };
    }
  }

  async testApplicationFlow() {
    const startTime = Date.now();

    try {
      // Test application flow without actually submitting
      const mockJob = {
        title: "Test Software Engineer",
        company: "Test Company",
        url: window.location.href,
      };

      // This would test the flow without actual submission
      const canApply = (await this.platform.canApplyToJob?.(mockJob)) !== false;

      return {
        name: "Application Flow",
        status: canApply ? "passed" : "warning",
        details: canApply
          ? "Application flow accessible"
          : "Cannot access application flow",
        duration: Date.now() - startTime,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        name: "Application Flow",
        status: "failed",
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: Date.now(),
      };
    }
  }

  async testErrorHandling() {
    const startTime = Date.now();

    try {
      // Test error handling by causing a controlled error
      const errorHandled = this.platform.reportError ? true : false;

      if (errorHandled) {
        // Test that error reporting works
        this.platform.reportError(new Error("Test error"), { test: true });
      }

      return {
        name: "Error Handling",
        status: errorHandled ? "passed" : "warning",
        details: errorHandled
          ? "Error handling available"
          : "No error handling found",
        duration: Date.now() - startTime,
        timestamp: Date.now(),
      };
    } catch (error) {
      return {
        name: "Error Handling",
        status: "failed",
        error: error.message,
        duration: Date.now() - startTime,
        timestamp: Date.now(),
      };
    }
  }

  generateTestReport() {
    const passed = this.testResults.filter((t) => t.status === "passed").length;
    const failed = this.testResults.filter((t) => t.status === "failed").length;
    const warnings = this.testResults.filter(
      (t) => t.status === "warning"
    ).length;
    const total = this.testResults.length;

    return {
      platform: this.platform.platform,
      summary: {
        total,
        passed,
        failed,
        warnings,
        success: failed === 0,
        score: ((passed / total) * 100).toFixed(1),
      },
      tests: this.testResults,
      timestamp: Date.now(),
    };
  }

  static async runAllPlatformTests(platforms) {
    const allResults = [];

    for (const platform of platforms) {
      const tester = new PlatformTester(platform);
      const result = await tester.runTests();
      allResults.push(result);
    }

    return {
      summary: {
        totalPlatforms: allResults.length,
        successfulPlatforms: allResults.filter((r) => r.summary.success).length,
        averageScore: (
          allResults.reduce((sum, r) => sum + parseFloat(r.summary.score), 0) /
          allResults.length
        ).toFixed(1),
      },
      results: allResults,
      timestamp: Date.now(),
    };
  }
}
