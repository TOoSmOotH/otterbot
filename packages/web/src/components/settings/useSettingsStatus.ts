import { useMemo } from "react";
import { useSettingsStore } from "../../stores/settings-store";
import { useMcpStore } from "../../stores/mcp-store";
import type { ConfigStatus, SettingsSection } from "./settings-nav";

export function useSettingsStatus(): Record<string, ConfigStatus> {
  // Integrations
  const discordEnabled = useSettingsStore((s) => s.discordEnabled);
  const discordTokenSet = useSettingsStore((s) => s.discordTokenSet);
  const telegramEnabled = useSettingsStore((s) => s.telegramEnabled);
  const telegramTokenSet = useSettingsStore((s) => s.telegramTokenSet);
  const slackEnabled = useSettingsStore((s) => s.slackEnabled);
  const slackBotTokenSet = useSettingsStore((s) => s.slackBotTokenSet);
  const mattermostEnabled = useSettingsStore((s) => s.mattermostEnabled);
  const mattermostTokenSet = useSettingsStore((s) => s.mattermostTokenSet);
  const nextcloudTalkEnabled = useSettingsStore((s) => s.nextcloudTalkEnabled);
  const nextcloudTalkAppPasswordSet = useSettingsStore((s) => s.nextcloudTalkAppPasswordSet);
  const gitHubEnabled = useSettingsStore((s) => s.gitHubEnabled);
  const gitHubTokenSet = useSettingsStore((s) => s.gitHubTokenSet);
  const googleConnected = useSettingsStore((s) => s.googleConnected);

  // Features
  const activeSearchProvider = useSettingsStore((s) => s.activeSearchProvider);
  const ttsEnabled = useSettingsStore((s) => s.ttsEnabled);
  const sttEnabled = useSettingsStore((s) => s.sttEnabled);
  const openCodeEnabled = useSettingsStore((s) => s.openCodeEnabled);
  const claudeCodeEnabled = useSettingsStore((s) => s.claudeCodeEnabled);
  const codexEnabled = useSettingsStore((s) => s.codexEnabled);
  const geminiCliEnabled = useSettingsStore((s) => s.geminiCliEnabled);
  const sshKeySet = useSettingsStore((s) => s.sshKeySet);

  // MCP
  const mcpServers = useMcpStore((s) => s.servers);

  return useMemo(() => {
    const s: Record<string, ConfigStatus> = {};

    // Messaging integrations: connected if enabled + token, partial if token only
    s.discord = discordEnabled && discordTokenSet
      ? "connected" : discordTokenSet ? "partial" : "unconfigured";
    s.telegram = telegramEnabled && telegramTokenSet
      ? "connected" : telegramTokenSet ? "partial" : "unconfigured";
    s.slack = slackEnabled && slackBotTokenSet
      ? "connected" : slackBotTokenSet ? "partial" : "unconfigured";
    s.mattermost = mattermostEnabled && mattermostTokenSet
      ? "connected" : mattermostTokenSet ? "partial" : "unconfigured";
    s["nextcloud-talk"] = nextcloudTalkEnabled && nextcloudTalkAppPasswordSet
      ? "connected" : nextcloudTalkAppPasswordSet ? "partial" : "unconfigured";

    // Services
    s.github = gitHubEnabled && gitHubTokenSet
      ? "connected" : gitHubTokenSet ? "partial" : "unconfigured";
    s.google = googleConnected ? "connected" : "unconfigured";
    s.email = googleConnected ? "configured" : "unconfigured";

    // Features
    s.search = activeSearchProvider ? "configured" : "unconfigured";
    s.speech = (ttsEnabled || sttEnabled) ? "configured" : "unconfigured";
    s.opencode = (openCodeEnabled || claudeCodeEnabled || codexEnabled || geminiCliEnabled)
      ? "configured" : "unconfigured";
    s["mcp-servers"] = mcpServers.length > 0 ? "configured" : "unconfigured";
    s.ssh = sshKeySet ? "configured" : "unconfigured";

    // Items without meaningful status
    const noStatus: SettingsSection[] = [
      "overview", "profile", "appearance", "system", "worker-names", "security",
      "providers", "models", "workshop", "soul", "memory", "pricing",
      "liveview", "scheduled", "channels",
    ];
    for (const id of noStatus) s[id] = "none";

    return s;
  }, [
    discordEnabled, discordTokenSet, telegramEnabled, telegramTokenSet,
    slackEnabled, slackBotTokenSet, mattermostEnabled, mattermostTokenSet,
    nextcloudTalkEnabled, nextcloudTalkAppPasswordSet,
    gitHubEnabled, gitHubTokenSet, googleConnected,
    activeSearchProvider, ttsEnabled, sttEnabled,
    openCodeEnabled, claudeCodeEnabled, codexEnabled, geminiCliEnabled,
    sshKeySet, mcpServers,
  ]);
}
