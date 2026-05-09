const fs = require("fs");
const path = require("path");

function buildFallbackTestBackend() {
  return `const express = require("express");
const app = express();

app.use(express.json());

app.get("/api", (req, res) => {
  res.json({
    status: "ok",
    backend: "test",
    fixed: true,
    latency: Math.floor(Math.random() * 50),
    timestamp: new Date().toISOString(),
  });
});

app.get("/error/db", (req, res) => {
  res.status(500).json({ message: "Database connection pool exhausted" });
});

app.get("/error/memory", (req, res) => {
  res.status(500).json({ message: "Out of memory - heap exceeded" });
});

app.get("/error/timeout", (req, res) => {
  res.status(504).json({ message: "Gateway timeout - upstream slow" });
});

app.get("/error/rate-limit", (req, res) => {
  res.status(429).json({ message: "Too many requests" });
});

app.get("/error/cache", (req, res) => {
  res.status(500).json({ message: "Redis cache connection failed" });
});

app.get("/error/validation", (req, res) => {
  res.status(400).json({ message: "Validation failed" });
});

app.get("/health", (req, res) => {
  res.json({
    status: "healthy",
    backend: "test",
    fixed: true,
    timestamp: new Date().toISOString(),
  });
});

app.use((req, res) => {
  res.json({
    status: "ok",
    backend: "test",
    fixed: true,
    path: req.path,
  });
});

const PORT = process.env.PORT || 5002;

app.listen(PORT, () => {
  console.log(\`TEST BACKEND running on port \${PORT}\`);
});
`;
}

async function callAI(fileContent, analysis) {
  const errorSummary = (analysis.errors || [])
    .slice(0, 3)
    .map((error, index) => (
      `${index + 1}. HTTP ${error.code || "unknown"} frequency=${error.frequency || "unknown"} cause=${error.cause || error.message || "unknown"} fix=${error.fix || "infer fix"}`
    ))
    .join("\n");
  const ragSummary = (analysis.ragContext || [])
    .slice(0, 5)
    .map((log, index) => `${index + 1}. ${log.text || JSON.stringify(log)}`)
    .join("\n");

  const prompt = `
You are an expert backend engineer.

Fix the test backend code based on the top errors and RAG context.
The current test backend is causing canary/test failures. Preserve useful routes and keep the server runnable.

TOP ERRORS:
${errorSummary || "No top errors provided"}

RAG CONTEXT:
${ragSummary || "No RAG context available"}

CODE:
${fileContent}

IMPORTANT RULES:
- Return ONLY full corrected file code
- No explanations
- No markdown
- No backticks
- No comments like TODO
- Keep Express JSON API behavior
- Do not remove /health
- Make /api stable unless a dedicated /error route is called
`;

  try {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model: "llama-3.1-8b-instant",
        messages: [{ role: "user", content: prompt }],
        temperature: 0.7,
      }),
    });

    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content;
    if (!content) throw new Error("No response from Groq");

    let output = content.trim();

    // 🧠 CLEAN RESPONSE
    output = output.replace(/^```[a-z]*\n?/gm, "").replace(/```$/gm, "").trim();

    // ❌ VALIDATION (prevents bad patches)
    if (!output || output.length < 20) {
      throw new Error("AI returned empty or invalid code");
    }

    if (output.includes("TODO")) {
      throw new Error("AI returned placeholder code");
    }

    return output;
  } catch (err) {
    console.error("[AI ERROR]", err.message);
    throw err;
  }
}

async function runPatchAgent({ analysis, stats }) {
  if (!analysis || !analysis.errors || analysis.errors.length === 0) {
    return null;
  }

  const primaryError = analysis.errors[0];
  console.log("🛠️ PatchAgent analyzing root cause:", primaryError.cause);

  // Defaulting to the backend-test server.js for auto-patching demonstration
  const targetFile = path.resolve(__dirname, "../../backend-test/server.js");

  let fileContent;
  try {
    fileContent = fs.readFileSync(targetFile, "utf8");
  } catch (err) {
    console.error("❌ Failed to read target file for patching.");
    return null;
  }

  // Generate patch code using Llama-3.1
  let newlyGeneratedAiCode;
  let patchSource = "groq";

  try {
    newlyGeneratedAiCode = await callAI(fileContent, analysis);
  } catch (err) {
    console.warn("[PatchAgent] Groq patch failed, using deterministic fallback:", err.message);
    newlyGeneratedAiCode = buildFallbackTestBackend();
    patchSource = "fallback";
  }

  return {
    file: targetFile,
    replacement: newlyGeneratedAiCode,
    type: "replace",
    reason: primaryError.cause,
    source: patchSource,
  };
}

module.exports = { runPatchAgent };
