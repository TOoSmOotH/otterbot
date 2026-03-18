import { useEffect, useState } from "react";
import { useSettingsStore } from "../../stores/settings-store";
import { ModelCombobox } from "./ModelCombobox";
import type { ModelOption } from "../../stores/settings-store";
import type { SettingsSection } from "./settings-nav";
import type { StudioConfigBundle, StudioConfig, StudioType } from "../../../../shared/src/types/studio-config";
import {
  STUDIO_TOOLS,
  STUDIO_TOOL_LABELS,
  STUDIO_TYPE_LABELS,
} from "../../../../shared/src/types/studio-config";

const STUDIO_TYPES: StudioType[] = ["game", "video", "app"];

type Scope = "global" | StudioType;
type AssetCategory = "image" | "model" | "sound";
type AssetProviderType = "openai" | "replicate" | "stable-diffusion" | "procedural";

interface AssetProviderMeta {
  type: AssetProviderType;
  label: string;
  needsApiKey: boolean;
  needsBaseUrl: boolean;
  capabilities: string[];
}

interface AssetProviderCredentialStatus {
  type: AssetProviderType;
  dedicatedApiKeySet: boolean;
  dedicatedBaseUrlSet: boolean;
  providerApiKeySet: boolean;
  providerBaseUrlSet: boolean;
  apiKeyReady: boolean;
  baseUrlReady: boolean;
}

interface AssetProviderResponse {
  providers?: AssetProviderMeta[];
  config?: Record<AssetCategory, AssetProviderType>;
  credentialStatus?: Partial<Record<AssetProviderType, AssetProviderCredentialStatus>>;
}

const ASSET_LABELS: Record<AssetCategory, string> = {
  image: "Images & Textures",
  model: "3D Models",
  sound: "Sound & Music",
};

const ASSET_DESCRIPTIONS: Record<AssetCategory, string> = {
  image: "Sprites, textures, concept art, and image-based game assets.",
  model: "3D model generation for game props and scene assets.",
  sound: "Music, ambience, and generated audio for games and videos.",
};

const PROVIDER_BLURBS: Record<AssetProviderType, string> = {
  openai: "High-quality image and sprite generation through OpenAI image models.",
  replicate: "Hosted media generation across images, 3D, and sound.",
  "stable-diffusion": "Local image generation via a Stable Diffusion-compatible endpoint.",
  procedural: "Built-in fallback with no external credentials required.",
};

function navigateToSettings(section: SettingsSection) {
  window.dispatchEvent(new CustomEvent("navigate-settings", { detail: section }));
}

function getAssetCategories(scope: Scope, studioType?: StudioType): AssetCategory[] {
  if (scope === "global") return ["image", "model", "sound"];
  if (studioType === "game") return ["image", "model", "sound"];
  if (studioType === "video") return ["sound"];
  return [];
}

function getInheritanceMessage(scope: Scope, category: AssetCategory): string {
  if (scope === "global") {
    return `Blank inherits the system ${ASSET_LABELS[category].toLowerCase()} provider from Asset Generation.`;
  }
  return `Blank inherits the global studio default for ${ASSET_LABELS[category].toLowerCase()}, then the system Asset Generation default.`;
}

function formatCredentialStatus(meta: AssetProviderMeta | undefined, status: AssetProviderCredentialStatus | undefined): string {
  if (!meta || !status) return "Readiness unknown.";
  if (meta.type === "procedural") return "Ready. No credentials needed.";

  const parts: string[] = [];

  if (meta.needsApiKey) {
    if (status.apiKeyReady) {
      if (status.dedicatedApiKeySet) {
        parts.push("Asset Generation credentials saved");
      } else if (status.providerApiKeySet) {
        parts.push("reusing credentials from Providers");
      } else {
        parts.push("API key available");
      }
    } else {
      parts.push("needs an API key");
    }
  }

  if (meta.needsBaseUrl) {
    if (status.baseUrlReady) {
      if (status.dedicatedBaseUrlSet) {
        parts.push("endpoint saved in Asset Generation");
      } else if (status.providerBaseUrlSet) {
        parts.push("reusing endpoint from Providers");
      } else {
        parts.push("endpoint available");
      }
    } else {
      parts.push("needs a base URL");
    }
  }

  return parts.length > 0 ? `${parts.join("; ")}.` : "Ready.";
}

