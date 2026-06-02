import { useEffect, useState } from "react";
import type { ProviderAccount, ProviderId, ProviderInfo } from "@otterbot/shared";
import { Field, ghostButton, hint, input, primary } from "./settings-styles";
import { TestConnection, testProviderConnection } from "./provider-test";
import { OpenAiOAuthControls } from "./OpenAiOAuthControls";

export type ProviderCreds = {
  baseUrl?: string;
  apiKey?: string;
  authMethod?: "api-key" | "oauth";
};

/**
 * Multi-step "add a provider" flow: pick a provider type, then enter and test
 * its credentials. Reusable in two modes:
 *  - standalone (from "+ Add provider"): `onDone()` just closes the modal.
 *  - embedded sub-flow (from the model wizard): `onDone({provider, account})`
 *    hands the freshly created account back so the caller can continue.
 *
 * The wizard renders only step content — the surrounding Modal owns the backdrop
 * — so it can be embedded inside another modal without nesting overlays.
 */
export function ProviderWizard({
  providers,
  existing,
  onCommitProvider,
  onDone,
  onCancel,
  embedded,
}: {
  /** Pre-filtered to providers that take credentials (needsApiKey || baseUrlEnv). */
  providers: ProviderInfo[];
  existing: Record<ProviderId, ProviderAccount[]>;
  /** Persist the new account and resolve once it's saved server-side. */
  onCommitProvider: (provider: ProviderId, account: string, creds: ProviderCreds) => Promise<void>;
  onDone: (created?: { provider: ProviderId; account: string }) => void;
  onCancel: () => void;
  embedded?: boolean;
}) {
  const [step, setStep] = useState<"type" | "credentials">("type");
  const [provider, setProvider] = useState<ProviderId>("");
  const [account, setAccount] = useState("default");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [authMethod, setAuthMethod] = useState<"api-key" | "oauth">("api-key");
  const [saving, setSaving] = useState(false);

  const info = providers.find((p) => p.id === provider);
  const takenNames = (existing[provider] ?? []).map((a) => a.account);

  // Suggest a non-clashing account label + reset creds when the type is chosen.
  const chooseProvider = (id: ProviderId) => {
    setProvider(id);
    const taken = (existing[id] ?? []).map((a) => a.account);
    let label = taken.includes("default") ? "personal" : "default";
    let n = 2;
    while (taken.includes(label)) label = `account-${n++}`;
    setAccount(label);
    setBaseUrl("");
    setApiKey("");
    setAuthMethod("api-key");
    setStep("credentials");
  };

  const isOpenAi = info?.id === "openai";
  const useOAuth = isOpenAi && authMethod === "oauth";
  const showBaseUrl = !!info?.baseUrlEnv && !info.needsApiKey;
  const showApiKey = !!info?.apiKeyEnv && !useOAuth;
  const baseUrlRequired = showBaseUrl && !info?.defaultBaseUrl; // compatible: no default
  const apiKeyRequired = !!info?.needsApiKey && !useOAuth;
  const nameTaken = takenNames.includes(account.trim());
  const incomplete =
    !account.trim() ||
    nameTaken ||
    (baseUrlRequired && !baseUrl.trim()) ||
    (apiKeyRequired && !apiKey.trim());

  const finish = async () => {
    if (!provider || incomplete) return;
    setSaving(true);
    try {
      await onCommitProvider(provider, account.trim(), {
        ...(baseUrl.trim() ? { baseUrl: baseUrl.trim() } : {}),
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(isOpenAi ? { authMethod } : {}),
      });
      onDone({ provider, account: account.trim() });
    } finally {
      setSaving(false);
    }
  };

  if (step === "type") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <strong style={{ fontSize: 13 }}>Choose a provider</strong>
          <p style={hint}>Pick the service or server this account connects to.</p>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {providers.map((p) => (
            <button key={p.id} onClick={() => chooseProvider(p.id)} style={typeCard}>
              <span style={{ fontSize: 13, fontWeight: 600 }}>{p.label}</span>
              <span style={{ fontSize: 11, color: "rgb(var(--muted))" }}>
                {p.needsApiKey ? "Cloud · API key" : p.baseUrlEnv ? "Local / custom endpoint" : ""}
              </span>
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={onCancel} style={ghostButton}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div>
        <strong style={{ fontSize: 13 }}>Configure {info?.label}</strong>
        <p style={hint}>Name this account and enter its credentials.</p>
      </div>

      <Field label="Account name">
        <input value={account} onChange={(e) => setAccount(e.target.value)} style={input} />
      </Field>
      {nameTaken && (
        <span style={{ fontSize: 11, color: "rgb(var(--danger))" }}>
          “{account.trim()}” already exists for {info?.label}. Pick a different name.
        </span>
      )}

      {isOpenAi && (
        <Field label="Authentication">
          <select
            value={authMethod}
            onChange={(e) => setAuthMethod(e.target.value as "api-key" | "oauth")}
            style={input}
          >
            <option value="api-key">API key</option>
            <option value="oauth">ChatGPT OAuth</option>
          </select>
        </Field>
      )}

      {useOAuth && <OpenAiOAuthControls />}

      {showBaseUrl && (
        <Field label="Base URL">
          <input
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={info?.defaultBaseUrl || "https://…/v1"}
            style={input}
          />
        </Field>
      )}
      {showApiKey && (
        <Field label={`${info?.label} API key`}>
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={apiKeyRequired ? "API key" : "Optional"}
            style={input}
          />
        </Field>
      )}

      {!useOAuth && (
        <TestConnection
          onTest={() => {
            const secrets: Record<string, string> = {};
            if (info?.apiKeyEnv && apiKey.trim()) secrets[info.apiKeyEnv] = apiKey.trim();
            if (info?.baseUrlEnv && baseUrl.trim()) secrets[info.baseUrlEnv] = baseUrl.trim();
            return testProviderConnection(provider, { secrets });
          }}
        />
      )}

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => void finish()} disabled={incomplete || saving} style={primary}>
          {saving ? "Saving…" : embedded ? "Add provider & continue" : "Add provider"}
        </button>
        <button onClick={() => setStep("type")} disabled={saving} style={ghostButton}>
          Back
        </button>
        <button onClick={onCancel} disabled={saving} style={ghostButton}>
          Cancel
        </button>
      </div>
    </div>
  );
}

const typeCard: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "flex-start",
  gap: 2,
  textAlign: "left",
  background: "rgba(255,255,255,0.02)",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 8,
  padding: "10px 12px",
  cursor: "pointer",
};
