import type { ModuleMigration } from "@otterbot/shared";

export const migration001: ModuleMigration = {
  version: 1,
  description: "Create threads, thread_messages, and source_files tables",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        thread_id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        title TEXT NOT NULL,
        author_id TEXT,
        author_name TEXT,
        status TEXT DEFAULT 'open',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_responded_at TEXT
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_threads_channel
      ON threads(channel_id)
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_threads_status
      ON threads(status)
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS thread_messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(thread_id) ON DELETE CASCADE,
        discord_message_id TEXT NOT NULL UNIQUE,
        author_id TEXT NOT NULL,
        author_name TEXT,
        is_bot INTEGER DEFAULT 0,
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_thread_messages_thread
      ON thread_messages(thread_id)
    `);

    db.exec(`
      CREATE TABLE IF NOT EXISTS source_files (
        path TEXT PRIMARY KEY,
        sha TEXT NOT NULL,
        size INTEGER,
        language TEXT,
        last_indexed_at TEXT NOT NULL
      )
    `);
  },
};
