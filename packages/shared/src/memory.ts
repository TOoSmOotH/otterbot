import type { UserProfile } from "./user-profile.js";

export type MemoryCategory = "preference" | "fact" | "instruction" | "relationship" | "general";

export type MemorySource = "user" | "agent" | "system";

export type TemporalMarker = "current" | "past" | "upcoming";

export interface MemoryEntry {
  id: string;
  category: MemoryCategory;
  content: string;
  source: MemorySource;
  importance: number;
  accessCount: number;
  lastAccessedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SessionSummary {
  id: string;
  conversationId: string;
  summary: string;
  keyPoints: string[];
  createdAt: string;
}

export interface MemorySearchResult {
  entry: MemoryEntry;
  score: number;
  via: "fts" | "vector" | "recent" | "hybrid";
}

/**
 * A full `memories` row — includes `entityRefs` and `temporalMarker`, which
 * `MemoryEntry` omits. Used for lossless memory export/import.
 */
export interface ExportedMemory extends MemoryEntry {
  entityRefs: string[];
  temporalMarker: TemporalMarker | null;
}

/**
 * The on-disk shape of an agent memory export. Carries the agent's full
 * learned state — memories, session summaries, and the user profile — but no
 * embeddings (those are regenerated on import using the target's model).
 */
export interface AgentMemoryExport {
  otterbotMemoryExport: 1;
  exportedAt: string;
  sourceAgent: { id: string; name: string };
  memories: ExportedMemory[];
  sessionSummaries: SessionSummary[];
  userProfile: UserProfile;
}
