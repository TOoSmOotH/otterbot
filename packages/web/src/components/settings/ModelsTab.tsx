import { useState, useEffect, useMemo } from "react";
import { useSettingsStore } from "../../stores/settings-store";
import { ModelCombobox } from "./ModelCombobox";
import { ModelPricingPrompt } from "./ModelPricingPrompt";
import type { RegistryEntry } from "@otterbot/shared";

const TIER_LABELS: Record<string, { label: string; hint: string; tip?: string }> = {
  coo: {
    label: "COO (Chief Operating Officer)",
    hint: "The main orchestration agent. All other tiers fall back to this default.",
  },
  teamLead: {
    label: "Team Lead",
    hint: "Manages projects and coordinates workers. Falls back to COO default if not set.",
    tip: "Tip: Use a reasoning model (e.g., Claude Opus, Sonnet 4.5) for better task planning and decomposition.",
  },
  worker: {
    label: "Worker",
    hint: "Executes tasks (coding, research, etc.). Falls back to COO default if not set.",
    tip: "Tip: Workers execute detailed plans from the Team Lead, so cheaper/faster models work well here to save costs.",
  },
};

const ROLE_LABELS: Record<string, string> = {
  coo: "COO",
  team_lead: "Team Lead",
  worker: "Worker",
};

