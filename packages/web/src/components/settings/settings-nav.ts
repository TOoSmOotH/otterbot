export type SettingsSection =
  | "overview"
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

export type ConfigStatus = "connected" | "configured" | "partial" | "unconfigured" | "none";

// SVG path data for each icon (Lucide-style, viewBox 0 0 24 24, stroke-based)
// Some icons need multiple paths/elements, stored as string arrays
const ICONS = {
  overview: ["M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z", "M9 22V12h6v10"],
  profile: ["M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2", "M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z"],
  appearance: ["M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"],
  system: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"],
  "worker-names": ["M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2", "M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z", "M23 21v-2a4 4 0 0 0-3-3.87", "M16 3.13a4 4 0 0 1 0 7.75"],
  security: ["M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"],
  providers: ["M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"],
  models: ["M12 2a4 4 0 0 0-4 4v2H6a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2v2a4 4 0 0 0 8 0v-2h2a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2h-2V6a4 4 0 0 0-4-4z"],
  workshop: ["M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2", "M8.5 2h7", "M7 16.5h10"],
  soul: ["M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"],
  memory: ["M4 7V4a2 2 0 0 1 2-2h8.5L20 7.5V20a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-3", "M14 2v6h6", "M2 15h10", "M5 12l-3 3 3 3"],
  pricing: ["M12 1v22", "M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"],
  search: ["M11 3a8 8 0 1 0 0 16 8 8 0 0 0 0-16z", "M21 21l-4.35-4.35"],
  speech: ["M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3z", "M19 10v2a7 7 0 0 1-14 0v-2", "M12 19v3"],
  liveview: ["M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"],
  opencode: ["M4 17l6-6-6-6", "M12 19h8"],
  scheduled: ["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z", "M12 6v6l4 2"],
  channels: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"],
  email: ["M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z", "M22 6l-10 7L2 6"],
  google: ["M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20z", "M2 12h20"],
  github: ["M15 22v-4a4.8 4.8 0 0 0-1-3.5c3 0 6-2 6-5.5.08-1.25-.27-2.48-1-3.5.28-1.15.28-2.35 0-3.5 0 0-1 0-3 1.5-2.64-.5-5.36-.5-8 0C6 2 5 2 5 2c-.3 1.15-.3 2.35 0 3.5A5.403 5.403 0 0 0 4 9c0 3.5 3 5.5 6 5.5-.39.49-.68 1.05-.85 1.65S8.93 17.38 9 18v4", "M9 18c-4.51 2-5-2-7-2"],
  discord: ["M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057a.082.082 0 0 0 .031.057 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"],
  telegram: ["M22 2L11 13", "M22 2l-7 20-4-9-9-4z"],
  slack: ["M14.5 10c-.83 0-1.5-.67-1.5-1.5v-5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5z", "M20.5 10H19v-1.5c0-.83.67-1.5 1.5-1.5s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z", "M9.5 14c.83 0 1.5.67 1.5 1.5v5c0 .83-.67 1.5-1.5 1.5S8 21.33 8 20.5v-5c0-.83.67-1.5 1.5-1.5z", "M3.5 14H5v1.5c0 .83-.67 1.5-1.5 1.5S2 16.33 2 15.5 2.67 14 3.5 14z", "M14 14.5c0-.83.67-1.5 1.5-1.5h5c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h-5c-.83 0-1.5-.67-1.5-1.5z", "M14 20.5c0-.83.67-1.5 1.5-1.5h0c.83 0 1.5.67 1.5 1.5s-.67 1.5-1.5 1.5h0c-.83 0-1.5-.67-1.5-1.5z", "M10 9.5C10 10.33 9.33 11 8.5 11h-5C2.67 11 2 10.33 2 9.5S2.67 8 3.5 8h5c.83 0 1.5.67 1.5 1.5z", "M10 3.5C10 4.33 9.33 5 8.5 5h0C7.67 5 7 4.33 7 3.5S7.67 2 8.5 2h0c.83 0 1.5.67 1.5 1.5z"],
  mattermost: ["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z", "M8 10h.01", "M12 10h.01", "M16 10h.01"],
  "nextcloud-talk": ["M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z", "M8 14h.01", "M12 14h.01", "M16 14h.01"],
  "mcp-servers": ["M12 22v-5", "M9 8V2", "M15 8V2", "M18 8v5a6 6 0 0 1-6 6h0a6 6 0 0 1-6-6V8z"],
  ssh: ["M21 2l-2 2m-7.61 7.61a5.5 5.5 0 1 1-7.778 7.778 5.5 5.5 0 0 1 7.777-7.777zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4"],
} as const;

export type NavIconId = keyof typeof ICONS;

export function getIconPaths(id: NavIconId): readonly string[] {
  return ICONS[id] ?? ICONS.overview;
}

