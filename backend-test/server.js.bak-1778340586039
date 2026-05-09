const express = require("express");
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
  console.log(`TEST BACKEND running on port ${PORT}`);
});
