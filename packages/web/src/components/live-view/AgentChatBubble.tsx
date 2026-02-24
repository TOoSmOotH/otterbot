import { useState, useEffect, useRef } from "react";
import { Html } from "@react-three/drei";
import { useAgentActivityStore } from "../../stores/agent-activity-store";
import { useCodingAgentStore } from "../../stores/coding-agent-store";
import { useProjectStore } from "../../stores/project-store";
import { humanizeToolName, truncateText } from "../../lib/humanize-tool-name";

interface AgentChatBubbleProps {
  agentId: string | undefined;
  status: string;
  yOffset: number;
}

type BubbleType = "speech" | "thought";

interface BubbleState {
  text: string;
  type: BubbleType;
}

const TOOL_CALL_STALE_MS = 10_000;

function useBubbleState(agentId: string | undefined, status: string): BubbleState | null {
  const [bubble, setBubble] = useState<BubbleState | null>(null);
  const lastToolTimestampRef = useRef<number>(0);
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!agentId) {
      setBubble(null);
      return;
    }

    const unsubActivity = useAgentActivityStore.subscribe((state) => {
      const calls = state.agentToolCalls.get(agentId);
      if (calls && calls.length > 0) {
        const latest = calls[calls.length - 1];
        const ts = new Date(latest.timestamp).getTime();
        if (ts !== lastToolTimestampRef.current) {
          lastToolTimestampRef.current = ts;
          // Clear any existing stale timer
          if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
          setBubble({ text: humanizeToolName(latest.toolName), type: "speech" });
          // Set timer to clear stale tool call bubble
          staleTimerRef.current = setTimeout(() => {
            lastToolTimestampRef.current = 0;
            // Re-derive from other sources
            deriveFallback();
          }, TOOL_CALL_STALE_MS);
          return;
        }
        // If tool call is still recent, keep showing it
        const age = Date.now() - ts;
        if (age < TOOL_CALL_STALE_MS) return;
      }
      deriveFallback();
    });

    function deriveFallback() {
      if (!agentId) return;

      // Check coding session
      const codingState = useCodingAgentStore.getState();
      const session = codingState.sessions.get(agentId);
      if (session && session.status === "active") {
        setBubble({ text: "Coding: " + truncateText(session.task, 22), type: "speech" });
        return;
      }

      // Check kanban tasks
      const projectState = useProjectStore.getState();
      const assignedTask = projectState.tasks.find(
        (t) => t.assigneeAgentId === agentId && t.column === "in_progress",
      );
      if (assignedTask) {
        setBubble({ text: "Working on: " + truncateText(assignedTask.title, 18), type: "speech" });
        return;
      }

      // Check thinking state
      const activityState = useAgentActivityStore.getState();
      const stream = activityState.agentStreams.get(agentId);
      if (stream?.isThinking) {
        setBubble({ text: "...", type: "thought" });
        return;
      }

      setBubble(null);
    }

    // Also subscribe to coding and project stores for reactivity
    const unsubCoding = useCodingAgentStore.subscribe(() => {
      // Only re-derive if no recent tool call is active
      if (lastToolTimestampRef.current && Date.now() - lastToolTimestampRef.current < TOOL_CALL_STALE_MS) return;
      deriveFallback();
    });

    const unsubProject = useProjectStore.subscribe(() => {
      if (lastToolTimestampRef.current && Date.now() - lastToolTimestampRef.current < TOOL_CALL_STALE_MS) return;
      deriveFallback();
    });

    // Initial derivation
    const activityState = useAgentActivityStore.getState();
    const calls = activityState.agentToolCalls.get(agentId);
    if (calls && calls.length > 0) {
      const latest = calls[calls.length - 1];
      const ts = new Date(latest.timestamp).getTime();
      const age = Date.now() - ts;
      if (age < TOOL_CALL_STALE_MS) {
        lastToolTimestampRef.current = ts;
        setBubble({ text: humanizeToolName(latest.toolName), type: "speech" });
        staleTimerRef.current = setTimeout(() => {
          lastToolTimestampRef.current = 0;
          deriveFallback();
        }, TOOL_CALL_STALE_MS - age);
      } else {
        deriveFallback();
      }
    } else {
      deriveFallback();
    }

    return () => {
      unsubActivity();
      unsubCoding();
      unsubProject();
      if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
    };
  }, [agentId]);

  // Also react to status changes for thinking state
  useEffect(() => {
    if (!agentId) return;
    if (status === "thinking") {
      // Check if we should show thought bubble (only if no higher-priority source)
      const activityState = useAgentActivityStore.getState();
      const calls = activityState.agentToolCalls.get(agentId);
      const hasRecentTool = calls && calls.length > 0 &&
        Date.now() - new Date(calls[calls.length - 1].timestamp).getTime() < TOOL_CALL_STALE_MS;
      if (!hasRecentTool) {
        const codingState = useCodingAgentStore.getState();
        const session = codingState.sessions.get(agentId);
        if (!session || session.status !== "active") {
          const stream = activityState.agentStreams.get(agentId);
          if (stream?.isThinking) {
            setBubble({ text: "...", type: "thought" });
          }
        }
      }
    } else if (status === "idle" || status === "done") {
      // Clear bubble when idle unless there's a recent tool call still showing
      if (!lastToolTimestampRef.current || Date.now() - lastToolTimestampRef.current >= TOOL_CALL_STALE_MS) {
        setBubble(null);
      }
    }
  }, [agentId, status]);

  return bubble;
}

