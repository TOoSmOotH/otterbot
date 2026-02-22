import { useState } from "react";
import { useToolsStore } from "../../../stores/tools-store";
import type { CustomToolCreate } from "@otterbot/shared";

interface ToolAiAssistProps {
  onGenerated: (tool: Partial<CustomToolCreate>) => void;
  onClose: () => void;
}

export function ToolAiAssist({ onGenerated, onClose }: ToolAiAssistProps) {
  const generateTool = useToolsStore((s) => s.generateTool);
  const [description, setDescription] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleGenerate = async () => {
    if (!description.trim()) return;
    setGenerating(true);
    setError(null);
    const result = await generateTool(description);
    setGenerating(false);
    if (result) {
      onGenerated(result);
    } else {
      setError("Failed to generate tool. Make sure an AI provider is configured.");
    }
  };

  return (
    <div className="rounded-lg border border-primary/30 bg-primary/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold">AI Assist</h4>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
      <div>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          placeholder="Describe what you want this tool to do... e.g. 'Fetch the current weather for a given city using a public API'"
          className="w-full bg-secondary rounded-md px-3 py-2 text-sm outline-none focus:ring-1 ring-primary resize-y"
        />
      </div>
      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}
      <button
        onClick={handleGenerate}
        disabled={generating || !description.trim()}
        className="text-xs bg-primary text-primary-foreground px-4 py-1.5 rounded-md hover:bg-primary/90 disabled:opacity-50"
      >
        {generating ? "Generating..." : "Generate"}
      </button>
    </div>
  );
}
