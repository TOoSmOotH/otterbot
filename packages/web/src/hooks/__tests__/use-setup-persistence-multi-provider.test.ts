import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const STORAGE_KEY = "otterbot-setup-wizard";

const store = new Map<string, string>();
const mockSessionStorage = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
  removeItem: vi.fn((key: string) => { store.delete(key); }),
  clear: vi.fn(() => { store.clear(); }),
};
vi.stubGlobal("sessionStorage", mockSessionStorage);

const { saveWizardState, loadWizardState } = await import(
  "../use-setup-persistence"
);

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("setup wizard persistence – multi-provider", () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it("persists additionalProviders array alongside scalar fields", () => {
    const providers = [
      { type: "openai", name: "My OpenAI", apiKey: "sk-test" },
      { type: "ollama", name: "Local Ollama", baseUrl: "http://localhost:11434/api" },
    ];
    saveWizardState({
      step: 3,
      provider: "anthropic",
      additionalProviders: providers,
    });
    const loaded = loadWizardState();
    expect(loaded).not.toBeNull();
    expect(loaded!.provider).toBe("anthropic");
    expect(loaded!.additionalProviders).toEqual(providers);
  });

  it("round-trips an empty additionalProviders array", () => {
    saveWizardState({ step: 3, additionalProviders: [] });
    const loaded = loadWizardState();
    expect(loaded!.additionalProviders).toEqual([]);
  });

  it("handles state without additionalProviders (backward compat)", () => {
    saveWizardState({ step: 3, provider: "anthropic" });
    const loaded = loadWizardState();
    expect(loaded!.additionalProviders).toBeUndefined();
  });
});
