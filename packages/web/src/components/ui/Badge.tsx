import type { HTMLAttributes, ReactNode } from "react";

type Tone = "neutral" | "accent" | "success" | "warning" | "info" | "danger";

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: Tone;
  mono?: boolean;
  children: ReactNode;
}

const TONE: Record<Tone, string> = {
  neutral: "bg-neutral-bg text-muted border-border",
  accent: "bg-accent/15 text-accent border-accent/30",
  success: "bg-success-bg text-success border-success/30",
  warning: "bg-warning-bg text-warning border-warning/30",
  info: "bg-info-bg text-info border-info/30",
  danger: "bg-danger-bg text-danger border-danger/30",
};

export function Badge({ tone = "neutral", mono, className, children, ...rest }: BadgeProps) {
  return (
    <span
      {...rest}
      className={`inline-flex items-center gap-1 text-micro uppercase tracking-wide px-1.5 py-0.5 rounded-sm border ${
        TONE[tone]
      } ${mono ? "font-mono normal-case tracking-normal" : ""} ${className ?? ""}`}
    >
      {children}
    </span>
  );
}
