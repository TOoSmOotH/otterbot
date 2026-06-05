import { LayoutGroup, motion } from "motion/react";
import { Icon } from "./Icon";
import type { LucideIcon } from "lucide-react";

export interface TabSpec<T extends string> {
  id: T;
  label: string;
  icon?: LucideIcon;
}

interface TabsProps<T extends string> {
  tabs: TabSpec<T>[];
  value: T;
  onChange: (id: T) => void;
  layoutId?: string;
}

export function Tabs<T extends string>({ tabs, value, onChange, layoutId = "tabs" }: TabsProps<T>) {
  return (
    <div className="flex gap-0.5 border-b border-border px-2 bg-bg">
      <LayoutGroup id={layoutId}>
        {tabs.map((t) => {
          const active = t.id === value;
          return (
            <button
              key={t.id}
              type="button"
              data-testid={`${layoutId}-${t.id}`}
              onClick={() => onChange(t.id)}
              className={`relative inline-flex items-center gap-1.5 px-3 py-2.5 cursor-pointer border-0 bg-transparent text-ui ${
                active ? "text-fg font-semibold" : "text-muted hover:text-fg font-medium"
              }`}
            >
              {t.icon && <Icon icon={t.icon} size={14} />}
              {t.label}
              {active && (
                <motion.span
                  layoutId={`${layoutId}-indicator`}
                  transition={{ type: "spring", stiffness: 480, damping: 38 }}
                  className="absolute left-2 right-2 -bottom-px h-0.5 bg-accent rounded-sm"
                />
              )}
            </button>
          );
        })}
      </LayoutGroup>
    </div>
  );
}
