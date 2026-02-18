import type { Agent, AgentStatus, WaypointGraph } from "@otterbot/shared";
import { useAgentStore } from "../stores/agent-store";
import { useEnvironmentStore } from "../stores/environment-store";
import { useMovementStore } from "../stores/movement-store";
import { findWaypointsByZoneAndTag, findNearestWaypoint } from "./pathfinding";

/** Tracks which zone each agent is currently in */
const agentZoneMap = new Map<string, string | null>();
/** Tracks the previous status for each agent */
const agentPrevStatus = new Map<string, string>();

/**
 * Determines which zone an agent should be in based on their role and project.
 */
function getTargetZoneId(agent: Agent, zones: { id: string; projectId: string | null }[]): string | null {
  if (agent.role === "coo" || agent.role === "admin_assistant") {
    // COO and admin assistants stay in main office
    const mainZone = zones.find((z) => z.projectId === null);
    return mainZone?.id ?? null;
  }

  if (agent.role === "team_lead" || agent.role === "worker") {
    if (agent.projectId) {
      const projectZone = zones.find((z) => z.projectId === agent.projectId);
      if (projectZone) return projectZone.id;
    }
    // Fallback to main office
    const mainZone = zones.find((z) => z.projectId === null);
    return mainZone?.id ?? null;
  }

  return null;
}

/**
 * Gets the appropriate waypoint tag for the agent's current status within their zone.
 */
function getTargetTag(status: AgentStatus | string): string {
  if (status === "thinking" || status === "acting") return "desk";
  return "center";
}

/**
 * Trigger a movement for an agent from their current location to a target waypoint.
 */
function triggerMovement(
  agentId: string,
  graph: WaypointGraph,
  fromWaypointId: string,
  toWaypointId: string,
) {
  if (fromWaypointId === toWaypointId) return;
  useMovementStore.getState().startMovement(agentId, graph, fromWaypointId, toWaypointId);
}

/**
 * Process an agent status change or spawn event to trigger appropriate movement.
 */
export function processAgentMovement(agent: Agent, prevStatus?: string) {
  const scene = useEnvironmentStore.getState().getActiveScene();
  if (!scene?.waypointGraph || !scene?.zones) return;

  const graph = scene.waypointGraph;
  const zones = scene.zones;

  const targetZoneId = getTargetZoneId(agent, zones);
  if (!targetZoneId) return;

  const currentZoneId = agentZoneMap.get(agent.id);
  const targetTag = getTargetTag(agent.status);

  // Zone change: agent needs to walk between zones to their final destination
  if (currentZoneId !== undefined && currentZoneId !== targetZoneId) {
    // Find the final destination in the target zone (desk or center based on status)
    const toWps = findWaypointsByZoneAndTag(graph, targetZoneId, targetTag);
    const fallbackWps = findWaypointsByZoneAndTag(graph, targetZoneId, "center");
    const toWp = toWps.length > 0 ? toWps[0] : fallbackWps.length > 0 ? fallbackWps[0] : null;
    if (!toWp) return;

    // Find current location: nearest waypoint in current zone
    const currentWps = currentZoneId
      ? findWaypointsByZoneAndTag(graph, currentZoneId, "center")
      : [];
    const fromWp = currentWps.length > 0 ? currentWps[0] : null;
    if (!fromWp) return;

    triggerMovement(agent.id, graph, fromWp.id, toWp.id);
    agentZoneMap.set(agent.id, targetZoneId);
    return;
  }

  // Status change within same zone: move between center and desk
  if (prevStatus && prevStatus !== agent.status) {
    const prevTag = getTargetTag(prevStatus);
    if (prevTag !== targetTag) {
      const fromWps = findWaypointsByZoneAndTag(graph, targetZoneId, prevTag);
      const toWps = findWaypointsByZoneAndTag(graph, targetZoneId, targetTag);
      if (fromWps.length > 0 && toWps.length > 0) {
        triggerMovement(agent.id, graph, fromWps[0].id, toWps[0].id);
      }
    }
  }

  // Track agent zone
  agentZoneMap.set(agent.id, targetZoneId);
}

/**
 * Process agent spawn: appear at main office entrance and walk to final destination.
 */
export function processAgentSpawn(agent: Agent) {
  const scene = useEnvironmentStore.getState().getActiveScene();
  if (!scene?.waypointGraph || !scene?.zones) return;

  const graph = scene.waypointGraph;
  const zones = scene.zones;
  const targetZoneId = getTargetZoneId(agent, zones);
  if (!targetZoneId) return;

  // Always start from main office entrance
  const mainZone = zones.find((z) => z.projectId === null);
  const startWps = mainZone
    ? findWaypointsByZoneAndTag(graph, mainZone.id, "entrance")
    : [];

  // Walk to target based on current status
  const targetTag = getTargetTag(agent.status);
  const destWps = findWaypointsByZoneAndTag(graph, targetZoneId, targetTag);
  const fallbackWps = findWaypointsByZoneAndTag(graph, targetZoneId, "center");
  const toWp = destWps.length > 0 ? destWps[0] : fallbackWps.length > 0 ? fallbackWps[0] : null;

  if (startWps.length > 0 && toWp) {
    triggerMovement(agent.id, graph, startWps[0].id, toWp.id);
  }

  agentZoneMap.set(agent.id, targetZoneId);
}

/**
 * Initialize the movement trigger system.
 * Subscribes to the agent store for status changes and spawns.
 */
export function initMovementTriggers() {
  // Subscribe to agent store changes
  useAgentStore.subscribe((state, prevState) => {
    // Check for new agents
    for (const [id, agent] of state.agents) {
      if (!prevState.agents.has(id)) {
        processAgentSpawn(agent);
        agentPrevStatus.set(id, agent.status);
      }
    }

    // Check for status changes or project reassignment (zone change)
    for (const [id, agent] of state.agents) {
      if (!prevState.agents.has(id)) continue; // already handled by spawn

      const prev = agentPrevStatus.get(id);
      const prevAgent = prevState.agents.get(id);

      // Detect projectId change (zone reassignment)
      if (prevAgent && prevAgent.projectId !== agent.projectId) {
        processAgentMovement(agent, prev);
      } else if (prev && prev !== agent.status) {
        processAgentMovement(agent, prev);
      }
      agentPrevStatus.set(id, agent.status);
    }

    // Clean up removed agents
    for (const [id] of prevState.agents) {
      if (!state.agents.has(id)) {
        agentZoneMap.delete(id);
        agentPrevStatus.delete(id);
        useMovementStore.getState().cancelMovement(id);
      }
    }
  });
}
