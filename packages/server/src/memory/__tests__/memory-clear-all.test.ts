import { describe, it, expect, beforeEach, vi } from "vitest";

// --- In-memory mock DB rows ---
let memoryRows: Array<{ id: string; category: string; content: string; source: string; agentScope: string | null; projectId: string | null; importance: number; accessCount: number; lastAccessedAt: string | null; createdAt: string; updatedAt: string }> = [];
let episodeRows: Array<{ id: string; date: string; projectId: string | null; summary: string; keyDecisions: string[]; createdAt: string }> = [];
let ftsRows: Array<{ id: string; content: string; category: string }> = [];

const mockDeleteRun = vi.fn(() => {
  const count = memoryRows.length;
  memoryRows = [];
  return { changes: count };
});
const mockEpisodesDeleteRun = vi.fn(() => {
  const count = episodeRows.length;
  episodeRows = [];
  return { changes: count };
});

// Track which table is being deleted from
let deleteTarget: "memories" | "memoryEpisodes" | null = null;

vi.mock("../../db/index.js", () => ({
  getDb: vi.fn(() => ({
    select: vi.fn((...cols: any[]) => ({
      from: vi.fn((table: any) => ({
        where: vi.fn(() => ({
          get: vi.fn(() => memoryRows[0] ?? null),
          all: vi.fn(() => memoryRows),
        })),
        orderBy: vi.fn(() => ({
          all: vi.fn(() => memoryRows),
          limit: vi.fn(() => ({
            all: vi.fn(() => memoryRows),
          })),
        })),
        all: vi.fn(() => memoryRows.map((r) => ({ id: r.id }))),
        get: vi.fn(() => memoryRows[0] ?? null),
      })),
    })),
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        run: vi.fn(() => {
          const id = `mem_${memoryRows.length + 1}`;
          memoryRows.push({
            id,
            category: "general",
            content: "test",
            source: "user",
            agentScope: null,
            projectId: null,
            importance: 5,
            accessCount: 0,
            lastAccessedAt: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
          return { changes: 1 };
        }),
      })),
    })),
    delete: vi.fn((table: any) => {
      // Determine which table is being targeted based on the table reference
      const isEpisodes = table === mockSchema.memoryEpisodes;
      if (isEpisodes) {
        return {
          where: vi.fn(() => ({
            run: mockEpisodesDeleteRun,
          })),
          run: mockEpisodesDeleteRun,
        };
      }
      return {
        where: vi.fn(() => ({
          run: mockDeleteRun,
        })),
        run: mockDeleteRun,
      };
    }),
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(() => ({
          run: vi.fn(),
        })),
      })),
    })),
    run: vi.fn(),
    all: vi.fn(() => []),
  })),
  schema: null as any, // Will be replaced below
}));

const mockSchema = {
  memories: {
    id: "id",
    category: "category",
    content: "content",
    source: "source",
    agentScope: "agentScope",
    projectId: "projectId",
    importance: "importance",
    accessCount: "accessCount",
    lastAccessedAt: "lastAccessedAt",
    createdAt: "createdAt",
    updatedAt: "updatedAt",
  },
  memoryEpisodes: {
    id: "ep_id",
    date: "date",
    projectId: "projectId",
    summary: "summary",
    keyDecisions: "keyDecisions",
    createdAt: "createdAt",
  },
};

// Patch schema onto the mock
const dbMock = await import("../../db/index.js");
(dbMock as any).schema = mockSchema;

const mockVectorRemove = vi.fn();
vi.mock("../vector-store.js", () => ({
  getVectorStore: vi.fn(() => ({
    embedAndStore: vi.fn().mockResolvedValue(undefined),
    remove: mockVectorRemove,
    search: vi.fn().mockResolvedValue([]),
    hybridRank: vi.fn(() => []),
  })),
}));

// Must import after mocks
const { MemoryService } = await import("../memory-service.js");

