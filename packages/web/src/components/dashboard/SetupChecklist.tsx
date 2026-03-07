import { useState, useEffect } from "react";
import { useSettingsStore } from "../../stores/settings-store";
import { useSettingsStatus } from "../settings/useSettingsStatus";
import type { SettingsSection } from "../settings/settings-nav";
import type { Project } from "@otterbot/shared";

const DISMISS_KEY = "otterbot-setup-checklist-dismissed";

interface ChecklistItem {
  label: string;
  description: string;
  settingsTarget: SettingsSection | "new-project";
}

const ITEMS: ChecklistItem[] = [
  {
    label: "Configure an AI Provider",
    description: "Add an API key for at least one LLM provider",
    settingsTarget: "providers",
  },
  {
    label: "Connect Google",
    description: "Link your Google account for email & calendar",
    settingsTarget: "google",
  },
  {
    label: "Set up GitHub",
    description: "Add a GitHub account for repository access",
    settingsTarget: "github",
  },
  {
    label: "Connect a chat platform",
    description: "Link Discord, Telegram, Slack, or another messaging app",
    settingsTarget: "channels",
  },
  {
    label: "Set up a coding agent",
    description: "Enable Claude Code, OpenCode, or another coding assistant",
    settingsTarget: "opencode",
  },
  {
    label: "Create your first project",
    description: "Start a project to put your bot to work",
    settingsTarget: "new-project",
  },
];

const CHANNEL_KEYS = [
  "discord",
  "telegram",
  "slack",
  "mattermost",
  "nextcloud-talk",
  "bluesky",
  "mastodon",
  "x",
] as const;

export function SetupChecklist({
  projects,
  onOpenSettings,
}: {
  projects: Project[];
  onOpenSettings?: (section?: SettingsSection) => void;
}) {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === "true");
  const loading = useSettingsStore((s) => s.loading);
  const providers = useSettingsStore((s) => s.providers);
  const statusMap = useSettingsStatus();

  // Don't render until settings have loaded
  if (loading || dismissed) return null;

  const completed = getCompleted(providers, statusMap, projects);
  const doneCount = completed.filter(Boolean).length;
  const total = ITEMS.length;
  const allDone = doneCount === total;

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  };

  const handleClick = (item: ChecklistItem) => {
    if (item.settingsTarget === "new-project") {
      const btn = document.querySelector<HTMLButtonElement>('[data-action="new-project"]');
      btn?.click();
    } else {
      onOpenSettings?.(item.settingsTarget);
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h3 className="text-sm font-medium">Getting Started</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {allDone ? "You're all set!" : `${doneCount} of ${total} complete`}
          </p>
        </div>
        {allDone && (
          <button
            onClick={handleDismiss}
            className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-secondary transition-colors"
          >
            Dismiss
          </button>
        )}
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-3">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${(doneCount / total) * 100}%` }}
        />
      </div>

      <div className="space-y-1">
        {ITEMS.map((item, i) => {
          const done = completed[i];
          return (
            <button
              key={item.label}
              onClick={() => !done && handleClick(item)}
              disabled={done}
              className={`w-full flex items-start gap-3 text-left rounded-md px-2 py-2 transition-colors ${
                done
                  ? "opacity-60 cursor-default"
                  : "hover:bg-secondary cursor-pointer"
              }`}
            >
              {/* Circle checkbox */}
              <div className="mt-0.5 shrink-0">
                {done ? (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="7" fill="currentColor" className="text-green-500" />
                    <path d="M5 8l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
                    <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" className="text-muted-foreground" />
                  </svg>
                )}
              </div>
              <div>
                <div className="text-xs font-medium">{item.label}</div>
                <div className="text-[11px] text-muted-foreground">{item.description}</div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function getCompleted(
  providers: { id: string }[],
  statusMap: Record<string, string>,
  projects: Project[],
): boolean[] {
  return [
    providers.length > 0,
    statusMap.google === "connected",
    statusMap.github !== "unconfigured",
    CHANNEL_KEYS.some((k) => statusMap[k] !== "unconfigured"),
    statusMap.opencode === "configured",
    projects.length > 0,
  ];
}
