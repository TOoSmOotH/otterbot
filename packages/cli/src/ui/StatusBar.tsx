import { Box, Text } from "ink";
import Spinner from "ink-spinner";
import type { AgentStatus, ConnectionState } from "../types.js";
import { colors, glyphs } from "./theme.js";

const CONNECTION_LABEL: Record<ConnectionState, { text: string; color: string }> = {
  connecting: { text: "connecting", color: colors.reconnecting },
  online: { text: "online", color: colors.online },
  reconnecting: { text: "reconnecting", color: colors.reconnecting },
  offline: { text: "offline", color: colors.offline },
};

/** Bottom bar: connection state, agent status, and a hint. */
export function StatusBar({
  connection,
  agentStatus,
  streaming,
}: {
  connection: ConnectionState;
  agentStatus: AgentStatus;
  streaming: boolean;
}) {
  const conn = CONNECTION_LABEL[connection];
  const busy = streaming || agentStatus === "thinking" || agentStatus === "working";

  return (
    <Box justifyContent="space-between" marginTop={1}>
      <Box>
        <Text color={conn.color}>{glyphs.dot} </Text>
        <Text color={colors.dim}>{conn.text}</Text>
        <Text color={colors.dim}>  ·  </Text>
        {busy ? (
          <Text color={colors.brand}>
            <Spinner type="dots" />{" "}
            {agentStatus === "working" ? "working" : "thinking"}
          </Text>
        ) : (
          <Text color={colors.dim}>{agentStatus}</Text>
        )}
      </Box>
      <Text color={colors.dim}>Ctrl+C to quit</Text>
    </Box>
  );
}
