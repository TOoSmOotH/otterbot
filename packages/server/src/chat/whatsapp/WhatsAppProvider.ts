import type { IChatProvider } from "../IChatProvider.js";

/**
 * WhatsApp chat provider (stub for registry).
 *
 * The actual bridge implementation lives in `../../whatsapp/whatsapp-bridge.ts`.
 * This is a placeholder scaffold so the provider appears in the registry.
 */
export class WhatsAppProvider implements IChatProvider {
  readonly id = "whatsapp" as const;
  readonly name = "WhatsApp";

  async start(): Promise<void> {
    throw new Error("WhatsAppProvider.start() is not yet implemented — use WhatsAppBridge directly");
  }

  async stop(): Promise<void> {
    throw new Error("WhatsAppProvider.stop() is not yet implemented — use WhatsAppBridge directly");
  }

  async sendMessage(_channelId: string, _content: string): Promise<void> {
    throw new Error("WhatsAppProvider.sendMessage() is not yet implemented — use WhatsAppBridge directly");
  }
}
