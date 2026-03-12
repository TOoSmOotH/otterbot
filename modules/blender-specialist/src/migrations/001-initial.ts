import type { ModuleMigration } from "@otterbot/shared";

export const migration001: ModuleMigration = {
  version: 1,
  description: "Track poll cursor/state for blender specialist",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS poll_state (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  },
};
