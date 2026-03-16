import { useEffect, useState } from "react";

interface AssetProviderMeta {
  type: string;
  label: string;
  needsApiKey: boolean;
  needsBaseUrl: boolean;
  capabilities: string[];
}

interface AssetProviderConfig {
  image: string;
  model: string;
  sound: string;
}

type AssetCategory = "image" | "model" | "sound";

const CATEGORY_LABELS: Record<AssetCategory, string> = {
  image: "Image & Texture",
  model: "3D Model",
  sound: "Sound & Music",
};

const CATEGORY_DESCRIPTIONS: Record<AssetCategory, string> = {
  image: "Used by game_gen_texture and game_gen_sprite tools",
  model: "Used by game_gen_model tool (GLB output)",
  sound: "Used by game_gen_sound tool (WAV output)",
};

export function AssetGenTab() {
  const [providers, setProviders] = useState<AssetProviderMeta[]>([]);
  const [config, setConfig] = useState<AssetProviderConfig>({ image: "procedural", model: "procedural", sound: "procedural" });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [credentialInputs, setCredentialInputs] = useState<Record<string, { apiKey: string; baseUrl: string }>>({});
  const [credentialStatus, setCredentialStatus] = useState<Record<string, "saved" | "error" | null>>({});

  useEffect(() => {
    fetch("/api/settings/asset-providers")
      .then((r) => r.json())
      .then((data) => {
        setProviders(data.providers ?? []);
        setConfig(data.config ?? { image: "procedural", model: "procedural", sound: "procedural" });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const handleProviderChange = async (category: AssetCategory, providerType: string) => {
    setSaving(true);
    const newConfig = { ...config, [category]: providerType };
    setConfig(newConfig);
    try {
      await fetch("/api/settings/asset-providers", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [category]: providerType }),
      });
    } catch {
      // revert on error
      setConfig(config);
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
      setTimeout(() => setCredentialStatus((s) => ({ ...s, [providerType]: null })), 3000);
    } catch {
      setCredentialStatus((s) => ({ ...s, [providerType]: "error" }));
    }
  };

  const getProvidersForCategory = (category: AssetCategory): AssetProviderMeta[] => {
    return providers.filter((p) => p.capabilities.includes(category === "model" ? "model-3d" : category));
  };

  if (loading) {
    return (
      <div className="p-6 text-sm text-zinc-500">Loading asset provider settings...</div>
    );
  }

  // Find which providers are currently active and need credentials
  const activeProviders = new Set([config.image, config.model, config.sound]);
  const needsCredentials = providers.filter(
    (p) => activeProviders.has(p.type) && (p.needsApiKey || p.needsBaseUrl) && p.type !== "procedural",
  );

  return (
    <div className="p-6 space-y-8">
      <div>
        <h2 className="text-lg font-semibold text-zinc-200">Asset Generation</h2>
        <p className="text-sm text-zinc-400 mt-1">
          Configure AI providers for generating game textures, sprites, 3D models, and sound effects.
          The procedural fallback works without any API keys.
        </p>
      </div>

      {/* Provider selection per category */}
      {(["image", "model", "sound"] as AssetCategory[]).map((category) => {
        const available = getProvidersForCategory(category);
        return (
          <div key={category} className="space-y-2">
            <div>
              <h3 className="text-sm font-medium text-zinc-300">{CATEGORY_LABELS[category]}</h3>
              <p className="text-xs text-zinc-500">{CATEGORY_DESCRIPTIONS[category]}</p>
            </div>
            <div className="flex gap-2 flex-wrap">
              {available.map((p) => (
                <button
                  key={p.type}
                  onClick={() => handleProviderChange(category, p.type)}
                  disabled={saving}
                  className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                    config[category] === p.type
                      ? "bg-zinc-700 border-zinc-500 text-zinc-200"
                      : "bg-zinc-800/50 border-zinc-700/50 text-zinc-400 hover:border-zinc-600 hover:text-zinc-300"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}

      {/* Credentials section */}
      {needsCredentials.length > 0 && (
        <div className="space-y-4 pt-4 border-t border-zinc-700/50">
          <h3 className="text-sm font-medium text-zinc-300">Provider Credentials</h3>
          <p className="text-xs text-zinc-500">
            These credentials are stored separately from your LLM providers.
            If you have an existing LLM provider with the same type, its API key will be used as a fallback.
          </p>

          {needsCredentials.map((p) => {
            const input = credentialInputs[p.type] ?? { apiKey: "", baseUrl: "" };
            const status = credentialStatus[p.type];

            return (
              <div key={p.type} className="space-y-2 bg-zinc-800/30 rounded-lg p-3">
                <div className="text-sm font-medium text-zinc-300">{p.label}</div>

                {p.needsApiKey && (
                  <div>
                    <label className="text-xs text-zinc-500 block mb-1">API Key</label>
                    <input
                      type="password"
                      placeholder="Enter API key..."
                      value={input.apiKey}
                      onChange={(e) =>
                        setCredentialInputs((s) => ({
                          ...s,
                          [p.type]: { ...input, apiKey: e.target.value },
                        }))
                      }
                      className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                    />
                  </div>
                )}

                {p.needsBaseUrl && (
                  <div>
                    <label className="text-xs text-zinc-500 block mb-1">Base URL</label>
                    <input
                      type="text"
                      placeholder={p.type === "stable-diffusion" ? "http://127.0.0.1:7860" : "Enter base URL..."}
                      value={input.baseUrl}
                      onChange={(e) =>
                        setCredentialInputs((s) => ({
                          ...s,
                          [p.type]: { ...input, baseUrl: e.target.value },
                        }))
                      }
                      className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
                    />
                  </div>
                )}

                <div className="flex items-center gap-2">
                  <button
                    onClick={() => handleSaveCredentials(p.type)}
                    className="text-xs px-3 py-1 rounded bg-zinc-700 text-zinc-200 hover:bg-zinc-600 transition-colors"
                  >
                    Save
                  </button>
                  {status === "saved" && (
                    <span className="text-xs text-emerald-400">Saved</span>
                  )}
                  {status === "error" && (
                    <span className="text-xs text-red-400">Failed to save</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Info section */}
      <div className="text-xs text-zinc-500 space-y-1 pt-4 border-t border-zinc-700/50">
        <p>
          <strong className="text-zinc-400">Procedural</strong> — Generates simple patterns, shapes, and synth sounds. No API key needed.
        </p>
        <p>
          <strong className="text-zinc-400">OpenAI</strong> — Uses gpt-image-1 (DALL-E) for high-quality image generation. Requires an OpenAI API key.
        </p>
        <p>
          <strong className="text-zinc-400">Replicate</strong> — Access to SDXL and other models for images, 3D, and audio. Pay-per-use API.
        </p>
        <p>
          <strong className="text-zinc-400">Stable Diffusion</strong> — Connect to a local ComfyUI or Automatic1111 instance for free local generation.
        </p>
      </div>
    </div>
  );
}
