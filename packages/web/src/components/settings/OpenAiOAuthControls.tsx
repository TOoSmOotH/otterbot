import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import { ghostButton, hint, primary } from "./settings-styles";

type OpenAiAuthStatus = { connected: boolean; accountId: string | null };

/**
 * ChatGPT-subscription OAuth controls for an OpenAI account. The OAuth login is
 * account-wide (not per provider account) and shared with the Codex CLI, so the
 * account record only stores `authMethod: "oauth"` — the connection itself lives
 * server-side. Rendered both inside an account card and in the provider wizard.
 */
export function OpenAiOAuthControls() {
  const [status, setStatus] = useState<OpenAiAuthStatus | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = () =>
    apiFetch("/api/auth/openai/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});

  useEffect(() => void refresh(), []);

  const signIn = async () => {
    setBusy(true);
    try {
      const res = await apiFetch("/api/auth/openai/login", { method: "POST" });
      const data = (await res.json()) as { authUrl?: string; error?: string };
      if (!data.authUrl) {
        alert(data.error ?? "Could not start sign-in.");
        setBusy(false);
        return;
      }
      window.open(data.authUrl, "_blank", "noopener");
      const started = Date.now();
      const timer = setInterval(async () => {
        const next = await apiFetch("/api/auth/openai/status")
          .then((r) => r.json())
          .catch(() => null);
        if (next?.connected || Date.now() - started > 300_000) {
          clearInterval(timer);
          if (next) setStatus(next);
          setBusy(false);
        }
      }, 2000);
    } catch {
      setBusy(false);
    }
  };

  const signOut = async () => {
    await apiFetch("/api/auth/openai/signout", { method: "POST" });
    void refresh();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={hint}>
        Uses the same ChatGPT subscription OAuth route as Hermes/Codex — account-wide, not per
        agent or per provider account. This login is shared with the Codex CLI (same OpenAI
        account), so you sign in once for both — no separate <code>codex login</code> needed.
      </div>
      {status?.connected ? (
        <>
          <div style={{ fontSize: 12, color: "#4ade80" }}>
            Connected{status.accountId ? ` - account ${status.accountId}` : ""}
          </div>
          <button onClick={signOut} style={{ ...ghostButton, alignSelf: "flex-start" }}>
            Sign out
          </button>
        </>
      ) : (
        <button onClick={signIn} disabled={busy} style={{ ...primary, alignSelf: "flex-start" }}>
          {busy ? "Waiting for sign-in..." : "Sign in with ChatGPT"}
        </button>
      )}
    </div>
  );
}
