import type { CSSProperties } from "react";

export const fonts = {
  sans: "var(--font-sans)",
  mono: "var(--font-mono)",
} as const;

export const type = {
  display: {
    fontSize: 24,
    lineHeight: 1.2,
    fontWeight: 600,
    letterSpacing: "-0.02em",
  },
  h1: {
    fontSize: 18,
    lineHeight: 1.35,
    fontWeight: 600,
    letterSpacing: "-0.01em",
  },
  h2: {
    fontSize: 14,
    lineHeight: 1.4,
    fontWeight: 600,
  },
  body: {
    fontSize: 13,
    lineHeight: 1.55,
    fontWeight: 400,
  },
  ui: {
    fontSize: 12,
    lineHeight: 1.4,
    fontWeight: 500,
  },
  small: {
    fontSize: 11,
    lineHeight: 1.4,
    fontWeight: 400,
  },
  micro: {
    fontSize: 10,
    lineHeight: 1.2,
    fontWeight: 600,
    letterSpacing: "0.04em",
  },
  mono: {
    fontSize: 12,
    lineHeight: 1.5,
    fontWeight: 400,
    fontFamily: fonts.mono,
  },
  monoSm: {
    fontSize: 11,
    lineHeight: 1.4,
    fontWeight: 400,
    fontFamily: fonts.mono,
  },
} as const satisfies Record<string, CSSProperties>;
