import { useEffect, useState, useCallback } from "react";
import { useSettingsStore } from "../../stores/settings-store";
import { getSocket } from "../../lib/socket";
import type { ProjectAgentAssignments, ProjectPipelineConfig, PipelineStageConfig } from "@otterbot/shared";
import { PIPELINE_STAGES } from "@otterbot/shared";

/** Roles that can be assigned a specific coding agent (non-pipeline mode) */
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
  { id: "builtin-gemini-cli-coder", label: "Gemini CLI", enabledKey: "geminiCliEnabled" as const },
  { id: "builtin-coder", label: "Standard Coder", enabledKey: null },
] as const;

/** Stage-specific agents that can be selected (beyond generic coding agents) */
const STAGE_SPECIFIC_AGENTS: Record<string, { id: string; label: string }[]> = {
  triage: [{ id: "builtin-triage", label: "Triage Agent" }],
  coder: [],
  security: [{ id: "builtin-security-reviewer", label: "Security Reviewer" }],
  tester: [{ id: "builtin-tester", label: "Tester" }],
  reviewer: [{ id: "builtin-reviewer", label: "Reviewer" }],
};

export function ProjectSettings({ projectId }: { projectId: string }) {
  const [assignments, setAssignments] = useState<ProjectAgentAssignments>({});
  const [pipelineConfig, setPipelineConfig] = useState<ProjectPipelineConfig | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isGitHubProject, setIsGitHubProject] = useState(false);

  const openCodeEnabled = useSettingsStore((s) => s.openCodeEnabled);
  const claudeCodeEnabled = useSettingsStore((s) => s.claudeCodeEnabled);
  const codexEnabled = useSettingsStore((s) => s.codexEnabled);
  const geminiCliEnabled = useSettingsStore((s) => s.geminiCliEnabled);

  // Load pipeline config, agent assignments, and project info
  useEffect(() => {
    const socket = getSocket();

    // Check if project has GitHub integration
    socket.emit("project:get", { projectId }, (project) => {
      setIsGitHubProject(!!project?.githubRepo);
    });

    // Load agent assignments (for non-pipeline mode)
    socket.emit("project:get-agent-assignments", { projectId }, (result) => {
      setAssignments(result ?? {});
    });

    // Load pipeline config
    socket.emit("project:get-pipeline-config", { projectId }, (config) => {
      if (config) {
        setPipelineConfig(config);
      } else {
        // Initialize default config
        const defaultStages: Record<string, PipelineStageConfig> = {};
        for (const stage of PIPELINE_STAGES) {
          defaultStages[stage.key] = {
            agentId: stage.defaultAgentId,
            enabled: true,
          };
        }
        setPipelineConfig({
          enabled: false,
          stages: defaultStages,
        });
      }
    });

    setSaved(false);
    setError(null);
  }, [projectId]);

  const isAgentEnabled = useCallback((agent: typeof CODING_AGENTS[number]): boolean => {
    if (agent.enabledKey === null) return true;
    const map: Record<string, boolean> = { openCodeEnabled, claudeCodeEnabled, codexEnabled, geminiCliEnabled };
    return !!map[agent.enabledKey];
  }, [openCodeEnabled, claudeCodeEnabled, codexEnabled, geminiCliEnabled]);

  const enabledCodingAgents = CODING_AGENTS.filter(isAgentEnabled);

  // --- Agent assignment handlers (non-pipeline mode) ---
  const handleAssignmentChange = (role: string, agentId: string) => {
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

  // --- Pipeline handlers ---
  const handleTogglePipeline = (enabled: boolean) => {
    setPipelineConfig((prev) => prev ? { ...prev, enabled } : null);
    setSaved(false);
  };

  const handleToggleStage = (stageKey: string, enabled: boolean) => {
    setPipelineConfig((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        stages: {
          ...prev.stages,
          [stageKey]: { ...prev.stages[stageKey], enabled },
        },
      };
    });
    setSaved(false);
  };

  const handleStageAgent = (stageKey: string, agentId: string) => {
    setPipelineConfig((prev) => {
      if (!prev) return null;
      return {
        ...prev,
        stages: {
          ...prev.stages,
          [stageKey]: { ...prev.stages[stageKey], agentId },
        },
      };
    });
    setSaved(false);
  };

  const handleSave = () => {
    if (!pipelineConfig) return;
    setSaving(true);
    setError(null);
    const socket = getSocket();

    // Save pipeline config
    socket.emit("project:set-pipeline-config", { projectId, config: pipelineConfig }, (ack) => {
      if (!ack?.ok) {
        setSaving(false);
        setError(ack?.error ?? "Failed to save pipeline configuration");
        return;
      }

      // Also save agent assignments (for non-pipeline mode)
      socket.emit("project:set-agent-assignments", { projectId, assignments }, (ack2) => {
        setSaving(false);
        if (ack2?.ok) {
          setSaved(true);
        } else {
          setError(ack2?.error ?? "Failed to save agent assignments");
        }
      });
    });
  };

  if (!pipelineConfig) return null;

  // Filter stages: only show triage for GitHub projects
  const visibleStages = PIPELINE_STAGES.filter(
    (stage) => stage.key !== "triage" || isGitHubProject,
  );

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Pipeline master toggle */}
        <div>
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold">Agent Pipeline</h2>
              <p className="text-xs text-muted-foreground mt-1">
                When enabled, tasks are processed through a configurable sequence of agent stages
                instead of sending a single worker. Each stage can be toggled and assigned a specific agent.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer">
              <input
                type="checkbox"
                checked={pipelineConfig.enabled}
                onChange={(e) => handleTogglePipeline(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-9 h-5 bg-muted rounded-full peer peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full" />
            </label>
          </div>
        </div>

        {/* Agent Assignments (shown when pipeline is OFF) */}
        {!pipelineConfig.enabled && (
          <div className="space-y-3">
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Agent Assignments
              </h3>
              <p className="text-xs text-muted-foreground mt-1">
                Configure which coding agent handles each type of task for this project.
                Leave as "System Default" to use the global fallback.
              </p>
            </div>
            <div className="space-y-1">
              {ASSIGNABLE_ROLES.map(({ key, label }) => {
                const selectedId = assignments[key] ?? "";
                const selectedAgent = CODING_AGENTS.find((a) => a.id === selectedId);
                const isDisabled = selectedAgent && !isAgentEnabled(selectedAgent);

                return (
                  <div
                    key={key}
                    className="flex items-center justify-between gap-4 py-2.5 px-3 rounded border border-border bg-secondary/30"
                  >
                    <label className="text-sm font-medium min-w-[140px]">{label}</label>
                    <div className="flex items-center gap-2">
                      <select
                        value={selectedId}
                        onChange={(e) => handleAssignmentChange(key, e.target.value)}
                        className="text-xs bg-secondary border border-border rounded px-2 py-1 min-w-[180px] focus:outline-none focus:ring-1 focus:ring-primary"
                      >
                        <option value="">System Default</option>
                        {enabledCodingAgents.map((agent) => (
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
          </div>
        )}

        {/* Pipeline stages (shown when pipeline is ON) */}
        {pipelineConfig.enabled && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Pipeline Stages
            </h3>
            <div className="space-y-1">
              {visibleStages.map((stage, index) => {
                const stageConfig = pipelineConfig.stages[stage.key] ?? {
                  agentId: stage.defaultAgentId,
                  enabled: true,
                };
                const isEnabled = stageConfig.enabled;

                // Build agent options for this stage
                const stageAgents = STAGE_SPECIFIC_AGENTS[stage.key] ?? [];
                const allAgents = [
                  ...stageAgents,
                  ...enabledCodingAgents.map((a) => ({ id: a.id, label: a.label })),
                ];

                return (
                  <div
                    key={stage.key}
                    className={`flex items-center gap-3 py-2.5 px-3 rounded border transition-colors ${
                      isEnabled
                        ? "border-border bg-secondary/30"
                        : "border-border/50 bg-secondary/10 opacity-50"
                    }`}
                  >
                    {/* Stage number */}
                    <span className="text-xs text-muted-foreground font-mono w-5 text-center shrink-0">
                      {index + 1}
                    </span>

                    {/* Toggle */}
                    <label className="relative inline-flex items-center cursor-pointer shrink-0">
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={(e) => handleToggleStage(stage.key, e.target.checked)}
                        className="sr-only peer"
                      />
                      <div className="w-7 h-4 bg-muted rounded-full peer peer-checked:bg-primary transition-colors after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:after:translate-x-3" />
                    </label>

                    {/* Stage info */}
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium">{stage.label}</div>
                      <div className="text-xs text-muted-foreground truncate">
                        {stage.description}
                      </div>
                    </div>

                    {/* Agent selector */}
                    {isEnabled && (
                      <select
                        value={stageConfig.agentId}
                        onChange={(e) => handleStageAgent(stage.key, e.target.value)}
                        className="text-xs bg-secondary border border-border rounded px-2 py-1 min-w-[140px] focus:outline-none focus:ring-1 focus:ring-primary shrink-0"
                      >
                        {allAgents.map((agent) => (
                          <option key={agent.id} value={agent.id}>
                            {agent.label}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>

            {/* Execution flow visualization */}
            <div className="mt-3 pt-3 border-t border-border">
              <div className="text-xs text-muted-foreground">
                <span className="font-medium">Execution order: </span>
                {visibleStages
                  .filter((s) => pipelineConfig.stages[s.key]?.enabled)
                  .map((s) => s.label)
                  .join(" → ") || "No stages enabled"}
              </div>
            </div>
          </div>
        )}

        {/* Save button */}
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
