import { randomUUID } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getConfig } from "../../auth/auth.js";
import { getLocalComputeStatus } from "../../local-compute/local-compute.js";
import type { ImageGenOptions, ImageGenProvider, ImageGenResult } from "./types.js";

const DEFAULT_COMFYUI_URL = process.env.OTTERBOT_COMFYUI_URL ?? "http://comfyui:8188";
const WORKSPACE_ROOT = process.env.WORKSPACE_ROOT ?? "./data";
const COMFY_MODELS_FILE = resolve(WORKSPACE_ROOT, "config", "comfyui-models.json");
const COMFY_MODEL_ROOT = resolve(WORKSPACE_ROOT, "comfyui", "models");

type ComfyPresetTask = NonNullable<ImageGenOptions["taskType"]>;
type ManagedModelStatus = "not-installed" | "installing" | "installed" | "error";

export interface ComfyPresetDefinition {
  id: string;
  label: string;
  description: string;
  taskType: ComfyPresetTask;
  workflowId: string;
  recommendedTiers: Array<"cpu" | "low" | "medium" | "high">;
  defaults: {
    sampler: string;
    steps: number;
    cfgScale: number;
    width: number;
    height: number;
  };
}

export interface ManagedComfyModelRecord {
  id: string;
  label: string;
  sourceUrl: string;
  modelType: "checkpoints" | "loras" | "vae" | "upscale_models" | "controlnet";
  filename: string;
  status: ManagedModelStatus;
  installedPath?: string;
  checkpointName?: string;
  error?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ComfyUiHealthStatus {
  configured: boolean;
  reachable: boolean;
  api: "comfyui" | "unknown";
  baseUrl: string;
  message: string;
  checkpoints: string[];
}

const PRESETS: ComfyPresetDefinition[] = [
  {
    id: "sprite-pixel-v1",
    label: "Sprite / Pixel Art",
    description: "Low-resolution sprite art with transparent-friendly framing and tighter sampling defaults.",
    taskType: "sprite",
    workflowId: "basic-txt2img-v1",
    recommendedTiers: ["low", "medium", "high"],
    defaults: { sampler: "euler", steps: 22, cfgScale: 7, width: 512, height: 512 },
  },
  {
    id: "texture-tile-v1",
    label: "Texture / Tile",
    description: "Square texture generation for terrain, materials, UI fills, and seamless-style prompts.",
    taskType: "texture",
    workflowId: "basic-txt2img-v1",
    recommendedTiers: ["low", "medium", "high"],
    defaults: { sampler: "dpmpp_2m", steps: 26, cfgScale: 6.5, width: 768, height: 768 },
  },
  {
    id: "icon-flat-v1",
    label: "Icon / Logo",
    description: "Clean iconography and logo work with moderate CFG and compact dimensions.",
    taskType: "icon",
    workflowId: "basic-txt2img-v1",
    recommendedTiers: ["low", "medium", "high"],
    defaults: { sampler: "euler", steps: 20, cfgScale: 6, width: 512, height: 512 },
  },
  {
    id: "hero-concept-v1",
    label: "Hero / Concept Art",
    description: "Larger composition-oriented preset for banners, scenes, and concept art.",
    taskType: "hero",
    workflowId: "basic-txt2img-v1",
    recommendedTiers: ["medium", "high"],
    defaults: { sampler: "dpmpp_2m", steps: 30, cfgScale: 7, width: 1024, height: 576 },
  },
  {
    id: "general-image-v1",
    label: "General Image",
    description: "Safe default preset for local image generation when no task-specific preset is selected.",
    taskType: "image",
    workflowId: "basic-txt2img-v1",
    recommendedTiers: ["low", "medium", "high"],
    defaults: { sampler: "euler", steps: 24, cfgScale: 7, width: 768, height: 768 },
  },
];

function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function readManagedModels(): ManagedComfyModelRecord[] {
  if (!existsSync(COMFY_MODELS_FILE)) return [];
  try {
    const raw = readFileSync(COMFY_MODELS_FILE, "utf-8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as ManagedComfyModelRecord[] : [];
  } catch {
    return [];
  }
}

function writeManagedModels(models: ManagedComfyModelRecord[]): void {
  ensureParentDir(COMFY_MODELS_FILE);
  writeFileSync(COMFY_MODELS_FILE, JSON.stringify(models, null, 2) + "\n", "utf-8");
}

function sanitizeFilename(sourceUrl: string, filename?: string): string {
  if (filename && filename.trim()) return filename.trim();
  try {
    const url = new URL(sourceUrl);
    const last = url.pathname.split("/").filter(Boolean).pop();
    if (last) return decodeURIComponent(last);
  } catch {
    // ignore
  }
  return `model-${randomUUID()}.safetensors`;
}

function normalizeCheckpointName(record: ManagedComfyModelRecord): string | undefined {
  if (record.modelType !== "checkpoints") return undefined;
  return record.checkpointName ?? record.filename;
}

function resolveModelPath(record: ManagedComfyModelRecord): string {
  return resolve(COMFY_MODEL_ROOT, record.modelType, record.filename);
}

function getDefaultBaseUrl(): string {
  return getConfig("asset:comfyui-local:base_url") ?? DEFAULT_COMFYUI_URL;
}

function roundSize(value: number | undefined, fallback: number): number {
  const raw = Math.max(64, Math.min(1536, value ?? fallback));
  return Math.round(raw / 64) * 64;
}

function clamp(value: number | undefined, min: number, max: number, fallback: number): number {
  if (typeof value !== "number" || Number.isNaN(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

function chooseTaskType(options?: ImageGenOptions): ComfyPresetTask {
  return options?.taskType ?? "image";
}

export function listComfyPresets(): ComfyPresetDefinition[] {
  const tier = getLocalComputeStatus().tier;
  return PRESETS.map((preset) => ({
    ...preset,
    description: preset.recommendedTiers.includes(tier)
      ? preset.description
      : `${preset.description} Best on ${preset.recommendedTiers.join(", ")} compute tiers.`,
  }));
}

export function chooseComfyPreset(options?: ImageGenOptions): ComfyPresetDefinition {
  const explicit = options?.presetId ? PRESETS.find((preset) => preset.id === options.presetId) : null;
  if (explicit) return explicit;

  const taskType = chooseTaskType(options);
  return PRESETS.find((preset) => preset.taskType === taskType)
    ?? PRESETS.find((preset) => preset.taskType === "image")
    ?? PRESETS[0];
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) {
    throw new Error(`Request failed (${res.status}) for ${url}`);
  }
  return await res.json() as T;
}

async function fetchBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request failed (${res.status}) for ${url}`);
  }
  return Buffer.from(await res.arrayBuffer());
}

async function downloadToFile(url: string, destination: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Request failed (${res.status}) for ${url}`);
  }
  if (!res.body) {
    throw new Error(`Download response had no body for ${url}`);
  }
  await pipeline(Readable.fromWeb(res.body as globalThis.ReadableStream<Uint8Array>), createWriteStream(destination));
}

async function getCheckpointNames(baseUrl: string): Promise<string[]> {
  try {
    const json = await fetchJson<Record<string, {
      input?: { required?: { ckpt_name?: [string[]] } };
    }>>(`${baseUrl}/object_info/CheckpointLoaderSimple`);
    const names = json?.CheckpointLoaderSimple?.input?.required?.ckpt_name?.[0];
    return Array.isArray(names) ? names.filter((name) => typeof name === "string") : [];
  } catch {
    return [];
  }
}

export async function getComfyUiHealthStatus(baseUrl = getDefaultBaseUrl()): Promise<ComfyUiHealthStatus> {
  const cleanUrl = baseUrl.replace(/\/$/, "");
  try {
    await fetchJson(`${cleanUrl}/system_stats`);
    const checkpoints = await getCheckpointNames(cleanUrl);
    return {
      configured: true,
      reachable: true,
      api: "comfyui",
      baseUrl: cleanUrl,
      checkpoints,
      message: checkpoints.length > 0
        ? `ComfyUI sidecar reachable at ${cleanUrl} with ${checkpoints.length} checkpoint${checkpoints.length === 1 ? "" : "s"} available.`
        : `ComfyUI sidecar reachable at ${cleanUrl}, but no checkpoints were detected.`,
    };
  } catch {
    return {
      configured: !!baseUrl,
      reachable: false,
      api: "unknown",
      baseUrl: cleanUrl,
      checkpoints: [],
      message: `Configured ComfyUI sidecar at ${cleanUrl}, but it is not reachable.`,
    };
  }
}

export function listManagedComfyModels(): ManagedComfyModelRecord[] {
  return readManagedModels().map((record) => ({
    ...record,
    installedPath: record.installedPath ?? (record.status === "installed" ? resolveModelPath(record) : undefined),
    checkpointName: normalizeCheckpointName(record),
  }));
}

export function addManagedComfyModel(input: {
  label: string;
  sourceUrl: string;
  modelType: ManagedComfyModelRecord["modelType"];
  filename?: string;
}): ManagedComfyModelRecord {
  const now = new Date().toISOString();
  const record: ManagedComfyModelRecord = {
    id: randomUUID(),
    label: input.label.trim(),
    sourceUrl: input.sourceUrl.trim(),
    modelType: input.modelType,
    filename: sanitizeFilename(input.sourceUrl, input.filename),
    status: "not-installed",
    createdAt: now,
    updatedAt: now,
  };
  const records = readManagedModels();
  records.push(record);
  writeManagedModels(records);
  return record;
}

export function removeManagedComfyModel(id: string): boolean {
  const records = readManagedModels();
  const next = records.filter((record) => record.id !== id);
  if (next.length === records.length) return false;
  writeManagedModels(next);
  return true;
}

export async function installManagedComfyModel(id: string): Promise<ManagedComfyModelRecord> {
  const records = readManagedModels();
  const index = records.findIndex((record) => record.id === id);
  if (index === -1) throw new Error(`Managed ComfyUI model not found: ${id}`);

  const current = records[index];
  const targetPath = resolveModelPath(current);
  const tempPath = `${targetPath}.download`;
  const next: ManagedComfyModelRecord = {
    ...current,
    status: "installing",
    error: undefined,
    updatedAt: new Date().toISOString(),
  };
  records[index] = next;
  writeManagedModels(records);

  try {
    ensureParentDir(targetPath);
    await downloadToFile(current.sourceUrl, tempPath);
    renameSync(tempPath, targetPath);
    const installed: ManagedComfyModelRecord = {
      ...next,
      status: "installed",
      installedPath: targetPath,
      checkpointName: normalizeCheckpointName(next),
      updatedAt: new Date().toISOString(),
    };
    records[index] = installed;
    writeManagedModels(records);
    return installed;
  } catch (error) {
    try {
      unlinkSync(tempPath);
    } catch {
      // ignore
    }
    const failed: ManagedComfyModelRecord = {
      ...next,
      status: "error",
      error: error instanceof Error ? error.message : String(error),
      updatedAt: new Date().toISOString(),
    };
    records[index] = failed;
    writeManagedModels(records);
    return failed;
  }
}

function buildPromptText(prompt: string, options: ImageGenOptions | undefined, preset: ComfyPresetDefinition): string {
  const style = options?.style?.trim();
  const prefix = preset.taskType === "sprite"
    ? "game asset, isolated subject, centered composition"
    : preset.taskType === "texture"
      ? "tileable texture, material detail"
      : preset.taskType === "icon"
        ? "clean graphic icon, simple background"
        : "high quality digital artwork";
  return [prefix, style ? `style: ${style}` : "", prompt].filter(Boolean).join(", ");
}

function buildWorkflow(prompt: string, options: ImageGenOptions | undefined, checkpoint: string, preset: ComfyPresetDefinition) {
  const width = roundSize(options?.width, preset.defaults.width);
  const height = roundSize(options?.height, preset.defaults.height);
  const steps = clamp(options?.steps, 8, 60, preset.defaults.steps);
  const cfgScale = clamp(options?.cfgScale, 1, 20, preset.defaults.cfgScale);
  const sampler = options?.sampler?.trim() || preset.defaults.sampler;

  return {
    "3": {
      class_type: "KSampler",
      inputs: {
        seed: Math.floor(Math.random() * 9_999_999_999),
        steps,
        cfg: cfgScale,
        sampler_name: sampler,
        scheduler: "normal",
        denoise: 1,
        model: ["4", 0],
        positive: ["6", 0],
        negative: ["7", 0],
        latent_image: ["5", 0],
      },
    },
    "4": {
      class_type: "CheckpointLoaderSimple",
      inputs: {
        ckpt_name: checkpoint,
      },
    },
    "5": {
      class_type: "EmptyLatentImage",
      inputs: {
        width,
        height,
        batch_size: 1,
      },
    },
    "6": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: buildPromptText(prompt, options, preset),
        clip: ["4", 1],
      },
    },
    "7": {
      class_type: "CLIPTextEncode",
      inputs: {
        text: "blurry, low quality, watermark, text, deformed anatomy",
        clip: ["4", 1],
      },
    },
    "8": {
      class_type: "VAEDecode",
      inputs: {
        samples: ["3", 0],
        vae: ["4", 2],
      },
    },
    "9": {
      class_type: "SaveImage",
      inputs: {
        filename_prefix: `otterbot/${preset.id}`,
        images: ["8", 0],
      },
    },
  };
}

