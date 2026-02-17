import { useState, useEffect, useRef } from "react";
import { useSettingsStore } from "../../stores/settings-store";
import { SettingsNav } from "./SettingsNav";
import { AppearanceTab } from "./AppearanceTab";
import { ProvidersTab } from "./ProvidersTab";
import { ModelsTab } from "./ModelsTab";
import { AgentTemplatesTab } from "./AgentTemplatesTab";
import { SearchTab } from "./SearchTab";
import { SpeechTab } from "./SpeechTab";
import { LiveViewTab } from "./LiveViewTab";
import { OpenCodeTab } from "./OpenCodeTab";
import { PricingTab } from "./PricingTab";
import { ProfileSection } from "./ProfileSection";
import { SystemSection } from "./SystemSection";
import { ChannelsSection } from "./ChannelsSection";
import { ScheduledTasksSection } from "./ScheduledTasksSection";
import { EmailSection } from "./EmailSection";
import { SkillsCenterSection } from "./SkillsCenterSection";
import { GitHubTab } from "./GitHubTab";
import { SecuritySection } from "./SecuritySection";
import type { SettingsSection } from "./settings-nav";

interface SettingsPageProps {
  onClose: () => void;
}

export function SettingsPage({ onClose }: SettingsPageProps) {
  const [activeSection, setActiveSection] = useState<SettingsSection>("profile");
  const loadSettings = useSettingsStore((s) => s.loadSettings);
  const loading = useSettingsStore((s) => s.loading);
  const contentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    loadSettings();
  }, []);

  // Reset scroll on section change
  useEffect(() => {
    contentRef.current?.scrollTo(0, 0);
  }, [activeSection]);

  const renderContent = () => {
    if (activeSection === "appearance") return <AppearanceTab />;
    if (activeSection === "profile") return <ProfileSection />;
    if (activeSection === "system") return <SystemSection />;
    if (activeSection === "channels") return <ChannelsSection />;
    if (activeSection === "scheduled") return <ScheduledTasksSection />;
    if (activeSection === "email") return <EmailSection />;
    if (activeSection === "skills") return <SkillsCenterSection />;
    if (activeSection === "github") return <GitHubTab />;
    if (activeSection === "security") return <SecuritySection />;

    // AI & Features tabs need settings loaded first
    if (loading) {
      return (
        <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
          Loading settings...
        </div>
      );
    }

    switch (activeSection) {
      case "providers":
        return <ProvidersTab />;
      case "models":
        return <ModelsTab />;
      case "templates":
        return <AgentTemplatesTab />;
      case "pricing":
        return <PricingTab />;
      case "search":
        return <SearchTab />;
      case "speech":
        return <SpeechTab />;
      case "liveview":
        return <LiveViewTab />;
      case "opencode":
        return <OpenCodeTab />;
      default:
        return null;
    }
  };

  return (
    <div className="flex-1 flex overflow-hidden">
      <SettingsNav
        activeSection={activeSection}
        onSelect={setActiveSection}
        onBack={onClose}
      />
      <div ref={contentRef} className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto">
          {renderContent()}
        </div>
      </div>
    </div>
  );
}
