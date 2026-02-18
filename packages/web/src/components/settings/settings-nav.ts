export type SettingsSection =
  | "profile"
  | "appearance"
  | "system"
  | "providers"
  | "models"
  | "workshop"
  | "pricing"
  | "search"
  | "speech"
  | "liveview"
  | "opencode"
  | "scheduled"
  | "channels"
  | "email"
  | "google"
  | "github"
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
    ],
  },
  {
    label: "AI",
    defaultOpen: true,
    items: [
      { id: "providers", label: "Providers" },
      { id: "models", label: "Models" },
      { id: "workshop", label: "Agent Workshop" },
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
      { id: "opencode", label: "OpenCode" },
      { id: "scheduled", label: "Scheduled Tasks" },
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
    ],
  },
  {
    label: "Security",
    defaultOpen: false,
    items: [{ id: "security", label: "Authentication" }],
  },
];
