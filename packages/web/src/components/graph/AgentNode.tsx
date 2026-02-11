import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "../../lib/utils";
import type { AgentStatus } from "@smoothbot/shared";

interface AgentNodeData {
  label: string;
  role: string;
  status: AgentStatus;
  [key: string]: unknown;
}

const STATUS_COLORS: Record<string, string> = {
  idle: "border-zinc-600 bg-zinc-800",
  thinking: "border-blue-500 bg-blue-500/10",
  acting: "border-emerald-500 bg-emerald-500/10",
  done: "border-zinc-600 bg-zinc-800/50",
  error: "border-red-500 bg-red-500/10",
};

const STATUS_DOT: Record<string, string> = {
  idle: "bg-zinc-500",
  thinking: "bg-blue-500 animate-pulse",
  acting: "bg-emerald-500 animate-pulse",
  done: "bg-zinc-600",
  error: "bg-red-500",
};

const ROLE_ICONS: Record<string, string> = {
  coo: "C",
  team_lead: "TL",
  worker: "W",
};

export const AgentNode = memo(function AgentNode({
  data,
}: NodeProps & { data: AgentNodeData }) {
  const { label, role, status } = data;

  return (
    <div
      className={cn(
        "rounded-lg border-2 px-3 py-2 min-w-[120px] transition-all duration-300",
        STATUS_COLORS[status] ?? STATUS_COLORS.idle,
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-muted-foreground !w-2 !h-2"
      />

      <div className="flex items-center gap-2">
        <div
          className={cn(
            "w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold",
            role === "coo"
              ? "bg-violet-500/30 text-violet-300"
              : role === "team_lead"
                ? "bg-amber-500/30 text-amber-300"
                : "bg-cyan-500/30 text-cyan-300",
          )}
        >
          {ROLE_ICONS[role] ?? "?"}
        </div>
        <div className="flex flex-col">
          <span className="text-xs font-medium leading-none">{label}</span>
          <span className="text-[10px] text-muted-foreground capitalize">
            {role.replace("_", " ")}
          </span>
        </div>
        <div
          className={cn(
            "w-2 h-2 rounded-full ml-auto",
            STATUS_DOT[status] ?? STATUS_DOT.idle,
          )}
        />
      </div>

      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-muted-foreground !w-2 !h-2"
      />
    </div>
  );
});
