/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "rgb(var(--bg) / <alpha-value>)",
        surface: "rgb(var(--surface) / <alpha-value>)",
        "surface-elevated": "rgb(var(--surface-elevated) / <alpha-value>)",
        "surface-sunken": "rgb(var(--surface-sunken) / <alpha-value>)",
        fg: "rgb(var(--fg) / <alpha-value>)",
        muted: "rgb(var(--muted) / <alpha-value>)",
        subtle: "rgb(var(--subtle) / <alpha-value>)",
        border: "rgb(var(--border) / <alpha-value>)",
        "border-strong": "rgb(var(--border-strong) / <alpha-value>)",
        ring: "rgb(var(--ring) / <alpha-value>)",
        accent: "rgb(var(--accent) / <alpha-value>)",
        "accent-fg": "rgb(var(--accent-fg) / <alpha-value>)",
        "accent-hover": "rgb(var(--accent-hover) / <alpha-value>)",
        success: "rgb(var(--success) / <alpha-value>)",
        "success-bg": "rgb(var(--success-bg) / <alpha-value>)",
        warning: "rgb(var(--warning) / <alpha-value>)",
        "warning-bg": "rgb(var(--warning-bg) / <alpha-value>)",
        info: "rgb(var(--info) / <alpha-value>)",
        "info-bg": "rgb(var(--info-bg) / <alpha-value>)",
        danger: "rgb(var(--danger) / <alpha-value>)",
        "danger-bg": "rgb(var(--danger-bg) / <alpha-value>)",
        neutral: "rgb(var(--neutral) / <alpha-value>)",
        "neutral-bg": "rgb(var(--neutral-bg) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["Geist Variable", "ui-sans-serif", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono Variable", "ui-monospace", "SF Mono", "Menlo", "monospace"],
      },
      fontSize: {
        display: ["24px", { lineHeight: "1.2", letterSpacing: "-0.02em", fontWeight: "600" }],
        h1: ["18px", { lineHeight: "1.35", letterSpacing: "-0.01em", fontWeight: "600" }],
        h2: ["14px", { lineHeight: "1.4", fontWeight: "600" }],
        body: ["13px", { lineHeight: "1.55" }],
        ui: ["12px", { lineHeight: "1.4", fontWeight: "500" }],
        small: ["11px", { lineHeight: "1.4" }],
        micro: ["10px", { lineHeight: "1.2", fontWeight: "600", letterSpacing: "0.04em" }],
      },
      borderRadius: {
        DEFAULT: "6px",
        sm: "4px",
        md: "8px",
        lg: "12px",
      },
      boxShadow: {
        sm: "var(--shadow-sm)",
        DEFAULT: "var(--shadow-md)",
        lg: "var(--shadow-lg)",
      },
      transitionTimingFunction: {
        DEFAULT: "cubic-bezier(0.2, 0.8, 0.2, 1)",
      },
      transitionDuration: {
        DEFAULT: "180ms",
        fast: "120ms",
        slow: "260ms",
      },
      ringColor: {
        DEFAULT: "rgb(var(--ring) / 0.4)",
      },
    },
  },
  plugins: [],
};
