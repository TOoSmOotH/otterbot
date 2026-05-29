import { Application, Assets, Container, Graphics, Text, Texture } from "pixi.js";
import type { AgentMessage, AgentMsgKind, AgentProfileSummary, AgentStatus } from "@otterbot/shared";
import type { PipelineRun, Project } from "../../../stores/projects-store";
import { withToken } from "../../../lib/api";
import { Cell, TILE, tilePx, type Pt } from "./geometry";
import { buildWorld, type World } from "./worldLayout";
import { findPath } from "./pathfind";
import { drawEnvironment, drawPlant, drawPrinter, loadOfficeAtlas } from "./tiles";
import { AgentToken } from "./AgentToken";
import { drawWhiteboard } from "./whiteboard";

const KIND_ACCENT: Partial<Record<AgentMsgKind, number>> = {
  request: 0x4aa3e0,
  response: 0x46c46a,
  spawn: 0xe2b13c,
  report: 0x46c46a,
  broadcast: 0x8a7ce0,
};
const WALK_KINDS: Set<AgentMsgKind> = new Set(["request", "response", "spawn", "report"]);
const MAX_WALKERS = 6;

interface DeskFx {
  container: Container;
  screen: Graphics;
  keys: Graphics;
  phase: number;
  status: AgentStatus;
}

export class OfficeScene {
  private root = new Container();
  private envLayer = new Container();
  private workstationLayer = new Container();
  private boardLayer = new Container();
  private tokenLayer = new Container();
  private ambianceLayer = new Container();
  private tokens = new Map<string, AgentToken>();
  private deskFx = new Map<string, DeskFx>();
  private boards = new Map<string, { container: Container; tx: number; ty: number; wTiles: number }>();
  private textures = new Map<string, Texture | null>();
  private world: World | null = null;
  private structureKey = "";
  private gen = 0;
  private loadedUrls = new Set<string>();
  private reduced = false;
  private clock: Text | null = null;
  private containerW = 800;
  private containerH = 600;

  constructor(private app: Application) {
    this.root.addChild(
      this.envLayer,
      this.workstationLayer,
      this.boardLayer,
      this.tokenLayer,
      this.ambianceLayer
    );
    this.app.stage.addChild(this.root);
    this.app.ticker.add(this.onTick);
  }

  private onTick = () => {
    const dt = this.app.ticker.deltaMS;
    this.updateDeskFx(dt);
    for (const tok of this.tokens.values()) tok.update(dt);
  };

  setReducedMotion(reduced: boolean): void {
    this.reduced = reduced;
    for (const tok of this.tokens.values()) tok.reduced = reduced;
  }

  resize(w: number, h: number): void {
    this.containerW = w;
    this.containerH = h;
    this.fit();
  }

  private fit(): void {
    if (!this.world) return;
    const scale = Math.min(
      this.containerW / this.world.pxWidth,
      this.containerH / this.world.pxHeight
    );
    const s = Math.max(0.2, Math.min(scale, 3));
    this.root.scale.set(s);
    this.root.x = (this.containerW - this.world.pxWidth * s) / 2;
    this.root.y = (this.containerH - this.world.pxHeight * s) / 2;
  }

