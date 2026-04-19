export type MemoryCategory = "preference" | "fact" | "instruction" | "relationship" | "general";

export type MemorySource = "user" | "agent" | "system";

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
  via: "fts" | "vector" | "recent";
}
