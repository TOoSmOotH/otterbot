import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

loadDotenv();

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  assetsDir: string;
  skillsDir: string;
  lmstudioBaseUrl: string;
  lmstudioApiKey: string | null;
  model: string;
  enableDesktop: boolean;
  vncHost: string;
  vncPort: number;
  enableEmbeddings: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

export function loadConfig(): Config {
  const rootDir = resolve(process.cwd());
  const dataDir = process.env.DATA_DIR ?? resolve(rootDir, "data");
  return {
    port: Number(process.env.PORT ?? 3001),
    host: process.env.HOST ?? "0.0.0.0",
    dataDir,
    assetsDir: process.env.ASSETS_DIR ?? resolve(rootDir, "assets"),
    skillsDir: process.env.SKILLS_DIR ?? resolve(dataDir, "skills"),
    lmstudioBaseUrl: process.env.LMSTUDIO_BASE_URL ?? "http://localhost:1234/v1",
    lmstudioApiKey: process.env.LMSTUDIO_API_KEY ?? null,
    model: process.env.LMSTUDIO_MODEL ?? "local-model",
    enableDesktop: bool(process.env.ENABLE_DESKTOP, false),
    vncHost: process.env.VNC_HOST ?? "127.0.0.1",
    vncPort: Number(process.env.VNC_PORT ?? 5901),
    enableEmbeddings: bool(process.env.ENABLE_EMBEDDINGS, false),
    logLevel: (process.env.LOG_LEVEL as Config["logLevel"]) ?? "info",
  };
}

let _config: Config | null = null;
export function getConfig(): Config {
  if (!_config) _config = loadConfig();
  return _config;
}
