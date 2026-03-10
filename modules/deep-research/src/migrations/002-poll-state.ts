import type { ModuleMigration } from "@otterbot/shared";

export const migration002: ModuleMigration = {
  version: 2,
  description: "Create poll_state table for background research round-robin tracking",

  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS poll_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        last_subject_index INTEGER NOT NULL DEFAULT 0,
        last_polled_at TEXT
      )
    `);

    // Ensure the singleton row exists
    db.exec(`INSERT OR IGNORE INTO poll_state (id) VALUES (1)`);
  },
};
