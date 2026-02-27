export type SettingsSection =
  | "profile"
  | "appearance"
  | "system"
  | "providers"
  | "models"
  | "workshop"
  | "pricing"
  | "soul"
  | "memory"
  | "search"
  | "speech"
  | "liveview"
  | "opencode"
  | "scheduled"
  | "modules"
  | "channels"
  | "email"
  | "google"
  | "github"
  | "discord"
  | "telegram"
  | "slack"
  | "mattermost"
  | "nextcloud-talk"
  | "worker-names"
  | "mcp-servers"
  | "ssh"
  | "security";

export interface NavItem {
  id: SettingsSection;
  label: string;
}

export interface NavGroup {
  label: string;
  defaultOpen: boolean;
  items: NavItem[];
}

export const SETTINGS_NAV: NavGroup[] = [
  {
    label: "General",
    defaultOpen: true,
    items: [
      { id: "profile", label: "Profile" },
      { id: "appearance", label: "Appearance" },
      { id: "system", label: "System" },
      { id: "worker-names", label: "Worker Names" },
    ],
  },
  {
    label: "AI",
    defaultOpen: true,
    items: [
      { id: "providers", label: "Providers" },
      { id: "models", label: "Models" },
      { id: "workshop", label: "Agent Workshop" },
      { id: "soul", label: "Soul" },
      { id: "memory", label: "Memory" },
      { id: "pricing", label: "Pricing" },
    ],
  },
  {
    label: "Features",
    defaultOpen: true,
    items: [
      { id: "search", label: "Search" },
      { id: "speech", label: "Speech" },
      { id: "liveview", label: "Live View" },
      { id: "opencode", label: "Coding Agents" },
      { id: "scheduled", label: "Scheduled Tasks" },
      { id: "modules", label: "Modules" },
      { id: "mcp-servers", label: "MCP Servers" },
      { id: "ssh", label: "SSH Keys" },
    ],
  },
  {
    label: "Integrations",
    defaultOpen: false,
    items: [
      { id: "channels", label: "Channels" },
      { id: "google", label: "Google" },
      { id: "email", label: "Email Setup" },
      { id: "github", label: "GitHub" },
      { id: "discord", label: "Discord" },
      { id: "telegram", label: "Telegram" },
      { id: "slack", label: "Slack" },
      { id: "mattermost", label: "Mattermost" },
      { id: "nextcloud-talk", label: "Nextcloud Talk" },
    ],
  },
  {
    label: "Security",
    defaultOpen: false,
    items: [{ id: "security", label: "Authentication" }],
  },
];
