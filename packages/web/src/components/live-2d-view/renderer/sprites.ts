/**
 * Procedural 16x16 pixel art sprite generator.
 * 0=transparent, 1=outline, 2=skin, 3=role-color (shirt), 4=hair, 5=pants, 6=shoes
 */

// Top-down otter-like character template (facing down)
// prettier-ignore
const SPRITE_TEMPLATE: number[][] = [
  [0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,0],
  [0,0,0,0,1,4,4,4,4,4,4,1,0,0,0,0],
  [0,0,0,1,4,4,4,4,4,4,4,4,1,0,0,0],
  [0,0,0,1,4,2,4,4,4,4,2,4,1,0,0,0],
  [0,0,1,4,2,2,2,2,2,2,2,2,4,1,0,0],
  [0,0,1,2,2,1,2,2,2,2,1,2,2,1,0,0],
  [0,0,1,2,2,2,2,2,2,2,2,2,2,1,0,0],
  [0,0,0,1,2,2,2,1,1,2,2,2,1,0,0,0],
  [0,0,0,0,1,3,3,3,3,3,3,1,0,0,0,0],
  [0,0,0,1,3,3,3,3,3,3,3,3,1,0,0,0],
  [0,0,1,3,3,3,3,3,3,3,3,3,3,1,0,0],
  [0,0,1,2,3,3,3,3,3,3,3,3,2,1,0,0],
  [0,0,0,1,5,5,5,5,5,5,5,5,1,0,0,0],
  [0,0,0,1,5,5,5,5,5,5,5,5,1,0,0,0],
  [0,0,0,1,6,6,1,0,0,1,6,6,1,0,0,0],
  [0,0,0,0,1,1,0,0,0,0,1,1,0,0,0,0],
];

// Walking frame 1: left leg forward
// prettier-ignore
const WALK_TEMPLATE_1: number[][] = [
  [0,0,0,0,0,1,1,1,1,1,1,0,0,0,0,0],
  [0,0,0,0,1,4,4,4,4,4,4,1,0,0,0,0],
  [0,0,0,1,4,4,4,4,4,4,4,4,1,0,0,0],
  [0,0,0,1,4,2,4,4,4,4,2,4,1,0,0,0],
  [0,0,1,4,2,2,2,2,2,2,2,2,4,1,0,0],
  [0,0,1,2,2,1,2,2,2,2,1,2,2,1,0,0],
  [0,0,1,2,2,2,2,2,2,2,2,2,2,1,0,0],
  [0,0,0,1,2,2,2,1,1,2,2,2,1,0,0,0],
  [0,0,0,0,1,3,3,3,3,3,3,1,0,0,0,0],
  [0,0,0,1,3,3,3,3,3,3,3,3,1,0,0,0],
  [0,0,1,3,3,3,3,3,3,3,3,3,3,1,0,0],
  [0,0,1,2,3,3,3,3,3,3,3,3,2,1,0,0],
  [0,0,1,5,5,5,5,1,0,1,5,5,1,0,0,0],
  [0,1,5,5,5,5,1,0,0,0,1,5,5,1,0,0],
  [0,1,6,6,1,0,0,0,0,0,0,1,6,1,0,0],
  [0,0,1,1,0,0,0,0,0,0,0,0,1,0,0,0],
];

const SKIN_COLOR = "#f4c89a";
const HAIR_COLOR = "#5c4033";
const PANTS_COLOR = "#374151";
const SHOE_COLOR = "#1f2937";
const OUTLINE_COLOR = "#111111";

const COLOR_MAP: Record<number, string> = {
  1: OUTLINE_COLOR,
  2: SKIN_COLOR,
  4: HAIR_COLOR,
  5: PANTS_COLOR,
  6: SHOE_COLOR,
};

const spriteCache = new Map<string, HTMLCanvasElement>();

function renderSprite(template: number[][], roleColor: string): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = 16;
  canvas.height = 16;
  const ctx = canvas.getContext("2d")!;
  ctx.clearRect(0, 0, 16, 16);

  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const val = template[y][x];
      if (val === 0) continue;
      if (val === 3) {
        ctx.fillStyle = roleColor;
      } else {
        ctx.fillStyle = COLOR_MAP[val] ?? OUTLINE_COLOR;
      }
      ctx.fillRect(x, y, 1, 1);
    }
  }

  return canvas;
}

/** Get a cached sprite for the given role color and frame. Frame 0 = idle, frame 1 = walk. */
export function getSprite(roleColor: string, frame: number): HTMLCanvasElement {
  const key = `${roleColor}-${frame}`;
  let cached = spriteCache.get(key);
  if (!cached) {
    const template = frame === 1 ? WALK_TEMPLATE_1 : SPRITE_TEMPLATE;
    cached = renderSprite(template, roleColor);
    spriteCache.set(key, cached);
  }
  return cached;
}
