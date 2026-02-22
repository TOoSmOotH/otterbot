import { getDb, schema } from "../db/index.js";
import { sql } from "drizzle-orm";

interface ModelPrice {
  inputPerMillion: number;
  outputPerMillion: number;
}

/**
 * Built-in default prices (USD per million tokens).
 * Keys are regex-like patterns matched against model IDs.
 */
const DEFAULT_MODEL_PRICES: Record<string, ModelPrice> = {
  // Anthropic
  "claude-opus-4": { inputPerMillion: 15, outputPerMillion: 75 },
  "claude-sonnet-4-5": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-sonnet-4": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-haiku-3-5": { inputPerMillion: 0.8, outputPerMillion: 4 },
  "claude-3-5-sonnet": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-3-5-haiku": { inputPerMillion: 0.8, outputPerMillion: 4 },
  "claude-3-opus": { inputPerMillion: 15, outputPerMillion: 75 },
  "claude-3-sonnet": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-3-haiku": { inputPerMillion: 0.25, outputPerMillion: 1.25 },
  // OpenAI
  "gpt-4.1": { inputPerMillion: 2, outputPerMillion: 8 },
  "gpt-4.1-mini": { inputPerMillion: 0.4, outputPerMillion: 1.6 },
  "gpt-4.1-nano": { inputPerMillion: 0.1, outputPerMillion: 0.4 },
  "gpt-4o": { inputPerMillion: 2.5, outputPerMillion: 10 },
  "gpt-4o-mini": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "o3": { inputPerMillion: 10, outputPerMillion: 40 },
  "o3-mini": { inputPerMillion: 1.1, outputPerMillion: 4.4 },
  "o4-mini": { inputPerMillion: 1.1, outputPerMillion: 4.4 },
  // Google
  "gemini-2.5-pro": { inputPerMillion: 1.25, outputPerMillion: 10 },
  "gemini-2.5-flash": { inputPerMillion: 0.15, outputPerMillion: 0.6 },
  "gemini-2.0-flash": { inputPerMillion: 0.1, outputPerMillion: 0.4 },
};

/** Get user-overridden price for a model, or null if not overridden */
function getUserOverride(model: string): ModelPrice | null {
  try {
    const db = getDb();
    const inputRow = db
      .select()
      .from(schema.config)
      .where(sql`${schema.config.key} = ${"pricing:" + model + ":input"}`)
      .get();
    const outputRow = db
      .select()
      .from(schema.config)
      .where(sql`${schema.config.key} = ${"pricing:" + model + ":output"}`)
      .get();
    if (inputRow || outputRow) {
      return {
        inputPerMillion: inputRow ? parseFloat(inputRow.value) : 0,
        outputPerMillion: outputRow ? parseFloat(outputRow.value) : 0,
      };
    }
  } catch {
    // DB not ready
  }
  return null;
}

/** Find the best matching default price for a model ID */
function findDefaultPrice(model: string): ModelPrice | null {
  // Exact match first
  if (DEFAULT_MODEL_PRICES[model]) {
    return DEFAULT_MODEL_PRICES[model];
  }
  // Prefix match (e.g. "claude-sonnet-4-5-20250929" matches "claude-sonnet-4-5")
  for (const [pattern, price] of Object.entries(DEFAULT_MODEL_PRICES)) {
    if (model.startsWith(pattern)) {
      return price;
    }
  }
  return null;
}

/** Get the price for a model — checks user overrides first, then built-in defaults */
export function getModelPrice(model: string): ModelPrice {
  const override = getUserOverride(model);
  if (override) return override;
  return findDefaultPrice(model) ?? { inputPerMillion: 0, outputPerMillion: 0 };
}

/** Calculate cost in microcents (1/10000 of a cent) */
export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number {
  const price = getModelPrice(model);
  // Price is in USD per million tokens
  // 1 USD = 100 cents = 1,000,000 microcents (we use 10,000 microcents per cent)
  // Actually: 1 USD = 100 cents, 1 cent = 10,000 microcents, so 1 USD = 1,000,000 microcents
  const inputCostUsd = (inputTokens / 1_000_000) * price.inputPerMillion;
  const outputCostUsd = (outputTokens / 1_000_000) * price.outputPerMillion;
  const totalUsd = inputCostUsd + outputCostUsd;
  // Convert to microcents: 1 USD = 1,000,000 microcents
  return Math.round(totalUsd * 1_000_000);
}

/** Set a user override price for a model */
export function setModelPrice(model: string, inputPerMillion: number, outputPerMillion: number): void {
  const db = getDb();
  const now = new Date().toISOString();
  db.insert(schema.config)
    .values({ key: `pricing:${model}:input`, value: String(inputPerMillion), updatedAt: now })
    .onConflictDoUpdate({
      target: schema.config.key,
      set: { value: String(inputPerMillion), updatedAt: now },
    })
    .run();
  db.insert(schema.config)
    .values({ key: `pricing:${model}:output`, value: String(outputPerMillion), updatedAt: now })
    .onConflictDoUpdate({
      target: schema.config.key,
      set: { value: String(outputPerMillion), updatedAt: now },
    })
    .run();
}

/** Remove user override for a model, reverting to default */
export function resetModelPrice(model: string): void {
  const db = getDb();
  db.delete(schema.config)
    .where(sql`${schema.config.key} = ${"pricing:" + model + ":input"}`)
    .run();
  db.delete(schema.config)
    .where(sql`${schema.config.key} = ${"pricing:" + model + ":output"}`)
    .run();
}

/** Get all model prices (defaults merged with user overrides) */
export function getAllModelPrices(): Record<string, ModelPrice & { isCustom: boolean }> {
  const result: Record<string, ModelPrice & { isCustom: boolean }> = {};

  // Start with all built-in defaults
  for (const [model, price] of Object.entries(DEFAULT_MODEL_PRICES)) {
    result[model] = { ...price, isCustom: false };
  }

  // Also include any models from the token_usage table that aren't in defaults
  try {
    const db = getDb();
    const usedModels = db
      .select({ model: schema.tokenUsage.model })
      .from(schema.tokenUsage)
      .groupBy(schema.tokenUsage.model)
      .all();
    for (const { model } of usedModels) {
      if (!result[model]) {
        const defaultPrice = findDefaultPrice(model);
        result[model] = {
          inputPerMillion: defaultPrice?.inputPerMillion ?? 0,
          outputPerMillion: defaultPrice?.outputPerMillion ?? 0,
          isCustom: false,
        };
      }
    }
  } catch {
    // DB not ready
  }

  // Apply user overrides
  try {
    const db = getDb();
    const overrides = db
      .select()
      .from(schema.config)
      .where(sql`${schema.config.key} LIKE 'pricing:%:input'`)
      .all();
    for (const row of overrides) {
      const model = row.key.replace("pricing:", "").replace(":input", "");
      const outputRow = db
        .select()
        .from(schema.config)
        .where(sql`${schema.config.key} = ${"pricing:" + model + ":output"}`)
        .get();
      result[model] = {
        inputPerMillion: parseFloat(row.value),
        outputPerMillion: outputRow ? parseFloat(outputRow.value) : 0,
        isCustom: true,
      };
    }
  } catch {
    // DB not ready
  }

  return result;
}
