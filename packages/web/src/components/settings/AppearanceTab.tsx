import { useThemeStore, type Theme } from "../../stores/theme-store";
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

export function AppearanceTab() {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);

  return (
    <div className="p-5 space-y-4">
      <div>
        <h3 className="text-xs font-semibold mb-1">Theme</h3>
        <p className="text-xs text-muted-foreground mb-3">
          Choose how Otterbot looks.
        </p>
      </div>

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
  );
}
