import { useEffect, useRef, useCallback, useState } from "react";
import { useDesktopStore } from "../../stores/desktop-store";

const NOVNC_CDN = "https://cdn.jsdelivr.net/npm/@novnc/novnc@1.5.0/lib/rfb.js";

/** Lazy-load noVNC RFB class from CDN (avoids bundling CJS issues) */
let rfbClassPromise: Promise<typeof RFB> | null = null;
function loadRFB(): Promise<typeof RFB> {
  if (!rfbClassPromise) {
    rfbClassPromise = import(/* @vite-ignore */ NOVNC_CDN).then(
      (m) => m.default ?? m,
    );
  }
  return rfbClassPromise;
}

export function DesktopView() {
  const enabled = useDesktopStore((s) => s.enabled);
  const checkStatus = useDesktopStore((s) => s.checkStatus);
  const setConnected = useDesktopStore((s) => s.setConnected);
  const wsPath = useDesktopStore((s) => s.wsPath);

  const containerRef = useRef<HTMLDivElement>(null);
  const rfbRef = useRef<RFB | null>(null);
  const [status, setStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");

  // Ensure we've fetched desktop status (needed for popout window)
  useEffect(() => {
    checkStatus();
  }, []);

  const connect = useCallback(async () => {
    if (!containerRef.current || rfbRef.current) return;

    setStatus("connecting");

    try {
      const RFBClass = await loadRFB();

      // Don't proceed if container unmounted during load
      if (!containerRef.current) return;

      const proto = location.protocol === "https:" ? "wss:" : "ws:";
      const url = `${proto}//${location.host}${wsPath}`;

      const rfb = new RFBClass(containerRef.current, url);
      rfb.scaleViewport = true;
      rfb.resizeSession = false;
      rfb.focusOnClick = true;

      rfb.addEventListener("connect", () => {
        setStatus("connected");
        setConnected(true);
      });

      rfb.addEventListener("disconnect", (e) => {
        setStatus("disconnected");
        setConnected(false);
        rfbRef.current = null;
        if (!e.detail.clean) {
          console.warn("[DesktopView] VNC connection lost");
        }
      });

      rfbRef.current = rfb;
    } catch (err) {
      console.error("[DesktopView] Failed to load noVNC:", err);
      setStatus("disconnected");
    }
  }, [wsPath, setConnected]);

  const disconnect = useCallback(() => {
    if (rfbRef.current) {
      rfbRef.current.disconnect();
      rfbRef.current = null;
    }
    setStatus("disconnected");
    setConnected(false);
  }, [setConnected]);

  const reconnect = useCallback(() => {
    disconnect();
    setTimeout(connect, 200);
  }, [disconnect, connect]);

  const popOut = useCallback(() => {
    window.open(
      `${location.origin}?desktop-popout=true`,
      "smoothbot-desktop",
      "width=1300,height=760,menubar=no,toolbar=no,status=no",
    );
  }, []);

  // Auto-connect when enabled
  useEffect(() => {
    if (enabled && status === "disconnected") {
      connect();
    }
    return () => {
      disconnect();
    };
  }, [enabled]);

  if (!enabled) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="text-center max-w-md px-6">
          <div className="w-12 h-12 rounded-lg bg-muted flex items-center justify-center mx-auto mb-4">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground">
              <rect x="2" y="3" width="20" height="14" rx="2" ry="2" />
              <line x1="8" y1="21" x2="16" y2="21" />
              <line x1="12" y1="17" x2="12" y2="21" />
            </svg>
          </div>
          <h3 className="text-sm font-medium mb-2">Desktop Environment</h3>
          <p className="text-xs text-muted-foreground mb-4">
            The desktop environment is not enabled. To enable it, set{" "}
            <code className="bg-muted px-1.5 py-0.5 rounded text-[11px]">ENABLE_DESKTOP=true</code>{" "}
            in your Docker environment and restart the container.
          </p>
          <p className="text-xs text-muted-foreground">
            When enabled, you'll see a full XFCE4 desktop here — complete with
            the agent's browser, terminal, and any GUI apps it installs.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-black">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-card border-b border-border">
        <div className="flex items-center gap-1.5">
          <div
            className={`w-2 h-2 rounded-full ${
              status === "connected"
                ? "bg-green-500"
                : status === "connecting"
                  ? "bg-yellow-500 animate-pulse"
                  : "bg-red-500"
            }`}
          />
          <span className="text-[11px] text-muted-foreground">
            {status === "connected"
              ? "Connected"
              : status === "connecting"
                ? "Connecting..."
                : "Disconnected"}
          </span>
        </div>
        <div className="flex-1" />
        <button
          onClick={reconnect}
          className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-0.5 rounded hover:bg-secondary transition-colors"
        >
          Reconnect
        </button>
        <button
          onClick={popOut}
          className="text-[11px] text-muted-foreground hover:text-foreground px-2 py-0.5 rounded hover:bg-secondary transition-colors"
          title="Open in new window"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
            <polyline points="15 3 21 3 21 9" />
            <line x1="10" y1="14" x2="21" y2="3" />
          </svg>
        </button>
      </div>

      {/* VNC canvas container */}
      <div ref={containerRef} className="flex-1 min-h-0" />
    </div>
  );
}
