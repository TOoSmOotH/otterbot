import type { AgentStatus } from "@otterbot/shared";

/** The otterbot subcommand to run. */
export type Command = "start" | "stop" | "restart" | "status" | "logs" | "chat" | "web";

/** Resolved options for one CLI run. */
export interface CliOptions {
  /** The subcommand being run. */
  command: Command;
  /** Base URL of the server to talk to, e.g. http://localhost:3001 */
  serverUrl: string;
  /** Host the daemon binds to. */
  host: string;
  /** Port the daemon binds to / the server URL's port. */
  port: number;
  /** Agent id to chat with. */
  agentId: string;
  /** Never start a daemon; fail if one is not already running (chat). */
  noSpawn: boolean;
  /** Keep streaming the log (`logs -f`). */
  follow: boolean;
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
