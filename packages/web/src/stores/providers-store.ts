import { create } from "zustand";
import type { ProviderAccount, ProviderInfo } from "@otterbot/shared";

/**
 * The model-provider catalog, fetched once from `GET /api/providers`. Every
 * provider picker in the UI derives from this — no provider is hardcoded.
 */
interface ProvidersState {
  providers: ProviderInfo[];
  loaded: boolean;
  load: () => Promise<void>;
}

export const useProvidersStore = create<ProvidersState>((set, get) => ({
  providers: [],
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    try {
      const res = await fetch("/api/providers");
      if (res.ok) {
        set({ providers: (await res.json()) as ProviderInfo[], loaded: true });
      }
    } catch {
      /* ignore — pickers render empty until the API is reachable */
    }
  },
}));

/**
 * The single credential field a provider needs in a setup form: an API key for
 * cloud providers, a base URL for local servers, or `null` when it needs none
 * (e.g. the in-process built-in embedder).
 */
export interface ProviderCredField {
  key: string;
  label: string;
  placeholder: string;
  secret: boolean;
}

export function providerCredField(p: ProviderInfo): ProviderCredField | null {
  if (p.needsApiKey && p.apiKeyEnv) {
    return { key: p.apiKeyEnv, label: `${p.label} API key`, placeholder: "API key…", secret: true };
  }
  if (p.baseUrlEnv) {
    return {
      key: p.baseUrlEnv,
      label: `${p.label} base URL`,
      placeholder: p.defaultBaseUrl ?? "http://localhost:…/v1",
      secret: false,
    };
  }
  return null;
}

/** Default value for a provider's credential field (the base URL, or empty). */
export function providerDefaultCred(p: ProviderInfo): string {
  return !p.needsApiKey && p.baseUrlEnv ? (p.defaultBaseUrl ?? "") : "";
}

/**
 * Whether a provider account already has usable credentials saved — an API key
 * for cloud providers, a non-empty base URL for local servers. Providers with
 * no credential field (the built-in embedder) are always "configured" since
 * there is nothing to enter.
 */
export function isAccountConfigured(p: ProviderInfo, account?: ProviderAccount): boolean {
  if (p.needsApiKey && p.apiKeyEnv) return Boolean(account?.apiKeyConfigured);
  if (p.baseUrlEnv) return Boolean(account?.baseUrl?.trim());
  return true;
}

/**
 * Whether any account for a provider is configured. Used by pickers to show
 * the "Configured" badge without caring which specific account is set up.
 */
export function isProviderConfiguredGlobally(
  p: ProviderInfo,
  accounts?: ProviderAccount[]
): boolean {
  if (!accounts || accounts.length === 0) {
    if (p.needsApiKey || p.baseUrlEnv) return false;
    return true;
  }
  return accounts.some((acc) => isAccountConfigured(p, acc));
}

/**
 * Maps a provider's single credential value onto the right `ProviderAccount`
 * slot: `apiKey` for cloud providers, `baseUrl` for local servers.
 */
export function globalProviderPatch(
  p: ProviderInfo,
  credValue: string
): Partial<ProviderAccount> {
  if (p.needsApiKey && p.apiKeyEnv) return { apiKey: credValue };
  if (p.baseUrlEnv) return { baseUrl: credValue };
  return {};
}

/** Return the named account for a provider, falling back to the first one. */
export function findAccount(
  accounts: ProviderAccount[] | undefined,
  name: string
): ProviderAccount | undefined {
  if (!accounts || accounts.length === 0) return undefined;
  return accounts.find((a) => a.account === name) ?? accounts[0];
}
