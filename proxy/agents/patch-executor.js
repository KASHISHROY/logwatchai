const fs = require("fs");
const vm = require("vm");

function isValidPatch(content) {
  if (!content || typeof content !== "string") return false;
  if (content.includes("TODO")) return false;
  if (content.trim().length < 10) return false;
  if (!content.includes("express")) return false;
  if (!content.includes("app.listen")) return false;

  try {
    new vm.Script(content);
  } catch {
    return false;
  }

  return true;
}

function backupFile(file) {
  const backupPath = `${file}.bak-${Date.now()}`;
  fs.copyFileSync(file, backupPath);
  return backupPath;
}

function applyPatch(patch) {
  if (!patch?.file) return null;

  if (patch.type !== "replace") return null;

  if (!isValidPatch(patch.replacement)) {
    throw new Error("Invalid AI patch - aborting write");
  }

  const backupPath = backupFile(patch.file);
  fs.writeFileSync(patch.file, patch.replacement, "utf8");

  console.log("Patch applied to:", patch.file);

  return {
    file: patch.file,
    backupPath,
    reason: patch.reason || "AI generated patch",
    source: patch.source || "unknown",
    appliedAt: new Date().toISOString(),
  };
}

module.exports = { applyPatch };
