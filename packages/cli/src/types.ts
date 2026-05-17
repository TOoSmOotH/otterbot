import type { AgentStatus } from "@otterbot/shared";

/** Resolved options for one CLI run. */
export interface CliOptions {
  /** Base URL of the server to talk to, e.g. http://localhost:3001 */
  serverUrl: string;
  /** Agent id to chat with. */
  agentId: string;
  /** Port to boot a server on if we have to start one ourselves. */
  port: number;
  /** Leave a CLI-started server running after the CLI exits. */
  detach: boolean;
  /** Never start a server; fail if one is not already running. */
  noSpawn: boolean;
}

/** A message as rendered in the terminal UI. */
export type UiMessage =
  | { kind: "user"; id: string; text: string }
  | {
      kind: "assistant";
      id: string;
      text: string;
      thinking: string;
      pending: boolean;
      error?: string;
    }
  | {
      kind: "tool";
      id: string;
      name: string;
      status: "running" | "done";
      summary?: string;
    };

export type ConnectionState = "connecting" | "online" | "reconnecting" | "offline";

/** Snapshot of chat state exposed by the useChat hook. */
export interface ChatState {
  messages: UiMessage[];
  agentStatus: AgentStatus;
  connection: ConnectionState;
  streaming: boolean;
}

export type { AgentStatus };
