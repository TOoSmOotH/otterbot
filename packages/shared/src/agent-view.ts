export type Vec3 = [number, number, number];

export interface ModelPack {
  id: string;
  name: string;
  characterUrl: string;
  thumbnailUrl: string;
  animations: {
    idle: string;
    action: string;
    working?: string;
  };
}

export type GearConfig = Record<string, boolean>;

export interface AgentPosition {
  agentId: string;
  x: number;
  y: number;
  z: number;
  rotation: number;
  state: "idle" | "moving" | "working";
  timestamp: string;
}

export interface Waypoint {
  id: string;
  position: Vec3;
  label?: string;
  zoneId?: string;
  tag?: string;
}

export interface WaypointEdge {
  from: string;
  to: string;
  weight?: number;
}

export interface WaypointGraph {
  waypoints: Waypoint[];
  edges: WaypointEdge[];
}

export interface SceneZone {
  id: string;
  name: string;
  position: Vec3;
  size: Vec3;
  borderColor?: string;
}

export interface SceneProp {
  asset: string;
  position: Vec3;
  rotation?: Vec3;
  scale?: number | Vec3;
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export interface EnvironmentAsset {
  id: string;
  name: string;
  modelUrl: string;
}

export interface EnvironmentPack {
  id: string;
  name: string;
  assets: EnvironmentAsset[];
}

export interface SceneConfig {
  id: string;
  name: string;
  props: SceneProp[];
  floor?: {
    color?: string;
    size?: [number, number];
    position?: Vec3;
  };
  lighting?: {
    ambientIntensity?: number;
    directionalPosition?: Vec3;
    directionalIntensity?: number;
  };
  camera?: {
    position?: Vec3;
    target?: Vec3;
  };
  agentPositions?: {
    ceo?: { position: Vec3; rotation?: number };
    coo?: Array<{ position: Vec3; rotation?: number }>;
    teamLead?: Array<{ position: Vec3; rotation?: number }>;
    worker?: Array<{ position: Vec3; rotation?: number }>;
  };
  waypointGraph?: WaypointGraph;
  zones?: SceneZone[];
}
