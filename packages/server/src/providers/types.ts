import type { ProviderId, ModelRef, ProviderInfo } from "@otterbot/shared";

export type { ProviderId, ModelRef, ProviderInfo };

/** A resolved OpenAI-compatible HTTP endpoint. */
export interface ProviderEndpoint {
  baseUrl: string;
  apiKey: string;
}
