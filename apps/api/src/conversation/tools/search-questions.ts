// apps/api/src/conversation/tools/search-questions — Mastra tool for the
// chat Agent. Owns the conversation -> hybrid-search adapter.

import { createTool } from "@mastra/core/tools";
import { hybridSearch } from "@netea/search";
import { BloomLevel, type SearchQuery } from "@netea/schemas";
import { z } from "zod";
import type { EmbeddingModel } from "ai";

export type SearchQuestionsDeps = {
  embeddingModel: EmbeddingModel;
};

export function makeSearchQuestionsTool(deps: SearchQuestionsDeps) {
  return createTool({
    id: "searchQuestions",
    description:
      "Search the medical question bank for questions matching a clinical query. " +
      "Returns up to 5 questions with title, content, and bloom level. " +
      "Pass an optional bloom_level (recall|application|analysis) when the user " +
      "asks for a specific cognitive level. Returns no_match (or no_match_with_filter) " +
      "if nothing relevant exists — do NOT invent titles.",
    inputSchema: z.object({
      query: z
        .string()
        .min(1)
        .describe("Clinical-intent query phrased in natural language"),
      limit: z.number().int().min(1).max(10).default(5),
      bloom_level: BloomLevel.optional().describe(
        "Optional Bloom cognitive level filter. Use only when the user's " +
          "intent is clearly bound to one level.",
      ),
    }),
    execute: async (input) => {
      const args = input as {
        query: string;
        limit?: number;
        bloom_level?: "recall" | "application" | "analysis";
      };
      return hybridSearch(
        {
          query: args.query,
          limit: args.limit ?? 5,
          ...(args.bloom_level ? { bloom_level: args.bloom_level } : {}),
        } as SearchQuery,
        { embeddingModel: deps.embeddingModel },
      );
    },
  });
}
