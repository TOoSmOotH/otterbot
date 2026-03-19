export type LocalComputeBackend = "cpu" | "nvidia" | "amd";

export type LocalComputeTier = "cpu" | "low" | "medium" | "high";

export interface LocalComputeStatus {
  backend: LocalComputeBackend;
  tier: LocalComputeTier;
  ready: boolean;
  detected: boolean;
  summary: string;
  warnings: string[];
  gpuName?: string;
  totalVramMb?: number;
  freeVramMb?: number;
}
