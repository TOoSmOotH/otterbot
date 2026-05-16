/**
 * Standalone fake OpenAI-compatible model server. Lets the Playwright e2e
 * suite run fully self-contained — no LM Studio or cloud key required.
 *
 *   tsx src/test/fake-model-server.ts        # listens on :8745
 *   FAKE_MODEL_PORT=9000 tsx src/test/...    # custom port
 */
import { startFakeOpenAI } from "./fake-openai.js";

const port = Number(process.env.FAKE_MODEL_PORT ?? 8745);

startFakeOpenAI({ port })
  .then((fake) => {
    console.log(`[fake-model] OpenAI-compatible server listening at ${fake.url}`);
  })
  .catch((err) => {
    console.error("[fake-model] failed to start:", err);
    process.exit(1);
  });
