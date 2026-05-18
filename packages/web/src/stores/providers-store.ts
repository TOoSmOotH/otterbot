import { create } from "zustand";
import type { ProviderInfo } from "@otterbot/shared";

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
