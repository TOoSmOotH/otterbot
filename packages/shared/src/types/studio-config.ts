/** Studio types supported by the system. */
export type StudioType = "game" | "video" | "app";

/** Configuration for a single studio scope (global or per-studio). */
export interface StudioConfig {
  llm?: {
    provider?: string; // provider row ID from providers table
    model?: string; // model identifier
  };
  tools?: {
    disabled?: string[]; // tool names to disable
  };
  asset?: {
    image?: string; // asset provider type override
    model?: string; // 3D model provider override
    sound?: string; // sound provider override
  };
}

/** Full studio configuration bundle returned by the API. */
export interface StudioConfigBundle {
  global: StudioConfig;
  game: StudioConfig;
  video: StudioConfig;
  app: StudioConfig;
}

/** Resolved studio config after merging studio-specific → global → system defaults. */
export interface ResolvedStudioConfig {
  llm: {
    provider: string;
    model: string;
  };
  disabledTools: string[];
  asset: {
    image: string;
    model: string;
    sound: string;
  };
}

/** All known tool names per studio type, used for UI toggles. */
export const STUDIO_TOOLS: Record<StudioType, string[]> = {
  game: [
    "game_create",
    "game_build",
    "game_preview",
    "game_list",
    "game_list_templates",
    "game_gen_texture",
    "game_gen_sprite",
    "game_gen_model",
    "game_gen_sound",
    "game_playtest",
    "game_inspect",
  ],
  video: [
    "video_create",
    "video_list",
    "video_add_scene",
    "video_gen_narration",
    "video_record_scene",
    "video_render",
    "video_gen_music",
    "video_add_audio",
  ],
  app: [
    "app_create",
    "app_build",
    "app_preview",
    "app_list",
    "app_list_templates",
    "app_gen_asset",
    "app_test_responsive",
    "app_test_a11y",
    "app_deploy",
  ],
};

/** Human-readable labels for tool names. */
export const STUDIO_TOOL_LABELS: Record<string, string> = {
  game_create: "Create Game",
  game_build: "Build Game",
  game_preview: "Preview Game",
  game_list: "List Games",
  game_list_templates: "List Templates",
  game_gen_texture: "Generate Texture",
  game_gen_sprite: "Generate Sprite",
  game_gen_model: "Generate 3D Model",
  game_gen_sound: "Generate Sound",
  game_playtest: "Playtest",
  game_inspect: "Inspect Game",
  video_create: "Create Video",
  video_list: "List Videos",
  video_add_scene: "Add Scene",
  video_gen_narration: "Generate Narration",
  video_record_scene: "Record Scene",
  video_render: "Render Video",
  video_gen_music: "Generate Music",
  video_add_audio: "Add Audio",
  app_create: "Create App",
  app_build: "Build App",
  app_preview: "Preview App",
  app_list: "List Apps",
  app_list_templates: "List Templates",
  app_gen_asset: "Generate Asset",
  app_test_responsive: "Test Responsive",
  app_test_a11y: "Test Accessibility",
  app_deploy: "Deploy App",
};

/** Human-readable labels for studio types. */
export const STUDIO_TYPE_LABELS: Record<StudioType, string> = {
  game: "Game Studio",
  video: "Video Studio",
  app: "App Studio",
};
