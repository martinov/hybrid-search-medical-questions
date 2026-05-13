// @netea/db/repos/enriched-questions — Drizzle-backed repo + test fetchers.

import type { EnrichedQuestion } from "@netea/schemas";
import { getDb } from "../client.js";

export type EnrichedQuestionRow = {
  id: string;
  batch_id: string;
  title: string;
  content: string;
  bloom_level: string;
  keywords: string[];
  medical_specialty: string;
  prompt_version: string;
  model: string;
  enriched_at: string;
  retry_count: number;
  has_embedding: boolean;
  has_lexical_index: boolean;
  status: string;
};

export type CountFilter = {
  batch_id?: string;
  title?: string;
};

type DbRow = {
  id: string;
  batch_id: string;
  title: string;
  content: string;
  bloom_level: string;
  keywords: string[];
  medical_specialty: string;
  prompt_version: string;
  model: string;
  enriched_at: Date;
  retry_count: number;
  has_embedding: boolean;
  has_lexical_index: boolean;
  status: string;
};

function rowFromDb(row: DbRow): EnrichedQuestionRow {
  return {
    id: row.id,
    batch_id: row.batch_id,
    title: row.title,
    content: row.content,
    bloom_level: row.bloom_level,
    keywords: row.keywords,
    medical_specialty: row.medical_specialty,
    prompt_version: row.prompt_version,
    model: row.model,
    enriched_at:
      row.enriched_at instanceof Date
        ? row.enriched_at.toISOString()
        : String(row.enriched_at),
    retry_count: row.retry_count,
    has_embedding: row.has_embedding,
    has_lexical_index: row.has_lexical_index,
    status: row.status,
  };
}

const SELECT_COLS = /*sql*/ `
  id,
  batch_id,
  title,
  content,
  bloom_level,
  keywords,
  medical_specialty,
  prompt_version,
  model,
  enriched_at,
  retry_count,
  (embedding IS NOT NULL) AS has_embedding,
  (tsv_content IS NOT NULL) AS has_lexical_index,
  status
`;

export async function countEnrichedQuestions(
  filter?: CountFilter,
): Promise<number> {
  const db = getDb();
  if (filter?.batch_id !== undefined && filter?.title !== undefined) {
    const rows = await db.$client<{ c: string }[]>`
      SELECT COUNT(*)::text AS c FROM enriched_questions
      WHERE batch_id = ${filter.batch_id} AND title = ${filter.title}
    `;
    return Number(rows[0]?.c ?? 0);
  }
  if (filter?.batch_id !== undefined) {
    const rows = await db.$client<{ c: string }[]>`
      SELECT COUNT(*)::text AS c FROM enriched_questions WHERE batch_id = ${filter.batch_id}
    `;
    return Number(rows[0]?.c ?? 0);
  }
  if (filter?.title !== undefined) {
    const rows = await db.$client<{ c: string }[]>`
      SELECT COUNT(*)::text AS c FROM enriched_questions WHERE title = ${filter.title}
    `;
    return Number(rows[0]?.c ?? 0);
  }
  const rows = await db.$client<{ c: string }[]>`
    SELECT COUNT(*)::text AS c FROM enriched_questions
  `;
  return Number(rows[0]?.c ?? 0);
}

export async function fetchEnrichedQuestion(
  id: string,
): Promise<EnrichedQuestionRow> {
  const db = getDb();
  const rows = await db.$client<DbRow[]>`
    SELECT ${db.$client.unsafe(SELECT_COLS)}
    FROM enriched_questions WHERE id = ${id}
  `;
  const row = rows[0];
  if (!row) throw new Error(`enriched_question not found: id=${id}`);
  return rowFromDb(row);
}

export async function fetchEnrichedQuestionByTitle(
  title: string,
): Promise<EnrichedQuestionRow> {
  const db = getDb();
  const rows = await db.$client<DbRow[]>`
    SELECT ${db.$client.unsafe(SELECT_COLS)}
    FROM enriched_questions WHERE title = ${title}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) throw new Error(`enriched_question not found: title=${title}`);
  return rowFromDb(row);
}

export class EnrichedQuestionRepo {
  async insert(row: EnrichedQuestion & { embedding: number[] }): Promise<void> {
    const db = getDb();
    const embeddingLiteral = `[${row.embedding.join(",")}]`;
    const answersJson = JSON.stringify(row.answers);
    // postgres-js doesn't bind JS arrays as text[] cleanly; build the array
    // literal manually with proper escaping.
    const keywordsLiteral =
      "{" +
      row.keywords
        .map((k) => `"${k.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
        .join(",") +
      "}";
    await db.$client`
      INSERT INTO enriched_questions (
        id, batch_id, title, content, answers, explanation,
        bloom_level, keywords, medical_specialty, embedding,
        prompt_version, model, model_temperature, embedding_model,
        enriched_at, retry_count, needs_reenrichment, status, indexed_at
      ) VALUES (
        ${row.id},
        ${row.batch_id},
        ${row.title},
        ${row.content},
        ${answersJson}::jsonb,
        ${row.explanation},
        ${row.bloom_level},
        ${keywordsLiteral}::text[],
        ${row.medical_specialty},
        ${embeddingLiteral}::vector,
        ${row.prompt_version},
        ${row.model},
        ${row.model_temperature},
        ${row.embedding_model},
        ${new Date(row.enriched_at).toISOString()},
        ${row.retry_count},
        ${row.needs_reenrichment ?? false},
        ${row.status},
        ${row.indexed_at ? new Date(row.indexed_at).toISOString() : null}
      )
    `;
  }

  async findById(id: string): Promise<EnrichedQuestionRow | null> {
    try {
      return await fetchEnrichedQuestion(id);
    } catch {
      return null;
    }
  }
}
