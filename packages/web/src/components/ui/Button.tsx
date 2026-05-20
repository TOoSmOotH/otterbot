import type { ButtonHTMLAttributes, ReactNode } from "react";

type Variant = "primary" | "ghost" | "subtle" | "danger";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  loading?: boolean;
}

const VARIANT: Record<Variant, string> = {
  primary:
    "bg-accent text-accent-fg border-accent hover:bg-accent-hover active:bg-accent-hover shadow-sm disabled:opacity-50",
  ghost:
    "bg-transparent text-fg border-border hover:bg-surface hover:border-border-strong disabled:opacity-50",
  subtle:
    "bg-surface text-fg border-border hover:bg-surface-elevated hover:border-border-strong disabled:opacity-50",
  danger:
    "bg-transparent text-danger border-border hover:bg-danger-bg hover:border-danger disabled:opacity-50",
};

const SIZE: Record<Size, string> = {
  sm: "h-7 px-2.5 text-small gap-1.5",
  md: "h-9 px-3.5 text-ui gap-2",
};

export function Button({
  variant = "ghost",
  size = "md",
  iconLeft,
  iconRight,
  loading,
  className,
  children,
  ...rest
}: ButtonProps) {
  const base =
    "inline-flex items-center justify-center font-medium border rounded-md cursor-pointer disabled:cursor-not-allowed select-none";
  return (
    <button
      {...rest}
      className={`${base} ${VARIANT[variant]} ${SIZE[size]} ${className ?? ""}`}
      disabled={rest.disabled || loading}
    >
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
}
