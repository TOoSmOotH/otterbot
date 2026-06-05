import { useEffect, useMemo, useState } from "react";
import type {
  ConfiguredModel,
  GlobalSettings as GlobalSettingsShape,
  ProviderAccount,
  ProviderId,
  ProviderInfo,
} from "@otterbot/shared";
import { apiFetch } from "../../lib/api";
import { isAccountConfigured } from "../../stores/providers-store";
import { BuiltinEmbedderControls } from "../BuiltinEmbedderControls";
import { Modal } from "../Modal";
import {
  Field,
  accountCard,
  badge,
  ghostButton,
  h2,
  hint,
  input,
  panel,
  section,
  starButton,
} from "./settings-styles";
import { TestConnection, isAccountVisible, testProviderConnection } from "./provider-test";
import { OpenAiOAuthControls } from "./OpenAiOAuthControls";
import { ProviderWizard, type ProviderCreds } from "./ProviderWizard";
import { ModelWizard, type AccountOption } from "./ModelWizard";

type PatchFn = (p: Partial<GlobalSettingsShape>) => void;

/**
 * The unified "Models & Providers" tab. Provider accounts and named models live
 * together: configure a provider (with credentials), then register models that
 * reference it. Both "add" flows open modal wizards; the model wizard can create
 * a provider inline and continue without leaving the modal.
 */
export function ModelsProvidersTab({
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
  const credentialProviders = useMemo(
    () => providers.filter((p) => p.needsApiKey || p.baseUrlEnv),
    [providers]
  );
  const byId = useMemo(
    () => new Map(credentialProviders.map((p) => [p.id, p])),
    [credentialProviders]
  );

  const [addingProvider, setAddingProvider] = useState(false);
  const [addingModel, setAddingModel] = useState(false);

  // --- Provider accounts ---------------------------------------------------

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

  /**
   * Create or update a provider account and persist immediately. Auto-saving is
   * required because model listing reads server-stored secrets, not the draft;
   * the model wizard awaits this before listing the new provider's models.
   */
  const commitProvider = async (
    providerId: ProviderId,
    accountName: string,
    creds: ProviderCreds
  ) => {
    const info = byId.get(providerId);
    if (!info) return;
    const accounts = draft.providers[providerId] ?? [];
    const label = accountName.trim() || "default";
    const patchValue: Partial<ProviderAccount> = {
      ...(creds.baseUrl?.trim() ? { baseUrl: creds.baseUrl.trim() } : {}),
      ...(creds.apiKey?.trim() ? { apiKey: creds.apiKey.trim() } : {}),
      ...(creds.authMethod
        ? { authMethod: creds.authMethod }
        : info.id === "openai"
          ? { authMethod: "api-key" as const }
          : {}),
    };
    const existing = accounts.findIndex((a) => a.account === label);
    const nextAccounts =
      existing >= 0
        ? accounts.map((a, i) => (i === existing ? { ...a, ...patchValue } : a))
        : [
            ...accounts,
            { account: label, baseUrl: info.defaultBaseUrl ?? "", apiKeyConfigured: false, ...patchValue },
          ];
    await onCommit({ ...draft, providers: { ...draft.providers, [providerId]: nextAccounts } });
  };

  // --- Models --------------------------------------------------------------

  const providerLabel = (id: ProviderId) => providers.find((p) => p.id === id)?.label ?? id;

  const accountOptions = useMemo<AccountOption[]>(() => {
    const out: AccountOption[] = [];
    for (const info of providers) {
      for (const acc of draft.providers[info.id] ?? []) {
        out.push({ provider: info.id, account: acc.account, label: `${info.label} · ${acc.account}` });
      }
    }
    return out;
  }, [providers, draft.providers]);

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
            const l = map.get(id) ?? [];
            if (!l.includes(p.displayName)) l.push(p.displayName);
            map.set(id, l);
          }
        }
        setUsage(map);
      })
      .catch(() => {});
  }, []);

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

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* Providers */}
      <section style={section}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={h2}>Model Providers</h2>
          <button onClick={() => setAddingProvider(true)} style={ghostButton}>
            + Add provider
          </button>
        </div>
        <p style={hint}>
          The provider accounts you've configured. Add another to use a new provider or a second key
          for the same one (e.g. personal + work). Models reference these by name.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {cards.length === 0 && (
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

      {/* Models */}
      <section style={section}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <h2 style={h2}>Models</h2>
          <button onClick={() => setAddingModel(true)} style={ghostButton}>
            + Add model
          </button>
        </div>
        <p style={hint}>
          Named models your agents pick from — each tied to a configured provider account. ★ marks
          the defaults for new agents. Editing a model updates every agent using it.
        </p>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {draft.models.length === 0 && <p style={hint}>No models configured yet.</p>}
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

      <section style={section}>
        <BuiltinEmbedderPanel />
      </section>

      {addingProvider && (
        <Modal title="Add a provider" onClose={() => setAddingProvider(false)}>
          <ProviderWizard
            providers={credentialProviders}
            existing={draft.providers}
            onCommitProvider={commitProvider}
            onDone={() => setAddingProvider(false)}
            onCancel={() => setAddingProvider(false)}
          />
        </Modal>
      )}

      {addingModel && (
        <Modal title="Add a model" onClose={() => setAddingModel(false)}>
          <ModelWizard
            accounts={accountOptions}
            existingIds={draft.models.map((m) => m.id)}
            providers={providers}
            existingProviderAccounts={draft.providers}
            onCommitProvider={commitProvider}
            onAdd={(m) => {
              addModel(m);
              setAddingModel(false);
            }}
            onCancel={() => setAddingModel(false)}
          />
        </Modal>
      )}
    </div>
  );
}

// --- Account card ----------------------------------------------------------

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
          <button onClick={onDelete} style={{ ...ghostButton, color: "rgb(var(--danger))" }}>
            Delete
          </button>
        )}
      </div>

      {info.id === "openai" && (
        <Field label="Authentication">
          <select
            value={account.authMethod ?? "api-key"}
            onChange={(e) => onPatch({ authMethod: e.target.value as "api-key" | "oauth" })}
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

// --- Model card ------------------------------------------------------------

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
        <button onClick={onDelete} style={{ ...ghostButton, color: "rgb(var(--danger))" }}>
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