export function ModelsTab() {
  const defaults = useSettingsStore((s) => s.defaults);
  const providers = useSettingsStore((s) => s.providers);
  const models = useSettingsStore((s) => s.models);
  const customModels = useSettingsStore((s) => s.customModels);
  const updateDefaults = useSettingsStore((s) => s.updateDefaults);
  const fetchModels = useSettingsStore((s) => s.fetchModels);
  const loadCustomModels = useSettingsStore((s) => s.loadCustomModels);
  const createCustomModel = useSettingsStore((s) => s.createCustomModel);
  const deleteCustomModel = useSettingsStore((s) => s.deleteCustomModel);
  const agentModelOverrides = useSettingsStore((s) => s.agentModelOverrides);
  const loadAgentModelOverrides = useSettingsStore((s) => s.loadAgentModelOverrides);
  const setAgentModelOverride = useSettingsStore((s) => s.setAgentModelOverride);
  const clearAgentModelOverride = useSettingsStore((s) => s.clearAgentModelOverride);

  const [form, setForm] = useState({
    coo: { ...defaults.coo },
    teamLead: { ...defaults.teamLead },
    worker: { ...defaults.worker },
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Custom model form
  const [cmProviderId, setCmProviderId] = useState("");
  const [cmModelId, setCmModelId] = useState("");
  const [cmLabel, setCmLabel] = useState("");

  // Agent registry entries
  const [registryEntries, setRegistryEntries] = useState<RegistryEntry[]>([]);

  // Sync form when settings reload
  useEffect(() => {
    setForm({
      coo: { ...defaults.coo },
      teamLead: { ...defaults.teamLead },
      worker: { ...defaults.worker },
    });
  }, [defaults]);

  // Fetch model lists for configured providers
  useEffect(() => {
    for (const p of providers) {
      if (p.apiKeySet || p.type === "ollama") {
        fetchModels(p.id);
      }
    }
    loadCustomModels();
    // Default the custom model provider selector to first provider
    if (providers.length > 0 && !cmProviderId) {
      setCmProviderId(providers[0].id);
    }
  }, [providers]);

  // Load registry entries and agent overrides
  useEffect(() => {
    loadAgentModelOverrides();
    fetch("/api/registry")
      .then((res) => res.json())
      .then((data) => setRegistryEntries(data))
      .catch(() => {});
  }, []);

  const handleProviderChange = (
    tier: "coo" | "teamLead" | "worker",
    provider: string,
  ) => {
    setForm((prev) => ({
      ...prev,
      [tier]: { ...prev[tier], provider },
    }));
    // Fetch models for this provider if we haven't yet
    if (!models[provider]) {
      fetchModels(provider);
    }
  };

  const handleModelChange = (
    tier: "coo" | "teamLead" | "worker",
    model: string,
  ) => {
    setForm((prev) => ({
      ...prev,
      [tier]: { ...prev[tier], model },
    }));
  };

  const handleSave = async () => {
    setSaving(true);
    await updateDefaults(form);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleAddCustomModel = async () => {
    if (!cmProviderId || !cmModelId.trim()) return;
    await createCustomModel({
      providerId: cmProviderId,
      modelId: cmModelId.trim(),
      label: cmLabel.trim() || undefined,
    });
    setCmModelId("");
    setCmLabel("");
  };

  return (
    <div className="p-5 space-y-6">
      <p className="text-xs text-muted-foreground">
        Set the default LLM provider and model for each agent tier. Team Lead and Worker
        fall back to the COO default when not explicitly configured.
      </p>

      {(["coo", "teamLead", "worker"] as const).map((tier) => {
        const tierInfo = TIER_LABELS[tier];
        const providerModels = models[form[tier].provider] ?? [];

        return (
          <div key={tier} className="border border-border rounded-lg p-4 space-y-3">
            <div>
              <h3 className="text-sm font-medium">{tierInfo.label}</h3>
              <p className="text-[10px] text-muted-foreground">{tierInfo.hint}</p>
            </div>

            {tierInfo.tip && (
              <p className="text-[11px] text-primary/80 bg-primary/5 border border-primary/10 rounded-md px-3 py-2">
                {tierInfo.tip}
              </p>
            )}

            <div className="grid grid-cols-2 gap-3">
              {/* Provider select */}
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
                  Provider
                </label>
                <select
                  value={form[tier].provider}
                  onChange={(e) => handleProviderChange(tier, e.target.value)}
                  className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
                >
                  {providers.length === 0 && (
                    <option value="">No providers configured</option>
                  )}
                  {providers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.type})
                    </option>
                  ))}
                </select>
              </div>

              {/* Model combobox */}
              <div>
                <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
                  Model
                </label>
                <ModelCombobox
                  value={form[tier].model}
                  options={providerModels}
                  onChange={(model) => handleModelChange(tier, model)}
                  placeholder="e.g. claude-sonnet-4-5-20250929"
                />
              </div>
            </div>

            {form[tier].model && <ModelPricingPrompt model={form[tier].model} />}
          </div>
        );
      })}

      {/* Save button */}
      <div className="flex items-center gap-2">
        <button
          onClick={handleSave}
          disabled={saving}
          className="text-xs bg-primary text-primary-foreground px-4 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50"
        >
          {saving ? "Saving..." : "Save Changes"}
        </button>
        {saved && (
          <span className="text-xs text-green-500">{"\u2713"} Saved</span>
        )}
      </div>

      {/* Agent Model Assignments */}
      <AgentModelAssignments
        entries={registryEntries}
        providers={providers}
        models={models}
        overrides={agentModelOverrides}
        defaults={defaults}
        fetchModels={fetchModels}
        onSetOverride={setAgentModelOverride}
        onClearOverride={clearAgentModelOverride}
      />

      {/* Custom Models section */}
      <div className="border-t border-border pt-6 space-y-4">
        <div>
          <h3 className="text-sm font-medium">Custom Models</h3>
          <p className="text-[10px] text-muted-foreground">
            Manually add model IDs that aren't auto-discovered. These appear in all model dropdowns for the selected provider.
          </p>
        </div>

        {/* Add form */}
        <div className="flex items-end gap-2">
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
              Provider
            </label>
            <select
              value={cmProviderId}
              onChange={(e) => setCmProviderId(e.target.value)}
              className="bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
            >
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
              Model ID
            </label>
            <input
              type="text"
              value={cmModelId}
              onChange={(e) => setCmModelId(e.target.value)}
              placeholder="e.g. my-custom-model"
              className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddCustomModel();
              }}
            />
          </div>
          <div>
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
              Label (optional)
            </label>
            <input
              type="text"
              value={cmLabel}
              onChange={(e) => setCmLabel(e.target.value)}
              placeholder="Display name"
              className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleAddCustomModel();
              }}
            />
          </div>
          <button
            onClick={handleAddCustomModel}
            disabled={!cmModelId.trim()}
            className="text-xs bg-primary text-primary-foreground px-3 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50 whitespace-nowrap"
          >
            Add
          </button>
        </div>

        {cmModelId.trim() && <ModelPricingPrompt model={cmModelId.trim()} />}

        {/* Custom models list */}
        {customModels.length > 0 && (
          <div className="space-y-1">
            {customModels.map((cm) => {
              const prov = providers.find((p) => p.id === cm.providerId);
              return (
                <div
                  key={cm.id}
                  className="flex items-center justify-between bg-secondary/50 rounded-md px-3 py-1.5"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-[10px] text-muted-foreground bg-secondary px-1.5 py-0.5 rounded shrink-0">
                      {prov?.name ?? cm.providerId}
                    </span>
                    <span className="text-sm font-mono truncate">{cm.modelId}</span>
                    {cm.label && (
                      <span className="text-xs text-muted-foreground truncate">
                        ({cm.label})
                      </span>
                    )}
                  </div>
                  <button
                    onClick={() => deleteCustomModel(cm.id)}
                    className="text-xs text-destructive hover:bg-destructive/10 px-2 py-0.5 rounded shrink-0"
                  >
                    Remove
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent Model Assignments sub-component
// ---------------------------------------------------------------------------

interface AgentModelAssignmentsProps {
  entries: RegistryEntry[];
  providers: { id: string; name: string; type: string; apiKeySet: boolean }[];
  models: Record<string, { modelId: string; label?: string; source: string }[]>;
  overrides: { registryEntryId: string; provider: string; model: string }[];
  defaults: {
    coo: { provider: string; model: string };
    teamLead: { provider: string; model: string };
    worker: { provider: string; model: string };
  };
  fetchModels: (providerId: string) => Promise<void>;
  onSetOverride: (registryEntryId: string, provider: string, model: string) => Promise<void>;
  onClearOverride: (registryEntryId: string) => Promise<void>;
}

function AgentModelAssignments({
  entries,
  providers,
  models,
  overrides,
  defaults,
  fetchModels,
  onSetOverride,
  onClearOverride,
}: AgentModelAssignmentsProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editProvider, setEditProvider] = useState("");
  const [editModel, setEditModel] = useState("");
  const [saving, setSaving] = useState(false);

  const grouped = useMemo(() => {
    const core = entries.filter(
      (e) => e.builtIn && (e.role === "coo" || e.role === "team_lead"),
    );
    const workers = entries.filter((e) => e.builtIn && e.role === "worker");
    const custom = entries.filter((e) => !e.builtIn);
    return { core, workers, custom };
  }, [entries]);

  const overrideMap = useMemo(() => {
    const map = new Map<string, { provider: string; model: string }>();
    for (const o of overrides) {
      map.set(o.registryEntryId, { provider: o.provider, model: o.model });
    }
    return map;
  }, [overrides]);

  const getEffective = (entry: RegistryEntry) => {
    const override = overrideMap.get(entry.id);
    if (override) return { ...override, source: "override" as const };
    const tierKey = entry.role === "coo" ? "coo" : entry.role === "team_lead" ? "teamLead" : "worker";
    const tier = defaults[tierKey as keyof typeof defaults];
    if (tier.provider && tier.model) return { ...tier, source: "tier" as const };
    return { provider: defaults.coo.provider, model: defaults.coo.model, source: "coo" as const };
  };

  const startEdit = (entry: RegistryEntry) => {
    const override = overrideMap.get(entry.id);
    const effective = getEffective(entry);
    setEditProvider(override?.provider ?? effective.provider);
    setEditModel(override?.model ?? effective.model);
    setEditingId(entry.id);
    // Ensure models are fetched for the provider
    const pid = override?.provider ?? effective.provider;
    if (pid && !models[pid]) {
      fetchModels(pid);
    }
  };

  const handleSave = async () => {
    if (!editingId || !editProvider || !editModel) return;
    setSaving(true);
    await onSetOverride(editingId, editProvider, editModel);
    setSaving(false);
    setEditingId(null);
  };

  const handleClear = async (registryEntryId: string) => {
    await onClearOverride(registryEntryId);
    if (editingId === registryEntryId) {
      setEditingId(null);
    }
  };

  if (entries.length === 0) return null;

  const renderGroup = (label: string, items: RegistryEntry[]) => {
    if (items.length === 0) return null;
    return (
      <div key={label} className="space-y-2">
        <h4 className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          {label}
        </h4>
        {items.map((entry) => {
          const effective = getEffective(entry);
          const hasOverride = overrideMap.has(entry.id);
          const isEditing = editingId === entry.id;
          const providerName =
            providers.find((p) => p.id === effective.provider)?.name ?? effective.provider;

          return (
            <div
              key={entry.id}
              className="border border-border rounded-lg p-3 space-y-2"
              data-testid={`agent-entry-${entry.id}`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{entry.name}</span>
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground bg-secondary px-1.5 py-0.5 rounded">
                    {ROLE_LABELS[entry.role] ?? entry.role}
                  </span>
                  {hasOverride && (
                    <span className="text-[9px] uppercase tracking-wider text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                      Custom
                    </span>
                  )}
                </div>
                <div className="flex gap-1">
                  {!isEditing && (
                    <button
                      onClick={() => startEdit(entry)}
                      className="text-xs text-muted-foreground hover:text-foreground px-2 py-0.5 rounded hover:bg-secondary"
                    >
                      Edit
                    </button>
                  )}
                  {hasOverride && !isEditing && (
                    <button
                      onClick={() => handleClear(entry.id)}
                      className="text-xs text-destructive hover:bg-destructive/10 px-2 py-0.5 rounded"
                    >
                      Reset
                    </button>
                  )}
                </div>
              </div>

              {!isEditing ? (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <span className="bg-secondary px-1.5 py-0.5 rounded font-mono">
                    {providerName}
                  </span>
                  <span className="bg-secondary px-1.5 py-0.5 rounded font-mono">
                    {effective.model}
                  </span>
                  {!hasOverride && (
                    <span className="text-[10px] italic">
                      (using {effective.source === "tier" ? "tier" : "COO"} default)
                    </span>
                  )}
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
                        Provider
                      </label>
                      <select
                        value={editProvider}
                        onChange={(e) => {
                          setEditProvider(e.target.value);
                          if (!models[e.target.value]) {
                            fetchModels(e.target.value);
                          }
                        }}
                        className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary"
                      >
                        {providers.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.type})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
                        Model
                      </label>
                      <ModelCombobox
                        value={editModel}
                        options={models[editProvider] ?? []}
                        onChange={setEditModel}
                        placeholder="Select or type a model..."
                      />
                    </div>
                  </div>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSave}
                      disabled={saving}
                      className="text-xs bg-primary text-primary-foreground px-3 py-1 rounded-md hover:bg-primary/90 disabled:opacity-50"
                    >
                      {saving ? "Saving..." : "Save"}
                    </button>
                    <button
                      onClick={() => setEditingId(null)}
                      className="text-xs text-muted-foreground px-3 py-1 rounded-md hover:bg-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <div className="border-t border-border pt-6 space-y-4">
      <div>
        <h3 className="text-sm font-medium">Agent Model Assignments</h3>
        <p className="text-[10px] text-muted-foreground">
          Override the model for specific agent types. Agents without a custom override
          use their tier default (which falls back to the COO default).
        </p>
      </div>
      {renderGroup("Core", grouped.core)}
      {renderGroup("Workers", grouped.workers)}
      {renderGroup("Custom", grouped.custom)}
    </div>
  );
}
