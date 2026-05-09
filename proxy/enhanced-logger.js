// ============================================
// enhanced-logger.js - FIXED
// ============================================

const fs = require("fs");
const path = require("path");

class EnhancedLogger {
  constructor() {
    this.logsDir = "./logs";
    this.ensureLogsDir();
  }

  ensureLogsDir() {
    if (!fs.existsSync(this.logsDir)) {
      fs.mkdirSync(this.logsDir, { recursive: true });
    }
  }

  getToday() {
    return new Date().toISOString().split("T")[0];
  }

  getLogFile() {
    return path.join(this.logsDir, `${this.getToday()}.log`);
  }

  logRequest(req, res, duration, target, statusCode, errorDetails) {
    // Extract error message if it exists
    let errorMessage = "";
    
    if (typeof errorDetails === "string") {
      errorMessage = errorDetails;
    } else if (typeof errorDetails === "object" && errorDetails) {
      if (errorDetails.message) {
        errorMessage = errorDetails.message;
      } else if (errorDetails.error) {
        errorMessage = errorDetails.error;
      } else {
        errorMessage = JSON.stringify(errorDetails).substring(0, 200);
      }
    }

    const log = {
      timestamp: new Date().toISOString(),
      method: req.method,
      path: req.path || req.url,
      statusCode: statusCode,
      duration: duration,
      target: target,
      ip: req.ip || req.connection.remoteAddress,
      responseBody: errorMessage || "success"
    };

    // Console log
    const statusEmoji = statusCode >= 400 ? "❌" : "✅";
    const statusLabel = statusCode >= 400 ? "ERROR" : "SUCCESS";
    console.log(
      `[${statusLabel}] [${statusCode}] ${req.method} ${req.path || req.url} -> ${target} (${duration}ms)`
    );

    // File log
    const logFile = this.getLogFile();
    const logLine = JSON.stringify(log) + "\n";
    fs.appendFileSync(logFile, logLine, "utf8");
  }

  getTodayLogs() {
    try {
      const logFile = this.getLogFile();
      if (!fs.existsSync(logFile)) {
        return [];
      }

      const content = fs.readFileSync(logFile, "utf8");
      const lines = content.trim().split("\n").filter(line => line.length > 0);

      return lines.map(line => {
        try {
          return JSON.parse(line);
        } catch (err) {
          console.error("[LOG PARSE ERROR]", err.message);
          return null;
        }
      }).filter(log => log !== null);
    } catch (err) {
      console.error("[GET LOGS ERROR]", err.message);
      return [];
    }
  }

  getLogsByFilter(filter) {
    const logs = this.getTodayLogs();
    return logs.filter(filter);
  }

  getErrorLogs() {
    return this.getLogsByFilter(log => log.statusCode >= 400);
  }

  getErrorStats() {
    const logs = this.getTodayLogs();
    const errors = logs.filter(log => log.statusCode >= 400);

    const errorCounts = {};
    errors.forEach(error => {
      const key = error.statusCode;
      if (!errorCounts[key]) {
        errorCounts[key] = {
          count: 0,
          messages: [],
          backends: {}
        };
      }
      errorCounts[key].count++;
      
      // Capture error message
      if (errorCounts[key].messages.length < 3) {
        errorCounts[key].messages.push(error.responseBody);
      }
      
      // Track which backend
      const backend = error.target?.includes('5001') ? 'Stable' : 'Test';
      errorCounts[key].backends[backend] = (errorCounts[key].backends[backend] || 0) + 1;
    });

    return {
      totalRequests: logs.length,
      totalErrors: errors.length,
      errorCounts: errorCounts,
      errorsByCode: errorCounts
    };
  }
}

module.exports = EnhancedLogger;