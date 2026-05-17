import { Box, Text } from "ink";
import type { UiMessage } from "../types.js";
import { colors, glyphs } from "./theme.js";

/** Render a single chat message (user / assistant / tool). */
export function Message({ message, agentId }: { message: UiMessage; agentId: string }) {
  if (message.kind === "user") {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text color={colors.user} bold>
          {glyphs.user} you
        </Text>
        <Text>{message.text}</Text>
      </Box>
    );
  }

  if (message.kind === "tool") {
    const done = message.status === "done";
    return (
      <Box marginBottom={1}>
        <Text color={colors.tool}>
          {glyphs.tool} {done ? "" : "running "}
          {message.name}
          {done ? " ✓" : "…"}
          {done && message.summary ? <Text color={colors.dim}> — {message.summary}</Text> : null}
        </Text>
      </Box>
    );
  }

  // assistant
  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text color={colors.brand} bold>
        {glyphs.assistant} {agentId}
      </Text>
      {message.thinking ? (
        <Text color={colors.thinking} italic>
          {message.thinking}
        </Text>
      ) : null}
      {message.text ? <Text color={colors.assistant}>{message.text}</Text> : null}
      {message.error ? (
        <Text color={colors.error}>⚠ {message.error}</Text>
      ) : null}
      {!message.text && !message.error && message.pending ? (
        <Text color={colors.dim}>…</Text>
      ) : null}
    </Box>
  );
}
