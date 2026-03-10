// ─── Per-channel configuration ───────────────────────────────────────────────

export type ResponseMode = "auto" | "mention" | "new_threads" | "announce" | "readonly";

export interface ChannelConfig {
  channelId: string;
  name: string;
  type: "forum" | "text" | "announcement" | "voice" | "unknown";
  responseMode: ResponseMode;
  enabled: boolean;
}

// ─── Parsing / serialization ─────────────────────────────────────────────────

export function parseChannelConfigs(raw: string | undefined): ChannelConfig[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (c): c is ChannelConfig =>
        typeof c === "object" &&
        c !== null &&
        typeof c.channelId === "string" &&
        typeof c.name === "string",
    );
  } catch {
    return [];
  }
}

export function serializeChannelConfigs(configs: ChannelConfig[]): string {
  return JSON.stringify(configs);
}

// ─── Legacy migration ────────────────────────────────────────────────────────

/**
 * Migrate from the old comma-separated `forum_channel_ids` + global `response_mode`
 * to the new per-channel config format.
 */
export function migrateFromLegacy(
  forumChannelIds: string,
  responseMode: string,
): ChannelConfig[] {
  const ids = forumChannelIds.split(",").map((id) => id.trim()).filter(Boolean);
  const mode = (responseMode || "auto") as ResponseMode;

  return ids.map((id) => ({
    channelId: id,
    name: `Channel ${id}`,
    type: "forum" as const,
    responseMode: mode,
    enabled: true,
  }));
}

// ─── Lookup ──────────────────────────────────────────────────────────────────

export function getChannelConfig(
  configs: ChannelConfig[],
  channelId: string,
): ChannelConfig | undefined {
  return configs.find((c) => c.channelId === channelId);
}
