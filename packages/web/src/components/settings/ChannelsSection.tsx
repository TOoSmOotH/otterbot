import { useEffect } from "react";
import { useSettingsStore } from "../../stores/settings-store";

const CHANNELS = [
  {
    name: "WhatsApp",
    description: "Connect to WhatsApp messaging",
    icon: "W",
  },
  {
    name: "Telegram",
    description: "Connect to Telegram bots and channels",
    icon: "T",
    settingsSection: "telegram" as const,
  },
  {
    name: "Slack",
    description: "Integrate with Slack workspaces",
    icon: "S",
    settingsSection: "slack" as const,
  },
  {
    name: "Discord",
    description: "Connect to Discord servers",
    icon: "D",
    settingsSection: "discord" as const,
  },
  {
    name: "Mattermost",
    description: "Connect to Mattermost servers",
    icon: "M",
    settingsSection: "mattermost" as const,
  },
];

export function ChannelsSection() {
  const discordEnabled = useSettingsStore((s) => s.discordEnabled);
  const discordTokenSet = useSettingsStore((s) => s.discordTokenSet);
  const loadDiscordSettings = useSettingsStore((s) => s.loadDiscordSettings);
  const telegramEnabled = useSettingsStore((s) => s.telegramEnabled);
  const telegramTokenSet = useSettingsStore((s) => s.telegramTokenSet);
  const loadTelegramSettings = useSettingsStore((s) => s.loadTelegramSettings);
  const slackEnabled = useSettingsStore((s) => s.slackEnabled);
  const slackBotTokenSet = useSettingsStore((s) => s.slackBotTokenSet);
  const loadSlackSettings = useSettingsStore((s) => s.loadSlackSettings);
  const mattermostEnabled = useSettingsStore((s) => s.mattermostEnabled);
  const mattermostTokenSet = useSettingsStore((s) => s.mattermostTokenSet);
  const loadMattermostSettings = useSettingsStore((s) => s.loadMattermostSettings);

  useEffect(() => {
    loadDiscordSettings();
    loadTelegramSettings();
    loadSlackSettings();
    loadMattermostSettings();
  }, []);

  const isDiscordConnected = discordEnabled && discordTokenSet;
  const isTelegramConnected = telegramEnabled && telegramTokenSet;
  const isSlackConnected = slackEnabled && slackBotTokenSet;
  const isMattermostConnected = mattermostEnabled && mattermostTokenSet;

  return (
    <div className="p-5 space-y-4">
      <div>
        <h3 className="text-xs font-semibold mb-1">Channels</h3>
        <p className="text-xs text-muted-foreground">
          Connect Otterbot to messaging platforms.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {CHANNELS.map((channel) => {
          const connected = (channel.name === "Discord" && isDiscordConnected) || (channel.name === "Telegram" && isTelegramConnected) || (channel.name === "Slack" && isSlackConnected) || (channel.name === "Mattermost" && isMattermostConnected);
          return (
            <div
              key={channel.name}
              className="flex items-start gap-3 rounded-lg border border-border p-4 bg-secondary"
            >
              <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center shrink-0">
                <span className="text-xs font-bold text-muted-foreground">
                  {channel.icon}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-xs font-medium">{channel.name}</p>
                  {connected ? (
                    <span className="text-[10px] text-green-500 bg-green-500/10 px-1.5 py-0.5 rounded">
                      Connected
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                      Coming Soon
                    </span>
                  )}
                </div>
                <p className="text-[10px] text-muted-foreground mt-0.5">
                  {channel.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
