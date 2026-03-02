import type { ModuleMigration } from "@otterbot/shared";

export const migration002: ModuleMigration = {
  version: 2,
  description: "Create announcements table for tracking posted announcements",
  up(db) {
    db.exec(`
      CREATE TABLE IF NOT EXISTS announcements (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        type TEXT NOT NULL,
        reference_id TEXT NOT NULL,
        content TEXT NOT NULL,
        posted_at TEXT NOT NULL
      )
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_announcements_channel
      ON announcements(channel_id)
    `);

    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_announcements_ref
      ON announcements(reference_id)
    `);
  },
};
