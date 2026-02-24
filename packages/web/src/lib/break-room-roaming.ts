import { useAgentStore } from "../stores/agent-store";
import { useEnvironmentStore } from "../stores/environment-store";
import { useMovementStore } from "../stores/movement-store";
import { findWaypointsByZoneAndTag } from "./pathfinding";

const BREAK_ROOM_ZONE_ID = "break-room";
const MIN_ROAM_INTERVAL_MS = 5_000;
const MAX_ROAM_INTERVAL_MS = 10_000;

/** Per-agent timer handles for roaming */
const roamTimers = new Map<string, ReturnType<typeof setTimeout>>();
/** Track which lounge waypoint each agent is currently at */
const agentLoungeWp = new Map<string, string>();

function randomInterval(): number {
  return MIN_ROAM_INTERVAL_MS + Math.random() * (MAX_ROAM_INTERVAL_MS - MIN_ROAM_INTERVAL_MS);
}

function isBreakRoomAgent(agent: { role: string; status: string }): boolean {
  // Scheduler agents always in break room
  if (agent.role === "scheduler") return true;
  // Admin assistants when idle
  if (agent.role === "admin_assistant" && agent.status !== "thinking" && agent.status !== "acting") return true;
  // Team leads when idle (project-idle check is approximate here — we just check idle status)
  if (agent.role === "team_lead" && agent.status !== "thinking" && agent.status !== "acting") return true;
  return false;
}

function scheduleRoam(agentId: string) {
  // Clear any existing timer
  const existing = roamTimers.get(agentId);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    roamTimers.delete(agentId);
    tryRoam(agentId);
  }, randomInterval());

  roamTimers.set(agentId, timer);
}

function tryRoam(agentId: string) {
  const scene = useEnvironmentStore.getState().getActiveScene();
  if (!scene?.waypointGraph) return;

  const agent = useAgentStore.getState().agents.get(agentId);
  if (!agent) return;

  // Only roam if idle and in break room
  if (!isBreakRoomAgent(agent)) return;
  if (agent.status !== "idle") return;

  // Don't roam if already moving
  if (useMovementStore.getState().isAgentBusy(agentId)) {
    // Retry later
    scheduleRoam(agentId);
    return;
  }

  const graph = scene.waypointGraph;
  const loungeWps = findWaypointsByZoneAndTag(graph, BREAK_ROOM_ZONE_ID, "lounge");
  if (loungeWps.length < 2) return;

  const currentWpId = agentLoungeWp.get(agentId);

  // Pick a random lounge waypoint different from current
  const candidates = loungeWps.filter((wp) => wp.id !== currentWpId);
  if (candidates.length === 0) return;

  const target = candidates[Math.floor(Math.random() * candidates.length)];

  // Determine "from" waypoint: use current tracked position or fall back to first lounge
  const fromWpId = currentWpId ?? loungeWps[0].id;

  useMovementStore.getState().enqueueMovement(agentId, graph, fromWpId, target.id);
  agentLoungeWp.set(agentId, target.id);

  // Schedule next roam
  scheduleRoam(agentId);
}

function startRoaming(agentId: string, initialWpId?: string) {
  if (initialWpId) {
    agentLoungeWp.set(agentId, initialWpId);
  }
  scheduleRoam(agentId);
}

function stopRoaming(agentId: string) {
  const timer = roamTimers.get(agentId);
  if (timer) {
    clearTimeout(timer);
    roamTimers.delete(agentId);
  }
  agentLoungeWp.delete(agentId);
}

/**
 * Initialize the break room roaming system.
 * Subscribes to agent store changes to start/stop roaming for eligible agents.
 */
export function initBreakRoomRoaming() {
  // Start roaming for any agents already present
  const agents = useAgentStore.getState().agents;
  for (const [id, agent] of agents) {
    if (isBreakRoomAgent(agent) && agent.status === "idle") {
      startRoaming(id);
    }
  }

  // Subscribe to changes
  useAgentStore.subscribe((state, prevState) => {
    // Check for new or changed agents
    for (const [id, agent] of state.agents) {
      const prev = prevState.agents.get(id);
      const shouldRoam = isBreakRoomAgent(agent) && agent.status === "idle";
      const wasRoaming = roamTimers.has(id);

      if (shouldRoam && !wasRoaming) {
        startRoaming(id);
      } else if (!shouldRoam && wasRoaming) {
        stopRoaming(id);
      }
    }

    // Clean up removed agents
    for (const [id] of prevState.agents) {
      if (!state.agents.has(id)) {
        stopRoaming(id);
      }
    }
  });
}
