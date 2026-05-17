/**
 * The Hermes Agent skill catalog.
 *
 * Source: https://hermes-agent.nousresearch.com/docs/skills/ — the skills live
 * in the public `NousResearch/hermes-agent` repo. There are two packs:
 *   - `builtin`  → `skills/<category>/<id>/SKILL.md`
 *   - `optional` → `optional-skills/<category>/<id>/SKILL.md`
 *
 * This file is an index only: each entry carries enough to render the gallery,
 * and the skill body is fetched from GitHub on demand when a user installs it
 * onto an agent (see `catalogSkillUrl`). Hermes's own `hermes-agent` skill is
 * intentionally omitted — it configures Hermes itself, not a portable
 * capability.
 */

/** Which Hermes pack a skill belongs to. */
export type SkillPack = "builtin" | "optional";

/** Why a skill may not run in a given environment — surfaced as a gallery badge. */
export type SkillRequirement = "macos" | "heavy";

export interface CatalogSkill {
  /** Slug — matches the skill's directory name in the repo. */
  id: string;
  /** Top-level category, used for the gallery filter. */
  category: string;
  description: string;
  pack: SkillPack;
  /** Set when the skill needs a specific OS or heavy local software. */
  requires?: SkillRequirement;
  /**
   * Path under the pack directory when the skill is nested deeper than
   * `<category>/<id>/` — e.g. `mlops/training` for `optional-skills/mlops/training/axolotl/`.
   */
  subdir?: string;
}

/** A catalog entry before its `pack` is stamped on. */
type RawSkill = Omit<CatalogSkill, "pack">;

const REPO = "NousResearch/hermes-agent";
const BRANCH = "main";

/** Raw GitHub URL of a catalog skill's `SKILL.md`. */
export function catalogSkillUrl(skill: CatalogSkill): string {
  const packDir = skill.pack === "optional" ? "optional-skills" : "skills";
  const dir = skill.subdir ?? skill.category;
  return `https://raw.githubusercontent.com/${REPO}/${BRANCH}/${packDir}/${dir}/${skill.id}/SKILL.md`;
}

