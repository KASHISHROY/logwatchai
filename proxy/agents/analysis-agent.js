const { retrieveRelevantLogs } = require("../rag/retriever");
const { runExecutionAgent } = require("./execute-actions");
const { setAIState } = require("./ai-state");

function getErrorMessage(log) {
  const body = log?.responseBody;
  if (typeof body === "string") return body;
  return body?.message || body?.error || log?.message || "Unknown error";
}

function buildTopErrors(logs = []) {
  const errors = logs.filter((log) => Number(log.statusCode || log.status) >= 400);
  const grouped = new Map();

  for (const log of errors) {
    const statusCode = Number(log.statusCode || log.status) || 500;
    const message = getErrorMessage(log);
    const key = `${statusCode}:${message}`;
    const current = grouped.get(key) || {
      code: String(statusCode),
      message,
      count: 0,
      paths: new Set(),
      backends: new Set(),
      samples: [],
    };

    current.count += 1;
    current.paths.add(log.path || "/api");
    current.backends.add(log.target?.includes("test") ? "test" : log.backend || "unknown");
    if (current.samples.length < 3) current.samples.push(log);
    grouped.set(key, current);
  }

  const topGrouped = [...grouped.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 3)
    .map((error) => ({
      code: error.code,
      backend: [...error.backends].join(", ") || "unknown",
      frequency: error.count,
      paths: [...error.paths],
      cause: error.message,
      fix: "Use RAG context and inspect backend-test/server.js for the matching failure path",
      severity: Number(error.code) >= 500 ? "HIGH" : "MEDIUM",
      samples: error.samples,
      fixedFile: null,
    }));

  if (topGrouped.length >= 3 || errors.length === 0) return topGrouped;

  const usedKeys = new Set(topGrouped.map((error) => `${error.code}:${error.cause}`));
  const recentSamples = errors
    .slice()
    .reverse()
    .map((log) => {
      const statusCode = Number(log.statusCode || log.status) || 500;
      const message = getErrorMessage(log);
      return {
        code: String(statusCode),
        backend: log.target?.includes("test") ? "test" : log.backend || "unknown",
        frequency: 1,
        paths: [log.path || "/api"],
        cause: message,
        fix: "Inspect this recent failing request and compare with RAG context",
        severity: statusCode >= 500 ? "HIGH" : "MEDIUM",
        samples: [log],
        fixedFile: null,
      };
    })
    .filter((error) => {
      const key = `${error.code}:${error.cause}`;
      if (usedKeys.has(key)) return false;
      usedKeys.add(key);
      return true;
    });

  return [...topGrouped, ...recentSamples].slice(0, 3);
}

// ==============================
// FALLBACK AI DECISION (CRITICAL)
// ==============================
function buildFallbackAI(errorRate, stats) {
  const topErrors = buildTopErrors(stats?.logs || []);

  return {
    errors: topErrors.length > 0
      ? topErrors
      : [
          {
            code: errorRate > 25 ? "500" : "200",
            backend: errorRate > 25 ? "canary" : "stable",
            frequency: 0,
            cause: `System experiencing ${errorRate}% error rate`,
            fix:
              errorRate > 25
                ? "Rollback to stable backend and inspect canary"
                : "System healthy, monitor only",
            severity: errorRate > 30 ? "HIGH" : "LOW",
          },
        ],
    actions:
      errorRate > 25
        ? ["ROLLBACK"]
        : errorRate > 5
        ? ["MONITOR"]
        : ["IGNORE"],
    risk:
      errorRate > 30
        ? "HIGH"
        : errorRate > 10
        ? "MEDIUM"
        : "LOW",
    recommendation:
      errorRate > 25
        ? "Immediate rollback recommended"
        : "System stable",
  };
}

// ==============================
// SMART FALLBACK LOG BUILDER
// ==============================
function buildFallbackLogs(stats, errorRate) {
  const logs = [];

  if (errorRate > 25) {
    logs.push({
      statusCode: 502,
      path: "/api",
      responseBody: {
        message: `High error rate detected: ${errorRate}%`,
      },
    });
  } else if (errorRate > 0) {
    logs.push({
      statusCode: 404,
      path: "/api",
      responseBody: {
        message: `Minor errors detected`,
      },
    });
  } else {
    logs.push({
      statusCode: 200,
      path: "/api",
      responseBody: {
        message: `System healthy`,
      },
    });
  }

  return logs;
}

