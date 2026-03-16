export enum GameEngine {
  ThreeJS = "threejs",
  BabylonJS = "babylonjs",
  Phaser = "phaser",
  PlayCanvas = "playcanvas",
  Canvas = "canvas",
  Custom = "custom",
}

export enum GameStatus {
  Draft = "draft",
  Building = "building",
  Playable = "playable",
  Testing = "testing",
  Published = "published",
}

export interface GameManifest {
  id: string;
  name: string;
  description: string;
  version: string;
  engine: GameEngine;
  entryPoint: string;
  thumbnail?: string;
  tags: string[];
  status: GameStatus;
  projectId: string;
  playtestResults?: PlaytestResult[];
  createdAt: string;
  updatedAt: string;
}

export interface GameAsset {
  id: string;
  gameId: string;
  type: "model" | "texture" | "sound" | "sprite" | "shader" | "script";
  name: string;
  path: string;
  generatedBy: "procedural" | "ai-image" | "ai-model" | "ai-sound" | "manual";
  prompt?: string;
  createdAt: string;
}

export interface GameTemplate {
  id: string;
  engine: GameEngine;
  name: string;
  description: string;
  files: string[];
}

export interface PlaytestResult {
  id: string;
  gameId: string;
  timestamp: string;
  duration: number;
  completedObjectives: string[];
  failedObjectives: string[];
  bugs: PlaytestBug[];
  performanceMetrics: PerformanceMetrics;
  agentObservations: string;
}

export interface PlaytestBug {
  description: string;
  severity: "critical" | "major" | "minor";
  screenshot?: string;
  gameState?: Record<string, unknown>;
}

export interface PerformanceMetrics {
  avgFps: number;
  minFps: number;
  loadTimeMs: number;
  memoryUsageMb: number;
}
