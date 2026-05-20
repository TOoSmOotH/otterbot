import type { HTMLAttributes, ReactNode } from "react";

interface CardProps extends HTMLAttributes<HTMLDivElement> {
  elevated?: boolean;
  children: ReactNode;
}

export function Card({ elevated, className, children, ...rest }: CardProps) {
  return (
    <div
      {...rest}
      className={`rounded-md border border-border p-3 ${
        elevated ? "bg-surface-elevated shadow-sm" : "bg-surface"
      } ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
