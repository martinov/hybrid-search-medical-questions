// tests/_helpers/llm-script.ts — Slice 02 scripted-mock support.
//
// These helpers are referenced as `declare function` in
// `tests/acceptance/slice-02-llm-resilience/scenarios.test.ts`. The
// production prompt template (packages/enrichment/src/prompts/v1.ts) is
// contracted to emit `Title: <title>` as its first line; `extractTitleFromPrompt`
// scans the prompt for that prefix to route scripted responses per question.

export const __SCAFFOLD__ = true as const;

/**
 * Extract the question title from a prompt object handed to MockLanguageModelV1.
 * The AI SDK prompt is a structured array; scan the user message for the
 * `Title: <title>` line per the production prompt contract.
 */
export function extractTitleFromPrompt(_prompt: unknown): string {
  throw new Error("Not yet implemented — RED scaffold");
}

/**
 * Render a Slice 02 CallScript step into a MockLanguageModelV1 response.
 */
export function renderStep(_step: unknown): {
  finishReason: string;
  usage: { promptTokens: number; completionTokens: number };
  text: string;
  rawCall: { rawPrompt: null; rawSettings: object };
} {
  throw new Error("Not yet implemented — RED scaffold");
}
