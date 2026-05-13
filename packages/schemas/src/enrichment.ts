// @netea/schemas/enrichment — LLM enrichment + provenance + quarantine.
// Mirrors brief §App Arch 5.1. All boundary schemas use `.strict()` per ADR-010.
// TODO step 1+: when Zod 4 is GA, swap `zod-to-json-schema` for native `z.toJSONSchema()`.

import { z } from "zod";
import { BloomLevel } from "./bloom.js";

export const __SCAFFOLD__ = true as const;

// What the enrichment pipeline sends to the LLM.
export const EnrichmentInputSchema = z
  .object({
    question_id: z.string().uuid(),
    title: z.string().min(1).max(200),
    content: z.string().min(50),
    answers: z
      .array(
        z
          .object({
            content: z.string().min(1),
            is_correct: z.boolean(),
          })
          .strict(),
      )
      .min(2),
    explanation: z.string().min(1),
  })
  .strict();
export type EnrichmentInput = z.infer<typeof EnrichmentInputSchema>;

// What the LLM MUST produce. Submitted to OpenAI as JSON Schema for Structured
// Outputs. `.strict()` rejects hallucinated extra fields (silent schema drift).
// Refinements catch F3 (enum near-miss) and F5 (sparse keywords).
export const EnrichmentOutputSchema = z
  .object({
    bloom_level: BloomLevel,
    keywords: z
      .array(z.string().min(2).max(60))
      .min(3, "must provide at least 3 prominent keywords")
      .max(10, "must not exceed 10 keywords (avoid keyword stuffing)"),
    medical_specialty: z
      .string()
      .min(2)
      .max(80)
      .describe(
        "Primary clinical specialty (e.g., Cardiology, Endocrinology). Single-valued at PoC.",
      ),
    rationale: z
      .string()
      .min(20)
      .max(500)
      .optional()
      .describe(
        "Optional. Brief justification for the bloom_level + keyword choices. Debug aid only.",
      ),
  })
  .strict();
export type EnrichmentOutput = z.infer<typeof EnrichmentOutputSchema>;

// Provenance stamped on every persisted enriched row.
export const ProvenanceSchema = z
  .object({
    prompt_version: z.string().regex(/^v\d+(\.\d+)?$/, "must be 'v<digit>' or 'v<digit>.<digit>'"),
    model: z.string().min(1).describe("OpenAI model id"),
    model_temperature: z.number().min(0).max(2),
    embedding_model: z.string().min(1),
    enriched_at: z.string().datetime(),
    retry_count: z.number().int().min(0).max(5),
    cost_usd: z.number().nonnegative(),
  })
  .strict();
export type Provenance = z.infer<typeof ProvenanceSchema>;

// What gets persisted to enriched_questions (combines raw input + LLM output +
// provenance + embedding metadata; the vector itself does not pass through Zod).
export const EnrichedQuestionSchema = z
  .object({
    id: z.string().uuid(),
    batch_id: z.string(),
    title: z.string().min(1).max(200),
    content: z.string().min(50),
    answers: z
      .array(
        z
          .object({ content: z.string(), is_correct: z.boolean() })
          .strict(),
      )
      .min(2),
    explanation: z.string().min(1),
    raw_imported_at: z.string().datetime(),

    // From EnrichmentOutput
    bloom_level: BloomLevel,
    keywords: z.array(z.string().min(2).max(60)).min(3).max(10),
    medical_specialty: z.string().min(2).max(80),

    // Provenance
    prompt_version: z.string(),
    model: z.string(),
    model_temperature: z.number(),
    embedding_model: z.string(),
    enriched_at: z.string().datetime(),
    retry_count: z.number().int().min(0),

    // Re-enrichment flag (Expansion E §4 lazy policy)
    needs_reenrichment: z.boolean().default(false),

    // Lifecycle
    status: z.enum(["enriched", "embedded", "indexed"]),
    indexed_at: z.string().datetime().nullable(),
  })
  .strict();
export type EnrichedQuestion = z.infer<typeof EnrichedQuestionSchema>;

// Quarantine row — F1-F7 failure taxonomy at write time.
// F4 is intentionally NOT in the failure_kind enum (not detectable at write time).
export const QuarantineRowSchema = z
  .object({
    id: z.string().uuid(),
    source_question_id: z.string().uuid(),
    batch_id: z.string(),
    failure_kind: z.enum(["F1", "F2", "F3", "F5", "F6", "F7"]),
    raw_responses: z
      .array(z.string())
      .min(1)
      .describe("One per attempt, original + retries"),
    parse_errors: z
      .array(z.string())
      .min(1)
      .describe("One per attempt, usually Zod issue paths"),
    last_validation_error: z
      .unknown()
      .describe("The most recent Zod error tree, serialized as JSON"),
    last_finish_reason: z
      .string()
      .describe("OpenAI finish_reason on the last attempt"),
    prompt_version: z.string(),
    model: z.string(),
    quarantined_at: z.string().datetime(),
    triage_state: z
      .enum(["Awaiting", "UnderReview", "Resolved", "Dismissed"])
      .default("Awaiting"),
    triage_notes: z.string().nullable(),
  })
  .strict();
export type QuarantineRow = z.infer<typeof QuarantineRowSchema>;

export type FailureKind = QuarantineRow["failure_kind"];
