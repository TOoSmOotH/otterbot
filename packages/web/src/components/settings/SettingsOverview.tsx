import { useEffect } from "react";
import { cn } from "../../lib/utils";
import { SETTINGS_NAV, type SettingsSection, type ConfigStatus } from "./settings-nav";
import { NavIcon } from "./NavIcon";
import { useSettingsStore } from "../../stores/settings-store";

interface SettingsOverviewProps {
  onSelect: (section: SettingsSection) => void;
  statusMap: Record<string, ConfigStatus>;
}

const STATUS_BADGE: Record<ConfigStatus, { label: string; className: string } | null> = {
  connected: { label: "Connected", className: "bg-green-500/15 text-green-400" },
  configured: { label: "Set up", className: "bg-blue-500/15 text-blue-400" },
  partial: { label: "Partial", className: "bg-yellow-500/15 text-yellow-400" },
  unconfigured: { label: "Not set up", className: "bg-muted text-muted-foreground" },
  none: null,
};

export function SettingsOverview({ onSelect, statusMap }: SettingsOverviewProps) {
  const loadSettingsOverview = useSettingsStore((s) => s.loadSettingsOverview);

  useEffect(() => {
    loadSettingsOverview();
  }, []);

  return (
    <div className="p-5 space-y-6">
      <div>
        <h2 className="text-sm font-semibold">Settings</h2>
        <p className="text-xs text-muted-foreground mt-1">
          Configure your Otterbot instance
        </p>
      </div>

      {SETTINGS_NAV.map((group) => (
        <div key={group.label}>
          <h3 className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-2">
            {group.label}
          </h3>
          <div className="grid grid-cols-2 gap-2">
            {group.items.map((item) => {
              const status = statusMap[item.id] ?? "none";
              const badge = STATUS_BADGE[status];
              return (
                <button
                  key={item.id}
                  onClick={() => onSelect(item.id)}
                  className="flex items-start gap-3 rounded-lg border border-border p-3 bg-card hover:bg-secondary hover:border-primary/30 transition-colors text-left group"
                >
                  <NavIcon
                    icon={item.icon}
                    size={16}
                    className="text-muted-foreground group-hover:text-foreground mt-0.5 transition-colors"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium">{item.label}</span>
                      {badge && (
                        <span className={cn("text-[9px] px-1.5 py-0.5 rounded font-medium", badge.className)}>
                          {badge.label}
                        </span>
                      )}
                    </div>
                    <p className="text-[10px] text-muted-foreground mt-0.5 line-clamp-1">
                      {item.description}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
