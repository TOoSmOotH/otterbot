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
  AgentProfileSummary,
  GlobalSettings as GlobalSettingsShape,
  ModelRef,
  ProviderAccount,
  ProviderId,
  ProviderInfo,
  ThemeId,
} from "@otterbot/shared";
import { THEMES, useGlobalSettingsStore, applyTheme } from "../../stores/global-settings-store";
import {
  useProvidersStore,
  providerCredField,
  isAccountConfigured,
} from "../../stores/providers-store";
import { BuiltinEmbedderControls } from "../BuiltinEmbedderControls";

type OpenAiAuthStatus = { connected: boolean; accountId: string | null };

const TABS = ["Providers", "Models", "Appearance", "Account"] as const;
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
        {tab === "Providers" && <ProvidersTab draft={draft} patch={patch} providers={providers} />}
        {tab === "Models" && <ModelsTab draft={draft} patch={patch} providers={providers} />}
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

/**
 * Provider credentials — the foundation everything else depends on. Each
 * provider type has its own panel containing one or more named "accounts"
 * (credential sets), plus "Add account" to add another.
 */
function ProvidersTab({
  draft,
  patch,
  providers,
}: {
  draft: GlobalSettingsShape;
  patch: PatchFn;
  providers: ProviderInfo[];
}) {
  // Providers with something to configure (the built-in embedder has nothing).
  const credentialProviders = providers.filter((p) => p.needsApiKey || p.baseUrlEnv);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      <section style={section}>
        <h2 style={h2}>Model Providers</h2>
        <p style={hint}>
          Configure one or more accounts per provider — useful when you have multiple keys for the
          same provider (e.g. personal + work). Each agent's model picker selects which account it
          uses.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {credentialProviders.length === 0 && <p style={hint}>Loading providers…</p>}
          {credentialProviders.map((p) => (
            <ProviderPanel key={p.id} info={p} draft={draft} patch={patch} />
          ))}
          <BuiltinEmbedderPanel />
        </div>
      </section>
    </div>
  );
}

