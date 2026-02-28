import { memo } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import { cn } from "../../lib/utils";
import type { AgentStatus } from "@otterbot/shared";

interface AgentNodeData {
  label: string;
  role: string;
  status: AgentStatus;
  avatarUrl?: string;
  onClick?: () => void;
  [key: string]: unknown;
}

const STATUS_COLORS: Record<string, string> = {
  idle: "border-zinc-600 bg-zinc-800",
  thinking: "border-blue-500 bg-blue-500/10 shadow-[0_0_12px_rgba(59,130,246,0.3)]",
  acting: "border-emerald-500 bg-emerald-500/10 shadow-[0_0_12px_rgba(16,185,129,0.3)]",
  awaiting_input: "border-orange-500 bg-orange-500/10 shadow-[0_0_12px_rgba(249,115,22,0.3)]",
  done: "border-zinc-600 bg-zinc-800/50",
  error: "border-red-500 bg-red-500/10 shadow-[0_0_12px_rgba(239,68,68,0.3)]",
};

const STATUS_DOT: Record<string, string> = {
  idle: "bg-zinc-500",
  thinking: "bg-blue-500 animate-pulse",
  acting: "bg-emerald-500 animate-pulse",
  awaiting_input: "bg-orange-500 animate-pulse",
  done: "bg-zinc-600",
  error: "bg-red-500",
};

const STATUS_LABEL: Record<string, { text: string; className: string } | null> = {
  idle: null,
  thinking: { text: "Thinking...", className: "text-blue-400" },
  acting: { text: "Executing tool...", className: "text-emerald-400" },
  awaiting_input: { text: "Awaiting input...", className: "text-orange-400" },
  done: null,
  error: { text: "Error", className: "text-red-400" },
};

const ROLE_ICONS: Record<string, string> = {
  ceo: "U",
  coo: "C",
  team_lead: "TL",
  worker: "W",
  scheduler: "S",
  admin_assistant: "A",
  module_agent: "M",
};

export const AgentNode = memo(function AgentNode({
  data,
}: NodeProps & { data: AgentNodeData }) {
  const { label, role, status, avatarUrl, onClick } = data;
  const statusLabel = STATUS_LABEL[status] ?? null;

  return (
    <div
      onClick={onClick}
      className={cn(
        "rounded-lg border-2 px-3 py-2 min-w-[120px] max-w-[180px] transition-all duration-300 cursor-pointer hover:brightness-125",
        STATUS_COLORS[status] ?? STATUS_COLORS.idle,
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!bg-muted-foreground !w-2 !h-2"
      />

      <div className="flex items-center gap-2">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt={label}
            className="w-6 h-6 rounded-md object-cover"
          />
        ) : (
          <div
            className={cn(
              "w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-bold",
              role === "ceo"
                ? "bg-primary/30 text-primary"
                : role === "coo"
                  ? "bg-violet-500/30 text-violet-300"
                  : role === "team_lead"
                    ? "bg-amber-500/30 text-amber-300"
                    : role === "scheduler"
                      ? "bg-rose-500/30 text-rose-300"
                      : role === "admin_assistant"
                        ? "bg-teal-500/30 text-teal-300"
                        : role === "module_agent"
                          ? "bg-indigo-500/30 text-indigo-300"
                          : "bg-cyan-500/30 text-cyan-300",
            )}
          >
            {ROLE_ICONS[role] ?? "?"}
          </div>
        )}
        <div className="flex flex-col">
          <span className="text-xs font-medium leading-none truncate" title={label}>{label}</span>
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

      {statusLabel && (
        <div className={cn("text-[10px] mt-1 text-center animate-pulse", statusLabel.className)}>
          {statusLabel.text}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        className="!bg-muted-foreground !w-2 !h-2"
      />
    </div>
  );
});