/** Built-in skills — installed into every Hermes agent by default upstream. */
const BUILTIN: RawSkill[] = [
  // --- apple (macOS only) ---
  { id: "apple-notes", category: "apple", requires: "macos", description: "Manage Apple Notes via the memo CLI: create, search, edit." },
  { id: "apple-reminders", category: "apple", requires: "macos", description: "Apple Reminders via remindctl: add, list, complete." },
  { id: "findmy", category: "apple", requires: "macos", description: "Track Apple devices and AirTags via FindMy.app on macOS." },
  { id: "imessage", category: "apple", requires: "macos", description: "Send and receive iMessages/SMS via the imsg CLI on macOS." },
  { id: "macos-computer-use", category: "apple", requires: "macos", description: "Drive the macOS desktop in the background — screenshots, mouse, keyboard, scroll, drag." },

  // --- autonomous-ai-agents ---
  { id: "claude-code", category: "autonomous-ai-agents", description: "Delegate coding to the Claude Code CLI (features, PRs)." },
  { id: "codex", category: "autonomous-ai-agents", description: "Delegate coding to the OpenAI Codex CLI (features, PRs)." },
  { id: "opencode", category: "autonomous-ai-agents", description: "Delegate coding to the OpenCode CLI (features, PR review)." },

  // --- creative ---
  { id: "architecture-diagram", category: "creative", description: "Dark-themed SVG architecture / cloud / infra diagrams as HTML." },
  { id: "ascii-art", category: "creative", description: "ASCII art: pyfiglet, cowsay, boxes, image-to-ascii." },
  { id: "ascii-video", category: "creative", description: "ASCII video: convert video/audio to coloured ASCII MP4/GIF." },
  { id: "baoyu-comic", category: "creative", description: "Knowledge comics: educational, biography, and tutorial strips." },
  { id: "baoyu-infographic", category: "creative", description: "Infographics: 21 layouts × 21 styles." },
  { id: "claude-design", category: "creative", description: "Design one-off HTML artifacts (landing pages, decks, prototypes)." },
  { id: "comfyui", category: "creative", requires: "heavy", description: "Generate images, video, and audio with a local ComfyUI install." },
  { id: "design-md", category: "creative", description: "Author, validate, and export Google's DESIGN.md design-token specs." },
  { id: "excalidraw", category: "creative", description: "Hand-drawn Excalidraw JSON diagrams (architecture, flow, sequence)." },
  { id: "humanizer", category: "creative", description: "Humanize text: strip AI-isms and add a real voice." },
  { id: "ideation", category: "creative", description: "Generate project ideas via creative constraints." },
  { id: "manim-video", category: "creative", requires: "heavy", description: "Manim CE animations: 3Blue1Brown-style math/algorithm videos." },
  { id: "p5js", category: "creative", description: "p5.js sketches: generative art, shaders, interactive, 3D." },
  { id: "pixel-art", category: "creative", description: "Pixel art with era palettes (NES, Game Boy, PICO-8)." },
  { id: "popular-web-designs", category: "creative", description: "54 real design systems (Stripe, Linear, Vercel) as HTML/CSS." },
  { id: "pretext", category: "creative", description: "Build creative browser demos with @chenglou/pretext." },
  { id: "sketch", category: "creative", description: "Throwaway HTML mockups: 2–3 design variants to compare." },
  { id: "songwriting-and-ai-music", category: "creative", description: "Songwriting craft and Suno AI music prompts." },
  { id: "touchdesigner-mcp", category: "creative", requires: "heavy", description: "Control a running TouchDesigner instance via the twozero MCP." },

  // --- data-science ---
  { id: "jupyter-live-kernel", category: "data-science", description: "Iterative Python against a live Jupyter kernel." },

  // --- devops ---
  { id: "kanban-orchestrator", category: "devops", description: "Decomposition playbook and anti-temptation rules for orchestrator agents." },
  { id: "kanban-worker", category: "devops", description: "Pitfalls, examples, and edge cases for Hermes Kanban workers." },
  { id: "webhook-subscriptions", category: "devops", description: "Webhook subscriptions: event-driven agent runs." },

  // --- dogfood ---
  { id: "dogfood", category: "dogfood", description: "Exploratory QA of web apps: find bugs, gather evidence, write reports." },

  // --- email ---
  { id: "himalaya", category: "email", description: "Himalaya CLI: IMAP/SMTP email from the terminal." },

  // --- gaming ---
  { id: "minecraft-modpack-server", category: "gaming", requires: "heavy", description: "Host modded Minecraft servers (CurseForge, Modrinth)." },
  { id: "pokemon-player", category: "gaming", requires: "heavy", description: "Play Pokémon via a headless emulator and RAM reads." },

  // --- github ---
  { id: "codebase-inspection", category: "github", description: "Inspect codebases with pygount: LOC, languages, ratios." },
  { id: "github-auth", category: "github", description: "GitHub auth setup: HTTPS tokens, SSH keys, gh CLI login." },
  { id: "github-code-review", category: "github", description: "Review PRs: diffs and inline comments via gh or REST." },
  { id: "github-issues", category: "github", description: "Create, triage, label, and assign GitHub issues via gh or REST." },
  { id: "github-pr-workflow", category: "github", description: "GitHub PR lifecycle: branch, commit, open, CI, merge." },
  { id: "github-repo-management", category: "github", description: "Clone, create, and fork repos; manage remotes and releases." },

  // --- mcp ---
  { id: "native-mcp", category: "mcp", description: "MCP client: connect servers and register tools (stdio/HTTP)." },

  // --- media ---
  { id: "gif-search", category: "media", description: "Search and download GIFs from Tenor via curl + jq." },
  { id: "heartmula", category: "media", requires: "heavy", description: "HeartMuLa: Suno-like song generation from lyrics and tags." },
  { id: "songsee", category: "media", description: "Audio spectrograms and features (mel, chroma, MFCC) via CLI." },
  { id: "spotify", category: "media", description: "Spotify: play, search, queue, and manage playlists and devices." },
  { id: "youtube-content", category: "media", description: "Turn YouTube transcripts into summaries, threads, and blogs." },

  // --- mlops ---
  { id: "audiocraft-audio-generation", category: "mlops", requires: "heavy", description: "AudioCraft: MusicGen text-to-music, AudioGen text-to-sound." },
  { id: "dspy", category: "mlops", description: "DSPy: declarative LM programs, auto-optimised prompts, RAG." },
  { id: "evaluating-llms-harness", category: "mlops", requires: "heavy", description: "lm-eval-harness: benchmark LLMs (MMLU, GSM8K, and more)." },
  { id: "huggingface-hub", category: "mlops", description: "HuggingFace hf CLI: search, download, and upload models and datasets." },
  { id: "llama-cpp", category: "mlops", requires: "heavy", description: "llama.cpp local GGUF inference plus HF Hub model discovery." },
  { id: "obliteratus", category: "mlops", requires: "heavy", description: "OBLITERATUS: abliterate LLM refusals (diff-in-means)." },
  { id: "segment-anything-model", category: "mlops", requires: "heavy", description: "SAM: zero-shot image segmentation via points, boxes, masks." },
  { id: "serving-llms-vllm", category: "mlops", requires: "heavy", description: "vLLM: high-throughput LLM serving, OpenAI API, quantization." },
  { id: "weights-and-biases", category: "mlops", description: "Weights & Biases: log ML experiments, sweeps, model registry." },

  // --- note-taking ---
  { id: "obsidian", category: "note-taking", description: "Read, search, create, and edit notes in an Obsidian vault." },

  // --- productivity ---
  { id: "airtable", category: "productivity", description: "Airtable REST API via curl: record CRUD, filters, upserts." },
  { id: "google-workspace", category: "productivity", description: "Gmail, Calendar, Drive, Docs, and Sheets via the gws CLI or Python." },
  { id: "linear", category: "productivity", description: "Linear: manage issues, projects, and teams via GraphQL + curl." },
  { id: "maps", category: "productivity", description: "Geocode, find POIs, route, and look up timezones via OpenStreetMap/OSRM." },
  { id: "nano-pdf", category: "productivity", description: "Edit PDF text, typos, and titles via the nano-pdf CLI." },
  { id: "notion", category: "productivity", description: "Notion API and ntn CLI: pages, databases, markdown." },
  { id: "ocr-and-documents", category: "productivity", description: "Extract text from PDFs and scans (pymupdf, marker-pdf)." },
  { id: "powerpoint", category: "productivity", description: "Create, read, and edit .pptx decks, slides, notes, and templates." },
  { id: "teams-meeting-pipeline", category: "productivity", description: "Operate the Teams meeting-summary pipeline via the Hermes CLI." },

  // --- red-teaming ---
  { id: "godmode", category: "red-teaming", description: "Jailbreak techniques for LLMs: Parseltongue, GODMODE, ULTRAPLINIAN." },

  // --- research ---
  { id: "arxiv", category: "research", description: "Search arXiv papers by keyword, author, category, or ID." },
  { id: "blogwatcher", category: "research", description: "Monitor blogs and RSS/Atom feeds via the blogwatcher CLI." },
  { id: "llm-wiki", category: "research", description: "Karpathy's LLM Wiki: build and query an interlinked markdown KB." },
  { id: "polymarket", category: "research", description: "Query Polymarket: markets, prices, orderbooks, history." },
  { id: "research-paper-writing", category: "research", description: "Write ML papers for NeurIPS/ICML/ICLR: design through submission." },

  // --- smart-home ---
  { id: "openhue", category: "smart-home", description: "Control Philips Hue lights, scenes, and rooms via the OpenHue CLI." },

  // --- social-media ---
  { id: "xurl", category: "social-media", description: "X/Twitter via the xurl CLI: post, search, DM, media, v2 API." },

  // --- software-development ---
  { id: "debugging-hermes-tui-commands", category: "software-development", description: "Debug Hermes TUI slash commands: Python, gateway, Ink UI." },
  { id: "hermes-agent-skill-authoring", category: "software-development", description: "Author in-repo SKILL.md files: frontmatter, validator, structure." },
  { id: "node-inspect-debugger", category: "software-development", description: "Debug Node.js via --inspect and the Chrome DevTools Protocol." },
  { id: "plan", category: "software-development", description: "Plan mode: write a markdown plan, no execution." },
  { id: "python-debugpy", category: "software-development", description: "Debug Python: pdb REPL plus debugpy remote (DAP)." },
  { id: "requesting-code-review", category: "software-development", description: "Pre-commit review: security scan, quality gates, auto-fix." },
  { id: "spike", category: "software-development", description: "Throwaway experiments to validate an idea before building." },
  { id: "subagent-driven-development", category: "software-development", description: "Execute plans via delegated subagents with two-stage review." },
  { id: "systematic-debugging", category: "software-development", description: "Four-phase root-cause debugging: understand bugs before fixing." },
  { id: "test-driven-development", category: "software-development", description: "TDD: enforce RED-GREEN-REFACTOR, tests before code." },
  { id: "writing-plans", category: "software-development", description: "Write implementation plans: bite-sized tasks, paths, code." },

  // --- yuanbao ---
  { id: "yuanbao", category: "yuanbao", description: "Yuanbao groups: @mention users, query info and members." },
];

