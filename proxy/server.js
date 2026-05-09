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

    const analysis = await runAnalysisAgent({
      errorRate,
      stats: {
        ...stats,
        logs: logger.getTodayLogs(),
      },
      autoRollback,
    });
    let patchResult = null;

    const shouldPatch = (analysis.errors || []).some((error) => Number(error.code) >= 400);

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
