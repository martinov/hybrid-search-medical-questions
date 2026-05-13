// @netea/schemas/events — Domain event payloads.
// Sketch per brief §App Arch 5.4; full 16-event catalog enumerated in step 1+.

import { z } from "zod";

export const __SCAFFOLD__ = true as const;

export const BatchOpenedEvent = z
  .object({
    type: z.literal("BatchOpened"),
    batch_id: z.string(),
    file_path: z.string(),
    expected_count: z.number().int().nonnegative(),
    prompt_version: z.string(),
    model: z.string(),
    embedding_model: z.string(),
    started_at: z.string().datetime(),
    max_cost_usd: z.number().nullable(),
  })
  .strict();

export const BatchClosedEvent = z
  .object({
    type: z.literal("BatchClosed"),
    batch_id: z.string(),
    closed_at: z.string().datetime(),
    success_count: z.number().int().nonnegative(),
    quarantine_count: z.number().int().nonnegative(),
    aborted: z.boolean(),
    abort_reason: z.string().nullable(),
  })
  .strict();

// Other 14 events (EnrichmentAttempted, EnrichmentSucceeded, EnrichmentRetryScheduled,
// EnrichmentQuarantined, EmbeddingGenerated, QuestionIndexed, SearchPerformed,
// ZeroResultEncountered, ChatTurnStarted, ChatTurnCompleted, ZeroResultReformulationTriggered,
// CostCapApproached, CostCapExceeded, ModelDriftDetected) — TODO step 1+.

export const DomainEventSchema = z.discriminatedUnion("type", [
  BatchOpenedEvent,
  BatchClosedEvent,
]);
export type DomainEvent = z.infer<typeof DomainEventSchema>;
