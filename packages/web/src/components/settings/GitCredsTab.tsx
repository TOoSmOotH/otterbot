import { useState } from "react";
import { X, ArrowLeft } from "lucide-react";
import { Icon } from "../ui/Icon";
import { useProjectsStore, type ForgeAccount } from "../../stores/projects-store";

/**
 * Reusable git-credential (GitHub / Gitea forge account) pieces — the add
 * wizard and the configured-account row. These are surfaced through the unified
 * Settings → Credentials tab; this module no longer renders a tab of its own.
 */

type Step = "provider" | "auth" | "key";

/**
 * Multi-step wizard to add an instance-wide forge account (provider → auth →
 * SSH key). Self-contained modal: renders its own overlay. `onClose` fires on
 * cancel or completion.
 */
export function GitCredWizard({ onClose }: { onClose: () => void }) {
  const add = useProjectsStore((s) => s.addForgeAccount);
  const [step, setStep] = useState<Step>("provider");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState<string | null>(null);
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
  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const create = async () => {
    setBusy(true);
    setError(null);
    const created = await add(form);
    setBusy(false);
    if (!created) {
      setError(useProjectsStore.getState().error ?? "failed to add credentials");
      return;
    }
    if (form.gitTransport === "ssh" && created.publicKey) {
      setPublicKey(created.publicKey);
      setStep("key");
    } else {
      onClose();
    }
  };

  return (
    <div style={overlay} onClick={onClose}>
      <div style={modal} onClick={(e) => e.stopPropagation()}>
        {step === "auth" && (
          <button style={backBtn} onClick={() => setStep("provider")}>
            <Icon icon={ArrowLeft} size={14} /> Back
          </button>
        )}

        {step === "provider" && (
          <>
            <h2 style={h2}>Add git credentials</h2>
            <p style={hint}>Where do your repos live?</p>
            <label style={lbl}>Provider</label>
            <select value={form.provider} onChange={(e) => set({ provider: e.target.value as "github" | "gitea" })} style={input}>
              <option value="github">GitHub</option>
              <option value="gitea">Gitea</option>
            </select>
            <label style={lbl}>Label</label>
            <input placeholder="e.g. work-github" value={form.label} onChange={(e) => set({ label: e.target.value })} style={input} />
            {form.provider === "gitea" && (
              <>
                <label style={lbl}>Instance URL</label>
                <input placeholder="https://gitea.lan" value={form.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} style={input} />
              </>
            )}
            <label style={lbl}>Bot username</label>
            <input placeholder="the account's username" value={form.username} onChange={(e) => set({ username: e.target.value })} style={input} />
            <label style={lbl}>API token</label>
            <input placeholder="personal access token" type="password" value={form.token} onChange={(e) => set({ token: e.target.value })} style={input} />
            <p style={hint}>The token is used for the forge API (PRs/MRs, issue + CI monitoring).</p>
            <div style={actions}>
              <button style={ghostBtn} onClick={onClose}>Cancel</button>
              <button style={primaryBtn} disabled={!form.token || (form.provider === "gitea" && !form.baseUrl)} onClick={() => setStep("auth")}>
                Next
              </button>
            </div>
          </>
        )}

        {step === "auth" && (
          <>
            <h2 style={h2}>How should git authenticate?</h2>
            <label style={lbl}>Transport</label>
            <select
              value={form.gitTransport}
              onChange={(e) => set({ gitTransport: e.target.value as "https" | "ssh", signCommits: e.target.value === "ssh" ? form.signCommits : false })}
              style={input}
            >
              <option value="https">git over HTTPS (use the token)</option>
              <option value="ssh">git over SSH (managed key)</option>
            </select>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 8 }}>
              <div>
                <label style={lbl}>Committer name</label>
                <input value={form.committerName} onChange={(e) => set({ committerName: e.target.value })} style={input} />
              </div>
              <div>
                <label style={lbl}>Committer email</label>
                <input value={form.committerEmail} onChange={(e) => set({ committerEmail: e.target.value })} style={input} />
              </div>
            </div>
            {form.gitTransport === "ssh" && (
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "rgb(var(--muted))", marginTop: 10 }}>
                <input type="checkbox" checked={form.signCommits} onChange={(e) => set({ signCommits: e.target.checked })} />
                SSH-sign commits with the managed key (for the Verified badge)
              </label>
            )}
            <p style={hint}>
              {form.gitTransport === "ssh"
                ? "Otterbot generates a key on save and shows the public key to add on the forge (auth key, plus a signing key if signing is on)."
                : "Use the email registered on the account so commits show as Verified."}
            </p>
            {error && <div style={errStyle}>{error}</div>}
            <div style={actions}>
              <button style={ghostBtn} onClick={onClose}>Cancel</button>
              <button style={primaryBtn} disabled={busy} onClick={() => void create()}>
                {busy ? "Saving…" : "Save"}
              </button>
            </div>
          </>
        )}

        {step === "key" && (
          <>
            <h2 style={h2}>Add this key to the forge</h2>
            <p style={hint}>
              Add the public key below to {form.provider === "github" ? "GitHub" : "Gitea"} as an
              <strong> SSH authentication key</strong>
              {form.signCommits ? <> and an <strong>SSH signing key</strong></> : null}. Until it's
              added, clone/push will fail.
            </p>
            <textarea
              readOnly
              value={publicKey ?? ""}
              onFocus={(e) => e.currentTarget.select()}
              style={{ ...input, width: "100%", fontFamily: "monospace", fontSize: 11, height: 70 }}
            />
            <div style={actions}>
              <button style={primaryBtn} onClick={onClose}>Done</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export function ForgeAccountRow({ account, onDelete }: { account: ForgeAccount; onDelete: () => void }) {
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
        <button style={chipX} onClick={onDelete} title="Delete credentials">
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
  width: "100%",
  boxSizing: "border-box",
  background: "rgb(var(--bg))",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: "6px 10px",
  fontSize: 13,
};
const lbl: React.CSSProperties = { display: "block", fontSize: 11, fontWeight: 600, margin: "8px 0 2px" };
const hint: React.CSSProperties = { color: "rgb(var(--muted))", fontSize: 11, marginTop: 6 };
const h2: React.CSSProperties = { margin: "0 0 4px", fontSize: 16, fontWeight: 600 };
const errStyle: React.CSSProperties = { color: "rgb(220 90 90)", fontSize: 12, marginTop: 8 };
const actions: React.CSSProperties = { display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 14 };
const overlay: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.6)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 100,
};
const modal: React.CSSProperties = {
  width: "min(92vw, 520px)",
  maxHeight: "86vh",
  overflowY: "auto",
  background: "rgb(var(--bg))",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 10,
  padding: 18,
  boxShadow: "0 16px 48px rgba(0,0,0,0.5)",
};
const primaryBtn: React.CSSProperties = {
  background: "rgb(var(--accent))",
  color: "#fff",
  border: "none",
  borderRadius: 6,
  padding: "7px 14px",
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
  padding: "6px 12px",
  cursor: "pointer",
  fontSize: 12,
};
const backBtn: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 4,
  background: "transparent",
  color: "rgb(var(--muted))",
  border: "none",
  cursor: "pointer",
  fontSize: 12,
  padding: 0,
  marginBottom: 8,
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
