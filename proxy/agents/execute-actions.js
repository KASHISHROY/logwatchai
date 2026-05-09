const runExecutionAgent = async ({ actions = [], errorRate, autoRollback }) => {
  const results = [];

  const uniqueActions = [...new Set(actions)];

  for (const action of uniqueActions) {
    try {
      switch (action) {

        case "ROLLBACK":
          console.log("⚠️ Triggering rollback");

          // ✅ FIX: await
          if (!autoRollback) {
            results.push({
              action,
              status: "skipped",
              details: { error: "AutoRollback service unavailable" },
            });
            break;
          }

          const result = await autoRollback.checkAndRollback(errorRate);

          results.push({
            action,
            status: result?.rolled ? "executed" : "no-change",
            details: result,
          });
          break;

        case "RESTART_SERVICE":
          console.log("🔁 Restart service (mock)");
          break;

        case "IGNORE":
          console.log("✅ Ignored");
          break;

      }
    } catch (err) {
      console.error("[ExecutionAgent ERROR]", err.message);
    }
  }

  return results;
};

module.exports = { runExecutionAgent };
