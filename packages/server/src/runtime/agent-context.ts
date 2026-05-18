import type Database from "better-sqlite3-multiple-ciphers";
import type { AgentProfile } from "@otterbot/shared";
import { openAgentDb, type AgentDb, type AgentDrizzle } from "../db/agent-db.js";
import { EmbeddingService, type Embedder } from "../embedding.js";
import { VecIndex } from "../vec-index.js";
import { MemoryService } from "../memory/memory-service.js";
import { SkillService } from "../skills/skill-service.js";
import { UserProfileService } from "../user-profile/user-profile-service.js";

/**
 * Everything one agent needs at runtime: its profile, secrets, isolated
 * database, and the per-agent service instances bound to that database.
 * The orchestrator builds one `AgentContext` per profile.
 */
export interface AgentContext {
  profile: AgentProfile;
  /** Per-agent secrets parsed from the profile's `.env` (never `process.env`). */
  secrets: Map<string, string>;
  agentDb: AgentDb;
  sqlite: Database.Database;
  db: AgentDrizzle;
  embedding: EmbeddingService;
  vec: VecIndex;
  memory: MemoryService;
  skills: SkillService;
  userProfile: UserProfileService;
  /** Close the agent's database handles. */
  close(): void;
}

export interface BuildAgentContextInput {
  profile: AgentProfile;
  secrets: Map<string, string>;
  /** Path to this agent's isolated `agent.db`. */
  agentDbPath: string;
  /** Path to this agent's `skills/` directory. */
  skillsDir: string;
  /** The embedder resolved from the agent's embedding model. */
  embedder: Embedder;
  /** Database encryption key, if configured. */
  dbKey?: string | null;
}

/** Construct an agent's runtime context, opening its isolated database. */
export function buildAgentContext(input: BuildAgentContextInput): AgentContext {
  const agentDb = openAgentDb(input.agentDbPath, input.dbKey);
  const embedding = new EmbeddingService(input.embedder, agentDb);
  const vec = new VecIndex(agentDb.sqlite, embedding);
  const memory = new MemoryService(agentDb.db, agentDb.sqlite, vec);
  const skills = new SkillService(agentDb.db, input.skillsDir, memory);
  const userProfile = new UserProfileService(agentDb.db);

  return {
    profile: input.profile,
    secrets: input.secrets,
    agentDb,
    sqlite: agentDb.sqlite,
    db: agentDb.db,
    embedding,
    vec,
    memory,
    skills,
    userProfile,
    close: () => agentDb.close(),
  };
}