  async setWorld(agents: AgentProfileSummary[], projects: Project[]): Promise<void> {
    const key =
      agents.filter((a) => a.role !== "subagent").map((a) => a.id).sort().join(",") +
      "|" +
      projects.map((p) => `${p.id}:${p.members.map((m) => m.agentId).sort().join(",")}`).join(";");
    if (key === this.structureKey && this.world) {
      for (const a of agents) {
        this.tokens.get(a.id)?.setStatus(a.status);
        this.setDeskFxStatus(a.id, a.status);
      }
      return;
    }
    const myGen = ++this.gen;
    const world = buildWorld(agents, projects);

    await loadOfficeAtlas();
    if (myGen !== this.gen) return;

    this.structureKey = key;
    this.world = world;

    this.envLayer.removeChildren().forEach((c) => c.destroy());
    this.envLayer.addChild(drawEnvironment(world));
    this.envLayer.addChild(drawPlant(1, world.rows - 2), drawPrinter(world.cols - 3, world.rows - 2));

    this.workstationLayer.removeChildren().forEach((c) => c.destroy());
    this.deskFx.clear();

    this.boardLayer.removeChildren().forEach((c) => c.destroy());
    this.boards.clear();
    for (const room of world.rooms) {
      if (room.kind !== "project" || !room.whiteboard) continue;
      const wb = drawWhiteboard(room.whiteboard.tx, room.whiteboard.ty, room.whiteboard.wTiles, null);
      this.boardLayer.addChild(wb);
      this.boards.set(room.id, { container: wb, ...room.whiteboard });
    }

    // Room name headers, so each project room is identifiable.
    for (const room of world.rooms) {
      if (!room.label) continue;
      const header = new Text({
        text: room.label,
        style: { fontSize: 8, fill: 0xb6acff, fontWeight: "700" },
      });
      header.x = room.x * TILE + 4;
      header.y = room.y * TILE + 4;
      this.envLayer.addChild(header);
    }

    const byId = new Map(agents.map((a) => [a.id, a]));
    const wantIds = new Set(Object.keys(world.deskOf));

    for (const id of wantIds) {
      const a = byId.get(id);
      if (!a) continue;
      const slot = world.deskOf[id];
      const fx = this.createDeskFx(slot.deskTx, slot.deskTy, a.status);
      this.deskFx.set(id, fx);
      this.workstationLayer.addChild(fx.container);
    }

    for (const [id, tok] of this.tokens) {
      if (!wantIds.has(id)) {
        tok.destroy();
        this.tokens.delete(id);
      }
    }

    for (const id of wantIds) {
      if (myGen !== this.gen) return;
      const a = byId.get(id)!;
      const slot = world.deskOf[id];
      const chair: Pt = { tx: slot.chairTx, ty: slot.chairTy };
      let tok = this.tokens.get(id);
      if (!tok) {
        const tex = await this.textureFor(a);
        if (myGen !== this.gen) return;
        tok = new AgentToken(id, a.displayName, tex, chair);
        tok.reduced = this.reduced;
        this.tokens.set(id, tok);
        this.tokenLayer.addChild(tok.container);
      } else {
        tok.setHome(chair);
        tok.container.x = tilePx(chair.tx);
        tok.container.y = tilePx(chair.ty);
      }
      tok.setStatus(a.status);
      this.setDeskFxStatus(id, a.status);
    }

    this.ensureAmbiance();
    this.fit();
  }

  private async textureFor(a: AgentProfileSummary): Promise<Texture | null> {
    const url = a.artwork.avatar;
    if (!url) return null;
    if (this.textures.has(url)) return this.textures.get(url)!;
    try {
      const loadUrl = withToken(url);
      const tex = (await Assets.load(loadUrl)) as Texture;
      this.loadedUrls.add(loadUrl);
      this.textures.set(url, tex);
      return tex;
    } catch {
      this.textures.set(url, null);
      return null;
    }
  }

  setStatus(agentId: string, status: AgentStatus): void {
    this.tokens.get(agentId)?.setStatus(status);
    this.setDeskFxStatus(agentId, status);
  }

  setPipeline(projectId: string, run: PipelineRun | null): void {
    const entry = this.boards.get(projectId);
    if (!entry) return;
    const next = drawWhiteboard(entry.tx, entry.ty, entry.wTiles, run);
    this.boardLayer.removeChild(entry.container);
    entry.container.destroy({ children: true });
    this.boardLayer.addChild(next);
    this.boards.set(projectId, { ...entry, container: next });
  }

  onMessage(msg: AgentMessage): void {
    if (!this.world) return;
    const accent = KIND_ACCENT[msg.kind] ?? 0x8b93a3;
    const sender = this.tokens.get(msg.from);
    if (sender && msg.body) sender.showBubble(msg.body, accent);

    if (!WALK_KINDS.has(msg.kind)) return;
    if (!msg.to) return;
    const walkers = [...this.tokens.values()].filter((t) => t.isWalking()).length;
    if (walkers >= MAX_WALKERS) return;

    const fromSlot = this.world.deskOf[msg.from];
    const toSlot = this.world.deskOf[msg.to];
    if (!fromSlot || !toSlot || !sender) return;

    const start: Pt = { tx: fromSlot.chairTx, ty: fromSlot.chairTy };
    const goal = this.adjacentFloor({ tx: toSlot.chairTx, ty: toSlot.chairTy }) ?? start;
    const there = findPath(this.world, start, goal);
    if (there.length < 2) return;
    void sender.walkPath(there).then(() => {
      const back = findPath(this.world!, goal, start);
      if (back.length >= 2) void sender.walkHome(back);
    });
  }

