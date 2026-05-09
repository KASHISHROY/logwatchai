const { retrieveRelevantLogs } = require("../rag/retriever");
const { runExecutionAgent } = require("./execute-actions");

class TriggerAgent {
  constructor(errorTracker, autoRollback, config = {}) {
    this.errorTracker = errorTracker;
    this.autoRollback = autoRollback; // ✅ FIX
    this.errorThreshold = config.errorThreshold || 25;
    this.minRequests = config.minRequests || 20;
    this.cooldownMs = config.cooldownMs || 60000;

    this.lastRun = 0;
  }

  async observe(log) {
    try {
      const stats = this.errorTracker.getStats();
      const errorRate = parseFloat(stats.errorRatePercent || 0);

      if (stats.totalRequests < this.minRequests) return;

      if (errorRate <= this.errorThreshold) return;

      if (Date.now() - this.lastRun < this.cooldownMs) return;

      console.log("🤖 TriggerAgent activated");

      this.lastRun = Date.now();

      let logs = await retrieveRelevantLogs("errors failures 500 502 503");

      // ✅ FIX: don't stop
      if (!logs || logs.length === 0) {
        logs = [{ statusCode: 500, path: "/api" }];
      }

      const ai = await this.callAI(logs, errorRate) || { actions: ["ROLLBACK"] };

      console.log("🧠 Agent Decision:", ai);

      // ✅ FIX: pass correct autoRollback
      await runExecutionAgent({
        actions: ai.actions,
        errorRate,
        autoRollback: this.autoRollback,
      });

      return ai;

    } catch (err) {
      console.error("[TRIGGER AGENT ERROR]", err.message);
    }
  }

  async callAI(logs, errorRate) {
    try {
      const prompt = `
Error rate: ${errorRate}%.

If >25 → ROLLBACK
If <10 → IGNORE
Else → RESTART_SERVICE

Logs:
${logs.map(l => `Status:${l.statusCode}`).join("\n")}

Return JSON:
{ "actions": ["ROLLBACK"] }
`;

      const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.GROQ_API_KEY}`,
        },
        body: JSON.stringify({
          model: "llama-3.1-8b-instant",
          messages: [{ role: "user", content: prompt }],
          temperature: 0.7, // ✅ FIX
        }),
      });

      const data = await res.json();
      const content = data?.choices?.[0]?.message?.content;

      if (!content) return null;

      const raw = content.trim();
      const json = raw.substring(raw.indexOf("{"), raw.lastIndexOf("}") + 1);

      return JSON.parse(json);

    } catch (err) {
      console.error("[AI ERROR]", err.message);
      return null;
    }
  }
}

module.exports = TriggerAgent;