async function waitForImage(baseUrl: string, promptId: string): Promise<{ filename: string; subfolder?: string; type?: string }> {
  const started = Date.now();
  while (Date.now() - started < 120_000) {
    const history = await fetchJson<Record<string, {
      outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }>;
      status?: { status_str?: string };
    }>>(`${baseUrl}/history/${promptId}`);
    const entry = history[promptId];
    const images = entry?.outputs
      ? Object.values(entry.outputs).flatMap((output) => output.images ?? [])
      : [];
    if (images.length > 0) return images[0];
    if (entry?.status?.status_str === "error") {
      throw new Error("ComfyUI generation failed");
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 1500));
  }
  throw new Error("Timed out waiting for ComfyUI output");
}

export class ComfyUIImageProvider implements ImageGenProvider {
  type = "comfyui-local" as const;

  constructor(
    private readonly baseUrl: string = getDefaultBaseUrl(),
    private readonly defaultCheckpoint?: string,
  ) {}

  async generate(prompt: string, options?: ImageGenOptions): Promise<ImageGenResult> {
    const cleanUrl = this.baseUrl.replace(/\/$/, "");
    const health = await getComfyUiHealthStatus(cleanUrl);
    if (!health.reachable) {
      throw new Error(health.message);
    }

    const preset = chooseComfyPreset(options);
    const checkpoint = options?.checkpoint
      ?? this.defaultCheckpoint
      ?? health.checkpoints[0]
      ?? listManagedComfyModels().find((record) => record.status === "installed" && record.modelType === "checkpoints")?.checkpointName;

    if (!checkpoint) {
      throw new Error("ComfyUI is reachable but no checkpoint is installed. Add a managed checkpoint in Asset Generation first.");
    }

    const workflow = buildWorkflow(prompt, options, checkpoint, preset);
    const submit = await fetchJson<{ prompt_id?: string }>(`${cleanUrl}/prompt`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: "otterbot",
        prompt: workflow,
      }),
    });

    if (!submit.prompt_id) {
      throw new Error("ComfyUI did not return a prompt ID");
    }

    const image = await waitForImage(cleanUrl, submit.prompt_id);
    const query = new URLSearchParams({
      filename: image.filename,
      type: image.type ?? "output",
      ...(image.subfolder ? { subfolder: image.subfolder } : {}),
    });
    const data = await fetchBuffer(`${cleanUrl}/view?${query.toString()}`);
    const extension = extname(image.filename).toLowerCase();
    const mimeType = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : "image/png";
    return { data, mimeType, provider: "comfyui-local" };
  }
}
