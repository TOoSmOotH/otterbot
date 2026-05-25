import { useEffect, useMemo, useState } from "react";
import {
  apiFetch,
  changePassword,
  listSessions,
  logout,
  revokeSession,
  type SessionInfo,
  type SessionList,
} from "../../lib/api";
import type {
  ConfiguredModel,
  GlobalSettings as GlobalSettingsShape,
  ProviderAccount,
  ProviderId,
  ProviderInfo,
  ThemeId,
} from "@otterbot/shared";
import { THEMES, useGlobalSettingsStore, applyTheme } from "../../stores/global-settings-store";
import { useProvidersStore, isAccountConfigured } from "../../stores/providers-store";
import { BuiltinEmbedderControls } from "../BuiltinEmbedderControls";
import { CodeReferenceTab } from "./CodeReferenceTab";
import { uniqueModelId } from "../../lib/model-id";

type OpenAiAuthStatus = { connected: boolean; accountId: string | null };

const TABS = ["Providers", "Models", "Code Reference", "Appearance", "Account"] as const;
type SettingsTab = (typeof TABS)[number];

type PatchFn = (p: Partial<GlobalSettingsShape>) => void;

export function GlobalSettings() {
  const savedSettings = useGlobalSettingsStore((s) => s.settings);
  const load = useGlobalSettingsStore((s) => s.load);
  const saveSettings = useGlobalSettingsStore((s) => s.save);
  const saving = useGlobalSettingsStore((s) => s.saving);
  const providers = useProvidersStore((s) => s.providers);
  const loadProviders = useProvidersStore((s) => s.load);
  const [draft, setDraft] = useState<GlobalSettingsShape>(savedSettings);
  const [tab, setTab] = useState<SettingsTab>("Providers");
  const [status, setStatus] = useState("");

  useEffect(() => void load(), [load]);
  useEffect(() => void loadProviders(), [loadProviders]);
  useEffect(() => setDraft(savedSettings), [savedSettings]);

  const dirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(savedSettings),
    [draft, savedSettings]
  );

  const patch: PatchFn = (p) => {
    setDraft((current) => ({ ...current, ...p }));
    setStatus("");
  };

  const save = async () => {
    const saved = await saveSettings(draft);
    setStatus(saved ? "Saved." : "Save failed.");
  };

  // Persist an explicit next-settings immediately, for actions that should
  // auto-save rather than wait for the save bar (e.g. adding a provider, so its
  // credentials reach the server before the user lists that provider's models).
  const commit = async (next: GlobalSettingsShape) => {
    setDraft(next);
    const saved = await saveSettings(next);
    setStatus(saved ? "Saved." : "Save failed.");
  };

  // Theme applies live for preview, so discarding must revert it too.
  const discard = () => {
    setDraft(savedSettings);
    applyTheme(savedSettings.theme);
    setStatus("");
  };

  return (
    <div data-testid="global-settings" style={page}>
      <header style={header}>
        <h1 style={{ margin: 0, fontSize: 18 }}>Global Settings</h1>
        <p style={hint}>Defaults used across otterbot. Per-agent credentials still override these.</p>
      </header>

      <nav style={tabBar}>
        {TABS.map((t) => (
          <button
            key={t}
            data-testid={`settings-tab-${t}`}
            onClick={() => setTab(t)}
            style={{
              ...tabButton,
              background: tab === t ? "rgb(var(--accent))" : "transparent",
              color: tab === t ? "white" : "rgb(var(--fg))",
            }}
          >
            {t}
          </button>
        ))}
      </nav>

      <div style={tabBody}>
        {tab === "Providers" && (
          <ProvidersTab draft={draft} patch={patch} providers={providers} onCommit={commit} />
        )}
        {tab === "Models" && <ModelsTab draft={draft} patch={patch} providers={providers} />}
        {tab === "Code Reference" && <CodeReferenceTab />}
        {tab === "Appearance" && <AppearanceTab draft={draft} patch={patch} />}
        {tab === "Account" && <AccountTab />}
      </div>

      {dirty && (
        <div style={saveBar}>
          <span style={{ fontSize: 13, fontWeight: 600 }}>Unsaved changes</span>
          {status && <span style={hint}>{status}</span>}
          <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
            <button onClick={discard} disabled={saving} style={ghostButton}>
              Discard
            </button>
            <button onClick={save} disabled={saving} style={primary}>
              {saving ? "Saving..." : "Save settings"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// --- Providers tab --------------------------------------------------------

/** Whether a provider account should appear in the configured-providers list. */
function isAccountVisible(info: ProviderInfo, acc: ProviderAccount): boolean {
  if (info.id === "openai" && acc.authMethod === "oauth") return true;
  // A pending (typed-but-unsaved) API key counts so a freshly added account
  // doesn't vanish before its first save round-trip.
  if (acc.apiKey && acc.apiKey.trim()) return true;
  return isAccountConfigured(info, acc);
}

type TestStatus = { state: "idle" | "testing" | "ok" | "fail"; message?: string };

/**
 * Verify a provider's credentials by listing its models. `account` resolves the
 * stored credentials for that account server-side; `secrets` layers any typed
 * (unsaved) overrides on top so a key can be tested before it's saved.
 */
async function testProviderConnection(
  provider: ProviderId,
  opts: { account?: string; secrets?: Record<string, string> }
): Promise<TestStatus> {
  try {
    const res = await apiFetch("/api/provider-models", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider, account: opts.account, secrets: opts.secrets ?? {} }),
    });
    const data = (await res.json()) as { ok: boolean; models?: string[]; error?: string };
    return data.ok
      ? { state: "ok", message: `Connected — ${data.models?.length ?? 0} model(s)` }
      : { state: "fail", message: data.error ?? "Connection failed" };
  } catch (err) {
    return { state: "fail", message: err instanceof Error ? err.message : String(err) };
  }
}

/** A "Test" button + inline status, shared by the account card and add form. */
function TestConnection({ onTest }: { onTest: () => Promise<TestStatus> }) {
  const [status, setStatus] = useState<TestStatus>({ state: "idle" });
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
      <button
        onClick={async () => {
          setStatus({ state: "testing" });
          setStatus(await onTest());
        }}
        disabled={status.state === "testing"}
        style={ghostButton}
      >
        {status.state === "testing" ? "Testing…" : "Test"}
      </button>
      {status.state === "ok" && (
        <span style={{ fontSize: 12, color: "rgb(var(--success))" }}>✓ {status.message}</span>
      )}
      {status.state === "fail" && (
        <span style={{ fontSize: 12, color: "rgb(var(--danger))" }}>✗ {status.message}</span>
      )}
    </div>
  );
}

