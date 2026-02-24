import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";

const STORAGE_KEY = "otterbot-setup-wizard";

// Provide a minimal sessionStorage mock for the Node test environment
const store = new Map<string, string>();
const mockSessionStorage = {
  getItem: vi.fn((key: string) => store.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => { store.set(key, value); }),
  removeItem: vi.fn((key: string) => { store.delete(key); }),
  clear: vi.fn(() => { store.clear(); }),
};
vi.stubGlobal("sessionStorage", mockSessionStorage);

// Import after stubbing global
const { saveWizardState, loadWizardState, clearWizardState } = await import(
  "../use-setup-persistence"
);

afterAll(() => {
  vi.unstubAllGlobals();
});

describe("setup wizard persistence", () => {
  beforeEach(() => {
    store.clear();
    vi.clearAllMocks();
  });

  it("saves state to sessionStorage", () => {
    saveWizardState({ step: 3, provider: "anthropic" });
    const raw = sessionStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ step: 3, provider: "anthropic" });
  });

  it("returns null when nothing is saved", () => {
    expect(loadWizardState()).toBeNull();
  });

  it("returns parsed state on load", () => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({ step: 5, cooName: "Atlas" }));
    expect(loadWizardState()).toEqual({ step: 5, cooName: "Atlas" });
  });

  it("excludes passphrase and confirmPassphrase from saved data", () => {
    saveWizardState({
      step: 2,
      provider: "openai",
      passphrase: "secret123",
      confirmPassphrase: "secret123",
    });
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY)!);
    expect(saved).toEqual({ step: 2, provider: "openai" });
    expect(saved.passphrase).toBeUndefined();
    expect(saved.confirmPassphrase).toBeUndefined();
  });

  it("excludes transient UI state keys", () => {
    saveWizardState({
      step: 2,
      submitting: true,
      fetchingModels: true,
      fetchedModels: ["gpt-4o"],
      modelDropdownOpen: true,
      modelFilter: "gpt",
      draggingOver: false,
      previewingVoice: false,
    });
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY)!);
    expect(saved).toEqual({ step: 2 });
  });

  it("clearWizardState removes the key", () => {
    saveWizardState({ step: 4 });
    expect(sessionStorage.getItem(STORAGE_KEY)).not.toBeNull();
    clearWizardState();
    expect(sessionStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("returns null on corrupt JSON without throwing", () => {
    sessionStorage.setItem(STORAGE_KEY, "not-valid-json{{{");
    expect(() => loadWizardState()).not.toThrow();
    expect(loadWizardState()).toBeNull();
  });

  it("returns null if stored value is not an object", () => {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify("just a string"));
    expect(loadWizardState()).toBeNull();

    sessionStorage.setItem(STORAGE_KEY, JSON.stringify([1, 2, 3]));
    expect(loadWizardState()).toBeNull();
  });
});
