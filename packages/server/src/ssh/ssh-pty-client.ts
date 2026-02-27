/**
 * SSH PTY client — spawns an `ssh` process in a pseudo-terminal
 * and streams raw terminal output to the browser via Socket.IO + xterm.js.
 *
 * Follows the same pattern as ClaudeCodePtyClient but for SSH sessions.
 * Implements the PtyClient interface from worker.ts.
 */

import type { SshService } from "./ssh-service.js";
import type { PtyClient } from "../agents/worker.js";

/** Ring buffer size for late-joining clients (~100KB) */
const RING_BUFFER_SIZE = 100 * 1024;

export interface SshPtyConfig {
  keyId: string;
  host: string;
  sshService: SshService;
  /** Callback for raw PTY data — stream to Socket.IO clients */
  onData?: (data: string) => void;
  /** Callback when process exits */
  onExit?: (exitCode: number) => void;
}

export class SshPtyClient implements PtyClient {
  private config: SshPtyConfig;
  private ptyProcess: any | null = null;
  private ringBuffer = "";
  private _killed = false;
  private dataListeners: Array<(data: string) => void> = [];

  constructor(config: SshPtyConfig) {
    this.config = config;
  }

  /** Register an additional data listener. Returns an unsubscribe function. */
  addDataListener(cb: (data: string) => void): () => void {
    this.dataListeners.push(cb);
    return () => {
      this.dataListeners = this.dataListeners.filter((l) => l !== cb);
    };
  }

  /** Connect to the remote host via PTY */
  async connect(): Promise<void> {
    const { keyId, host, sshService } = this.config;

    // Validate host
    const hostCheck = sshService.validateHost(keyId, host);
    if (!hostCheck.ok) {
      throw new Error(hostCheck.error);
    }

    // Get key details
    const key = sshService.get(keyId);
    if (!key) throw new Error("SSH key not found");

    const keyPath = sshService.getKeyPath(keyId);
    if (!keyPath) throw new Error("SSH key file not found");

    // Dynamic import to avoid loading native module at module init
    const nodePty = await import("node-pty");

    const args = [
      "-i", keyPath,
      "-o", "StrictHostKeyChecking=accept-new",
      "-p", String(key.port),
      `${key.username}@${host}`,
    ];

    this.ptyProcess = nodePty.spawn("ssh", args, {
      name: "xterm-256color",
      cols: 120,
      rows: 40,
      env: { ...(process.env as Record<string, string>) },
    });

    this.ptyProcess.onData((data: string) => {
      // Append to ring buffer (trim to size)
      this.ringBuffer += data;
      if (this.ringBuffer.length > RING_BUFFER_SIZE) {
        this.ringBuffer = this.ringBuffer.slice(-RING_BUFFER_SIZE);
      }
      this.config.onData?.(data);
      for (const listener of this.dataListeners) listener(data);
    });

    this.ptyProcess.onExit(({ exitCode }: { exitCode: number; signal?: number }) => {
      console.log(`[SSH PTY] Session to ${host} exited with code ${exitCode}`);
      this.config.onExit?.(exitCode);
      this.ptyProcess = null;
    });
  }

  /** Write user keystrokes to PTY stdin */
  writeInput(data: string): void {
    this.ptyProcess?.write(data);
  }

  /** Resize PTY dimensions */
  resize(cols: number, rows: number): void {
    try {
      this.ptyProcess?.resize(cols, rows);
    } catch {
      // Ignore resize errors (process may have exited)
    }
  }

  /** Get the ring buffer contents for late-joining clients */
  getReplayBuffer(): string {
    return this.ringBuffer;
  }

  /** Kill the PTY process */
  kill(): void {
    if (!this.ptyProcess) return;
    this._killed = true;

    try {
      this.ptyProcess.kill("SIGTERM");
    } catch {
      // Already dead
    }

    // Force kill after 3 seconds
    setTimeout(() => {
      try {
        this.ptyProcess?.kill("SIGKILL");
      } catch {
        // Already dead
      }
    }, 3000);
  }

  /** Gracefully terminate the PTY process */
  gracefulExit(): void {
    if (!this.ptyProcess) return;
    // Send exit command then SIGTERM
    try {
      this.ptyProcess.write("exit\n");
    } catch {
      // ignore
    }

    setTimeout(() => {
      try {
        this.ptyProcess?.kill("SIGTERM");
      } catch {
        // Already dead
      }

      // Force kill after 3 more seconds
      setTimeout(() => {
        try {
          this.ptyProcess?.kill("SIGKILL");
        } catch {
          // Already dead
        }
      }, 3000);
    }, 1000);
  }
}
