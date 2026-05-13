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
    "Returns kind:'no_match' if zero results.",
  inputSchema: z
    .object({
      query: z.string().min(1).max(500),
      limit: z.number().int().min(1).max(20).default(5),
      bloom_level: BloomLevel.optional(),
    })
    .strict(),
  // outputSchema and execute wired in step 1+.
  execute: async (_input: unknown) => {
    throw new Error("Not yet implemented — RED scaffold");
  },
} as const;
