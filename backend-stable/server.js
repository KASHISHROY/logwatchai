const express = require("express");
const app = express();

app.use(express.json());

app.get("/health", (req, res) => {
  res.json({ status: "healthy", backend: "stable", timestamp: new Date().toISOString() });
});

app.get("/api", (req, res) => {
  res.json({ backend: "stable", message: "Everything working perfectly" });
});

app.all("*splat", (req, res) => {
  res.json({ backend: "stable", message: "Everything working perfectly", method: req.method, path: req.path });
});

const PORT = process.env.PORT || 5001;
app.listen(PORT, () => {
  console.log(`Stable backend running on port ${PORT}`);
});