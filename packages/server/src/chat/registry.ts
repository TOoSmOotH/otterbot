import type { IChatProvider } from "./IChatProvider.js";
import type { ChatProviderType } from "@otterbot/shared";
import { TeamsProvider } from "./teams/TeamsProvider.js";

/**
 * Registry of available chat providers keyed by their type identifier.
 */
const chatProviderFactories: Record<ChatProviderType, () => IChatProvider> = {
  teams: () => new TeamsProvider(),
};

/** Create a chat provider instance by type. */
export function createChatProvider(type: ChatProviderType): IChatProvider {
  const factory = chatProviderFactories[type];
  if (!factory) {
    throw new Error(`Unknown chat provider type: ${type}`);
  }
  return factory();
}

/** List all registered chat provider types. */
export function listChatProviderTypes(): ChatProviderType[] {
  return Object.keys(chatProviderFactories) as ChatProviderType[];
}
