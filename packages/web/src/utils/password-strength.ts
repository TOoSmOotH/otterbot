/**
 * Lightweight password strength scorer.
 *
 * Returns a score 0–4 and a human-readable label.  Uses heuristics similar
 * to zxcvbn without the ~400 KB dependency:
 *   0 = "Very weak"  (< 8 chars or common pattern)
 *   1 = "Weak"
 *   2 = "Fair"
 *   3 = "Good"
 *   4 = "Strong"
 */

const COMMON_PASSWORDS = new Set([
  "password",
  "12345678",
  "123456789",
  "1234567890",
  "qwerty123",
  "password1",
  "iloveyou",
  "abcdefgh",
  "00000000",
  "trustno1",
  "sunshine1",
  "football1",
  "password123",
  "letmein12",
  "welcome1",
]);

export interface PasswordStrength {
  score: 0 | 1 | 2 | 3 | 4;
  label: string;
}

const LABELS: Record<number, string> = {
  0: "Very weak",
  1: "Weak",
  2: "Fair",
  3: "Good",
  4: "Strong",
};

export function scorePassword(password: string): PasswordStrength {
  if (!password || password.length < 8) {
    return { score: 0, label: LABELS[0] };
  }

  if (COMMON_PASSWORDS.has(password.toLowerCase())) {
    return { score: 0, label: LABELS[0] };
  }

  let points = 0;

  // Length bonuses
  if (password.length >= 8) points += 1;
  if (password.length >= 12) points += 1;
  if (password.length >= 16) points += 1;

  // Character class diversity
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigit = /\d/.test(password);
  const hasSpecial = /[^a-zA-Z0-9]/.test(password);
  const classes = [hasLower, hasUpper, hasDigit, hasSpecial].filter(Boolean).length;
  points += classes;

  // Penalize repeating characters (e.g. "aaaaaaaaaa")
  const uniqueChars = new Set(password).size;
  if (uniqueChars <= 3) {
    points = Math.max(points - 3, 0);
  } else if (uniqueChars <= 5) {
    points = Math.max(points - 1, 0);
  }

  // Penalize sequential patterns
  const lower = password.toLowerCase();
  if (/^(.)\1+$/.test(lower)) {
    return { score: 0, label: LABELS[0] };
  }
  if (/^(012|123|234|345|456|567|678|789|abc|bcd|cde|def)/.test(lower)) {
    points = Math.max(points - 1, 0);
  }

  // Map points → score 0–4
  let score: 0 | 1 | 2 | 3 | 4;
  if (points <= 2) score = 0;
  else if (points <= 3) score = 1;
  else if (points <= 4) score = 2;
  else if (points <= 5) score = 3;
  else score = 4;

  return { score, label: LABELS[score] };
}