/** Optional skills — not installed by default upstream; opt-in capabilities. */
const OPTIONAL: RawSkill[] = [
  // --- autonomous-ai-agents ---
  { id: "blackbox", category: "autonomous-ai-agents", description: "Delegate coding to the Blackbox AI CLI agent, with multi-model support and a built-in judge." },
  { id: "honcho", category: "autonomous-ai-agents", description: "Honcho memory: cross-session user modeling with context-budget enforcement." },

  // --- blockchain ---
  { id: "evm", category: "blockchain", description: "Read-only EVM client for wallets, tokens, and gas across 8 chains." },
  { id: "hyperliquid", category: "blockchain", description: "Hyperliquid market data, account history, and trade review." },
  { id: "solana", category: "blockchain", description: "Query the Solana blockchain — wallets, tokens, transactions, NFTs — with USD pricing." },

  // --- communication ---
  { id: "one-three-one-rule", category: "communication", description: "A structured decision framework for technical proposals and trade-off analysis." },

  // --- creative ---
  { id: "blender-mcp", category: "creative", requires: "heavy", description: "Control Blender from the agent over a socket to create 3D objects and animations." },
  { id: "concept-diagrams", category: "creative", description: "Flat, minimal SVG concept diagrams as standalone HTML with semantic colour ramps." },
  { id: "hyperframes", category: "creative", description: "HTML-based video compositions, animated titles, and audio-reactive visuals." },
  { id: "kanban-video-orchestrator", category: "creative", description: "Plan and monitor multi-agent video production pipelines via Hermes Kanban." },
  { id: "meme-generation", category: "creative", description: "Generate meme images: pick templates and overlay text with Pillow." },

  // --- devops ---
  { id: "cli", category: "devops", description: "Run 150+ AI apps via the inference.sh CLI — image/video generation and LLMs." },
  { id: "docker-management", category: "devops", description: "Manage Docker containers, images, volumes, networks, and Compose stacks." },
  { id: "pinggy-tunnel", category: "devops", description: "Zero-install localhost tunnels over SSH via Pinggy." },
  { id: "watchers", category: "devops", description: "Poll RSS, JSON APIs, and GitHub with watermark deduplication." },

  // --- dogfood ---
  { id: "adversarial-ux-test", category: "dogfood", description: "Roleplay difficult users to surface UX pain points and file actionable tickets." },

  // --- email ---
  { id: "agentmail", category: "email", description: "Give an agent a dedicated email inbox with autonomous send, receive, and management." },

  // --- finance ---
  { id: "3-statement-model", category: "finance", description: "Build fully-integrated 3-statement models in Excel with working-capital schedules." },
  { id: "comps-analysis", category: "finance", description: "Comparable-company analysis in Excel: operating metrics and valuation multiples." },
  { id: "dcf-model", category: "finance", description: "Institutional-quality DCF valuation models with revenue projections and scenarios." },
  { id: "excel-author", category: "finance", description: "Build auditable Excel workbooks headless with openpyxl and formula conventions." },
  { id: "lbo-model", category: "finance", description: "Leveraged-buyout models in Excel with sources & uses and debt schedules." },
  { id: "merger-model", category: "finance", description: "Accretion/dilution models in Excel for M&A analysis and deal evaluation." },
  { id: "pptx-author", category: "finance", description: "Build PowerPoint decks headless with python-pptx for model-backed presentations." },
  { id: "stocks", category: "finance", description: "Stock quotes, history, and crypto data via Yahoo Finance." },

  // --- health ---
  { id: "fitness-nutrition", category: "health", description: "Gym workout planner and nutrition tracker — 690+ exercises, 380k+ foods." },
  { id: "neuroskill-bci", category: "health", requires: "heavy", description: "Connect to a NeuroSkill instance for real-time cognitive/emotional state (needs BCI hardware)." },

  // --- mcp ---
  { id: "fastmcp", category: "mcp", description: "Build, test, and deploy MCP servers with FastMCP in Python." },
  { id: "mcporter", category: "mcp", description: "Use the mcporter CLI to list, configure, and call MCP servers and tools." },

  // --- migration ---
  { id: "openclaw-migration", category: "migration", description: "Migrate an OpenClaw customization footprint into Hermes Agent, importing assets." },

  // --- mlops ---
  { id: "accelerate", category: "mlops", requires: "heavy", description: "HuggingFace Accelerate: distributed training with DeepSpeed/FSDP/Megatron." },
  { id: "chroma", category: "mlops", description: "Chroma: open-source embedding database for vector and full-text search." },
  { id: "clip", category: "mlops", requires: "heavy", description: "OpenAI CLIP: zero-shot image classification and cross-modal retrieval." },
  { id: "faiss", category: "mlops", description: "FAISS: efficient similarity search and clustering of dense vectors." },
  { id: "flash-attention", category: "mlops", requires: "heavy", description: "Flash Attention: optimise transformer attention for a 2–4× speedup." },
  { id: "guidance", category: "mlops", description: "Guidance: constrain LLM output with regex/grammars for valid JSON/XML." },
  { id: "huggingface-tokenizers", category: "mlops", description: "Fast Rust-based HuggingFace tokenizers for research and production." },
  { id: "instructor", category: "mlops", description: "Instructor: extract structured data from LLM responses with Pydantic validation." },
  { id: "lambda-labs", category: "mlops", description: "Lambda Labs: reserved and on-demand GPU cloud instances for ML." },
  { id: "llava", category: "mlops", requires: "heavy", description: "LLaVA: large language-and-vision assistant for visual instruction tuning and image chat." },
  { id: "modal", category: "mlops", description: "Modal: serverless GPU platform for ML workloads, no infrastructure to manage." },
  { id: "nemo-curator", category: "mlops", requires: "heavy", description: "NeMo Curator: GPU-accelerated data curation with fuzzy dedup and quality filtering." },
  { id: "peft", category: "mlops", requires: "heavy", description: "PEFT: parameter-efficient fine-tuning for LLMs — LoRA, QLoRA, 25+ methods." },
  { id: "pinecone", category: "mlops", description: "Pinecone: managed vector database with hybrid search and metadata filtering." },
  { id: "pytorch-fsdp", category: "mlops", requires: "heavy", description: "PyTorch FSDP: expert guidance for Fully Sharded Data Parallel training." },
  { id: "pytorch-lightning", category: "mlops", requires: "heavy", description: "PyTorch Lightning: high-level framework with automatic distributed training." },
  { id: "qdrant", category: "mlops", description: "Qdrant: high-performance vector similarity search for RAG and semantic search." },
  { id: "saelens", category: "mlops", requires: "heavy", description: "SAELens: train and analyse sparse autoencoders to decompose network activations." },
  { id: "simpo", category: "mlops", requires: "heavy", description: "SimPO: Simple Preference Optimization for LLM alignment without a reference model." },
  { id: "slime", category: "mlops", requires: "heavy", description: "slime: LLM RL post-training on a Megatron + SGLang framework." },
  { id: "stable-diffusion", category: "mlops", requires: "heavy", description: "Stable Diffusion: state-of-the-art text-to-image generation." },
  { id: "tensorrt-llm", category: "mlops", requires: "heavy", description: "TensorRT-LLM: optimise LLM inference on NVIDIA GPUs for throughput and latency." },
  { id: "torchtitan", category: "mlops", requires: "heavy", description: "TorchTitan: PyTorch-native distributed LLM pretraining with 4D parallelism." },
  { id: "whisper", category: "mlops", requires: "heavy", description: "Whisper: OpenAI speech recognition across 99 languages — transcribe and translate." },
  { id: "outlines", category: "mlops", subdir: "mlops/inference", description: "Outlines: structured JSON/regex/Pydantic LLM generation control." },
  { id: "axolotl", category: "mlops", subdir: "mlops/training", requires: "heavy", description: "Axolotl: YAML-driven LLM fine-tuning with LoRA, DPO, and GRPO." },
  { id: "trl-fine-tuning", category: "mlops", subdir: "mlops/training", requires: "heavy", description: "TRL: SFT, DPO, PPO, GRPO, and reward modeling for LLM RLHF." },
  { id: "unsloth", category: "mlops", subdir: "mlops/training", requires: "heavy", description: "Unsloth: 2–5× faster LoRA/QLoRA fine-tuning with lower VRAM." },

  // --- productivity ---
  { id: "canvas", category: "productivity", description: "Canvas LMS: fetch enrolled courses and assignments via an API token." },
  { id: "here-now", category: "productivity", description: "here.now: publish static sites and store private files in cloud Drives for handoff." },
  { id: "memento-flashcards", category: "productivity", description: "Spaced-repetition flashcards with free-text answers and adaptive scheduling." },
  { id: "shop-app", category: "productivity", description: "Shop.app: product search, order tracking, returns, and reorders." },
  { id: "shopify", category: "productivity", description: "Shopify Admin & Storefront GraphQL APIs: products, orders, customers, inventory." },
  { id: "siyuan", category: "productivity", description: "SiYuan Note API: search, read, and manage blocks in a self-hosted knowledge base." },
  { id: "telephony", category: "productivity", description: "Phone capabilities — SMS/MMS, calls, and Twilio number provisioning." },

  // --- research ---
  { id: "bioinformatics", category: "research", description: "Gateway to 400+ bioinformatics skills — genomics, transcriptomics, structural biology." },
  { id: "darwinian-evolver", category: "research", description: "Evolve prompts, regex, SQL, or code with Imbue's evolution-loop framework." },
  { id: "domain-intel", category: "research", description: "Passive domain reconnaissance via the Python stdlib — subdomains and DNS records." },
  { id: "drug-discovery", category: "research", description: "Pharmaceutical research assistant for drug-discovery workflows and ADMET interpretation." },
  { id: "duckduckgo-search", category: "research", description: "Free web search via DuckDuckGo — text, news, images, video — no API key." },
  { id: "gitnexus-explorer", category: "research", description: "Index codebases with GitNexus and serve interactive knowledge graphs." },
  { id: "osint-investigation", category: "research", description: "Public-records OSINT — SEC EDGAR, USAspending, court records." },
  { id: "parallel-cli", category: "research", description: "Parallel CLI: agent-native web search and deep research." },
  { id: "qmd", category: "research", description: "Search personal knowledge bases locally with hybrid BM25 + vector + LLM reranking." },
  { id: "scrapling", category: "research", description: "Web scraping: HTTP fetching, browser automation, and spider crawling." },
  { id: "searxng-search", category: "research", description: "Free meta-search via SearXNG, aggregating 70+ search engines." },

  // --- security ---
  { id: "1password", category: "security", description: "Set up and use the 1Password CLI for secrets management." },
  { id: "oss-forensics", category: "security", description: "Supply-chain investigation and forensic analysis of GitHub repositories." },
  { id: "sherlock", category: "security", description: "Sherlock: OSINT username search across 400+ social networks." },

  // --- software-development ---
  { id: "rest-graphql-debug", category: "software-development", description: "Debug REST/GraphQL APIs — status codes, authentication, schema issues." },

  // --- web-development ---
  { id: "page-agent", category: "web-development", description: "Embed alibaba/page-agent into a web app as a single script tag for UI automation." },
];

/** The full catalog — both packs, each entry stamped with its `pack`. */
export const SKILL_CATALOG: CatalogSkill[] = [
  ...BUILTIN.map((s) => ({ ...s, pack: "builtin" as const })),
  ...OPTIONAL.map((s) => ({ ...s, pack: "optional" as const })),
];

/** Look up a catalog entry by its slug. */
export function getCatalogSkill(id: string): CatalogSkill | undefined {
  return SKILL_CATALOG.find((s) => s.id === id);
}
