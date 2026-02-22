import { useState, useEffect } from "react";
import type { ModelPriceInfo } from "@otterbot/shared";

interface ModelPricingPromptProps {
  model: string;
}

export function ModelPricingPrompt({ model }: ModelPricingPromptProps) {
  const [status, setStatus] = useState<"loading" | "has-pricing" | "no-pricing" | "editing" | "saved">("loading");
  const [inputPrice, setInputPrice] = useState("");
  const [outputPrice, setOutputPrice] = useState("");

  useEffect(() => {
    if (!model) {
      setStatus("loading");
      return;
    }
    setStatus("loading");
    fetch("/api/settings/pricing")
      .then((r) => r.json())
      .then((data: Record<string, ModelPriceInfo>) => {
        const price = data[model];
        if (price && (price.inputPerMillion > 0 || price.outputPerMillion > 0)) {
          setStatus("has-pricing");
        } else {
          setStatus("no-pricing");
        }
      })
      .catch(() => setStatus("no-pricing"));
  }, [model]);

  const handleSave = async () => {
    const inputPerMillion = parseFloat(inputPrice);
    const outputPerMillion = parseFloat(outputPrice);
    if (isNaN(inputPerMillion) || isNaN(outputPerMillion)) return;
    await fetch(`/api/settings/pricing/${encodeURIComponent(model)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inputPerMillion, outputPerMillion }),
    });
    setStatus("saved");
  };

  if (status === "loading" || status === "has-pricing") return null;

  if (status === "saved") {
    return (
      <div className="text-xs text-green-600 dark:text-green-400 bg-green-500/10 border border-green-500/20 rounded-md px-3 py-2">
        Pricing saved for <span className="font-mono">{model}</span>.
      </div>
    );
  }

  if (status === "no-pricing") {
    return (
      <div className="text-xs bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2.5 space-y-2">
        <p className="text-amber-700 dark:text-amber-400">
          No pricing found for <span className="font-mono font-medium">{model}</span>.
          Add pricing to track costs in the Usage dashboard.
        </p>
        <button
          onClick={() => setStatus("editing")}
          className="text-[11px] px-2 py-0.5 rounded border border-amber-500/30 text-amber-700 dark:text-amber-400 hover:bg-amber-500/10 transition-colors"
        >
          Set Pricing
        </button>
      </div>
    );
  }

  // editing
  return (
    <div className="text-xs bg-amber-500/10 border border-amber-500/20 rounded-md px-3 py-2.5 space-y-2">
      <p className="text-amber-700 dark:text-amber-400">
        Set pricing for <span className="font-mono font-medium">{model}</span> (USD per million tokens):
      </p>
      <div className="flex items-end gap-2">
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">Input $/M</label>
          <input
            type="number"
            step="0.01"
            value={inputPrice}
            onChange={(e) => setInputPrice(e.target.value)}
            placeholder="0.00"
            className="w-20 text-right px-2 py-1 bg-background border border-border rounded text-xs"
            autoFocus
          />
        </div>
        <div>
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider block mb-1">Output $/M</label>
          <input
            type="number"
            step="0.01"
            value={outputPrice}
            onChange={(e) => setOutputPrice(e.target.value)}
            placeholder="0.00"
            className="w-20 text-right px-2 py-1 bg-background border border-border rounded text-xs"
          />
        </div>
        <button
          onClick={handleSave}
          disabled={isNaN(parseFloat(inputPrice)) || isNaN(parseFloat(outputPrice))}
          className="px-3 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 text-[11px] disabled:opacity-50"
        >
          Save
        </button>
        <button
          onClick={() => setStatus("no-pricing")}
          className="px-2 py-1 rounded text-muted-foreground hover:text-foreground text-[11px]"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
