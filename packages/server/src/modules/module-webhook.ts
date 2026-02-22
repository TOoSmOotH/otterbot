/**
 * Webhook route registration for modules.
 */

import type { FastifyInstance } from "fastify";
import type { WebhookRequest } from "@otterbot/shared";
import type { ModuleLoader } from "./module-loader.js";
import { getConfig } from "../auth/auth.js";

export function registerModuleWebhooks(
  app: FastifyInstance,
  loader: ModuleLoader,
): void {
  // Catch-all route for module webhooks
  app.post("/api/modules/:moduleId/webhook", async (req, reply) => {
    const { moduleId } = req.params as { moduleId: string };

    const loaded = loader.get(moduleId);
    if (!loaded) {
      return reply.status(404).send({ error: `Module not found: ${moduleId}` });
    }

    if (!loaded.definition.onWebhook) {
      return reply.status(400).send({ error: `Module ${moduleId} does not handle webhooks` });
    }

    // Verify webhook secret if configured
    const expectedSecret = getConfig(`module:${moduleId}:webhook_secret`);
    if (expectedSecret) {
      const providedSecret =
        (req.headers["x-webhook-secret"] as string) ??
        (req.headers["x-hub-signature-256"] as string);

      if (!providedSecret || providedSecret !== expectedSecret) {
        return reply.status(401).send({ error: "Invalid webhook secret" });
      }
    }

    const webhookReq: WebhookRequest = {
      method: req.method,
      headers: req.headers as Record<string, string | string[] | undefined>,
      body: req.body,
      params: req.params as Record<string, string>,
      query: req.query as Record<string, string>,
    };

    try {
      const result = await loaded.definition.onWebhook(webhookReq, loaded.context);

      // Auto-ingest items if returned
      if (result.items) {
        for (const item of result.items) {
          const content = `# ${item.title}\n\n${item.content}`;
          const metadata: Record<string, unknown> = {
            ...item.metadata,
            ...(item.url ? { url: item.url } : {}),
            title: item.title,
          };

          await loaded.knowledgeStore.upsert(item.id, content, metadata);
        }

        loaded.context.log(`Webhook ingested ${result.items.length} items`);
      }

      return reply.status(result.status ?? 200).send(result.body ?? { ok: true });
    } catch (err) {
      loaded.context.error("Webhook handler failed:", err);
      return reply.status(500).send({ error: "Webhook handler failed" });
    }
  });
}
