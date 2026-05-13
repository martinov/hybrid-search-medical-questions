// @netea/db — Barrel export.

export { createDbClient, getDb, closeDb } from "./client.js";
export type { DrizzleClient } from "./client.js";
export { migrate } from "./migrations.js";
export * as schema from "./schema.js";

export {
  EnrichedQuestionRepo,
  countEnrichedQuestions,
  fetchEnrichedQuestion,
  fetchEnrichedQuestionByTitle,
} from "./repos/enriched-questions.js";
export {
  QuarantineRepo,
  countQuarantine,
  fetchQuarantineByTitle,
} from "./repos/quarantine.js";
export { IngestionBatchRepo } from "./repos/ingestion-batches.js";
export { DomainEventsRepo } from "./repos/domain-events.js";
