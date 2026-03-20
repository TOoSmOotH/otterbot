/**
 * WebSocket client for ComfyUI progress tracking.
 *
 * ComfyUI provides real-time progress events via WebSocket at /ws?clientId=X:
 *  - execution_start: { prompt_id }
 *  - progress: { value, max, prompt_id, node }
 *  - executing: { node } (null node = execution complete)
 *  - execution_error: { prompt_id, ... }
 */

import { EventEmitter } from "node:events";
import WebSocket from "ws";

export interface ComfyProgress {
  promptId: string;
  step: number;
  totalSteps: number;
  percentage: number;
  node?: string;
}

export interface ComfyWsClient extends EventEmitter {
  on(event: "progress", listener: (progress: ComfyProgress) => void): this;
  on(event: "complete", listener: (promptId: string) => void): this;
  on(event: "error", listener: (promptId: string, error: string) => void): this;
  on(event: "connected", listener: () => void): this;
  on(event: "disconnected", listener: () => void): this;
  readonly connected: boolean;
}

const CLIENT_ID = "otterbot";
const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30_000;

let instance: ComfyWsClientImpl | null = null;

class ComfyWsClientImpl extends EventEmitter implements ComfyWsClient {
  private ws: WebSocket | null = null;
  private reconnectDelay = RECONNECT_BASE_MS;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;

  constructor(private baseUrl: string) {
    super();
    this.connect();
  }

  private connect() {
    if (this.destroyed) return;

    const wsUrl = this.baseUrl
      .replace(/^http/, "ws")
      .replace(/\/$/, "");
    const url = `${wsUrl}/ws?clientId=${CLIENT_ID}`;

    try {
      this.ws = new WebSocket(url);
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.ws.on("open", () => {
      this.reconnectDelay = RECONNECT_BASE_MS;
      this.emit("connected");
    });

    this.ws.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        this.handleMessage(msg);
      } catch {
        // binary frame (preview image) — ignore
      }
    });

    this.ws.on("close", () => {
      this.emit("disconnected");
      this.scheduleReconnect();
    });

    this.ws.on("error", () => {
      this.ws?.close();
    });
  }

  private handleMessage(msg: { type: string; data: Record<string, unknown> }) {
    const { type, data } = msg;
    const promptId = data?.prompt_id as string | undefined;

    switch (type) {
      case "progress": {
        const value = data.value as number;
        const max = data.max as number;
        if (promptId && max > 0) {
          this.emit("progress", {
            promptId,
            step: value,
            totalSteps: max,
            percentage: Math.round((value / max) * 100),
            node: data.node as string | undefined,
          } satisfies ComfyProgress);
        }
        break;
      }
      case "executing": {
        // When node is null, execution for this prompt is complete
        if (data.node === null && promptId) {
          this.emit("complete", promptId);
        }
        break;
      }
      case "execution_error": {
        if (promptId) {
          const errorMsg = (data.exception_message as string) ?? "ComfyUI execution error";
          this.emit("error", promptId, errorMsg);
        }
        break;
      }
    }
  }

  private scheduleReconnect() {
    if (this.destroyed) return;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
      this.connect();
    }, this.reconnectDelay);
  }

  destroy() {
    this.destroyed = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.close();
    this.ws = null;
    this.removeAllListeners();
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}

/**
 * Get or create a singleton ComfyUI WebSocket client for the given base URL.
 * Returns null if the URL is empty or invalid.
 */
export function getComfyWsClient(baseUrl: string): ComfyWsClient {
  if (instance && (instance as any).baseUrl !== baseUrl) {
    instance.destroy();
    instance = null;
  }
  if (!instance) {
    instance = new ComfyWsClientImpl(baseUrl);
  }
  return instance;
}

/**
 * Wait for a specific prompt to complete via WebSocket, calling onProgress along the way.
 * Falls back to polling if the WebSocket is not connected.
 */
export function waitForPromptViaWs(
  client: ComfyWsClient,
  promptId: string,
  onProgress?: (progress: ComfyProgress) => void,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for ComfyUI output (WebSocket)"));
    }, 300_000); // 5 minutes

    const onP = (progress: ComfyProgress) => {
      if (progress.promptId === promptId) {
        onProgress?.(progress);
      }
    };

    const onComplete = (pid: string) => {
      if (pid === promptId) {
        cleanup();
        resolve();
      }
    };

    const onError = (pid: string, error: string) => {
      if (pid === promptId) {
        cleanup();
        reject(new Error(error));
      }
    };

    const cleanup = () => {
      clearTimeout(timeout);
      client.removeListener("progress", onP);
      client.removeListener("complete", onComplete);
      client.removeListener("error", onError);
    };

    client.on("progress", onP);
    client.on("complete", onComplete);
    client.on("error", onError);
  });
}