/**
 * Provider credentials — the foundation everything else depends on. A single
 * "+ Add provider" button, then one card per configured credential set (e.g.
 * "OpenAI · work"). Models reference these accounts by name.
 */
function ProvidersTab({
  draft,
  patch,
  providers,
  onCommit,
}: {
  draft: GlobalSettingsShape;
  patch: PatchFn;
  providers: ProviderInfo[];
  onCommit: (next: GlobalSettingsShape) => Promise<void>;
}) {
  const credentialProviders = providers.filter((p) => p.needsApiKey || p.baseUrlEnv);
  const byId = useMemo(
    () => new Map(credentialProviders.map((p) => [p.id, p])),
    [credentialProviders]
  );
  const [adding, setAdding] = useState(false);

  // Flatten every configured account across all providers into a single list.
  const cards: { info: ProviderInfo; account: ProviderAccount; index: number }[] = [];
  for (const info of credentialProviders) {
    (draft.providers[info.id] ?? []).forEach((account, index) => {
      if (isAccountVisible(info, account)) cards.push({ info, account, index });
    });
  }

  const setAccounts = (providerId: ProviderId, next: ProviderAccount[]) =>
    patch({ providers: { ...draft.providers, [providerId]: next } });

  const updateAccount = (info: ProviderInfo, index: number, p: Partial<ProviderAccount>) => {
    const accounts = draft.providers[info.id] ?? [];
    setAccounts(info.id, accounts.map((a, i) => (i === index ? { ...a, ...p } : a)));
  };

  const renameAccount = (info: ProviderInfo, index: number, nextName: string) => {
    const accounts = draft.providers[info.id] ?? [];
    let unique = nextName.trim() || `account-${index + 1}`;
    let n = 2;
    while (accounts.some((a, i) => i !== index && a.account === unique)) unique = `${nextName.trim()}-${n++}`;
    const oldName = accounts[index].account;
    setAccounts(info.id, accounts.map((a, i) => (i === index ? { ...a, account: unique } : a)));
    // Repoint any configured models that named the old account.
    if (oldName !== unique) {
      patch({
        models: draft.models.map((m) =>
          m.provider === info.id && m.account === oldName ? { ...m, account: unique } : m
        ),
      });
    }
  };

  const deleteAccount = (info: ProviderInfo, index: number) => {
    const accounts = draft.providers[info.id] ?? [];
    setAccounts(info.id, accounts.filter((_, i) => i !== index));
  };

  const addProvider = (
    providerId: ProviderId,
    accountName: string,
    creds: { baseUrl?: string; apiKey?: string }
  ) => {
    const info = byId.get(providerId);
    if (!info) return;
    const accounts = draft.providers[providerId] ?? [];
    const label = accountName.trim() || "default";
    const patchValue: Partial<ProviderAccount> = {
      ...(creds.baseUrl?.trim() ? { baseUrl: creds.baseUrl.trim() } : {}),
      ...(creds.apiKey?.trim() ? { apiKey: creds.apiKey.trim() } : {}),
      ...(info.id === "openai" ? { authMethod: "api-key" as const } : {}),
    };
    const existing = accounts.findIndex((a) => a.account === label);
    const nextAccounts =
      existing >= 0
        ? accounts.map((a, i) => (i === existing ? { ...a, ...patchValue } : a))
        : [
            ...accounts,
            { account: label, baseUrl: info.defaultBaseUrl ?? "", apiKeyConfigured: false, ...patchValue },
          ];
    setAdding(false);
    // Auto-save so the new account's credentials are persisted server-side
    // immediately — model listing for this provider reads saved secrets, not
    // the unsaved draft.
    void onCommit({ ...draft, providers: { ...draft.providers, [providerId]: nextAccounts } });
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <section style={section}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={h2}>Model Providers</h2>
          <button onClick={() => setAdding(true)} style={ghostButton}>
            + Add provider
          </button>
        </div>
        <p style={hint}>
          The provider accounts you've configured. Add another to use a new provider or a second key
          for the same one (e.g. personal + work). Models reference these by name.
        </p>

        {adding && (
          <AddProviderForm
            providers={credentialProviders}
            existing={draft.providers}
            onCancel={() => setAdding(false)}
            onAdd={addProvider}
          />
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {cards.length === 0 && !adding && (
            <p style={hint}>No providers configured yet — click “Add provider”.</p>
          )}
          {cards.map(({ info, account, index }) => (
            <AccountCard
              key={`${info.id}-${index}-${account.account}`}
              info={info}
              providerLabel={info.label}
              account={account}
              canDelete
              onRename={(name) => renameAccount(info, index, name)}
              onPatch={(p) => updateAccount(info, index, p)}
              onDelete={() => deleteAccount(info, index)}
            />
          ))}
        </div>
      </section>

      <section style={section}>
        <BuiltinEmbedderPanel />
      </section>
    </div>
  );
}

/** Inline form to configure a new provider account. */
function AddProviderForm({
  providers,
  existing,
  onCancel,
  onAdd,
}: {
  providers: ProviderInfo[];
  existing: Record<ProviderId, ProviderAccount[]>;
  onCancel: () => void;
  onAdd: (provider: ProviderId, account: string, creds: { baseUrl?: string; apiKey?: string }) => void;
}) {
  const [provider, setProvider] = useState<ProviderId>(providers[0]?.id ?? "");
  const [account, setAccount] = useState("default");
  const [baseUrl, setBaseUrl] = useState("");
  const [apiKey, setApiKey] = useState("");
  const info = providers.find((p) => p.id === provider);

  // Base URL is user-relevant only for self-hosted/compatible providers; cloud
  // providers (needsApiKey) have a fixed endpoint. The API key field shows
  // whenever the provider supports one.
  const showBaseUrl = !!info?.baseUrlEnv && !info.needsApiKey;
  const showApiKey = !!info?.apiKeyEnv;
  const baseUrlRequired = showBaseUrl && !info?.defaultBaseUrl; // compatible: no default
  const apiKeyRequired = !!info?.needsApiKey;
  const incomplete = (baseUrlRequired && !baseUrl.trim()) || (apiKeyRequired && !apiKey.trim());

  // Suggest a non-clashing account label + reset creds when the provider changes.
  useEffect(() => {
    const taken = (existing[provider] ?? []).map((a) => a.account);
    let label = taken.includes("default") ? "personal" : "default";
    let n = 2;
    while (taken.includes(label)) label = `account-${n++}`;
    setAccount(label);
    setBaseUrl("");
    setApiKey("");
  }, [provider, existing]);

  return (
    <div style={panel}>
      <Field label="Provider">
        <select value={provider} onChange={(e) => setProvider(e.target.value)} style={input}>
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Account name">
        <input value={account} onChange={(e) => setAccount(e.target.value)} style={input} />
      </Field>
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
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button
          onClick={() => onAdd(provider, account, { baseUrl, apiKey })}
          disabled={!provider || incomplete}
          style={primary}
        >
          Add provider
        </button>
        <TestConnection
          onTest={() => {
            const secrets: Record<string, string> = {};
            if (info?.apiKeyEnv && apiKey.trim()) secrets[info.apiKeyEnv] = apiKey.trim();
            if (info?.baseUrlEnv && baseUrl.trim()) secrets[info.baseUrlEnv] = baseUrl.trim();
            return testProviderConnection(provider, { secrets });
          }}
        />
        <button onClick={onCancel} style={ghostButton}>
          Cancel
        </button>
      </div>
    </div>
  );
}

function AccountCard({
  info,
  providerLabel,
  account,
  canDelete,
  onRename,
  onPatch,
  onDelete,
}: {
  info: ProviderInfo;
  /** Provider label shown as a prefix (flat list spans multiple providers). */
  providerLabel?: string;
  account: ProviderAccount;
  canDelete: boolean;
  onRename: (name: string) => void;
  onPatch: (p: Partial<ProviderAccount>) => void;
  onDelete: () => void;
}) {
  const configured = isAccountConfigured(info, account);
  const isOAuth = info.id === "openai" && account.authMethod === "oauth";

  return (
    <div style={accountCard}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {providerLabel && (
          <span style={{ fontSize: 13, fontWeight: 600, whiteSpace: "nowrap" }}>
            {providerLabel} ·
          </span>
        )}
        <input
          value={account.account}
          onChange={(e) => onRename(e.target.value)}
          style={{ ...input, flex: 1 }}
          aria-label="account name"
        />
        <span style={badge} title={account.apiKeyHint ? "Assigned API key" : undefined}>
          {isOAuth
            ? "OAuth"
            : account.apiKeyHint
              ? account.apiKeyHint
              : configured
                ? "Configured"
                : "Incomplete"}
        </span>
        {canDelete && (
          <button onClick={onDelete} style={{ ...ghostButton, color: "#f87171" }}>
            Delete
          </button>
        )}
      </div>

      {info.id === "openai" && (
        <Field label="Authentication">
          <select
            value={account.authMethod ?? "api-key"}
            onChange={(e) =>
              onPatch({ authMethod: e.target.value as "api-key" | "oauth" })
            }
            style={input}
          >
            <option value="api-key">API key</option>
            <option value="oauth">ChatGPT OAuth</option>
          </select>
        </Field>
      )}

      {isOAuth ? (
        <OpenAiOAuthControls />
      ) : (
        <>
          {info.baseUrlEnv && (
            <Field label="Base URL">
              <input
                value={account.baseUrl}
                onChange={(e) => onPatch({ baseUrl: e.target.value })}
                placeholder={info.defaultBaseUrl || "https://…/v1"}
                style={input}
              />
            </Field>
          )}
          {info.apiKeyEnv && (
            <Field label={`${info.label} API key`}>
              <input
                type="password"
                placeholder={
                  account.apiKeyConfigured
                    ? "Leave blank to keep existing key"
                    : info.needsApiKey
                      ? "API key"
                      : "Optional"
                }
                onChange={(e) => onPatch({ apiKey: e.target.value })}
                style={input}
              />
            </Field>
          )}
          <TestConnection
            onTest={() => {
              // Send any typed (unsaved) creds as overrides; the server uses the
              // account's stored credentials as the base.
              const secrets: Record<string, string> = {};
              if (info.apiKeyEnv && account.apiKey?.trim()) secrets[info.apiKeyEnv] = account.apiKey.trim();
              if (info.baseUrlEnv && account.baseUrl?.trim()) secrets[info.baseUrlEnv] = account.baseUrl.trim();
              return testProviderConnection(info.id, { account: account.account, secrets });
            }}
          />
        </>
      )}
    </div>
  );
}

function BuiltinEmbedderPanel() {
  return (
    <div style={panel}>
      <strong style={{ fontSize: 14 }}>Built-in Embedder</strong>
      <p style={hint}>
        A zero-setup embedding model that runs on your CPU — no API key, no server. Needed only for
        agents whose embedding provider is "builtin". The model (~30 MB) downloads on demand.
      </p>
      <BuiltinEmbedderControls />
    </div>
  );
}

// --- Models tab -----------------------------------------------------------

/** A (provider, account) pair the user can attach a model to. */
interface AccountOption {
  provider: ProviderId;
  account: string;
  label: string;
}

/**
 * The model registry — the named models agents pick from. Each is tied to one
 * configured provider account; agents reference them by id, so editing one
 * propagates to every agent using it. ★ marks the defaults for new agents.
 */
function ModelsTab({
  draft,
  patch,
  providers,
}: {
  draft: GlobalSettingsShape;
  patch: PatchFn;
  providers: ProviderInfo[];
}) {
  // Which agents reference each model id (for "Used by" + delete warnings).
  const [usage, setUsage] = useState<Map<string, string[]>>(new Map());
  useEffect(() => {
    void apiFetch("/api/agents")
      .then((r) => (r.ok ? (r.json() as Promise<{ id: string }[]>) : []))
      .then((list) =>
        Promise.all(
          list.map((a) =>
            apiFetch(`/api/agents/${a.id}`)
              .then((r) =>
                r.ok
                  ? (r.json() as Promise<{ displayName: string; model: { chat: string; embedding: string } }>)
                  : null
              )
              .catch(() => null)
          )
        )
      )
      .then((profiles) => {
        const map = new Map<string, string[]>();
        for (const p of profiles ?? []) {
          if (!p) continue;
          for (const id of [p.model.chat, p.model.embedding]) {
            if (!id) continue;
            const list = map.get(id) ?? [];
            if (!list.includes(p.displayName)) list.push(p.displayName);
            map.set(id, list);
          }
        }
        setUsage(map);
      })
      .catch(() => {});
  }, []);

  const providerLabel = (id: ProviderId) => providers.find((p) => p.id === id)?.label ?? id;

  // Every (provider, account) pair the user has configured — the link between a
  // model and its provider.
  const accountOptions = useMemo<AccountOption[]>(() => {
    const out: AccountOption[] = [];
    for (const info of providers) {
      for (const acc of draft.providers[info.id] ?? []) {
        out.push({ provider: info.id, account: acc.account, label: `${info.label} · ${acc.account}` });
      }
    }
    return out;
  }, [providers, draft.providers]);

  const updateModel = (id: string, p: Partial<ConfiguredModel>) =>
    patch({ models: draft.models.map((m) => (m.id === id ? { ...m, ...p } : m)) });

  const deleteModel = (m: ConfiguredModel) => {
    const users = usage.get(m.id) ?? [];
    const warn = users.length
      ? `"${m.label}" is used by ${users.join(", ")}. Those agents will have no ${m.kind} model until you pick another. Delete anyway?`
      : `Delete "${m.label}"?`;
    if (!window.confirm(warn)) return;
    patch({
      models: draft.models.filter((x) => x.id !== m.id),
      ...(draft.defaultChatModelId === m.id ? { defaultChatModelId: "" } : {}),
      ...(draft.defaultEmbeddingModelId === m.id ? { defaultEmbeddingModelId: "" } : {}),
    });
  };

  const addModel = (model: ConfiguredModel) => patch({ models: [...draft.models, model] });

  const [adding, setAdding] = useState(false);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section style={section}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={h2}>Models</h2>
          <button
            onClick={() => setAdding(true)}
            style={ghostButton}
            disabled={accountOptions.length === 0}
          >
            + Add model
          </button>
        </div>
        <p style={hint}>
          Named models your agents pick from — each tied to a configured provider account. ★ marks
          the defaults for new agents. Editing a model updates every agent using it.
        </p>
        {accountOptions.length === 0 && (
          <p style={hint}>Configure a provider first (Providers tab) before adding a model.</p>
        )}

        {adding && (
          <AddModelWizard
            accounts={accountOptions}
            existingIds={draft.models.map((m) => m.id)}
            onCancel={() => setAdding(false)}
            onAdd={(m) => {
              addModel(m);
              setAdding(false);
            }}
          />
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {draft.models.length === 0 && !adding && <p style={hint}>No models configured yet.</p>}
          {draft.models.map((m) => (
            <ModelCard
              key={m.id}
              model={m}
              accounts={accountOptions}
              providerLabel={providerLabel(m.provider)}
              usedBy={usage.get(m.id) ?? []}
              isDefaultChat={draft.defaultChatModelId === m.id}
              isDefaultEmbedding={draft.defaultEmbeddingModelId === m.id}
              onPatch={(p) => updateModel(m.id, p)}
              onMakeDefault={() =>
                patch(
                  m.kind === "chat"
                    ? { defaultChatModelId: m.id }
                    : { defaultEmbeddingModelId: m.id }
                )
              }
              onDelete={() => deleteModel(m)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function ModelCard({
  model,
  accounts,
  providerLabel,
  usedBy,
  isDefaultChat,
  isDefaultEmbedding,
  onPatch,
  onMakeDefault,
  onDelete,
}: {
  model: ConfiguredModel;
  accounts: AccountOption[];
  providerLabel: string;
  usedBy: string[];
  isDefaultChat: boolean;
  isDefaultEmbedding: boolean;
  onPatch: (p: Partial<ConfiguredModel>) => void;
  onMakeDefault: () => void;
  onDelete: () => void;
}) {
  const isDefault = isDefaultChat || isDefaultEmbedding;
  return (
    <div style={accountCard}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={model.label}
          onChange={(e) => onPatch({ label: e.target.value })}
          style={{ ...input, flex: 1 }}
          aria-label="model name"
        />
        <span style={badge}>{model.kind}</span>
        <button
          onClick={onMakeDefault}
          title={`Default ${model.kind} model for new agents`}
          style={{ ...starButton, color: isDefault ? "rgb(var(--accent))" : undefined }}
        >
          {isDefault ? "★ default" : "☆ default"}
        </button>
        <button onClick={onDelete} style={{ ...ghostButton, color: "#f87171" }}>
          Delete
        </button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Field label="Provider account">
          <select
            value={`${model.provider}|${model.account}`}
            onChange={(e) => {
              const [provider, account] = e.target.value.split("|");
              onPatch({ provider, account });
            }}
            style={{ ...input, minWidth: 200 }}
          >
            {/* Keep the current pairing selectable even if its account was removed. */}
            {!accounts.some((a) => a.provider === model.provider && a.account === model.account) && (
              <option value={`${model.provider}|${model.account}`}>
                {providerLabel} · {model.account}
              </option>
            )}
            {accounts.map((a) => (
              <option key={`${a.provider}|${a.account}`} value={`${a.provider}|${a.account}`}>
                {a.label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Model id">
          <input
            value={model.modelId}
            onChange={(e) => onPatch({ modelId: e.target.value })}
            style={{ ...input, minWidth: 200 }}
          />
        </Field>
        {model.kind === "chat" && (
          <Field label="Context window">
            <input
              type="number"
              min={0}
              step={1000}
              value={model.contextWindow ?? ""}
              placeholder="default"
              onChange={(e) => {
                const v = Math.max(0, Math.round(Number(e.target.value) || 0));
                onPatch({ contextWindow: v > 0 ? v : undefined });
              }}
              style={{ ...input, width: 130 }}
            />
          </Field>
        )}
      </div>
      {usedBy.length > 0 && (
        <span style={{ fontSize: 11, color: "rgb(var(--muted))" }}>Used by {usedBy.join(", ")}</span>
      )}
    </div>
  );
}

/** Inline form to register a new configured model. */
/**
 * Two-step "add model" wizard: pick a provider account, fetch the models it
 * serves, then assign one (model id + kind + name). Falls back to manual entry
 * if the provider can't list models.
 */
function AddModelWizard({
  accounts,
  existingIds,
  onCancel,
  onAdd,
}: {
  accounts: AccountOption[];
  existingIds: string[];
  onCancel: () => void;
  onAdd: (model: ConfiguredModel) => void;
}) {
  const [stepName, setStepName] = useState<"provider" | "model">("provider");
  const [pair, setPair] = useState(`${accounts[0]?.provider ?? ""}|${accounts[0]?.account ?? ""}`);
  const [provider, account] = pair.split("|");
  const accountLabel = accounts.find((a) => a.provider === provider && a.account === account)?.label;

  const [models, setModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [note, setNote] = useState("");

  const [modelId, setModelId] = useState("");
  const [kind, setKind] = useState<"chat" | "embedding">("chat");
  const [label, setLabel] = useState("");
  const [contextWindow, setContextWindow] = useState("");

  /** Fetch the models this provider account serves; safe to call repeatedly. */
  const listModels = async () => {
    setFetching(true);
    setNote("");
    setModels([]);
    try {
      const res = await apiFetch("/api/provider-models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider, account }),
      });
      const data = (await res.json()) as { ok: boolean; models?: string[]; error?: string };
      if (data.ok && data.models?.length) {
        const list = data.models;
        setModels(list);
        // Default to the first model only when nothing's been typed yet, so a
        // re-fetch never clobbers a custom id the user entered.
        setModelId((cur) => cur.trim() || list[0]);
        setNote(`Found ${list.length} model(s).`);
      } else {
        setNote(`${data.error ?? "Couldn't list models"} — enter a model id manually.`);
      }
    } catch (err) {
      setNote(`${err instanceof Error ? err.message : String(err)} — enter a model id manually.`);
    } finally {
      setFetching(false);
    }
  };

  const goToModelStep = async () => {
    await listModels();
    setStepName("model");
  };

  const submit = () => {
    const cw = Math.max(0, Math.round(Number(contextWindow) || 0));
    onAdd({
      id: uniqueModelId(existingIds, label || modelId),
      label: label.trim() || modelId.trim(),
      provider,
      account,
      modelId: modelId.trim(),
      kind,
      ...(kind === "chat" && cw > 0 ? { contextWindow: cw } : {}),
    });
  };

  if (stepName === "provider") {
    return (
      <div style={panel}>
        <strong style={{ fontSize: 13 }}>Add a model · 1. Choose a provider</strong>
        <Field label="Provider account">
          <select value={pair} onChange={(e) => setPair(e.target.value)} style={input}>
            {accounts.map((a) => (
              <option key={`${a.provider}|${a.account}`} value={`${a.provider}|${a.account}`}>
                {a.label}
              </option>
            ))}
          </select>
        </Field>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={() => void goToModelStep()} disabled={!provider || fetching} style={primary}>
            {fetching ? "Fetching models…" : "Next"}
          </button>
          <button onClick={onCancel} style={ghostButton}>
            Cancel
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={panel}>
      <strong style={{ fontSize: 13 }}>Add a model · 2. Assign {accountLabel ? `(${accountLabel})` : ""}</strong>
      {note && <span style={{ fontSize: 12, color: "rgb(var(--muted))" }}>{note}</span>}
      <Field label="Model">
        <input
          list="add-model-options"
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          placeholder="provider-specific model id"
          style={input}
        />
        <datalist id="add-model-options">
          {models.map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <span style={{ color: "rgb(var(--muted))", fontSize: 11 }}>
          Type a model id, or click "List models" and pick one from the dropdown.
        </span>
      </Field>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={() => void listModels()} disabled={fetching} style={ghostButton}>
          {fetching ? "Listing…" : "List models"}
        </button>
      </div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <Field label="Kind">
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as "chat" | "embedding")}
            style={{ ...input, width: 140 }}
          >
            <option value="chat">chat</option>
            <option value="embedding">embedding</option>
          </select>
        </Field>
        <Field label="Name">
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={modelId || "display name"}
            style={{ ...input, minWidth: 180 }}
          />
        </Field>
        {kind === "chat" && (
          <Field label="Context window">
            <input
              type="number"
              min={0}
              step={1000}
              value={contextWindow}
              onChange={(e) => setContextWindow(e.target.value)}
              placeholder="default"
              style={{ ...input, width: 130 }}
            />
          </Field>
        )}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={submit} disabled={!modelId.trim()} style={primary}>
          Add model
        </button>
        <button onClick={() => setStepName("provider")} style={ghostButton}>
          Back
        </button>
        <button onClick={onCancel} style={ghostButton}>
          Cancel
        </button>
      </div>
    </div>
  );
}

// --- Account tab ----------------------------------------------------------

const MIN_PASSWORD = 8;

function AccountTab() {
  const [sessions, setSessions] = useState<SessionList | null>(null);
  const [error, setError] = useState("");

  const refresh = async () => {
    setSessions(await listSessions());
  };

  useEffect(() => {
    void refresh();
  }, []);

  const revoke = async (id: string) => {
    setError("");
    const wasCurrent = sessions?.sessions.find((s) => s.id === id)?.current;
    const ok = await revokeSession(id);
    if (!ok) {
      setError("Could not revoke that session.");
      return;
    }
    if (wasCurrent) {
      // Server cleared our cookie + invalidated our token; reload so the
      // AuthGate sends us back to the login screen.
      window.location.reload();
      return;
    }
    void refresh();
  };

  const signOut = async () => {
    await logout();
    window.location.reload();
  };

  if (!sessions) {
    return (
      <section style={section}>
        <h2 style={h2}>Account</h2>
        <p style={hint}>Loading…</p>
      </section>
    );
  }

  if (sessions.mode === "env") {
    return (
      <section style={section}>
        <h2 style={h2}>Account</h2>
        <p style={hint}>
          API auth is pinned by the <code>OTTERBOT_API_TOKEN</code> environment variable on the
          server. Sessions and password change are disabled in this mode — manage credentials by
          updating the env var and restarting otterbot.
        </p>
      </section>
    );
  }

  return (
    <section style={section}>
      <h2 style={h2}>Active sessions</h2>
      <p style={hint}>
        Every device that's logged in gets its own session token. Revoking a session immediately
        signs that device out.
      </p>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {sessions.sessions.length === 0 && <p style={hint}>No active sessions.</p>}
        {sessions.sessions.map((s) => (
          <SessionRow key={s.id} session={s} onRevoke={() => void revoke(s.id)} />
        ))}
      </div>
      {error && <span style={{ fontSize: 12, color: "#f87171" }}>{error}</span>}

      <div style={{ height: 12 }} />
      <ChangePasswordCard onChanged={() => void refresh()} />

      <div style={{ height: 12 }} />
      <button onClick={() => void signOut()} style={ghostButton}>
        Sign out this device
      </button>
    </section>
  );
}

function SessionRow({
  session,
  onRevoke,
}: {
  session: SessionInfo;
  onRevoke: () => void;
}) {
  return (
    <div
      style={{
        border: "1px solid rgb(var(--border))",
        borderRadius: 8,
        padding: "10px 12px",
        display: "flex",
        alignItems: "center",
        gap: 12,
      }}
    >
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2 }}>
        <span style={{ fontSize: 13, fontWeight: 600 }}>
          {session.label}
          {session.current && (
            <span
              style={{
                marginLeft: 8,
                fontSize: 10,
                color: "#4ade80",
                border: "1px solid #4ade80",
                borderRadius: 4,
                padding: "1px 6px",
              }}
            >
              this device
            </span>
          )}
        </span>
        <span style={{ ...hint, fontSize: 11 }}>
          last used {formatRelative(session.lastUsedAt)} · created {formatRelative(session.createdAt)}
        </span>
      </div>
      <button onClick={onRevoke} style={{ ...ghostButton, color: "#f87171" }}>
        {session.current ? "Sign out" : "Revoke"}
      </button>
    </div>
  );
}

function ChangePasswordCard({ onChanged }: { onChanged: () => void }) {
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [ok, setOk] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setOk(false);
    if (next.length < MIN_PASSWORD) {
      setError(`New password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (next !== confirm) {
      setError("New passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const result = await changePassword(current, next);
      if (!result.ok) {
        setError(result.error ?? "Could not change password.");
        return;
      }
      setCurrent("");
      setNext("");
      setConfirm("");
      setOk(true);
      onChanged();
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={submit}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        border: "1px solid rgb(var(--border))",
        borderRadius: 8,
        padding: 12,
      }}
    >
      <h2 style={h2}>Change password</h2>
      <p style={hint}>
        Changing the password signs out every other device — only this session keeps working.
      </p>
      <input
        type="password"
        value={current}
        onChange={(e) => setCurrent(e.target.value)}
        placeholder="Current password"
        style={inputStyle}
      />
      <input
        type="password"
        value={next}
        onChange={(e) => setNext(e.target.value)}
        placeholder={`New password (≥ ${MIN_PASSWORD} chars)`}
        style={inputStyle}
      />
      <input
        type="password"
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        placeholder="Confirm new password"
        style={inputStyle}
      />
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button
          type="submit"
          disabled={busy || !current || next.length < MIN_PASSWORD || !confirm}
          style={primary}
        >
          {busy ? "Saving…" : "Change password"}
        </button>
        {ok && <span style={{ fontSize: 12, color: "#4ade80" }}>Password updated ✓</span>}
        {error && <span style={{ fontSize: 12, color: "#f87171" }}>{error}</span>}
      </div>
    </form>
  );
}

const inputStyle: React.CSSProperties = {
  background: "rgb(var(--bg))",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: "7px 9px",
  fontSize: 13,
};

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 0) return "just now";
  const min = Math.round(diff / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.round(hr / 24);
  return `${day} day${day === 1 ? "" : "s"} ago`;
}

// --- Appearance tab -------------------------------------------------------

function AppearanceTab({ draft, patch }: { draft: GlobalSettingsShape; patch: PatchFn }) {
  const themeOptions = useMemo(() => Object.keys(THEMES) as ThemeId[], []);
  return (
    <section style={section}>
      <h2 style={h2}>Theme</h2>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {themeOptions.map((theme) => (
          <button
            key={theme}
            data-testid={`theme-${theme}`}
            onClick={() => {
              patch({ theme });
              applyTheme(theme);
            }}
            style={{
              ...themeButton,
              borderColor: draft.theme === theme ? "rgb(var(--accent))" : "rgb(var(--border))",
            }}
          >
            <span style={{ ...swatch, background: `rgb(${THEMES[theme].vars["--accent"]})` }} />
            {THEMES[theme].label}
          </button>
        ))}
      </div>
    </section>
  );
}

// --- OAuth controls (used inside an OpenAI account card) ------------------

function OpenAiOAuthControls() {
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
        agent or per provider account.
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

// --- shared helpers / styles ----------------------------------------------

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5, fontSize: 12 }}>
      <span style={{ color: "rgb(var(--muted))" }}>{label}</span>
      {children}
    </label>
  );
}

const page: React.CSSProperties = {
  height: "100%",
  display: "flex",
  flexDirection: "column",
  minHeight: 0,
};

const header: React.CSSProperties = {
  padding: "14px 18px 0",
};

const tabBar: React.CSSProperties = {
  display: "flex",
  gap: 4,
  padding: "10px 18px",
  borderBottom: "1px solid rgb(var(--border))",
  flexWrap: "wrap",
};

const tabButton: React.CSSProperties = {
  border: "1px solid rgb(var(--border))",
  padding: "4px 12px",
  borderRadius: 6,
  cursor: "pointer",
  fontSize: 12,
};

const tabBody: React.CSSProperties = {
  flex: 1,
  minHeight: 0,
  overflowY: "auto",
  padding: 18,
};

const saveBar: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 12,
  padding: "10px 18px",
  borderTop: "1px solid rgb(var(--border))",
  background: "rgb(var(--bg))",
};

const section: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 10,
};

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

const accountCard: React.CSSProperties = {
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: 10,
  display: "flex",
  flexDirection: "column",
  gap: 8,
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
  width: "100%",
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
  padding: "7px 11px",
  cursor: "pointer",
  fontSize: 13,
};

const themeButton: React.CSSProperties = {
  background: "transparent",
  color: "rgb(var(--fg))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 7,
  padding: "7px 10px",
  cursor: "pointer",
  fontSize: 13,
  display: "flex",
  alignItems: "center",
  gap: 8,
};

const swatch: React.CSSProperties = {
  width: 14,
  height: 14,
  borderRadius: 999,
  border: "1px solid rgb(var(--border))",
};

const badge: React.CSSProperties = {
  border: "1px solid rgb(var(--border))",
  borderRadius: 999,
  padding: "2px 7px",
  fontSize: 11,
  color: "rgb(var(--muted))",
};

const starButton: React.CSSProperties = {
  background: "transparent",
  border: "1px solid rgb(var(--border))",
  borderRadius: 6,
  padding: "3px 5px",
  cursor: "pointer",
  fontSize: 11,
};
