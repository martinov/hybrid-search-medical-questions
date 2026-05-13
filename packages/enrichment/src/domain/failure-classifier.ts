// @netea/enrichment/domain/failure-classifier — Pure function mapping
// raw output + Zod errors + finish_reason → F1..F7 failure kind (per Expansion A §1).
//
// F4 (off-by-one Bloom) is intentionally NOT detected here: it requires an
// out-of-band eval per Expansion A §3 and §6. F4 surfaces by accepting the
// row and surfacing the issue in downstream eval metrics.

import type { FailureKind } from "@netea/schemas";
import { ZodError } from "zod";

export type ClassificationInput = {
  rawText: string;
  finishReason: string;
  parseError?: unknown;
};

const STOP_FINISH_REASONS = new Set(["stop", "tool-calls", "tool_calls"]);
const REFUSAL_FINISH_REASONS = new Set([
  "content_filter",
  "content-filter",
  "safety",
]);

const REFUSAL_TEXT_PATTERNS = [
  /^\s*i cannot\b/i,
  /^\s*i'?m sorry\b/i,
  /^\s*i am unable\b/i,
  /\bcannot provide medical advice\b/i,
];

function isJsonSyntaxError(err: unknown): boolean {
  if (err instanceof SyntaxError) return true;
  if (typeof err === "object" && err !== null && "name" in err) {
    return (err as { name?: string }).name === "SyntaxError";
  }
  return false;
}

function zodIssuePaths(err: ZodError): string[] {
  return err.issues.map((issue) =>
    issue.path.length > 0 ? issue.path.join(".") : "(root)",
  );
}

function classifyZodError(err: ZodError): FailureKind {
  const issues = err.issues;
  // F3: enum near-miss on bloom_level. Zod 4 reports this as `invalid_value`.
  for (const issue of issues) {
    if (issue.path[0] === "bloom_level" && issue.code === "invalid_value") {
      return "F3";
    }
  }
  // F5: keywords below the minimum count (Zod 4 reports `too_small` on arrays).
  for (const issue of issues) {
    if (
      issue.path[0] === "keywords" &&
      (issue.code === "too_small" || issue.code === "too_big")
    ) {
      return "F5";
    }
  }
  // F2: any other shape mismatch (missing fields, extra fields, wrong types).
  return "F2";
}

/**
 * Map a single attempt's outcome to a failure kind (or null on success).
 *
 *   F1  invalid JSON (parse failed)
 *   F2  shape mismatch (missing/extra/wrong-type fields)
 *   F3  enum near-miss (bloom_level not in PoC enum)
 *   F5  sparse / oversized keywords (min 3, max 10)
 *   F6  truncated (finish_reason=length)
 *   F7  refusal (finish_reason=content_filter / safety / refusal-text pattern)
 *
 * F4 (off-by-one Bloom) is non-retryable and not detected here.
 */
export function classifyFailure(input: ClassificationInput): FailureKind | null {
  // F7 takes precedence — content filter / refusal text bypasses any other
  // signal because the response will never contain a parseable enrichment.
  if (REFUSAL_FINISH_REASONS.has(input.finishReason)) return "F7";
  if (
    !STOP_FINISH_REASONS.has(input.finishReason) &&
    input.finishReason === "refusal"
  ) {
    return "F7";
  }
  if (
    REFUSAL_TEXT_PATTERNS.some((re) => re.test(input.rawText.slice(0, 200)))
  ) {
    return "F7";
  }

  // F6 truncation — the prefix may still parse cleanly, but the provider
  // signalled an unfinished generation.
  if (input.finishReason === "length") return "F6";

  if (input.parseError != null) {
    if (isJsonSyntaxError(input.parseError)) return "F1";
    if (input.parseError instanceof ZodError) {
      return classifyZodError(input.parseError);
    }
    return "F2";
  }

  return null;
}

/**
 * Build a one-line human-readable parse error string for the quarantine row,
 * given the same classification input.
 */
export function describeFailure(input: ClassificationInput): string {
  if (input.parseError instanceof ZodError) {
    const paths = zodIssuePaths(input.parseError).join(",");
    const msg = input.parseError.issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
    return `ZodError paths=[${paths}] ${msg}`;
  }
  if (input.parseError instanceof Error) {
    return `${input.parseError.name}: ${input.parseError.message}`;
  }
  if (input.parseError != null) return String(input.parseError);
  if (input.finishReason === "length") return "truncated (finish_reason=length)";
  if (REFUSAL_FINISH_REASONS.has(input.finishReason)) {
    return `refusal (finish_reason=${input.finishReason})`;
  }
  return "ok";
}
