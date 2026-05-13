// @netea/search/infrastructure/pg-semantic — Postgres pgvector semantic search.
//
// Uses cosine distance (`embedding <=> ?::vector`) ordered ASC.

import { getDb } from "@netea/db";
import type { Hit } from "../domain/rrf.js";
import type { SemanticSearchPort } from "../application/ports.js";

export class SemanticSearchAdapter implements SemanticSearchPort {
  async search(args: {
    queryVector: number[];
    limit: number;
    bloom_level?: string;
  }): Promise<Hit[]> {
    const db = getDb();
    const limit = Math.max(1, Math.min(args.limit, 50));
    const vec = `[${args.queryVector.join(",")}]`;
    const rows = args.bloom_level
      ? await db.$client<{ id: string }[]>`
          SELECT id
          FROM enriched_questions
          WHERE embedding IS NOT NULL AND bloom_level = ${args.bloom_level}
          ORDER BY embedding <=> ${vec}::vector ASC
          LIMIT ${limit}
        `
      : await db.$client<{ id: string }[]>`
          SELECT id
          FROM enriched_questions
          WHERE embedding IS NOT NULL
          ORDER BY embedding <=> ${vec}::vector ASC
          LIMIT ${limit}
        `;
    return rows.map((r, i) => ({ id: r.id, rank: i + 1 }));
  }
}
