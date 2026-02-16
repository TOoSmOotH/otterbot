import { readFileSync, writeFileSync, readdirSync, existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import type {
  SceneConfig,
  SceneZone,
  WaypointGraph,
  Waypoint,
  WaypointEdge,
  OfficeTemplate,
  SceneProp,
} from "@otterbot/shared";

export class WorldLayoutManager {
  private assetsRoot: string;

  constructor(assetsRoot: string) {
    this.assetsRoot = assetsRoot;
  }

  /** Load the base world scene */
  loadBaseScene(): SceneConfig | null {
    const path = resolve(this.assetsRoot, "scenes/world-base.json");
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as SceneConfig;
    } catch {
      return null;
    }
  }

  /** Load a zone config for a specific project */
  loadZoneConfig(projectId: string): SceneConfig | null {
    const path = resolve(this.assetsRoot, `scenes/zone-${projectId}.json`);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as SceneConfig;
    } catch {
      return null;
    }
  }

  /** Load all zone configs */
  loadAllZoneConfigs(): SceneConfig[] {
    const scenesDir = resolve(this.assetsRoot, "scenes");
    if (!existsSync(scenesDir)) return [];

    const configs: SceneConfig[] = [];
    for (const file of readdirSync(scenesDir)) {
      if (!file.startsWith("zone-") || !file.endsWith(".json")) continue;
      try {
        const raw = readFileSync(resolve(scenesDir, file), "utf-8");
        configs.push(JSON.parse(raw) as SceneConfig);
      } catch (err) {
        console.error(`[world-layout] Failed to load ${file}:`, err);
      }
    }
    return configs;
  }

  /** Build a composite world scene: base + all project zones merged */
  getCompositeWorld(): SceneConfig | null {
    const base = this.loadBaseScene();
    if (!base) return null;

    const zoneConfigs = this.loadAllZoneConfigs();
    if (zoneConfigs.length === 0) return base;

    const composite: SceneConfig = {
      ...base,
      props: [...base.props],
      zones: [...(base.zones ?? [])],
      waypointGraph: {
        waypoints: [...(base.waypointGraph?.waypoints ?? [])],
        edges: [...(base.waypointGraph?.edges ?? [])],
      },
    };

    for (const zoneConfig of zoneConfigs) {
      // Merge props
      composite.props.push(...(zoneConfig.props ?? []));

      // Merge zones
      if (zoneConfig.zones) {
        composite.zones!.push(...zoneConfig.zones);
      }

      // Merge waypoint graph
      if (zoneConfig.waypointGraph) {
        composite.waypointGraph!.waypoints.push(...zoneConfig.waypointGraph.waypoints);
        composite.waypointGraph!.edges.push(...zoneConfig.waypointGraph.edges);
      }
    }

    return composite;
  }

  /** Load an office template */
  loadTemplate(templateId: string): OfficeTemplate | null {
    const path = resolve(this.assetsRoot, `office-templates/${templateId}.json`);
    if (!existsSync(path)) return null;
    try {
      return JSON.parse(readFileSync(path, "utf-8")) as OfficeTemplate;
    } catch {
      return null;
    }
  }

  /** Determine the next zone position along the hallway */
  getNextZonePosition(existingZones: SceneZone[], zoneSize: [number, number, number]): [number, number, number] {
    // Project zones are placed along the positive X side of the hallway
    // Each zone is offset along Z, starting at Z=4 with gaps
    const hallwayX = 3; // Right side of hallway (hallway is at x=0, wall at x=2)

    // Find the furthest Z position used by existing project zones
    let maxZ = 4;
    for (const zone of existingZones) {
      if (zone.projectId === null) continue; // Skip main office
      const zoneEndZ = zone.position[2] + zone.size[2];
      if (zoneEndZ > maxZ) {
        maxZ = zoneEndZ + 2; // 2 unit gap
      }
    }

    return [hallwayX, 0, maxZ];
  }

  /** Instantiate a template at a position for a project */
  instantiateTemplate(
    template: OfficeTemplate,
    position: [number, number, number],
    projectId: string,
  ): { props: SceneProp[]; zone: SceneZone; waypoints: Waypoint[]; edges: WaypointEdge[] } {
    const zoneId = `zone-${projectId}`;

    // Offset all prop positions
    const props: SceneProp[] = template.props.map((p) => ({
      ...p,
      position: [
        p.position[0] + position[0],
        p.position[1] + position[1],
        p.position[2] + position[2],
      ] as [number, number, number],
    }));

    // Create zone definition
    const zone: SceneZone = {
      id: zoneId,
      name: `Project Office`,
      projectId,
      position,
      size: template.size,
    };

    // Offset waypoints and prefix IDs with zone
    const waypoints: Waypoint[] = template.waypoints.map((wp) => ({
      ...wp,
      id: `${zoneId}-${wp.id}`,
      position: [
        wp.position[0] + position[0],
        wp.position[1] + position[1],
        wp.position[2] + position[2],
      ] as [number, number, number],
      zoneId,
    }));

    // Update edge references with zone prefix
    const edges: WaypointEdge[] = template.edges.map((e) => ({
      from: `${zoneId}-${e.from}`,
      to: `${zoneId}-${e.to}`,
      weight: e.weight,
    }));

    return { props, zone, waypoints, edges };
  }

  /** Connect a zone's entrance waypoints to nearest hallway waypoints */
  connectZoneToHallway(
    existingGraph: WaypointGraph,
    newWaypoints: Waypoint[],
  ): WaypointEdge[] {
    const hallwayWaypoints = existingGraph.waypoints.filter((wp) => wp.tag === "hallway");
    const entranceWaypoints = newWaypoints.filter((wp) => wp.tag === "entrance");
    const bridgeEdges: WaypointEdge[] = [];

    for (const entrance of entranceWaypoints) {
      // Find nearest hallway waypoint
      let nearestId: string | null = null;
      let nearestDist = Infinity;

      for (const hw of hallwayWaypoints) {
        const dx = entrance.position[0] - hw.position[0];
        const dy = entrance.position[1] - hw.position[1];
        const dz = entrance.position[2] - hw.position[2];
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < nearestDist) {
          nearestDist = dist;
          nearestId = hw.id;
        }
      }

      if (nearestId) {
        bridgeEdges.push({ from: nearestId, to: entrance.id });
      }
    }

    return bridgeEdges;
  }

  /** Add a project zone to the world */
  addZone(projectId: string, templateId: string = "default-project-office"): SceneZone | null {
    const base = this.loadBaseScene();
    if (!base) return null;

    const template = this.loadTemplate(templateId);
    if (!template) return null;

    // Get all existing zones
    const allZoneConfigs = this.loadAllZoneConfigs();
    const allZones: SceneZone[] = [...(base.zones ?? [])];
    for (const zc of allZoneConfigs) {
      if (zc.zones) allZones.push(...zc.zones);
    }

    // Determine position
    const position = this.getNextZonePosition(allZones, template.size);

    // Instantiate
    const { props, zone, waypoints, edges } = this.instantiateTemplate(template, position, projectId);

    // Connect to hallway
    const baseGraph = base.waypointGraph ?? { waypoints: [], edges: [] };
    const bridgeEdges = this.connectZoneToHallway(baseGraph, waypoints);

    // Save as zone config
    const zoneConfig: SceneConfig = {
      id: `zone-${projectId}`,
      name: `Project ${projectId} Office`,
      props,
      zones: [zone],
      waypointGraph: {
        waypoints,
        edges: [...edges, ...bridgeEdges],
      },
    };

    const path = resolve(this.assetsRoot, `scenes/zone-${projectId}.json`);
    writeFileSync(path, JSON.stringify(zoneConfig, null, 2));

    return zone;
  }

  /** Remove a project zone */
  removeZone(projectId: string): boolean {
    const path = resolve(this.assetsRoot, `scenes/zone-${projectId}.json`);
    if (!existsSync(path)) return false;
    unlinkSync(path);
    return true;
  }
}