function getAssetSourceLabel(
  scope: Scope,
  category: AssetCategory,
  value: string,
  globalConfig: StudioConfig,
  systemAssetConfig: Record<AssetCategory, AssetProviderType>,
): string {
  if (value) return scope === "global" ? "Global studio default set here" : "Studio override set here";
  if (scope === "global") return `Currently inheriting system default: ${systemAssetConfig[category]}`;
  if (globalConfig.asset?.[category]) return `Currently inheriting global studio default: ${globalConfig.asset[category]}`;
  return `Currently inheriting system default: ${systemAssetConfig[category]}`;
}

function getLlmSummary(scope: Scope, config: StudioConfig, globalConfig: StudioConfig): string {
  if (config.llm?.provider || config.llm?.model) {
    return scope === "global"
      ? "Global studio LLM defaults are set here."
      : "This studio has its own LLM override.";
  }
  if (scope === "global") return "Blank inherits the system worker model from Models.";
  if (globalConfig.llm?.provider || globalConfig.llm?.model) return "Blank inherits the global studio LLM default.";
  return "Blank inherits the system worker model from Models.";
}

export function StudioConfigTab() {
  const providers = useSettingsStore((s) => s.providers);
  const models = useSettingsStore((s) => s.models);
  const fetchModels = useSettingsStore((s) => s.fetchModels);

  const [bundle, setBundle] = useState<StudioConfigBundle>({
    global: {},
    game: {},
    video: {},
    app: {},
  });
  const [assetProviders, setAssetProviders] = useState<AssetProviderMeta[]>([]);
  const [systemAssetConfig, setSystemAssetConfig] = useState<Record<AssetCategory, AssetProviderType>>({
    image: "procedural",
    model: "procedural",
    sound: "procedural",
  });
  const [credentialStatus, setCredentialStatus] = useState<Partial<Record<AssetProviderType, AssetProviderCredentialStatus>>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    game: true,
    video: false,
    app: false,
  });

  useEffect(() => {
    Promise.all([
      fetch("/api/settings/studio-config").then((r) => r.json()),
      fetch("/api/settings/asset-providers").then((r) => r.json()),
    ])
      .then(([studioData, assetData]: [StudioConfigBundle, AssetProviderResponse]) => {
        setBundle(studioData);
        setAssetProviders(assetData.providers ?? []);
        setSystemAssetConfig(assetData.config ?? {
          image: "procedural",
          model: "procedural",
          sound: "procedural",
        });
        setCredentialStatus(assetData.credentialStatus ?? {});
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    for (const p of providers) {
      if (p.apiKeySet || p.type === "ollama") {
        fetchModels(p.id);
      }
    }
  }, [providers]);

  const allModels: ModelOption[] = Object.values(models).flat();

  const save = async (scope: Scope, config: StudioConfig) => {
    setSaving(scope);
    try {
      const res = await fetch(`/api/settings/studio-config/${scope}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      if (res.ok) {
        const updated = await res.json();
        setBundle(updated);
      }
    } catch {
      // ignore
    }
    setSaving(null);
  };

  const clearScope = async (scope: Scope) => {
    setSaving(scope);
    try {
      const res = await fetch(`/api/settings/studio-config/${scope}`, { method: "DELETE" });
      if (res.ok) {
        const updated = await res.json();
        setBundle(updated);
      }
    } catch {
      // ignore
    }
    setSaving(null);
  };

  if (loading) {
    return (
      <div className="p-6 text-sm text-zinc-500">Loading studio settings...</div>
    );
  }

  return (
    <div className="p-6 space-y-8">
      <div className="space-y-3">
        <div>
          <h2 className="text-lg font-semibold text-zinc-200">Studios</h2>
          <p className="text-sm text-zinc-400 mt-1">
            Configure how each studio thinks, which tools it can use, and which media providers it reaches for.
          </p>
        </div>

        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          <p className="font-medium">Codex is not a media provider in Otterbot.</p>
          <p className="mt-1 text-amber-100/85">
            Codex only powers coding tasks under Coding Agents. Image generation, 3D model generation,
            music generation, narration, and video rendering are configured separately through Asset
            Generation and Speech.
          </p>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <InfoCard
            title="Studios decide behavior"
            body="Choose the LLM, enable or disable studio tools, and set per-studio media overrides."
          />
          <InfoCard
            title="Asset Generation powers media"
            body="This is where provider credentials and system-wide image, model, and sound defaults live."
            actionLabel="Open Asset Generation"
            onAction={() => navigateToSettings("asset-gen")}
          />
          <InfoCard
            title="Coding Agents power code work"
            body="Codex, OpenCode, Claude Code, and Gemini CLI only affect coding tasks, not media generation."
            actionLabel="Open Coding Agents"
            onAction={() => navigateToSettings("opencode")}
          />
        </div>
      </div>

      <ScopeSection
        scope="global"
        label="Global Studio Defaults"
        description="These defaults apply to all studios unless a specific studio overrides them."
        config={bundle.global}
        globalConfig={bundle.global}
        providers={providers}
        models={allModels}
        saving={saving === "global"}
        onSave={(cfg) => save("global", cfg)}
        onClear={() => clearScope("global")}
        showTools={false}
        assetProviders={assetProviders}
        systemAssetConfig={systemAssetConfig}
        credentialStatus={credentialStatus}
      />

      {STUDIO_TYPES.map((st) => {
        const assetSummary = getAssetCategories(st, st).length > 0
          ? `${getAssetCategories(st, st).length} media override${getAssetCategories(st, st).length === 1 ? "" : "s"} available`
          : "No media-provider overrides in this studio";

        return (
          <div key={st} className="border border-zinc-700/50 rounded-lg overflow-hidden">
            <button
              onClick={() => setExpanded((prev) => ({ ...prev, [st]: !prev[st] }))}
              className="w-full flex items-center justify-between px-4 py-3 bg-zinc-800/30 hover:bg-zinc-800/50 transition-colors text-left"
            >
              <div>
                <h3 className="text-sm font-medium text-zinc-200">{STUDIO_TYPE_LABELS[st]}</h3>
                <p className="text-xs text-zinc-500 mt-0.5">
                  {assetSummary}. Blank fields inherit global studio defaults first.
                </p>
              </div>
              <svg
                className={`w-4 h-4 text-zinc-400 transition-transform ${expanded[st] ? "rotate-180" : ""}`}
                fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {expanded[st] && (
              <div className="px-4 py-4">
                <ScopeSection
                  scope={st}
                  config={bundle[st]}
                  globalConfig={bundle.global}
                  providers={providers}
                  models={allModels}
                  saving={saving === st}
                  onSave={(cfg) => save(st, cfg)}
                  onClear={() => clearScope(st)}
                  showTools={true}
                  studioType={st}
                  assetProviders={assetProviders}
                  systemAssetConfig={systemAssetConfig}
                  credentialStatus={credentialStatus}
                />
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function InfoCard({
  title,
  body,
  actionLabel,
  onAction,
}: {
  title: string;
  body: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="rounded-xl border border-zinc-700/60 bg-zinc-900/50 p-4">
      <h3 className="text-sm font-medium text-zinc-100">{title}</h3>
      <p className="mt-2 text-xs leading-5 text-zinc-400">{body}</p>
      {actionLabel && onAction && (
        <button
          onClick={onAction}
          className="mt-3 text-xs text-blue-300 hover:text-blue-200 transition-colors"
        >
          {actionLabel}
        </button>
      )}
    </div>
  );
}

interface ScopeSectionProps {
  scope: Scope;
  label?: string;
  description?: string;
  config: StudioConfig;
  globalConfig: StudioConfig;
  providers: { id: string; name: string; type: string; apiKeySet?: boolean }[];
  models: ModelOption[];
  saving: boolean;
  onSave: (cfg: StudioConfig) => void;
  onClear: () => void;
  showTools: boolean;
  studioType?: StudioType;
  assetProviders: AssetProviderMeta[];
  systemAssetConfig: Record<AssetCategory, AssetProviderType>;
  credentialStatus: Partial<Record<AssetProviderType, AssetProviderCredentialStatus>>;
}

function ScopeSection({
  scope,
  label,
  description,
  config,
  globalConfig,
  providers,
  models,
  saving,
  onSave,
  onClear,
  showTools,
  studioType,
  assetProviders,
  systemAssetConfig,
  credentialStatus,
}: ScopeSectionProps) {
  const [llmProvider, setLlmProvider] = useState(config.llm?.provider ?? "");
  const [llmModel, setLlmModel] = useState(config.llm?.model ?? "");
  const [disabledTools, setDisabledTools] = useState<Set<string>>(
    new Set(config.tools?.disabled ?? []),
  );
  const [assetImage, setAssetImage] = useState(config.asset?.image ?? "");
  const [assetModel, setAssetModel] = useState(config.asset?.model ?? "");
  const [assetSound, setAssetSound] = useState(config.asset?.sound ?? "");
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    setLlmProvider(config.llm?.provider ?? "");
    setLlmModel(config.llm?.model ?? "");
    setDisabledTools(new Set(config.tools?.disabled ?? []));
    setAssetImage(config.asset?.image ?? "");
    setAssetModel(config.asset?.model ?? "");
    setAssetSound(config.asset?.sound ?? "");
    setDirty(false);
  }, [config]);

  const handleSave = () => {
    const cfg: StudioConfig = {};

    if (llmProvider || llmModel) {
      cfg.llm = {};
      if (llmProvider) cfg.llm.provider = llmProvider;
      if (llmModel) cfg.llm.model = llmModel;
    } else {
      cfg.llm = { provider: "", model: "" };
    }

    if (showTools && studioType) {
      cfg.tools = { disabled: [...disabledTools] };
    }

    const assetCategories = getAssetCategories(scope, studioType);
    if (assetCategories.length > 0) {
      cfg.asset = {
        image: assetCategories.includes("image") ? (assetImage || "") as AssetProviderType : undefined,
        model: assetCategories.includes("model") ? (assetModel || "") as AssetProviderType : undefined,
        sound: assetCategories.includes("sound") ? (assetSound || "") as AssetProviderType : undefined,
      };
    }

    onSave(cfg);
    setDirty(false);
  };

  const toggleTool = (toolName: string) => {
    setDisabledTools((prev) => {
      const next = new Set(prev);
      if (next.has(toolName)) {
        next.delete(toolName);
      } else {
        next.add(toolName);
      }
      return next;
    });
    setDirty(true);
  };

  const tools = studioType ? STUDIO_TOOLS[studioType] : [];
  const assetCategories = getAssetCategories(scope, studioType);
  const assetValues: Record<AssetCategory, string> = {
    image: assetImage,
    model: assetModel,
    sound: assetSound,
  };

  return (
    <div className="space-y-6">
      {label && (
        <div>
          <h3 className="text-sm font-medium text-zinc-300">{label}</h3>
          {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
        </div>
      )}

      <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
        <div>
          <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">LLM Model</h4>
          <p className="mt-1 text-xs text-zinc-500">
            This controls planning, writing, and tool orchestration for the studio. It does not configure image,
            audio, or video generation.
          </p>
          <p className="mt-2 text-xs text-blue-300">{getLlmSummary(scope, config, globalConfig)}</p>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Provider</label>
            <select
              value={llmProvider}
              onChange={(e) => { setLlmProvider(e.target.value); setDirty(true); }}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
            >
              <option value="">{scope === "global" ? "System default" : "Inherit global/system default"}</option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>{p.name} ({p.type})</option>
              ))}
            </select>
          </div>

          <div>
            <label className="text-xs text-zinc-500 block mb-1">Model</label>
            <ModelCombobox
              value={llmModel}
              options={models}
              onChange={(v) => { setLlmModel(v); setDirty(true); }}
              placeholder={scope === "global" ? "System default" : "Inherit global/system default"}
            />
          </div>
        </div>
      </div>

      {assetCategories.length > 0 && (
        <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Media Providers</h4>
              <p className="mt-1 text-xs text-zinc-500">
                These settings choose which asset provider a studio uses. Credentials and system defaults are managed in Asset Generation.
              </p>
            </div>
            <button
              onClick={() => navigateToSettings("asset-gen")}
              className="text-xs text-blue-300 hover:text-blue-200 transition-colors whitespace-nowrap"
            >
              Open Asset Generation
            </button>
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {assetCategories.map((category) => (
              <AssetProviderField
                key={category}
                category={category}
                scope={scope}
                value={assetValues[category]}
                onChange={(next) => {
                  if (category === "image") setAssetImage(next);
                  if (category === "model") setAssetModel(next);
                  if (category === "sound") setAssetSound(next);
                  setDirty(true);
                }}
                assetProviders={assetProviders}
                globalConfig={globalConfig}
                systemAssetConfig={systemAssetConfig}
                credentialStatus={credentialStatus}
              />
            ))}
          </div>
        </div>
      )}

      {studioType === "app" && (
        <div className="rounded-xl border border-zinc-800 bg-zinc-950/40 p-4 text-xs text-zinc-400">
          App Studio does not use the media-provider overrides above today. Keep app asset creation in the app toolchain,
          and remember Codex still only affects coding tasks.
        </div>
      )}

      {showTools && tools.length > 0 && (
        <div className="space-y-3 rounded-xl border border-zinc-800 bg-zinc-950/40 p-4">
          <div>
            <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Tools</h4>
            <p className="mt-1 text-xs text-zinc-500">Uncheck a tool to keep that studio from using it.</p>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {tools.map((t) => (
              <label key={t} className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer hover:text-zinc-100">
                <input
                  type="checkbox"
                  checked={!disabledTools.has(t)}
                  onChange={() => toggleTool(t)}
                  className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-0 focus:ring-offset-0"
                />
                <span>{STUDIO_TOOL_LABELS[t] ?? t}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center gap-2 pt-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          onClick={() => { onClear(); setDirty(false); }}
          disabled={saving}
          className="text-xs px-3 py-1.5 rounded bg-zinc-700 text-zinc-300 hover:bg-zinc-600 disabled:opacity-50 transition-colors"
        >
          Reset to defaults
        </button>
        {dirty && (
          <span className="text-xs text-amber-400">Unsaved changes</span>
        )}
      </div>
    </div>
  );
}

function AssetProviderField({
  category,
  scope,
  value,
  onChange,
  assetProviders,
  globalConfig,
  systemAssetConfig,
  credentialStatus,
}: {
  category: AssetCategory;
  scope: Scope;
  value: string;
  onChange: (value: string) => void;
  assetProviders: AssetProviderMeta[];
  globalConfig: StudioConfig;
  systemAssetConfig: Record<AssetCategory, AssetProviderType>;
  credentialStatus: Partial<Record<AssetProviderType, AssetProviderCredentialStatus>>;
}) {
  const availableProviders = assetProviders.filter((provider) =>
    provider.capabilities.includes(category === "model" ? "model-3d" : category),
  );

  const selectedMeta = availableProviders.find((provider) => provider.type === value);
  const currentMeta = selectedMeta
    ?? availableProviders.find((provider) => provider.type === ((value || globalConfig.asset?.[category] || systemAssetConfig[category]) as AssetProviderType));

  const currentType = (value || globalConfig.asset?.[category] || systemAssetConfig[category]) as AssetProviderType;
  const sourceLabel = getAssetSourceLabel(scope, category, value, globalConfig, systemAssetConfig);
  const readiness = formatCredentialStatus(currentMeta, credentialStatus[currentType]);

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 space-y-2">
      <div>
        <label className="text-xs text-zinc-300 block mb-1">{ASSET_LABELS[category]}</label>
        <p className="text-[11px] text-zinc-500">{ASSET_DESCRIPTIONS[category]}</p>
      </div>

      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
      >
        <option value="">{scope === "global" ? "System default" : "Inherit global/system default"}</option>
        {availableProviders.map((opt) => (
          <option key={opt.type} value={opt.type}>{opt.label}</option>
        ))}
      </select>

      <p className="text-[11px] text-blue-300">{sourceLabel}</p>
      <p className="text-[11px] text-zinc-500">{getInheritanceMessage(scope, category)}</p>
      {currentMeta && (
        <p className="text-[11px] text-zinc-400">{PROVIDER_BLURBS[currentMeta.type]}</p>
      )}
      <p className="text-[11px] text-zinc-400">{readiness}</p>
      {currentType !== "procedural" && (
        <p className="text-[11px] text-zinc-500">
          If credentials are missing at runtime, Otterbot falls back to Procedural for this category.
        </p>
      )}
    </div>
  );
}
