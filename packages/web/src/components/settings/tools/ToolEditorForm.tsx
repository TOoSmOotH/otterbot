import { useState } from "react";
import { ToolExamples } from "./ToolExamples";
import type { ToolExample } from "../../../stores/tools-store";

interface ToolParameter {
  name: string;
  type: "string" | "number" | "boolean";
  required: boolean;
  description: string;
}

interface ToolEditorFormProps {
  name: string;
  description: string;
  parameters: ToolParameter[];
  code: string;
  timeout: number;
  onNameChange: (v: string) => void;
  onDescriptionChange: (v: string) => void;
  onParametersChange: (v: ToolParameter[]) => void;
  onCodeChange: (v: string) => void;
  onTimeoutChange: (v: number) => void;
}

export function ToolEditorForm({
  name,
  description,
  parameters,
  code,
  timeout,
  onNameChange,
  onDescriptionChange,
  onParametersChange,
  onCodeChange,
  onTimeoutChange,
}: ToolEditorFormProps) {
  const [showExamples, setShowExamples] = useState(false);

  const addParameter = () => {
    onParametersChange([...parameters, { name: "", type: "string", required: true, description: "" }]);
  };

  const removeParameter = (index: number) => {
    onParametersChange(parameters.filter((_, i) => i !== index));
  };

  const updateParameter = (index: number, field: keyof ToolParameter, value: unknown) => {
    onParametersChange(
      parameters.map((p, i) => (i === index ? { ...p, [field]: value } : p)),
    );
  };

  const handleExampleSelect = (example: ToolExample) => {
    onNameChange(example.name);
    onDescriptionChange(example.description);
    onParametersChange([...example.parameters]);
    onCodeChange(example.code);
    onTimeoutChange(example.timeout);
    setShowExamples(false);
  };

  return (
    <div className="space-y-4">
      {/* Load Example */}
      <div>
        <button
          onClick={() => setShowExamples(!showExamples)}
          className="text-xs text-primary hover:text-primary/80 transition-colors"
        >
          {showExamples ? "Hide Examples" : "Load Example"}
        </button>
        {showExamples && (
          <div className="mt-2">
            <ToolExamples onSelect={handleExampleSelect} onClose={() => setShowExamples(false)} />
          </div>
        )}
      </div>

      {/* Name */}
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
          Name (snake_case)
        </label>
        <input
          value={name}
          onChange={(e) => onNameChange(e.target.value.replace(/[^a-z0-9_]/g, ""))}
          placeholder="my_custom_tool"
          className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary font-mono"
        />
      </div>

      {/* Description */}
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
          Description
        </label>
        <textarea
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          rows={2}
          placeholder="What does this tool do?"
          className="w-full bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary resize-y"
        />
      </div>

      {/* Parameters */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-[10px] text-muted-foreground uppercase tracking-wider">
            Parameters
          </label>
          <button
            onClick={addParameter}
            className="text-[10px] text-primary hover:text-primary/80 transition-colors"
          >
            + Add
          </button>
        </div>
        {parameters.length === 0 ? (
          <p className="text-xs text-muted-foreground">No parameters defined.</p>
        ) : (
          <div className="space-y-2">
            {parameters.map((param, i) => (
              <div key={i} className="flex gap-2 items-start">
                <input
                  value={param.name}
                  onChange={(e) => updateParameter(i, "name", e.target.value)}
                  placeholder="name"
                  className="flex-1 bg-secondary rounded-md px-2 py-1 text-xs outline-none focus:ring-1 ring-primary font-mono"
                />
                <select
                  value={param.type}
                  onChange={(e) => updateParameter(i, "type", e.target.value)}
                  className="bg-secondary rounded-md px-2 py-1 text-xs outline-none focus:ring-1 ring-primary"
                >
                  <option value="string">string</option>
                  <option value="number">number</option>
                  <option value="boolean">boolean</option>
                </select>
                <label className="flex items-center gap-1 text-xs text-muted-foreground whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={param.required}
                    onChange={(e) => updateParameter(i, "required", e.target.checked)}
                    className="accent-primary"
                  />
                  req
                </label>
                <input
                  value={param.description}
                  onChange={(e) => updateParameter(i, "description", e.target.value)}
                  placeholder="description"
                  className="flex-1 bg-secondary rounded-md px-2 py-1 text-xs outline-none focus:ring-1 ring-primary"
                />
                <button
                  onClick={() => removeParameter(i)}
                  className="text-muted-foreground hover:text-red-400 transition-colors p-1"
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M18 6 6 18M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Code */}
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
          Code (JavaScript)
        </label>
        <p className="text-[10px] text-muted-foreground mb-1">
          Async function body. Receives <code className="font-mono">params</code> object. Must return a string.
          Available globals: fetch, Headers, AbortController, JSON, Math, Date, URL, URLSearchParams,
          TextEncoder/Decoder, atob/btoa, setTimeout/setInterval, crypto.randomUUID(), structuredClone, console.log.
        </p>
        <textarea
          value={code}
          onChange={(e) => onCodeChange(e.target.value)}
          rows={12}
          spellCheck={false}
          className="w-full bg-secondary rounded-md px-3 py-2 text-sm outline-none focus:ring-1 ring-primary resize-y font-mono"
          style={{ tabSize: 2 }}
        />
      </div>

      {/* Timeout */}
      <div>
        <label className="text-[10px] text-muted-foreground uppercase tracking-wider mb-1 block">
          Timeout (ms)
        </label>
        <input
          type="number"
          value={timeout}
          onChange={(e) => onTimeoutChange(Number(e.target.value))}
          min={1000}
          max={120000}
          className="w-32 bg-secondary rounded-md px-3 py-1.5 text-sm outline-none focus:ring-1 ring-primary font-mono"
        />
      </div>
    </div>
  );
}
