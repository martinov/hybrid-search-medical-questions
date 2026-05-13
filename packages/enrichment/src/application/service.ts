// @netea/enrichment/application/service — EnrichmentService application layer.
//
// Walking-skeleton scope: happy-path enrichment via AI SDK 6 `generateObject`
// + `embed`. The full F1-F7 retry policy is Slice 02 (step 2).

import {
  EnrichmentOutputSchema,
  type EnrichmentOutput,
  type RawQuestion,
} from "@netea/schemas";
import { embed, generateObject } from "ai";
import type {
  EmbeddingModelInput,
  EnrichmentModelInput,
} from "./ports.js";
import { buildEnrichmentPrompt, PROMPT_VERSION } from "../prompts/v1.js";

export type EnrichmentDeps = {
  enrichmentModel: EnrichmentModelInput;
  embeddingModel: EmbeddingModelInput;
  promptVersion?: string;
  modelName?: string;
  embeddingModelName?: string;
  modelTemperature?: number;
};

export type EnrichmentOutcome =
  | {
      kind: "ok";
      questionId: string;
      retryCount: number;
      latencyMs: number;
      costUsd: number;
      enrichment: EnrichmentOutput;
      embedding: number[];
      provenance: {
        prompt_version: string;
        model: string;
        model_temperature: number;
        embedding_model: string;
        enriched_at: string;
      };
    }
  | {
      kind: "quarantined";
      questionId: string;
      failureKind: "F1" | "F2" | "F3" | "F5" | "F6" | "F7";
      latencyMs: number;
      costUsd: number;
    };

export class EnrichmentService {
  constructor(private readonly _deps: EnrichmentDeps) {}

  async enrichQuestion(
    raw: RawQuestion,
    ctx: { questionId: string },
  ): Promise<EnrichmentOutcome> {
    const start = Date.now();
    const promptText = buildEnrichmentPrompt(raw);

    const result = await generateObject({
      model: this._deps.enrichmentModel,
      schema: EnrichmentOutputSchema,
      prompt: promptText,
      temperature: this._deps.modelTemperature ?? 0,
    });

    const enrichment = result.object;

    const embedResult = await embed({
      model: this._deps.embeddingModel,
      value: `${raw.title}\n${raw.content}`,
    });

    const latencyMs = Date.now() - start;

    return {
      kind: "ok",
      questionId: ctx.questionId,
      retryCount: 0,
      latencyMs,
      costUsd: 0,
      enrichment,
      embedding: embedResult.embedding,
      provenance: {
        prompt_version: this._deps.promptVersion ?? PROMPT_VERSION,
        model: this._deps.modelName ?? "mock-or-real",
        model_temperature: this._deps.modelTemperature ?? 0,
        embedding_model: this._deps.embeddingModelName ?? "mock-or-real",
        enriched_at: new Date().toISOString(),
      },
    };
  }
}
