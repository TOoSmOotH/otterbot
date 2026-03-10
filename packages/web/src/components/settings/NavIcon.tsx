import { cn } from "../../lib/utils";
import { getIconPaths, type NavIconId } from "./settings-nav";

interface NavIconProps {
  icon: NavIconId;
  size?: number;
  className?: string;
  /** Use fill instead of stroke (for brand icons like Discord) */
  filled?: boolean;
}

export function NavIcon({ icon, size = 14, className, filled }: NavIconProps) {
  const paths = getIconPaths(icon);
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? "currentColor" : "none"}
      stroke={filled ? "none" : "currentColor"}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={cn("shrink-0", className)}
    >
      {paths.map((d, i) => (
        <path key={i} d={d} />
      ))}
    </svg>
  );
}
