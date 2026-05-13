// @netea/ingestion-service — Barrel export.

export const __SCAFFOLD__ = true as const;

export { createIngestionService } from "./service.js";
export type {
  IngestionService,
  IngestionDeps,
  IngestOneInput,
  IngestOneResult,
  IngestBatchInput,
  IngestBatchResult,
  PerQuestionLogEntry,
  RunSummary,
  DryRunEstimate,
} from "./service.js";
