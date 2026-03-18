import { useEffect, useState } from "react";
import { useSettingsStore } from "../../stores/settings-store";
import { ModelCombobox } from "./ModelCombobox";
import type { StudioConfigBundle, StudioConfig, StudioType } from "@otterbot/shared";
import { STUDIO_TOOLS, STUDIO_TOOL_LABELS, STUDIO_TYPE_LABELS } from "@otterbot/shared";
import type { ModelOption } from "../../stores/settings-store";

const STUDIO_TYPES: StudioType[] = ["game", "video", "app"];

const EMPTY_CONFIG: StudioConfig = {};

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
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  // Fetch studio config on mount
  useEffect(() => {
    fetch("/api/settings/studio-config")
      .then((r) => r.json())
      .then((data: StudioConfigBundle) => {
        setBundle(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  // Fetch models for providers
  useEffect(() => {
    for (const p of providers) {
      if (p.apiKeySet || p.type === "ollama") {
        fetchModels(p.id);
      }
    }
  }, [providers]);

  const allModels: ModelOption[] = Object.values(models).flat();

  const save = async (scope: "global" | StudioType, config: StudioConfig) => {
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

  const clearScope = async (scope: "global" | StudioType) => {
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
      <div>
        <h2 className="text-lg font-semibold text-zinc-200">Studios</h2>
        <p className="text-sm text-zinc-400 mt-1">
          Configure LLM models, tools, and asset providers per studio type.
          Per-studio settings override global defaults.
        </p>
      </div>

      {/* Global Defaults */}
      <ScopeSection
        scope="global"
        label="Global Studio Defaults"
        description="These defaults apply to all studios unless overridden."
        config={bundle.global}
        providers={providers}
        models={allModels}
        saving={saving === "global"}
        onSave={(cfg) => save("global", cfg)}
        onClear={() => clearScope("global")}
        showTools={false}
      />

      {/* Per-Studio Sections */}
      {STUDIO_TYPES.map((st) => (
        <div key={st} className="border border-zinc-700/50 rounded-lg overflow-hidden">
          <button
            onClick={() => setExpanded((prev) => ({ ...prev, [st]: !prev[st] }))}
            className="w-full flex items-center justify-between px-4 py-3 bg-zinc-800/30 hover:bg-zinc-800/50 transition-colors text-left"
          >
            <div>
              <h3 className="text-sm font-medium text-zinc-200">{STUDIO_TYPE_LABELS[st]}</h3>
              <p className="text-xs text-zinc-500 mt-0.5">Override global defaults for {STUDIO_TYPE_LABELS[st].toLowerCase()}</p>
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
                providers={providers}
                models={allModels}
                saving={saving === st}
                onSave={(cfg) => save(st, cfg)}
                onClear={() => clearScope(st)}
                showTools={true}
                studioType={st}
                showAssets={st === "game" || st === "video"}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ScopeSection — renders config fields for a single scope
// ---------------------------------------------------------------------------

interface ScopeSectionProps {
  scope: string;
  label?: string;
  description?: string;
  config: StudioConfig;
  providers: { id: string; name: string; type: string; apiKeySet?: boolean }[];
  models: ModelOption[];
  saving: boolean;
  onSave: (cfg: StudioConfig) => void;
  onClear: () => void;
  showTools: boolean;
  studioType?: StudioType;
  showAssets?: boolean;
}

function ScopeSection({
  scope,
  label,
  description,
  config,
  providers,
  models,
  saving,
  onSave,
  onClear,
  showTools,
  studioType,
  showAssets,
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

  // Sync when config changes from parent
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

    // Always send llm if either field is set
    if (llmProvider || llmModel) {
      cfg.llm = {};
      if (llmProvider) cfg.llm.provider = llmProvider;
      if (llmModel) cfg.llm.model = llmModel;
    } else {
      // Explicitly clear
      cfg.llm = { provider: "", model: "" };
    }

    if (showTools && studioType) {
      cfg.tools = { disabled: [...disabledTools] };
    }

    if (showAssets) {
      cfg.asset = {
        image: assetImage || undefined,
        model: assetModel || undefined,
        sound: assetSound || undefined,
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

  return (
    <div className="space-y-5">
      {label && (
        <div>
          <h3 className="text-sm font-medium text-zinc-300">{label}</h3>
          {description && <p className="text-xs text-zinc-500 mt-0.5">{description}</p>}
        </div>
      )}

      {/* LLM Provider & Model */}
      <div className="space-y-3">
        <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">LLM Model</h4>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Provider</label>
            <select
              value={llmProvider}
              onChange={(e) => { setLlmProvider(e.target.value); setDirty(true); }}
              className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
            >
              <option value="">System default</option>
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
              placeholder="System default"
            />
          </div>
        </div>
      </div>

      {/* Asset Provider Overrides */}
      {showAssets && (
        <div className="space-y-3">
          <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Asset Providers</h4>
          <p className="text-xs text-zinc-500">Override the global asset providers for this studio. Leave blank to use global defaults.</p>

          <div className="grid grid-cols-3 gap-3">
            {(studioType === "game" || studioType === "video") && (
              <AssetProviderSelect
                label="Sound"
                value={assetSound}
                onChange={(v) => { setAssetSound(v); setDirty(true); }}
              />
            )}
            {studioType === "game" && (
              <>
                <AssetProviderSelect
                  label="Image"
                  value={assetImage}
                  onChange={(v) => { setAssetImage(v); setDirty(true); }}
                />
                <AssetProviderSelect
                  label="3D Model"
                  value={assetModel}
                  onChange={(v) => { setAssetModel(v); setDirty(true); }}
                />
              </>
            )}
          </div>
        </div>
      )}

      {/* Tool Toggles */}
      {showTools && tools.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-xs font-medium text-zinc-400 uppercase tracking-wide">Tools</h4>
          <p className="text-xs text-zinc-500">Uncheck tools to disable them for this studio.</p>

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

      {/* Actions */}
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

// ---------------------------------------------------------------------------
// AssetProviderSelect — simple select for asset provider type
// ---------------------------------------------------------------------------

const ASSET_PROVIDER_OPTIONS = [
  { value: "", label: "Global default" },
  { value: "procedural", label: "Procedural" },
  { value: "openai", label: "OpenAI" },
  { value: "replicate", label: "Replicate" },
  { value: "stable-diffusion", label: "Stable Diffusion" },
];

function AssetProviderSelect({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div>
      <label className="text-xs text-zinc-500 block mb-1">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-zinc-500"
      >
        {ASSET_PROVIDER_OPTIONS.map((opt) => (
          <option key={opt.value} value={opt.value}>{opt.label}</option>
        ))}
      </select>
    </div>
  );
}
