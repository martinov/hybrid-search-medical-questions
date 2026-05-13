// apps/ingestion/src/service — Function-level driving port for ingestion.
//
// Slice 02: `ingestBatch` runs the full F1-F7 retry/quarantine loop per
// Expansion A. The service:
//   - Reads + validates the input JSON via RawQuestionBatchSchema
//   - For each question (optionally filtered by `onlyTitles`/`limit`):
//     - Runs `EnrichmentService.enrichQuestion` (schema-retry loop inside)
//     - On `ok`: writes enriched_questions + provenance
//     - On `quarantined`: writes a quarantine row, NEVER writes enriched_questions
//   - Aggregates run summary (first-try-pass %, retry %, quarantine %)
//   - Emits per-question log events (transport-retry, schema-retry, ok, quarantined)

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
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
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

export function createIngestionService(deps: IngestionDeps): IngestionService {
  const enrichment = new EnrichmentService({
    enrichmentModel: deps.enrichmentModel,
    embeddingModel: deps.embeddingModel,
    modelName: deps.modelName,
    embeddingModelName: deps.embeddingModelName,
    promptVersion: deps.promptVersion,
    maxSchemaAttempts: deps.maxSchemaAttempts,
    maxTransportRetries: deps.maxTransportRetries,
  });
  const enrichedRepo = new EnrichedQuestionRepo();
  const batchRepo = new IngestionBatchRepo();
  const quarantineRepo = new QuarantineRepo();
  const eventsRepo = new DomainEventsRepo();

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
      prompt_version: deps.promptVersion ?? "v1",
      model: deps.modelName ?? "mock",
      embedding_model: deps.embeddingModelName ?? "mock",
      expected_count: 1,
    });

    const outcome = await enrichment.enrichQuestion(first, { questionId });

    if (outcome.kind !== "ok") {
      await batchRepo.close(batchId, {
        aborted: true,
        abort_reason: `quarantined: ${outcome.failureKind}`,
      });
      return {
        outcome: "quarantined",
        questionId,
        costUsd: outcome.costUsd,
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
      const summary: RunSummary = {
        total: 1,
        processedCount: 1,
        enrichedCount: 1,
        quarantinedCount: 0,
        firstTryPassPercent: 100,
        afterRetryPercent: 100,
        quarantinePercent: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: outcome.costUsd,
        avgCostPerQuestionUsd: outcome.costUsd,
        avgLatencyMs: outcome.latencyMs,
        p95LatencyMs: outcome.latencyMs,
        totalDurationMs: outcome.latencyMs,
        printed: `Enriched 1 question (id=${questionId}). bloom_level=${outcome.enrichment.bloom_level}, keywords=[${outcome.enrichment.keywords.join(", ")}]`,
      };
      await mkdir(deps.logsDir, { recursive: true });
      await writeFile(
        join(deps.logsDir, `${batchId}.json`),
        JSON.stringify(summary, null, 2),
      );
    }

    return { outcome: "ingested", questionId, costUsd: outcome.costUsd };
  }

  async function ingestBatch(input: IngestBatchInput): Promise<IngestBatchResult> {
    const allQuestions = await readQuestions(input.filePath);
    const selected = selectQuestions(allQuestions, input);
    const batchId = `batch-${Date.now()}-${randomUUID().slice(0, 8)}`;

    await batchRepo.open({
      id: batchId,
      file_path: input.filePath,
      prompt_version: deps.promptVersion ?? "v1",
      model: deps.modelName ?? "mock",
      embedding_model: deps.embeddingModelName ?? "mock",
      expected_count: selected.length,
    });

    await eventsRepo
      .append(
        {
          type: "BatchOpened",
          batch_id: batchId,
          file_path: input.filePath,
          expected_count: selected.length,
          prompt_version: deps.promptVersion ?? "v1",
          model: deps.modelName ?? "mock",
          embedding_model: deps.embeddingModelName ?? "mock",
          started_at: new Date().toISOString(),
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
    const startedAt = Date.now();

    for (const question of selected) {
      const questionId = randomUUID();
      const outcome = await enrichment.enrichQuestion(question, { questionId });
      latencies.push(outcome.latencyMs);
      totalCostUsd += outcome.costUsd;

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
      }

      perQuestionLog.push({
        title: question.title,
        questionId,
        events,
      });
    }

    const totalDurationMs = Date.now() - startedAt;
    const processedCount = selected.length;
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

    const summary: RunSummary = {
      // `total` is the number of questions processed in this run (after the
      // onlyTitles/limit filter is applied). The KPI scenario in the .feature
      // file phrases this as "a batch of N questions has been processed".
      total: processedCount,
      processedCount,
      enrichedCount,
      quarantinedCount,
      firstTryPassPercent,
      afterRetryPercent,
      quarantinePercent,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCostUsd,
      avgCostPerQuestionUsd,
      avgLatencyMs,
      p95LatencyMs: p95(latencies),
      totalDurationMs,
      printed:
        `Run summary — Enriched: ${enrichedCount} ` +
        `(first-try: ${firstTryPassCount}, after-retry: ${enrichedCount - firstTryPassCount}), ` +
        `Quarantined: ${quarantinedCount}. ` +
        `First-try-pass: ${firstTryPassPercent}%.`,
    };

    await batchRepo.close(batchId, { aborted: false });
    await eventsRepo
      .append(
        {
          type: "BatchClosed",
          batch_id: batchId,
          closed_at: new Date().toISOString(),
          success_count: enrichedCount,
          quarantine_count: quarantinedCount,
          aborted: false,
          abort_reason: null,
        },
        { correlation_id: batchId },
      )
      .catch(() => {
        // best-effort
      });

    if (deps.logsDir) {
      await mkdir(deps.logsDir, { recursive: true });
      await writeFile(
        join(deps.logsDir, `${batchId}.json`),
        JSON.stringify({ summary, perQuestionLog }, null, 2),
      );
    }

    return {
      batchId,
      summary,
      perQuestionLog,
      aborted: false,
      abortReason: null,
    };
  }

  return { ingestOne, ingestBatch };
}
