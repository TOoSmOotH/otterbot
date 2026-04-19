import type { FastifyInstance } from "fastify";
import { Socket as NetSocket } from "node:net";
import { WebSocketServer, WebSocket } from "ws";
import { getConfig } from "../config.js";

/**
 * VNC WebSocket proxy. Bridges /desktop/ws connections from the browser
 * (noVNC RFB client) to the x11vnc TCP server on VNC_HOST:VNC_PORT.
 * Single-user local app; no auth layer — the VNC server itself should be
 * bound to localhost and/or set a VNC password if exposed.
 */
export function registerDesktopProxy(app: FastifyInstance): void {
  const cfg = getConfig();
  if (!cfg.enableDesktop) {
    app.get("/api/desktop/status", async () => ({ enabled: false }));
    return;
  }

  const wss = new WebSocketServer({ noServer: true });

  app.get("/api/desktop/status", async () => ({
    enabled: true,
    wsPath: "/desktop/ws",
  }));

  app.server.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";
    if (!url.startsWith("/desktop/ws")) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    const vnc = new NetSocket();
    vnc.connect(cfg.vncPort, cfg.vncHost, () => {
      console.log(`[desktop] VNC client connected → ${cfg.vncHost}:${cfg.vncPort}`);
    });

    vnc.on("data", (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });

    ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      if (!vnc.writable) return;
      if (Buffer.isBuffer(data)) vnc.write(data);
      else if (data instanceof ArrayBuffer) vnc.write(Buffer.from(data));
      else if (Array.isArray(data)) for (const chunk of data) vnc.write(chunk);
    });

    ws.on("close", () => vnc.destroy());
    ws.on("error", (err) => {
      console.error("[desktop] ws error:", err.message);
      vnc.destroy();
    });
    vnc.on("error", (err) => {
      console.error("[desktop] vnc error:", err.message);
      ws.close();
    });
    vnc.on("close", () => ws.close());
  });

  console.log(
    `[desktop] VNC proxy registered on /desktop/ws → ${cfg.vncHost}:${cfg.vncPort}`,
  );
}
