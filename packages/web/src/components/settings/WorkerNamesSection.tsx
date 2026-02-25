import { useState, useEffect } from "react";

export function WorkerNamesSection() {
  const [names, setNames] = useState("");
  const [defaults, setDefaults] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/settings/worker-names")
      .then((r) => r.json())
      .then((data: { names: string[]; defaults: string[] }) => {
        setNames(data.names.join("\n"));
        setDefaults(data.defaults);
      })
      .catch(() => setError("Failed to load worker names"))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const parsed = names
        .split("\n")
        .map((n) => n.trim())
        .filter(Boolean);
      if (parsed.length === 0) {
        setError("Please enter at least one name");
        return;
      }
      const res = await fetch("/api/settings/worker-names", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ names: parsed }),
      });
      if (!res.ok) throw new Error("Failed to save");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch {
      setError("Failed to save worker names");
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setNames(defaults.join("\n"));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        Loading worker names...
      </div>
    );
  }

  return (
    <div className="p-5 space-y-5">
      <div>
        <h3 className="text-xs font-semibold mb-1">Worker Names</h3>
        <p className="text-xs text-muted-foreground">
          Random human names assigned to workers. One name per line.
        </p>
      </div>

      <textarea
        className="w-full h-64 rounded-md border border-border bg-input px-3 py-2 text-sm font-mono resize-y focus:outline-none focus:ring-1 focus:ring-ring"
        value={names}
        onChange={(e) => setNames(e.target.value)}
        placeholder="One name per line..."
      />

      {error && <p className="text-xs text-destructive">{error}</p>}
      {saved && <p className="text-xs text-green-500">Saved!</p>}

      <div className="flex gap-2">
        <button
          className="px-3 py-1.5 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          onClick={handleSave}
          disabled={saving}
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          className="px-3 py-1.5 text-xs font-medium rounded-md border border-border hover:bg-accent"
          onClick={handleReset}
        >
          Reset to Defaults
        </button>
      </div>
    </div>
  );
}
