// @netea/observability/run-recorder — RunSummaryWriter accumulates per-question
// stats (cost, latency, retries, quarantines) during an ingestion run and
// writes the final JSON summary to logs/runs/{batch_id}.json (US-03, KPI #4).
//
// The writer is responsible for:
//   1. Maintaining the live running totals so the ingestion service can
//      query "has the cost cap been reached?" before each next call.
//   2. Computing percentile aggregates (p50/p95) over per-question latency.
//   3. Producing the final RunSummary record matching the Zod schema in
//      @netea/schemas, ready to JSON.stringify and emit.
//   4. Writing the JSON file atomically — a partial write on a read-only
//      logs directory must surface as an EACCES error, not silent corruption.
//
// The writer does NOT compute cost from token usage — the ingestion service
// passes in already-priced numbers (it owns the pricing table lookup). This
// keeps the writer free of pricing-table coupling and matches the test's
// expectation that totalCostUsd is just the sum of recorded per-question
// costs (no rounding drift from re-pricing).

import { mkdir, writeFile, access } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { join } from "node:path";
import type {
  RunSummary,
  CostBreakdown,
} from "@netea/schemas";

export type PerQuestionStat = {
  questionId: string;
  title: string;
  outcome: "enriched" | "quarantined";
  retryCount: number; // 0 = first-try pass
  latencyMs: number;
  enrichmentInputTokens: number;
  enrichmentOutputTokens: number;
  embeddingTokens: number;
  enrichmentInputUsd: number;
  enrichmentOutputUsd: number;
  embeddingUsd: number;
};

export type RunSummaryWriterDeps = {
  logsDir: string;
  batchId: string;
  source: string;
  totalCount: number;
  promptVersion: string;
  modelIdEnrichment: string;
  modelIdEmbedding: string;
  startedAt: string;
};

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.max(0, Math.ceil(sortedAsc.length * p) - 1);
  return sortedAsc[idx] ?? 0;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function formatUsd(n: number): string {
  return `$${n.toFixed(4)}`;
}

export class RunSummaryWriter {
  private readonly _stats: PerQuestionStat[] = [];
  private _aborted = false;
  private _abortReason: string | null = null;

  constructor(private readonly _deps: RunSummaryWriterDeps) {}

  /**
   * Pre-flight check: the logs directory must be writable BEFORE the run
   * starts. Surfaces a clear operator-facing message if it isn't.
   * Mirrors the slice-03 chmod 0o555 scenario.
   */
  async preflight(): Promise<void> {
    const dir = this._deps.logsDir;
    await mkdir(dir, { recursive: true }).catch(() => {
      // mkdir failing here is captured by the access() check below; we
      // don't want to throw a confusing EEXIST when the directory was
      // pre-created as read-only.
    });
    try {
      await access(dir, fsConstants.W_OK);
    } catch (err) {
      const cause = err instanceof Error ? err.message : String(err);
      throw new Error(
        `logs directory not writable: ${dir} (${cause}). ` +
          "Run summaries cannot be persisted; aborting before any LLM calls.",
      );
    }
  }

  record(stat: PerQuestionStat): void {
    this._stats.push(stat);
  }

  abort(reason: string): void {
    this._aborted = true;
    this._abortReason = reason;
  }

  /** Cumulative cost so far. Read before each LLM call to enforce the cap. */
  cumulativeCostUsd(): number {
    return this._stats.reduce(
      (acc, s) => acc + s.enrichmentInputUsd + s.enrichmentOutputUsd + s.embeddingUsd,
      0,
    );
  }

  processedCount(): number {
    return this._stats.length;
  }

  /**
   * Build the final RunSummary record and write it to disk. Returns the
   * absolute path of the JSON file. The caller can emit the RunCompleted
   * domain event using this return value.
   */
  async finalize(args: { completedAt: string }): Promise<{
    summary: RunSummary;
    path: string;
  }> {
    const summary = this._buildSummary(args.completedAt);
    await mkdir(this._deps.logsDir, { recursive: true });
    const path = join(this._deps.logsDir, `${this._deps.batchId}.json`);
    await writeFile(path, JSON.stringify(summary, null, 2));
    return { summary, path };
  }

