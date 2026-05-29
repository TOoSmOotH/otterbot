import { useEffect, useState } from "react";
import { FolderGit2, Plus, Trash2, X, Play, GitPullRequest } from "lucide-react";
import { Icon } from "../ui/Icon";
import {
  useProjectsStore,
  type Project,
  type PipelineRun,
  type ForgeAccount as ForgeAccountT,
} from "../../stores/projects-store";
import { useAgentsStore } from "../../stores/agents-store";
import { AgentWizard } from "./AgentWizard";

/** Stable empty array so the runs selector never returns a fresh reference. */
const EMPTY_RUNS: PipelineRun[] = [];

/**
 * Manage collaborative projects: a shared git working tree with a dedicated
 * specialist team. Configure where the code lives (local / GitHub / Gitea) and
 * launch the build pipeline (coder → security → test-writer → tester).
 */
export function ProjectsView() {
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
        shares one code tree. Configure a forge to clone/PR, then launch the build pipeline.
      </p>

      <ForgeAccountsSection />

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

function ForgeAccountsSection() {
  const accounts = useProjectsStore((s) => s.forgeAccounts);
  const add = useProjectsStore((s) => s.addForgeAccount);
  const del = useProjectsStore((s) => s.deleteForgeAccount);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    provider: "github" as "github" | "gitea",
    label: "",
    baseUrl: "",
    token: "",
    username: "",
    gitTransport: "https" as "https" | "ssh",
    committerName: "",
    committerEmail: "",
    signCommits: false,
  });

  return (
    <div style={{ ...card, maxWidth: 680, marginTop: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontWeight: 600, fontSize: 13 }}>Forge accounts</span>
        <span style={{ flex: 1 }} />
        <button style={ghostBtn} onClick={() => setOpen((v) => !v)}>
          <Icon icon={Plus} size={14} /> Add
        </button>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
        {accounts.length === 0 && <span style={{ color: "rgb(var(--muted))", fontSize: 12 }}>None configured.</span>}
        {accounts.map((a) => (
          <ForgeAccountRow key={a.id} account={a} onDelete={() => void del(a.id)} />
        ))}
      </div>
      {open && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!form.token) return;
            void add(form);
            setForm({ provider: "github", label: "", baseUrl: "", token: "", username: "", gitTransport: "https", committerName: "", committerEmail: "", signCommits: false });
            setOpen(false);
          }}
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 10 }}
        >
          <select value={form.provider} onChange={(e) => setForm({ ...form, provider: e.target.value as "github" | "gitea" })} style={input}>
            <option value="github">GitHub</option>
            <option value="gitea">Gitea</option>
          </select>
          <input placeholder="Label" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} style={input} />
          {form.provider === "gitea" && (
            <input placeholder="Instance URL (https://gitea.lan)" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} style={input} />
          )}
          <input placeholder="Bot username" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} style={input} />
          <input placeholder="API token" type="password" value={form.token} onChange={(e) => setForm({ ...form, token: e.target.value })} style={input} />
          <select value={form.gitTransport} onChange={(e) => setForm({ ...form, gitTransport: e.target.value as "https" | "ssh", signCommits: e.target.value === "ssh" ? form.signCommits : false })} style={input}>
            <option value="https">git over HTTPS (token)</option>
            <option value="ssh">git over SSH (managed key)</option>
          </select>
          <input placeholder="Committer name" value={form.committerName} onChange={(e) => setForm({ ...form, committerName: e.target.value })} style={input} />
          <input placeholder="Committer email" value={form.committerEmail} onChange={(e) => setForm({ ...form, committerEmail: e.target.value })} style={input} />
          {form.gitTransport === "ssh" && (
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "rgb(var(--muted))" }}>
              <input type="checkbox" checked={form.signCommits} onChange={(e) => setForm({ ...form, signCommits: e.target.checked })} />
              SSH-sign commits with the managed key
            </label>
          )}
          <button type="submit" style={{ ...primaryBtn, gridColumn: "1 / -1" }}>Save account</button>
          {form.gitTransport === "ssh" && (
            <span style={{ fontSize: 11, color: "rgb(var(--muted))", gridColumn: "1 / -1" }}>
              On save, otterbot generates an SSH key and shows the public key below — add it to the
              forge as an authentication key (and a signing key, for Verified commits).
            </span>
          )}
        </form>
      )}
    </div>
  );
}

function ForgeAccountRow({ account, onDelete }: { account: ForgeAccountT; onDelete: () => void }) {
  const [showKey, setShowKey] = useState(false);
  return (
    <div style={{ border: "1px solid rgb(var(--border))", borderRadius: 6, padding: "6px 8px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{account.label}</span>
        <span style={badge}>{account.provider}</span>
        <span style={badge}>{account.gitTransport === "ssh" ? "ssh" : "https"}</span>
        {account.signCommits && <span style={badge}>signed</span>}
        {account.username && <span style={{ fontSize: 11, color: "rgb(var(--muted))" }}>· {account.username}</span>}
        <span style={{ flex: 1 }} />
        {account.publicKey && (
          <button style={chipX} title="Show public key" onClick={() => setShowKey((v) => !v)}>
            🔑
          </button>
        )}
        <button style={chipX} onClick={onDelete} title="Delete account">
          <Icon icon={X} size={14} />
        </button>
      </div>
      {showKey && account.publicKey && (
        <textarea
          readOnly
          value={account.publicKey}
          onFocus={(e) => e.currentTarget.select()}
          style={{ ...input, width: "100%", marginTop: 6, fontFamily: "monospace", fontSize: 11, height: 48 }}
        />
      )}
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
  const startPipeline = useProjectsStore((s) => s.startPipeline);

  const [forge, setForgeForm] = useState({
    mode: project.mode,
    accountId: project.forgeAccountId ?? "",
    repo: project.forgeRepo ?? "",
    baseBranch: project.baseBranch ?? "",
    monitorIssues: project.monitorIssues,
  });
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void loadRuns(project.id);
  }, [project.id, loadRuns]);

  const nameFor = (id: string) => agents.find((a) => a.id === id)?.displayName ?? id;

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

      {/* Forge config */}
      <div style={{ marginTop: 12, fontSize: 12, fontWeight: 600 }}>Code location</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 6 }}>
        <select value={forge.mode} onChange={(e) => setForgeForm({ ...forge, mode: e.target.value as Project["mode"] })} style={input}>
          <option value="local">Local repo</option>
          <option value="existing">Existing forge repo</option>
          <option value="new">New forge repo</option>
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
                No forge accounts yet — add one in the “Forge accounts” panel at the top of this tab.
              </span>
            )}
            <input placeholder="owner/name" value={forge.repo} onChange={(e) => setForgeForm({ ...forge, repo: e.target.value })} style={input} />
            <input placeholder="base branch (optional)" value={forge.baseBranch} onChange={(e) => setForgeForm({ ...forge, baseBranch: e.target.value })} style={input} />
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "rgb(var(--muted))" }}>
              <input type="checkbox" checked={forge.monitorIssues} onChange={(e) => setForgeForm({ ...forge, monitorIssues: e.target.checked })} />
              Monitor issues → pipeline
            </label>
          </>
        )}
      </div>
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
          });
          setBusy(false);
        }}
      >
        {busy ? "Saving…" : "Save code location"}
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
const chipX: React.CSSProperties = {
  display: "inline-flex",
  background: "transparent",
  border: "none",
  color: "rgb(var(--muted))",
  cursor: "pointer",
  padding: 0,
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
