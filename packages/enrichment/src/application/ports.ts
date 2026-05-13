// @netea/enrichment/application/ports — Driven-port interfaces consumed by
// EnrichmentService. Adapters (OpenAI, Postgres) implement these in
// `infrastructure/`. Tests inject AI SDK mocks at the boundary.

import type { LanguageModel, EmbeddingModel } from "ai";

export const __SCAFFOLD__ = true as const;

export interface LlmEnrichmentPort {
  /**
   * Run one structured-output call. Returns the raw model output + metadata.
   * The application service Zod-parses + classifies failure outside this port.
   */
  complete(args: {
    promptText: string;
    questionId: string;
    feedbackHint?: string; // for layer-4 retry-with-feedback
  }): Promise<{
    rawText: string;
    finishReason: string;
    usage: { promptTokens: number; completionTokens: number };
    latencyMs: number;
  }>;
}

export interface EmbeddingPort {
  embed(text: string): Promise<{
    vector: number[];
    usage: { tokens: number };
    latencyMs: number;
  }>;
}

// Tests pass an AI SDK LanguageModelV1 directly via createIngestionService;
// the production composition root constructs a thin adapter around it.
// LanguageModel / EmbeddingModel<VALUE> are the public ai-SDK type aliases
// for LanguageModelV1 / EmbeddingModelV1<VALUE>.
export type EnrichmentModelInput = LanguageModel;
export type EmbeddingModelInput = EmbeddingModel;
