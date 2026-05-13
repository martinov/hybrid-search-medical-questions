// @netea/enrichment/domain/retry-policy — Pure decision matrix per
// Expansion A §3. Maps (failure kind, attempt, budget) → next action.
//
// Three regimes (Expansion A §1):
//   - schema-retry budget for F1/F2/F3/F5/F6 (default 2 retries → 3 attempts)
//   - transport-retry budget for 429/5xx/network (separate counter)
//   - no-retry-quarantine for F7 (safety refusal)
//
// F4 is intentionally absent — non-detectable at write time.

import type { FailureKind } from "@netea/schemas";

export type RetryAction =
  | { action: "retry"; feedback: string }
  | { action: "quarantine"; reason: string }
  | { action: "accept" };

export type RetryDecisionInput = {
  failureKind: FailureKind | null;
  attempt: number; // 1-indexed (1 = first call, 2 = first retry, ...)
  maxAttempts: number; // default 3 (1 initial + 2 retries)
  lastErrorMessage?: string;
};

const ALLOWED_BLOOMS = "remember, understand, apply, analyze, evaluate, create";

function feedbackFor(kind: FailureKind, lastError?: string): string {
  switch (kind) {
    case "F1":
      return (
        "Your previous response was not valid JSON. " +
        "Respond ONLY with a single JSON object matching the EnrichmentOutput schema. " +
        "Do not include any prose, markdown fences, or trailing commentary."
      );
    case "F2":
      return (
        "Your previous response did not match the required schema. " +
        (lastError ? `Validation error: ${lastError}. ` : "") +
        "Required fields: bloom_level (string), keywords (string array of length 3-10), medical_specialty (string). " +
        "Do not include any extra fields."
      );
    case "F3":
      return (
        "Your previous response used an invalid Bloom level. " +
        `Allowed values are exactly: ${ALLOWED_BLOOMS} (lowercase, no synonyms). ` +
        (lastError ? `Validation error: ${lastError}. ` : "") +
        "Choose the single most appropriate level from this list."
      );
    case "F5":
      return (
        "Your previous response had too few keywords. " +
        "Provide at least 3 distinct medical-domain keywords (max 10), each 2-60 characters. " +
        (lastError ? `Validation error: ${lastError}.` : "")
      );
    case "F6":
      return (
        "Your previous response was truncated before completing the JSON object. " +
        "Keep your output concise and ensure the JSON object is complete and well-formed."
      );
    default:
      return "Please retry with a valid response.";
  }
}

export function decideRetry(input: RetryDecisionInput): RetryAction {
  const { failureKind, attempt, maxAttempts, lastErrorMessage } = input;
  if (failureKind == null) return { action: "accept" };

  // F7 is non-retryable per Expansion A decision matrix.
  if (failureKind === "F7") {
    return { action: "quarantine", reason: "model_refusal" };
  }

  // F1, F2, F3, F5, F6 are all schema-retryable.
  if (attempt >= maxAttempts) {
    return {
      action: "quarantine",
      reason: `schema_retry_budget_exhausted (${failureKind})`,
    };
  }
  return { action: "retry", feedback: feedbackFor(failureKind, lastErrorMessage) };
}

/**
 * Classify a thrown error as transport-retryable. Used by the application
 * service to choose whether to consume the transport budget vs schema budget.
 */
export function isTransportError(err: unknown): boolean {
  if (err == null) return false;
  const e = err as {
    isRetryable?: boolean;
    statusCode?: number;
    status?: number;
    name?: string;
    code?: string | number;
  };
  if (e.isRetryable === true) return true;
  const status = e.statusCode ?? e.status;
  if (typeof status === "number" && (status === 429 || status >= 500)) return true;
  if (
    typeof e.code === "string" &&
    ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED", "EAI_AGAIN"].includes(e.code)
  ) {
    return true;
  }
  return false;
}
