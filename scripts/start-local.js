const { spawn } = require("child_process");

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";

const services = [
  { name: "stable", cwd: "backend-stable", args: ["start"] },
  { name: "test", cwd: "backend-test", args: ["start"] },
  { name: "proxy", cwd: "proxy", args: ["start"] },
  {
    name: "dashboard",
    cwd: "dashboard",
    args: ["start"],
    env: { REACT_APP_API_BASE_URL: "http://127.0.0.1:4000" },
  },
];

const children = services.map((service) => {
  const child = spawn(npmCommand, service.args, {
    cwd: service.cwd,
    env: { ...process.env, ...(service.env || {}) },
    stdio: ["ignore", "pipe", "pipe"],
    shell: false,
  });

  child.stdout.on("data", (chunk) => {
    process.stdout.write(`[${service.name}] ${chunk}`);
  });

  child.stderr.on("data", (chunk) => {
    process.stderr.write(`[${service.name}] ${chunk}`);
  });

  child.on("exit", (code, signal) => {
    console.log(`[${service.name}] exited ${signal || code}`);
  });

  return child;
});

function stopAll() {
  for (const child of children) {
    if (!child.killed) child.kill();
  }
}

process.on("SIGINT", () => {
  stopAll();
  process.exit(0);
});

process.on("SIGTERM", () => {
  stopAll();
  process.exit(0);
});
