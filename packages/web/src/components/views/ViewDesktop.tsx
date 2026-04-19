import { useCallback, useEffect, useRef, useState } from "react";
import { useDesktopStore } from "../../stores/desktop-store";

/**
 * Dynamically imports noVNC's RFB class (served by the server under /novnc/)
 * and connects it to the VNC WebSocket proxy at the path the server
 * advertised in /api/desktop/status.
 */
type RFBClass = new (
  target: HTMLElement,
  url: string,
  options?: Record<string, unknown>,
) => RFBInstance;

interface RFBInstance {
  disconnect(): void;
  scaleViewport: boolean;
  resizeSession: boolean;
  focusOnClick: boolean;
  addEventListener(event: string, cb: (e?: { detail: { clean: boolean } }) => void): void;
}

let rfbPromise: Promise<RFBClass> | null = null;
function loadRFB(): Promise<RFBClass> {
  if (!rfbPromise) {
    const url = "/novnc/core/rfb.js";
    rfbPromise = (import(/* @vite-ignore */ url) as Promise<{ default: RFBClass }>).then(
      (m) => m.default ?? (m as unknown as RFBClass),
    );
  }
  return rfbPromise;
}

export function ViewDesktop() {
  const enabled = useDesktopStore((s) => s.enabled);
  const checked = useDesktopStore((s) => s.checked);
  const checkStatus = useDesktopStore((s) => s.checkStatus);
  const wsPath = useDesktopStore((s) => s.wsPath);
  const setConnected = useDesktopStore((s) => s.setConnected);

  const container = useRef<HTMLDivElement>(null);
  const rfb = useRef<RFBInstance | null>(null);
  const [status, setStatus] = useState<"idle" | "connecting" | "connected" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void checkStatus();
  }, [checkStatus]);

  const connect = useCallback(async () => {
    if (!container.current || rfb.current) return;
    setStatus("connecting");
    setError(null);
    try {
      const RFBClass = await loadRFB();
      if (!container.current) return;
      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${location.host}${wsPath}`;
      const instance = new RFBClass(container.current, url);
      instance.scaleViewport = true;
      instance.resizeSession = false;
      instance.focusOnClick = true;
      instance.addEventListener("connect", () => {
        setStatus("connected");
        setConnected(true);
      });
      instance.addEventListener("disconnect", (e) => {
        setStatus("idle");
        setConnected(false);
        rfb.current = null;
        if (e && !e.detail.clean) setError("VNC connection closed unexpectedly");
      });
      rfb.current = instance;
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("error");
    }
  }, [wsPath, setConnected]);

  useEffect(() => {
    return () => {
      if (rfb.current) {
        rfb.current.disconnect();
        rfb.current = null;
      }
    };
  }, []);

  if (!checked) return <Placeholder>Checking desktop status…</Placeholder>;
  if (!enabled) {
    return (
      <Placeholder>
        Desktop is disabled. Set <code>ENABLE_DESKTOP=true</code> and point{" "}
        <code>VNC_HOST</code>/<code>VNC_PORT</code> at a running VNC server, then restart the server.
      </Placeholder>
    );
  }

  return (
    <div
      style={{ height: "100%", width: "100%", position: "relative", background: "#000" }}
      data-testid="view-desktop"
    >
      <div ref={container} style={{ height: "100%", width: "100%" }} />
      {status !== "connected" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(0,0,0,0.8)",
            flexDirection: "column",
            gap: 8,
          }}
        >
          {status === "connecting" ? (
            <span style={{ color: "rgb(var(--muted))" }}>Connecting to VNC…</span>
          ) : (
            <button
              onClick={connect}
              style={{
                background: "rgb(var(--accent))",
                color: "white",
                padding: "8px 16px",
                border: "none",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Connect
            </button>
          )}
          {error && <div style={{ color: "#f87171" }}>{error}</div>}
        </div>
      )}
    </div>
  );
}

function Placeholder({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{ padding: 24, color: "rgb(var(--muted))", maxWidth: 420 }}
      data-testid="view-desktop-placeholder"
    >
      {children}
    </div>
  );
}
