const STORAGE_KEY = "otterbot-setup-wizard";

const EXCLUDED_KEYS = new Set([
  "passphrase",
  "confirmPassphrase",
  "submitting",
  "fetchingModels",
  "fetchedModels",
  "modelDropdownOpen",
  "modelFilter",
  "draggingOver",
  "previewingVoice",
  "openCodeFetchingModels",
  "openCodeFetchedModels",
  "openCodeModelDropdownOpen",
  "openCodeModelFilter",
]);

export function saveWizardState(state: Record<string, unknown>): void {
  const filtered: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(state)) {
    if (!EXCLUDED_KEYS.has(key)) {
      filtered[key] = value;
    }
  }
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
  } catch {
    // Silently fail if sessionStorage is full or unavailable
  }
}

export function loadWizardState(): Record<string, unknown> | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function clearWizardState(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Silently fail
  }
}
