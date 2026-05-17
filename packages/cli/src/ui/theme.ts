/** Shared colors and glyphs for the terminal UI. */

export const colors = {
  brand: "#5ec8d8",
  brandAlt: "#8a7fff",
  user: "cyan",
  assistant: "white",
  tool: "#9aa0a6",
  thinking: "#7a7f87",
  error: "red",
  dim: "gray",
  online: "green",
  reconnecting: "yellow",
  offline: "red",
} as const;

export const glyphs = {
  user: "›",
  assistant: "⬢",
  tool: "⚙",
  dot: "●",
  caret: "❯",
} as const;

/** Otterbot gradient banner stops. */
export const bannerGradient = [colors.brand, colors.brandAlt] as const;
