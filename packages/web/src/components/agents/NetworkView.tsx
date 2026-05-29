import { useState } from "react";
import { Building2, Network } from "lucide-react";
import { Tabs, type TabSpec } from "../ui/Tabs";
import { AgentNetworkGraph } from "./AgentNetworkGraph";
import { AgentOffice } from "./AgentOffice";

/**
 * The Network view hosts two sub-tabs: "Permissions" (the editable agent-to-agent
 * permission graph) and "Office" (a live 2D scene of the agents working). Each is
 * conditionally mounted so the Office's socket/observer effects clean up when the
 * user switches away.
 */
type NetTab = "permissions" | "office";

const TABS: TabSpec<NetTab>[] = [
  { id: "permissions", label: "Permissions", icon: Network },
  { id: "office", label: "Office", icon: Building2 },
];

export function NetworkView() {
  const [tab, setTab] = useState<NetTab>("permissions");
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <Tabs tabs={TABS} value={tab} onChange={setTab} layoutId="network-subtabs" />
      <div style={{ flex: 1, minHeight: 0 }}>
        {tab === "permissions" && <AgentNetworkGraph />}
        {tab === "office" && <AgentOffice />}
      </div>
    </div>
  );
}
