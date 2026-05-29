import { useEffect, useRef } from "react";
import { Application } from "pixi.js";
import { useAgentsStore } from "../../../stores/agents-store";
import { useActivityStore } from "../../../stores/activity-store";
import { useProjectsStore } from "../../../stores/projects-store";
import { type } from "../../../lib/typography";
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
      ro?.disconnect();
      for (const u of unsubs) u();
      scene?.destroy();
      // Only destroy the Pixi Application if init() completed — calling destroy()
      // on a partially-initialised app throws because internal teardown hooks
      // (e.g. _cancelResize) haven't been wired up yet.
      if (appReady) app?.destroy(true);
    };
  }, []);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%", minHeight: 0 }}>
      <div ref={hostRef} style={{ position: "absolute", inset: 0 }} />
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
