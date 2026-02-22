import type { Agent, AgentStatus, WaypointGraph } from "@otterbot/shared";
import { useAgentStore } from "../stores/agent-store";
import { useEnvironmentStore } from "../stores/environment-store";
import { useMovementStore } from "../stores/movement-store";
import { findWaypointsByZoneAndTag, findNearestWaypoint } from "./pathfinding";

/** Tracks which zone each agent is currently in */
const agentZoneMap = new Map<string, string | null>();
/** Tracks the previous status for each agent */
const agentPrevStatus = new Map<string, string>();

const BREAK_ROOM_ZONE_ID = "break-room";

/**
 * Check whether a project has any actively-working agents (thinking or acting).
 */
function isProjectIdle(projectId: string | null, allAgents: Map<string, Agent>): boolean {
  if (!projectId) return true;
  for (const agent of allAgents.values()) {
    if (agent.projectId === projectId && (agent.status === "thinking" || agent.status === "acting")) {
      return true; // project is NOT idle — there's active work
    }
  }
  return false; // no active work
}

// Renamed to avoid confusion: returns true when there IS active work
function hasActiveWorkInProject(projectId: string | null, allAgents: Map<string, Agent>): boolean {
  if (!projectId) return false;
  for (const agent of allAgents.values()) {
    if (
      agent.projectId === projectId &&
      agent.role !== "team_lead" &&
      (agent.status === "thinking" || agent.status === "acting")
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Determines which zone an agent should be in based on their role and project.
 */
function getTargetZoneId(agent: Agent, zones: { id: string; projectId: string | null }[]): string | null {
  const allAgents = useAgentStore.getState().agents;

  // Scheduler agents always go to break room
  if (agent.role === "scheduler") {
    return zones.find((z) => z.id === BREAK_ROOM_ZONE_ID)?.id ?? null;
  }

  // Admin assistants go to break room when idle
  if (agent.role === "admin_assistant") {
    const isIdle = agent.status !== "thinking" && agent.status !== "acting";
    if (isIdle) {
      const brZone = zones.find((z) => z.id === BREAK_ROOM_ZONE_ID);
      if (brZone) return brZone.id;
    }
    // Working: stay in main office
    const mainZone = zones.find((z) => z.projectId === null && z.id !== BREAK_ROOM_ZONE_ID);
    return mainZone?.id ?? null;
  }

  if (agent.role === "coo") {
    const mainZone = zones.find((z) => z.projectId === null && z.id !== BREAK_ROOM_ZONE_ID);
    return mainZone?.id ?? null;
  }

  if (agent.role === "team_lead") {
    const isIdle = agent.status !== "thinking" && agent.status !== "acting";
    // Team lead goes to break room when idle AND their project has no active workers
    if (isIdle && agent.projectId && !hasActiveWorkInProject(agent.projectId, allAgents)) {
      const brZone = zones.find((z) => z.id === BREAK_ROOM_ZONE_ID);
      if (brZone) return brZone.id;
    }
    // Otherwise go to project zone or main office
    if (agent.projectId) {
      const projectZone = zones.find((z) => z.projectId === agent.projectId);
      if (projectZone) return projectZone.id;
    }
    const mainZone = zones.find((z) => z.projectId === null && z.id !== BREAK_ROOM_ZONE_ID);
    return mainZone?.id ?? null;
  }

  if (agent.role === "worker") {
    if (agent.projectId) {
      const projectZone = zones.find((z) => z.projectId === agent.projectId);
      if (projectZone) return projectZone.id;
    }
    const mainZone = zones.find((z) => z.projectId === null && z.id !== BREAK_ROOM_ZONE_ID);
    return mainZone?.id ?? null;
  }

  return null;
}

/**
 * Gets the appropriate waypoint tag for the agent's current status within their zone.
 */
function getTargetTag(status: AgentStatus | string, zoneId?: string): string {
  // In break room: idle agents go to lounge, working agents go to desk
  if (zoneId === BREAK_ROOM_ZONE_ID) {
    if (status === "thinking" || status === "acting") return "desk";
    return "lounge";
  }
  // Other zones: working → desk, idle → center
  if (status === "thinking" || status === "acting") return "desk";
  return "center";
}

/**
 * Compute the desk waypoint index for an agent, matching LiveViewScene's assignment order.
 * Main office: CEO=0, COOs, AdminAssistants, TeamLeads (no project), Workers (no project)
 * Project zones: TeamLeads then Workers, per-zone counter starting at 0
 */
function computeDeskIndex(
  agent: Agent,
  allAgents: Map<string, Agent>,
  zones: { id: string; projectId: string | null }[],
): number {
  const active = Array.from(allAgents.values()).filter((a) => a.status !== "done");
  const coos = active.filter((a) => a.role === "coo");
  const admins = active.filter((a) => a.role === "admin_assistant");
  const teamLeads = active.filter((a) => a.role === "team_lead");
  const workers = active.filter((a) => a.role === "worker");
  const schedulers = active.filter((a) => a.role === "scheduler");

  const targetZoneId = getTargetZoneId(agent, zones);

  // Break room: schedulers first, then admins, then team leads
  if (targetZoneId === BREAK_ROOM_ZONE_ID) {
    let idx = 0;
    for (const s of schedulers) {
      if (s.id === agent.id) return idx;
      idx++;
    }
    for (const a of admins) {
      if (getTargetZoneId(a, zones) === BREAK_ROOM_ZONE_ID) {
        if (a.id === agent.id) return idx;
        idx++;
      }
    }
    for (const tl of teamLeads) {
      if (getTargetZoneId(tl, zones) === BREAK_ROOM_ZONE_ID) {
        if (tl.id === agent.id) return idx;
        idx++;
      }
    }
    return idx;
  }

  const mainZone = zones.find((z) => z.projectId === null && z.id !== BREAK_ROOM_ZONE_ID);

  if (targetZoneId === mainZone?.id) {
    // Main office: CEO=0, then COOs, admins, team leads (no project zone), workers (no project zone)
    let idx = 1; // CEO occupies 0
    for (const c of coos) {
      if (c.id === agent.id) return idx;
      idx++;
    }
    for (const a of admins) {
      // Only count admins that are in main office (not break room)
      if (getTargetZoneId(a, zones) === mainZone?.id) {
        if (a.id === agent.id) return idx;
        idx++;
      }
    }
    for (const tl of teamLeads) {
      const tlZone = getTargetZoneId(tl, zones);
      if (tlZone === mainZone?.id) {
        if (tl.id === agent.id) return idx;
        idx++;
      }
    }
    for (const w of workers) {
      const hasProjectZone = w.projectId && zones.some((z) => z.projectId === w.projectId);
      if (!hasProjectZone) {
        if (w.id === agent.id) return idx;
        idx++;
      }
    }
    return idx;
  }

  // Project zone: team leads first, then workers
  let idx = 0;
  for (const tl of teamLeads) {
    if (tl.projectId === agent.projectId && getTargetZoneId(tl, zones) === targetZoneId) {
      if (tl.id === agent.id) return idx;
      idx++;
    }
  }
  for (const w of workers) {
    if (w.projectId === agent.projectId) {
      if (w.id === agent.id) return idx;
      idx++;
    }
  }
  return idx;
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
  useMovementStore.getState().enqueueMovement(agentId, graph, fromWaypointId, toWaypointId);
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
  const targetTag = getTargetTag(agent.status, targetZoneId);

  // Zone change: agent needs to walk between zones to their final destination
  if (currentZoneId !== undefined && currentZoneId !== targetZoneId) {
    const allAgents = useAgentStore.getState().agents;
    const deskIndex = computeDeskIndex(agent, allAgents, zones);
    // Find the final destination in the target zone (desk or center based on status)
    const toWps = findWaypointsByZoneAndTag(graph, targetZoneId, targetTag);
    const fallbackTag = targetZoneId === BREAK_ROOM_ZONE_ID ? "lounge" : "center";
    const fallbackWps = findWaypointsByZoneAndTag(graph, targetZoneId, fallbackTag);
    const toWp = toWps.length > 0
      ? toWps[deskIndex % toWps.length]
      : fallbackWps.length > 0 ? fallbackWps[0] : null;
    if (!toWp) return;

    // Find current location: nearest waypoint in current zone
    const currentFallbackTag = currentZoneId === BREAK_ROOM_ZONE_ID ? "lounge" : "center";
    const currentWps = currentZoneId
      ? findWaypointsByZoneAndTag(graph, currentZoneId, currentFallbackTag)
      : [];
    const fromWp = currentWps.length > 0 ? currentWps[0] : null;
    if (!fromWp) return;

    triggerMovement(agent.id, graph, fromWp.id, toWp.id);
    agentZoneMap.set(agent.id, targetZoneId);
    return;
  }

  // Status change within same zone: move between center/lounge and desk
  if (prevStatus && prevStatus !== agent.status) {
    const prevTag = getTargetTag(prevStatus, targetZoneId);
    if (prevTag !== targetTag) {
      const allAgents = useAgentStore.getState().agents;
      const deskIndex = computeDeskIndex(agent, allAgents, zones);
      const fromWps = findWaypointsByZoneAndTag(graph, targetZoneId, prevTag);
      const toWps = findWaypointsByZoneAndTag(graph, targetZoneId, targetTag);
      if (fromWps.length > 0 && toWps.length > 0) {
        const fromWp = prevTag === "desk" ? fromWps[deskIndex % fromWps.length] : fromWps[0];
        const toWp = targetTag === "desk" ? toWps[deskIndex % toWps.length] : toWps[0];
        triggerMovement(agent.id, graph, fromWp.id, toWp.id);
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
  const mainZone = zones.find((z) => z.projectId === null && z.id !== BREAK_ROOM_ZONE_ID);
  const startWps = mainZone
    ? findWaypointsByZoneAndTag(graph, mainZone.id, "entrance")
    : [];

  // Walk to target based on current status
  const allAgents = useAgentStore.getState().agents;
  const deskIndex = computeDeskIndex(agent, allAgents, zones);
  const targetTag = getTargetTag(agent.status, targetZoneId);
  const destWps = findWaypointsByZoneAndTag(graph, targetZoneId, targetTag);
  const fallbackTag = targetZoneId === BREAK_ROOM_ZONE_ID ? "lounge" : "center";
  const fallbackWps = findWaypointsByZoneAndTag(graph, targetZoneId, fallbackTag);
  const toWp = destWps.length > 0
    ? destWps[deskIndex % destWps.length]
    : fallbackWps.length > 0 ? fallbackWps[0] : null;

  if (startWps.length > 0 && toWp) {
    triggerMovement(agent.id, graph, startWps[0].id, toWp.id);
  }

  agentZoneMap.set(agent.id, targetZoneId);
}

/**
 * Re-evaluate team leads in a project when worker activity changes.
 * If a worker starts working, the team lead should leave the break room and go to their project office.
 * If all workers become idle, the team lead should go to the break room.
 */
function reevaluateProjectTeamLeads(projectId: string | null, allAgents: Map<string, Agent>) {
  if (!projectId) return;
  for (const [id, agent] of allAgents) {
    if (agent.role === "team_lead" && agent.projectId === projectId) {
      const prev = agentPrevStatus.get(id);
      processAgentMovement(agent, prev);
    }
  }
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

        // When a worker's status changes, re-evaluate team leads in the same project
        if (agent.role === "worker" || agent.role === "team_lead") {
          reevaluateProjectTeamLeads(agent.projectId, state.agents);
        }
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
