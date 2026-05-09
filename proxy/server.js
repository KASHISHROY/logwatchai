const express = require("express");
const httpProxy = require("http-proxy");
const fs = require("fs");
require("dotenv").config();

const EnhancedLogger = require("./enhanced-logger");
const ErrorTracker = require("./error-tracker");
const AutoRollback = require("./auto-rollback");

const { ingestLogs } = require("./rag/ingest");
const TriggerAgent = require("./agents/trigger-agent");
const { runAnalysisAgent } = require("./agents/analysis-agent");
const { runPatchAgent } = require("./agents/patch-agent");
const { applyPatch } = require("./agents/patch-executor");
const { getAIState } = require("./agents/ai-state");
const { scanNetwork } = require("./network-scanner");

const app = express();
const proxy = httpProxy.createProxyServer({ changeOrigin: true });

// ================= INIT =================
const logger = new EnhancedLogger();
const errorTracker = new ErrorTracker(100);
const autoRollback = new AutoRollback(25);

const triggerAgent = new TriggerAgent(errorTracker, autoRollback, {
  errorThreshold: 25,
  minRequests: 20,
  cooldownMs: 60000,
});

// ================= MIDDLEWARE =================
app.use(express.json());

// ✅ CORS
app.use((req, res, next) => {
  const allowedOrigins = [
    "https://logwatchai.vercel.app",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    process.env.DASHBOARD_ORIGIN,
  ].filter(Boolean);
  const origin = req.headers.origin;

  const isLocalDashboard = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin || "");

  if (allowedOrigins.includes(origin) || isLocalDashboard) {
    res.header("Access-Control-Allow-Origin", origin);
  }
  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, DELETE, OPTIONS, PATCH"
  );
  res.header(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  if (req.method === "OPTIONS") return res.sendStatus(200);
  next();
});

// ✅ Disable caching
app.use("/api", (req, res, next) => {
  res.set("Cache-Control", "no-store");
  next();
});

app.use((req, res, next) => {
  req.startTime = Date.now();
  next();
});

// ================= CONFIG =================
const getConfig = () => {
  try {
    return JSON.parse(fs.readFileSync("./config.json", "utf8"));
  } catch {
    return {
      mode: "stable",
      stable_url: "https://logwatch-stable.onrender.com",
      test_url: "https://logwatch-test.onrender.com",
      canary_percent: 10,
    };
  }
};

const saveConfig = (config) => {
  fs.writeFileSync("./config.json", JSON.stringify(config, null, 2));
};

async function diagnoseLogWatchNetwork(target = "127.0.0.1") {
  const scan = await scanNetwork({ target, profile: "logwatch" });
  const openPorts = new Set(
    (scan.hosts || []).flatMap((host) =>
      (host.ports || [])
        .filter((port) => port.state === "open")
        .map((port) => String(port.port))
    )
  );
  const expectedServices = [
    {
      name: "Dashboard",
      port: "3000",
      explanation: "The React dashboard should be reachable in the browser.",
      fix: "Start the dashboard with npm start in the dashboard folder.",
    },
    {
      name: "Proxy",
      port: "4000",
      explanation: "The proxy receives dashboard/API traffic and forwards requests.",
      fix: "Start the proxy with npm start in the proxy folder.",
    },
    {
      name: "Stable backend",
      port: "5001",
      explanation: "The stable backend is the safe fallback service.",
      fix: "Start backend-stable with npm start.",
    },
    {
      name: "Test backend",
      port: "5002",
      explanation: "The test backend receives canary/test traffic.",
      fix: "Start backend-test with npm start, then retry test traffic.",
    },
  ];

  const services = expectedServices.map((service) => ({
    ...service,
    status: openPorts.has(service.port) ? "open" : "closed",
    issue: openPorts.has(service.port)
      ? `${service.name} is reachable on port ${service.port}.`
      : `${service.name} is down or blocked on port ${service.port}.`,
  }));
  const networkIssues = services.filter((service) => service.status !== "open");

  return {
    target,
    services,
    networkIssues,
    scan,
  };
}

function getLogMessage(log) {
  const body = log?.responseBody;
  if (typeof body === "string") return body;
  return body?.message || body?.error || log?.message || "Unknown error";
}

