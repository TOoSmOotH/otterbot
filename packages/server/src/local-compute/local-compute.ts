import { execFileSync } from "node:child_process";

export interface LocalComputeStatus {
  backend: "cpu" | "nvidia" | "amd";
  tier: "cpu" | "low" | "medium" | "high";
  ready: boolean;
  detected: boolean;
  summary: string;
  warnings: string[];
  gpuName?: string;
  totalVramMb?: number;
  freeVramMb?: number;
}

function detectTier(totalVramMb?: number): LocalComputeStatus["tier"] {
  if (!totalVramMb || totalVramMb <= 0) return "cpu";
  if (totalVramMb < 8 * 1024) return "low";
  if (totalVramMb < 16 * 1024) return "medium";
  return "high";
}

function runCommand(cmd: string, args: string[]): string | null {
  try {
    return execFileSync(cmd, args, { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], timeout: 2000 }).trim();
  } catch {
    return null;
  }
}

function detectNvidia(): LocalComputeStatus | null {
  const output = runCommand("nvidia-smi", [
    "--query-gpu=name,memory.total,memory.free",
    "--format=csv,noheader,nounits",
  ]);
  if (!output) return null;

  const firstLine = output.split("\n").find(Boolean);
  if (!firstLine) return null;

  const [gpuNameRaw, totalRaw, freeRaw] = firstLine.split(",").map((part) => part.trim());
  const totalVramMb = Number.parseInt(totalRaw ?? "", 10);
  const freeVramMb = Number.parseInt(freeRaw ?? "", 10);
  const tier = detectTier(Number.isFinite(totalVramMb) ? totalVramMb : undefined);

  return {
    backend: "nvidia",
    tier,
    ready: true,
    detected: true,
    summary: `${gpuNameRaw || "NVIDIA GPU"} detected${Number.isFinite(totalVramMb) ? ` with ${Math.round(totalVramMb / 1024)} GB VRAM` : ""}.`,
    warnings: [],
    gpuName: gpuNameRaw || undefined,
    totalVramMb: Number.isFinite(totalVramMb) ? totalVramMb : undefined,
    freeVramMb: Number.isFinite(freeVramMb) ? freeVramMb : undefined,
  };
}

function detectAmd(): LocalComputeStatus | null {
  const output = runCommand("rocm-smi", ["--showproductname", "--showmeminfo", "vram"]);
  if (!output) return null;

  const nameMatch = output.match(/Card series:\s*(.+)/i);
  const totalMatch = output.match(/Total Memory \(B\):\s*(\d+)/i);
  const usedMatch = output.match(/Used Memory \(B\):\s*(\d+)/i);
  const totalVramMb = totalMatch ? Math.round(Number.parseInt(totalMatch[1], 10) / (1024 * 1024)) : undefined;
  const usedVramMb = usedMatch ? Math.round(Number.parseInt(usedMatch[1], 10) / (1024 * 1024)) : undefined;
  const freeVramMb = totalVramMb !== undefined && usedVramMb !== undefined ? Math.max(totalVramMb - usedVramMb, 0) : undefined;
  const tier = detectTier(totalVramMb);

  return {
    backend: "amd",
    tier,
    ready: true,
    detected: true,
    summary: `${nameMatch?.[1] ?? "AMD GPU"} detected${totalVramMb ? ` with ${Math.round(totalVramMb / 1024)} GB VRAM` : ""}.`,
    warnings: [],
    gpuName: nameMatch?.[1],
    totalVramMb,
    freeVramMb,
  };
}

function detectFromEnv(): LocalComputeStatus | null {
  const backend = process.env.OTTERBOT_GPU_BACKEND?.trim().toLowerCase();
  const totalVramMb = Number.parseInt(process.env.OTTERBOT_GPU_VRAM_MB ?? "", 10);
  const freeVramMb = Number.parseInt(process.env.OTTERBOT_GPU_FREE_VRAM_MB ?? "", 10);
  const gpuName = process.env.OTTERBOT_GPU_NAME?.trim();

  if (backend !== "nvidia" && backend !== "amd") return null;

  return {
    backend,
    tier: detectTier(Number.isFinite(totalVramMb) ? totalVramMb : undefined),
    ready: true,
    detected: true,
    summary: `${gpuName || backend.toUpperCase()} configured from environment${Number.isFinite(totalVramMb) ? ` with ${Math.round(totalVramMb / 1024)} GB VRAM` : ""}.`,
    warnings: [],
    gpuName: gpuName || undefined,
    totalVramMb: Number.isFinite(totalVramMb) ? totalVramMb : undefined,
    freeVramMb: Number.isFinite(freeVramMb) ? freeVramMb : undefined,
  };
}

export function getLocalComputeStatus(): LocalComputeStatus {
  const fromEnv = detectFromEnv();
  if (fromEnv) return fromEnv;

  const nvidia = detectNvidia();
  if (nvidia) return nvidia;

  const amd = detectAmd();
  if (amd) return amd;

  return {
    backend: "cpu",
    tier: "cpu",
    ready: false,
    detected: false,
    summary: "No GPU passthrough detected. Otterbot will use CPU-safe local providers and procedural fallbacks.",
    warnings: [
      "Local image and 3D workflows may be slow or unavailable without GPU passthrough.",
    ],
  };
}
