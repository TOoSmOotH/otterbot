import { useEffect, useState } from "react";
import type { CodeReferenceRepo, RepoSyncState } from "@otterbot/shared";
import { useCodeReferenceStore } from "../../stores/code-reference-store";
import { BuiltinEmbedderControls } from "../BuiltinEmbedderControls";

/**
 * Instance-wide Code Reference settings: register GitHub repos that get cloned
 * and indexed for agent search. Saves immediately (no global Save bar). The
 * per-agent ON/OFF toggle lives in Agent Studio's Capabilities tab.
 */
export function CodeReferenceTab() {
  const status = useCodeReferenceStore((s) => s.status);
  const error = useCodeReferenceStore((s) => s.error);
  const busy = useCodeReferenceStore((s) => s.busy);
  const load = useCodeReferenceStore((s) => s.load);
  const addRepo = useCodeReferenceStore((s) => s.addRepo);
  const removeRepo = useCodeReferenceStore((s) => s.removeRepo);
  const refresh = useCodeReferenceStore((s) => s.refresh);
  const setPullCron = useCodeReferenceStore((s) => s.setPullCron);
  const stopPolling = useCodeReferenceStore((s) => s.stopPolling);

  const [url, setUrl] = useState("");
  const [branch, setBranch] = useState("");
  const [cron, setCron] = useState("");

  useEffect(() => {
    void load();
    return () => stopPolling();
  }, [load, stopPolling]);

  useEffect(() => {
    if (status?.pullCron) setCron(status.pullCron);
  }, [status?.pullCron]);

  const add = async () => {
    if (!url.trim()) return;
    const ok = await addRepo(url.trim(), branch.trim());
    if (ok) {
      setUrl("");
      setBranch("");
    }
  };

  const repos = status?.repos ?? [];

  return (
    <div style={section}>
      <div>
        <h2 style={h2}>Reference repositories</h2>
        <p style={hint}>
          Public GitHub repos cloned once and indexed for the whole instance. Any
          agent with the <strong>Code reference</strong> capability enabled can
          search and read them. Configure that toggle per agent in Agent Studio →
          Capabilities.
        </p>
      </div>

      {status && !status.gitAvailable && (
        <div style={warnBox}>
          <code>git</code> was not found on the server. Install git to clone
          reference repositories.
        </div>
      )}

      {status && !status.embeddingAvailable && (
        <div style={infoBox}>
          No embedding model is ready, so search uses keyword matching only.
          Semantic search turns on once an embedding model is configured (Models
          tab) or the built-in model is downloaded.
          <div style={{ marginTop: 8 }}>
            <BuiltinEmbedderControls />
          </div>
        </div>
      )}

      {/* Add repo */}
      <div style={panel}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            data-testid="coderef-url"
            style={{ ...input, flex: 2, minWidth: 220 }}
            placeholder="github.com/owner/repo  or  owner/repo"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
          />
          <input
            data-testid="coderef-branch"
            style={{ ...input, flex: 1, minWidth: 120 }}
            placeholder="branch (optional)"
            value={branch}
            onChange={(e) => setBranch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void add()}
          />
          <button data-testid="coderef-add" style={primary} disabled={busy || !url.trim()} onClick={() => void add()}>
            Add repository
          </button>
        </div>
        {error && <span style={{ fontSize: 12, color: "rgb(var(--danger))" }}>{error}</span>}
      </div>

      {/* Repo list */}
      {repos.length === 0 ? (
        <p style={hint}>No repositories configured yet.</p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {repos.map((repo) => (
            <RepoCard
              key={repo.id}
              repo={repo}
              busy={busy}
              onRefresh={() => void refresh(repo.id)}
              onRemove={() => void removeRepo(repo.id)}
            />
          ))}
        </div>
      )}

      {/* Schedule */}
      <div style={panel}>
        <h2 style={h2}>Auto-update schedule</h2>
        <p style={hint}>Cron expression for pulling + re-indexing all repos.</p>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            style={{ ...input, maxWidth: 200 }}
            placeholder="0 */6 * * *"
            value={cron}
            onChange={(e) => setCron(e.target.value)}
          />
          <button
            style={ghostButton}
            disabled={busy || !cron.trim() || cron === status?.pullCron}
            onClick={() => void setPullCron(cron.trim())}
          >
            Save schedule
          </button>
        </div>
      </div>
    </div>
  );
}

