// apps/api/src/conversation/tools/search-questions — Tool exposed to the
// Mastra agent (or AI SDK `streamText` fallback per ENRICH-DELIVER-01).

import { z } from "zod";
import { BloomLevel } from "@netea/schemas";

export const __SCAFFOLD__ = true as const;

export const searchQuestionsTool = {
  id: "search_questions" as const,
  description:
    "Search the medical question corpus by clinical-intent text. Returns up to " +
    "`limit` results ranked by hybrid (lexical + semantic) relevance. " +
    "Pass `bloom_level` (recall|application|analysis) to restrict to a single " +
    "cognitive level when the user's wording signals one (e.g. 'memorize' -> " +
    "recall, 'test my understanding' -> application, 'complex reasoning' -> " +
    "analysis). Returns kind:'no_match' if zero results, or " +
    "kind:'no_match' with reason:'no_match_with_filter' when a filter " +
    "eliminated all candidates.",
  inputSchema: z
    .object({
      query: z.string().min(1).max(500),
      limit: z.number().int().min(1).max(20).default(5),
      bloom_level: BloomLevel.optional(),
    })
    .strict(),
  // The runtime tool wiring lives in `apps/api/src/app.ts` per
  // ENRICH-DELIVER-01 (Mastra/Zod-4 peer-dep workaround). This module is the
  // shape-only declaration for future Mastra adoption.
  execute: async (_input: unknown) => {
    throw new Error(
      "searchQuestionsTool.execute: not wired here — see apps/api/src/app.ts",
    );
  },
} as const;
