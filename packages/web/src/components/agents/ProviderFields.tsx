import { useEffect, useState } from "react";
import { apiFetch } from "../../lib/api";
import type { ProviderAccount, ProviderId, ProviderInfo } from "@otterbot/shared";
import { providerCredField, isAccountConfigured, findAccount } from "../../stores/providers-store";
import { BuiltinEmbedderControls } from "../BuiltinEmbedderControls";

export type TestState = { status: "idle" | "testing" | "ok" | "fail"; message?: string };
export type AuthMethod = "api-key" | "oauth";

/** Account-wide ChatGPT-subscription OAuth, threaded into the chat picker. */
export interface OAuthBundle {
  authMethod: AuthMethod;
  setAuthMethod: (m: AuthMethod) => void;
  status: { connected: boolean; accountId: string | null } | null;
  models: string[];
  busy: boolean;
  signIn: () => void;
  signOut: () => void;
  /** Manual completion (paste the redirect URL) — for remote-box installs. */
  paste: string;
  onPaste: (v: string) => void;
  complete: () => void;
  completing: boolean;
}

/** Whether a provider exposes a fetchable `/models` list (local HTTP servers). */
export const isLocalProvider = (info: ProviderInfo | undefined) =>
  !!info && !info.needsApiKey && !!info.baseUrlEnv;

const NEW_ACCOUNT = "__new__";

/**
 * Provider + account + credential + model selection for one model slot
 * (chat or embedding). Shared by onboarding, the New-agent screen, and the
 * Agent Studio model tab. When `oauth` is supplied (chat only) an OpenAI
 * ChatGPT-subscription option is offered alongside the API key.
 *
 * Multi-account: a provider may have several saved credential sets (e.g.
 * "personal" / "work"). The Account dropdown picks which one this model slot
 * uses; "+ New account" reveals an inline label for a brand-new account.
 */
