import type { ModuleMigration } from "@otterbot/shared";

export const migration001: ModuleMigration = {
  version: 1,
  description: "Create initial tables",
  up(db) {
    // Create your tables here. Example:
    //
    // db.exec(`
    //   CREATE TABLE IF NOT EXISTS items (
    //     id TEXT PRIMARY KEY,
    //     title TEXT NOT NULL,
    //     content TEXT,
    //     url TEXT,
    //     author TEXT,
    //     created_at TEXT,
    //     updated_at TEXT
    //   )
    // `);
  },
};
