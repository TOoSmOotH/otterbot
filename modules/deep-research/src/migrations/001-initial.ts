import type { ModuleMigration } from "@otterbot/shared";

export const migration001: ModuleMigration = {
  version: 1,
  description: "Create research_sessions and session_findings tables",

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS research_sessions (
        id TEXT PRIMARY KEY,
        topic TEXT NOT NULL,
        question TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'in_progress',
        summary TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT
      )
    `);

    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_sessions_topic ON research_sessions(topic)`,
    );
    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_sessions_status ON research_sessions(status)`,
    );

    db.exec(`
      CREATE TABLE IF NOT EXISTS session_findings (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
        source_type TEXT NOT NULL,
        source_url TEXT,
        title TEXT,
        content TEXT NOT NULL,
        relevance_score REAL,
        created_at TEXT NOT NULL
      )
    `);

    db.exec(
      `CREATE INDEX IF NOT EXISTS idx_findings_session ON session_findings(session_id)`,
    );
  },
};
