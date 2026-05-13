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

// US-03 / Slice 03 — emitted once the run summary JSON is written. The
// summary itself is persisted to logs/runs/{batch_id}.json; this event
// carries the headline numbers so downstream listeners (alerting, dashboards)
// don't have to re-read the file.
export const RunCompletedEvent = z
  .object({
    type: z.literal("RunCompleted"),
    batch_id: z.string(),
    completed_at: z.string().datetime(),
    summary_path: z.string(),
    total_cost_usd: z.number().nonnegative(),
    avg_cost_per_question_usd: z.number().nonnegative(),
    avg_latency_ms: z.number().nonnegative(),
    p95_latency_ms: z.number().nonnegative(),
    first_try_pass_percent: z.number().int().min(0).max(100),
    quarantine_percent: z.number().int().min(0).max(100),
    processed_count: z.number().int().nonnegative(),
    aborted: z.boolean(),
    abort_reason: z.string().nullable(),
  })
  .strict();

// Other 13 events (EnrichmentAttempted, EnrichmentSucceeded, EnrichmentRetryScheduled,
// EnrichmentQuarantined, EmbeddingGenerated, QuestionIndexed, SearchPerformed,
// ZeroResultEncountered, ChatTurnStarted, ChatTurnCompleted, ZeroResultReformulationTriggered,
// CostCapApproached, CostCapExceeded, ModelDriftDetected) — TODO step 1+.

export const DomainEventSchema = z.discriminatedUnion("type", [
  BatchOpenedEvent,
  BatchClosedEvent,
  RunCompletedEvent,
]);
export type DomainEvent = z.infer<typeof DomainEventSchema>;
