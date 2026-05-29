import { Container, Graphics, Sprite, Text, Texture } from "pixi.js";
import { TILE, tilePx, type Pt } from "./geometry";
import type { AgentStatus } from "@otterbot/shared";

const STATUS_HEX: Record<AgentStatus, number> = {
  working: 0x46c46a,
  thinking: 0xe2b13c,
  waiting: 0x4aa3e0,
  error: 0xe0584a,
  stopped: 0x8b93a3,
  idle: 0x8b93a3,
};

const WALK_SPEED = 60 / 1000; // px per ms

export class AgentToken {
  readonly container = new Container();
  private ring = new Graphics();
  private bubble: Container | null = null;
  private bubbleTtl = 0;
  private path: Pt[] = [];
  private pathI = 0;
  private resolveWalk: (() => void) | null = null;
  private homeChair: Pt;
  private bobPhase = 0;
  reduced = false;

  constructor(
    readonly agentId: string,
    displayName: string,
    texture: Texture | null,
    chair: Pt
  ) {
    this.homeChair = chair;
    this.container.addChild(this.ring);

    const size = TILE + 6;
    if (texture) {
      const s = new Sprite(texture);
      s.width = size;
      s.height = size;
      s.anchor.set(0.5);
      this.container.addChild(s);
    } else {
      const chip = new Graphics().roundRect(-size / 2, -size / 2, size, size, 4).fill(0xc8cdd8);
      const initials = displayName.trim().slice(0, 2).toUpperCase() || "??";
      const t = new Text({ text: initials, style: { fontSize: 10, fill: 0x222222, fontWeight: "700" } });
      t.anchor.set(0.5);
      this.container.addChild(chip, t);
    }

    const label = new Text({
      text: displayName,
      style: { fontSize: 8, fill: 0xd7dbe4, align: "center" },
    });
    label.anchor.set(0.5, 0);
    label.y = size / 2 + 1;
    this.container.addChild(label);

    this.container.x = tilePx(chair.tx);
    this.container.y = tilePx(chair.ty);
    this.setStatus("idle");
  }

  setStatus(status: AgentStatus): void {
    const color = STATUS_HEX[status];
    const size = TILE + 6;
    this.ring.clear().roundRect(-size / 2 - 2, -size / 2 - 2, size + 4, size + 4, 6).stroke({ width: 2, color });
  }

  showBubble(text: string, accent: number): void {
    if (this.bubble) {
      this.container.removeChild(this.bubble);
      this.bubble.destroy();
    }
    const b = new Container();
    const msg = text.length > 42 ? text.slice(0, 42) + "…" : text;
    const t = new Text({ text: msg, style: { fontSize: 8, fill: 0x20242c, wordWrap: true, wordWrapWidth: 120 } });
    const padX = 5;
    const padY = 3;
    const bg = new Graphics()
      .roundRect(-padX, -padY, t.width + padX * 2, t.height + padY * 2, 4)
      .fill(0xe9ead2)
      .stroke({ width: 1, color: accent });
    b.addChild(bg, t);
    b.x = -t.width / 2;
    b.y = -(TILE + 6) / 2 - t.height - 10;
    this.container.addChild(b);
    this.bubble = b;
    this.bubbleTtl = 3500;
  }

  /** Begin walking along a tile path. Resolves when the token arrives. */
  walkPath(path: Pt[]): Promise<void> {
    if (this.reduced || path.length < 2) {
      const end = path[path.length - 1] ?? this.homeChair;
      this.container.x = tilePx(end.tx);
      this.container.y = tilePx(end.ty);
      return Promise.resolve();
    }
    this.path = path;
    this.pathI = 1;
    return new Promise((res) => (this.resolveWalk = res));
  }

  walkHome(path: Pt[]): Promise<void> {
    return this.walkPath(path);
  }

  isWalking(): boolean {
    return this.path.length > 0;
  }

  /** Advance animation by dtMs. Called from the scene ticker. */
  update(dtMs: number): void {
    if (this.bubble) {
      this.bubbleTtl -= dtMs;
      if (this.bubbleTtl <= 0) {
        this.container.removeChild(this.bubble);
        this.bubble.destroy();
        this.bubble = null;
      }
    }

    if (this.path.length > 0) {
      const target = this.path[this.pathI];
      const tx = tilePx(target.tx);
      const ty = tilePx(target.ty);
      const dx = tx - this.container.x;
      const dy = ty - this.container.y;
      const dist = Math.hypot(dx, dy);
      const step = WALK_SPEED * dtMs;
      if (dist <= step) {
        this.container.x = tx;
        this.container.y = ty;
        this.pathI++;
        if (this.pathI >= this.path.length) {
          this.path = [];
          this.pathI = 0;
          const r = this.resolveWalk;
          this.resolveWalk = null;
          r?.();
        }
      } else {
        this.container.x += (dx / dist) * step;
        this.container.y += (dy / dist) * step;
      }
      return;
    }

    if (!this.reduced) {
      this.bobPhase = (this.bobPhase + dtMs / 600) % (Math.PI * 2);
      this.container.y = tilePx(this.homeChair.ty) + Math.sin(this.bobPhase) * 1.2;
    }
  }

  setHome(chair: Pt): void {
    this.homeChair = chair;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
