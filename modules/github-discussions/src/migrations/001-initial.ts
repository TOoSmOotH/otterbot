import type { ModuleMigration } from "@otterbot/shared";

export const migration001: ModuleMigration = {
  version: 1,
  description: "Create discussions and comments tables",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS discussions (
        id TEXT PRIMARY KEY,
        number INTEGER NOT NULL,
        title TEXT NOT NULL,
        body TEXT,
        author TEXT,
        category TEXT,
        url TEXT,
        state TEXT DEFAULT 'open',
        answer_body TEXT,
        answer_author TEXT,
        created_at TEXT,
        updated_at TEXT
      )
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS comments (
        id TEXT PRIMARY KEY,
        discussion_id TEXT NOT NULL REFERENCES discussions(id) ON DELETE CASCADE,
        body TEXT NOT NULL,
        author TEXT,
        is_answer INTEGER DEFAULT 0,
        created_at TEXT,
        updated_at TEXT
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_comments_discussion
      ON comments(discussion_id)
    `);
  },
};
