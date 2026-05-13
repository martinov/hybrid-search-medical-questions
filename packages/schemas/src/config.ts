// @netea/schemas/config — Env-var loader and validator.
// Consumed by composition roots in apps/api and apps/ingestion.

import { z } from "zod";

export const __SCAFFOLD__ = true as const;

export const AppConfigSchema = z
  .object({
    OPENAI_API_KEY: z.string().min(1, "OPENAI_API_KEY is required"),
    DATABASE_URL: z.string().url(),
    INGEST_MAX_COST_USD: z.coerce.number().nonnegative().optional(),
    OPENAI_MODEL_ENRICHMENT: z.string().default("gpt-4o-mini"),
    OPENAI_MODEL_EMBEDDING: z.string().default("text-embedding-3-small"),
    OPENAI_MODEL_CHAT: z.string().default("gpt-4o-mini"),
    PROMPT_VERSION: z.string().default("v1"),
    NETEA_USE_MOCK_LLM: z
      .union([z.literal("0"), z.literal("1")])
      .optional()
      .default("0"),
  })
  .passthrough();
export type AppConfig = z.infer<typeof AppConfigSchema>;
