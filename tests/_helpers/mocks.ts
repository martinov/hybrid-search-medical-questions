// tests/_helpers/mocks.ts — Slice 03 deterministic mock builders.

import { MockEmbeddingModelV1, MockLanguageModelV1 } from "ai/test";

export const __SCAFFOLD__ = true as const;

export function deterministicValidModel(_usage: {
  promptTokens: number;
  completionTokens: number;
}): MockLanguageModelV1 {
  throw new Error("Not yet implemented — RED scaffold");
}

export function deterministicValidModelWithLatencies(
  _latencies: number[],
): MockLanguageModelV1 {
  throw new Error("Not yet implemented — RED scaffold");
}

export function deterministicValidEmbed(): MockEmbeddingModelV1<string> {
  throw new Error("Not yet implemented — RED scaffold");
}

export function scriptedMixedOutcomes(): MockLanguageModelV1 {
  throw new Error("Not yet implemented — RED scaffold");
}
