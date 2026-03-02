import type { ModuleMigration } from "@otterbot/shared";

export const migration003: ModuleMigration = {
  version: 3,
  description: "Add repo column to source_files (composite PK) and announcements for multi-repo support",
  up(db) {
    // SQLite doesn't support ALTER TABLE to change a PRIMARY KEY,
    // so we recreate source_files with a composite PK (repo, path).
    db.exec(`
      CREATE TABLE IF NOT EXISTS source_files_new (
        repo TEXT NOT NULL DEFAULT '',
        path TEXT NOT NULL,
        sha TEXT NOT NULL,
        size INTEGER,
        language TEXT,
        last_indexed_at TEXT NOT NULL,
        PRIMARY KEY (repo, path)
      )
    `);

    // Copy existing rows (repo defaults to '')
    db.exec(`
      INSERT OR IGNORE INTO source_files_new (repo, path, sha, size, language, last_indexed_at)
      SELECT '', path, sha, size, language, last_indexed_at FROM source_files
    `);

    db.exec(`DROP TABLE IF EXISTS source_files`);
    db.exec(`ALTER TABLE source_files_new RENAME TO source_files`);

    // Add repo column to announcements
    db.exec(`ALTER TABLE announcements ADD COLUMN repo TEXT NOT NULL DEFAULT ''`);
  },
};
