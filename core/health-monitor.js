// core/health-monitor.js
export default class HealthMonitor {
  constructor(logger) {
    this.logger = logger;
    this.metrics = {
      startTime: Date.now(),
      pageLoads: 0,
      successfulApplications: 0,
      failedApplications: 0,
      errors: 0,
      memoryUsage: 0,
      responseTime: [],
    };
    this.healthChecks = [];
    this.isMonitoring = false;
  }

  startMonitoring() {
    if (this.isMonitoring) return;

    this.isMonitoring = true;
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, 30000); // Every 30 seconds

    this.logger.info("🏥 Health monitoring started");
  }

  stopMonitoring() {
    if (!this.isMonitoring) return;

    this.isMonitoring = false;
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    this.logger.info("🏥 Health monitoring stopped");
  }

  recordMetric(type, value = 1) {
    switch (type) {
      case "pageLoad":
        this.metrics.pageLoads += value;
        break;
      case "applicationSuccess":
        this.metrics.successfulApplications += value;
        break;
      case "applicationFailure":
        this.metrics.failedApplications += value;
        break;
      case "error":
        this.metrics.errors += value;
        break;
      case "responseTime":
        this.metrics.responseTime.push(value);
        // Keep only last 100 measurements
        if (this.metrics.responseTime.length > 100) {
          this.metrics.responseTime = this.metrics.responseTime.slice(-100);
        }
        break;
    }
  }

  async performHealthCheck() {
    const healthStatus = {
      timestamp: Date.now(),
      uptime: Date.now() - this.metrics.startTime,
      metrics: { ...this.metrics },
      status: "healthy",
      issues: [],
    };

    // Check error rate
    const totalApplications =
      this.metrics.successfulApplications + this.metrics.failedApplications;
    if (totalApplications > 0) {
      const errorRate =
        (this.metrics.failedApplications / totalApplications) * 100;
      if (errorRate > 30) {
        healthStatus.status = "warning";
        healthStatus.issues.push(`High error rate: ${errorRate.toFixed(1)}%`);
      }
    }

    // Check response time
    if (this.metrics.responseTime.length > 0) {
      const avgResponseTime =
        this.metrics.responseTime.reduce((a, b) => a + b, 0) /
        this.metrics.responseTime.length;
      if (avgResponseTime > 10000) {
        // 10 seconds
        healthStatus.status = "warning";
        healthStatus.issues.push(
          `High response time: ${avgResponseTime.toFixed(0)}ms`
        );
      }
    }

    // Check memory usage (if available)
    if ("memory" in performance) {
      const memInfo = performance.memory;
      this.metrics.memoryUsage = memInfo.usedJSHeapSize;

      if (memInfo.usedJSHeapSize > memInfo.totalJSHeapSize * 0.9) {
        healthStatus.status = "critical";
        healthStatus.issues.push("High memory usage");
      }
    }

    this.healthChecks.push(healthStatus);

    // Keep only last 24 health checks (12 hours if running every 30 seconds)
    if (this.healthChecks.length > 24) {
      this.healthChecks = this.healthChecks.slice(-24);
    }

    // Log health status if not healthy
    if (healthStatus.status !== "healthy") {
      this.logger.warn(`Health check: ${healthStatus.status}`, {
        issues: healthStatus.issues,
        metrics: healthStatus.metrics,
      });
    }

    return healthStatus;
  }

  getHealthReport() {
    const latest =
      this.healthChecks[this.healthChecks.length - 1] ||
      this.performHealthCheck();

    return {
      current: latest,
      history: this.healthChecks,
      summary: {
        uptime: Date.now() - this.metrics.startTime,
        totalApplications:
          this.metrics.successfulApplications + this.metrics.failedApplications,
        successRate: this.calculateSuccessRate(),
        averageResponseTime: this.calculateAverageResponseTime(),
        status: latest.status,
      },
    };
  }

  calculateSuccessRate() {
    const total =
      this.metrics.successfulApplications + this.metrics.failedApplications;
    if (total === 0) return 0;
    return ((this.metrics.successfulApplications / total) * 100).toFixed(1);
  }

  calculateAverageResponseTime() {
    if (this.metrics.responseTime.length === 0) return 0;
    return (
      this.metrics.responseTime.reduce((a, b) => a + b, 0) /
      this.metrics.responseTime.length
    ).toFixed(0);
  }

  reset() {
    this.metrics = {
      startTime: Date.now(),
      pageLoads: 0,
      successfulApplications: 0,
      failedApplications: 0,
      errors: 0,
      memoryUsage: 0,
      responseTime: [],
    };
    this.healthChecks = [];
  }
}