function ProviderPanel({
  info,
  draft,
  patch,
}: {
  info: ProviderInfo;
  draft: GlobalSettingsShape;
  patch: PatchFn;
}) {
  const accounts = draft.providers[info.id] ?? [];
  const credMeta = providerCredField(info);

  const updateAccounts = (next: ProviderAccount[]) => {
    patch({ providers: { ...draft.providers, [info.id]: next } });
  };

  const updateAccount = (index: number, patchValue: Partial<ProviderAccount>) => {
    updateAccounts(accounts.map((a, i) => (i === index ? { ...a, ...patchValue } : a)));
  };

  const renameAccount = (index: number, nextName: string) => {
    const trimmed = nextName.trim() || `account-${index + 1}`;
    // Disallow duplicates by appending a suffix.
    let unique = trimmed;
    let n = 2;
    while (accounts.some((a, i) => i !== index && a.account === unique)) unique = `${trimmed}-${n++}`;
    const oldName = accounts[index].account;
    updateAccounts(accounts.map((a, i) => (i === index ? { ...a, account: unique } : a)));
    // Rewrite ModelRefs that named the old account so they keep pointing at it.
    if (oldName !== unique) {
      const fixRef = (r: ModelRef): ModelRef =>
        r.provider === info.id && r.account === oldName ? { ...r, account: unique } : r;
      patch({
        defaultChatModel: fixRef(draft.defaultChatModel),
        defaultEmbeddingModel: fixRef(draft.defaultEmbeddingModel),
      });
    }
  };

  const addAccount = () => {
    let label = "personal";
    let i = 2;
    while (accounts.some((a) => a.account === label)) label = `account-${i++}`;
    const next: ProviderAccount = {
      account: label,
      baseUrl: info.defaultBaseUrl ?? "",
      apiKeyConfigured: false,
      ...(info.id === "openai" ? { authMethod: "api-key" as const } : {}),
    };
    updateAccounts([...accounts, next]);
  };

  const deleteAccount = (index: number) => {
    if (accounts.length === 1) return; // keep at least one slot
    updateAccounts(accounts.filter((_, i) => i !== index));
  };

  return (
    <div style={panel}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <strong style={{ fontSize: 14 }}>{info.label}</strong>
        <button onClick={addAccount} style={ghostButton}>
          + Add account
        </button>
      </div>
      {accounts.length === 0 && (
        <p style={hint}>No accounts configured yet — add one to use this provider.</p>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {accounts.map((acc, i) => (
          <AccountCard
            key={`${i}-${acc.account}`}
            info={info}
            account={acc}
            canDelete={accounts.length > 1}
            credMeta={credMeta}
            onRename={(name) => renameAccount(i, name)}
            onPatch={(p) => updateAccount(i, p)}
            onDelete={() => deleteAccount(i)}
          />
        ))}
      </div>
    </div>
  );
}

function AccountCard({
  info,
  account,
  canDelete,
  credMeta,
  onRename,
  onPatch,
  onDelete,
}: {
  info: ProviderInfo;
  account: ProviderAccount;
  canDelete: boolean;
  credMeta: ReturnType<typeof providerCredField>;
  onRename: (name: string) => void;
  onPatch: (p: Partial<ProviderAccount>) => void;
  onDelete: () => void;
}) {
  const configured = isAccountConfigured(info, account);
  const isOAuth = info.id === "openai" && account.authMethod === "oauth";

  return (
    <div style={accountCard}>
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input
          value={account.account}
          onChange={(e) => onRename(e.target.value)}
          style={{ ...input, flex: 1 }}
          aria-label="account name"
        />
        <span style={badge}>
          {isOAuth ? "OAuth" : configured ? "Key saved" : "No key"}
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
                placeholder={info.defaultBaseUrl ?? ""}
                style={input}
              />
            </Field>
          )}
          {info.apiKeyEnv && credMeta && (
            <Field label={credMeta.label}>
              <input
                type="password"
                placeholder={
                  configured ? "Leave blank to keep existing key" : "Optional"
                }
                onChange={(e) => onPatch({ apiKey: e.target.value })}
                style={input}
              />
            </Field>
          )}
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

interface ModelRow {
  provider: ProviderId;
  account: string;
  modelId: string;
  /** Agent display names using this exact (provider, account, model) triple. */
  usedBy: string[];
  /** Whether this row is the default chat / default embedding. */
  isDefaultChat: boolean;
  isDefaultEmbedding: boolean;
  /** Context window from registry (shared by all accounts of same provider+modelId). */
  contextWindow?: number;
}

/**
 * Unified models view — every model in use across all agents, with provider,
 * account, context window, and which agents use it. Star toggles a row as the
 * default chat / embedding for new agents. Context-window edits update the
 * registry (shared across accounts that serve the same model id).
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
  const [agents, setAgents] = useState<AgentProfileSummary[]>([]);
  const [embeddingUsage, setEmbeddingUsage] = useState<Map<string, string[]>>(new Map());

  useEffect(() => {
    void apiFetch("/api/agents")
      .then((r) => (r.ok ? (r.json() as Promise<AgentProfileSummary[]>) : []))
      .then((list) => {
        setAgents(list);
        // Fetch each agent's full profile so we know its embedding model too.
        void Promise.all(
          list.map((a) =>
            apiFetch(`/api/agents/${a.id}`)
              .then((r) =>
                r.ok ? (r.json() as Promise<{ id: string; displayName: string; model: { embedding: ModelRef } }>) : null
              )
              .catch(() => null)
          )
        ).then((profiles) => {
          const map = new Map<string, string[]>();
          for (const p of profiles) {
            if (!p) continue;
            const e = p.model.embedding;
            if (!e?.modelId) continue;
            const key = `${e.provider}|${e.account}|${e.modelId}`;
            const list = map.get(key) ?? [];
            list.push(p.displayName);
            map.set(key, list);
          }
          setEmbeddingUsage(map);
        });
      })
      .catch(() => {});
  }, []);

  const rows = useMemo<ModelRow[]>(() => {
    const byKey = new Map<string, ModelRow>();
    const refDefault: ModelRef = draft.defaultChatModel;
    const refDefaultEmb: ModelRef = draft.defaultEmbeddingModel;
    const cwFor = (provider: ProviderId, modelId: string) =>
      draft.modelContextWindows.find((m) => m.provider === provider && m.modelId === modelId)
        ?.contextWindow;

    const upsert = (provider: ProviderId, account: string, modelId: string, by?: string) => {
      const key = `${provider}|${account}|${modelId}`;
      let row = byKey.get(key);
      if (!row) {
        row = {
          provider,
          account,
          modelId,
          usedBy: [],
          isDefaultChat:
            refDefault.provider === provider &&
            refDefault.account === account &&
            refDefault.modelId === modelId,
          isDefaultEmbedding:
            refDefaultEmb.provider === provider &&
            refDefaultEmb.account === account &&
            refDefaultEmb.modelId === modelId,
          contextWindow: cwFor(provider, modelId),
        };
        byKey.set(key, row);
      }
      if (by && !row.usedBy.includes(by)) row.usedBy.push(by);
    };

    for (const a of agents) {
      const m = a.chatModel;
      if (m?.modelId) upsert(m.provider, m.account || "default", m.modelId, a.displayName);
    }
    for (const [key, users] of embeddingUsage) {
      const [provider, account, modelId] = key.split("|");
      for (const u of users) upsert(provider, account, modelId, u);
    }
    if (refDefault.modelId) upsert(refDefault.provider, refDefault.account, refDefault.modelId);
    if (refDefaultEmb.modelId)
      upsert(refDefaultEmb.provider, refDefaultEmb.account, refDefaultEmb.modelId);
    for (const cw of draft.modelContextWindows) {
      upsert(cw.provider, "*", cw.modelId);
    }

    return [...byKey.values()].sort((a, b) =>
      a.provider === b.provider ? a.modelId.localeCompare(b.modelId) : a.provider.localeCompare(b.provider)
    );
  }, [draft, agents, embeddingUsage]);

  const providerLabel = (id: ProviderId) => providers.find((p) => p.id === id)?.label ?? id;

  const setContextWindow = (provider: ProviderId, modelId: string, value: number) => {
    const rest = draft.modelContextWindows.filter(
      (m) => !(m.provider === provider && m.modelId === modelId)
    );
    patch({
      modelContextWindows:
        value > 0 ? [...rest, { provider, modelId, contextWindow: value }] : rest,
    });
  };

  const setDefaultChat = (row: ModelRow) =>
    patch({ defaultChatModel: { provider: row.provider, account: row.account, modelId: row.modelId } });
  const setDefaultEmbedding = (row: ModelRow) =>
    patch({
      defaultEmbeddingModel: { provider: row.provider, account: row.account, modelId: row.modelId },
    });

  const [adding, setAdding] = useState(false);
  const [newProvider, setNewProvider] = useState<ProviderId>("");
  const [newAccount, setNewAccount] = useState("default");
  const [newModelId, setNewModelId] = useState("");
  const [newWindow, setNewWindow] = useState("");

  const addModel = () => {
    const id = newModelId.trim();
    if (!newProvider || !id) return;
    const window = Math.max(0, Math.round(Number(newWindow) || 0));
    if (window > 0) setContextWindow(newProvider, id, window);
    // Just adding to the list — the row appears next render via cwFor or future agent usage.
    // If the user wants to actually use it, they pick it in the agent's model tab.
    setAdding(false);
    setNewProvider("");
    setNewAccount("default");
    setNewModelId("");
    setNewWindow("");
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <section style={section}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={h2}>Models</h2>
          <button onClick={() => setAdding(true)} style={ghostButton}>
            + Add model
          </button>
        </div>
        <p style={hint}>
          Every model in use across your agents. ★ marks the defaults for new agents — click to
          change. The context window is per-model (shared across accounts of the same provider).
        </p>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ ...modelRowHead }}>
            <span style={{ flex: "0 0 110px" }}>Provider</span>
            <span style={{ flex: "0 0 130px" }}>Account</span>
            <span style={{ flex: 1 }}>Model id</span>
            <span style={{ flex: "0 0 110px" }}>Context window</span>
            <span style={{ flex: "0 0 60px" }}>Defaults</span>
            <span style={{ flex: 2 }}>Used by</span>
          </div>
          {rows.length === 0 && <p style={hint}>No models in use yet.</p>}
          {rows.map((r) => (
            <div key={`${r.provider}|${r.account}|${r.modelId}`} style={modelRow}>
              <span style={{ flex: "0 0 110px", fontSize: 12, color: "rgb(var(--muted))" }}>
                {providerLabel(r.provider)}
              </span>
              <span style={{ flex: "0 0 130px", fontSize: 12 }}>{r.account}</span>
              <strong
                style={{ flex: 1, fontSize: 13, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" }}
                title={r.modelId}
              >
                {r.modelId}
              </strong>
              <input
                type="number"
                min={0}
                step={1000}
                value={r.contextWindow ?? ""}
                placeholder="default"
                onChange={(e) =>
                  setContextWindow(
                    r.provider,
                    r.modelId,
                    Math.max(0, Math.round(Number(e.target.value) || 0))
                  )
                }
                style={{ ...input, flex: "0 0 110px" }}
              />
              <div style={{ flex: "0 0 60px", display: "flex", gap: 4 }}>
                <button
                  onClick={() => setDefaultChat(r)}
                  title="Default chat model"
                  style={{ ...starButton, color: r.isDefaultChat ? "rgb(var(--accent))" : undefined }}
                >
                  ★C
                </button>
                <button
                  onClick={() => setDefaultEmbedding(r)}
                  title="Default embedding model"
                  style={{
                    ...starButton,
                    color: r.isDefaultEmbedding ? "rgb(var(--accent))" : undefined,
                  }}
                >
                  ★E
                </button>
              </div>
              <span style={{ flex: 2, fontSize: 12, color: "rgb(var(--muted))" }}>
                {r.usedBy.length === 0 ? "—" : r.usedBy.join(", ")}
              </span>
            </div>
          ))}

          {adding && (
            <div style={{ ...modelRow, alignItems: "flex-end" }}>
              <select
                value={newProvider}
                onChange={(e) => setNewProvider(e.target.value)}
                style={{ ...input, flex: "0 0 110px" }}
              >
                <option value="">Provider…</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
              <select
                value={newAccount}
                onChange={(e) => setNewAccount(e.target.value)}
                style={{ ...input, flex: "0 0 130px" }}
              >
                {(draft.providers[newProvider] ?? []).map((a) => (
                  <option key={a.account} value={a.account}>
                    {a.account}
                  </option>
                ))}
                {(draft.providers[newProvider] ?? []).length === 0 && (
                  <option value="default">default</option>
                )}
              </select>
              <input
                value={newModelId}
                onChange={(e) => setNewModelId(e.target.value)}
                placeholder="model id"
                style={{ ...input, flex: 1 }}
              />
              <input
                type="number"
                min={0}
                step={1000}
                value={newWindow}
                onChange={(e) => setNewWindow(e.target.value)}
                placeholder="window"
                style={{ ...input, flex: "0 0 110px" }}
              />
              <button onClick={addModel} disabled={!newProvider || !newModelId.trim()} style={primary}>
                Add
              </button>
              <button onClick={() => setAdding(false)} style={ghostButton}>
                Cancel
              </button>
            </div>
          )}
        </div>
      </section>
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

const modelRow: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  padding: "4px 0",
};

const modelRowHead: React.CSSProperties = {
  display: "flex",
  gap: 8,
  fontSize: 11,
  color: "rgb(var(--muted))",
  textTransform: "uppercase",
  letterSpacing: 0.4,
  borderBottom: "1px solid rgb(var(--border))",
  paddingBottom: 4,
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
