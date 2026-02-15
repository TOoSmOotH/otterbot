// ---------------------------------------------------------------------------
// Shared selectors for E2E tests
// ---------------------------------------------------------------------------

// Layout
export const HEADER = "header";
export const BRANDING_TEXT = "Smoothbot";
export const SETTINGS_BUTTON = 'button:has-text("Settings")';
export const LOGOUT_BUTTON = 'button:has-text("Logout")';

// Auth
export const LOGIN_PASSPHRASE_INPUT = 'input[type="password"]';
export const LOGIN_SUBMIT_BUTTON = 'button:has-text("Sign In")';

// Chat
export const CHAT_TEXTAREA = "textarea";
export const CHAT_SEND_BUTTON = 'button[aria-label="Send message"]';

// Graph
export const GRAPH_PANEL = '[data-testid="agent-graph"], [id="graph"]';

// Stream / Message Bus
export const STREAM_PANEL = '[id="stream"]';

// Tab bar
export const TAB_GRAPH = 'button:has-text("Graph")';
export const TAB_CHARTER = 'button:has-text("Charter")';
export const TAB_BOARD = 'button:has-text("Board")';
export const TAB_FILES = 'button:has-text("Files")';
export const TAB_DESKTOP = 'button:has-text("Desktop")';

// Settings modal
export const SETTINGS_MODAL = '[role="dialog"], .fixed.inset-0';
export const SETTINGS_TAB_PROVIDERS = 'button:has-text("Providers")';
export const SETTINGS_TAB_MODELS = 'button:has-text("Models")';
export const SETTINGS_TAB_TEMPLATES = 'button:has-text("Templates")';
export const SETTINGS_TAB_SEARCH = 'button:has-text("Search")';
export const SETTINGS_TAB_SPEECH = 'button:has-text("Speech")';
export const SETTINGS_TAB_OPENCODE = 'button:has-text("OpenCode")';

// Kanban
export const KANBAN_COLUMN_BACKLOG = ':has-text("Backlog")';
export const KANBAN_COLUMN_IN_PROGRESS = ':has-text("In Progress")';
export const KANBAN_COLUMN_DONE = ':has-text("Done")';
