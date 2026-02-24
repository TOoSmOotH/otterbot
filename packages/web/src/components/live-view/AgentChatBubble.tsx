import { useState, useEffect, useRef, useCallback } from "react";
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
const DEBUG_BUBBLES = true;

function debugLog(...args: unknown[]) {
  if (DEBUG_BUBBLES) console.log("[ChatBubble]", ...args);
}

function useBubbleState(agentId: string | undefined, status: string): BubbleState | null {
  const [bubble, setBubble] = useState<BubbleState | null>(null);
  const lastToolTimestampRef = useRef<number>(0);
  const staleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const derive = useCallback(() => {
    if (!agentId) {
      setBubble(null);
      return;
    }

    debugLog(`derive() called for agent=${agentId}, status=${status}`);

    // 1. Check for recent tool call
    const activityState = useAgentActivityStore.getState();
    const calls = activityState.agentToolCalls.get(agentId);
    debugLog(`  toolCalls for ${agentId}:`, calls?.length ?? 0, calls?.length ? `latest=${calls[calls.length - 1].toolName}` : "");
    if (calls && calls.length > 0) {
      const latest = calls[calls.length - 1];
      const ts = new Date(latest.timestamp).getTime();
      const age = Date.now() - ts;
      debugLog(`  latest tool age=${age}ms, stale=${TOOL_CALL_STALE_MS}ms`);
      if (age < TOOL_CALL_STALE_MS) {
        if (ts !== lastToolTimestampRef.current) {
          lastToolTimestampRef.current = ts;
          if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
          staleTimerRef.current = setTimeout(() => {
            lastToolTimestampRef.current = 0;
            derive();
          }, TOOL_CALL_STALE_MS - age);
        }
        const text = humanizeToolName(latest.toolName);
        debugLog(`  -> showing tool bubble: "${text}"`);
        setBubble({ text, type: "speech" });
        return;
      }
    }

    // 2. Check coding session
    const codingState = useCodingAgentStore.getState();
    const session = codingState.sessions.get(agentId);
    debugLog(`  codingSession for ${agentId}:`, session ? `status=${session.status}, task=${session.task}` : "none");
    if (session && session.status === "active") {
      const text = "Coding: " + truncateText(session.task, 22);
      debugLog(`  -> showing coding bubble: "${text}"`);
      setBubble({ text, type: "speech" });
      return;
    }

    // 3. Check kanban tasks
    const projectState = useProjectStore.getState();
    const assignedTask = projectState.tasks.find(
      (t) => t.assigneeAgentId === agentId && t.column === "in_progress",
    );
    debugLog(`  kanbanTask for ${agentId}:`, assignedTask ? `title=${assignedTask.title}` : "none");
    if (assignedTask) {
      const text = "Working on: " + truncateText(assignedTask.title, 18);
      debugLog(`  -> showing kanban bubble: "${text}"`);
      setBubble({ text, type: "speech" });
      return;
    }

    // 4. Check thinking/acting status
    if (status === "thinking") {
      debugLog(`  -> showing thought bubble`);
      setBubble({ text: "...", type: "thought" });
      return;
    }

    if (status === "acting") {
      debugLog(`  -> showing acting bubble`);
      setBubble({ text: "Working...", type: "speech" });
      return;
    }

    // 5. Idle / done — no bubble
    debugLog(`  -> no bubble (status=${status})`);
    setBubble(null);
  }, [agentId, status]);

  // Subscribe to stores for reactivity
  useEffect(() => {
    if (!agentId) {
      setBubble(null);
      return;
    }

    // Initial derivation
    derive();

    const unsubActivity = useAgentActivityStore.subscribe(() => derive());
    const unsubCoding = useCodingAgentStore.subscribe(() => derive());
    const unsubProject = useProjectStore.subscribe(() => derive());

    return () => {
      unsubActivity();
      unsubCoding();
      unsubProject();
      if (staleTimerRef.current) clearTimeout(staleTimerRef.current);
    };
  }, [agentId, derive]);

  return bubble;
}

export function AgentChatBubble({ agentId, status, yOffset }: AgentChatBubbleProps) {
  const bubble = useBubbleState(agentId, status);
  const [visible, setVisible] = useState(false);
  const prevBubbleRef = useRef<BubbleState | null>(null);

  debugLog(`render agent=${agentId} status=${status} bubble=${bubble ? JSON.stringify(bubble) : "null"} visible=${visible}`);

  useEffect(() => {
    if (bubble) {
      debugLog(`bubble appeared for ${agentId}: ${JSON.stringify(bubble)}`);
      setVisible(true);
      prevBubbleRef.current = bubble;
    } else {
      debugLog(`bubble cleared for ${agentId}, fading out`);
      // Delay hiding for fade-out
      const timer = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(timer);
    }
  }, [bubble, agentId]);

  if (!visible && !bubble) return null;

  const current = bubble ?? prevBubbleRef.current;
  if (!current) return null;

  const isThought = current.type === "thought";
  const isFading = !bubble;

  return (
    <Html position={[0, yOffset, 0]} center distanceFactor={8}>
      <div
        style={{
          pointerEvents: "none",
          userSelect: "none",
          position: "relative",
          display: "inline-flex",
          justifyContent: "center",
          opacity: isFading ? 0 : 1,
          transform: isFading ? "translateY(4px) scale(0.9)" : "translateY(0) scale(1)",
          transition: "opacity 0.3s ease, transform 0.3s ease",
        }}
      >
        <div
          style={{
            background: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(4px)",
            borderRadius: 10,
            paddingLeft: 14,
            paddingRight: 14,
            paddingTop: 8,
            paddingBottom: 8,
            maxWidth: 300,
            position: "relative",
          }}
        >
          <span
            style={{
              fontSize: 24,
              color: "white",
              whiteSpace: "nowrap",
              fontFamily: "system-ui, sans-serif",
            }}
          >
            {current.text}
          </span>

          {/* Tail */}
          {!isThought && (
            <div
              style={{
                position: "absolute",
                bottom: -12,
                left: "50%",
                transform: "translateX(-50%)",
                width: 0,
                height: 0,
                borderLeft: "12px solid transparent",
                borderRight: "12px solid transparent",
                borderTop: "12px solid rgba(0, 0, 0, 0.75)",
              }}
            />
          )}

          {/* Thought dots */}
          {isThought && (
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: 4,
                position: "absolute",
                bottom: -30,
                left: "50%",
                transform: "translateX(-50%)",
              }}
            >
              <div style={{ width: 12, height: 12, borderRadius: "50%", background: "rgba(0,0,0,0.7)" }} />
              <div style={{ width: 8, height: 8, borderRadius: "50%", background: "rgba(0,0,0,0.7)" }} />
            </div>
          )}
        </div>
      </div>
    </Html>
  );
}
