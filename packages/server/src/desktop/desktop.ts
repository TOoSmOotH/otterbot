/**
 * Desktop environment module — VNC WebSocket proxy and configuration.
 *
 * When ENABLE_DESKTOP=true, the Docker entrypoint starts Xvfb + XFCE + x11vnc.
 * This module provides:
 * - Configuration helpers (getDesktopConfig, isDesktopEnabled)
 * - A WebSocket proxy that bridges browser WebSocket ↔ VNC TCP socket
 *
 * The proxy piggybacks on Fastify's HTTP server (no extra ports) and validates
 * the sb_session cookie before allowing connections.
 */

import type { FastifyInstance } from "fastify";
import { Socket as NetSocket } from "node:net";
import { WebSocketServer, WebSocket } from "ws";
import { validateSession } from "../auth/auth.js";

export interface DesktopConfig {
  enabled: boolean;
  vncPort: number;
  resolution: string;
}

export function getDesktopConfig(): DesktopConfig {
  return {
    enabled: process.env.ENABLE_DESKTOP === "true",
    vncPort: parseInt(process.env.VNC_PORT ?? "5900", 10),
    resolution: process.env.DESKTOP_RESOLUTION ?? "1280x720x24",
  };
}

export function isDesktopEnabled(): boolean {
  return process.env.ENABLE_DESKTOP === "true";
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((c) => {
      const [key, ...val] = c.trim().split("=");
      return [key, val.join("=")];
    }),
  );
}

/**
 * Register the VNC WebSocket proxy on the Fastify server.
 *
 * Listens for WebSocket upgrades on /desktop/ws, authenticates via cookie,
 * then bridges the WebSocket to a TCP connection to x11vnc on localhost.
 */
export function registerDesktopProxy(app: FastifyInstance): void {
  const config = getDesktopConfig();

  const wss = new WebSocketServer({ noServer: true });

  app.server.on("upgrade", (req, socket, head) => {
    const url = req.url ?? "";

    // Only handle /desktop/ws — let Socket.IO handle /socket.io/
    if (!url.startsWith("/desktop/ws")) return;

    // Authenticate via cookie
    const cookies = parseCookies(req.headers.cookie);
    const token = cookies.sb_session;
    if (!validateSession(token)) {
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }

    if (!config.enabled) {
      socket.write("HTTP/1.1 503 Service Unavailable\r\n\r\n");
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  wss.on("connection", (ws) => {
    // Open TCP connection to x11vnc
    const vnc = new NetSocket();

    vnc.connect(config.vncPort, "127.0.0.1", () => {
      console.log("[desktop] VNC WebSocket client connected");
    });

    // Bridge: VNC TCP → WebSocket
    vnc.on("data", (data: Buffer) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Bridge: WebSocket → VNC TCP
    ws.on("message", (data: Buffer | ArrayBuffer | Buffer[]) => {
      if (vnc.writable) {
        if (Buffer.isBuffer(data)) {
          vnc.write(data);
        } else if (data instanceof ArrayBuffer) {
          vnc.write(Buffer.from(data));
        } else if (Array.isArray(data)) {
          for (const chunk of data) {
            vnc.write(chunk);
          }
        }
      }
    });

    // Cleanup on close
    ws.on("close", () => {
      console.log("[desktop] VNC WebSocket client disconnected");
      vnc.destroy();
    });

    ws.on("error", (err) => {
      console.error("[desktop] WebSocket error:", err.message);
      vnc.destroy();
    });

    vnc.on("error", (err) => {
      console.error("[desktop] VNC TCP error:", err.message);
      ws.close();
    });

    vnc.on("close", () => {
      ws.close();
    });
  });

  console.log(
    `[desktop] VNC proxy registered on /desktop/ws (enabled=${config.enabled}, vncPort=${config.vncPort})`,
  );
}
