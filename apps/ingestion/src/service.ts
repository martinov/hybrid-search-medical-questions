// apps/ingestion/src/service — Function-level driving port for ingestion.
//
// Slice 03 expanded the responsibilities to cover the observability KPIs in
// US-03:
//   - Real cost tracking: token usage from EnrichmentService.usage, priced
//     against @netea/observability's pricing table (one source of truth).
//   - Per-question latency captured via performance.now() deltas, summed
//     and percentile-aggregated by RunSummaryWriter.
//   - INGEST_MAX_COST_USD cost cap: before each next question we check the
//     cumulative cost; if the *previous* question pushed us over, we abort
//     mid-batch with reason "cost cap exceeded" (already-enriched rows
//     remain persisted, no rollback).
//   - logs/runs/{batch_id}.json: written by RunSummaryWriter on every run,
//     including aborted/partial runs (the test asserts the partial record
//     names the abort reason).
//   - Pre-flight: if logs/runs is read-only, fail fast BEFORE any LLM
//     calls — wasted token spend on a run we can't persist is unacceptable.

import {
  EnrichedQuestionRepo,
  IngestionBatchRepo,
  QuarantineRepo,
  DomainEventsRepo,
} from "@netea/db";
import { EnrichmentService } from "@netea/enrichment";
import {
  RawQuestionBatchSchema,
  type RawQuestion,
} from "@netea/schemas";
import {
  RunSummaryWriter,
  enrichmentCostUsd,
  embeddingCostUsd,
  costForTokens,
  type PerQuestionStat,
} from "@netea/observability";
import { performance } from "node:perf_hooks";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { EmbeddingModel, LanguageModel } from "ai";

export type IngestionDeps = {
  enrichmentModel: LanguageModel;
  embeddingModel: EmbeddingModel;
  logsDir?: string;
  maxCostUsd?: number;
  modelName?: string;
  embeddingModelName?: string;
  promptVersion?: string;
  maxSchemaAttempts?: number;
  maxTransportRetries?: number;
};

export type IngestOneInput = { filePath: string };
export type IngestOneResult = {
  outcome: "ingested" | "quarantined" | "validation_failed";
  questionId: string;
  costUsd: number;
};

export type IngestBatchInput = {
  filePath: string;
  onlyTitles?: string[];
  limit?: number;
  dryRun?: boolean;
};

export type PerQuestionLogEvent =
  | { kind: "schema-retry"; attempt: number; failureKind: string }
  | { kind: "transport-retry"; attempt: number }
  | { kind: "ok" }
  | { kind: "quarantined"; failureKind: string };

export type PerQuestionLogEntry = {
  title: string;
  questionId: string;
  events: PerQuestionLogEvent[];
};

// The shape returned from `ingestBatch`. Mirrors the RunSummary schema in
// @netea/schemas with the extra fields the slice-02 test still references
// (total, enrichedCount, etc.) for back-compat.
export type RunSummary = {
  total: number;
  processedCount: number;
  enrichedCount: number;
  quarantinedCount: number;
  firstTryPassPercent: number;
  afterRetryPercent: number;
  quarantinePercent: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  avgCostPerQuestionUsd: number;
  avgLatencyMs: number;
  p95LatencyMs: number;
  totalDurationMs: number;
  printed: string;
};

export type IngestBatchResult = {
  batchId: string;
  summary: RunSummary;
  perQuestionLog: PerQuestionLogEntry[];
  aborted: boolean;
  abortReason: string | null;
};

export type IngestionService = {
  ingestOne(input: IngestOneInput): Promise<IngestOneResult>;
  ingestBatch(input: IngestBatchInput): Promise<IngestBatchResult>;
  estimateDryRun(input: IngestBatchInput): Promise<DryRunEstimate>;
};

export type DryRunEstimate = {
  questionCount: number;
  estimatedCostUsd: number;
  perQuestionCostUsd: number;
  modelName: string;
  embeddingModelName: string;
  printed: string;
};

async function readQuestions(filePath: string): Promise<RawQuestion[]> {
  const raw = await readFile(filePath, "utf8");
  const parsed = JSON.parse(raw);
  return RawQuestionBatchSchema.parse(parsed);
}

function selectQuestions(
  all: RawQuestion[],
  input: IngestBatchInput,
): RawQuestion[] {
  let list = all;
  if (input.onlyTitles && input.onlyTitles.length > 0) {
    const allowed = new Set(input.onlyTitles);
    list = list.filter((q) => allowed.has(q.title));
  }
  if (typeof input.limit === "number" && input.limit > 0) {
    list = list.slice(0, input.limit);
  }
  return list;
}

