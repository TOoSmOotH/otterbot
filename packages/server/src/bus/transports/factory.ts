import type { Config } from "../../config.js";
import type { Transport } from "./transport.js";
import { LocalTransport } from "./local-transport.js";
import { ChatProviderTransport } from "./chat-transport.js";
import { PROVIDERS, type ChatProviderId } from "../../integrations/chat/providers.js";

/**
 * Pick the agent-to-agent transport from config. Defaults to the in-process
 * local transport; `AGENT_TRANSPORT=slack|discord|matrix` (with that provider's
 * credentials + a room/channel id) routes agent chatter through a shared room.
 */
export function createTransport(cfg: Config): Transport {
  if (cfg.agentTransport === "local") return new LocalTransport();
  const provider = PROVIDERS[cfg.agentTransport as ChatProviderId];
  if (provider) {
    const client = provider.transportClient(cfg);
    const roomId = provider.transportRoomId(cfg);
    if (client && roomId) return new ChatProviderTransport(provider.id, client, roomId);
    console.warn(
      `[transport] AGENT_TRANSPORT=${cfg.agentTransport} but its credentials / room id are missing; falling back to local`
    );
  }
  return new LocalTransport();
}
