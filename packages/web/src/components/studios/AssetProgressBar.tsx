import { useEffect, useState } from "react";
import { useSocket } from "../../hooks/use-socket";
import type { AssetProgressEvent } from "@otterbot/shared";

interface ActiveGeneration {
  type: string;
  percentage: number;
  stage: string;
  lastUpdate: number;
}

/**
 * Listens for asset:progress / asset:complete / asset:error Socket.IO events
 * and shows a small progress indicator when generation is active.
 */
export function AssetProgressBar() {
  const [active, setActive] = useState<ActiveGeneration | null>(null);

  useEffect(() => {
    const socket = (window as any).__otterbot_socket;
    if (!socket) return;

    const onProgress = (data: AssetProgressEvent) => {
      setActive({
        type: data.type,
        percentage: data.percentage,
        stage: data.stage,
        lastUpdate: Date.now(),
      });
    };

    const onComplete = () => {
      setActive(null);
    };

    const onError = () => {
      setActive(null);
    };

    socket.on("asset:progress", onProgress);
    socket.on("asset:complete", onComplete);
    socket.on("asset:error", onError);

    return () => {
      socket.off("asset:progress", onProgress);
      socket.off("asset:complete", onComplete);
      socket.off("asset:error", onError);
    };
  }, []);

  // Auto-clear stale progress (if no update in 30s, assume something went wrong)
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => {
      if (Date.now() - active.lastUpdate > 30_000) {
        setActive(null);
      }
    }, 5_000);
    return () => clearInterval(timer);
  }, [active?.lastUpdate]);

  if (!active) return null;

  return (
    <div className="flex items-center gap-2">
      <div className="w-20 h-1.5 bg-zinc-700 rounded-full overflow-hidden">
        <div
          className="h-full bg-blue-500 rounded-full transition-all duration-300"
          style={{ width: `${active.percentage}%` }}
        />
      </div>
      <span className="text-[10px] text-zinc-400">{active.stage}</span>
    </div>
  );
}
