function svg(content: string): string {
  return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256">${content}</svg>`)}`;
}

export const DEFAULT_AVATARS: { id: string; label: string; url: string }[] = [
  {
    id: "gradient-sunset",
    label: "Sunset",
    url: svg(
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#f97316"/><stop offset="100%" stop-color="#ec4899"/></linearGradient></defs>` +
      `<rect width="256" height="256" fill="url(#g)"/>` +
      `<circle cx="128" cy="96" r="40" fill="rgba(255,255,255,0.25)"/>` +
      `<circle cx="128" cy="80" r="28" fill="rgba(255,255,255,0.3)"/>` +
      `<rect x="48" y="160" width="160" height="96" rx="80" fill="rgba(255,255,255,0.2)"/>`
    ),
  },
  {
    id: "gradient-ocean",
    label: "Ocean",
    url: svg(
      `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#06b6d4"/><stop offset="100%" stop-color="#3b82f6"/></linearGradient></defs>` +
      `<rect width="256" height="256" fill="url(#g)"/>` +
      `<path d="M0 160 Q64 130 128 160 T256 160 V256 H0Z" fill="rgba(255,255,255,0.15)"/>` +
      `<path d="M0 180 Q64 150 128 180 T256 180 V256 H0Z" fill="rgba(255,255,255,0.12)"/>` +
      `<circle cx="180" cy="70" r="32" fill="rgba(255,255,255,0.2)"/>`
    ),
  },
  {
    id: "gradient-forest",
    label: "Forest",
    url: svg(
      `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#22c55e"/><stop offset="100%" stop-color="#15803d"/></linearGradient></defs>` +
      `<rect width="256" height="256" fill="url(#g)"/>` +
      `<polygon points="128,50 180,140 76,140" fill="rgba(255,255,255,0.2)"/>` +
      `<polygon points="128,80 200,190 56,190" fill="rgba(255,255,255,0.15)"/>` +
      `<rect x="118" y="190" width="20" height="30" fill="rgba(255,255,255,0.18)"/>`
    ),
  },
  {
    id: "gradient-lavender",
    label: "Lavender",
    url: svg(
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#a78bfa"/><stop offset="100%" stop-color="#7c3aed"/></linearGradient></defs>` +
      `<rect width="256" height="256" fill="url(#g)"/>` +
      `<circle cx="128" cy="128" r="56" fill="rgba(255,255,255,0.15)"/>` +
      `<circle cx="128" cy="128" r="36" fill="rgba(255,255,255,0.15)"/>` +
      `<circle cx="128" cy="128" r="16" fill="rgba(255,255,255,0.2)"/>`
    ),
  },
  {
    id: "gradient-ember",
    label: "Ember",
    url: svg(
      `<defs><linearGradient id="g" x1="0" y1="1" x2="1" y2="0"><stop offset="0%" stop-color="#dc2626"/><stop offset="100%" stop-color="#f59e0b"/></linearGradient></defs>` +
      `<rect width="256" height="256" fill="url(#g)"/>` +
      `<path d="M128 60 L168 120 L148 120 L188 200 L108 140 L128 140 L88 60Z" fill="rgba(255,255,255,0.2)"/>`
    ),
  },
  {
    id: "gradient-arctic",
    label: "Arctic",
    url: svg(
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#e0f2fe"/><stop offset="100%" stop-color="#0ea5e9"/></linearGradient></defs>` +
      `<rect width="256" height="256" fill="url(#g)"/>` +
      `<polygon points="128,60 148,110 200,110 158,145 174,200 128,168 82,200 98,145 56,110 108,110" fill="rgba(255,255,255,0.3)"/>`
    ),
  },
  {
    id: "gradient-midnight",
    label: "Midnight",
    url: svg(
      `<defs><linearGradient id="g" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#1e1b4b"/><stop offset="100%" stop-color="#312e81"/></linearGradient></defs>` +
      `<rect width="256" height="256" fill="url(#g)"/>` +
      `<circle cx="180" cy="76" r="36" fill="rgba(255,255,255,0.12)"/>` +
      `<circle cx="180" cy="76" r="36" fill="url(#g)" transform="translate(12,0)"/>` +
      `<circle cx="80" cy="180" r="4" fill="rgba(255,255,255,0.3)"/>` +
      `<circle cx="200" cy="200" r="3" fill="rgba(255,255,255,0.25)"/>` +
      `<circle cx="60" cy="80" r="3" fill="rgba(255,255,255,0.2)"/>` +
      `<circle cx="150" cy="160" r="2" fill="rgba(255,255,255,0.3)"/>` +
      `<circle cx="100" cy="120" r="2" fill="rgba(255,255,255,0.15)"/>`
    ),
  },
  {
    id: "gradient-peach",
    label: "Peach",
    url: svg(
      `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#fda4af"/><stop offset="100%" stop-color="#fb923c"/></linearGradient></defs>` +
      `<rect width="256" height="256" fill="url(#g)"/>` +
      `<rect x="68" y="68" width="120" height="120" rx="28" fill="rgba(255,255,255,0.18)" transform="rotate(15,128,128)"/>` +
      `<rect x="88" y="88" width="80" height="80" rx="18" fill="rgba(255,255,255,0.15)" transform="rotate(30,128,128)"/>`
    ),
  },
];
