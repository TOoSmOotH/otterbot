import { useThemeStore, type Theme } from "../../stores/theme-store";
import { useUIModeStore, type UIMode } from "../../stores/ui-mode-store";
import { cn } from "../../lib/utils";

const THEMES: { id: Theme; label: string; description: string; swatches: string[] }[] = [
  {
    id: "dark",
    label: "Dark",
    description: "Neutral dark with blue accents",
    swatches: ["hsl(0 0% 7%)", "hsl(0 0% 9%)", "hsl(217 92% 60%)"],
  },
  {
    id: "otter",
    label: "Otter",
    description: "Navy & cyan brand palette",
    swatches: ["hsl(216 57% 10%)", "hsl(216 62% 16%)", "hsl(191 100% 50%)"],
  },
  {
    id: "light",
    label: "Light",
    description: "Light with teal accents",
    swatches: ["hsl(195 30% 97%)", "hsl(0 0% 100%)", "hsl(189 93% 36%)"],
  },
];

const MODES: { id: UIMode; label: string; description: string; icon: string }[] = [
  {
    id: "basic",
    label: "Basic",
    description: "Clean, focused interface for everyday use",
    icon: "M4 6h16M4 12h8M4 18h16", // simplified menu lines
  },
  {
    id: "advanced",
    label: "Advanced",
    description: "Full access to all features and tools",
    icon: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6", // sliders
  },
];

export function AppearanceTab() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const uiMode = useUIModeStore((s) => s.mode);
  const setMode = useUIModeStore((s) => s.setMode);

  return (
    <div className="p-5 space-y-6">
      {/* Theme */}
      <div>
        <h3 className="text-xs font-semibold mb-1">Theme</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Choose how Otterbot looks.
        </p>

        <div className="grid grid-cols-3 gap-3">
          {THEMES.map((t) => (
            <button
              key={t.id}
              onClick={() => setTheme(t.id)}
              className={cn(
                "flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors",
                theme === t.id
                  ? "border-primary ring-1 ring-primary"
                  : "border-border hover:border-muted-foreground/40",
              )}
            >
              {/* Color swatch preview */}
              <div className="flex gap-1.5 w-full">
                {t.swatches.map((color, i) => (
                  <div
                    key={i}
                    className="h-6 flex-1 rounded"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <div>
                <p className="text-xs font-medium">{t.label}</p>
                <p className="text-[10px] text-muted-foreground">{t.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Interface Mode */}
      <div>
        <h3 className="text-xs font-semibold mb-1">Interface Mode</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Control which features are visible. You can also toggle this from the header.
        </p>

        <div className="grid grid-cols-2 gap-3">
          {MODES.map((m) => (
            <button
              key={m.id}
              onClick={() => setMode(m.id)}
              className={cn(
                "flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors",
                uiMode === m.id
                  ? "border-primary ring-1 ring-primary"
                  : "border-border hover:border-muted-foreground/40",
              )}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className="text-muted-foreground"
              >
                <path d={m.icon} />
              </svg>
              <div>
                <p className="text-xs font-medium">{m.label}</p>
                <p className="text-[10px] text-muted-foreground">{m.description}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