  private adjacentFloor(p: Pt): Pt | null {
    if (!this.world) return null;
    const { cols, rows, grid } = this.world;
    for (const [dx, dy] of [
      [0, 1],
      [1, 0],
      [-1, 0],
      [0, -1],
    ]) {
      const nx = p.tx + dx;
      const ny = p.ty + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const c = grid[ny * cols + nx] as Cell;
      if (c === Cell.FLOOR || c === Cell.DOOR) return { tx: nx, ty: ny };
    }
    return null;
  }

  private ensureAmbiance(): void {
    if (!this.world) return;
    this.ambianceLayer.removeChildren().forEach((c) => c.destroy());
    const hour = new Date().getHours();
    const day = hour >= 7 && hour < 19;
    const sky = day ? 0x7fb0d6 : 0x2a3550;
    const win = new Graphics().rect(TILE, 2, this.world.pxWidth - TILE * 2, 6).fill(sky);
    this.ambianceLayer.addChild(win);
    const hh = String(hour).padStart(2, "0");
    const mm = String(new Date().getMinutes()).padStart(2, "0");
    this.clock = new Text({ text: `${hh}:${mm}`, style: { fontSize: 8, fill: 0xd7dbe4 } });
    this.clock.x = this.world.pxWidth - 34;
    this.clock.y = 9;
    this.ambianceLayer.addChild(this.clock);
  }

  private createDeskFx(tx: number, ty: number, status: AgentStatus): DeskFx {
    const container = new Container();
    container.x = tx * TILE;
    container.y = ty * TILE;
    const screen = new Graphics();
    const keys = new Graphics();
    container.addChild(screen, keys);
    const fx = { container, screen, keys, phase: Math.random() * Math.PI * 2, status };
    this.drawDeskFx(fx, 0);
    return fx;
  }

  private setDeskFxStatus(agentId: string, status: AgentStatus): void {
    const fx = this.deskFx.get(agentId);
    if (!fx) return;
    fx.status = status;
    this.drawDeskFx(fx, 0);
  }

  private updateDeskFx(dtMs: number): void {
    for (const fx of this.deskFx.values()) {
      fx.phase = (fx.phase + dtMs / 450) % (Math.PI * 2);
      const pulse = this.reduced ? 0.45 : (Math.sin(fx.phase) + 1) / 2;
      this.drawDeskFx(fx, pulse);
    }
  }

  private drawDeskFx(fx: DeskFx, pulse: number): void {
    const active = fx.status === "working" || fx.status === "thinking" || fx.status === "waiting";
    const color =
      fx.status === "error"
        ? 0xe0584a
        : fx.status === "thinking"
          ? 0xe2b13c
          : fx.status === "waiting"
            ? 0x4aa3e0
            : active
              ? 0x42c7c7
              : 0x347c86;

    fx.screen
      .clear()
      .rect(6, 2, 4, 3)
      .fill(color)
      .rect(5, 1, 6, 1)
      .fill(0x1a2028);

    if (active || fx.status === "error") {
      const glow = pulse > 0.5 ? 0xb6fff2 : color;
      fx.screen.rect(7, 3, 2, 1).fill(glow);
    }

    fx.keys.clear().rect(5, 8, 6, 1).fill(0xd7dbe4);
    if (!active || this.reduced) {
      fx.keys.rect(6, 9, 4, 1).fill(0x8b93a3);
      return;
    }

    const tick = pulse > 0.5 ? 1 : 0;
    fx.keys
      .rect(5 + tick, 9, 1, 1)
      .fill(0xf1f3f7)
      .rect(8 - tick, 9, 1, 1)
      .fill(0xf1f3f7)
      .rect(10, 9, 1, 1)
      .fill(pulse > 0.75 ? 0xf1f3f7 : 0x8b93a3);
  }

  destroy(): void {
    this.app.ticker.remove(this.onTick);
    for (const tok of this.tokens.values()) tok.destroy();
    this.tokens.clear();
    this.root.destroy({ children: true });
    for (const u of this.loadedUrls) void Assets.unload(u).catch(() => {});
    this.loadedUrls.clear();
  }
}
