import { useRef, useState } from "react";
import { useSettingsStore } from "../../stores/settings-store";

export function SystemSection() {
  const backupDatabase = useSettingsStore((s) => s.backupDatabase);
  const restoreDatabase = useSettingsStore((s) => s.restoreDatabase);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState(false);

  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (
      !window.confirm(
        "WARNING: This will overwrite your current database with the backup. All current data will be lost. Are you sure?",
      )
    ) {
      e.target.value = ""; // Reset
      return;
    }

    setRestoring(true);
    const res = await restoreDatabase(file);
    setRestoring(false);
    e.target.value = ""; // Reset

    if (res.ok) {
      window.alert("Database restored successfully. The page will reload.");
      window.location.reload();
    } else {
      window.alert(`Restore failed: ${res.error}`);
    }
  };

  return (
    <div className="p-5 space-y-6">
      <div>
        <h3 className="text-xs font-semibold mb-1">System</h3>
        <p className="text-xs text-muted-foreground">
          About Otterbot and data management.
        </p>
      </div>

      {/* About */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold">About</h4>
        <div className="bg-secondary border border-border rounded-lg p-4 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Application</span>
            <span className="text-xs font-medium">Otterbot</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">License</span>
            <span className="text-xs font-medium">MIT</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">Source</span>
            <a
              href="https://github.com/mreeves/otterbot"
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-primary hover:underline"
            >
              GitHub
            </a>
          </div>
        </div>
      </div>

      {/* Data Management */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold">Data Management</h4>
        <div className="bg-secondary border border-border rounded-lg p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium">Storage</p>
              <p className="text-[10px] text-muted-foreground">
                Local database and file storage
              </p>
            </div>
            <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded">
              Coming Soon
            </span>
          </div>
          <div className="border-t border-border" />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium">Cache</p>
              <p className="text-[10px] text-muted-foreground">
                Clear cached data and temporary files
              </p>
            </div>
            <span className="text-[10px] text-muted-foreground bg-muted px-2 py-0.5 rounded">
              Coming Soon
            </span>
          </div>
          <div className="border-t border-border" />
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-medium">Backup & Restore</p>
              <p className="text-[10px] text-muted-foreground">
                Export and import your data
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => backupDatabase()}
                className="text-[10px] bg-primary text-primary-foreground px-2 py-1 rounded hover:bg-primary/90 transition-colors cursor-pointer"
              >
                Download Backup
              </button>
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={restoring}
                className="text-[10px] bg-destructive text-destructive-foreground px-2 py-1 rounded hover:bg-destructive/90 transition-colors cursor-pointer disabled:opacity-50"
              >
                {restoring ? "Restoring..." : "Restore Backup"}
              </button>
              <input
                type="file"
                accept=".db,.sqlite,application/x-sqlite3"
                className="hidden"
                ref={fileInputRef}
                onChange={handleRestore}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
