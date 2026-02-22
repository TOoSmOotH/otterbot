# Needed Tests

Based on the coverage report, the following areas have critical low coverage and need comprehensive tests.

## 1. Agents (`packages/server/src/agents/`)

### `agent.ts` (Coverage: 13.47%)
This is the base class for all agents and contains core logic for message handling, LLM interaction (thinking), and tool execution.
- **Initialization**: Verify soul resolution, bus subscription, and database persistence.
- **Think Loop**: Test the `think()` method, including:
    - Memory injection logic.
    - Tool execution flow (using mocked LLM stream).
    - Fallback mechanisms (e.g., text tool calling).
    - Kimi tool markup handling (proprietary tool calling).
    - Circuit breaker integration.
- **Conversation Management**: Test history pruning and summarization.

### `team-lead.ts` (Coverage: 32.62%)
- Test project management logic.
- Test worker delegation and coordination.

## 2. Memory (`packages/server/src/memory/`)

### `memory-service.ts` (Coverage: 0.6%)
This service manages persistent memories using SQLite and vector search.
- **Save**: Test creating new memories and updating existing ones (including FTS index updates).
- **Search**: Test keyword search (LIKE), FTS5 search (BM25), and hybrid search (combining vectors and keywords).
- **List**: Test filtering by category, agent scope, and project.
- **Delete**: Verify deletion from DB, FTS, and vector store.

### `embeddings.ts` & `vector-store.ts` (Coverage: < 6%)
- Test embedding generation and storage/retrieval logic.

## 3. OpenCode Integration (`packages/server/src/opencode/`)

### `opencode-manager.ts` (Coverage: 5.69%)
Manages the OpenCode child process and configuration.
- **Config Writing**: Verify correct JSON generation for different providers (Anthropic, OpenAI, etc.).
- **Process Management**: Test starting, monitoring, and stopping the `opencode serve` process.
- **Restart Logic**: Verify auto-restart behavior on crash.

## 4. Registry (`packages/server/src/registry/`)

### `registry.ts` (Coverage: 23.18%)
- Test agent registration, lookup, and manifest loading.

## 5. System Services

### `packages.ts` (Coverage: 2.79%)
- Test package installation and management logic.

### `stt/stt.ts` & `tts/tts.ts` (Coverage: ~5%)
- Test Speech-to-Text and Text-to-Speech integration (mocking external APIs/processes).

### `auth/auth.ts` (Coverage: 6.25%)
- Test configuration persistence and retrieval.

### `settings/settings.ts` (Coverage: 7.89%)
- Test settings management operations.

## 6. Socket Handlers (`packages/server/src/socket/handlers.ts`)

### `handlers.ts` (Coverage: 51.95%)
- While coverage is moderate, critical event handlers need robust testing, especially those interacting with the message bus and database.
