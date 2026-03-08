import { useState } from "react";
import type { SettingsSection } from "../settings/settings-nav";
import type { Project } from "@otterbot/shared";

const DISMISS_KEY = "otterbot-setup-checklist-dismissed";
const CHECKED_KEY = "otterbot-setup-checklist-checked";

interface ChecklistItem {
  id: string;
  label: string;
  description: string;
  settingsTarget: SettingsSection | "new-project";
}

const ITEMS: ChecklistItem[] = [
  {
    id: "provider",
    label: "Configure an AI Provider",
    description: "Add an API key for at least one LLM provider",
    settingsTarget: "providers",
  },
  {
    id: "google",
    label: "Connect Google",
    description: "Link your Google account for email & calendar",
    settingsTarget: "google",
  },
  {
    id: "github",
    label: "Set up GitHub",
    description: "Add a GitHub account for repository access",
    settingsTarget: "github",
  },
  {
    id: "chat",
    label: "Connect a chat platform",
    description: "Link Discord, Telegram, Slack, or another messaging app",
    settingsTarget: "channels",
  },
  {
    id: "coding",
    label: "Set up a coding agent",
    description: "Enable Claude Code, OpenCode, or another coding assistant",
    settingsTarget: "opencode",
  },
  {
    id: "project",
    label: "Create your first project",
    description: "Start a project to put your bot to work",
    settingsTarget: "new-project",
  },
];

function loadChecked(): Set<string> {
  try {
    const raw = localStorage.getItem(CHECKED_KEY);
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveChecked(checked: Set<string>) {
  localStorage.setItem(CHECKED_KEY, JSON.stringify([...checked]));
}

export function SetupChecklist({
  projects,
  onOpenSettings,
}: {
  projects: Project[];
  onOpenSettings?: (section?: SettingsSection) => void;
}) {
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(DISMISS_KEY) === "true");
  const [checked, setChecked] = useState(loadChecked);

  if (dismissed) return null;

  const doneCount = ITEMS.filter((item) => checked.has(item.id)).length;
  const total = ITEMS.length;
  const allDone = doneCount === total;

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  };

  const handleToggle = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      saveChecked(next);
      return next;
    });
  };

  const handleNavigate = (item: ChecklistItem) => {
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
        <button
          onClick={handleDismiss}
          className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-secondary transition-colors"
        >
          Dismiss
        </button>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-3">
        <div
          className="h-full rounded-full bg-primary transition-all"
          style={{ width: `${(doneCount / total) * 100}%` }}
        />
      </div>

      <div className="space-y-1">
        {ITEMS.map((item) => {
          const done = checked.has(item.id);
          return (
            <div
              key={item.id}
              className={`flex items-start gap-3 rounded-md px-2 py-2 transition-colors ${
                done ? "opacity-60" : ""
              }`}
            >
              {/* Clickable checkbox */}
              <button
                onClick={() => handleToggle(item.id)}
                className="mt-0.5 shrink-0 hover:scale-110 transition-transform"
                aria-label={done ? `Mark "${item.label}" incomplete` : `Mark "${item.label}" complete`}
              >
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
              </button>
              {/* Clickable label navigates to settings */}
              <button
                onClick={() => handleNavigate(item)}
                className="text-left hover:underline"
              >
                <div className="text-xs font-medium">{item.label}</div>
                <div className="text-[11px] text-muted-foreground">{item.description}</div>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
