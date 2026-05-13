// @netea/schemas/observability — Run summary + per-question stats persisted to
// logs/runs/{batch_id}.json (US-03 / KPI #4). The shape here is the SoT — the
// observability package writer, the ingestion service aggregator, and the
// future log-tail dashboard all read it through this schema.
//
// Numeric fields are USD (cost) or milliseconds (latency). Percentage fields
// are integer values 0..100 (Math.round semantics, matching slice-02).

import { z } from "zod";

export const __SCAFFOLD__ = true as const;

export const CostBreakdownSchema = z
  .object({
    enrichment_input_usd: z.number().nonnegative(),
    enrichment_output_usd: z.number().nonnegative(),
    embedding_usd: z.number().nonnegative(),
  })
  .strict();
export type CostBreakdown = z.infer<typeof CostBreakdownSchema>;

export const LatencyAggregatesSchema = z
  .object({
    p50: z.number().nonnegative(),
    p95: z.number().nonnegative(),
    mean: z.number().nonnegative(),
    total: z.number().nonnegative(),
  })
  .strict();
export type LatencyAggregates = z.infer<typeof LatencyAggregatesSchema>;

export const RunSummarySchema = z
  .object({
    batchId: z.string().min(1),
    startedAt: z.string().datetime(),
    completedAt: z.string().datetime(),
    source: z.string().min(1),

    totalCount: z.number().int().nonnegative(),
    processedCount: z.number().int().nonnegative(),
    enrichedCount: z.number().int().nonnegative(),
    quarantinedCount: z.number().int().nonnegative(),
    firstTryPassCount: z.number().int().nonnegative(),

    firstTryPassPercent: z.number().int().min(0).max(100),
    afterRetryPercent: z.number().int().min(0).max(100),
    quarantinePercent: z.number().int().min(0).max(100),
    validationRate: z.number().min(0).max(1),

    totalInputTokens: z.number().int().nonnegative(),
    totalOutputTokens: z.number().int().nonnegative(),
    totalEmbeddingTokens: z.number().int().nonnegative(),
    totalCostUsd: z.number().nonnegative(),
    avgCostPerQuestionUsd: z.number().nonnegative(),
    costBreakdown: CostBreakdownSchema,

    avgLatencyMs: z.number().nonnegative(),
    p95LatencyMs: z.number().nonnegative(),
    totalDurationMs: z.number().nonnegative(),
    latencyMs: LatencyAggregatesSchema,

    promptVersion: z.string().min(1),
    modelIdEnrichment: z.string().min(1),
    modelIdEmbedding: z.string().min(1),

    aborted: z.boolean(),
    abortReason: z.string().nullable(),

    printed: z.string(),
  })
  .strict();
export type RunSummary = z.infer<typeof RunSummarySchema>;
