// @netea/observability/pricing — OpenAI pricing table, USD per 1M tokens.
// Source: OpenAI public pricing as of 2026-05-13.
// Update when models drift; the test suite asserts specific costs (Slice 03).

export const __SCAFFOLD__ = true as const;

export type ModelPricing = {
  input: number; // USD per 1M input tokens
  output: number; // USD per 1M output tokens
};

/**
 * Pricing per 1M tokens. The Slice 03 test references these values:
 *   gpt-4o-mini:        $0.15 in / $0.60 out
 *   text-embedding-3-small: $0.02 in (no output)
 */
export const Pricing: Record<string, ModelPricing> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
  "gpt-4o": { input: 2.5, output: 10.0 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
  "text-embedding-3-large": { input: 0.13, output: 0 },
} as const;

export function costForTokens(args: {
  model: string;
  inputTokens: number;
  outputTokens: number;
}): number {
  const p = Pricing[args.model];
  if (!p) throw new Error(`Unknown model in pricing table: ${args.model}`);
  return (
    (args.inputTokens * p.input) / 1_000_000 +
    (args.outputTokens * p.output) / 1_000_000
  );
}
