import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getConfig } from "../config.js";
import type { Embedder } from "../embedding.js";

/**
 * Built-in, in-process CPU embedder. Runs `all-MiniLM-L6-v2` via fastembed /
 * onnxruntime — no API key, no external server, no Ollama.
 *
 * The ~30 MB model is **never bundled** with otterbot and is **never
 * auto-downloaded**: it is fetched only when the user explicitly calls
 * {@link downloadBuiltinModel} (wired to a "Download model" button). Until then
 * {@link BuiltinEmbedder} behaves like a disabled embedder and memory falls
 * back to FTS5 keyword search.
 */

/** User-facing model id stored in an agent's `embedding` ModelRef. */
export const BUILTIN_MODEL_ID = "all-MiniLM-L6-v2";
/** Embedding dimension of all-MiniLM-L6-v2. */
const BUILTIN_DIM = 384;

function modelsDir(): string {
  return resolve(getConfig().dataDir, "models");
}

/** Marker written after a verified download — our own readiness signal. */
function markerPath(): string {
  return resolve(modelsDir(), ".builtin-MiniLM-ready");
}

/** Whether the built-in model has been downloaded and is ready to use. */
function isBuiltinModelReady(): boolean {
  return existsSync(markerPath());
}

export interface BuiltinModelStatus {
  modelId: string;
  /** Embedding dimension this model produces. */
  dimension: number;
  downloaded: boolean;
  downloading: boolean;
  error: string | null;
}

const state: { downloading: boolean; error: string | null } = {
  downloading: false,
  error: null,
};

export function builtinModelStatus(): BuiltinModelStatus {
  return {
    modelId: BUILTIN_MODEL_ID,
    dimension: BUILTIN_DIM,
    downloaded: isBuiltinModelReady(),
    downloading: state.downloading,
    error: state.error,
  };
}

/** The structural surface of fastembed's `FlagEmbedding` that we use. */
interface FastembedModel {
  queryEmbed(text: string): Promise<number[]>;
}

/** A warm fastembed instance, created lazily and shared process-wide. */
let modelPromise: Promise<FastembedModel> | null = null;

/** Load (or reuse) the fastembed model. Reads from `cacheDir`, downloading if absent. */
function loadModel(showDownloadProgress: boolean): Promise<FastembedModel> {
  if (!modelPromise) {
    modelPromise = (async () => {
      const dir = modelsDir();
      mkdirSync(dir, { recursive: true });
      const { FlagEmbedding, EmbeddingModel, ExecutionProvider } = await import("fastembed");
      return (await FlagEmbedding.init({
        model: EmbeddingModel.AllMiniLML6V2,
        cacheDir: dir,
        executionProviders: [ExecutionProvider.CPU],
        showDownloadProgress,
      })) as unknown as FastembedModel;
    })().catch((err) => {
      modelPromise = null; // allow a retry on the next call
      throw err;
    });
  }
  return modelPromise;
}

/**
 * Download the built-in model. The ONLY code path that hits the network for
 * the model weights. Idempotent; a no-op while a download is already running
 * or once the model is ready.
 */
export async function downloadBuiltinModel(): Promise<void> {
  if (state.downloading || isBuiltinModelReady()) return;
  state.downloading = true;
  state.error = null;
  try {
    const model = await loadModel(true);
    // Verify the model actually produces an embedding before marking it ready.
    const vec = await model.queryEmbed("test");
    if (!Array.isArray(vec) || vec.length === 0) {
      throw new Error("built-in model produced an empty embedding");
    }
    mkdirSync(modelsDir(), { recursive: true });
    writeFileSync(markerPath(), new Date().toISOString());
    console.info("[embedder] built-in model downloaded and ready");
  } catch (err) {
    state.error = err instanceof Error ? err.message : String(err);
    console.warn("[embedder] built-in model download failed:", state.error);
  } finally {
    state.downloading = false;
  }
}

/**
 * In-process embedder using all-MiniLM-L6-v2. Only ever uses an
 * already-downloaded model — it never triggers a download. When the model is
 * not present both methods return `null`, leaving vector search disabled.
 */
export class BuiltinEmbedder implements Embedder {
  async probeDimension(): Promise<number | null> {
    if (!isBuiltinModelReady()) return null;
    try {
      const model = await loadModel(false);
      const vec = await model.queryEmbed("test");
      return Array.isArray(vec) && vec.length > 0 ? vec.length : BUILTIN_DIM;
    } catch (err) {
      console.warn("[embedder] built-in probe failed:", err instanceof Error ? err.message : String(err));
      return null;
    }
  }

  async generate(text: string): Promise<Float32Array | null> {
    if (!isBuiltinModelReady()) return null;
    try {
      const model = await loadModel(false);
      const vec = await model.queryEmbed(text);
      if (!Array.isArray(vec)) return null;
      return new Float32Array(vec);
    } catch (err) {
      console.warn("[embedder] built-in generate failed:", err instanceof Error ? err.message : String(err));
      return null;
    }
  }
}
