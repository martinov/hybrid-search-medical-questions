// @netea/observability/pricing — OpenAI pricing table, USD per 1M tokens.
//
// Rates re-verified 2026-05-13 against current OpenAI pricing. The Slice 03
// acceptance test pins gpt-4o-mini input ($0.15) and text-embedding-3-small
// input ($0.02), so those rows are load-bearing for the test suite.
//
// Note on gpt-5-mini: output pricing includes reasoning tokens. The OpenAI
// usage dashboard reports reasoning tokens as part of output, so the run
// recorder must do the same for billing reconciliation to balance.

export type ModelPricing = {
  input: number; // USD per 1M input tokens
  output: number; // USD per 1M output tokens
};

export const Pricing: Record<string, ModelPricing> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "gpt-5-mini": { input: 0.25, output: 2.0 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
  "text-embedding-3-large": { input: 0.13, output: 0 },
} as const;

function priceFor(model: string): ModelPricing {
  const p = Pricing[model];
  if (!p) {
    throw new Error(
      `Unknown model in pricing table: ${model}. ` +
        "Add it to Pricing with verified OpenAI rates.",
    );
  }
  return p;
}

/**
 * Generic cost computation: total USD across input + output tokens for a
 * given model. Used by quick-estimate callers (e.g., --dry-run); the
 * ingestion service uses the `enrichmentCostUsd` / `embeddingCostUsd`
 * helpers below to also split the cost into the per-dimension breakdown
 * the run summary persists.
 */
export function costForTokens(args: {
  model: string;
  inputTokens: number;
  outputTokens: number;
}): number {
  const p = priceFor(args.model);
  return (
    (args.inputTokens * p.input) / 1_000_000 +
    (args.outputTokens * p.output) / 1_000_000
  );
}

export function enrichmentCostUsd(args: {
  model: string;
  inputTokens: number;
  outputTokens: number;
}): { inputUsd: number; outputUsd: number; totalUsd: number } {
  const p = priceFor(args.model);
  const inputUsd = (args.inputTokens * p.input) / 1_000_000;
  const outputUsd = (args.outputTokens * p.output) / 1_000_000;
  return { inputUsd, outputUsd, totalUsd: inputUsd + outputUsd };
}

export function embeddingCostUsd(args: {
  model: string;
  tokens: number;
}): number {
  const p = priceFor(args.model);
  return (args.tokens * p.input) / 1_000_000;
}

