import { describe, it, expect, beforeEach, vi } from "vitest";

// --- In-memory mock DB rows ---
let memoryRows: Array<{ id: string; category: string; content: string; source: string; agentScope: string | null; projectId: string | null; importance: number; accessCount: number; lastAccessedAt: string | null; createdAt: string; updatedAt: string }> = [];
let ftsRows: Array<{ id: string; content: string; category: string }> = [];

const mockRun = vi.fn((sql?: any) => ({ changes: memoryRows.length }));
const mockAll = vi.fn(() => memoryRows.map((r) => ({ id: r.id })));

vi.mock("../../db/index.js", () => ({
  getDb: vi.fn(() => ({
    select: vi.fn((...cols: any[]) => ({
      from: vi.fn(() => ({
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
    delete: vi.fn(() => ({
      where: vi.fn(() => ({
        run: vi.fn(() => {
          const count = memoryRows.length;
          memoryRows = [];
          return { changes: count };
        }),
      })),
      run: vi.fn(() => {
        const count = memoryRows.length;
        memoryRows = [];
        return { changes: count };
      }),
    })),
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
  schema: {
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
  },
}));

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
    ftsRows = [];
    mockVectorRemove.mockClear();
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
});