// ==============================
// MAIN ANALYSIS AGENT
// ==============================
async function runAnalysisAgent({ errorRate, stats, autoRollback }) {
  console.log("🧠 AnalysisAgent starting...");

  try {
    let relevantLogs = [];
    const topErrors = buildTopErrors(stats?.logs || []);

    // ==============================
    // STEP 1: Try RAG
    // ==============================
    try {
      relevantLogs = await retrieveRelevantLogs(
        "errors failures 500 502 503 timeout"
      );
    } catch (e) {
      console.warn("RAG failed:", e.message);
    }

    // ==============================
    // STEP 2: Fallback logs
    // ==============================
    if (!relevantLogs || relevantLogs.length === 0) {
      relevantLogs = buildFallbackLogs(stats, errorRate);
    }

    const logSummary = relevantLogs
      .map(
        (l) =>
          `Status:${l.statusCode} Path:${l.path} Message:${JSON.stringify(
            l.responseBody
          )}`
      )
      .join("\n");

    const topErrorSummary = topErrors.length > 0
      ? topErrors.map((e, i) => (
          `${i + 1}. HTTP ${e.code} x${e.frequency} Cause:${e.cause} Paths:${e.paths.join(",")}`
        )).join("\n")
      : "No live errors found";

    // ==============================
    // STEP 3: GROQ CALL
    // ==============================
    let ai;

    try {
      const response = await fetch(
        "https://api.groq.com/openai/v1/chat/completions",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
          },
          body: JSON.stringify({
            model: "llama-3.1-8b-instant",
            messages: [
              {
                role: "user",
                content: `Analyze logs and return JSON only.
Use the live top errors and RAG context to identify the top 3 relevant errors causing the issue.
Use ROLLBACK only when error rate is greater than 25%.
Return this shape:
{
  "errors": [{"code":"500","backend":"test","frequency":3,"cause":"...","fix":"...","severity":"HIGH"}],
  "actions": ["ROLLBACK"],
  "risk": "HIGH",
  "recommendation": "..."
}

Error rate: ${errorRate}%

Live top errors:
${topErrorSummary}

RAG context:
${logSummary}`,
              },
            ],
          }),
        }
      );

      if (!response.ok) {
        console.error("Groq failed");
        ai = buildFallbackAI(errorRate, stats);
      } else {
        const data = await response.json();

        try {
          const raw = data.choices[0].message.content;
          const json = raw.substring(
            raw.indexOf("{"),
            raw.lastIndexOf("}") + 1
          );
          ai = JSON.parse(json);
        } catch {
          ai = buildFallbackAI(errorRate, stats);
        }
      }
    } catch (err) {
      console.error("Groq error:", err.message);
      ai = buildFallbackAI(errorRate, stats);
    }

    // ==============================
    // SAFETY CHECK
    // ==============================
    if (!ai || !ai.actions) {
      ai = buildFallbackAI(errorRate, stats);
    }

    if (!Array.isArray(ai.errors) || ai.errors.length === 0) {
      ai.errors = topErrors.length > 0 ? topErrors : buildFallbackAI(errorRate, stats).errors;
    } else if (topErrors.length > 0) {
      ai.errors = topErrors.map((topError, index) => ({
        ...topError,
        ...(ai.errors[index] || {}),
      }));
    }

    ai.topErrors = topErrors.length > 0 ? topErrors : ai.errors.slice(0, 3);
    ai.ragContext = relevantLogs.slice(0, 5);

    console.log("✅ FINAL AI:", ai);

    // ==============================
    // SAVE STATE
    // ==============================
    setAIState({
      ...ai,
      errorRate,
      stats,
      timestamp: Date.now(),
    });

    // ==============================
    // EXECUTE ACTIONS (CRITICAL)
    // ==============================
    await runExecutionAgent({
      actions: ai.actions,
      errors: ai.errors,
      risk: ai.risk,
      recommendation: ai.recommendation,
      errorRate,
      stats,
      autoRollback,
    });

    console.log("🚀 ExecutionAgent triggered");

    return ai;
  } catch (err) {
    console.error("FINAL FAIL:", err.message);

    const fallback = buildFallbackAI(errorRate, stats);

    await runExecutionAgent({
      actions: fallback.actions,
      errors: fallback.errors,
      risk: fallback.risk,
      recommendation: fallback.recommendation,
      errorRate,
      stats,
      autoRollback,
    });

    return fallback;
  }
}

module.exports = { runAnalysisAgent };
