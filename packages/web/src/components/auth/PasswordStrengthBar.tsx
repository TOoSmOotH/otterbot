/**
 * Simple password strength indicator without external dependencies.
 * Evaluates length, character variety, and common patterns.
 */
export function getPasswordStrength(password: string): {
  score: number; // 0-4
  label: string;
} {
  if (!password) return { score: 0, label: "" };

  let score = 0;

  // Length-based scoring
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (password.length >= 20) score++;

  // Character variety
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/.test(password);
  const varietyCount = [hasLower, hasUpper, hasDigit, hasSpecial].filter(
    Boolean,
  ).length;
  if (varietyCount >= 3) score++;

  // Cap at 4
  score = Math.min(score, 4);

  // Penalize trivial patterns
  if (/^(.)\1+$/.test(password) || /^(012|123|234|345|456|567|678|789|abc|password|qwerty)/i.test(password)) {
    score = Math.min(score, 1);
  }

  const labels = ["", "Weak", "Fair", "Good", "Strong"];
  return { score, label: labels[score] };
}

const BAR_COLORS = [
  "", // score 0 — not shown
  "bg-red-500",
  "bg-orange-400",
  "bg-yellow-400",
  "bg-green-500",
];

const LABEL_COLORS = [
  "",
  "text-red-500",
  "text-orange-400",
  "text-yellow-400",
  "text-green-500",
];

export function PasswordStrengthBar({ password }: { password: string }) {
  const { score, label } = getPasswordStrength(password);

  if (!password) return null;

  return (
    <div className="space-y-1">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((segment) => (
          <div
            key={segment}
            className={`h-1 flex-1 rounded-full transition-colors ${
              segment <= score ? BAR_COLORS[score] : "bg-muted"
            }`}
          />
        ))}
      </div>
      {label && (
        <p className={`text-xs ${LABEL_COLORS[score]}`}>{label}</p>
      )}
    </div>
  );
}
