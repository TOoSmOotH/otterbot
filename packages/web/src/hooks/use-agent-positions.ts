import { useMemo } from "react";
import { useAgentStore } from "../stores/agent-store";
import { useModelPackStore } from "../stores/model-pack-store";
import { useEnvironmentStore } from "../stores/environment-store";
import { useProjectStore } from "../stores/project-store";
import { findWaypointsByZoneAndTag } from "../lib/pathfinding";
import type { Agent } from "@otterbot/shared";

export interface AgentPosition {
  agent: Agent | null;
  role: string;
  x: number;
  z: number;
  label: string;
  modelPackId: string | null;
  gearConfig: Record<string, boolean> | null;
  rotationY: number;
}

interface UserProfile {
  name: string | null;
  avatar: string | null;
  modelPackId?: string | null;
  gearConfig?: Record<string, boolean> | null;
  cooName?: string;
}

export function useAgentPositions(userProfile: UserProfile | undefined): AgentPosition[] {
  const agents = useAgentStore((s) => s.agents);
  const departingIds = useAgentStore((s) => s._departingIds);
  const packs = useModelPackStore((s) => s.packs);
  const activeScene = useEnvironmentStore((s) => s.getActiveScene());
  const projects = useProjectStore((s) => s.projects);

  const hiddenProjectIds = useMemo(() => {
    const hidden = new Set<string>();
    for (const p of projects) {
      if (p.show3d === false) hidden.add(p.id);
    }
    return hidden;
  }, [projects]);

  const positions = useMemo(() => {
    // Include departing agents (status "done" but walking to center) so they still render
    // Exclude agents belonging to projects with 3D view disabled
    const activeAgents = Array.from(agents.values()).filter(
      (a) => (a.status !== "done" || departingIds.has(a.id)) &&
             !(a.projectId && hiddenProjectIds.has(a.projectId)),
    );

    // Group by role
    const coos = activeAgents.filter((a) => a.role === "coo");
    const teamLeads = activeAgents.filter((a) => a.role === "team_lead");
    const workers = activeAgents.filter((a) => a.role === "worker");
    const adminAssistants = activeAgents.filter((a) => a.role === "admin_assistant");
    const schedulers = activeAgents.filter((a) => a.role === "scheduler");
    const moduleAgents = activeAgents.filter((a) => a.role === "module_agent");

    // Helper: does a project have any actively-working non-lead agents?
    const hasActiveWorkersInProject = (projectId: string | null): boolean => {
      if (!projectId) return false;
      return activeAgents.some(
        (a) => a.projectId === projectId && a.role !== "team_lead" && (a.status === "thinking" || a.status === "acting"),
      );
    };

    const positions: AgentPosition[] = [];

    // Zone-aware positioning via waypoint graph
    if (activeScene?.waypointGraph && activeScene?.zones) {
      const graph = activeScene.waypointGraph;
      const breakRoomZoneId = "break-room";
      const mainZone = activeScene.zones.find((z) => z.projectId === null && z.id !== breakRoomZoneId);
      const mainZoneId = mainZone?.id;
      const breakRoomZone = activeScene.zones.find((z) => z.id === breakRoomZoneId);

      // Helper to get a waypoint position for a role within a zone
      const getZoneWaypointPos = (zoneId: string | undefined, tag: string, index: number): { x: number; z: number; rotationY: number } | null => {
        const wps = findWaypointsByZoneAndTag(graph, zoneId, tag);
        if (wps.length === 0) return null;
        const wp = wps[index % wps.length];
        return { x: wp.position[0], z: wp.position[2], rotationY: 0 };
      };

      // Status-aware position: agents go to desk when thinking/acting, idle agents spread near center
      const getStatusAwarePos = (agent: Agent | null, zoneId: string | undefined, deskIndex: number): { x: number; z: number; rotationY: number } => {
        const status = agent?.status ?? "idle";
        const isWorking = status === "thinking" || status === "acting";
        const isBreakRoom = zoneId === breakRoomZoneId;

        if (isWorking) {
          return getZoneWaypointPos(zoneId, "desk", deskIndex) ?? getZoneWaypointPos(zoneId, "center", 0) ?? { x: 0, z: 0, rotationY: 0 };
        }

        if (isBreakRoom) {
          return getZoneWaypointPos(zoneId, "lounge", deskIndex) ?? getZoneWaypointPos(zoneId, "center", 0) ?? { x: 0, z: 0, rotationY: 0 };
        }

        // Idle: spread agents around center so they don't stack
        const centerPos = getZoneWaypointPos(zoneId, "center", 0) ?? { x: 0, z: 0, rotationY: 0 };
        const angle = (deskIndex / 8) * Math.PI * 2;
        const radius = 1.5;
        return { x: centerPos.x + Math.cos(angle) * radius, z: centerPos.z + Math.sin(angle) * radius, rotationY: 0 };
      };

      // Global desk index counter
      let nextDeskIndex = 0;
      const zoneDeskCounters = new Map<string, number>();
      const getZoneDeskIndex = (zoneId: string): number => {
        const idx = zoneDeskCounters.get(zoneId) ?? 0;
        zoneDeskCounters.set(zoneId, idx + 1);
        return idx;
      };

      // CEO always at its desk
      const ceoDeskIndex = nextDeskIndex++;
      const ceoPos = getZoneWaypointPos(mainZoneId, "desk", ceoDeskIndex) ?? { x: 0, z: 0, rotationY: 0 };
      positions.push({
        agent: null,
        role: "ceo",
        x: ceoPos.x,
        z: ceoPos.z,
        label: userProfile?.name ?? "CEO (You)",
        modelPackId: userProfile?.modelPackId ?? null,
        gearConfig: userProfile?.gearConfig ?? null,
        rotationY: ceoPos.rotationY,
      });

      // COOs
      for (let i = 0; i < coos.length; i++) {
        const deskIdx = nextDeskIndex++;
        const pos = getStatusAwarePos(coos[i], mainZoneId, deskIdx);
        positions.push({
          agent: coos[i],
          role: "coo",
          x: pos.x,
          z: pos.z,
          label: userProfile?.cooName ?? "COO",
          modelPackId: coos[i].modelPackId ?? null,
          gearConfig: coos[i].gearConfig ?? null,
          rotationY: pos.rotationY,
        });
      }

      // Admin Assistants
      let breakRoomIdx = 0;
      for (let i = 0; i < adminAssistants.length; i++) {
        const aa = adminAssistants[i];
        const isIdle = aa.status !== "thinking" && aa.status !== "acting";
        const zoneId = isIdle && breakRoomZone ? breakRoomZoneId : mainZoneId;
        const deskIdx = isIdle && breakRoomZone ? breakRoomIdx++ : nextDeskIndex++;
        const pos = getStatusAwarePos(aa, zoneId, deskIdx);
        positions.push({
          agent: aa,
          role: "admin_assistant",
          x: pos.x,
          z: pos.z,
          label: "Admin Assistant",
          modelPackId: aa.modelPackId ?? null,
          gearConfig: aa.gearConfig ?? null,
          rotationY: pos.rotationY,
        });
      }

      // Team Leads
      for (let i = 0; i < teamLeads.length; i++) {
        const tl = teamLeads[i];
        const isIdle = tl.status !== "thinking" && tl.status !== "acting";
        const projectHasWork = hasActiveWorkersInProject(tl.projectId);
        const goToBreakRoom = isIdle && !projectHasWork && breakRoomZone;

        let zoneId: string | undefined;
        let deskIdx: number;
        if (goToBreakRoom) {
          zoneId = breakRoomZoneId;
          deskIdx = breakRoomIdx++;
        } else {
          const projectZone = tl.projectId
            ? activeScene.zones.find((z) => z.projectId === tl.projectId)
            : null;
          zoneId = projectZone?.id ?? mainZoneId;
          deskIdx = projectZone ? getZoneDeskIndex(projectZone.id) : nextDeskIndex++;
        }
        const pos = getStatusAwarePos(tl, zoneId, deskIdx);
        positions.push({
          agent: tl,
          role: "team_lead",
          x: pos.x,
          z: pos.z,
          label: "Team Lead",
          modelPackId: tl.modelPackId ?? null,
          gearConfig: tl.gearConfig ?? null,
          rotationY: pos.rotationY,
        });
      }

      // Workers
      for (let i = 0; i < workers.length; i++) {
        const w = workers[i];
        const projectZone = w.projectId
          ? activeScene.zones.find((z) => z.projectId === w.projectId)
          : null;
        const zoneId = projectZone?.id ?? mainZoneId;
        const deskIdx = projectZone ? getZoneDeskIndex(projectZone.id) : nextDeskIndex++;
        const pos = getStatusAwarePos(w, zoneId, deskIdx);
        positions.push({
          agent: w,
          role: "worker",
          x: pos.x,
          z: pos.z,
          label: w.name ?? `Worker ${w.id.slice(0, 6)}`,
          modelPackId: w.modelPackId ?? null,
          gearConfig: w.gearConfig ?? null,
          rotationY: pos.rotationY,
        });
      }

      // Schedulers
      for (let i = 0; i < schedulers.length; i++) {
        const s = schedulers[i];
        const zoneId = breakRoomZone ? breakRoomZoneId : mainZoneId;
        const deskIdx = breakRoomZone ? breakRoomIdx++ : nextDeskIndex++;
        const pos = getStatusAwarePos(s, zoneId, deskIdx);
        positions.push({
          agent: s,
          role: "scheduler",
          x: pos.x,
          z: pos.z,
          label: s.name ?? `Scheduler ${s.id.slice(0, 6)}`,
          modelPackId: s.modelPackId ?? null,
          gearConfig: s.gearConfig ?? null,
          rotationY: pos.rotationY,
        });
      }

      // Module agents
      for (let i = 0; i < moduleAgents.length; i++) {
        const ma = moduleAgents[i];
        const zoneId = breakRoomZone ? breakRoomZoneId : mainZoneId;
        const deskIdx = breakRoomZone ? breakRoomIdx++ : nextDeskIndex++;
        const pos = getStatusAwarePos(ma, zoneId, deskIdx);
        positions.push({
          agent: ma,
          role: "module_agent",
          x: pos.x,
          z: pos.z,
          label: ma.name ?? `Module Agent ${ma.id.slice(0, 6)}`,
          modelPackId: ma.modelPackId ?? null,
          gearConfig: ma.gearConfig ?? null,
          rotationY: pos.rotationY,
        });
      }
    } else if (activeScene?.agentPositions) {
      const ap = activeScene.agentPositions;

      // CEO
      positions.push({
        agent: null,
        role: "ceo",
        x: ap.ceo.position[0],
        z: ap.ceo.position[2],
        label: userProfile?.name ?? "CEO (You)",
        modelPackId: userProfile?.modelPackId ?? null,
        gearConfig: userProfile?.gearConfig ?? null,
        rotationY: ap.ceo.rotation ?? 0,
      });

      // COOs
      for (let i = 0; i < coos.length; i++) {
        const slot = ap.coo[i % ap.coo.length];
        positions.push({
          agent: coos[i],
          role: "coo",
          x: slot.position[0],
          z: slot.position[2],
          label: userProfile?.cooName ?? "COO",
          modelPackId: coos[i].modelPackId ?? null,
          gearConfig: coos[i].gearConfig ?? null,
          rotationY: slot.rotation ?? 0,
        });
      }

      // Team Leads
      for (let i = 0; i < teamLeads.length; i++) {
        const slot = ap.teamLead[i % ap.teamLead.length];
        positions.push({
          agent: teamLeads[i],
          role: "team_lead",
          x: slot.position[0],
          z: slot.position[2],
          label: "Team Lead",
          modelPackId: teamLeads[i].modelPackId ?? null,
          gearConfig: teamLeads[i].gearConfig ?? null,
          rotationY: slot.rotation ?? 0,
        });
      }

      // Workers
      for (let i = 0; i < workers.length; i++) {
        const slot = ap.worker[i % ap.worker.length];
        positions.push({
          agent: workers[i],
          role: "worker",
          x: slot.position[0],
          z: slot.position[2],
          label: workers[i].name ?? `Worker ${workers[i].id.slice(0, 6)}`,
          modelPackId: workers[i].modelPackId ?? null,
          gearConfig: workers[i].gearConfig ?? null,
          rotationY: slot.rotation ?? 0,
        });
      }

      // Schedulers
      for (let i = 0; i < schedulers.length; i++) {
        const slot = ap.worker[(workers.length + i) % ap.worker.length];
        positions.push({
          agent: schedulers[i],
          role: "scheduler",
          x: slot.position[0],
          z: slot.position[2],
          label: schedulers[i].name ?? `Scheduler ${schedulers[i].id.slice(0, 6)}`,
          modelPackId: schedulers[i].modelPackId ?? null,
          gearConfig: schedulers[i].gearConfig ?? null,
          rotationY: slot.rotation ?? 0,
        });
      }

      // Module agents
      for (let i = 0; i < moduleAgents.length; i++) {
        const slot = ap.worker[(workers.length + schedulers.length + i) % ap.worker.length];
        positions.push({
          agent: moduleAgents[i],
          role: "module_agent",
          x: slot.position[0],
          z: slot.position[2],
          label: moduleAgents[i].name ?? `Module Agent ${moduleAgents[i].id.slice(0, 6)}`,
          modelPackId: moduleAgents[i].modelPackId ?? null,
          gearConfig: moduleAgents[i].gearConfig ?? null,
          rotationY: slot.rotation ?? 0,
        });
      }
    } else {
      // Fallback: original grid layout
      positions.push({
        agent: null,
        role: "ceo",
        x: 0,
        z: 0,
        label: userProfile?.name ?? "CEO (You)",
        modelPackId: userProfile?.modelPackId ?? null,
        gearConfig: userProfile?.gearConfig ?? null,
        rotationY: 0,
      });

      for (let i = 0; i < coos.length; i++) {
        const spread = coos.length > 1 ? (i - (coos.length - 1) / 2) * 3 : 0;
        positions.push({
          agent: coos[i],
          role: "coo",
          x: spread,
          z: -3,
          label: userProfile?.cooName ?? "COO",
          modelPackId: coos[i].modelPackId ?? null,
          gearConfig: coos[i].gearConfig ?? null,
          rotationY: 0,
        });
      }

      for (let i = 0; i < teamLeads.length; i++) {
        const spread = (i - (teamLeads.length - 1) / 2) * 3;
        positions.push({
          agent: teamLeads[i],
          role: "team_lead",
          x: spread,
          z: -6,
          label: "Team Lead",
          modelPackId: teamLeads[i].modelPackId ?? null,
          gearConfig: teamLeads[i].gearConfig ?? null,
          rotationY: 0,
        });
      }

      for (let i = 0; i < workers.length; i++) {
        const spread = (i - (workers.length - 1) / 2) * 3;
        positions.push({
          agent: workers[i],
          role: "worker",
          x: spread,
          z: -9,
          label: `Worker ${workers[i].id.slice(0, 6)}`,
          modelPackId: workers[i].modelPackId ?? null,
          gearConfig: workers[i].gearConfig ?? null,
          rotationY: 0,
        });
      }

      for (let i = 0; i < schedulers.length; i++) {
        const spread = (i - (schedulers.length - 1) / 2) * 3;
        positions.push({
          agent: schedulers[i],
          role: "scheduler",
          x: spread,
          z: -12,
          label: schedulers[i].name ?? `Scheduler ${schedulers[i].id.slice(0, 6)}`,
          modelPackId: schedulers[i].modelPackId ?? null,
          gearConfig: schedulers[i].gearConfig ?? null,
          rotationY: 0,
        });
      }

      for (let i = 0; i < moduleAgents.length; i++) {
        const spread = (i - (moduleAgents.length - 1) / 2) * 3;
        positions.push({
          agent: moduleAgents[i],
          role: "module_agent",
          x: spread,
          z: -15,
          label: moduleAgents[i].name ?? `Module Agent ${moduleAgents[i].id.slice(0, 6)}`,
          modelPackId: moduleAgents[i].modelPackId ?? null,
          gearConfig: moduleAgents[i].gearConfig ?? null,
          rotationY: 0,
        });
      }
    }

    return positions;
  }, [agents, userProfile, packs, activeScene, departingIds, hiddenProjectIds]);

  return positions;
}
