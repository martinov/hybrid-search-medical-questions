// @netea/schemas/search — Search API contract. Mirrors brief §App Arch 5.3.
// The discriminated-union output is load-bearing for US-07 (no_match handling).

import { z } from "zod";
import { BloomLevel } from "./bloom.js";

export const __SCAFFOLD__ = true as const;

export const SearchQuerySchema = z
  .object({
    query: z.string().min(1).max(500, "query too long; max 500 chars"),
    limit: z.number().int().min(1).max(20).default(5),
    bloom_level: BloomLevel.optional(),
  })
  .strict();
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export const SearchAnswerSchema = z
  .object({
    content: z.string().min(1),
    is_correct: z.boolean(),
  })
  .strict();
export type SearchAnswer = z.infer<typeof SearchAnswerSchema>;

export const SearchResultItemSchema = z
  .object({
    id: z.string().uuid(),
    title: z.string(),
    content: z.string(),
    bloom_level: BloomLevel,
    medical_specialty: z.string(),
    score: z.number(),
    // Pedagogical payload (v2): answer choices + reference explanation. The
    // UI's `ResultCard` uses these for a two-step reveal (show options ->
    // reveal correct answer + explanation). Always present on results
    // sourced from the enriched_questions table.
    answers: z.array(SearchAnswerSchema).min(2),
    explanation: z.string().min(1),
  })
  .strict();
export type SearchResultItem = z.infer<typeof SearchResultItemSchema>;

export const SearchResultSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("results"),
      results: z.array(SearchResultItemSchema),
      total: z.number().int().min(1),
    })
    .strict(),
  z
    .object({
      kind: z.literal("no_match"),
      results: z.array(SearchResultItemSchema).length(0),
      reason: z.enum(["no_match", "no_match_with_filter"]),
    })
    .strict(),
]);
export type SearchResult = z.infer<typeof SearchResultSchema>;
