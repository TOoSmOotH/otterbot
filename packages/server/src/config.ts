import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

loadDotenv();

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  assetsDir: string;
  webDistDir: string;
  skillsDir: string;
  lmstudioBaseUrl: string;
  lmstudioApiKey: string | null;
  model: string;
  enableEmbeddings: boolean;
  logLevel: "debug" | "info" | "warn" | "error";
  /** Encryption key for all SQLite databases. The only secret kept in .env. */
  dbKey: string | null;
  /** Agent-to-agent transport: in-process bus, or a shared Discord channel. */
  agentTransport: "local" | "discord";
  discordBotToken: string | null;
  discordChannelId: string | null;
}

function bool(v: string | undefined, fallback: boolean): boolean {
  if (v === undefined) return fallback;
  return v === "1" || v.toLowerCase() === "true";
}

export function loadConfig(): Config {
  const rootDir = resolve(process.cwd());
  // Resolve every path to absolute. Env values (e.g. the `.env.example`
  // defaults) are often relative, but consumers like @fastify/static and
  // SQLite need absolute paths. `resolve` leaves already-absolute paths intact.
  const dataDir = resolve(rootDir, process.env.DATA_DIR ?? "data");
  return {
    port: Number(process.env.PORT ?? 3001),
    host: process.env.HOST ?? "0.0.0.0",
    dataDir,
    assetsDir: resolve(rootDir, process.env.ASSETS_DIR ?? "assets"),
    webDistDir: resolve(rootDir, process.env.WEB_DIST_DIR ?? "packages/web/dist"),
    skillsDir: resolve(dataDir, process.env.SKILLS_DIR ?? "skills"),
    lmstudioBaseUrl: process.env.LMSTUDIO_BASE_URL ?? "http://localhost:1234/v1",
    lmstudioApiKey: process.env.LMSTUDIO_API_KEY ?? null,
    model: process.env.LMSTUDIO_MODEL ?? "local-model",
    enableEmbeddings: bool(process.env.ENABLE_EMBEDDINGS, false),
    logLevel: (process.env.LOG_LEVEL as Config["logLevel"]) ?? "info",
    dbKey: process.env.OTTERBOT_DB_KEY ?? null,
    agentTransport: process.env.AGENT_TRANSPORT === "discord" ? "discord" : "local",
    discordBotToken: process.env.DISCORD_BOT_TOKEN ?? null,
    discordChannelId: process.env.DISCORD_CHANNEL_ID ?? null,
  };
}

let _config: Config | null = null;
export function getConfig(): Config {
  if (!_config) _config = loadConfig();
  return _config;
}
