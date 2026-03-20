import { useEffect, useState } from "react";

interface AssetProviderMeta {
  type: string;
  label: string;
  needsApiKey: boolean;
  needsBaseUrl: boolean;
  capabilities: string[];
  local?: boolean;
  recommendedFor?: string[];
  experimental?: boolean;
  notes?: string;
}

interface AssetProviderConfig {
  image: string;
  model: string;
  sound: string;
}

interface LocalComputeStatus {
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

interface ProviderHealthStatus {
  type: string;
  ready: boolean;
  status: "ready" | "needs-config" | "offline" | "fallback";
  message: string;
}

interface Recommendations {
  image: string;
  model: string;
  sound: string;
  summary: string;
}

interface ComfyPreset {
  id: string;
  label: string;
  description: string;
  taskType: "texture" | "sprite" | "icon" | "hero" | "image";
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

interface ManagedComfyModel {
  id: string;
  label: string;
  sourceUrl: string;
  modelType: "checkpoints" | "loras" | "vae" | "upscale_models" | "controlnet";
  filename: string;
  status: "not-installed" | "installing" | "installed" | "error";
  installedPath?: string;
  checkpointName?: string;
  starterPackId?: string;
  error?: string;
}

type ManagedComfyModelType = ManagedComfyModel["modelType"];

interface ComfyUiHealth {
  configured: boolean;
  reachable: boolean;
  api: "comfyui" | "unknown";
  baseUrl: string;
  message: string;
  checkpoints: string[];
  gpuName?: string;
  totalVramMb?: number;
  freeVramMb?: number;
  tier?: "cpu" | "low" | "medium" | "high";
}

interface ComfyStarterPack {
  id: string;
  label: string;
  description: string;
  recommendedTiers: Array<"cpu" | "low" | "medium" | "high">;
  estimatedSizeGb: number;
  presetIds: string[];
}

interface ComfyUiSummary {
  baseUrl: string;
  sidecarUrl: string;
  health: ComfyUiHealth;
  presets: ComfyPreset[];
  starterPacks: ComfyStarterPack[];
  models: ManagedComfyModel[];
}

interface AssetProviderResponse {
  providers?: AssetProviderMeta[];
  config?: AssetProviderConfig;
  credentialStatus?: Record<string, unknown>;
  healthStatus?: Record<string, ProviderHealthStatus>;
  recommendations?: Recommendations;
  localCompute?: LocalComputeStatus;
  comfyui?: ComfyUiSummary;
}

type AssetCategory = "image" | "model" | "sound";

const CATEGORY_LABELS: Record<AssetCategory, string> = {
  image: "Image & Texture",
  model: "3D Model",
  sound: "Sound & Music",
};

const CATEGORY_DESCRIPTIONS: Record<AssetCategory, string> = {
  image: "Used by all studios for textures, sprites, and image assets.",
  model: "Used by Game Studio for GLB 3D model output.",
  sound: "Used by Game and Video Studios for music and sound effects.",
};

const STATUS_STYLES: Record<ProviderHealthStatus["status"], string> = {
  ready: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  "needs-config": "bg-amber-500/10 text-amber-300 border-amber-500/20",
  offline: "bg-red-500/10 text-red-300 border-red-500/20",
  fallback: "bg-blue-500/10 text-blue-300 border-blue-500/20",
};

export function AssetGenTab() {
  const [providers, setProviders] = useState<AssetProviderMeta[]>([]);
  const [config, setConfig] = useState<AssetProviderConfig>({ image: "procedural", model: "procedural", sound: "procedural" });
  const [localCompute, setLocalCompute] = useState<LocalComputeStatus | null>(null);
  const [recommendations, setRecommendations] = useState<Recommendations | null>(null);
  const [healthStatus, setHealthStatus] = useState<Record<string, ProviderHealthStatus>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [credentialInputs, setCredentialInputs] = useState<Record<string, { apiKey: string; baseUrl: string }>>({});
  const [credentialStatus, setCredentialStatus] = useState<Record<string, "saved" | "error" | null>>({});
  const [comfyui, setComfyui] = useState<ComfyUiSummary | null>(null);
  const [modelForm, setModelForm] = useState<{
    label: string;
    sourceUrl: string;
    modelType: ManagedComfyModelType;
    filename: string;
  }>({ label: "", sourceUrl: "", modelType: "checkpoints", filename: "" });
  const [installingModelId, setInstallingModelId] = useState<string | null>(null);
  const [installingPackId, setInstallingPackId] = useState<string | null>(null);
  const [addingModel, setAddingModel] = useState(false);

  useEffect(() => {
    fetch("/api/settings/asset-providers")
      .then((r) => r.json())
      .then((data: AssetProviderResponse) => {
        setProviders(data.providers ?? []);
        setConfig(data.config ?? { image: "procedural", model: "procedural", sound: "procedural" });
        setLocalCompute(data.localCompute ?? null);
        setRecommendations(data.recommendations ?? null);
        setHealthStatus(data.healthStatus ?? {});
        setComfyui(data.comfyui ?? null);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const reloadComfyui = async () => {
    const res = await fetch("/api/settings/comfyui");
    const data = await res.json() as ComfyUiSummary;
    setComfyui(data);
  };

  const handleProviderChange = async (category: AssetCategory, providerType: string) => {
    setSaving(true);
    const previous = config;
    const newConfig = { ...config, [category]: providerType };
    setConfig(newConfig);
    try {
      const res = await fetch("/api/settings/asset-providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [category]: providerType }),
      });
      const data = await res.json() as { config?: AssetProviderConfig };
      if (data.config) setConfig(data.config);
    } catch {
      setConfig(previous);
    }
    setSaving(false);
  };

  const handleSaveCredentials = async (providerType: string) => {
    const input = credentialInputs[providerType];
    if (!input) return;

    try {
      const res = await fetch("/api/settings/asset-providers/credentials", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          providerType,
          ...(input.apiKey && { apiKey: input.apiKey }),
          ...(input.baseUrl && { baseUrl: input.baseUrl }),
        }),
      });
      setCredentialStatus((s) => ({ ...s, [providerType]: res.ok ? "saved" : "error" }));
      if (providerType === "comfyui-local" && res.ok) {
        await reloadComfyui();
      }
      setTimeout(() => setCredentialStatus((s) => ({ ...s, [providerType]: null })), 3000);
    } catch {
      setCredentialStatus((s) => ({ ...s, [providerType]: "error" }));
    }
  };

  const handleAddModel = async () => {
    if (!modelForm.label.trim() || !modelForm.sourceUrl.trim()) return;
    setAddingModel(true);
    try {
      await fetch("/api/settings/comfyui/models", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          label: modelForm.label.trim(),
          sourceUrl: modelForm.sourceUrl.trim(),
          modelType: modelForm.modelType,
          ...(modelForm.filename.trim() ? { filename: modelForm.filename.trim() } : {}),
        }),
      });
      setModelForm({ label: "", sourceUrl: "", modelType: "checkpoints", filename: "" });
      await reloadComfyui();
    } finally {
      setAddingModel(false);
    }
  };

  const handleInstallModel = async (id: string) => {
    setInstallingModelId(id);
    try {
      await fetch(`/api/settings/comfyui/models/${id}/install`, { method: "POST" });
      await reloadComfyui();
    } finally {
      setInstallingModelId(null);
    }
  };

  const handleInstallPack = async (id: string) => {
    setInstallingPackId(id);
    try {
      await fetch(`/api/settings/comfyui/packs/${id}/install`, { method: "POST" });
      await reloadComfyui();
    } finally {
      setInstallingPackId(null);
    }
  };

  const getProvidersForCategory = (category: AssetCategory): AssetProviderMeta[] => {
    const categoryKey = category === "model" ? "model-3d" : category;
    return providers
      .filter((provider) => provider.capabilities.includes(categoryKey))
      .sort((a, b) => {
        const aRecommended = recommendations?.[category] === a.type ? -2 : 0;
        const bRecommended = recommendations?.[category] === b.type ? -2 : 0;
        const aLocal = a.local ? -1 : 0;
        const bLocal = b.local ? -1 : 0;
        return (aRecommended + aLocal) - (bRecommended + bLocal);
      });
  };

  if (loading) {
    return (
      <div className="p-6 text-sm text-zinc-500">Loading asset provider settings...</div>
    );
  }

  const activeProviders = new Set([config.image, config.model, config.sound]);
  const needsCredentials = providers.filter(
    (provider) => activeProviders.has(provider.type) && (provider.needsApiKey || provider.needsBaseUrl) && provider.type !== "procedural",
  );

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-zinc-200">Asset Generation</h2>
        <p className="text-sm text-zinc-400 mt-1">
          Local-first media generation for games, videos, and apps. Otterbot works without paid providers and can
          use GPU passthrough when available.
        </p>
      </div>

      {localCompute && (
        <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/50 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-zinc-100">Local Compute</h3>
              <p className="mt-1 text-xs text-zinc-400">{localCompute.summary}</p>
            </div>
            <span className="text-[11px] rounded-full border border-zinc-700 px-2.5 py-1 text-zinc-300 uppercase tracking-wide">
              {localCompute.backend} / {localCompute.tier}
            </span>
          </div>

          {(localCompute.gpuName || localCompute.totalVramMb || localCompute.freeVramMb) && (
            <div className="grid gap-2 md:grid-cols-3 text-xs text-zinc-400">
              <div className="rounded-lg bg-zinc-950/70 p-3">
                <div className="text-zinc-500">GPU</div>
                <div className="mt-1 text-zinc-200">{localCompute.gpuName ?? "Not detected"}</div>
              </div>
              <div className="rounded-lg bg-zinc-950/70 p-3">
                <div className="text-zinc-500">Total VRAM</div>
                <div className="mt-1 text-zinc-200">{localCompute.totalVramMb ? `${Math.round(localCompute.totalVramMb / 1024)} GB` : "Unknown"}</div>
              </div>
              <div className="rounded-lg bg-zinc-950/70 p-3">
                <div className="text-zinc-500">Free VRAM</div>
                <div className="mt-1 text-zinc-200">{localCompute.freeVramMb ? `${Math.round(localCompute.freeVramMb / 1024)} GB` : "Unknown"}</div>
              </div>
            </div>
          )}

          {localCompute.warnings.length > 0 && (
            <div className="space-y-1 text-xs text-amber-300">
              {localCompute.warnings.map((warning) => (
                <p key={warning}>{warning}</p>
              ))}
            </div>
          )}

          <div className="rounded-lg border border-blue-500/20 bg-blue-500/10 p-3 text-xs text-blue-200">
            <p className="font-medium">GPU passthrough is optional.</p>
            <p className="mt-1">
              Use NVIDIA Container Toolkit for NVIDIA hosts, or Linux device passthrough for AMD/ROCm hosts.
              CPU-only remains supported through procedural generation and slower local endpoints.
            </p>
          </div>
        </div>
      )}

      {comfyui && (
        <div className="rounded-xl border border-blue-500/20 bg-blue-500/10 p-4 space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-medium text-blue-100">ComfyUI Sidecar</h3>
              <p className="mt-1 text-xs text-blue-100/80">
                Otterbot now treats ComfyUI as a managed sidecar. The recommended Docker URL is <code className="text-blue-50">{comfyui.sidecarUrl}</code>.
              </p>
            </div>
            <span className={`text-[11px] rounded-full border px-2.5 py-1 uppercase tracking-wide ${
              comfyui.health.reachable ? "border-emerald-500/30 text-emerald-200" : "border-amber-500/30 text-amber-200"
            }`}>
              {comfyui.health.reachable ? "Reachable" : "Unavailable"}
            </span>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <div className="rounded-lg bg-zinc-950/60 p-3 text-xs text-zinc-300 space-y-2">
              <p className="text-zinc-100 font-medium">Runtime Health</p>
              <p>{comfyui.health.message}</p>
              <p>Configured endpoint: <code>{comfyui.baseUrl}</code></p>
              <p>Detected checkpoints: {comfyui.health.checkpoints.length > 0 ? comfyui.health.checkpoints.join(", ") : "none"}</p>
              {(comfyui.health.gpuName || comfyui.health.totalVramMb || comfyui.health.freeVramMb) && (
                <p>
                  Sidecar compute: {comfyui.health.gpuName ?? "GPU"} · {comfyui.health.totalVramMb ? `${Math.round(comfyui.health.totalVramMb / 1024)} GB VRAM` : "VRAM unknown"}
                  {comfyui.health.freeVramMb ? ` · ${Math.round(comfyui.health.freeVramMb / 1024)} GB free` : ""}
                </p>
              )}
              {comfyui.health.tier && <p>Recommended tier: <span className="uppercase">{comfyui.health.tier}</span></p>}
              <p>Sidecar startup: <code>docker compose -f docker-compose.prod.yml -f docker-compose.comfyui.yml up -d</code></p>
            </div>
            <div className="rounded-lg bg-zinc-950/60 p-3 text-xs text-zinc-300 space-y-2">
              <p className="text-zinc-100 font-medium">Preset Catalog</p>
              <div className="grid gap-2">
                {comfyui.presets.map((preset) => (
                  <div key={preset.id} className="rounded border border-zinc-800 bg-zinc-900/70 p-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-zinc-100">{preset.label}</span>
                      <span className="text-[10px] uppercase text-zinc-500">{preset.taskType}</span>
                    </div>
                    <p className="mt-1 text-zinc-400">{preset.description}</p>
                    <p className="mt-1 text-zinc-500">
                      {preset.defaults.width}x{preset.defaults.height} • {preset.defaults.sampler} • {preset.defaults.steps} steps
                    </p>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="rounded-lg border border-zinc-700/60 bg-zinc-950/60 p-4 space-y-3">
            <div>
              <h4 className="text-sm font-medium text-zinc-100">Starter Packs</h4>
              <p className="mt-1 text-xs text-zinc-400">
                Start here. Otterbot installs a recommended local image pack instead of asking you to think about checkpoints first.
              </p>
            </div>
            <div className="grid gap-3 lg:grid-cols-2">
              {comfyui.starterPacks.map((pack) => {
                const recommended = !comfyui.health.tier || pack.recommendedTiers.includes(comfyui.health.tier);
                const installedModels = comfyui.models.filter((model) => model.starterPackId === pack.id && model.status === "installed");
                const isInstalled = installedModels.length > 0;
                return (
                  <div key={pack.id} className="rounded border border-zinc-800 bg-zinc-900/70 p-3 text-xs text-zinc-300">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-zinc-100">{pack.label}</p>
                        <p className="mt-1 text-zinc-500">{pack.description}</p>
                      </div>
                      {recommended && (
                        <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-300 uppercase">
                          Recommended
                        </span>
                      )}
                    </div>
                    <p className="mt-2 text-zinc-500">
                      Approx. {pack.estimatedSizeGb.toFixed(1)} GB · Presets: {pack.presetIds.join(", ")}
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <button
                        onClick={() => handleInstallPack(pack.id)}
                        disabled={installingPackId === pack.id}
                        className="text-xs px-3 py-1 rounded bg-blue-600 text-blue-50 hover:bg-blue-500 transition-colors disabled:opacity-60"
                      >
                        {installingPackId === pack.id ? "Installing..." : isInstalled ? "Reinstall Pack" : "Install Pack"}
                      </button>
                      {isInstalled && <span className="text-emerald-300">Installed</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="rounded-lg border border-zinc-700/60 bg-zinc-950/60 p-4 space-y-3">
            <div>
              <h4 className="text-sm font-medium text-zinc-100">Advanced Models</h4>
              <p className="mt-1 text-xs text-zinc-400">
                Advanced: add checkpoints, LoRAs, VAEs, or ControlNet weights by URL. Most users should start with a Starter Pack instead.
              </p>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <input
                type="text"
                placeholder="Model label"
                value={modelForm.label}
                onChange={(e) => setModelForm((state) => ({ ...state, label: e.target.value }))}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
              <select
                value={modelForm.modelType}
                onChange={(e) => setModelForm((state) => ({ ...state, modelType: e.target.value as ManagedComfyModelType }))}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
              >
                <option value="checkpoints">Checkpoint</option>
                <option value="loras">LoRA</option>
                <option value="vae">VAE</option>
                <option value="upscale_models">Upscaler</option>
                <option value="controlnet">ControlNet</option>
              </select>
              <input
                type="text"
                placeholder="https://example.com/model.safetensors"
                value={modelForm.sourceUrl}
                onChange={(e) => setModelForm((state) => ({ ...state, sourceUrl: e.target.value }))}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 md:col-span-2"
              />
              <input
                type="text"
                placeholder="Optional filename override"
                value={modelForm.filename}
                onChange={(e) => setModelForm((state) => ({ ...state, filename: e.target.value }))}
                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500 md:col-span-2"
              />
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleAddModel}
                disabled={addingModel}
                className="text-xs px-3 py-1 rounded bg-blue-600 text-blue-50 hover:bg-blue-500 transition-colors disabled:opacity-60"
              >
                {addingModel ? "Adding..." : "Add Model"}
              </button>
              <button
                onClick={reloadComfyui}
                className="text-xs px-3 py-1 rounded bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition-colors"
              >
                Refresh
              </button>
            </div>
            <div className="space-y-2">
              {comfyui.models.length === 0 && (
                <p className="text-xs text-zinc-500">No managed models have been added yet.</p>
              )}
              {comfyui.models.map((model) => (
                <div key={model.id} className="rounded border border-zinc-800 bg-zinc-900/70 p-3 text-xs text-zinc-300">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-zinc-100">{model.label}</p>
                      <p className="text-zinc-500">{model.modelType} • {model.filename}</p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] uppercase ${
                      model.status === "installed"
                        ? "bg-emerald-500/10 text-emerald-300"
                        : model.status === "error"
                          ? "bg-red-500/10 text-red-300"
                          : "bg-zinc-800 text-zinc-400"
                    }`}>
                      {model.status}
                    </span>
                  </div>
                  <p className="mt-2 break-all text-zinc-500">{model.sourceUrl}</p>
                  {model.error && <p className="mt-2 text-red-300">{model.error}</p>}
                  <div className="mt-3 flex items-center gap-2">
                    <button
                      onClick={() => handleInstallModel(model.id)}
                      disabled={installingModelId === model.id}
                      className="text-xs px-3 py-1 rounded bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition-colors disabled:opacity-60"
                    >
                      {installingModelId === model.id ? "Installing..." : model.status === "installed" ? "Reinstall" : "Install"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {recommendations && (
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-4">
          <h3 className="text-sm font-medium text-emerald-200">Recommended Local Stack</h3>
          <p className="mt-1 text-xs text-emerald-100/90">{recommendations.summary}</p>
          <div className="mt-3 grid gap-2 md:grid-cols-3 text-xs">
            <RecommendationCard label="Images" value={recommendations.image} />
            <RecommendationCard label="3D" value={recommendations.model} />
            <RecommendationCard label="Audio" value={recommendations.sound} />
          </div>
        </div>
      )}

      {(["image", "model", "sound"] as AssetCategory[]).map((category) => {
        const available = getProvidersForCategory(category);
        return (
          <div key={category} className="space-y-3">
            <div>
              <h3 className="text-sm font-medium text-zinc-300">{CATEGORY_LABELS[category]}</h3>
              <p className="text-xs text-zinc-500">{CATEGORY_DESCRIPTIONS[category]}</p>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {available.map((provider) => {
                const isSelected = config[category] === provider.type;
                const health = healthStatus[provider.type];
                const isRecommended = recommendations?.[category] === provider.type;
                return (
                  <button
                    key={provider.type}
                    onClick={() => handleProviderChange(category, provider.type)}
                    disabled={saving}
                    className={`rounded-xl border p-4 text-left transition-colors ${
                      isSelected
                        ? "bg-zinc-800 border-zinc-500 text-zinc-100"
                        : "bg-zinc-900/60 border-zinc-700/60 text-zinc-300 hover:border-zinc-600"
                    }`}
                  >
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-medium">{provider.label}</span>
                      {provider.local && (
                        <span className="text-[10px] rounded-full border border-blue-500/20 bg-blue-500/10 px-2 py-0.5 text-blue-300">
                          Local
                        </span>
                      )}
                      {provider.experimental && (
                        <span className="text-[10px] rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-amber-300">
                          Experimental
                        </span>
                      )}
                      {isRecommended && (
                        <span className="text-[10px] rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-0.5 text-emerald-300">
                          Recommended
                        </span>
                      )}
                    </div>
                    {provider.notes && (
                      <p className="mt-2 text-xs text-zinc-400">{provider.notes}</p>
                    )}
                    {health && (
                      <div className={`mt-3 inline-flex rounded-full border px-2.5 py-1 text-[10px] ${STATUS_STYLES[health.status]}`}>
                        {health.message}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}

      {needsCredentials.length > 0 && (
        <div className="space-y-4 pt-4 border-t border-zinc-700/50">
          <h3 className="text-sm font-medium text-zinc-300">Provider Credentials & Endpoints</h3>
          <p className="text-xs text-zinc-500">
            Local providers use base URLs. Paid providers use API keys. If you already configured a matching LLM provider,
            Otterbot will reuse its credentials when possible.
          </p>

          {needsCredentials.map((provider) => {
            const input = credentialInputs[provider.type] ?? { apiKey: "", baseUrl: "" };
            const status = credentialStatus[provider.type];

            return (
              <div key={provider.type} className="space-y-2 bg-zinc-800/30 rounded-lg p-3">
                <div className="text-sm font-medium text-zinc-300">{provider.label}</div>

                {provider.needsApiKey && (
                  <div>
                    <label className="text-xs text-zinc-500 block mb-1">API Key</label>
                    <input
                      type="password"
                      placeholder="Enter API key..."
                      value={input.apiKey}
                      onChange={(e) =>
                        setCredentialInputs((s) => ({
                          ...s,
                          [provider.type]: { ...input, apiKey: e.target.value },
                        }))
                      }
                      className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                    />
                  </div>
                )}

                {provider.needsBaseUrl && (
                  <div>
                    <label className="text-xs text-zinc-500 block mb-1">Base URL</label>
                    <input
                      type="text"
                      placeholder={provider.type === "trellis-local" ? "http://127.0.0.1:8080" : provider.type === "comfyui-local" ? "http://comfyui:8188" : "http://127.0.0.1:7860"}
                      value={input.baseUrl}
                      onChange={(e) =>
                        setCredentialInputs((s) => ({
                          ...s,
                          [provider.type]: { ...input, baseUrl: e.target.value },
                        }))
                      }
                      className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                    />
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSaveCredentials(provider.type)}
                    className="text-xs px-3 py-1 rounded bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition-colors"
                  >
                    Save
                  </button>
                  {status === "saved" && <span className="text-xs text-emerald-400">Saved</span>}
                  {status === "error" && <span className="text-xs text-red-400">Failed to save</span>}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="text-xs text-zinc-500 space-y-1 pt-4 border-t border-zinc-700/50">
        <p>
          <strong className="text-zinc-400">ComfyUI Sidecar (Local)</strong> — Recommended local image path. Otterbot selects ComfyUI workflows and presets, and can install checkpoints into the shared sidecar volume.
        </p>
        <p>
          <strong className="text-zinc-400">TRELLIS Bridge (Local)</strong> — Experimental local 3D generation through a user-run bridge service. Best on high-VRAM GPUs.
        </p>
        <p>
          <strong className="text-zinc-400">Procedural</strong> — No external service required. This is the safest default for CPU-only setups.
        </p>
        <p>
          <strong className="text-zinc-400">Paid providers</strong> — Optional overrides for higher fidelity or convenience, not prerequisites for using studios.
        </p>
      </div>
    </div>
  );
}

function RecommendationCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-950/60 p-3">
      <div className="text-zinc-500">{label}</div>
      <div className="mt-1 text-zinc-100">{value}</div>
    </div>
  );
}
