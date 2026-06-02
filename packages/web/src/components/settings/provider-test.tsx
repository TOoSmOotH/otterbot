import { useState } from "react";
import type { ProviderAccount, ProviderId, ProviderInfo } from "@otterbot/shared";
import { apiFetch } from "../../lib/api";
import { isAccountConfigured } from "../../stores/providers-store";
import { ghostButton } from "./settings-styles";

export type TestStatus = { state: "idle" | "testing" | "ok" | "fail"; message?: string };

/**
 * Verify a provider's credentials by listing its models. `account` resolves the
 * stored credentials for that account server-side; `secrets` layers any typed
 * (unsaved) overrides on top so a key can be tested before it's saved.
 */
export async function testProviderConnection(
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

/** A "Test" button + inline status, shared by the account card and add wizard. */
export function TestConnection({ onTest }: { onTest: () => Promise<TestStatus> }) {
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

/** Whether a provider account should appear in the configured-providers list. */
export function isAccountVisible(info: ProviderInfo, acc: ProviderAccount): boolean {
  if (info.id === "openai" && acc.authMethod === "oauth") return true;
  // A pending (typed-but-unsaved) API key counts so a freshly added account
  // doesn't vanish before its first save round-trip.
  if (acc.apiKey && acc.apiKey.trim()) return true;
  return isAccountConfigured(info, acc);
}