function classifyNetworkRelatedErrors(logs = []) {
  const findings = new Map();

  for (const log of logs) {
    const statusCode = Number(log.statusCode || log.status);
    if (statusCode < 400) continue;

    const message = getLogMessage(log);
    const lower = message.toLowerCase();
    let finding = null;

    if (statusCode === 502) {
      finding = {
        key: "bad-gateway",
        title: "Proxy could not reach backend",
        explanation: "The proxy received a gateway failure while forwarding traffic. This usually means the selected backend crashed, refused the connection, or closed the connection unexpectedly.",
        fix: "Check that the selected backend process is still running, confirm its port is open in Network Monitor, then restart the backend and retry through the proxy.",
      };
    } else if (statusCode === 504 || lower.includes("timeout") || lower.includes("upstream")) {
      finding = {
        key: "timeout",
        title: "Backend dependency timeout",
        explanation: "The backend is reachable, but something it depends on is too slow or not responding. This can be an upstream API, database call, or blocked request handler.",
        fix: "Check the route returning the timeout in backend-test/server.js. Add a timeout limit and fallback response, and keep timeout simulation under /error/timeout instead of normal /api traffic.",
      };
    } else if (lower.includes("redis") || lower.includes("cache")) {
      finding = {
        key: "cache",
        title: "Cache service connection failure",
        explanation: "The backend is reachable, but its cache dependency is failing. In a real deployment this points to Redis being down, wrong host/port, or rejected credentials.",
        fix: "Verify Redis host, port, and credentials from the backend environment. For this demo, keep Redis failures only under /error/cache and remove random cache failures from /api.",
      };
    } else if (lower.includes("database connection") || lower.includes("connection pool") || lower.includes("deadlock")) {
      finding = {
        key: "database",
        title: "Database connectivity or transaction issue",
        explanation: "The backend is reachable, but the database layer is failing. Pool exhaustion means connections are unavailable; deadlocks mean competing transactions are blocking each other.",
        fix: "Check database connection limits, release connections after use, and retry deadlocked transactions safely. For this demo, keep DB failures under /error/db and remove random DB failures from /api.",
      };
    } else if (statusCode === 503 || lower.includes("overloaded") || lower.includes("unavailable")) {
      finding = {
        key: "service-overload",
        title: "Backend reachable but overloaded",
        explanation: "The service port is open, but the app is refusing requests because it is overloaded or intentionally simulating service unavailability.",
        fix: "Check backend-test/server.js for random overload responses on /api. Move overload simulation to a manual /error route and keep normal /api traffic stable.",
      };
    }

    if (!finding) continue;

    const current = findings.get(finding.key) || {
      ...finding,
      frequency: 0,
      severity: statusCode >= 500 ? "HIGH" : "MEDIUM",
      examples: [],
    };
    current.frequency += 1;
    if (current.examples.length < 3) {
      current.examples.push({
        statusCode,
        message,
        path: log.path || "/api",
        backend: log.target?.includes("test") ? "test" : "unknown",
      });
    }
    findings.set(finding.key, current);
  }

  return [...findings.values()].sort((a, b) => b.frequency - a.frequency).slice(0, 3);
}

// ================= ROUTES =================
app.get("/health", (req, res) => {
  res.json({ status: "ok", uptime: process.uptime() });
});

app.get("/api/stats", (req, res) => {
  const config = getConfig();
  res.json({
    ...errorTracker.getStats(),
    mode: config.mode,
    logs: logger.getTodayLogs(),
    rollbacks: autoRollback.getRollbackHistory(),
  });
});

app.get("/api/logs", (req, res) => {
  const logs = logger.getTodayLogs();
  res.json({ logs: logs || [] });
});

app.get("/api/config", (req, res) => {
  res.json(getConfig());
});

app.post("/api/config", (req, res) => {
  const { mode } = req.body;
  const config = getConfig();

  if (!["stable", "test", "canary"].includes(mode)) {
    return res.status(400).json({ error: "Invalid mode" });
  }

  config.mode = mode;
  saveConfig(config);

  res.json({ success: true });
});

app.get("/api/rollback-history", (req, res) => {
  try {
    const history = autoRollback.getRollbackHistory();
    res.json({ success: true, history });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch history" });
  }
});

