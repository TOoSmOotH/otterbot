import { useState, useEffect } from "react";
import { cn } from "../../lib/utils";

interface InstalledModule {
  id: string;
  moduleId?: string;
  name: string;
  version: string;
  source: "git" | "npm" | "local";
  sourceUri: string;
  enabled: boolean;
  loaded: boolean;
  documents: number;
  hasQuery: boolean;
  installedAt: string;
  updatedAt: string;
}

export function ModulesSection() {
  const [modules, setModules] = useState<InstalledModule[]>([]);
  const [loading, setLoading] = useState(true);
  const [showInstall, setShowInstall] = useState(false);
  const [installSource, setInstallSource] = useState<"git" | "npm" | "local">("local");
  const [installUri, setInstallUri] = useState("");
  const [instanceId, setInstanceId] = useState("");
  const [installing, setInstalling] = useState(false);
  const [installError, setInstallError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const [duplicateInstanceId, setDuplicateInstanceId] = useState("");
  const [duplicateError, setDuplicateError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadModules = async () => {
    try {
      const res = await fetch("/api/modules");
      if (res.ok) {
        setModules(await res.json());
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadModules();
  }, []);

  const handleInstall = async () => {
    if (!installUri.trim()) return;
    setInstalling(true);
    setInstallError(null);
    try {
      const res = await fetch("/api/modules/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: installSource,
          uri: installUri,
          ...(instanceId.trim() ? { instanceId: instanceId.trim() } : {}),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setInstallError(data.error ?? "Installation failed");
      } else {
        setInstallUri("");
        setInstanceId("");
        setShowInstall(false);
        await loadModules();
      }
    } catch (err) {
      setInstallError(err instanceof Error ? err.message : "Installation failed");
    } finally {
      setInstalling(false);
    }
  };

  const handleToggle = async (id: string, enabled: boolean) => {
    setTogglingId(id);
    setToggleError(null);
    try {
      const res = await fetch(`/api/modules/${id}/toggle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        const data = await res.json();
        setToggleError(data.error ?? "Toggle failed");
      }
      await loadModules();
    } catch (err) {
      setToggleError(err instanceof Error ? err.message : "Toggle failed");
    } finally {
      setTogglingId(null);
    }
  };

  const handleDuplicate = async (mod: InstalledModule) => {
    if (duplicatingId !== mod.id) {
      setDuplicatingId(mod.id);
      setDuplicateInstanceId(`${mod.moduleId ?? mod.id}-copy`);
      setDuplicateError(null);
      return;
    }
    if (!duplicateInstanceId.trim()) return;
    setDuplicateError(null);
    try {
      const res = await fetch("/api/modules/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: mod.source,
          uri: mod.sourceUri,
          instanceId: duplicateInstanceId.trim(),
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        setDuplicateError(data.error ?? "Duplicate failed");
        return;
      }
      setDuplicatingId(null);
      setDuplicateInstanceId("");
      await loadModules();
    } catch (err) {
      setDuplicateError(err instanceof Error ? err.message : "Duplicate failed");
    }
  };

  const handleDelete = async (id: string) => {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id);
      return;
    }
    setDeletingId(id);
    try {
      await fetch(`/api/modules/${id}`, { method: "DELETE" });
      setConfirmDeleteId(null);
      await loadModules();
    } catch {
      /* ignore */
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="p-5 space-y-4">
      <p className="text-xs text-muted-foreground">
        Install and manage knowledge modules. Modules are data sources that index content
        into isolated knowledge stores, queryable by the COO via tools.
      </p>

      {/* Install button */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowInstall(!showInstall)}
          className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90"
        >
          {showInstall ? "Cancel" : "Install Module"}
        </button>
      </div>

      {/* Install form */}
      {showInstall && (
        <div className="border border-border rounded-lg p-4 space-y-3">
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
              Source
            </label>
            <div className="flex gap-2">
              {(["local", "git", "npm"] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => setInstallSource(s)}
                  className={cn(
                    "text-xs px-3 py-1.5 rounded-md",
                    installSource === s
                      ? "bg-primary text-primary-foreground"
                      : "bg-secondary text-foreground hover:bg-secondary/80",
                  )}
                >
                  {s === "local" ? "Local Path" : s === "git" ? "Git URL" : "npm Package"}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
              {installSource === "local"
                ? "File Path"
                : installSource === "git"
                  ? "Repository URL"
                  : "Package Name"}
            </label>
            <input
              type="text"
              value={installUri}
              onChange={(e) => setInstallUri(e.target.value)}
              placeholder={
                installSource === "local"
                  ? "/path/to/module"
                  : installSource === "git"
                    ? "https://github.com/user/otterbot-module-example.git"
                    : "otterbot-module-example"
              }
              className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary font-mono"
            />
          </div>

          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
              Instance ID <span className="normal-case">(optional, for multi-instance)</span>
            </label>
            <input
              type="text"
              value={instanceId}
              onChange={(e) => setInstanceId(e.target.value)}
              placeholder="auto-generated from module name"
              className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary font-mono"
            />
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleInstall}
              disabled={installing || !installUri.trim()}
              className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50"
            >
              {installing ? "Installing..." : "Install"}
            </button>
            {installError && (
              <span className="text-xs text-red-500">{installError}</span>
            )}
          </div>
        </div>
      )}

      {toggleError && (
        <div className="border border-red-500/30 bg-red-500/10 rounded-lg p-3 flex items-center justify-between">
          <span className="text-xs text-red-500">{toggleError}</span>
          <button
            onClick={() => setToggleError(null)}
            className="text-xs text-red-500 hover:text-red-400 ml-2"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Module list */}
      {loading ? (
        <div className="text-sm text-muted-foreground py-8 text-center">
          Loading modules...
        </div>
      ) : modules.length === 0 ? (
        <div className="border border-border rounded-lg p-6 text-center">
          <p className="text-sm text-muted-foreground">No modules installed</p>
          <p className="text-[10px] text-muted-foreground mt-1">
            Click "Install Module" to add a knowledge source.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {modules.map((mod) => (
            <div key={mod.id} className="border border-border rounded-lg p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <label className="flex items-center cursor-pointer">
                    <button
                      onClick={() => handleToggle(mod.id, !mod.enabled)}
                      disabled={togglingId === mod.id}
                      className={cn(
                        "relative w-9 h-5 rounded-full transition-colors",
                        mod.enabled ? "bg-primary" : "bg-secondary",
                      )}
                    >
                      <span
                        className={cn(
                          "absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform",
                          mod.enabled && "translate-x-4",
                        )}
                      />
                    </button>
                  </label>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{mod.name}</span>
                      <span className="text-[10px] text-muted-foreground font-mono">
                        v{mod.version}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground">{mod.id}</span>
                      {mod.moduleId && mod.moduleId !== mod.id && (
                        <span className="text-[10px] text-muted-foreground/60">
                          (type: {mod.moduleId})
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  {mod.loaded && (
                    <span className="text-[10px] text-green-500">Loaded</span>
                  )}
                  {!mod.loaded && mod.enabled && (
                    <span className="text-[10px] text-yellow-500">Not loaded</span>
                  )}
                </div>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
                <span>
                  Source: <span className="font-mono">{mod.source}</span>
                </span>
                <span>
                  Documents: <span className="font-mono">{mod.documents}</span>
                </span>
                {mod.hasQuery && (
                  <span className="text-primary">Queryable</span>
                )}
              </div>

              {mod.sourceUri && (
                <div className="text-[10px] text-muted-foreground font-mono truncate">
                  {mod.sourceUri}
                </div>
              )}

              {/* Duplicate inline form */}
              {duplicatingId === mod.id && (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={duplicateInstanceId}
                    onChange={(e) => setDuplicateInstanceId(e.target.value)}
                    placeholder="new-instance-id"
                    className="flex-1 bg-secondary rounded-md px-2 py-1 text-xs outline-none focus:ring-1 ring-primary font-mono"
                    onKeyDown={(e) => e.key === "Enter" && handleDuplicate(mod)}
                  />
                  <button
                    onClick={() => handleDuplicate(mod)}
                    disabled={!duplicateInstanceId.trim()}
                    className="text-xs bg-primary text-primary-foreground px-2 py-1 rounded-md hover:bg-primary/90 disabled:opacity-50"
                  >
                    Create
                  </button>
                  <button
                    onClick={() => { setDuplicatingId(null); setDuplicateError(null); }}
                    className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
                  >
                    Cancel
                  </button>
                  {duplicateError && (
                    <span className="text-xs text-red-500">{duplicateError}</span>
                  )}
                </div>
              )}

              {/* Actions */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleDuplicate(mod)}
                  disabled={duplicatingId === mod.id}
                  className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
                >
                  Duplicate
                </button>
                <button
                  onClick={() => handleDelete(mod.id)}
                  disabled={deletingId === mod.id}
                  className={cn(
                    "text-xs px-2 py-1",
                    confirmDeleteId === mod.id
                      ? "bg-red-500/10 text-red-500 rounded-md"
                      : "text-red-500 hover:text-red-400",
                  )}
                >
                  {deletingId === mod.id
                    ? "Removing..."
                    : confirmDeleteId === mod.id
                      ? "Confirm Remove"
                      : "Remove"}
                </button>
                {confirmDeleteId === mod.id && (
                  <button
                    onClick={() => setConfirmDeleteId(null)}
                    className="text-xs text-muted-foreground hover:text-foreground px-2 py-1"
                  >
                    Cancel
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
