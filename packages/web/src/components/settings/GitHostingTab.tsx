import { useEffect, useState } from "react";
import { Plus, X } from "lucide-react";
import { Icon } from "../ui/Icon";
import { useProjectsStore, type ForgeAccount } from "../../stores/projects-store";

/**
 * Instance-wide git-hosting accounts (GitHub / Gitea) used by project pipelines
 * to clone, push, open PRs/MRs, and monitor issues. Per-project repo selection
 * lives on each project in the Projects tab; this is the shared credential store.
 */
export function GitHostingTab() {
  const accounts = useProjectsStore((s) => s.forgeAccounts);
  const load = useProjectsStore((s) => s.loadForgeAccounts);
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

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div style={{ maxWidth: 680 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 14, fontWeight: 600 }}>Git hosting accounts</h3>
        <span style={{ flex: 1 }} />
        <button style={ghostBtn} onClick={() => setOpen((v) => !v)}>
          <Icon icon={Plus} size={14} /> Add
        </button>
      </div>
      <p style={{ color: "rgb(var(--muted))", fontSize: 12, marginTop: 4 }}>
        GitHub / Gitea accounts your project pipelines use to clone, push, open PRs/MRs, and monitor
        issues. Pick which repo a project uses on the project itself (Projects tab).
      </p>

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
              On save, otterbot generates an SSH key and shows the public key (🔑) — add it to the
              forge as an authentication key (and a signing key, for Verified commits).
            </span>
          )}
        </form>
      )}
    </div>
  );
}

function ForgeAccountRow({ account, onDelete }: { account: ForgeAccount; onDelete: () => void }) {
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
  justifyContent: "center",
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
