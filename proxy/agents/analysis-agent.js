const { retrieveRelevantLogs } = require("../rag/retriever");
const { runExecutionAgent } = require("./execute-actions");
const { setAIState } = require("./ai-state");

function getErrorMessage(log) {
  const body = log?.responseBody;
  if (typeof body === "string") return body;
  return body?.message || body?.error || log?.message || "Unknown error";
}

function describeError(statusCode, message) {
  const text = String(message || "").toLowerCase();

  if (statusCode === 502) {
    return {
      explanation: "The proxy could not reach the selected backend or the backend connection failed. This usually means the backend process is down, the port is closed, or the upstream crashed while handling the request.",
      fix: "Use Network Monitor to confirm the backend port is open. Restart the missing backend service, then retry requests through the proxy.",
    };
  }

  if (statusCode === 504 || text.includes("timeout")) {
    return {
      explanation: "The test backend accepted traffic but did not respond fast enough. This points to a slow upstream operation, blocked event loop, or a simulated timeout path in the test service.",
      fix: "Check the slow route in backend-test/server.js and remove the timeout behavior from normal /api traffic. Keep timeout simulation only under a manual /error/timeout route.",
    };
  }

  if (text.includes("database connection pool")) {
    return {
      explanation: "The test backend is simulating database pool exhaustion. In a real service, this means requests are waiting for DB connections and the pool limit is too small or connections are not being released.",
      fix: "Move this failure out of normal /api traffic in backend-test/server.js. Keep it only in /error/db, and make /api return a stable success response.",
    };
  }

  if (text.includes("deadlock")) {
    return {
      explanation: "The test backend is simulating a database transaction deadlock. In production, two transactions would be blocking each other and one gets rolled back.",
      fix: "Stop returning deadlock errors from normal /api traffic. Keep the deadlock scenario as a dedicated manual test route and make /api stable.",
    };
  }

  if (text.includes("redis") || text.includes("cache")) {
    return {
      explanation: "The test backend is simulating a Redis/cache connection failure. In a real system, cache calls would fail and could slow or break request handling.",
      fix: "Keep cache failure simulation under /error/cache only. Normal /api traffic should not randomly return Redis failures.",
    };
  }

  if (statusCode === 503 || text.includes("overloaded") || text.includes("unavailable")) {
    return {
      explanation: "The test backend is reporting service overload or unavailability. This means the service is reachable, but it is refusing or failing requests at the application layer.",
      fix: "Remove random overload responses from /api in backend-test/server.js. Keep overload simulation in a manual /error route.",
    };
  }

  if (statusCode === 429 || text.includes("rate limit")) {
    return {
      explanation: "The test backend is simulating rate limiting. This means the service is intentionally rejecting too many requests.",
      fix: "Do not randomly rate-limit normal /api traffic. Keep rate-limit testing under /error/rate-limit.",
    };
  }

  if (statusCode === 400 || text.includes("validation")) {
    return {
      explanation: "The test backend is returning a validation error, which means the request is treated as invalid. In this demo, the invalid input is being simulated randomly.",
      fix: "Remove random validation failures from /api. Keep validation failure testing under /error/validation so normal test traffic stays healthy.",
    };
  }

  if (statusCode >= 500) {
    return {
      explanation: "The backend returned a server-side failure. The service was reachable, so this is more likely application behavior than a network outage.",
      fix: "Inspect backend-test/server.js for the route producing this response and keep the failure behind a manual /error route.",
    };
  }

  return {
    explanation: "The backend returned an error response while handling normal traffic. The request reached the service, so this is likely application behavior.",
    fix: "Inspect the matching route in backend-test/server.js and keep this failure out of normal /api traffic.",
  };
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
      ...describeError(Number(error.code), error.message),
      code: error.code,
      backend: [...error.backends].join(", ") || "unknown",
      frequency: error.count,
      paths: [...error.paths],
      cause: error.message,
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
        ...describeError(statusCode, message),
        code: String(statusCode),
        backend: log.target?.includes("test") ? "test" : log.backend || "unknown",
        frequency: 1,
        paths: [log.path || "/api"],
        cause: message,
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

function buildNetworkErrors(networkDiagnosis) {
  const issues = networkDiagnosis?.networkIssues || [];
  return issues.slice(0, 3).map((service) => ({
    code: "NETWORK",
    backend: service.name,
    frequency: 1,
    paths: [`port ${service.port}`],
    cause: service.issue || `${service.name} is not reachable.`,
    explanation: service.explanation || "A required service port is closed, so requests cannot reach that service.",
    fix: service.fix || `Start ${service.name} and confirm port ${service.port} is open.`,
    severity: "HIGH",
    samples: [],
    fixedFile: null,
    isNetworkIssue: true,
  }));
}

// ==============================
// FALLBACK AI DECISION (CRITICAL)
// ==============================
function buildFallbackAI(errorRate, stats) {
  const networkErrors = buildNetworkErrors(stats?.networkDiagnosis);
  const codeErrors = buildTopErrors(stats?.logs || []);
  const topErrors = codeErrors.length > 0 ? codeErrors : networkErrors.slice(0, 3);

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
      networkErrors.length > 0
        ? ["FIX_NETWORK"]
        : errorRate > 25
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
      networkErrors.length > 0
        ? "Fix the unreachable service before changing code"
        : errorRate > 25
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
    const networkErrors = buildNetworkErrors(stats?.networkDiagnosis);
    const codeErrors = buildTopErrors(stats?.logs || []);
    const topErrors = codeErrors.length > 0 ? codeErrors : networkErrors.slice(0, 3);

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
Use live top errors and RAG context to identify the top 3 backend/code errors causing the issue.
Use network diagnosis only to detect closed ports or unreachable services. Do not classify database, Redis, deadlock, validation, memory, overload, or rate-limit responses as network issues.
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

Network diagnosis:
${JSON.stringify(stats?.networkDiagnosis || {}, null, 2)}

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
        ...(ai.errors[index] || {}),
        ...topError,
        explanation: topError.explanation || ai.errors[index]?.explanation,
        fix: topError.fix || ai.errors[index]?.fix,
      }));
    }

    ai.topErrors = topErrors.length > 0 ? topErrors : ai.errors.slice(0, 3);
    if (networkErrors.length > 0 && codeErrors.length === 0) {
      ai.risk = "HIGH";
      ai.recommendation = "Fix the unreachable service shown in Network Monitor, then retry requests.";
      ai.actions = ["FIX_NETWORK"];
    }
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
