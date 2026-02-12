import { useState, useEffect } from "react";
import { cn } from "../../lib/utils";
import { useSettingsStore } from "../../stores/settings-store";
import { ProvidersTab } from "./ProvidersTab";
import { ModelsTab } from "./ModelsTab";
import { AgentTemplatesTab } from "./AgentTemplatesTab";
import { SearchTab } from "./SearchTab";
import { SpeechTab } from "./SpeechTab";

type Tab = "providers" | "models" | "templates" | "search" | "speech";

const TABS: { id: Tab; label: string }[] = [
  { id: "providers", label: "Providers" },
  { id: "models", label: "Models" },
  { id: "templates", label: "Agent Templates" },
  { id: "search", label: "Search" },
  { id: "speech", label: "Speech" },
];

export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const [activeTab, setActiveTab] = useState<Tab>("providers");
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const loading = useSettingsStore((s) => s.loading);

  useEffect(() => {
    loadSettings();
  }, []);

  return (
    <div className="fixed inset-0 z-50 bg-background/80 backdrop-blur-sm flex items-center justify-center">
      <div className="bg-card border border-border rounded-xl shadow-2xl w-[900px] max-h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-border">
          <h2 className="text-sm font-semibold">Settings</h2>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground text-lg leading-none"
          >
            &times;
          </button>
        </div>

        {/* Tab bar */}
        <div className="flex border-b border-border px-5">
          {TABS.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "px-4 py-2 text-xs font-medium transition-colors relative",
                activeTab === tab.id
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {tab.label}
              {activeTab === tab.id && (
                <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary" />
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
              Loading settings...
            </div>
          ) : (
            <>
              {activeTab === "providers" && <ProvidersTab />}
              {activeTab === "models" && <ModelsTab />}
              {activeTab === "templates" && <AgentTemplatesTab />}
              {activeTab === "search" && <SearchTab />}
              {activeTab === "speech" && <SpeechTab />}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