function RepoCard({
  repo,
  busy,
  onRefresh,
  onRemove,
}: {
  repo: CodeReferenceRepo;
  busy: boolean;
  onRefresh: () => void;
  onRemove: () => void;
}) {
  const inFlight = repo.state === "cloning" || repo.state === "indexing";
  return (
    <div style={card} data-testid="coderef-repo">
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <strong style={{ fontSize: 13 }}>
          {repo.owner}/{repo.name}
        </strong>
        {repo.ref && <span style={badge}>{repo.ref}</span>}
        <StateBadge state={repo.state} />
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          <button style={ghostButton} disabled={busy || inFlight} onClick={onRefresh}>
            Refresh
          </button>
          <button style={dangerButton} disabled={busy} onClick={onRemove}>
            Remove
          </button>
        </div>
      </div>
      <div style={{ fontSize: 11, color: "rgb(var(--muted))", display: "flex", gap: 12, flexWrap: "wrap" }}>
        {repo.lastCommit && <span>commit {repo.lastCommit}</span>}
        {repo.fileCount > 0 && (
          <span>
            {repo.fileCount} files · {repo.chunkCount} chunks
          </span>
        )}
        {repo.lastSyncedAt && <span>synced {new Date(repo.lastSyncedAt).toLocaleString()}</span>}
      </div>
      {repo.state === "error" && repo.error && (
        <span style={{ fontSize: 12, color: "rgb(var(--danger))" }}>✗ {repo.error}</span>
      )}
    </div>
  );
}

function StateBadge({ state }: { state: RepoSyncState }) {
  const map: Record<RepoSyncState, { label: string; color: string }> = {
    pending: { label: "Pending", color: "var(--muted)" },
    cloning: { label: "Cloning…", color: "var(--info)" },
    indexing: { label: "Indexing…", color: "var(--info)" },
    ready: { label: "Ready", color: "var(--success)" },
    error: { label: "Error", color: "var(--danger)" },
  };
  const { label, color } = map[state];
  return (
    <span style={{ ...badge, color: `rgb(${color})`, borderColor: `rgb(${color})` }}>{label}</span>
  );
}

const section: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 14 };
const h2: React.CSSProperties = { margin: 0, fontSize: 14 };
const hint: React.CSSProperties = { margin: "4px 0 0", fontSize: 12, color: "rgb(var(--muted))" };
const panel: React.CSSProperties = {
  border: "1px solid rgb(var(--border))",
  borderRadius: 8,
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 10,
};
const card: React.CSSProperties = {
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: 10,
  display: "flex",
  flexDirection: "column",
  gap: 6,
  background: "rgba(255,255,255,0.02)",
};
const input: React.CSSProperties = {
  background: "rgb(var(--bg))",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: "7px 9px",
  fontSize: 13,
  minWidth: 0,
};
const primary: React.CSSProperties = {
  background: "rgb(var(--accent))",
  color: "white",
  border: "none",
  borderRadius: 7,
  padding: "8px 13px",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};
const ghostButton: React.CSSProperties = {
  background: "transparent",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 7,
  padding: "6px 11px",
  cursor: "pointer",
  fontSize: 12,
};
const dangerButton: React.CSSProperties = {
  ...ghostButton,
  color: "rgb(var(--danger))",
  borderColor: "rgb(var(--danger))",
};
const badge: React.CSSProperties = {
  border: "1px solid rgb(var(--border))",
  borderRadius: 999,
  padding: "2px 7px",
  fontSize: 11,
  color: "rgb(var(--muted))",
};
const warnBox: React.CSSProperties = {
  border: "1px solid rgb(var(--danger))",
  background: "rgb(var(--danger-bg))",
  borderRadius: 8,
  padding: 10,
  fontSize: 12,
};
const infoBox: React.CSSProperties = {
  border: "1px solid rgb(var(--border))",
  background: "rgb(var(--info-bg))",
  borderRadius: 8,
  padding: 10,
  fontSize: 12,
};
