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

export interface SceneProp {
  asset: string; // "{packId}/{assetId}" e.g. "kaykit-prototype-bits/Wall"
  position: [number, number, number];
  rotation?: [number, number, number];
  scale?: number | [number, number, number];
  castShadow?: boolean;
  receiveShadow?: boolean;
}

export interface SceneConfig {
  id: string;
  name: string;
  props: SceneProp[];
  floor?: {
    color?: string;
    size?: [number, number];
    position?: [number, number, number];
  };
  lighting?: {
    ambientIntensity?: number;
    directionalPosition?: [number, number, number];
    directionalIntensity?: number;
  };
  camera?: {
    position?: [number, number, number];
    target?: [number, number, number];
  };
  agentPositions?: {
    ceo: { position: [number, number, number]; rotation?: number };
    coo: { position: [number, number, number]; rotation?: number }[];
    teamLead: { position: [number, number, number]; rotation?: number }[];
    worker: { position: [number, number, number]; rotation?: number }[];
  };
}
