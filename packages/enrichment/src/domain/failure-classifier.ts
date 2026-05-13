// @netea/enrichment/domain/failure-classifier — Pure function mapping
// Zod errors + finish_reason → F1..F7 failure kind (per Expansion A §1).

import type { FailureKind } from "@netea/schemas";

export type ClassificationInput = {
  rawText: string;
  finishReason: string;
  parseError?: unknown;
};

/**
 * Map a single attempt's outcome to a failure kind (or null on success).
 *
 *   F1  invalid JSON (parse failed)
 *   F2  shape mismatch (extra/missing top-level fields)
 *   F3  enum near-miss (bloom_level not in PoC enum)
 *   F5  sparse keywords (< 3)
 *   F6  truncated (finish_reason=length)
 *   F7  refusal (finish_reason=content_filter or safety)
 *
 * Walking-skeleton scope: only the happy path + F6/F7 by finish_reason are
 * checked. Step 2 (US-02 / Slice 02) wires the full classifier.
 */
export function classifyFailure(
  input: ClassificationInput,
): FailureKind | null {
  if (input.finishReason === "length") return "F6";
  if (
    input.finishReason === "content_filter" ||
    input.finishReason === "content-filter" ||
    input.finishReason === "safety"
  ) {
    return "F7";
  }

  if (input.parseError != null) {
    // Best-effort: distinguish JSON parse failures (F1) from shape mismatches (F2/F3/F5).
    if (
      input.parseError instanceof SyntaxError ||
      (typeof input.parseError === "object" &&
        input.parseError !== null &&
        "name" in input.parseError &&
        (input.parseError as { name: string }).name === "SyntaxError")
    ) {
      return "F1";
    }
    return "F2";
  }

  return null;
}
