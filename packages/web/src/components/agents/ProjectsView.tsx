import { useEffect, useState } from "react";
import { FolderGit2, Plus, Trash2, Play, GitPullRequest } from "lucide-react";
import { Icon } from "../ui/Icon";
import { useProjectsStore, type Project, type PipelineRun } from "../../stores/projects-store";
import { useAgentsStore } from "../../stores/agents-store";
import { AgentWizard } from "./AgentWizard";
import { ProjectTeamModels } from "./ProjectTeamModels";

/** Stable empty array so the runs selector never returns a fresh reference. */
const EMPTY_RUNS: PipelineRun[] = [];

/**
 * Manage collaborative projects: a shared git working tree with a dedicated
 * specialist team. Configure where the code lives (local / GitHub / Gitea) and
 * launch the build pipeline (coder → security → test-writer → tester).
 */
export function ProjectsView({ onOpenSettings }: { onOpenSettings?: (tab?: string) => void }) {
  const projects = useProjectsStore((s) => s.projects);
  const error = useProjectsStore((s) => s.error);
  const load = useProjectsStore((s) => s.load);
  const loadForgeAccounts = useProjectsStore((s) => s.loadForgeAccounts);
  const bindSocket = useProjectsStore((s) => s.bindSocket);
  const remove = useProjectsStore((s) => s.remove);

  const [wizardOpen, setWizardOpen] = useState(false);

  useEffect(() => {
    void load();
    void loadForgeAccounts();
    bindSocket();
  }, [load, loadForgeAccounts, bindSocket]);

  return (
    <div style={{ padding: 20, overflowY: "auto", height: "100%" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <Icon icon={FolderGit2} size={18} />
        <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>Projects</h2>
      </div>
      <p style={{ color: "rgb(var(--muted))", fontSize: 12, maxWidth: 680, marginTop: 0 }}>
        Each project gets a dedicated team (PM, coder, security reviewer, test writer, tester) that
        shares one code tree. Add a git host in Settings → Git Creds, then point a project at a
        repo and launch the build pipeline.
      </p>

      <div style={{ margin: "16px 0" }}>
        <button style={primaryBtn} onClick={() => setWizardOpen(true)}>
          <Icon icon={Plus} size={14} /> New coding team
        </button>
      </div>
      {error && <div style={{ color: "rgb(220 90 90)", fontSize: 12, marginBottom: 8 }}>{error}</div>}
      {wizardOpen && <AgentWizard initialChoice="team" onClose={() => setWizardOpen(false)} />}

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {projects.length === 0 && <div style={{ color: "rgb(var(--muted))", fontSize: 13 }}>No projects yet.</div>}
        {projects.map((p) => (
          <ProjectCard key={p.id} project={p} onDelete={() => remove(p.id)} />
        ))}
      </div>
    </div>
  );
}

function ProjectCard({ project, onDelete }: { project: Project; onDelete: () => void }) {
  const agents = useAgentsStore((s) => s.agents);
  const accounts = useProjectsStore((s) => s.forgeAccounts);
  // Select the stored array (stable ref); default outside the selector so we
  // don't return a fresh [] every render (which crashes useSyncExternalStore).
  const runs = useProjectsStore((s) => s.runs[project.id]) ?? EMPTY_RUNS;
  const loadRuns = useProjectsStore((s) => s.loadRuns);
  const setForge = useProjectsStore((s) => s.setForge);
  const setRules = useProjectsStore((s) => s.setRules);
  const addMember = useProjectsStore((s) => s.addMember);
  const removeMember = useProjectsStore((s) => s.removeMember);
  const setMemberAccess = useProjectsStore((s) => s.setMemberAccess);
  const startPipeline = useProjectsStore((s) => s.startPipeline);

  const [forge, setForgeForm] = useState({
    mode: project.mode,
    accountId: project.forgeAccountId ?? "",
    repo: project.forgeRepo ?? "",
    baseBranch: project.baseBranch ?? "",
    monitorIssues: project.monitorIssues,
    triageIssues: project.triageIssues,
    remoteE2e: project.remoteE2e,
  });
  const [pickAgent, setPickAgent] = useState("");
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [rulesText, setRulesText] = useState(project.rules ?? "");
  const [rulesBusy, setRulesBusy] = useState(false);

  useEffect(() => {
    void loadRuns(project.id);
  }, [project.id, loadRuns]);

  const nameFor = (id: string) => agents.find((a) => a.id === id)?.displayName ?? id;

  const teamIds = new Set(project.team.map((t) => t.agentId));
  const extraMembers = project.members.filter((m) => !teamIds.has(m.agentId));
  const candidateAgents = agents.filter(
    (a) => a.role !== "subagent" && !project.members.some((m) => m.agentId === a.id)
  );

  return (
    <div style={{ ...card, maxWidth: 680 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{project.name}</span>
        <span style={badge}>{project.mode}</span>
        <span style={{ flex: 1 }} />
        <button style={iconBtn} title="Delete project + team" onClick={() => confirm(`Delete "${project.name}" and its team?`) && onDelete()}>
          <Icon icon={Trash2} size={14} />
        </button>
      </div>

      {/* Team roles */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
        {project.team.map((t) => (
          <span key={t.role} style={chip}>
            {t.role}: {nameFor(t.agentId)}
          </span>
        ))}
      </div>

      {/* Team models */}
      <div style={{ marginTop: 12, fontSize: 12, fontWeight: 600 }}>Team models</div>
      <p style={{ fontSize: 11, color: "rgb(var(--muted))", margin: "2px 0 6px" }}>
        Set the chat model each role runs, plus the coding CLI tool + model preset for the coding
        roles. Manage presets in Settings → Coding Models. Changes save immediately.
      </p>
      <ProjectTeamModels project={project} onOpenSettings={onOpenSettings} />

      {/* Additional agents */}
      <div style={{ marginTop: 12, fontSize: 12, fontWeight: 600 }}>Additional agents</div>
      <p style={{ fontSize: 11, color: "rgb(var(--muted))", margin: "2px 0 6px" }}>
        Give another agent access to this project's source (e.g. a Discord support bot). Read-only by
        default; the agent still needs shell or code-search tools to use it.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {extraMembers.length === 0 && (
          <span style={{ fontSize: 11, color: "rgb(var(--muted))" }}>None yet.</span>
        )}
        {extraMembers.map((m) => (
          <div key={m.agentId} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={{ flex: 1, fontSize: 12, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {nameFor(m.agentId)}
            </span>
            <select
              data-testid={`member-access-${m.agentId}`}
              value={m.access}
              onChange={(e) => void setMemberAccess(project.id, m.agentId, e.target.value as "read" | "write")}
              style={{ ...input, flex: "none", width: 130 }}
            >
              <option value="read">read-only</option>
              <option value="write">read-write</option>
            </select>
            <button style={iconBtn} title="Remove from project" onClick={() => void removeMember(project.id, m.agentId)}>
              <Icon icon={Trash2} size={14} />
            </button>
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
        <select value={pickAgent} onChange={(e) => setPickAgent(e.target.value)} style={input}>
          <option value="">Add an agent…</option>
          {candidateAgents.map((a) => (
            <option key={a.id} value={a.id}>{a.displayName}</option>
          ))}
        </select>
        <button
          style={primaryBtn}
          disabled={!pickAgent}
          onClick={async () => {
            await addMember(project.id, pickAgent);
            setPickAgent("");
          }}
        >
          <Icon icon={Plus} size={14} /> Add
        </button>
      </div>

      {/* Forge config */}
      <div style={{ marginTop: 12, fontSize: 12, fontWeight: 600 }}>Code location</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6 }}>
        <select value={forge.mode} onChange={(e) => setForgeForm({ ...forge, mode: e.target.value as Project["mode"] })} style={input}>
          <option value="local">Local repo</option>
          <option value="existing">Existing forge repo</option>
          <option value="new">New forge repo</option>
          <option value="fork">Fork existing repo</option>
        </select>
        {forge.mode !== "local" && (
          <>
            <select value={forge.accountId} onChange={(e) => setForgeForm({ ...forge, accountId: e.target.value })} style={input}>
              <option value="">Select account…</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.label} ({a.provider})</option>
              ))}
            </select>
            {accounts.length === 0 && (
              <span style={{ fontSize: 11, color: "rgb(var(--muted))", gridColumn: "1 / -1" }}>
                No git hosting accounts yet — add one in Settings → Git Creds.
              </span>
            )}
            <input placeholder={forge.mode === "fork" ? "upstream owner/name or repo URL" : "owner/name or repo URL"} value={forge.repo} onChange={(e) => setForgeForm({ ...forge, repo: e.target.value })} style={input} />
            <input placeholder="base branch (optional)" value={forge.baseBranch} onChange={(e) => setForgeForm({ ...forge, baseBranch: e.target.value })} style={input} />
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "rgb(var(--muted))" }}>
              <input type="checkbox" checked={forge.monitorIssues} onChange={(e) => setForgeForm({ ...forge, monitorIssues: e.target.checked })} />
              Monitor issues → pipeline
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "rgb(var(--muted))" }}>
              <input type="checkbox" checked={forge.triageIssues} onChange={(e) => setForgeForm({ ...forge, triageIssues: e.target.checked })} />
              Triage issues → PM posts/refines a plan
            </label>
            {forge.mode === "fork" && (
              <span style={{ fontSize: 11, color: "rgb(var(--muted))", gridColumn: "1 / -1" }}>
                {project.forkRepo
                  ? `Forked to ${project.forkRepo} — branches push there; PRs open against ${project.forgeRepo}.`
                  : "Forks the upstream under the selected account, then contributes back via PRs."}
              </span>
            )}
          </>
        )}
      </div>
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "rgb(var(--muted))", marginTop: 6 }}>
        <input
          type="checkbox"
          checked={forge.remoteE2e}
          onChange={(e) => setForgeForm({ ...forge, remoteE2e: e.target.checked })}
        />
        Remote end-to-end testing (needs the Proxmox + SSH service agents)
      </label>
      <button
        style={{ ...ghostBtn, marginTop: 6 }}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await setForge(project.id, {
            mode: forge.mode,
            accountId: forge.accountId || null,
            repo: forge.repo || null,
            baseBranch: forge.baseBranch || null,
            monitorIssues: forge.monitorIssues,
            triageIssues: forge.triageIssues,
            remoteE2e: forge.remoteE2e,
          });
          setBusy(false);
        }}
      >
        {busy ? "Saving…" : "Save code location"}
      </button>

      {/* Project rules */}
      <div style={{ marginTop: 12, fontSize: 12, fontWeight: 600 }}>Project rules</div>
      <p style={{ fontSize: 11, color: "rgb(var(--muted))", margin: "2px 0 6px" }}>
        Standing instructions for every team member — e.g. "always commit to dev", coding standards.
      </p>
      <textarea
        data-testid={`project-rules-${project.id}`}
        value={rulesText}
        onChange={(e) => setRulesText(e.target.value)}
        placeholder="One rule per line…"
        rows={5}
        style={{ ...input, width: "100%", resize: "vertical", fontFamily: "inherit" }}
      />
      <button
        style={{ ...ghostBtn, marginTop: 6 }}
        disabled={rulesBusy}
        onClick={async () => {
          setRulesBusy(true);
          await setRules(project.id, rulesText);
          setRulesBusy(false);
        }}
      >
        {rulesBusy ? "Saving…" : "Save rules"}
      </button>

      {/* Pipeline */}
      <div style={{ marginTop: 12, fontSize: 12, fontWeight: 600 }}>Build pipeline</div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!goal.trim()) return;
          void startPipeline(project.id, goal.trim());
          setGoal("");
        }}
        style={{ display: "flex", gap: 6, marginTop: 6 }}
      >
        <input placeholder="Goal for the team to build…" value={goal} onChange={(e) => setGoal(e.target.value)} style={input} />
        <button type="submit" style={primaryBtn}>
          <Icon icon={Play} size={14} /> Run
        </button>
      </form>

      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
        {runs.map((r) => (
          <RunRow key={r.id} run={r} />
        ))}
      </div>
    </div>
  );
}

