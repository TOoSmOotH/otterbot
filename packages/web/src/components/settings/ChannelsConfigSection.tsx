import { useState, useEffect, useCallback } from "react";
import { cn } from "../../lib/utils";

// ─── Types ──────────────────────────────────────────────────────────────────

type ResponseMode = "auto" | "mention" | "new_threads" | "announce" | "readonly";

interface ChannelConfig {
  channelId: string;
  name: string;
  type: "forum" | "text" | "announcement" | "voice" | "unknown";
  responseMode: ResponseMode;
  enabled: boolean;
}

interface DiscordChannel {
  id: string;
  name: string;
  type: string;
}

interface ChannelsConfigSectionProps {
  moduleId: string;
  configValues: Record<string, string | undefined>;
  onConfigChange: (key: string, value: string) => void;
}

// ─── Response mode options per channel type ─────────────────────────────────

const RESPONSE_MODES_BY_TYPE: Record<string, { value: ResponseMode; label: string }[]> = {
  forum: [
    { value: "auto", label: "Auto-respond" },
    { value: "mention", label: "Mention only" },
    { value: "new_threads", label: "New threads only" },
    { value: "readonly", label: "Read-only" },
  ],
  text: [
    { value: "auto", label: "Auto-respond" },
    { value: "mention", label: "Mention only" },
    { value: "announce", label: "Announce releases" },
    { value: "readonly", label: "Read-only" },
  ],
  announcement: [
    { value: "announce", label: "Announce releases" },
    { value: "readonly", label: "Read-only" },
  ],
  voice: [
    { value: "readonly", label: "Read-only" },
  ],
  unknown: [
    { value: "readonly", label: "Read-only" },
  ],
};

const TYPE_BADGES: Record<string, { label: string; className: string }> = {
  forum: { label: "Forum", className: "bg-blue-500/10 text-blue-500" },
  text: { label: "Text", className: "bg-green-500/10 text-green-500" },
  announcement: { label: "Announce", className: "bg-yellow-500/10 text-yellow-500" },
  voice: { label: "Voice", className: "bg-purple-500/10 text-purple-500" },
  unknown: { label: "Unknown", className: "bg-gray-500/10 text-gray-500" },
};

// ─── Component ──────────────────────────────────────────────────────────────

