// @netea/enrichment/infrastructure/openai-adapter — Thin factory helpers.
//
// The walking skeleton uses AI SDK 6 `LanguageModel` / `EmbeddingModel`
// values directly (constructed by `@ai-sdk/openai`'s `createOpenAI`). These
// helpers are kept as namespaced thin wrappers so the composition root can
// import a single named factory.
//
// Slice 02 adds `invokeLanguageModelV3` — a direct call into the V3 provider
// surface that returns the raw text + finishReason so the application
// service can JSON.parse + Zod.parse outside the AI SDK's `generateObject`
// helper. This is required because we need full control over the failure
// path (F1 raw text, F7 refusal detection, retry-with-feedback prompt
// composition) and the AI SDK's high-level `generateObject` throws an
// opaque `NoObjectGeneratedError` that conflates F1/F2/F3 with F7.

import { createOpenAI } from "@ai-sdk/openai";
import type { EmbeddingModel, LanguageModel } from "ai";
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
} from "@ai-sdk/provider";

export function createOpenAiEnrichmentModel(opts: {
  apiKey: string;
  model: string;
}): LanguageModel {
  const provider = createOpenAI({ apiKey: opts.apiKey });
  return provider.languageModel(opts.model);
}

export function createOpenAiEmbeddingModel(opts: {
  apiKey: string;
  model: string;
}): EmbeddingModel {
  const provider = createOpenAI({ apiKey: opts.apiKey });
  return provider.textEmbeddingModel(opts.model);
}

export function createOpenAiChatModel(opts: {
  apiKey: string;
  model: string;
}): LanguageModel {
  const provider = createOpenAI({ apiKey: opts.apiKey });
  return provider.languageModel(opts.model);
}

export type InvokeLlmArgs = {
  promptText: string;
  temperature?: number;
  maxOutputTokens?: number;
  /** Per-request abort after this many ms (default 60_000). */
  timeoutMs?: number;
};

export type InvokeLlmResult = {
  rawText: string;
  finishReason: string;
  usage: { inputTokens: number; outputTokens: number };
};

// Models that bill reasoning tokens via the OpenAI reasoning API. For these
// we must cap reasoning effort and provide a generous maxOutputTokens budget
// (reasoning tokens count toward the output cap), or the call can hang
// indefinitely on a single question.
const REASONING_MODEL_PATTERN = /^(gpt-5|o[134])/i;

function isReasoningModel(modelId: string): boolean {
  return REASONING_MODEL_PATTERN.test(modelId);
}

/**
 * Invoke a LanguageModelV3 with a single user-text prompt and return the
 * raw text + unified finish reason. Throws on transport errors (caller
 * decides whether to consume the transport-retry budget).
 */
export async function invokeLanguageModelV3(
  model: LanguageModelV3,
  args: InvokeLlmArgs,
): Promise<InvokeLlmResult> {
  const reasoning = isReasoningModel(model.modelId);
  const callOptions: LanguageModelV3CallOptions = {
    prompt: [
      {
        role: "user",
        content: [{ type: "text", text: args.promptText }],
      },
    ],
    temperature: args.temperature ?? 0,
    // Reasoning models count reasoning tokens against the output cap, so
    // give them more headroom than chat models. Non-reasoning default of
    // 1024 is plenty for the structured enrichment JSON (~250 tokens).
    maxOutputTokens: args.maxOutputTokens ?? (reasoning ? 4096 : 1024),
    abortSignal: AbortSignal.timeout(args.timeoutMs ?? 60_000),
    // OpenAI JSON mode: forces raw JSON output (no ```json fences).
    // Schema is not enforced here — downstream Zod parse still validates
    // shape; this only fixes the markdown-wrapping problem.
    responseFormat: { type: "json" },
    ...(reasoning
      ? { providerOptions: { openai: { reasoningEffort: "minimal" } } }
      : {}),
  };
  const result: LanguageModelV3GenerateResult = await model.doGenerate(callOptions);
  const text = result.content
    .filter(
      (c: { type: string }): c is { type: "text"; text: string } =>
        c.type === "text",
    )
    .map((c: { text: string }) => c.text)
    .join("");
  return {
    rawText: text,
    finishReason: result.finishReason.unified,
    usage: {
      inputTokens: result.usage?.inputTokens?.total ?? 0,
      outputTokens: result.usage?.outputTokens?.total ?? 0,
    },
  };
}
