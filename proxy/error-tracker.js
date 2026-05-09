class ErrorTracker {
  constructor(windowSize = 100) {
    this.requests = [];
    this.windowSize = windowSize;
    this.startTime = Date.now();
  }

  addRequest(statusCode) {
    this.requests.push({
      statusCode: statusCode,
      isError: statusCode >= 400,
      timestamp: Date.now(),
    });

    if (this.requests.length > this.windowSize) {
      this.requests.shift();
    }
  }

  getErrorRate() {
    if (this.requests.length === 0) return 0;

    const errors = this.requests.filter((r) => r.isError).length;
    return ((errors / this.requests.length) * 100).toFixed(2);
  }

  getStats() {
    const errorRate = this.getErrorRate();
    const totalRequests = this.requests.length;
    const totalErrors = this.requests.filter((r) => r.isError).length;
    const uptime = ((Date.now() - this.startTime) / 1000).toFixed(0);

    return {
      totalRequests: totalRequests,
      totalErrors: totalErrors,
      errorRate: parseFloat(errorRate),
      errorRatePercent: errorRate + "%",
      uptime: uptime + "s",
      timestamp: new Date().toISOString(),
    };
  }

  isHighErrorRate(threshold = 20) {
    return parseFloat(this.getErrorRate()) > threshold;
  }

  getRecentRequests(count = 10) {
    return this.requests.slice(-count);
  }

  reset() {
    this.requests = [];
    this.startTime = Date.now();
  }
}

module.exports = ErrorTracker;