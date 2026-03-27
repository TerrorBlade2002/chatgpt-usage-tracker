const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 50,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000,
  ssl: process.env.DATABASE_URL && (process.env.DATABASE_URL.includes("neon") || process.env.DATABASE_URL.includes("railway"))
    ? { rejectUnauthorized: false }
    : false,
});

async function initializeDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS conversation_logs (
        id SERIAL PRIMARY KEY,
        session_id VARCHAR(100) NOT NULL,
        system_username VARCHAR(100) NOT NULL,
        gpt_name VARCHAR(200) NOT NULL,
        conversation_id VARCHAR(100) NOT NULL,
        turn_number INTEGER NOT NULL,
        first_question_summary TEXT,
        message_id VARCHAR(100),
        idempotency_key VARCHAR(100) UNIQUE,
        timestamp TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_logs_idempotency ON conversation_logs(idempotency_key)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_logs_timestamp ON conversation_logs(timestamp)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_logs_gpt_name ON conversation_logs(gpt_name)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_logs_username ON conversation_logs(system_username)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_logs_conversation ON conversation_logs(conversation_id)
    `);

    console.log("Database initialized successfully");
  } finally {
    client.release();
  }
}

async function logInteraction(data) {
  const { session_id, system_username, gpt_name, conversation_id, turn_number, first_question_summary, message_id, idempotency_key, timestamp } = data;

  const result = await pool.query(
    `INSERT INTO conversation_logs
      (session_id, system_username, gpt_name, conversation_id, turn_number, first_question_summary, message_id, idempotency_key, timestamp)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (idempotency_key) DO NOTHING
     RETURNING id, created_at`,
    [session_id, system_username, gpt_name, conversation_id, turn_number, first_question_summary, message_id, idempotency_key, timestamp]
  );

  if (result.rows.length === 0) {
    return { duplicate: true };
  }
  return result.rows[0];
}

async function getFilteredLogs({ from, to, gpt_name, system_username, limit = 1000, offset = 0 }) {
  let query = "SELECT * FROM conversation_logs WHERE 1=1";
  const params = [];
  let idx = 1;

  if (from) { query += ` AND timestamp >= $${idx++}`; params.push(from); }
  if (to) { query += ` AND timestamp <= $${idx++}`; params.push(to); }
  if (gpt_name) { query += ` AND gpt_name = $${idx++}`; params.push(gpt_name); }
  if (system_username) { query += ` AND system_username = $${idx++}`; params.push(system_username); }

  query += ` ORDER BY timestamp DESC LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(limit, offset);

  const result = await pool.query(query, params);
  return result.rows;
}

async function getStats({ from, to }) {
  let whereClause = "WHERE 1=1";
  const params = [];
  let idx = 1;

  if (from) { whereClause += ` AND timestamp >= $${idx++}`; params.push(from); }
  if (to) { whereClause += ` AND timestamp <= $${idx++}`; params.push(to); }

  const result = await pool.query(`
    SELECT
      gpt_name,
      COUNT(*) as total_interactions,
      COUNT(DISTINCT conversation_id) as total_conversations,
      COUNT(DISTINCT system_username) as unique_users,
      COUNT(DISTINCT session_id) as total_sessions,
      MAX(timestamp) as last_interaction
    FROM conversation_logs
    ${whereClause}
    GROUP BY gpt_name
    ORDER BY total_interactions DESC
  `, params);

  return result.rows;
}

async function getUniqueGptNames() {
  const result = await pool.query("SELECT DISTINCT gpt_name FROM conversation_logs ORDER BY gpt_name");
  return result.rows.map(r => r.gpt_name);
}

async function getUniqueUsernames() {
  const result = await pool.query("SELECT DISTINCT system_username FROM conversation_logs ORDER BY system_username");
  return result.rows.map(r => r.system_username);
}

module.exports = { pool, initializeDatabase, logInteraction, getFilteredLogs, getStats, getUniqueGptNames, getUniqueUsernames };
