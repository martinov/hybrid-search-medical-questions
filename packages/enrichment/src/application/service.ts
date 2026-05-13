// @netea/enrichment/application/service — EnrichmentService application layer.
//
// Slice 02: full F1-F7 retry/quarantine loop per Expansion A §3 decision matrix.
//   - schema-retry budget (default 2 retries → 3 attempts) for F1/F2/F3/F5/F6
//   - transport-retry budget (separate, default 2) for 429 / 5xx / network
//   - F7 → immediate quarantine, no retry
// On terminal failure the caller receives a `quarantined` outcome with the
// `attemptHistory` array; the caller is responsible for the DB write. This
// keeps the application service free of repository concerns (ports & adapters).

import {
  EnrichmentOutputSchema,
  EnrichmentOutputJsonSchema,
  type EnrichmentOutput,
  type FailureKind,
  type RawQuestion,
} from "@netea/schemas";
import { embed, type LanguageModel } from "ai";
import { ZodError } from "zod";
import type {
  EmbeddingModelInput,
  EnrichmentModelInput,
} from "./ports.js";
import { buildEnrichmentPrompt, PROMPT_VERSION } from "../prompts/v1.js";
import {
  classifyFailure,
  describeFailure,
} from "../domain/failure-classifier.js";
import {
  decideRetry,
  isTransportError,
} from "../domain/retry-policy.js";
import { invokeLanguageModelV3 } from "../infrastructure/openai-adapter.js";

export type EnrichmentDeps = {
  enrichmentModel: EnrichmentModelInput;
  embeddingModel: EmbeddingModelInput;
  promptVersion?: string;
  modelName?: string;
  embeddingModelName?: string;
  modelTemperature?: number;
  maxSchemaAttempts?: number; // default 3 (1 initial + 2 retries)
  maxTransportRetries?: number; // default 2
};

export type AttemptHistoryEntry = {
  attempt: number;
  failureKind: FailureKind | null;
  rawText: string;
  finishReason: string;
  errorMessage: string;
};

// Slice 03: usage is the load-bearing shape for cost aggregation. The
// service returns real token totals (summed across all schema-retry
// attempts and the embedding call) so the ingestion service can price
// them against the `@netea/observability` pricing table.
export type EnrichmentUsage = {
  enrichmentInputTokens: number;
  enrichmentOutputTokens: number;
  embeddingTokens: number;
};

export type EnrichmentOutcome =
  | {
      kind: "ok";
      questionId: string;
      retryCount: number; // schema retries only
      transportRetryCount: number;
      latencyMs: number;
      usage: EnrichmentUsage;
      enrichment: EnrichmentOutput;
      embedding: number[];
      provenance: {
        prompt_version: string;
        model: string;
        model_temperature: number;
        embedding_model: string;
        enriched_at: string;
      };
      attemptHistory: AttemptHistoryEntry[];
    }
  | {
      kind: "quarantined";
      questionId: string;
      failureKind: FailureKind;
      latencyMs: number;
      usage: EnrichmentUsage;
      attemptHistory: AttemptHistoryEntry[];
      lastValidationError: unknown;
      lastFinishReason: string;
      provenance: { prompt_version: string; model: string };
    };

function tryParse(rawText: string): {
  parsed?: EnrichmentOutput;
  parseError?: unknown;
} {
  let json: unknown;
  try {
    json = JSON.parse(rawText);
  } catch (err) {
    return { parseError: err };
  }
  const result = EnrichmentOutputSchema.safeParse(json);
  if (!result.success) return { parseError: result.error };
  return { parsed: result.data };
}

function serializeZodError(err: unknown): unknown {
  if (err instanceof ZodError) {
    return {
      name: "ZodError",
      issues: err.issues.map((i) => ({
        path: i.path,
        code: i.code,
        message: i.message,
      })),
    };
  }
  if (err instanceof Error) {
    return { name: err.name, message: err.message };
  }
  return err == null ? null : String(err);
}

export class EnrichmentService {
  constructor(private readonly _deps: EnrichmentDeps) {}