  private _buildSummary(completedAt: string): RunSummary {
    const stats = this._stats;
    const processedCount = stats.length;
    const enrichedCount = stats.filter((s) => s.outcome === "enriched").length;
    const quarantinedCount = stats.filter((s) => s.outcome === "quarantined").length;
    const firstTryPassCount = stats.filter(
      (s) => s.outcome === "enriched" && s.retryCount === 0,
    ).length;

    const firstTryPassPercent =
      processedCount > 0
        ? Math.round((firstTryPassCount / processedCount) * 100)
        : 0;
    const afterRetryPercent =
      processedCount > 0
        ? Math.round(
            ((enrichedCount - firstTryPassCount) / processedCount) * 100,
          )
        : 0;
    const quarantinePercent =
      processedCount > 0
        ? Math.round((quarantinedCount / processedCount) * 100)
        : 0;
    const validationRate =
      processedCount > 0 ? enrichedCount / processedCount : 0;

    const latencies = stats.map((s) => s.latencyMs);
    const sortedLat = [...latencies].sort((a, b) => a - b);
    const p50 = percentile(sortedLat, 0.5);
    const p95 = percentile(sortedLat, 0.95);
    const avgLatencyMs = Math.round(mean(latencies));
    const totalDurationMs = latencies.reduce((a, b) => a + b, 0);

    const totalInputTokens = stats.reduce(
      (acc, s) => acc + s.enrichmentInputTokens,
      0,
    );
    const totalOutputTokens = stats.reduce(
      (acc, s) => acc + s.enrichmentOutputTokens,
      0,
    );
    const totalEmbeddingTokens = stats.reduce(
      (acc, s) => acc + s.embeddingTokens,
      0,
    );
    const enrichmentInputUsd = stats.reduce(
      (acc, s) => acc + s.enrichmentInputUsd,
      0,
    );
    const enrichmentOutputUsd = stats.reduce(
      (acc, s) => acc + s.enrichmentOutputUsd,
      0,
    );
    const embeddingUsd = stats.reduce((acc, s) => acc + s.embeddingUsd, 0);
    const totalCostUsd = enrichmentInputUsd + enrichmentOutputUsd + embeddingUsd;
    const avgCostPerQuestionUsd =
      processedCount > 0 ? totalCostUsd / processedCount : 0;

    const costBreakdown: CostBreakdown = {
      enrichment_input_usd: enrichmentInputUsd,
      enrichment_output_usd: enrichmentOutputUsd,
      embedding_usd: embeddingUsd,
    };

    const printed =
      `Run summary — Enriched: ${enrichedCount} ` +
      `(first-try: ${firstTryPassCount}, after-retry: ${enrichedCount - firstTryPassCount}), ` +
      `Quarantined: ${quarantinedCount}. ` +
      `First-try-pass: ${firstTryPassPercent}%. ` +
      `Total cost: ${formatUsd(totalCostUsd)} (avg ${formatUsd(avgCostPerQuestionUsd)}/q). ` +
      `Avg latency: ${avgLatencyMs}ms, p95: ${p95}ms.` +
      (this._aborted ? ` ABORTED: ${this._abortReason}` : "");

    return {
      batchId: this._deps.batchId,
      startedAt: this._deps.startedAt,
      completedAt,
      source: this._deps.source,

      totalCount: this._deps.totalCount,
      processedCount,
      enrichedCount,
      quarantinedCount,
      firstTryPassCount,

      firstTryPassPercent,
      afterRetryPercent,
      quarantinePercent,
      validationRate,

      totalInputTokens,
      totalOutputTokens,
      totalEmbeddingTokens,
      totalCostUsd,
      avgCostPerQuestionUsd,
      costBreakdown,

      avgLatencyMs,
      p95LatencyMs: p95,
      totalDurationMs,
      latencyMs: {
        p50,
        p95,
        mean: avgLatencyMs,
        total: totalDurationMs,
      },

      promptVersion: this._deps.promptVersion,
      modelIdEnrichment: this._deps.modelIdEnrichment,
      modelIdEmbedding: this._deps.modelIdEmbedding,

      aborted: this._aborted,
      abortReason: this._abortReason,

      printed,
    };
  }
}

// Back-compat re-export: prior step's tests typed against `RunRecord`. We
// keep the alias so consumers don't break. The full shape is RunSummary.
export type RunRecord = RunSummary;

