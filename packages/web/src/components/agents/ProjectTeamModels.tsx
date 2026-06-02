import { useEffect, useState } from "react";
import type { AgentModelConfig, CodingToolId } from "@otterbot/shared";
import { apiFetch } from "../../lib/api";
import { useAgentsStore } from "../../stores/agents-store";
import { useGlobalSettingsStore } from "../../stores/global-settings-store";
import { ModelSelect } from "./ModelSelect";
import type { Project } from "../../stores/projects-store";

const CODING_TOOLS: CodingToolId[] = ["claude", "codex", "gemini", "opencode"];

/** The coding-cli capability config we expose here (a subset of its fields). */
interface CodingConfig {
  pinnedTool: string;
  pinnedPreset: string;
}

interface RoleState {
  loading: boolean;
  model: AgentModelConfig | null;
  /** null = not a coding role (the agent has no coding-cli capability). */
  coding: CodingConfig | null;
}

/**
 * Manage what models each of a project's team agents uses, in context. Every
 * role gets a chat-model picker; coding roles (those with the coding-cli
 * capability) also get a CLI tool + model-preset picker. Edits save on change:
 * the chat model via PATCH /api/agents/:id, the tool/preset via the coding-cli
 * capability config. The team agents already exist (deterministic ids in
 * `project.team`), so we edit them directly rather than re-provisioning.
 */
export function ProjectTeamModels({ project }: { project: Project }) {
  const agents = useAgentsStore((s) => s.agents);
  const updateAgent = useAgentsStore((s) => s.update);
  const settings = useGlobalSettingsStore((s) => s.settings);
  const settingsLoaded = useGlobalSettingsStore((s) => s.loaded);
  const loadSettings = useGlobalSettingsStore((s) => s.load);

  const [rows, setRows] = useState<Record<string, RoleState>>({});

  // Preset options are sourced from global settings; make sure they're loaded.
  useEffect(() => {
    if (!settingsLoaded) void loadSettings();
  }, [settingsLoaded, loadSettings]);

  // Re-fetch whenever the team membership changes (a stable signature string).
  const teamKey = project.team.map((t) => `${t.role}:${t.agentId}`).join(",");
  useEffect(() => {
    let cancelled = false;
    setRows(
      Object.fromEntries(
        project.team.map((t) => [t.role, { loading: true, model: null, coding: null } as RoleState])
      )
    );
    for (const { role, agentId } of project.team) {
      void Promise.all([
        apiFetch(`/api/agents/${agentId}`).then((r) => (r.ok ? r.json() : null)),
        // 404 here means the role has no coding CLI → chat model only.
        apiFetch(`/api/agents/${agentId}/skills/coding-cli/config`).then((r) => (r.ok ? r.json() : null)),
      ]).then(([profile, cfg]) => {
        if (cancelled) return;
        const model = (profile?.model ?? null) as AgentModelConfig | null;
        const coding: CodingConfig | null = cfg
          ? {
              pinnedTool: String(cfg.values?.pinnedTool ?? ""),
              pinnedPreset: String(cfg.values?.pinnedPreset ?? ""),
            }
          : null;
        setRows((s) => ({ ...s, [role]: { loading: false, model, coding } }));
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamKey]);

  const nameFor = (id: string) => agents.find((a) => a.id === id)?.displayName ?? id;

  const setChatModel = async (role: string, agentId: string, chat: string) => {
    const model = rows[role]?.model;
    if (!model) return;
    const next = { ...model, chat }; // spread preserves embedding (and any future fields)
    setRows((s) => ({ ...s, [role]: { ...s[role], model: next } }));
    await updateAgent(agentId, { model: next });
  };

  const saveCoding = async (role: string, agentId: string, coding: CodingConfig) => {
    setRows((s) => ({ ...s, [role]: { ...s[role], coding } }));
    await apiFetch(`/api/agents/${agentId}/skills/coding-cli/config`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(coding),
    });
  };

  if (project.team.length === 0) {
    return <span style={{ fontSize: 11, color: "rgb(var(--muted))" }}>No team yet.</span>;
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {project.team.map(({ role, agentId }) => {
        const row = rows[role];
        const coding = row?.coding;
        const presetsForTool = coding
          ? settings.codingModelPresets.filter((p) => !coding.pinnedTool || p.tool === coding.pinnedTool)
          : [];
        return (
          <div key={role} style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600 }}>{role}</span>
              <span
                style={{
                  flex: 1,
                  fontSize: 11,
                  color: "rgb(var(--muted))",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {nameFor(agentId)}
              </span>
            </div>
            {!row || row.loading ? (
              <span style={{ fontSize: 11, color: "rgb(var(--muted))" }}>Loading…</span>
            ) : (
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ flex: 1, minWidth: 180 }}>
                  <ModelSelect
                    models={settings.models}
                    kind="chat"
                    value={row.model?.chat ?? ""}
                    onChange={(v) => void setChatModel(role, agentId, v)}
                  />
                </div>
                {coding && (
                  <>
                    <select
                      data-testid={`team-tool-${agentId}`}
                      value={coding.pinnedTool}
                      onChange={(e) => {
                        const pinnedTool = e.target.value;
                        // Drop the preset if it doesn't belong to the new tool.
                        const presetValid =
                          !coding.pinnedPreset ||
                          settings.codingModelPresets.some(
                            (p) => p.id === coding.pinnedPreset && (!pinnedTool || p.tool === pinnedTool)
                          );
                        void saveCoding(role, agentId, {
                          pinnedTool,
                          pinnedPreset: presetValid ? coding.pinnedPreset : "",
                        });
                      }}
                      style={{ ...select, width: 130 }}
                    >
                      <option value="">tool default</option>
                      {CODING_TOOLS.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </select>
                    <select
                      data-testid={`team-preset-${agentId}`}
                      value={coding.pinnedPreset}
                      onChange={(e) => void saveCoding(role, agentId, { ...coding, pinnedPreset: e.target.value })}
                      style={{ ...select, width: 200 }}
                    >
                      <option value="">— no preset —</option>
                      {/* Keep the current preset selectable even if filtered out. */}
                      {coding.pinnedPreset && !presetsForTool.some((p) => p.id === coding.pinnedPreset) && (
                        <option value={coding.pinnedPreset}>{coding.pinnedPreset}</option>
                      )}
                      {presetsForTool.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.label} ({p.tool})
                        </option>
                      ))}
                    </select>
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const select: React.CSSProperties = {
  background: "rgb(var(--bg))",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: "6px 8px",
  fontSize: 13,
};
