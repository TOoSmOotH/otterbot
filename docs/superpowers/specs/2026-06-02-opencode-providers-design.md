# OpenCode: configured providers + opencode-go (no native login)

## Problem

OpenCode runs only resolve models that opencode itself knows about (its native
models.dev providers + whatever `opencode auth login` stored). Otterbot's
configured providers — local LM Studio / Ollama / openai-compatible endpoints —
are invisible to opencode, so a coding-model preset like `lmstudio/qwen3-coder-30b`
passes `-m lmstudio/...` and fails with "Provider not found". Separately,
opencode-go (the gateway) only works because of a one-off `opencode auth login`,
and its models can't be picked from the coding-preset UI.

## Goal

Every model from a configured Otterbot provider — including the opencode-go
gateway — is runnable by opencode and selectable in the coding-model preset
dropdown, with no opencode-native login. One provider list drives everything.

## Key facts (verified on the live box)

- `OPENCODE_CONFIG=<file>` is honored; a `provider.<id>` entry using
  `@ai-sdk/openai-compatible` makes opencode resolve `-m <id>/<model>`.
- That provider **live-fetches `/v1/models`** from the endpoint, so the config
  needs only the provider definition (baseURL + apiKey), not a model list.
- opencode-go is a plain OpenAI-compatible endpoint:
  `https://opencode.ai/zen/go/v1` (and OpenCode Zen at `.../zen/v1`); `/models`
  returns 17 models with the Bearer key. npm `@ai-sdk/openai-compatible`.

## Design

### 1. opencode-go / opencode-zen as built-in providers (`providers/catalog.ts`)

Add two recognized OpenAI-compatible providers:
- `opencode-go` — "OpenCode Zen (Go)", default baseURL `https://opencode.ai/zen/go/v1`.
- `opencode-zen` — "OpenCode Zen", default baseURL `https://opencode.ai/zen/v1`.

Both `supportsChat: true`, key stored like other providers' secrets. On startup,
**migrate** any existing key from `data/coding-cli-auth/opencode/auth.json`
(`opencode-go.key`) into the `opencode-go` provider's secret if that provider has
no key yet, so nothing must be re-entered.

### 2. Generated opencode config (`integrations/opencode-config.ts`, new)

`buildOpencodeConfig(settings) → { $schema, provider: Record<string, …> }`.
For each configured provider account whose endpoint is OpenAI-compatible and has
a non-empty baseURL (resolved via the existing `catalog.ts` endpoint resolvers),
emit:

```json
"<id>": {
  "npm": "@ai-sdk/openai-compatible",
  "name": "<label>",
  "options": { "baseURL": "<baseUrl>", "apiKey": "<apiKey-or-dummy>" }
}
```

- Only configured providers (mirror the user's list); skip empty baseURLs and
  non-OpenAI-compatible providers (anthropic).
- One opencode provider id per Otterbot provider id; when a provider has multiple
  accounts, pick the first with a usable baseURL (matches the preset UI, which
  stores only `provider/model`).
- No model enumeration — opencode live-fetches `/v1/models`.

`writeOpencodeConfig()` serializes it to
`data/coding-cli-auth/opencode/otter.json`. Called on startup and whenever global
settings are saved (`PUT /api/settings/global`).

### 3. Run wiring (`integrations/shell.ts` / `integrations/coding-cli.ts`)

For opencode runs only, set `OPENCODE_CONFIG=/workspace/.local/share/opencode/otter.json`
in the sandbox env (that dir is already bind-mounted). Auth comes entirely from
the generated config.

### 4. Remove opencode native login (`lib/coding-cli.ts`, login UI)

Drop the `opencode: "opencode auth login"` entry from `CODING_LOGIN_CMDS` and the
opencode login affordance; replace with guidance to configure the OpenCode Zen
provider in Settings → Providers. Other tools (claude/codex/gemini) keep their
own login — they're subscription OAuth, not API keys.

### 5. Unified model dropdown (`components/settings/CodingModelsTab.tsx`)

Replace the pick-provider-then-"List models" flow in `OpencodeFields` with one
dropdown listing `provider/model` across **all** configured providers, plus
free-text fallback. Backed by a new `GET /api/coding/opencode-models` endpoint:
server iterates configured chat providers, lists each provider's models
(reusing `listModels`), returns a flat, grouped `{ provider, model }[]`.
opencode-go and local models appear because they're configured providers.

## Data flow

Providers tab (incl. opencode-go key) → settings save → regenerate `otter.json`
→ opencode run sets `OPENCODE_CONFIG` → `-m <provider>/<model>` resolves against
the configured endpoint and its live `/v1/models`.

## Error handling

- Keyless local endpoints get a dummy apiKey (existing `"lm-studio"`/`"ollama"`
  defaults); opencode-compatible providers require a non-empty key string.
- Unreachable endpoint → opencode errors, now visible in the captured transcript.
- Empty/duplicate/non-compatible providers are skipped during generation.

## Testing

- Unit: `buildOpencodeConfig` — configured providers → expected config; skips
  empty baseURLs and anthropic; dummy key for keyless local.
- Unit: opencode-go/zen catalog entries resolve their default baseURLs.
- Live: create an opencode-go preset (`glm-5.1`) and an `lmstudio` preset, pin to
  agents, run tasks; confirm the captured transcript shows the right model and
  the work completes.

## Out of scope (YAGNI)

- Per-account namespacing of opencode providers (one endpoint per provider id).
- Caching of provider model lists beyond the per-call fetch.
- Bridging non-OpenAI-compatible providers (anthropic) — opencode handles those
  natively if ever needed.
