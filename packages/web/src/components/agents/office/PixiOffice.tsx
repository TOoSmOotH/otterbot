import { type CSSProperties, useEffect, useRef, useState } from "react";
import { Application } from "pixi.js";
import { Maximize2, Minus, Plus } from "lucide-react";
import { useAgentsStore } from "../../../stores/agents-store";
import { useActivityStore } from "../../../stores/activity-store";
import { useProjectsStore } from "../../../stores/projects-store";
import { type } from "../../../lib/typography";
import { Icon } from "../../ui/Icon";
import { OfficeScene } from "./OfficeScene";

/**
 * The Office sub-tab: a PixiJS pixel-art office. A single Pixi Application is
 * created here; we subscribe to the Zustand stores with their vanilla
 * `.subscribe()` so Socket.IO traffic drives the scene imperatively without
 * re-rendering React.
 */
export function PixiOffice() {
  const hostRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<OfficeScene | null>(null);
  const dragRef = useRef<{ id: number; x: number; y: number } | null>(null);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    let scene: OfficeScene | null = null;
    let app: Application | null = null;
    let appReady = false;
    let ro: ResizeObserver | null = null;
    const unsubs: Array<() => void> = [];
    let cancelled = false;
    const host = hostRef.current;
    if (!host) return;

    const agentsStore = useAgentsStore.getState();
    const activityStore = useActivityStore.getState();
    const projectsStore = useProjectsStore.getState();
    agentsStore.bindSocket();
    void agentsStore.load();
    activityStore.bindSocket();
    void activityStore.load();
    projectsStore.bindSocket();
    void projectsStore.load();

    const onPointerDown = (event: PointerEvent) => {
      if (event.button !== 0) return;
      dragRef.current = { id: event.pointerId, x: event.clientX, y: event.clientY };
      host.setPointerCapture(event.pointerId);
      host.style.cursor = "grabbing";
    };

    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.id !== event.pointerId) return;
      const dx = event.clientX - drag.x;
      const dy = event.clientY - drag.y;
      dragRef.current = { id: drag.id, x: event.clientX, y: event.clientY };
      sceneRef.current?.panBy(dx, dy);
    };

    const finishPointer = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || drag.id !== event.pointerId) return;
      dragRef.current = null;
      if (host.hasPointerCapture(event.pointerId)) host.releasePointerCapture(event.pointerId);
      host.style.cursor = "grab";
    };

    host.style.cursor = "grab";
    host.addEventListener("pointerdown", onPointerDown);
    host.addEventListener("pointermove", onPointerMove);
    host.addEventListener("pointerup", finishPointer);
    host.addEventListener("pointercancel", finishPointer);

    (async () => {
      app = new Application();
      try {
        await app.init({
          resizeTo: host,
          antialias: false,
          backgroundColor: 0x1a1c22,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
          autoDensity: true,
          // Fall back to the 2D-canvas renderer when WebGL is unavailable
          // (e.g. headless CI). WebGL is still preferred in normal browsers.
          preference: ["webgl", "canvas"],
        });
      } catch {
        if (errorRef.current) errorRef.current.style.display = "flex";
        return;
      }
      appReady = true;
      if (cancelled) {
        app.destroy(true);
        return;
      }
      host.appendChild(app.canvas);
      scene = new OfficeScene(app);
      scene.setZoom(zoom);
      sceneRef.current = scene;

      const mql = window.matchMedia("(prefers-reduced-motion: reduce)");
      scene.setReducedMotion(mql.matches);
      const onMql = () => scene?.setReducedMotion(mql.matches);
      mql.addEventListener("change", onMql);
      unsubs.push(() => mql.removeEventListener("change", onMql));

      ro = new ResizeObserver(() => scene?.resize(host.clientWidth, host.clientHeight));
      ro.observe(host);
      scene.resize(host.clientWidth, host.clientHeight);

      const a0 = useAgentsStore.getState().agents;
      const p0 = useProjectsStore.getState().projects;
      void scene.setWorld(a0, p0);
      for (const p of p0) void useProjectsStore.getState().loadRuns(p.id);

      let lastAgents = a0;
      unsubs.push(
        useAgentsStore.subscribe((s) => {
          if (s.agents === lastAgents) return;
          lastAgents = s.agents;
          void scene?.setWorld(s.agents, useProjectsStore.getState().projects);
        })
      );

      const lastRunId = new Map<string, string | null>();
      let lastProjects = p0;
      unsubs.push(
        useProjectsStore.subscribe((s) => {
          if (s.projects !== lastProjects) {
            lastProjects = s.projects;
            void scene?.setWorld(useAgentsStore.getState().agents, s.projects);
          }
          for (const [pid, runs] of Object.entries(s.runs)) {
            const top = runs[0] ?? null;
            const id = top ? top.id : null;
            if (lastRunId.get(pid) === id) continue;
            lastRunId.set(pid, id);
            scene?.setPipeline(pid, top);
          }
        })
      );

      let lastSeq = -1;
      const seedSeq = () => {
        const msgs = useActivityStore.getState().messages;
        lastSeq = msgs.length ? msgs[msgs.length - 1].seq : -1;
      };
      seedSeq();
      unsubs.push(
        useActivityStore.subscribe((s) => {
          const msgs = s.messages;
          if (!msgs.length) return;
          const fresh = msgs.filter((m) => m.seq > lastSeq);
          lastSeq = msgs[msgs.length - 1].seq;
          for (const m of fresh) scene?.onMessage(m);
        })
      );
    })();

    return () => {
      cancelled = true;
      dragRef.current = null;
      host.removeEventListener("pointerdown", onPointerDown);
      host.removeEventListener("pointermove", onPointerMove);
      host.removeEventListener("pointerup", finishPointer);
      host.removeEventListener("pointercancel", finishPointer);
      host.style.cursor = "";
      ro?.disconnect();
      for (const u of unsubs) u();
      scene?.destroy();
      sceneRef.current = null;
      // Only destroy the Pixi Application if init() completed — calling destroy()
      // on a partially-initialised app throws because internal teardown hooks
      // (e.g. _cancelResize) haven't been wired up yet.
      if (appReady) app?.destroy(true);
    };
  }, []);

  useEffect(() => {
    sceneRef.current?.setZoom(zoom);
  }, [zoom]);

  const setClampedZoom = (next: number) => {
    setZoom(Math.max(0.5, Math.min(1.8, Number(next.toFixed(2)))));
  };

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 0 }}>
      <div ref={hostRef} style={{ position: "absolute", inset: 0, touchAction: "none" }} />
      <div style={zoomControlsStyle} aria-label="Office zoom controls">
        <button
          type="button"
          aria-label="Zoom out"
          title="Zoom out"
          style={zoomButtonStyle}
          onClick={() => setClampedZoom(zoom - 0.1)}
        >
          <Icon icon={Minus} size={14} />
        </button>
        <input
          aria-label="Office zoom"
          type="range"
          min="0.5"
          max="1.8"
          step="0.05"
          value={zoom}
          onChange={(event) => setClampedZoom(Number(event.currentTarget.value))}
          style={zoomSliderStyle}
        />
        <button
          type="button"
          aria-label="Zoom in"
          title="Zoom in"
          style={zoomButtonStyle}
          onClick={() => setClampedZoom(zoom + 0.1)}
        >
          <Icon icon={Plus} size={14} />
        </button>
        <button
          type="button"
          aria-label="Reset zoom"
          title="Reset zoom"
          style={zoomButtonStyle}
          onClick={() => {
            sceneRef.current?.resetPan();
            setClampedZoom(1);
          }}
        >
          <Icon icon={Maximize2} size={14} />
        </button>
        <span style={zoomValueStyle}>{Math.round(zoom * 100)}%</span>
      </div>
      <div
        ref={errorRef}
        style={{
          display: "none",
          position: "absolute",
          inset: 0,
          alignItems: "center",
          justifyContent: "center",
          color: "rgb(var(--muted))",
          ...type.body,
        }}
      >
        The office view needs WebGL, which isn't available in this browser.
      </div>
    </div>
  );
}

const zoomControlsStyle: CSSProperties = {
  position: "absolute",
  top: 10,
  right: 10,
  display: "flex",
  alignItems: "center",
  gap: 6,
  padding: "6px 8px",
  background: "rgb(var(--surface) / 0.9)",
  border: "1px solid rgb(var(--border))",
  borderRadius: 8,
  boxShadow: "0 10px 24px rgba(0, 0, 0, 0.22)",
  backdropFilter: "blur(10px)",
};

const zoomButtonStyle: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  width: 28,
  height: 28,
  color: "rgb(var(--fg))",
  background: "rgb(var(--surface-elevated))",
  border: "1px solid rgb(var(--border))",
  borderRadius: 7,
  cursor: "pointer",
};

const zoomSliderStyle: CSSProperties = {
  width: 96,
  accentColor: "rgb(var(--accent))",
};

const zoomValueStyle: CSSProperties = {
  minWidth: 38,
  color: "rgb(var(--muted))",
  textAlign: "right",
  ...type.mono,
  fontSize: 12,
};
