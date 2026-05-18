import type { AgentDb } from "./db/agent-db.js";

/** Connection details for an OpenAI-compatible `/embeddings` endpoint. */
export interface EmbeddingConfig {
  /** Base URL ending in `/v1` (LM Studio, Ollama, OpenAI, …). */
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * Produces embedding vectors for memory indexing / semantic search.
 * Implementations: HTTP (OpenAI-compatible), the in-process built-in embedder,
 * or a null embedder that leaves vector search disabled.
 */
export interface Embedder {
  /** Probe for the embedding dimension; `null` when the embedder is unavailable. */
  probeDimension(): Promise<number | null>;
  /** Embed `text`; `null` when the embedder is unavailable or the call fails. */
  generate(text: string): Promise<Float32Array | null>;
}

/** An embedder backed by an OpenAI-compatible `/embeddings` HTTP endpoint. */
export class HttpEmbedder implements Embedder {
  constructor(private readonly cfg: EmbeddingConfig) {}

  private get url(): string {
    return `${this.cfg.baseUrl.replace(/\/$/, "")}/embeddings`;
  }

  async probeDimension(): Promise<number | null> {
    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify({ model: this.cfg.model, input: "test" }),
      });
      if (!res.ok) {
        console.warn("[embedding] probe failed:", res.status, await res.text());
        return null;
      }
      const data = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
      const vec = data.data?.[0]?.embedding;
      if (!Array.isArray(vec) || vec.length === 0) {
        console.warn("[embedding] probe returned empty embedding");
        return null;
      }
      return vec.length;
    } catch (err) {
      console.warn("[embedding] probe error:", err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  async generate(text: string): Promise<Float32Array | null> {
    try {
      const res = await fetch(this.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.cfg.apiKey}`,
        },
        body: JSON.stringify({ model: this.cfg.model, input: text }),
      });
      if (!res.ok) {
        console.warn("[embedding] generate failed:", res.status, await res.text());
        return null;
      }
      const data = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
      const arr = data.data?.[0]?.embedding;
      if (!Array.isArray(arr)) return null;
      return new Float32Array(arr);
    } catch (err) {
      console.warn("[embedding] generate error:", err instanceof Error ? err.message : String(err));
      return null;
    }
  }
}

/**
 * A no-op embedder. Used when an agent has embeddings turned off — vector
 * search stays disabled and memory falls back to FTS5 keyword search.
 */
export class NullEmbedder implements Embedder {
  async probeDimension(): Promise<number | null> {
    return null;
  }
  async generate(): Promise<Float32Array | null> {
    return null;
  }
}

/**
 * Per-agent embedding service. Wraps an {@link Embedder} and owns the agent
 * DB's vec0 dimension lifecycle. One instance per agent.
 */
export class EmbeddingService {
  private dimension: number | null = null;
  private available = false;

  constructor(
    private readonly embedder: Embedder,
    private readonly agentDb: AgentDb
  ) {}

  /** Probe the underlying embedder for its embedding dimension. */
  probeDimension(): Promise<number | null> {
    return this.embedder.probeDimension();
  }

  /** Generate an embedding for the given text. */
  generate(text: string): Promise<Float32Array | null> {
    return this.embedder.generate(text);
  }

  /** The cached dimension, falling back to the value persisted in vec_config. */
  getDimension(): number | null {
    if (this.dimension) return this.dimension;
    const row = this.agentDb.sqlite
      .prepare("SELECT value FROM vec_config WHERE key = 'embedding_dim'")
      .get() as { value: string } | undefined;
    if (row) {
      const parsed = parseInt(row.value, 10);
      if (!Number.isNaN(parsed)) {
        this.dimension = parsed;
        return parsed;
      }
    }
    return null;
  }

  private setDimension(dim: number): void {
    this.dimension = dim;
    this.available = true;
    this.agentDb.sqlite
      .prepare("INSERT OR REPLACE INTO vec_config (key, value) VALUES ('embedding_dim', ?)")
      .run(String(dim));
  }

  /** Whether sqlite-vec is loaded and a dimension has been established. */
  isAvailable(): boolean {
    return this.available;
  }

  /**
   * Probe the embedder and set up / rebuild the vec0 table as needed.
   * Never rejects — any failure (unavailable embedder, closed DB during
   * shutdown) just leaves vector search disabled.
   */
  async init(): Promise<void> {
    try {
      const version = this.agentDb.sqlite
        .prepare("SELECT vec_version() as v")
        .get() as { v: string } | undefined;
      if (!version) {
        console.warn("[vec] sqlite-vec extension not loaded");
        return;
      }

      const storedDim = this.getDimension();
      const probedDim = await this.probeDimension();

      if (!probedDim) {
        console.warn("[vec] embeddings unavailable; vector search disabled (keyword search still works)");
        return;
      }

      if (storedDim && storedDim !== probedDim) {
        console.info(`[vec] dimension changed ${storedDim} -> ${probedDim}; rebuilding vec0 table`);
        this.agentDb.recreateVecTable(probedDim);
        this.setDimension(probedDim);
        return;
      }

      if (!storedDim) {
        this.agentDb.recreateVecTable(probedDim);
        this.setDimension(probedDim);
        console.info(`[vec] initialised with dimension ${probedDim}`);
        return;
      }

      this.available = true;
      console.info(`[vec] ready with dimension ${storedDim}`);
    } catch (err) {
      console.warn("[vec] init failed:", err instanceof Error ? err.message : String(err));
    }
  }
}
