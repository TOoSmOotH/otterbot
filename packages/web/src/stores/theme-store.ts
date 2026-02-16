import { create } from "zustand";

export type Theme = "dark" | "otter" | "light";

interface ThemeState {
  theme: Theme;
  setTheme: (theme: Theme) => void;
}

function getInitialTheme(): Theme {
  const stored = localStorage.getItem("otterbot-theme") as Theme | null;
  if (stored && ["dark", "otter", "light"].includes(stored)) return stored;

  if (window.matchMedia("(prefers-color-scheme: light)").matches) return "light";
  return "otter";
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.setAttribute("data-theme", theme);

  if (theme === "light") {
    root.classList.remove("dark");
  } else {
    root.classList.add("dark");
  }

  localStorage.setItem("otterbot-theme", theme);
}

// Apply immediately to prevent flash
const initialTheme = getInitialTheme();
applyTheme(initialTheme);

export const useThemeStore = create<ThemeState>((set) => ({
  theme: initialTheme,
  setTheme: (theme) => {
    applyTheme(theme);
    set({ theme });
  },
}));

// Listen for OS preference changes when no stored preference
if (!localStorage.getItem("otterbot-theme")) {
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", (e) => {
    if (localStorage.getItem("otterbot-theme")) return;
    const theme: Theme = e.matches ? "light" : "otter";
    applyTheme(theme);
    useThemeStore.setState({ theme });
  });
}
