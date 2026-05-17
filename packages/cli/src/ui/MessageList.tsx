import { useRef } from "react";
import { Box, Static } from "ink";
import type { UiMessage } from "../types.js";
import { Message } from "./Message.js";

/**
 * Render the conversation. Settled messages go into Ink's append-only
 * <Static> region (stable scrollback that survives terminal reflow); the
 * in-flight turn renders in the live region so it can update token-by-token.
 */
export function MessageList({
  messages,
  streaming,
  agentId,
}: {
  messages: UiMessage[];
  streaming: boolean;
  agentId: string;
}) {
  // Once a turn finishes (streaming === false) every message so far is final.
  const finalizedRef = useRef(0);
  if (!streaming) finalizedRef.current = messages.length;
  const finalized = finalizedRef.current;

  const settled = messages.slice(0, finalized);
  const live = messages.slice(finalized);

  return (
    <Box flexDirection="column">
      <Static items={settled}>
        {(message) => <Message key={message.id} message={message} agentId={agentId} />}
      </Static>
      {live.length > 0 ? (
        <Box flexDirection="column">
          {live.map((message) => (
            <Message key={message.id} message={message} agentId={agentId} />
          ))}
        </Box>
      ) : null}
    </Box>
  );
}
