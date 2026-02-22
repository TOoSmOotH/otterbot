/**
 * Local embedding model using @huggingface/transformers.
 * Uses all-MiniLM-L6-v2 (~23MB, 384-dim vectors) for personal-scale
 * semantic search without external API calls.
 */

let pipeline: any = null;
let loadingPromise: Promise<void> | null = null;

const MODEL_NAME = "Xenova/all-MiniLM-L6-v2";

/** Lazy-load the embedding pipeline */
async function ensureLoaded(): Promise<void> {
  if (pipeline) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    try {
      const { pipeline: createPipeline } = await import("@huggingface/transformers");
      pipeline = await createPipeline("feature-extraction", MODEL_NAME, {
        // Use quantized model for faster loading
        dtype: "fp32",
      });
      console.log(`[embeddings] Loaded embedding model: ${MODEL_NAME}`);
    } catch (err) {
      console.warn(`[embeddings] Failed to load embedding model:`, err);
      pipeline = null;
      throw err;
    } finally {
      loadingPromise = null;
    }
  })();

  return loadingPromise;
}

/**
 * Generate an embedding vector for the given text.
 * Returns a Float32Array of 384 dimensions, or null if the model isn't available.
 */
export async function embed(text: string): Promise<Float32Array | null> {
  try {
    await ensureLoaded();
    if (!pipeline) return null;

    const output = await pipeline(text, { pooling: "mean", normalize: true });
    // The output is a Tensor — extract the raw data
    return new Float32Array(output.data);
  } catch {
    return null;
  }
}

/**
 * Generate embeddings for multiple texts in a batch.
 */
export async function embedBatch(texts: string[]): Promise<(Float32Array | null)[]> {
  try {
    await ensureLoaded();
    if (!pipeline) return texts.map(() => null);

    const results: (Float32Array | null)[] = [];
    // Process one at a time to avoid memory issues
    for (const text of texts) {
      const output = await pipeline(text, { pooling: "mean", normalize: true });
      results.push(new Float32Array(output.data));
    }
    return results;
  } catch {
    return texts.map(() => null);
  }
}

/** Check if the embedding model is loaded and ready */
export function isEmbeddingModelReady(): boolean {
  return pipeline !== null;
}

/** Preload the model (call during server startup) */
export async function preloadEmbeddingModel(): Promise<boolean> {
  try {
    await ensureLoaded();
    return pipeline !== null;
  } catch {
    return false;
  }
}

/**
 * Compute cosine similarity between two vectors.
 * Vectors must already be normalized (which they are from our pipeline).
 */
export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length) return 0;
  let dotProduct = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
  }
  return dotProduct;
}

/** Serialize a Float32Array to a Buffer for SQLite BLOB storage */
export function vectorToBlob(vec: Float32Array): Buffer {
  return Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
}

/** Deserialize a Buffer from SQLite BLOB storage to Float32Array */
export function blobToVector(blob: Buffer): Float32Array {
  const arrayBuffer = new ArrayBuffer(blob.length);
  const view = new Uint8Array(arrayBuffer);
  for (let i = 0; i < blob.length; i++) {
    view[i] = blob[i];
  }
  return new Float32Array(arrayBuffer);
}