export function ChannelsConfigSection({
  moduleId,
  configValues,
  onConfigChange,
}: ChannelsConfigSectionProps) {
  const [channels, setChannels] = useState<ChannelConfig[]>([]);
  const [availableChannels, setAvailableChannels] = useState<DiscordChannel[]>([]);
  const [showPicker, setShowPicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [migrated, setMigrated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Parse existing config on mount
  useEffect(() => {
    const raw = configValues.channels_config;
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          setChannels(parsed);
          return;
        }
      } catch { /* ignore */ }
    }

    // Legacy migration: if channels_config is empty but forum_channel_ids exists
    const legacyIds = configValues.forum_channel_ids;
    if (legacyIds) {
      const ids = legacyIds.split(",").map((id) => id.trim()).filter(Boolean);
      const mode = (configValues.response_mode || "auto") as ResponseMode;
      const migrated = ids.map((id): ChannelConfig => ({
        channelId: id,
        name: `Channel ${id}`,
        type: "forum",
        responseMode: mode,
        enabled: true,
      }));
      setChannels(migrated);
      onConfigChange("channels_config", JSON.stringify(migrated));
      setMigrated(true);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const updateChannels = useCallback(
    (updated: ChannelConfig[]) => {
      setChannels(updated);
      onConfigChange("channels_config", JSON.stringify(updated));
    },
    [onConfigChange],
  );

  const fetchAvailableChannels = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/modules/${moduleId}/webhook`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "list-channels" }),
      });
      if (res.ok) {
        const data = await res.json();
        setAvailableChannels(data.channels ?? []);
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `Failed to fetch channels (${res.status})`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch channels");
    } finally {
      setLoading(false);
    }
  };

  const handleAddChannel = (ch: DiscordChannel) => {
    if (channels.some((c) => c.channelId === ch.id)) return;

    const type = ch.type as ChannelConfig["type"];
    const defaultMode = type === "announcement" ? "announce" : "auto";
    const newConfig: ChannelConfig = {
      channelId: ch.id,
      name: ch.name,
      type,
      responseMode: defaultMode as ResponseMode,
      enabled: true,
    };
    updateChannels([...channels, newConfig]);
    setShowPicker(false);
    setSearch("");
  };

  const handleRemove = (channelId: string) => {
    updateChannels(channels.filter((c) => c.channelId !== channelId));
  };

  const handleModeChange = (channelId: string, mode: ResponseMode) => {
    updateChannels(
      channels.map((c) =>
        c.channelId === channelId ? { ...c, responseMode: mode } : c,
      ),
    );
  };

  const handleToggle = (channelId: string) => {
    updateChannels(
      channels.map((c) =>
        c.channelId === channelId ? { ...c, enabled: !c.enabled } : c,
      ),
    );
  };

  const configuredIds = new Set(channels.map((c) => c.channelId));
  const filteredAvailable = availableChannels.filter(
    (ch) =>
      !configuredIds.has(ch.id) &&
      ch.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
          Discord Channels
        </div>
        <button
          onClick={() => {
            setShowPicker(!showPicker);
            if (!showPicker) fetchAvailableChannels();
          }}
          className="text-xs text-primary hover:text-primary/80"
        >
          {showPicker ? "Cancel" : "+ Add Channel"}
        </button>
      </div>

      {migrated && (
        <div className="text-[10px] text-yellow-500 bg-yellow-500/10 rounded-md px-2 py-1.5">
          Migrated from legacy forum_channel_ids config. Save to persist.
        </div>
      )}

      {/* Channel picker */}
      {showPicker && (
        <div className="border border-border rounded-md p-2 space-y-2">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search channels..."
            className="w-full bg-secondary rounded-md px-3 py-1.5 text-xs outline-none focus:ring-1 ring-primary"
          />
          {error ? (
            <div className="text-[10px] text-red-500 text-center py-2">
              {error}
            </div>
          ) : loading ? (
            <div className="text-[10px] text-muted-foreground text-center py-2">
              Loading channels...
            </div>
          ) : filteredAvailable.length === 0 ? (
            <div className="text-[10px] text-muted-foreground text-center py-2">
              {availableChannels.length === 0
                ? "No channels found. Is the bot connected?"
                : "No matching channels"}
            </div>
          ) : (
            <div className="max-h-[200px] overflow-y-auto space-y-0.5">
              {filteredAvailable.map((ch) => {
                const badge = TYPE_BADGES[ch.type] ?? TYPE_BADGES.unknown;
                return (
                  <button
                    key={ch.id}
                    onClick={() => handleAddChannel(ch)}
                    className="w-full text-left px-2 py-1.5 text-xs rounded hover:bg-secondary/80 flex items-center gap-2"
                  >
                    <span className="font-medium">#{ch.name}</span>
                    <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full", badge.className)}>
                      {badge.label}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Configured channels list */}
      {channels.length === 0 ? (
        <div className="text-[10px] text-muted-foreground text-center py-4">
          No channels configured. Add a channel to get started.
        </div>
      ) : (
        <div className="space-y-1">
          {channels.map((ch) => {
            const badge = TYPE_BADGES[ch.type] ?? TYPE_BADGES.unknown;
            const modes = RESPONSE_MODES_BY_TYPE[ch.type] ?? RESPONSE_MODES_BY_TYPE.unknown;

            return (
              <div
                key={ch.channelId}
                className={cn(
                  "flex items-center gap-2 px-2 py-2 rounded-md border border-border",
                  !ch.enabled && "opacity-50",
                )}
              >
                {/* Channel name + type badge */}
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span className="text-xs font-medium truncate">#{ch.name}</span>
                  <span className={cn("text-[9px] px-1.5 py-0.5 rounded-full shrink-0", badge.className)}>
                    {badge.label}
                  </span>
                </div>

                {/* Response mode */}
                <select
                  value={ch.responseMode}
                  onChange={(e) => handleModeChange(ch.channelId, e.target.value as ResponseMode)}
                  className="bg-secondary rounded px-2 py-1 text-[10px] outline-none focus:ring-1 ring-primary"
                >
                  {modes.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>

                {/* Enabled toggle */}
                <button
                  onClick={() => handleToggle(ch.channelId)}
                  className={cn(
                    "relative w-7 h-4 rounded-full transition-colors shrink-0",
                    ch.enabled ? "bg-primary" : "bg-secondary",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 left-0.5 w-3 h-3 bg-white rounded-full transition-transform",
                      ch.enabled && "translate-x-3",
                    )}
                  />
                </button>

                {/* Remove */}
                <button
                  onClick={() => handleRemove(ch.channelId)}
                  className="text-muted-foreground hover:text-red-500 text-xs shrink-0"
                  title="Remove channel"
                >
                  x
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
