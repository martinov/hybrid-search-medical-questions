// @netea/search/infrastructure/pg-lexical — Postgres lexical search.
//
// Uses `plainto_tsquery` over the generated `tsv_content` column (GIN index)
// and returns 1-based ranks suitable for RRF fusion.

import { getDb } from "@netea/db";
import type { Hit } from "../domain/rrf.js";
import type { LexicalSearchPort } from "../application/ports.js";

export class LexicalSearchAdapter implements LexicalSearchPort {
  async search(args: {
    query: string;
    limit: number;
    bloom_level?: string;
  }): Promise<Hit[]> {
    const db = getDb();
    const limit = Math.max(1, Math.min(args.limit, 50));
    const rows = args.bloom_level
      ? await db.$client<{ id: string }[]>`
          SELECT id, ts_rank(tsv_content, plainto_tsquery('pg_catalog.english'::regconfig, ${args.query})) AS rank
          FROM enriched_questions
          WHERE tsv_content @@ plainto_tsquery('pg_catalog.english'::regconfig, ${args.query})
            AND bloom_level = ${args.bloom_level}
          ORDER BY rank DESC
          LIMIT ${limit}
        `
      : await db.$client<{ id: string }[]>`
          SELECT id, ts_rank(tsv_content, plainto_tsquery('pg_catalog.english'::regconfig, ${args.query})) AS rank
          FROM enriched_questions
          WHERE tsv_content @@ plainto_tsquery('pg_catalog.english'::regconfig, ${args.query})
          ORDER BY rank DESC
          LIMIT ${limit}
        `;
    return rows.map((r, i) => ({ id: r.id, rank: i + 1 }));
  }
}
