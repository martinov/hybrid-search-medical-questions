// @netea/observability/pricing — OpenAI pricing table, USD per 1M tokens.
//
// IMPORTANT: assumed prices, verify against OpenAI pricing page before
// production. Per Expansion E §1 the rates here are documented as
// "assumed as of 2026-05-13" — if OpenAI shifts pricing, scale the totals
// linearly. The Slice 03 acceptance test pins these values:
//   gpt-4o-mini              $0.15 / 1M input,  $0.60 / 1M output
//   text-embedding-3-small   $0.02 / 1M input
//
// Keeping this as a tiny pure-data module (no I/O, no config lookup) means
// the cost arithmetic is the same in tests and in production — the only
// risk is that the rates here drift from the OpenAI billing page, which is
// a known limitation the comment above flags.

export type ModelPricing = {
  input: number; // USD per 1M input tokens
  output: number; // USD per 1M output tokens
};

/**
 * Pricing per 1M tokens. Verify against the OpenAI public pricing page
 * before any production commitment — these rates were captured 2026-05-13
 * and may have shifted.
 */
export const Pricing: Record<string, ModelPricing> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10.0 },
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

