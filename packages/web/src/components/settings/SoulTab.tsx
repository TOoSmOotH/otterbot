import { useState, useEffect, useCallback } from "react";
import { getSocket } from "../../lib/socket";
import type { SoulDocument, RegistryEntry } from "@otterbot/shared";

const ROLES = [
  { value: "global", label: "Global (all agents)" },
  { value: "coo", label: "COO" },
  { value: "team_lead", label: "Team Lead" },
  { value: "worker", label: "Worker" },
  { value: "admin_assistant", label: "Admin Assistant" },
];

export function SoulTab() {
  const [souls, setSouls] = useState<SoulDocument[]>([]);
  const [registryEntries, setRegistryEntries] = useState<RegistryEntry[]>([]);
  const [selectedRole, setSelectedRole] = useState("global");
  const [selectedRegistryId, setSelectedRegistryId] = useState<string | null>(null);
  const [content, setContent] = useState("");
  const [currentDoc, setCurrentDoc] = useState<SoulDocument | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const socket = getSocket();

  const loadSouls = useCallback(() => {
    socket.emit("soul:list", (docs) => {
      setSouls(docs);
    });
  }, [socket]);

  const loadRegistryEntries = useCallback(() => {
    socket.emit("registry:list", (entries) => {
      setRegistryEntries(entries);
    });
  }, [socket]);

  useEffect(() => {
    loadSouls();
    loadRegistryEntries();
  }, [loadSouls, loadRegistryEntries]);

  // When role or registry selection changes, find matching soul doc
  useEffect(() => {
    const match = souls.find(
      (s) =>
        s.agentRole === selectedRole &&
        (selectedRegistryId
          ? s.registryEntryId === selectedRegistryId
          : !s.registryEntryId),
    );
    setCurrentDoc(match ?? null);
    setContent(match?.content ?? "");
  }, [selectedRole, selectedRegistryId, souls]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    socket.emit(
      "soul:save",
      {
        agentRole: selectedRole,
        registryEntryId: selectedRegistryId,
        content,
      },
      (ack) => {
        setSaving(false);
        if (ack?.ok) {
          setSaved(true);
          setTimeout(() => setSaved(false), 2000);
          loadSouls();
        } else {
          setError(ack?.error ?? "Failed to save");
        }
      },
    );
  };

  const handleDelete = () => {
    if (!currentDoc) return;
    if (!confirm("Delete this soul document?")) return;
    socket.emit("soul:delete", { id: currentDoc.id }, (ack) => {
      if (ack?.ok) {
        setContent("");
        setCurrentDoc(null);
        loadSouls();
      }
    });
  };

  // Filter registry entries that match the selected role
  const roleEntries = registryEntries.filter(
    (e) => e.role === selectedRole || selectedRole === "global",
  );

  return (
    <div className="p-5 space-y-5">
      <div>
        <h3 className="text-xs font-semibold mb-1">Soul Documents</h3>
        <p className="text-xs text-muted-foreground">
          Define the personality, tone, and behavioral guidelines for each agent.
          Soul documents are injected into the system prompt as a [SOUL] block.
        </p>
      </div>

      {error && (
        <div className="text-xs text-red-400 bg-red-400/10 border border-red-400/20 rounded px-3 py-2">
          {error}
        </div>
      )}

      <div className="flex gap-3">
        <div className="flex-1">
          <label className="text-xs font-medium mb-1 block">Agent Role</label>
          <select
            value={selectedRole}
            onChange={(e) => {
              setSelectedRole(e.target.value);
              setSelectedRegistryId(null);
            }}
            className="w-full bg-secondary border border-border rounded px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
          >
            {ROLES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
                {souls.some(
                  (s) => s.agentRole === r.value && !s.registryEntryId,
                )
                  ? " *"
                  : ""}
              </option>
            ))}
          </select>
        </div>

        {roleEntries.length > 0 && selectedRole !== "global" && (
          <div className="flex-1">
            <label className="text-xs font-medium mb-1 block">
              Specific Agent (optional)
            </label>
            <select
              value={selectedRegistryId ?? ""}
              onChange={(e) =>
                setSelectedRegistryId(e.target.value || null)
              }
              className="w-full bg-secondary border border-border rounded px-3 py-1.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="">Role default</option>
              {roleEntries.map((e) => (
                <option key={e.id} value={e.id}>
                  {e.name}
                  {souls.some(
                    (s) =>
                      s.agentRole === selectedRole &&
                      s.registryEntryId === e.id,
                  )
                    ? " *"
                    : ""}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div>
        <label className="text-xs font-medium mb-1 block">
          Soul Content (Markdown)
        </label>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder={`# Personality\n\nDescribe how this agent should behave, its tone, personality traits, and any special instructions...\n\n# Preferences\n\n- Speak concisely\n- Be proactive\n- Use plain language`}
          rows={16}
          className="w-full bg-secondary border border-border rounded px-3 py-2 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-y font-mono"
        />
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || !content.trim()}
          className="px-4 py-1.5 text-xs font-medium bg-primary text-primary-foreground rounded hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {saving ? "Saving..." : currentDoc ? "Update" : "Save"}
        </button>
        {currentDoc && (
          <button
            onClick={handleDelete}
            className="px-4 py-1.5 text-xs font-medium text-red-400 hover:text-red-300 transition-colors"
          >
            Delete
          </button>
        )}
        {saved && (
          <span className="text-xs text-green-400">Saved successfully</span>
        )}
      </div>

      {/* Existing soul documents */}
      {souls.length > 0 && (
        <div>
          <h4 className="text-xs font-medium mb-2">
            Existing Soul Documents ({souls.length})
          </h4>
          <div className="space-y-1">
            {souls.map((s) => {
              const roleLabel =
                ROLES.find((r) => r.value === s.agentRole)?.label ??
                s.agentRole;
              const entryLabel = s.registryEntryId
                ? registryEntries.find((e) => e.id === s.registryEntryId)
                    ?.name ?? s.registryEntryId
                : null;
              const isSelected =
                s.agentRole === selectedRole &&
                (selectedRegistryId
                  ? s.registryEntryId === selectedRegistryId
                  : !s.registryEntryId);

              return (
                <button
                  key={s.id}
                  onClick={() => {
                    setSelectedRole(s.agentRole);
                    setSelectedRegistryId(s.registryEntryId);
                  }}
                  className={`w-full text-left px-3 py-2 rounded text-xs transition-colors ${
                    isSelected
                      ? "bg-primary/10 border border-primary/30"
                      : "bg-secondary/50 border border-border hover:bg-secondary"
                  }`}
                >
                  <span className="font-medium">{roleLabel}</span>
                  {entryLabel && (
                    <span className="text-muted-foreground">
                      {" "}
                      / {entryLabel}
                    </span>
                  )}
                  <span className="text-muted-foreground ml-2">
                    ({s.content.length} chars)
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
