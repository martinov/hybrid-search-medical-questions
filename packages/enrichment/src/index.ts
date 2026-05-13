// @netea/enrichment — Barrel export.

export { EnrichmentService } from "./application/service.js";
export type {
  EnrichmentDeps,
  EnrichmentOutcome,
  AttemptHistoryEntry,
} from "./application/service.js";
export type {
  EmbeddingPort,
  LlmEnrichmentPort,
  EmbeddingModelInput,
  EnrichmentModelInput,
} from "./application/ports.js";
export {
  classifyFailure,
  describeFailure,
} from "./domain/failure-classifier.js";
export type { ClassificationInput } from "./domain/failure-classifier.js";
export {
  decideRetry,
  isTransportError,
} from "./domain/retry-policy.js";
export type {
  RetryAction,
  RetryDecisionInput,
} from "./domain/retry-policy.js";
export { prompts, PROMPT_VERSION, buildEnrichmentPrompt } from "./prompts/v1.js";
export {
  createOpenAiEnrichmentModel,
  createOpenAiEmbeddingModel,
  createOpenAiChatModel,
  invokeLanguageModelV3,
} from "./infrastructure/openai-adapter.js";
