import { useState } from "react";
import type { SettingsSection } from "../settings/settings-nav";

const DISMISS_KEY = "otterbot-specialists-intro-dismissed";

export function SpecialistsIntro({
  onOpenSettings,
}: {
  onOpenSettings?: (section?: SettingsSection) => void;
}) {
  const [dismissed, setDismissed] = useState(
    () => localStorage.getItem(DISMISS_KEY) === "true",
  );

  if (dismissed) return null;

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, "true");
    setDismissed(true);
  };

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-4 mb-3">
        <div className="flex items-center gap-2.5">
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-primary shrink-0"
          >
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
          <div>
            <h3 className="text-sm font-medium">Specialist Agents</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Extend Otterbot with domain-specific agents
            </p>
          </div>
        </div>
        <button
          onClick={handleDismiss}
          className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded hover:bg-secondary transition-colors shrink-0"
        >
          Dismiss
        </button>
      </div>

      <p className="text-xs text-muted-foreground mb-3 leading-relaxed">
        Specialists are agents with their own knowledge stores, tools, and data pipelines.
        They connect to external APIs and build up domain expertise over time &mdash; monitoring
        GitHub discussions, tracking news feeds, managing calendars, and more.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
        <FeatureCard
          title="Knowledge Store"
          description="Each specialist has its own private database for indexed data"
        />
        <FeatureCard
          title="Custom Tools"
          description="Specialists expose tools that other agents can query"
        />
        <FeatureCard
          title="Data Pipelines"
          description="Auto-ingest from APIs via polling, webhooks, or full syncs"
        />
      </div>

      <div className="flex items-center gap-3 text-xs">
        <span className="text-muted-foreground">
          Ask the COO to create one, or install from the workshop.
        </span>
        {onOpenSettings && (
          <button
            onClick={() => onOpenSettings("workshop")}
            className="text-primary hover:underline shrink-0"
          >
            Browse Workshop
          </button>
        )}
      </div>
    </div>
  );
}

function FeatureCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="rounded-md border border-border/50 bg-secondary/30 px-3 py-2">
      <div className="text-xs font-medium mb-0.5">{title}</div>
      <div className="text-[11px] text-muted-foreground leading-snug">{description}</div>
    </div>
  );
}