  async enrichQuestion(
    raw: RawQuestion,
    ctx: { questionId: string },
  ): Promise<EnrichmentOutcome> {
    const start = Date.now();
    const maxAttempts = this._deps.maxSchemaAttempts ?? 3;
    const maxTransportRetries = this._deps.maxTransportRetries ?? 2;
    const temperature = this._deps.modelTemperature ?? 0;
    const promptVersion = this._deps.promptVersion ?? PROMPT_VERSION;
    const modelName = this._deps.modelName ?? "mock-or-real";

    const attemptHistory: AttemptHistoryEntry[] = [];
    let feedback: string | undefined = undefined;
    let transportRetryCount = 0;
    // Slice 03: token-level usage is accumulated across ALL schema-retry
    // attempts (including the failed ones). The cost of a quarantine event
    // is real: every attempt consumed tokens. The ingestion service prices
    // these against the @netea/observability pricing table.
    let enrichmentInputTokens = 0;
    let enrichmentOutputTokens = 0;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const promptText = buildEnrichmentPrompt(raw, { feedback });
      let invoke: Awaited<ReturnType<typeof invokeLanguageModelV3>>;

      // Transport-retry loop: separate budget from the schema-retry budget.
      let transportAttempt = 0;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        try {
          invoke = await invokeLanguageModelV3(
            this._deps.enrichmentModel as LanguageModel as unknown as Parameters<typeof invokeLanguageModelV3>[0],
            {
              promptText,
              temperature,
              responseSchema: {
                schema: EnrichmentOutputJsonSchema,
                name: "enrichment_output",
              },
            },
          );
          break;
        } catch (err) {
          if (
            isTransportError(err) &&
            transportAttempt < maxTransportRetries
          ) {
            transportRetryCount++;
            transportAttempt++;
            continue;
          }
          throw err;
        }
      }

      const { rawText, finishReason } = invoke;
      enrichmentInputTokens += invoke.usage.inputTokens;
      enrichmentOutputTokens += invoke.usage.outputTokens;
      const { parsed, parseError } = tryParse(rawText);
      const kind = classifyFailure({ rawText, finishReason, parseError });

      attemptHistory.push({
        attempt,
        failureKind: kind,
        rawText,
        finishReason,
        errorMessage: describeFailure({ rawText, finishReason, parseError }),
      });

      const decision = decideRetry({
        failureKind: kind,
        attempt,
        maxAttempts,
        lastErrorMessage:
          parseError instanceof ZodError
            ? parseError.issues
                .map(
                  (i) =>
                    `${i.path.join(".") || "(root)"}: ${i.message}`,
                )
                .join("; ")
            : parseError instanceof Error
              ? parseError.message
              : undefined,
      });

      if (decision.action === "accept" && parsed) {
        const embedResult = await embed({
          model: this._deps.embeddingModel,
          value: `${raw.title}\n${raw.content}`,
        });
        const embeddingTokens = embedResult.usage?.tokens ?? 0;
        return {
          kind: "ok",
          questionId: ctx.questionId,
          retryCount: attempt - 1,
          transportRetryCount,
          latencyMs: Date.now() - start,
          usage: {
            enrichmentInputTokens,
            enrichmentOutputTokens,
            embeddingTokens,
          },
          enrichment: parsed,
          embedding: embedResult.embedding,
          provenance: {
            prompt_version: promptVersion,
            model: modelName,
            model_temperature: temperature,
            embedding_model: this._deps.embeddingModelName ?? "mock-or-real",
            enriched_at: new Date().toISOString(),
          },
          attemptHistory,
        };
      }

      if (decision.action === "quarantine") {
        return {
          kind: "quarantined",
          questionId: ctx.questionId,
          failureKind: kind ?? "F2",
          latencyMs: Date.now() - start,
          usage: {
            enrichmentInputTokens,
            enrichmentOutputTokens,
            // Quarantined rows are not embedded — no embedding tokens.
            embeddingTokens: 0,
          },
          attemptHistory,
          lastValidationError: serializeZodError(parseError),
          lastFinishReason: finishReason,
          provenance: { prompt_version: promptVersion, model: modelName },
        };
      }

      // retry
      if (decision.action === "retry") feedback = decision.feedback;
    }

    // Defensive — the decision matrix should always quarantine on the final
    // attempt; this branch is unreachable but the type system insists.
    const last = attemptHistory[attemptHistory.length - 1]!;
    return {
      kind: "quarantined",
      questionId: ctx.questionId,
      failureKind: last.failureKind ?? "F2",
      latencyMs: Date.now() - start,
      usage: {
        enrichmentInputTokens,
        enrichmentOutputTokens,
        embeddingTokens: 0,
      },
      attemptHistory,
      lastValidationError: null,
      lastFinishReason: last.finishReason,
      provenance: { prompt_version: promptVersion, model: modelName },
    };
  }
}
