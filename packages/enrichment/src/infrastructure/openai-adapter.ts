// @netea/enrichment/infrastructure/openai-adapter — Thin factory helpers.
//
// The walking skeleton uses AI SDK 6 `LanguageModel` / `EmbeddingModel`
// values directly (constructed by `@ai-sdk/openai`'s `createOpenAI`). These
// helpers are kept as namespaced thin wrappers so the composition root can
// import a single named factory.

import { createOpenAI } from "@ai-sdk/openai";
import type { EmbeddingModel, LanguageModel } from "ai";

export function createOpenAiEnrichmentModel(opts: {
  apiKey: string;
  model: string;
}): LanguageModel {
  const provider = createOpenAI({ apiKey: opts.apiKey });
  return provider.languageModel(opts.model);
}

export function createOpenAiEmbeddingModel(opts: {
  apiKey: string;
  model: string;
}): EmbeddingModel {
  const provider = createOpenAI({ apiKey: opts.apiKey });
  return provider.textEmbeddingModel(opts.model);
}

export function createOpenAiChatModel(opts: {
  apiKey: string;
  model: string;
}): LanguageModel {
  const provider = createOpenAI({ apiKey: opts.apiKey });
  return provider.languageModel(opts.model);
}