export function ProviderFields({
  kind,
  providers,
  provider,
  onProvider,
  account,
  onAccount,
  accounts,
  cred,
  onCred,
  modelId,
  onModelId,
  test,
  onTest,
  models,
  onModels,
  modelLabel,
  modelHint,
  oauth,
  apiKey,
  onApiKey,
}: {
  kind: "chat" | "embedding";
  providers: ProviderInfo[];
  provider: ProviderId;
  onProvider: (p: ProviderId) => void;
  /** Name of the currently selected account (e.g. "default", "personal"). */
  account: string;
  /** Pick an existing account or rename the in-progress new one. */
  onAccount: (name: string) => void;
  /** Saved accounts for the current provider. */
  accounts: ProviderAccount[];
  cred: string;
  onCred: (v: string) => void;
  modelId: string;
  onModelId: (v: string) => void;
  test: TestState;
  onTest: (t: TestState) => void;
  models: string[];
  onModels: (m: string[]) => void;
  modelLabel: string;
  modelHint?: string;
  oauth?: OAuthBundle;
  /**
   * Optional API key for providers whose primary credential field is a base
   * URL but which can also take a key (OpenAI-compatible / local servers behind
   * auth). When `onApiKey` is supplied, an extra optional key input is shown.
   */
  apiKey?: string;
  onApiKey?: (v: string) => void;
}) {
  const info = providers.find((p) => p.id === provider);
  const credMeta = info ? providerCredField(info) : null;
  const isLocal = isLocalProvider(info);
  // Providers whose main cred field is the base URL but that still accept a key.
  const optionalKeyEnv =
    info && !info.needsApiKey && info.apiKeyEnv && info.baseUrlEnv && info.id !== "builtin"
      ? info.apiKeyEnv
      : null;
  const showOptionalKey = Boolean(optionalKeyEnv && onApiKey);
  /** Build the secrets payload for test / model-list calls (cred + optional key). */
  const credSecrets = (): Record<string, string> => {
    const s: Record<string, string> = {};
    if (cred.trim() && credMeta) s[credMeta.key] = cred.trim();
    if (optionalKeyEnv && apiKey?.trim()) s[optionalKeyEnv] = apiKey.trim();
    return s;
  };
  const useOAuth = !!oauth && provider === "openai" && oauth.authMethod === "oauth";
  // The account currently shown in the cred field — may be one of the saved
  // accounts or a brand-new label being typed.
  const selectedAccount = findAccount(accounts, account);
  const isNewAccount = !accounts.some((a) => a.account === account);
  const accountConfigured = !!info && isAccountConfigured(info, selectedAccount);

  // When an account is already configured the credential field collapses to a
  // "✓ Configured" row; this reveals it for an override.
  const [editCred, setEditCred] = useState(false);
  useEffect(() => setEditCred(false), [provider, account]);

  /** Fetch the model list a provider currently serves. */
  const loadModels = async () => {
    onTest({ status: "testing" });
    try {
      const res = await apiFetch("/api/provider-models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, secrets: credSecrets() }),
      });
      const data = (await res.json()) as { ok: boolean; models?: string[]; error?: string };
      if (data.ok && data.models && data.models.length > 0) {
        const list = data.models;
        onModels(list);
        const guess =
          kind === "embedding"
            ? (list.find((m) => /embed/i.test(m)) ?? list[0])
            : (list.find((m) => !/embed/i.test(m)) ?? list[0]);
        if (!list.includes(modelId)) onModelId(guess);
        onTest({ status: "ok", message: `Found ${list.length} model(s).` });
      } else {
        onModels([]);
        onTest({ status: "fail", message: data.error ?? "No models found at that address." });
      }
    } catch (err) {
      onModels([]);
      onTest({ status: "fail", message: err instanceof Error ? err.message : String(err) });
    }
  };

  const runTest = async () => {
    onTest({ status: "testing" });
    try {
      const res = await apiFetch("/api/test-model", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, modelId: modelId.trim(), secrets: credSecrets() }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      onTest(
        data.ok
          ? { status: "ok", message: "Connection succeeded." }
          : { status: "fail", message: data.error ?? "Connection failed." }
      );
    } catch (err) {
      onTest({ status: "fail", message: err instanceof Error ? err.message : String(err) });
    }
  };

  return (
    <>
      <Field label="Provider">
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {providers.map((pr) => (
            <button
              key={pr.id}
              onClick={() => onProvider(pr.id)}
              style={{
                ...chip,
                background: provider === pr.id ? "rgb(var(--accent))" : "transparent",
                color: provider === pr.id ? "white" : "rgb(var(--fg))",
              }}
            >
              {pr.label}
            </button>
          ))}
        </div>
      </Field>

      {info && info.id !== "builtin" && (
        <Field label="Account">
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <select
              value={isNewAccount ? NEW_ACCOUNT : account}
              onChange={(e) => {
                onTest({ status: "idle" });
                onModels([]);
                if (e.target.value === NEW_ACCOUNT) {
                  // Suggest a unique label.
                  let label = "personal";
                  let i = 2;
                  while (accounts.some((a) => a.account === label)) label = `account-${i++}`;
                  onAccount(label);
                  onCred("");
                } else {
                  onAccount(e.target.value);
                }
              }}
              style={{ ...input, flex: "0 0 180px" }}
            >
              {accounts.map((a) => (
                <option key={a.account} value={a.account}>
                  {a.account}
                </option>
              ))}
              <option value={NEW_ACCOUNT}>+ New account…</option>
            </select>
            {isNewAccount && (
              <input
                value={account}
                onChange={(e) => onAccount(e.target.value)}
                placeholder="account label (e.g. work)"
                style={input}
              />
            )}
          </div>
        </Field>
      )}

      {oauth && provider === "openai" && (
        <Field label="Authentication">
          <div style={{ display: "flex", gap: 6 }}>
            {(["api-key", "oauth"] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  oauth.setAuthMethod(m);
                  onTest({ status: "idle" });
                }}
                style={{
                  ...chip,
                  background: oauth.authMethod === m ? "rgb(var(--accent))" : "transparent",
                  color: oauth.authMethod === m ? "white" : "rgb(var(--fg))",
                }}
              >
                {m === "api-key" ? "API key" : "ChatGPT subscription"}
              </button>
            ))}
          </div>
        </Field>
      )}

      {provider === "builtin" ? (
        <div style={oauthCard}>
          <strong style={{ fontSize: 12 }}>Built-in embedder · all-MiniLM-L6-v2</strong>
          <BuiltinEmbedderControls />
        </div>
      ) : useOAuth && oauth ? (
        <div style={oauthCard}>
          <strong style={{ fontSize: 12 }}>ChatGPT subscription</strong>
          {oauth.status?.connected ? (
            <>
              <div style={{ fontSize: 12, color: "#4ade80" }}>
                ✓ Connected{oauth.status.accountId ? ` · account ${oauth.status.accountId}` : ""}
              </div>
              <button onClick={oauth.signOut} style={{ ...ghost, alignSelf: "flex-start" }}>
                Sign out
              </button>
            </>
          ) : (
            <>
              <div style={{ fontSize: 11, color: "rgb(var(--muted))", lineHeight: 1.5 }}>
                Use a ChatGPT Plus/Pro subscription instead of an API key. Sign-in is account-wide —
                it applies to every agent whose chat provider is OpenAI. Unofficial route; it may
                stop working if OpenAI changes it.
              </div>
              <button
                onClick={oauth.signIn}
                disabled={oauth.busy}
                style={{ ...primary, alignSelf: "flex-start" }}
              >
                {oauth.busy ? "Waiting for sign-in…" : "Sign in with ChatGPT"}
              </button>
              <div
                style={{
                  borderTop: "1px solid rgb(var(--border))",
                  paddingTop: 8,
                  display: "flex",
                  flexDirection: "column",
                  gap: 6,
                }}
              >
                <span style={{ fontSize: 11, color: "rgb(var(--muted))", lineHeight: 1.5 }}>
                  Running otterbot on a remote box? Your browser can't reach{" "}
                  <code>localhost:1455</code>. After approving, copy the URL it was redirected to
                  (the page won't load) and paste it here.
                </span>
                <input
                  value={oauth.paste}
                  onChange={(e) => oauth.onPaste(e.target.value)}
                  placeholder="http://localhost:1455/auth/callback?code=…"
                  style={input}
                />
                <button
                  onClick={oauth.complete}
                  disabled={oauth.completing || !oauth.paste.trim()}
                  style={{ ...ghost, alignSelf: "flex-start" }}
                >
                  {oauth.completing ? "Completing…" : "Complete sign-in"}
                </button>
              </div>
              {test.status === "fail" && (
                <span style={{ fontSize: 12, color: "#f87171" }}>✗ {test.message}</span>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          {credMeta &&
            // Collapse to a "✓ Saved" row only for SECRET fields (API keys we
            // shouldn't redisplay). A non-secret base URL — often just the
            // provider's seeded default — is always shown as an editable input,
            // so it never looks like credentials the user didn't set.
            (credMeta.secret && accountConfigured && !editCred && !isNewAccount ? (
              <Field label={credMeta.label}>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span style={{ fontSize: 12, color: "#4ade80" }}>
                    ✓ Saved on account "{account}"
                  </span>
                  <button style={updateBtn} onClick={() => setEditCred(true)}>
                    Update credentials
                  </button>
                </div>
              </Field>
            ) : (
              <Field label={credMeta.label}>
                <input
                  type={credMeta.secret ? "password" : "text"}
                  value={cred}
                  onChange={(e) => {
                    onCred(e.target.value);
                    onTest({ status: "idle" });
                    onModels([]);
                  }}
                  placeholder={credMeta.placeholder}
                  style={input}
                />
              </Field>
            ))}
          {showOptionalKey && (
            <Field label={`${info?.label ?? "Provider"} API key (optional)`}>
              <input
                type="password"
                value={apiKey ?? ""}
                onChange={(e) => {
                  onApiKey?.(e.target.value);
                  onTest({ status: "idle" });
                  onModels([]);
                }}
                placeholder="API key — leave blank if the endpoint needs none"
                style={input}
              />
            </Field>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <button
              style={ghost}
              onClick={isLocal ? loadModels : runTest}
              disabled={test.status === "testing"}
            >
              {test.status === "testing"
                ? isLocal
                  ? "Loading…"
                  : "Testing…"
                : isLocal
                  ? "Get models"
                  : "Test connection"}
            </button>
            {test.status === "ok" && <span style={{ fontSize: 12, color: "#4ade80" }}>✓ {test.message}</span>}
            {test.status === "fail" && (
              <span style={{ fontSize: 12, color: "#f87171" }}>✗ {test.message}</span>
            )}
          </div>
        </>
      )}

      {provider !== "builtin" && (
        <ModelField
          label={modelLabel}
          hint={modelHint}
          value={modelId}
          onChange={onModelId}
          models={useOAuth && oauth ? oauth.models : isLocal ? models : []}
        />
      )}
    </>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 12 }}>
      <span style={{ color: "rgb(var(--muted))" }}>{label}</span>
      {children}
    </label>
  );
}

/**
 * A model-id input. When a fetched model list is available (local providers
 * after "Get models", or the Codex catalogue) it renders a dropdown;
 * otherwise a free-text input.
 */
function ModelField({
  label,
  hint,
  value,
  onChange,
  models,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (v: string) => void;
  models: string[];
}) {
  return (
    <Field label={label}>
      {models.length > 0 ? (
        <select value={value} onChange={(e) => onChange(e.target.value)} style={input}>
          {/* The current value may not be in the list yet (e.g. a custom id). */}
          {!models.includes(value) && <option value={value}>{value}</option>}
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} style={input} />
      )}
      {hint && <span style={{ color: "rgb(var(--muted))", fontSize: 11 }}>{hint}</span>}
    </Field>
  );
}

const input: React.CSSProperties = {
  background: "rgb(var(--bg))",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: "7px 9px",
  fontSize: 13,
  width: "100%",
};

const chip: React.CSSProperties = {
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: "4px 12px",
  fontSize: 12,
  cursor: "pointer",
};

const primary: React.CSSProperties = {
  background: "rgb(var(--accent))",
  color: "white",
  border: "none",
  padding: "8px 16px",
  borderRadius: 7,
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 600,
};

const ghost: React.CSSProperties = {
  background: "transparent",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  padding: "8px 14px",
  borderRadius: 7,
  cursor: "pointer",
  fontSize: 13,
};

const updateBtn: React.CSSProperties = {
  background: "transparent",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  padding: "4px 10px",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 12,
};

const oauthCard: React.CSSProperties = {
  border: "1px solid rgb(var(--border))",
  borderRadius: 8,
  padding: 12,
  display: "flex",
  flexDirection: "column",
  gap: 8,
};