describe("MemoryService.clearAll", () => {
  let service: InstanceType<typeof MemoryService>;

  beforeEach(() => {
    vi.clearAllMocks();
    memoryRows = [];
    episodeRows = [];
    ftsRows = [];
    mockVectorRemove.mockClear();
    mockDeleteRun.mockClear();
    mockEpisodesDeleteRun.mockClear();
    service = new MemoryService();
  });

  it("returns 0 when no memories exist", () => {
    const deleted = service.clearAll();
    expect(deleted).toBe(0);
  });

  it("returns the number of deleted memories", () => {
    memoryRows = [
      { id: "m1", category: "fact", content: "The sky is blue", source: "user", agentScope: null, projectId: null, importance: 5, accessCount: 0, lastAccessedAt: null, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
      { id: "m2", category: "preference", content: "User likes dark mode", source: "user", agentScope: null, projectId: null, importance: 7, accessCount: 2, lastAccessedAt: "2026-01-02", createdAt: "2026-01-01", updatedAt: "2026-01-02" },
      { id: "m3", category: "instruction", content: "Always use TypeScript", source: "agent", agentScope: "worker", projectId: "proj1", importance: 9, accessCount: 5, lastAccessedAt: "2026-01-03", createdAt: "2026-01-01", updatedAt: "2026-01-03" },
    ];

    const deleted = service.clearAll();
    expect(deleted).toBe(3);
  });

  it("removes all entries from the vector store", () => {
    memoryRows = [
      { id: "m1", category: "fact", content: "Fact 1", source: "user", agentScope: null, projectId: null, importance: 5, accessCount: 0, lastAccessedAt: null, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
      { id: "m2", category: "fact", content: "Fact 2", source: "user", agentScope: null, projectId: null, importance: 5, accessCount: 0, lastAccessedAt: null, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
    ];

    service.clearAll();
    expect(mockVectorRemove).toHaveBeenCalledTimes(2);
    expect(mockVectorRemove).toHaveBeenCalledWith("m1");
    expect(mockVectorRemove).toHaveBeenCalledWith("m2");
  });

  it("clears the memories array after deletion", () => {
    memoryRows = [
      { id: "m1", category: "general", content: "Test", source: "user", agentScope: null, projectId: null, importance: 5, accessCount: 0, lastAccessedAt: null, createdAt: "2026-01-01", updatedAt: "2026-01-01" },
    ];

    service.clearAll();
    expect(memoryRows).toHaveLength(0);
  });

  it("clears episodic memory logs so no residual summaries persist", () => {
    memoryRows = [
      { id: "m1", category: "fact", content: "User prefers dark mode", source: "user", agentScope: null, projectId: null, importance: 7, accessCount: 1, lastAccessedAt: "2026-01-15", createdAt: "2026-01-10", updatedAt: "2026-01-15" },
    ];
    episodeRows = [
      { id: "ep1", date: "2026-01-14", projectId: null, summary: "Discussed preferences", keyDecisions: ["dark mode"], createdAt: "2026-01-15" },
      { id: "ep2", date: "2026-01-15", projectId: "proj1", summary: "Worked on project", keyDecisions: ["use TS"], createdAt: "2026-01-16" },
    ];

    service.clearAll();

    // Memories table should be cleared
    expect(memoryRows).toHaveLength(0);
    // Episodes table should also be cleared
    expect(mockEpisodesDeleteRun).toHaveBeenCalled();
    expect(episodeRows).toHaveLength(0);
  });

  it("leaves no retrievable entries after full wipe", () => {
    memoryRows = [
      { id: "m1", category: "preference", content: "Likes TypeScript", source: "user", agentScope: null, projectId: null, importance: 8, accessCount: 3, lastAccessedAt: "2026-01-20", createdAt: "2026-01-01", updatedAt: "2026-01-20" },
      { id: "m2", category: "fact", content: "Birthday is Jan 1", source: "agent", agentScope: "worker", projectId: null, importance: 6, accessCount: 1, lastAccessedAt: "2026-01-10", createdAt: "2026-01-05", updatedAt: "2026-01-10" },
    ];
    episodeRows = [
      { id: "ep1", date: "2026-01-19", projectId: null, summary: "Daily summary", keyDecisions: [], createdAt: "2026-01-20" },
    ];

    service.clearAll();

    // Verify all storage layers are empty
    expect(memoryRows).toHaveLength(0);
    expect(episodeRows).toHaveLength(0);
    expect(mockVectorRemove).toHaveBeenCalledWith("m1");
    expect(mockVectorRemove).toHaveBeenCalledWith("m2");
  });
});
