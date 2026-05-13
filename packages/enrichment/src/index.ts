// @netea/enrichment — Barrel export.

export { EnrichmentService } from "./application/service.js";
export type {
  EnrichmentDeps,
  EnrichmentOutcome,
} from "./application/service.js";
export type {
  EmbeddingPort,
  LlmEnrichmentPort,
  EmbeddingModelInput,
  EnrichmentModelInput,
} from "./application/ports.js";
export { classifyFailure } from "./domain/failure-classifier.js";
export type { ClassificationInput } from "./domain/failure-classifier.js";
export { prompts, PROMPT_VERSION, buildEnrichmentPrompt } from "./prompts/v1.js";
export {
  createOpenAiEnrichmentModel,
  createOpenAiEmbeddingModel,
  createOpenAiChatModel,
} from "./infrastructure/openai-adapter.js";
