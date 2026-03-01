import type { PasswordStrength } from "../../utils/password-strength";

const COLORS: Record<number, string> = {
  0: "bg-destructive",
  1: "bg-orange-500",
  2: "bg-yellow-500",
  3: "bg-emerald-400",
  4: "bg-green-500",
};

const WIDTHS: Record<number, string> = {
  0: "w-1/5",
  1: "w-2/5",
  2: "w-3/5",
  3: "w-4/5",
  4: "w-full",
};

const LABEL_COLORS: Record<number, string> = {
  0: "text-destructive",
  1: "text-orange-500",
  2: "text-yellow-500",
  3: "text-emerald-400",
  4: "text-green-500",
};

interface StrengthMeterProps {
  strength: PasswordStrength;
}

export function StrengthMeter({ strength }: StrengthMeterProps) {
  return (
    <div className="space-y-1" role="status" aria-live="polite" aria-label={`Password strength: ${strength.label}`}>
      <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${COLORS[strength.score]} ${WIDTHS[strength.score]}`}
        />
      </div>
      <p className={`text-xs ${LABEL_COLORS[strength.score]}`}>
        {strength.label}
      </p>
    </div>
  );
}