function RunRow({ run }: { run: PipelineRun }) {
  const statusColor: Record<string, string> = {
    running: "rgb(90 150 220)",
    done: "rgb(90 190 120)",
    failed: "rgb(220 90 90)",
    cancelled: "rgb(150 150 150)",
  };
  return (
    <div style={{ border: "1px solid rgb(var(--border))", borderRadius: 6, padding: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12 }}>
        <span style={{ color: statusColor[run.status] ?? "rgb(var(--fg))", fontWeight: 600 }}>{run.status}</span>
        {run.currentStage && run.status === "running" && (
          <span style={{ color: "rgb(var(--muted))" }}>@ {run.currentStage}</span>
        )}
        <span style={{ flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{run.goal}</span>
        {run.prUrl && (
          <a href={run.prUrl} target="_blank" rel="noreferrer" style={{ color: "rgb(var(--accent))", display: "inline-flex", alignItems: "center", gap: 3 }}>
            <Icon icon={GitPullRequest} size={14} /> {run.prNumber ? `#${run.prNumber}` : "PR"}
          </a>
        )}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}>
        {run.stages.map((s, i) => (
          <span
            key={i}
            title={s.report}
            style={{
              fontSize: 10,
              padding: "1px 6px",
              borderRadius: 10,
              border: "1px solid rgb(var(--border))",
              color: s.status === "pass" ? "rgb(90 190 120)" : s.status === "fail" ? "rgb(220 150 90)" : "rgb(220 90 90)",
            }}
          >
            {s.stage}: {s.status}
          </span>
        ))}
      </div>
    </div>
  );
}

const input: React.CSSProperties = {
  flex: 1,
  background: "rgb(var(--bg))",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 13,
};
const primaryBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: "rgb(var(--accent))",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "6px 12px",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};
const ghostBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 6,
  background: "transparent",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: "5px 10px",
  cursor: "pointer",
  fontSize: 12,
};
const card: React.CSSProperties = {
  border: "1px solid rgb(var(--border))",
  borderRadius: 8,
  padding: 12,
  background: "rgb(var(--bg))",
};
const chip: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  background: "rgb(var(--surface, 30 30 36))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 12,
  padding: "2px 8px",
  fontSize: 11,
};
const badge: React.CSSProperties = {
  fontSize: 10,
  color: "rgb(var(--muted))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 4,
  padding: "1px 6px",
};
const iconBtn: React.CSSProperties = {
  display: "inline-flex",
  background: "transparent",
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  color: "rgb(var(--muted))",
  cursor: "pointer",
  padding: "3px 6px",
};