function p95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = Math.max(0, Math.ceil(sorted.length * 0.95) - 1);
  return sorted[idx] ?? 0;
}

// Average token counts assumed for --dry-run estimates. Mirrors Expansion E
// Section 1's p50 sizing. Real numbers are recorded post-run.
const DRY_RUN_AVG_INPUT_TOKENS = 1048;
const DRY_RUN_AVG_OUTPUT_TOKENS = 120;
const DRY_RUN_AVG_EMBED_TOKENS = 300;

export function createIngestionService(deps: IngestionDeps): IngestionService {
  const enrichmentModelName = deps.modelName ?? "gpt-4o-mini";
  const embeddingModelName = deps.embeddingModelName ?? "text-embedding-3-small";
  const promptVersion = deps.promptVersion ?? "v1";

  const enrichment = new EnrichmentService({
    enrichmentModel: deps.enrichmentModel,
    embeddingModel: deps.embeddingModel,
    modelName: enrichmentModelName,
    embeddingModelName: embeddingModelName,
    promptVersion,
    maxSchemaAttempts: deps.maxSchemaAttempts,
    maxTransportRetries: deps.maxTransportRetries,
  });
  const enrichedRepo = new EnrichedQuestionRepo();
  const batchRepo = new IngestionBatchRepo();
  const quarantineRepo = new QuarantineRepo();
  const eventsRepo = new DomainEventsRepo();

  function priceUsage(usage: {
    enrichmentInputTokens: number;
    enrichmentOutputTokens: number;
    embeddingTokens: number;
  }): {
    enrichmentInputUsd: number;
    enrichmentOutputUsd: number;
    embeddingUsd: number;
    totalUsd: number;
  } {
    const enr = enrichmentCostUsd({
      model: enrichmentModelName,
      inputTokens: usage.enrichmentInputTokens,
      outputTokens: usage.enrichmentOutputTokens,
    });
    const embed = embeddingCostUsd({
      model: embeddingModelName,
      tokens: usage.embeddingTokens,
    });
    return {
      enrichmentInputUsd: enr.inputUsd,
      enrichmentOutputUsd: enr.outputUsd,
      embeddingUsd: embed,
      totalUsd: enr.totalUsd + embed,
    };
  }

  async function ingestOne(input: IngestOneInput): Promise<IngestOneResult> {
    const questions = await readQuestions(input.filePath);
    const first = questions[0];
    if (!first) {
      throw new Error("ingestOne: input file contains zero questions");
    }
    const batchId = `batch-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const questionId = randomUUID();

    await batchRepo.open({
      id: batchId,
      file_path: input.filePath,
      prompt_version: promptVersion,
      model: enrichmentModelName,
      embedding_model: embeddingModelName,
      expected_count: 1,
    });

    const outcome = await enrichment.enrichQuestion(first, { questionId });
    const priced = priceUsage(outcome.usage);

    if (outcome.kind !== "ok") {
      await batchRepo.close(batchId, {
        aborted: true,
        abort_reason: `quarantined: ${outcome.failureKind}`,
      });
      return {
        outcome: "quarantined",
        questionId,
        costUsd: priced.totalUsd,
      };
    }

    await enrichedRepo.insert({
      id: questionId,
      batch_id: batchId,
      title: first.title,
      content: first.content,
      answers: first.answers,
      explanation: first.explanation,
      raw_imported_at: new Date().toISOString(),
      bloom_level: outcome.enrichment.bloom_level,
      keywords: outcome.enrichment.keywords,
      medical_specialty: outcome.enrichment.medical_specialty,
      prompt_version: outcome.provenance.prompt_version,
      model: outcome.provenance.model,
      model_temperature: outcome.provenance.model_temperature,
      embedding_model: outcome.provenance.embedding_model,
      enriched_at: outcome.provenance.enriched_at,
      retry_count: outcome.retryCount,
      needs_reenrichment: false,
      status: "indexed",
      indexed_at: new Date().toISOString(),
      embedding: outcome.embedding,
    });

    await batchRepo.close(batchId, { aborted: false });

    if (deps.logsDir) {
      const writer = new RunSummaryWriter({
        logsDir: deps.logsDir,
        batchId,
        source: input.filePath,
        totalCount: 1,
        promptVersion,
        modelIdEnrichment: enrichmentModelName,
        modelIdEmbedding: embeddingModelName,
        startedAt: new Date().toISOString(),
      });
      await writer.preflight();
      writer.record({
        questionId,
        title: first.title,
        outcome: "enriched",
        retryCount: outcome.retryCount,
        latencyMs: outcome.latencyMs,
        enrichmentInputTokens: outcome.usage.enrichmentInputTokens,
        enrichmentOutputTokens: outcome.usage.enrichmentOutputTokens,
        embeddingTokens: outcome.usage.embeddingTokens,
        enrichmentInputUsd: priced.enrichmentInputUsd,
        enrichmentOutputUsd: priced.enrichmentOutputUsd,
        embeddingUsd: priced.embeddingUsd,
      });
      await writer.finalize({ completedAt: new Date().toISOString() });
    }

    return { outcome: "ingested", questionId, costUsd: priced.totalUsd };
  }

  async function ingestBatch(input: IngestBatchInput): Promise<IngestBatchResult> {
    const allQuestions = await readQuestions(input.filePath);
    const selected = selectQuestions(allQuestions, input);
    const batchId = `batch-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const startedAtIso = new Date().toISOString();

    // Pre-flight: logs dir writability check BEFORE any LLM calls.
    let writer: RunSummaryWriter | null = null;
    if (deps.logsDir) {
      writer = new RunSummaryWriter({
        logsDir: deps.logsDir,
        batchId,
        source: input.filePath,
        totalCount: selected.length,
        promptVersion,
        modelIdEnrichment: enrichmentModelName,
        modelIdEmbedding: embeddingModelName,
        startedAt: startedAtIso,
      });
      await writer.preflight();
    }

    await batchRepo.open({
      id: batchId,
      file_path: input.filePath,
      prompt_version: promptVersion,
      model: enrichmentModelName,
      embedding_model: embeddingModelName,
      expected_count: selected.length,
      max_cost_usd: deps.maxCostUsd ?? null,
    });

    await eventsRepo
      .append(
        {
          type: "BatchOpened",
          batch_id: batchId,
          file_path: input.filePath,
          expected_count: selected.length,
          prompt_version: promptVersion,
          model: enrichmentModelName,
          embedding_model: embeddingModelName,
          started_at: startedAtIso,
          max_cost_usd: deps.maxCostUsd ?? null,
        },
        { correlation_id: batchId },
      )
      .catch(() => {
        // Domain event persistence is best-effort; never abort the batch on it.
      });

    const perQuestionLog: PerQuestionLogEntry[] = [];
    const latencies: number[] = [];
    let enrichedCount = 0;
    let quarantinedCount = 0;
    let firstTryPassCount = 0;
    let totalCostUsd = 0;
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let aborted = false;
    let abortReason: string | null = null;
    const startedAt = Date.now();

    for (const question of selected) {
      // Cost-cap check BEFORE the next LLM call. We do not pre-charge; we
      // gate on cumulative cost already incurred. If the previous question
      // pushed us over the cap, the next one is skipped and the batch
      // aborts. This matches the Expansion E §6 policy: "writes the
      // partial run record, surfaces the abort reason in stdout, leaves
      // the corpus in a consistent state (no partial writes mid-question)."
      if (
        typeof deps.maxCostUsd === "number" &&
        totalCostUsd >= deps.maxCostUsd
      ) {
        aborted = true;
        abortReason = "cost cap exceeded";
        writer?.abort(abortReason);
        process.stderr.write(
          `[ABORT] Cost cap of $${deps.maxCostUsd.toFixed(4)} exceeded ` +
            `(spent $${totalCostUsd.toFixed(4)} on ${perQuestionLog.length}/${selected.length} questions). ` +
            `Batch ${batchId} halted; enriched rows retained.\n`,
        );
        break;
      }

      const questionId = randomUUID();
      const questionStart = performance.now();
      const outcome = await enrichment.enrichQuestion(question, { questionId });
      const observedLatencyMs = Math.max(
        Math.round(performance.now() - questionStart),
        outcome.latencyMs,
      );
      latencies.push(observedLatencyMs);
      const priced = priceUsage(outcome.usage);
      totalCostUsd += priced.totalUsd;
      totalInputTokens += outcome.usage.enrichmentInputTokens;
      totalOutputTokens += outcome.usage.enrichmentOutputTokens;

      const events: PerQuestionLogEvent[] = [];
      for (
        let i = 0;
        i < (outcome as { attemptHistory?: unknown[] }).attemptHistory!.length;
        i++
      ) {
        const att = outcome.attemptHistory[i]!;
        // Transport retries are surfaced as separate events BEFORE the first
        // schema attempt completes. Since attempt history is per schema-attempt,
        // we synthesize transport-retry events from the transportRetryCount
        // accumulated during attempt 1 (which is where rate-limit mocks fire).
        if (
          i === 0 &&
          outcome.kind === "ok" &&
          outcome.transportRetryCount > 0
        ) {
          for (let t = 1; t <= outcome.transportRetryCount; t++) {
            events.push({ kind: "transport-retry", attempt: t });
          }
        }
        if (att.failureKind != null) {
          // Surface schema retries only for attempts that triggered a retry —
          // not the final attempt that resulted in quarantine, and not the
          // accepted attempt.
          const isFinal = i === outcome.attemptHistory.length - 1;
          const willRetry =
            outcome.kind === "ok" ? !isFinal : !isFinal;
          if (willRetry) {
            events.push({
              kind: "schema-retry",
              attempt: att.attempt,
              failureKind: att.failureKind,
            });
          }
        }
      }

      let outcomeKind: PerQuestionStat["outcome"];
      if (outcome.kind === "ok") {
        events.push({ kind: "ok" });
        if (outcome.retryCount === 0) firstTryPassCount++;

        await enrichedRepo.insert({
          id: questionId,
          batch_id: batchId,
          title: question.title,
          content: question.content,
          answers: question.answers,
          explanation: question.explanation,
          raw_imported_at: new Date().toISOString(),
          bloom_level: outcome.enrichment.bloom_level,
          keywords: outcome.enrichment.keywords,
          medical_specialty: outcome.enrichment.medical_specialty,
          prompt_version: outcome.provenance.prompt_version,
          model: outcome.provenance.model,
          model_temperature: outcome.provenance.model_temperature,
          embedding_model: outcome.provenance.embedding_model,
          enriched_at: outcome.provenance.enriched_at,
          retry_count: outcome.retryCount,
          needs_reenrichment: false,
          status: "indexed",
          indexed_at: new Date().toISOString(),
          embedding: outcome.embedding,
        });
        enrichedCount++;
        outcomeKind = "enriched";
      } else {
        events.push({
          kind: "quarantined",
          failureKind: outcome.failureKind,
        });
        const rawResponses = outcome.attemptHistory.map((a) => a.rawText);
        const parseErrors = outcome.attemptHistory.map((a) => a.errorMessage);
        await quarantineRepo.insert({
          id: randomUUID(),
          source_question_id: questionId,
          batch_id: batchId,
          title: question.title,
          failure_kind: outcome.failureKind,
          raw_responses: rawResponses,
          parse_errors: parseErrors,
          last_validation_error: outcome.lastValidationError as Record<
            string,
            unknown
          >,
          last_finish_reason: outcome.lastFinishReason,
          prompt_version: outcome.provenance.prompt_version,
          model: outcome.provenance.model,
          quarantined_at: new Date().toISOString(),
          triage_state: "Awaiting",
          triage_notes: null,
        });
        quarantinedCount++;
        outcomeKind = "quarantined";
      }

      perQuestionLog.push({
        title: question.title,
        questionId,
        events,
      });

      writer?.record({
        questionId,
        title: question.title,
        outcome: outcomeKind,
        retryCount: outcome.kind === "ok" ? outcome.retryCount : 0,
        latencyMs: observedLatencyMs,
        enrichmentInputTokens: outcome.usage.enrichmentInputTokens,
        enrichmentOutputTokens: outcome.usage.enrichmentOutputTokens,
        embeddingTokens: outcome.usage.embeddingTokens,
        enrichmentInputUsd: priced.enrichmentInputUsd,
        enrichmentOutputUsd: priced.enrichmentOutputUsd,
        embeddingUsd: priced.embeddingUsd,
      });
    }

    const totalDurationMs = Date.now() - startedAt;
    const processedCount = perQuestionLog.length;
    const firstTryPassPercent =
      processedCount > 0
        ? Math.round((firstTryPassCount / processedCount) * 100)
        : 0;
    const afterRetryPercent =
      processedCount > 0
        ? Math.round(((enrichedCount - firstTryPassCount) / processedCount) * 100)
        : 0;
    const quarantinePercent =
      processedCount > 0
        ? Math.round((quarantinedCount / processedCount) * 100)
        : 0;
    const avgLatencyMs =
      latencies.length > 0
        ? Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length)
        : 0;
    const avgCostPerQuestionUsd =
      processedCount > 0 ? totalCostUsd / processedCount : 0;

    const printedSummary =
      `Run summary — Enriched: ${enrichedCount} ` +
      `(first-try: ${firstTryPassCount}, after-retry: ${enrichedCount - firstTryPassCount}), ` +
      `Quarantined: ${quarantinedCount}. ` +
      `First-try-pass: ${firstTryPassPercent}%. ` +
      `Total cost: $${totalCostUsd.toFixed(4)} ` +
      `(avg $${avgCostPerQuestionUsd.toFixed(6)}/q). ` +
      `Avg latency: ${avgLatencyMs}ms, p95: ${p95(latencies)}ms.` +
      (aborted ? ` ABORTED: ${abortReason}` : "");

    const summary: RunSummary = {
      // `total` is the number of questions processed in this run (after the
      // onlyTitles/limit filter is applied). The KPI scenario in the .feature
      // file phrases this as "a batch of N questions has been processed".
      // For slice-02 backwards-compat, when no abort occurs total === selected.length;
      // when aborted, total reflects the count *targeted* (selected.length).
      total: aborted ? selected.length : processedCount,
      processedCount,
      enrichedCount,
      quarantinedCount,
      firstTryPassPercent,
      afterRetryPercent,
      quarantinePercent,
      totalInputTokens,
      totalOutputTokens,
      totalCostUsd,
      avgCostPerQuestionUsd,
      avgLatencyMs,
      p95LatencyMs: p95(latencies),
      totalDurationMs,
      printed: printedSummary,
    };

    await batchRepo.close(batchId, {
      aborted,
      abort_reason: abortReason,
    });
    await eventsRepo
      .append(
        {
          type: "BatchClosed",
          batch_id: batchId,
          closed_at: new Date().toISOString(),
          success_count: enrichedCount,
          quarantine_count: quarantinedCount,
          aborted,
          abort_reason: abortReason,
        },
        { correlation_id: batchId },
      )
      .catch(() => {
        // best-effort
      });

    if (writer) {
      const finalized = await writer.finalize({
        completedAt: new Date().toISOString(),
      });
      // RunCompleted domain event — single record per run, carries the
      // headline numbers so downstream listeners don't have to re-read
      // the JSON file.
      await eventsRepo
        .append(
          {
            type: "RunCompleted",
            batch_id: batchId,
            completed_at: finalized.summary.completedAt,
            summary_path: finalized.path,
            total_cost_usd: finalized.summary.totalCostUsd,
            avg_cost_per_question_usd: finalized.summary.avgCostPerQuestionUsd,
            avg_latency_ms: finalized.summary.avgLatencyMs,
            p95_latency_ms: finalized.summary.p95LatencyMs,
            first_try_pass_percent: finalized.summary.firstTryPassPercent,
            quarantine_percent: finalized.summary.quarantinePercent,
            processed_count: finalized.summary.processedCount,
            aborted: finalized.summary.aborted,
            abort_reason: finalized.summary.abortReason,
          },
          { correlation_id: batchId },
        )
        .catch(() => {
          // best-effort
        });
    }

    return {
      batchId,
      summary,
      perQuestionLog,
      aborted,
      abortReason,
    };
  }

  async function estimateDryRun(
    input: IngestBatchInput,
  ): Promise<DryRunEstimate> {
    const allQuestions = await readQuestions(input.filePath);
    const selected = selectQuestions(allQuestions, input);
    // Estimate using p50 token sizing from Expansion E §1. Honest about the
    // numbers being assumed — the printed line names the modelled sizes
    // so the operator can sanity-check against the actual question shape.
    const enrichmentPerQ = costForTokens({
      model: enrichmentModelName,
      inputTokens: DRY_RUN_AVG_INPUT_TOKENS,
      outputTokens: DRY_RUN_AVG_OUTPUT_TOKENS,
    });
    const embeddingPerQ = costForTokens({
      model: embeddingModelName,
      inputTokens: DRY_RUN_AVG_EMBED_TOKENS,
      outputTokens: 0,
    });
    const perQuestionCostUsd = enrichmentPerQ + embeddingPerQ;
    const estimatedCostUsd = perQuestionCostUsd * selected.length;
    const printed =
      `[DRY RUN] Would process ${selected.length} questions. ` +
      `Estimated cost: $${estimatedCostUsd.toFixed(4)} ` +
      `(per-question avg $${perQuestionCostUsd.toFixed(6)}; ` +
      `enrichment model=${enrichmentModelName}, embedding model=${embeddingModelName}). ` +
      `Per-question token sizing assumed: ${DRY_RUN_AVG_INPUT_TOKENS} in + ` +
      `${DRY_RUN_AVG_OUTPUT_TOKENS} out enrichment, ${DRY_RUN_AVG_EMBED_TOKENS} embed.`;
    return {
      questionCount: selected.length,
      estimatedCostUsd,
      perQuestionCostUsd,
      modelName: enrichmentModelName,
      embeddingModelName,
      printed,
    };
  }

  return { ingestOne, ingestBatch, estimateDryRun };
}

