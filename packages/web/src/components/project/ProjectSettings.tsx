import { useEffect, useState } from "react";
import { useSettingsStore } from "../../stores/settings-store";
import { getSocket } from "../../lib/socket";
import type { ProjectAgentAssignments } from "@otterbot/shared";

/** Roles that can be assigned a specific coding agent */
const ASSIGNABLE_ROLES = [
  { key: "coder", label: "Coder" },
  { key: "reviewer", label: "Reviewer" },
  { key: "security", label: "Security Reviewer" },
  { key: "tester", label: "Tester" },
] as const;

/** Available coding agents with their config keys */
const CODING_AGENTS = [
  { id: "builtin-opencode-coder", label: "OpenCode", enabledKey: "openCodeEnabled" as const },
  { id: "builtin-claude-code-coder", label: "Claude Code", enabledKey: "claudeCodeEnabled" as const },
  { id: "builtin-codex-coder", label: "Codex", enabledKey: "codexEnabled" as const },
  { id: "builtin-coder", label: "Standard Coder", enabledKey: null },
] as const;

export function ProjectSettings({ projectId }: { projectId: string }) {
  const [assignments, setAssignments] = useState<ProjectAgentAssignments>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openCodeEnabled = useSettingsStore((s) => s.openCodeEnabled);
  const claudeCodeEnabled = useSettingsStore((s) => s.claudeCodeEnabled);
  const codexEnabled = useSettingsStore((s) => s.codexEnabled);

  // Load current assignments on mount / project change
  useEffect(() => {
    const socket = getSocket();
    socket.emit("project:get-agent-assignments", { projectId }, (result) => {
      setAssignments(result ?? {});
    });
    setSaved(false);
    setError(null);
  }, [projectId]);

  const isAgentEnabled = (agent: typeof CODING_AGENTS[number]): boolean => {
    if (agent.enabledKey === null) return true; // builtin-coder is always available
    const map: Record<string, boolean> = {
      openCodeEnabled,
      claudeCodeEnabled,
      codexEnabled,
    };
    return !!map[agent.enabledKey];
  };

  const enabledAgents = CODING_AGENTS.filter(isAgentEnabled);

  const handleChange = (role: string, agentId: string) => {
    setAssignments((prev) => {
      const next = { ...prev };
      if (agentId === "") {
        delete next[role];
      } else {
        next[role] = agentId;
      }
      return next;
    });
    setSaved(false);
  };

  const handleSave = () => {
    setSaving(true);
    setError(null);
    const socket = getSocket();
    socket.emit("project:set-agent-assignments", { projectId, assignments }, (ack) => {
      setSaving(false);
      if (ack?.ok) {
        setSaved(true);
      } else {
        setError(ack?.error ?? "Failed to save assignments");
      }
    });
  };

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <div>
          <h2 className="text-sm font-semibold">Agent Assignments</h2>
          <p className="text-xs text-muted-foreground mt-1">
            Configure which coding agent handles each type of task for this project.
            Leave as "System Default" to use the global fallback.
          </p>
        </div>

        <div className="space-y-3">
          {ASSIGNABLE_ROLES.map(({ key, label }) => {
            const selectedId = assignments[key] ?? "";
            const selectedAgent = CODING_AGENTS.find((a) => a.id === selectedId);
            const isDisabled = selectedAgent && !isAgentEnabled(selectedAgent);

            return (
              <div key={key} className="flex items-center justify-between gap-4 py-2 border-b border-border last:border-0">
                <label className="text-sm font-medium min-w-[140px]">{label}</label>
                <div className="flex items-center gap-2">
                  <select
                    value={selectedId}
                    onChange={(e) => handleChange(key, e.target.value)}
                    className="text-sm bg-secondary border border-border rounded px-2 py-1.5 min-w-[180px] focus:outline-none focus:ring-1 focus:ring-primary"
                  >
                    <option value="">System Default</option>
                    {enabledAgents.map((agent) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.label}
                      </option>
                    ))}
                  </select>
                  {isDisabled && (
                    <span className="text-xs text-yellow-500" title="This agent is currently disabled globally">
                      (disabled)
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-sm px-4 py-1.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50 transition-colors"
          >
            {saving ? "Saving..." : "Save"}
          </button>
          {saved && (
            <span className="text-xs text-green-500">Saved</span>
          )}
          {error && (
            <span className="text-xs text-red-500">{error}</span>
          )}
        </div>
      </div>
    </div>
  );
}