export interface NavItem {
  id: SettingsSection;
  label: string;
  description: string;
  icon: NavIconId;
  keywords?: string[];
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
      {
        id: "profile",
        label: "Profile",
        description: "Name, avatar, and personal preferences",
        icon: "profile",
        keywords: ["name", "avatar", "bio", "timezone"],
      },
      {
        id: "appearance",
        label: "Appearance",
        description: "Theme and visual customization",
        icon: "appearance",
        keywords: ["theme", "dark", "light", "color"],
      },
      {
        id: "system",
        label: "System",
        description: "About, backups, and system info",
        icon: "system",
        keywords: ["backup", "restore", "database", "version"],
      },
      {
        id: "worker-names",
        label: "Worker Names",
        description: "Customize agent display names",
        icon: "worker-names",
        keywords: ["agent", "name", "alias"],
      },
      {
        id: "security",
        label: "Authentication",
        description: "Passphrase and access control",
        icon: "security",
        keywords: ["password", "passphrase", "login", "auth"],
      },
    ],
  },
  {
    label: "AI",
    defaultOpen: true,
    items: [
      {
        id: "providers",
        label: "Providers",
        description: "API keys for LLM services",
        icon: "providers",
        keywords: ["openai", "anthropic", "ollama", "api", "key"],
      },
      {
        id: "models",
        label: "Models",
        description: "Default models for each agent tier",
        icon: "models",
        keywords: ["gpt", "claude", "llm", "tier", "default"],
      },
      {
        id: "workshop",
        label: "Agent Workshop",
        description: "Agents, skills, tools, and specialists",
        icon: "workshop",
        keywords: ["agent", "skill", "tool", "specialist", "module"],
      },
      {
        id: "soul",
        label: "Soul",
        description: "Agent personality and behavior",
        icon: "soul",
        keywords: ["personality", "prompt", "system", "character"],
      },
      {
        id: "memory",
        label: "Memory",
        description: "Context and knowledge management",
        icon: "memory",
        keywords: ["context", "knowledge", "document", "rag"],
      },
      {
        id: "pricing",
        label: "Pricing",
        description: "Token usage and cost tracking",
        icon: "pricing",
        keywords: ["cost", "token", "usage", "billing"],
      },
    ],
  },
  {
    label: "Features",
    defaultOpen: true,
    items: [
      {
        id: "search",
        label: "Search",
        description: "Web search provider configuration",
        icon: "search",
        keywords: ["web", "searxng", "google", "provider"],
      },
      {
        id: "speech",
        label: "Speech",
        description: "Voice input and text-to-speech",
        icon: "speech",
        keywords: ["tts", "stt", "voice", "whisper", "microphone"],
      },
      {
        id: "liveview",
        label: "Live View",
        description: "Browser automation and screen sharing",
        icon: "liveview",
        keywords: ["browser", "desktop", "screen", "puppeteer"],
      },
      {
        id: "opencode",
        label: "Coding Agents",
        description: "Code editing assistants",
        icon: "opencode",
        keywords: ["code", "opencode", "claude", "codex", "gemini", "terminal"],
      },
      {
        id: "scheduled",
        label: "Scheduled Tasks",
        description: "Automated recurring tasks",
        icon: "scheduled",
        keywords: ["cron", "timer", "recurring", "automation"],
      },
      {
        id: "mcp-servers",
        label: "MCP Servers",
        description: "Model Context Protocol servers",
        icon: "mcp-servers",
        keywords: ["mcp", "plugin", "server", "protocol"],
      },
      {
        id: "ssh",
        label: "SSH Keys",
        description: "SSH key management for Git",
        icon: "ssh",
        keywords: ["key", "git", "deploy", "fingerprint"],
      },
    ],
  },
  {
    label: "Integrations",
    defaultOpen: false,
    items: [
      {
        id: "channels",
        label: "Channels",
        description: "Messaging platform overview",
        icon: "channels",
        keywords: ["messaging", "chat", "platform"],
      },
      {
        id: "google",
        label: "Google",
        description: "Google account and OAuth setup",
        icon: "google",
        keywords: ["oauth", "calendar", "drive", "gmail"],
      },
      {
        id: "email",
        label: "Email Setup",
        description: "Email sending and receiving",
        icon: "email",
        keywords: ["gmail", "smtp", "inbox", "send"],
      },
      {
        id: "github",
        label: "GitHub",
        description: "Repository access and tokens",
        icon: "github",
        keywords: ["repo", "token", "git", "repository"],
      },
      {
        id: "discord",
        label: "Discord",
        description: "Discord bot connection",
        icon: "discord",
        keywords: ["bot", "server", "guild"],
      },
      {
        id: "telegram",
        label: "Telegram",
        description: "Telegram bot integration",
        icon: "telegram",
        keywords: ["bot", "chat"],
      },
      {
        id: "slack",
        label: "Slack",
        description: "Slack workspace connection",
        icon: "slack",
        keywords: ["workspace", "bot", "app"],
      },
      {
        id: "mattermost",
        label: "Mattermost",
        description: "Mattermost server integration",
        icon: "mattermost",
        keywords: ["server", "team", "bot"],
      },
      {
        id: "nextcloud-talk",
        label: "Nextcloud Talk",
        description: "Nextcloud Talk messaging",
        icon: "nextcloud-talk",
        keywords: ["nextcloud", "self-hosted", "chat"],
      },
    ],
  },
];
