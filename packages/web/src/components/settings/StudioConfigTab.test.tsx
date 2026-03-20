import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { StudioConfigBundle } from "@otterbot/shared";

type HookStates = unknown[];

interface RenderOptions {
  hookStates?: HookStates;
  storeOverrides?: Partial<{
    providers: Array<{ id: string; name: string; type: string; apiKeySet?: boolean }>;
    models: Record<string, Array<{ modelId: string; label?: string; source: "discovered" | "custom" }>>;
  }>;
}

async function renderStudioTab(options: RenderOptions = {}) {
  vi.resetModules();

  const hookStates = options.hookStates ?? [];
  const setStateMock = vi.fn();
  const fetchModels = vi.fn();

  const storeState = {
    providers: [],
    models: {},
    fetchModels,
    ...options.storeOverrides,
  };

  vi.doMock("react", async () => {
    const actual = await vi.importActual<typeof import("react")>("react");
    let cursor = 0;

    return {
      ...actual,
      useState: (initial: unknown) => [hookStates[cursor++] ?? initial, setStateMock] as const,
      useEffect: () => undefined,
    };
  });

  vi.doMock("../../stores/settings-store", () => ({
    useSettingsStore: (selector: (s: typeof storeState) => unknown) => selector(storeState),
  }));

  vi.doMock("./ModelCombobox", () => ({
    ModelCombobox: ({ value, placeholder }: { value: string; placeholder?: string }) => (
      <div data-model-combobox>{value || placeholder || ""}</div>
    ),
  }));

  const { StudioConfigTab } = await import("./StudioConfigTab");
  const html = renderToStaticMarkup(<StudioConfigTab />);

  return {
    html,
    fetchModels,
  };
}

describe("StudioConfigTab", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unmock("react");
    vi.unmock("../../stores/settings-store");
    vi.unmock("./ModelCombobox");
  });

  it("explains that Codex is separate from media generation", async () => {
    const bundle: StudioConfigBundle = {
      global: {},
      game: {},
      video: {},
      app: {},
    };

    const { html } = await renderStudioTab({
      hookStates: [
        bundle,
        [],
        { image: "procedural", model: "procedural", sound: "procedural" },
        {},
        false,
        null,
        { game: false, video: false, app: false },
      ],
    });

    expect(html).toContain("Codex is not a media provider in Otterbot.");
    expect(html).toContain("Asset Providers power media");
    expect(html).toContain("Open Coding Agents");
    expect(html).toContain("Coding Agents power code work");
  });

  it("shows global media defaults and credential reuse guidance", async () => {
    const bundle: StudioConfigBundle = {
      global: {
        asset: {
          image: "openai",
          model: "replicate",
          sound: "replicate",
        },
      },
      game: {},
      video: {},
      app: {},
    };

    const { html, fetchModels } = await renderStudioTab({
      hookStates: [
        bundle,
        [
          {
            type: "openai",
            label: "OpenAI (DALL-E / gpt-image)",
            needsApiKey: true,
            needsBaseUrl: false,
            capabilities: ["image", "sprite"],
          },
          {
            type: "replicate",
            label: "Replicate",
            needsApiKey: true,
            needsBaseUrl: false,
            capabilities: ["image", "sprite", "model-3d", "sound"],
          },
          {
            type: "stable-diffusion",
            label: "Stable Diffusion (Local)",
            needsApiKey: false,
            needsBaseUrl: true,
            capabilities: ["image", "sprite"],
          },
          {
            type: "procedural",
            label: "Procedural (No AI)",
            needsApiKey: false,
            needsBaseUrl: false,
            capabilities: ["image", "sprite", "model-3d", "sound"],
          },
        ],
        { image: "procedural", model: "procedural", sound: "procedural" },
        {
          openai: {
            type: "openai",
            dedicatedApiKeySet: false,
            dedicatedBaseUrlSet: false,
            providerApiKeySet: true,
            providerBaseUrlSet: false,
            apiKeyReady: true,
            baseUrlReady: false,
          },
          replicate: {
            type: "replicate",
            dedicatedApiKeySet: true,
            dedicatedBaseUrlSet: false,
            providerApiKeySet: false,
            providerBaseUrlSet: false,
            apiKeyReady: true,
            baseUrlReady: false,
          },
        },
        false,
        null,
        { game: true, video: false, app: false },
      ],
      storeOverrides: {
        providers: [
          { id: "provider-openai", name: "OpenAI Main", type: "openai", apiKeySet: true },
        ],
      },
    });

    expect(fetchModels).not.toHaveBeenCalled();
    expect(html).toContain("Global Studio Defaults");
    expect(html).toContain("Blank inherits the system images &amp; textures provider from Asset Generation.");
    expect(html).toContain("reusing credentials from Providers.");
    expect(html).toContain("If credentials are missing at runtime, Otterbot falls back to Procedural");
  });
});
