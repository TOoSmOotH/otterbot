import { useState } from "react";
import type { ConfiguredModel, ProviderAccount, ProviderId, ProviderInfo } from "@otterbot/shared";
import { apiFetch } from "../../lib/api";
import { uniqueModelId } from "../../lib/model-id";
import { Field, ghostButton, hint, input, primary } from "./settings-styles";
import { ProviderWizard, type ProviderCreds } from "./ProviderWizard";

/** A (provider, account) pair the user can attach a model to. */
export interface AccountOption {
  provider: ProviderId;
  account: string;
  label: string;
}

/**
 * "Add a model" wizard. Steps:
 *  1. account  — pick an existing provider account, or jump to add a new one.
 *  2. provider-subflow — the ProviderWizard, embedded; on completion the new
 *     account is auto-selected and the wizard advances to assignment.
 *  3. assign   — choose model id + kind + name + context window.
 *
 * With no provider accounts configured yet, the wizard opens straight into the
 * provider sub-flow to bootstrap the first one.
 */
export function ModelWizard({
  accounts,
  existingIds,
  providers,
  existingProviderAccounts,
  onCommitProvider,
  onAdd,
  onCancel,
}: {
  accounts: AccountOption[];
  existingIds: string[];
  /** Full provider catalog (filtered to credentialed types for the sub-flow). */
  providers: ProviderInfo[];
  existingProviderAccounts: Record<ProviderId, ProviderAccount[]>;
  onCommitProvider: (provider: ProviderId, account: string, creds: ProviderCreds) => Promise<void>;
  onAdd: (model: ConfiguredModel) => void;
  onCancel: () => void;
}) {
  const hasAccounts = accounts.length > 0;
  const [step, setStep] = useState<"account" | "provider-subflow" | "assign">(
    hasAccounts ? "account" : "provider-subflow"
  );
  const [pair, setPair] = useState(
    `${accounts[0]?.provider ?? ""}|${accounts[0]?.account ?? ""}`
  );
  const [provider, account] = pair.split("|");
  const accountLabel = accounts.find((a) => a.provider === provider && a.account === account)?.label;

  const [models, setModels] = useState<string[]>([]);
  const [fetching, setFetching] = useState(false);
  const [note, setNote] = useState("");

  const [modelId, setModelId] = useState("");
  const [kind, setKind] = useState<"chat" | "embedding">("chat");
  const [label, setLabel] = useState("");
  const [contextWindow, setContextWindow] = useState("");

  const credentialProviders = providers.filter((p) => p.needsApiKey || p.baseUrlEnv);

  /** Fetch the models a provider account serves; safe to call repeatedly. */
  const listModels = async (prov: ProviderId, acc: string) => {
    setFetching(true);
    setNote("");
    setModels([]);
    try {
      const res = await apiFetch("/api/provider-models", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: prov, account: acc }),
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

  const goToAssign = async (prov: ProviderId, acc: string) => {
    setPair(`${prov}|${acc}`);
    setStep("assign");
    await listModels(prov, acc);
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

  if (step === "provider-subflow") {
    return (
      <ProviderWizard
        embedded
        providers={credentialProviders}
        existing={existingProviderAccounts}
        onCommitProvider={onCommitProvider}
        onDone={(created) => {
          if (created) void goToAssign(created.provider, created.account);
          else setStep("account");
        }}
        // Cancelling the sub-flow: back to the picker if we have one, else close.
        onCancel={() => (hasAccounts ? setStep("account") : onCancel())}
      />
    );
  }

  if (step === "account") {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div>
          <strong style={{ fontSize: 13 }}>Add a model · 1. Choose a provider</strong>
          <p style={hint}>Models attach to a configured provider account.</p>
        </div>
        <Field label="Provider account">
          <select value={pair} onChange={(e) => setPair(e.target.value)} style={input}>
            {accounts.map((a) => (
              <option key={`${a.provider}|${a.account}`} value={`${a.provider}|${a.account}`}>
                {a.label}
              </option>
            ))}
          </select>
        </Field>
        <button onClick={() => setStep("provider-subflow")} style={{ ...ghostButton, alignSelf: "flex-start" }}>
          + Add a new provider
        </button>
        <div style={{ display: "flex", gap: 8 }}>
          <button
            onClick={() => void goToAssign(provider, account)}
            disabled={!provider || fetching}
            style={primary}
          >
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
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <strong style={{ fontSize: 13 }}>
        Add a model · 2. Assign {accountLabel ? `(${accountLabel})` : ""}
      </strong>
      {note && <span style={{ fontSize: 12, color: "rgb(var(--muted))" }}>{note}</span>}
      <Field label="Model">
        {models.length > 0 && (
          <select
            value={models.includes(modelId) ? modelId : ""}
            onChange={(e) => setModelId(e.target.value)}
            style={input}
          >
            <option value="">— pick from {models.length} model(s) —</option>
            {models.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        )}
        <input
          value={modelId}
          onChange={(e) => setModelId(e.target.value)}
          placeholder={models.length > 0 ? "…or type a custom model id" : "provider-specific model id"}
          style={input}
        />
        <span style={{ color: "rgb(var(--muted))", fontSize: 11 }}>
          {models.length > 0
            ? "Pick from the list above, or type a custom id."
            : 'Type a model id, or click "List models" to choose from a dropdown.'}
        </span>
      </Field>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <button onClick={() => void listModels(provider, account)} disabled={fetching} style={ghostButton}>
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
        <button onClick={() => setStep("account")} style={ghostButton}>
          Back
        </button>
        <button onClick={onCancel} style={ghostButton}>
          Cancel
        </button>
      </div>
    </div>
  );
}