app.post("/api/rollback", (req, res) => {
  const result = autoRollback.manualRollback();
  res.status(result.success ? 200 : 500).json(result);
});

app.post("/api/reset-stats", (req, res) => {
  errorTracker.reset();
  const logsCleared = logger.clearTodayLogs();
  res.json({ success: true, logsCleared });
});

app.get("/api/ai/state", (req, res) => {
  res.json({ success: true, data: getAIState() });
});

// ================= ANALYZE =================
app.post("/api/analyze", async (req, res) => {
  console.log("🔍 AI ANALYSIS TRIGGERED");

  try {
    const stats = errorTracker.getStats();
    const errorRate = parseFloat(stats.errorRatePercent || 0);
    let networkDiagnosis = null;

    try {
      const diagnosis = await diagnoseLogWatchNetwork("127.0.0.1");
      networkDiagnosis = {
        services: diagnosis.services,
        networkIssues: diagnosis.networkIssues,
      };
    } catch (networkErr) {
      networkDiagnosis = {
        error: networkErr.message,
        services: [],
        networkIssues: [],
      };
    }

    const analysis = await runAnalysisAgent({
      errorRate,
      stats: {
        ...stats,
        logs: logger.getTodayLogs(),
        networkDiagnosis,
      },
      autoRollback,
    });
    let patchResult = null;

    const hasNetworkIssue = (analysis.errors || []).some((error) => error.isNetworkIssue);
    const shouldPatch = !hasNetworkIssue && (analysis.errors || []).some((error) => Number(error.code) >= 400);

    if (shouldPatch) {
      try {
        const patch = await runPatchAgent({ analysis, stats });
        patchResult = patch ? applyPatch(patch) : null;
        if (patchResult && !patchResult.error) {
          analysis.errors = (analysis.errors || []).map((error) => ({
            ...error,
            fixedFile: patchResult.file,
            backupPath: patchResult.backupPath,
          }));
          analysis.topErrors = (analysis.topErrors || analysis.errors || []).map((error) => ({
            ...error,
            fixedFile: patchResult.file,
            backupPath: patchResult.backupPath,
          }));
        }
      } catch (patchErr) {
        patchResult = {
          success: false,
          error: patchErr.message,
        };
        console.error("[PATCH ERROR]", patchErr.message);
      }
    }

    res.json({
      success: true,
      data: analysis,
      patch: patchResult,
    });
  } catch (err) {
    console.error("❌ ANALYSIS ERROR:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/analyze-logs", async (req, res) => {
  try {
    const logs = Array.isArray(req.body?.logs) ? req.body.logs : [];
    const totalRequests = logs.length;
    const totalErrors = logs.filter((log) => Number(log.statusCode || log.status) >= 400).length;
    const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;

    const analysis = await runAnalysisAgent({
      errorRate,
      stats: {
        totalRequests,
        totalErrors,
        errorRate,
        logs,
      },
      autoRollback,
    });

    const firstError = analysis.errors?.[0];
    const result = [
      `**System Health:** ${analysis.risk || "LOW"}`,
      `**Primary Error:** ${firstError?.code || "None detected"}`,
      `**Root Cause:** ${firstError?.cause || "No clear failure pattern detected"}`,
      `**Recommended Action:** ${analysis.recommendation || "Monitor the system"}`,
      `**Actions:** ${(analysis.actions || ["MONITOR"]).join(", ")}`,
    ].join("\n");

    res.json({ success: true, result, data: analysis });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/network/scan", async (req, res) => {
  try {
    const result = await scanNetwork({
      target: req.body?.target,
      profile: req.body?.profile,
    });

    res.json({ success: true, data: result });
  } catch (err) {
    res.status(err.statusCode || 500).json({
      success: false,
      error: err.message,
    });
  }
});

app.post("/api/network/diagnose", async (req, res) => {
  try {
    const target = req.body?.target || "127.0.0.1";
    const networkDiagnosis = await diagnoseLogWatchNetwork(target);
    const stats = errorTracker.getStats();
    const config = getConfig();
    const logs = logger.getTodayLogs();
    const services = networkDiagnosis.services;
    const networkIssues = networkDiagnosis.networkIssues;
    const appErrors = logs.filter((log) => Number(log.statusCode) >= 400);
    const dependencyFindings = classifyNetworkRelatedErrors(logs);

    let diagnosis;
    if (networkIssues.length > 0) {
      diagnosis = `Network issue: ${networkIssues.map((service) => `${service.name} port ${service.port}`).join(", ")} not reachable.`;
    } else if (dependencyFindings.length > 0) {
      diagnosis = `All LogWatch ports are reachable, but ${dependencyFindings.length} network/dependency-related error type(s) were found in backend responses.`;
    } else if (appErrors.length > 0) {
      diagnosis = `Network ports are reachable. Current failures look application/backend related: ${appErrors.length} logged errors.`;
    } else {
      diagnosis = "Network ports are reachable and no current application errors are logged.";
    }

    res.json({
      success: true,
      data: {
        target,
        mode: config.mode,
        errorRate: stats.errorRate,
        totalErrors: stats.totalErrors,
        services,
        dependencyFindings,
        diagnosis,
        scan: networkDiagnosis.scan,
      },
    });
  } catch (err) {
    res.status(err.statusCode || 500).json({
      success: false,
      error: err.message,
    });
  }
});

// ================= PROXY =================
app.use((req, res) => {
  const config = getConfig();

  let target;
  if (config.mode === "test") {
    target = config.test_url;
  } else if (config.mode === "canary") {
    target =
      Math.random() * 100 < (config.canary_percent || 10)
        ? config.test_url
        : config.stable_url;
  } else {
    target = config.stable_url;
  }

  req.target = target;

  console.log(`➡️ ${req.method} ${req.path} → ${target}`);

  proxy.web(req, res, {
    target,
    changeOrigin: true,
    secure: true,
    timeout: 30000,
  });
});

// ================= PROXY RESPONSE (FIXED CORE) =================
proxy.on("proxyRes", (proxyRes, req, res) => {
  let body = [];
  const status = proxyRes.statusCode || 200;

  console.log("📡 REAL STATUS:", status);

  proxyRes.on("data", (chunk) => body.push(chunk));

  proxyRes.on("end", async () => {
    let responseBody;

    try {
      responseBody = JSON.parse(Buffer.concat(body).toString());
    } catch {
      responseBody = Buffer.concat(body).toString();
    }

    const duration = Date.now() - (req.startTime || Date.now());

    // ================= LOGGING =================
    try {
      logger.logRequest(req, res, duration, req.target, status, responseBody);
    } catch (e) {
      console.error("Logger error:", e.message);
    }

    // ================= ERROR TRACKING =================
    errorTracker.addRequest(status);

    const stats = errorTracker.getStats();
    const errorRate = parseFloat(stats.errorRatePercent || 0);

    console.log(`📊 ${status} | errorRate: ${errorRate}%`);

    // ================= INGEST =================
    if (status >= 400) {
      try {
        await ingestLogs([
          {
            statusCode: status,
            path: req.path,
            responseBody,
          },
        ]);
        console.log("📥 Error ingested");
      } catch (e) {
        console.error("Ingest error:", e.message);
      }
    }

    // ================= AI TRIGGER =================
    try {
      await triggerAgent.observe({
        statusCode: status,
        path: req.path,
        responseBody,
        errorRate,
        autoRollback,
      });
    } catch (e) {
      console.error("Agent error:", e.message);
    }
  });
});

// ================= PROXY ERROR =================
proxy.on("error", (err, req, res) => {
  console.error("❌ PROXY ERROR:", err.message);

  errorTracker.addRequest(502);

  if (!res.headersSent) {
    res.status(502).json({
      error: "Bad Gateway",
      message: err.message,
    });
  }
});

// ================= START =================
const PORT = process.env.PORT || 4000;

app.listen(PORT, async () => {
  console.log(`🚀 Server running on port ${PORT}`);

  try {
    await ingestLogs([
      {
        statusCode: 200,
        path: "/startup",
        responseBody: { message: "Server started" },
      },
    ]);
    console.log("✅ Pinecone seeded");
  } catch (e) {
    console.log("⚠️ Seed failed:", e.message);
  }
});
