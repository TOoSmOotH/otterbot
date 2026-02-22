import { useState, useEffect } from "react";
import type { ModelPriceInfo } from "@otterbot/shared";

export function PricingTab() {
  const [prices, setPrices] = useState<Record<string, ModelPriceInfo>>({});
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<string | null>(null);
  const [editInput, setEditInput] = useState("");
  const [editOutput, setEditOutput] = useState("");
  const [adding, setAdding] = useState(false);
  const [newModel, setNewModel] = useState("");
  const [newInput, setNewInput] = useState("");
  const [newOutput, setNewOutput] = useState("");

  const loadPrices = () => {
    setLoading(true);
    fetch("/api/settings/pricing")
      .then((r) => r.json())
      .then((data) => {
        setPrices(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  };

  useEffect(() => {
    loadPrices();
  }, []);

  const handleSave = async (model: string) => {
    const inputPerMillion = parseFloat(editInput);
    const outputPerMillion = parseFloat(editOutput);
    if (isNaN(inputPerMillion) || isNaN(outputPerMillion)) return;
    await fetch(`/api/settings/pricing/${encodeURIComponent(model)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputPerMillion, outputPerMillion }),
    });
    setEditing(null);
    loadPrices();
  };

  const handleReset = async (model: string) => {
    await fetch(`/api/settings/pricing/${encodeURIComponent(model)}`, {
      method: "DELETE",
    });
    loadPrices();
  };

  const startEdit = (model: string, price: ModelPriceInfo) => {
    setEditing(model);
    setEditInput(String(price.inputPerMillion));
    setEditOutput(String(price.outputPerMillion));
  };

  const handleAdd = async () => {
    const model = newModel.trim();
    if (!model) return;
    const inputPerMillion = parseFloat(newInput);
    const outputPerMillion = parseFloat(newOutput);
    if (isNaN(inputPerMillion) || isNaN(outputPerMillion)) return;
    await fetch(`/api/settings/pricing/${encodeURIComponent(model)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputPerMillion, outputPerMillion }),
    });
    setAdding(false);
    setNewModel("");
    setNewInput("");
    setNewOutput("");
    loadPrices();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        Loading pricing data...
      </div>
    );
  }

  const sortedModels = Object.entries(prices).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="p-5 space-y-4">
      <div>
        <h3 className="text-sm font-semibold mb-1">Model Pricing</h3>
        <p className="text-xs text-muted-foreground mb-4">
          Prices in USD per million tokens. Used for cost calculations in the Usage dashboard.
          Override any price or reset to the built-in default.
        </p>
      </div>

      {adding ? (
        <div className="flex items-end gap-2 p-3 border border-border rounded-lg bg-secondary/10">
          <div className="flex-1">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">Model ID</label>
            <input
              type="text"
              value={newModel}
              onChange={(e) => setNewModel(e.target.value)}
              placeholder="e.g. claude-sonnet-4-5"
              className="w-full px-2 py-1 bg-background border border-border rounded text-xs"
              autoFocus
            />
          </div>
          <div className="w-24">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">Input $/M</label>
            <input
              type="number"
              step="0.01"
              value={newInput}
              onChange={(e) => setNewInput(e.target.value)}
              placeholder="0.00"
              className="w-full text-right px-2 py-1 bg-background border border-border rounded text-xs"
            />
          </div>
          <div className="w-24">
            <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">Output $/M</label>
            <input
              type="number"
              step="0.01"
              value={newOutput}
              onChange={(e) => setNewOutput(e.target.value)}
              placeholder="0.00"
              className="w-full text-right px-2 py-1 bg-background border border-border rounded text-xs"
            />
          </div>
          <button
            onClick={handleAdd}
            disabled={!newModel.trim() || isNaN(parseFloat(newInput)) || isNaN(parseFloat(newOutput))}
            className="px-3 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 text-xs disabled:opacity-50"
          >
            Add
          </button>
          <button
            onClick={() => { setAdding(false); setNewModel(""); setNewInput(""); setNewOutput(""); }}
            className="px-3 py-1 rounded bg-secondary text-secondary-foreground hover:bg-secondary/80 text-xs"
          >
            Cancel
          </button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="text-xs px-3 py-1.5 rounded border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground/30 transition-colors"
        >
          + Add Model
        </button>
      )}

      <div className="border border-border rounded-lg overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-border bg-secondary/30">
              <th className="text-left px-3 py-2 font-medium">Model</th>
              <th className="text-right px-3 py-2 font-medium">Input $/M</th>
              <th className="text-right px-3 py-2 font-medium">Output $/M</th>
              <th className="text-right px-3 py-2 font-medium w-[140px]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {sortedModels.map(([model, price]) => (
              <tr key={model} className="border-b border-border last:border-0 hover:bg-secondary/20">
                <td className="px-3 py-2 font-mono text-[11px]">
                  {model}
                  {price.isCustom && (
                    <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-primary/20 text-primary font-medium">
                      custom
                    </span>
                  )}
                </td>
                {editing === model ? (
                  <>
                    <td className="px-3 py-1.5 text-right">
                      <input
                        type="number"
                        step="0.01"
                        value={editInput}
                        onChange={(e) => setEditInput(e.target.value)}
                        className="w-20 text-right px-1.5 py-0.5 bg-background border border-border rounded text-xs"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <input
                        type="number"
                        step="0.01"
                        value={editOutput}
                        onChange={(e) => setEditOutput(e.target.value)}
                        className="w-20 text-right px-1.5 py-0.5 bg-background border border-border rounded text-xs"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-right space-x-1">
                      <button
                        onClick={() => handleSave(model)}
                        className="px-2 py-0.5 rounded bg-primary text-primary-foreground hover:bg-primary/90 text-[11px]"
                      >
                        Save
                      </button>
                      <button
                        onClick={() => setEditing(null)}
                        className="px-2 py-0.5 rounded bg-secondary text-secondary-foreground hover:bg-secondary/80 text-[11px]"
                      >
                        Cancel
                      </button>
                    </td>
                  </>
                ) : (
                  <>
                    <td className="px-3 py-2 text-right font-mono">
                      ${price.inputPerMillion.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      ${price.outputPerMillion.toFixed(2)}
                    </td>
                    <td className="px-3 py-2 text-right space-x-1">
                      <button
                        onClick={() => startEdit(model, price)}
                        className="px-2 py-0.5 rounded bg-secondary text-secondary-foreground hover:bg-secondary/80 text-[11px]"
                      >
                        Edit
                      </button>
                      {price.isCustom && (
                        <button
                          onClick={() => handleReset(model)}
                          className="px-2 py-0.5 rounded text-muted-foreground hover:text-foreground hover:bg-secondary text-[11px]"
                        >
                          Reset
                        </button>
                      )}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
