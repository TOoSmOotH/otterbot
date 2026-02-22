import type { IChatProvider } from "../IChatProvider.js";

/**
 * Microsoft Teams chat provider (stub).
 *
 * This is a placeholder scaffold — methods are not yet implemented.
 */
export class TeamsProvider implements IChatProvider {
  readonly id = "teams" as const;
  readonly name = "Microsoft Teams";

  async start(): Promise<void> {
    throw new Error("TeamsProvider.start() is not yet implemented");
  }

  async stop(): Promise<void> {
    throw new Error("TeamsProvider.stop() is not yet implemented");
  }

  async sendMessage(_channelId: string, _content: string): Promise<void> {
    throw new Error("TeamsProvider.sendMessage() is not yet implemented");
  }
}