export function AgentChatBubble({ agentId, status, yOffset }: AgentChatBubbleProps) {
  const bubble = useBubbleState(agentId, status);
  const [visible, setVisible] = useState(false);
  const prevBubbleRef = useRef<BubbleState | null>(null);

  useEffect(() => {
    if (bubble) {
      setVisible(true);
      prevBubbleRef.current = bubble;
    } else {
      // Delay hiding for fade-out
      const timer = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [bubble]);

  if (!visible && !bubble) return null;

  const current = bubble ?? prevBubbleRef.current;
  if (!current) return null;

  const isThought = current.type === "thought";

  return (
    <Html position={[0, yOffset, 0]} center distanceFactor={8}>
      <style>{`
        @keyframes bubble-in {
          from {
            opacity: 0;
            transform: translateY(4px) scale(0.9);
          }
          to {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
        }
        @keyframes bubble-out {
          from {
            opacity: 1;
            transform: translateY(0) scale(1);
          }
          to {
            opacity: 0;
            transform: translateY(4px) scale(0.9);
          }
        }
        .chat-bubble {
          animation: bubble-in 0.3s ease forwards;
        }
        .chat-bubble-exit {
          animation: bubble-out 0.3s ease forwards;
        }
        .speech-tail::after {
          content: '';
          position: absolute;
          bottom: -5px;
          left: 50%;
          transform: translateX(-50%);
          width: 0;
          height: 0;
          border-left: 5px solid transparent;
          border-right: 5px solid transparent;
          border-top: 5px solid rgba(0, 0, 0, 0.7);
        }
        .thought-dots {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 1px;
          position: absolute;
          bottom: -12px;
          left: 50%;
          transform: translateX(-50%);
        }
        .thought-dot {
          border-radius: 50%;
          background: rgba(0, 0, 0, 0.7);
          backdrop-filter: blur(4px);
        }
        .thought-dot-1 {
          width: 5px;
          height: 5px;
        }
        .thought-dot-2 {
          width: 3px;
          height: 3px;
        }
        .thought-dot-3 {
          width: 2px;
          height: 2px;
        }
      `}</style>
      <div
        className={`pointer-events-none select-none ${bubble ? "chat-bubble" : "chat-bubble-exit"}`}
        style={{ position: "relative", display: "inline-flex", justifyContent: "center" }}
      >
        <div
          className={`bg-black/70 backdrop-blur-sm rounded-lg px-2 py-1 ${!isThought ? "speech-tail" : ""}`}
          style={{ maxWidth: 160, position: "relative" }}
        >
          <span className="text-[9px] text-white whitespace-nowrap">
            {current.text}
          </span>
          {isThought && (
            <div className="thought-dots">
              <div className="thought-dot thought-dot-1" />
              <div className="thought-dot thought-dot-2" />
              <div className="thought-dot thought-dot-3" />
            </div>
          )}
        </div>
      </div>
    </Html>
  );
}
