const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();
const db = require("./db");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

// Request logging
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.path}`);
  next();
});

// Health check
app.get("/health", (req, res) => res.json({ status: "ok", uptime: process.uptime() }));

// ---- POST /api/log - Receive logs from Chrome Extension ----
app.post("/api/log", async (req, res) => {
  try {
    const { session_id, system_username, gpt_name, conversation_id, turn_number, first_question_summary, message_id, idempotency_key, timestamp } = req.body;

    if (!gpt_name || !conversation_id || !idempotency_key) {
      return res.status(400).json({ error: "Missing required fields: gpt_name, conversation_id, idempotency_key" });
    }

    const result = await db.logInteraction(req.body);

    if (result.duplicate) {
      return res.json({ success: true, duplicate: true, message: "Already logged" });
    }

    res.status(201).json({ success: true, id: result.id, created_at: result.created_at });
  } catch (error) {
    console.error("Log error:", error);
    res.status(500).json({ error: "Failed to log interaction" });
  }
});

// ---- GET /api/reports - Filtered logs for dashboard ----
app.get("/api/reports", async (req, res) => {
  try {
    const { from, to, gpt_name, system_username, limit, offset } = req.query;
    const logs = await db.getFilteredLogs({
      from: from || null, to: to || null,
      gpt_name: gpt_name || null, system_username: system_username || null,
      limit: parseInt(limit) || 1000, offset: parseInt(offset) || 0,
    });
    res.json({ count: logs.length, logs });
  } catch (error) {
    console.error("Reports error:", error);
    res.status(500).json({ error: "Failed to get reports" });
  }
});

// ---- GET /api/reports/csv - Download CSV ----
app.get("/api/reports/csv", async (req, res) => {
  try {
    const { from, to, gpt_name, system_username } = req.query;
    const logs = await db.getFilteredLogs({
      from: from || null, to: to || null,
      gpt_name: gpt_name || null, system_username: system_username || null,
      limit: 50000, offset: 0,
    });

    const headers = ["ID", "Session ID", "System Username", "GPT Name", "Conversation ID", "Turn Number", "First Question Summary", "Current Question Summary", "Message ID", "Timestamp", "Created At"];
    const csvRows = [headers.join(",")];

    for (const row of logs) {
      csvRows.push([
        row.id,
        row.session_id,
        `"${(row.system_username || "").replace(/"/g, '""')}"`,
        `"${(row.gpt_name || "").replace(/"/g, '""')}"`,
        row.conversation_id,
        row.turn_number,
        `"${(row.first_question_summary || "").replace(/"/g, '""')}"`,
        `"${(row.current_question_summary || "").replace(/"/g, '""')}"`,
        row.message_id,
        row.timestamp,
        row.created_at,
      ].join(","));
    }

    const filename = `gpt-usage-report-${new Date().toISOString().split("T")[0]}.csv`;
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.send(csvRows.join("\n"));
  } catch (error) {
    console.error("CSV error:", error);
    res.status(500).json({ error: "Failed to generate CSV" });
  }
});

// ---- GET /api/stats - Aggregated stats ----
app.get("/api/stats", async (req, res) => {
  try {
    const { from, to } = req.query;
    const stats = await db.getStats({ from: from || null, to: to || null });
    res.json({ stats });
  } catch (error) {
    console.error("Stats error:", error);
    res.status(500).json({ error: "Failed to get stats" });
  }
});

// ---- GET /api/filters - Get unique filter values ----
app.get("/api/filters", async (req, res) => {
  try {
    const [gptNames, usernames] = await Promise.all([db.getUniqueGptNames(), db.getUniqueUsernames()]);
    res.json({ gpt_names: gptNames, usernames });
  } catch (error) {
    res.status(500).json({ error: "Failed to get filters" });
  }
});

// Serve dashboard
app.use("/dashboard", express.static(path.join(__dirname, "dashboard")));
app.get("/", (req, res) => res.redirect("/dashboard"));

// Error handler
app.use((err, req, res, next) => {
  console.error("Unhandled:", err);
  res.status(500).json({ error: "Internal server error" });
});

async function start() {
  try {
    await db.initializeDatabase();
    app.listen(PORT, () => console.log(`Server running on port ${PORT}\nDashboard: http://localhost:${PORT}/dashboard`));
  } catch (e) {
    console.error("Failed to start:", e);
    process.exit(1);
  }
}
start();
