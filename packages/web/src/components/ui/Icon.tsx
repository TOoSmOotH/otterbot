import type { LucideIcon, LucideProps } from "lucide-react";

type IconSize = 14 | 16 | 18;

interface IconProps extends Omit<LucideProps, "size"> {
  icon: LucideIcon;
  size?: IconSize;
}

export function Icon({ icon: LucideComponent, size = 16, strokeWidth = 1.75, ...rest }: IconProps) {
  return <LucideComponent size={size} strokeWidth={strokeWidth} {...rest} />;
}
