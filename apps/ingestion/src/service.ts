// apps/ingestion/src/service — Function-level driving port for ingestion.
//
// Returns `{ ingestOne, ingestBatch }`. Tests inject AI SDK 6 mock models
// via `enrichmentModel` and `embeddingModel`; the production CLI wraps
// real `@ai-sdk/openai` models behind the same shape.

import {
  EnrichedQuestionRepo,
  IngestionBatchRepo,
} from "@netea/db";
import { EnrichmentService } from "@netea/enrichment";
import { RawQuestionBatchSchema, type RawQuestion } from "@netea/schemas";
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

export type PerQuestionLogEntry = {
  title: string;
  questionId: string;
  events: Array<
    | { kind: "schema-retry"; attempt: number }
    | { kind: "transport-retry"; attempt: number }
    | { kind: "ok" }
    | { kind: "quarantined"; failureKind: string }
  >;
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

export function createIngestionService(deps: IngestionDeps): IngestionService {
  const enrichment = new EnrichmentService({
    enrichmentModel: deps.enrichmentModel,
    embeddingModel: deps.embeddingModel,
    modelName: deps.modelName,
    embeddingModelName: deps.embeddingModelName,
    promptVersion: deps.promptVersion,
  });
  const enrichedRepo = new EnrichedQuestionRepo();
  const batchRepo = new IngestionBatchRepo();

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

    // Optional: write a run summary log
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

    return {
      outcome: "ingested",
      questionId,
      costUsd: outcome.costUsd,
    };
  }

  async function ingestBatch(_input: IngestBatchInput): Promise<IngestBatchResult> {
    throw new Error("ingestBatch: not implemented (Slice 02 scope)");
  }

  return { ingestOne, ingestBatch };
}
