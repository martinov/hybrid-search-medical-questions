// @netea/search — Barrel export.

export const __SCAFFOLD__ = true as const;

export { hybridSearch, HybridSearchService } from "./application/service.js";
export type { HybridSearchDeps } from "./application/service.js";
export type {
  LexicalSearchPort,
  SemanticSearchPort,
  QueryEmbeddingPort,
} from "./application/ports.js";
export { LexicalSearchAdapter } from "./infrastructure/pg-lexical.js";
export { SemanticSearchAdapter } from "./infrastructure/pg-semantic.js";
export { rrf } from "./domain/rrf.js";
export type { Hit, FusedHit } from "./domain/rrf.js";
