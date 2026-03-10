import { useState, useCallback } from "react";
import { cn } from "../../lib/utils";
import { AgentTemplatesTab } from "./AgentTemplatesTab";
import { SkillsSubView } from "./SkillsSubView";
import { ToolsSubView } from "./tools/ToolsSubView";
import { SpecialistsSubView } from "./SpecialistsSubView";

type WorkshopScope = "agents" | "skills" | "tools" | "specialists";

const SCOPE_TABS: { id: WorkshopScope; label: string }[] = [
  { id: "agents", label: "Agents" },
  { id: "skills", label: "Skills" },
  { id: "tools", label: "Tools" },
  { id: "specialists", label: "Specialists" },
];

export function AgentWorkshopTab() {
  const [activeScope, setActiveScope] = useState<WorkshopScope>("agents");
  const [navigateToSkillId, setNavigateToSkillId] = useState<string | null>(null);
  const [navigateToTool, setNavigateToTool] = useState<string | null>(null);
  const [navigateToSpecialistId, setNavigateToSpecialistId] = useState<string | null>(null);

  const handleNavigateToSkill = useCallback((skillId: string) => {
    setNavigateToSkillId(skillId);
    setActiveScope("skills");
  }, []);

  const handleNavigateToTool = useCallback((toolName: string) => {
    setNavigateToTool(toolName);
    setActiveScope("tools");
  }, []);

  const handleNavigateToSpecialist = useCallback((specialistId: string) => {
    setNavigateToSpecialistId(specialistId);
    setActiveScope("specialists");
  }, []);

  // Clear navigation targets when the user manually switches tabs
  const handleScopeChange = useCallback((scope: WorkshopScope) => {
    setActiveScope(scope);
    if (scope !== "skills") setNavigateToSkillId(null);
    if (scope !== "tools") setNavigateToTool(null);
    if (scope !== "specialists") setNavigateToSpecialistId(null);
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Scope tab bar */}
      <div className="flex items-center gap-1 px-5 pt-4 pb-2">
        {SCOPE_TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => handleScopeChange(tab.id)}
            className={cn(
              "px-4 py-1.5 text-xs font-medium rounded-full transition-colors",
              activeScope === tab.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary",
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Sub-view */}
      <div className="flex-1 overflow-hidden">
        {activeScope === "agents" && (
          <AgentTemplatesTab
            onNavigateToSkill={handleNavigateToSkill}
            onNavigateToSpecialist={handleNavigateToSpecialist}
          />
        )}
        {activeScope === "skills" && (
          <SkillsSubView
            navigateToId={navigateToSkillId}
            onNavigatedTo={() => setNavigateToSkillId(null)}
            onNavigateToTool={handleNavigateToTool}
          />
        )}
        {activeScope === "tools" && (
          <ToolsSubView
            navigateToName={navigateToTool}
            onNavigatedTo={() => setNavigateToTool(null)}
          />
        )}
        {activeScope === "specialists" && (
          <SpecialistsSubView
            navigateToId={navigateToSpecialistId}
            onNavigatedTo={() => setNavigateToSpecialistId(null)}
          />
        )}
      </div>
    </div>
  );
}
