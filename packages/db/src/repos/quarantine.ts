// @netea/db/repos/quarantine — Drizzle-backed repo + test fetchers for quarantine rows.

import type { FailureKind, QuarantineRow } from "@netea/schemas";
import { getDb } from "../client.js";

export type QuarantineRowOut = {
  id: string;
  source_question_id: string;
  batch_id: string;
  title: string;
  failure_kind: FailureKind;
  raw_responses: string[];
  parse_errors: string[];
  last_validation_error: unknown;
  last_finish_reason: string | null;
  prompt_version: string;
  model: string;
  quarantined_at: string;
};

export type QuarantineFilter = {
  batch_id?: string;
  title?: string;
};

export async function countQuarantine(
  filter?: QuarantineFilter,
): Promise<number> {
  const db = getDb();
  if (filter?.batch_id !== undefined) {
    const rows = await db.$client<{ c: string }[]>`
      SELECT COUNT(*)::text AS c FROM quarantine WHERE batch_id = ${filter.batch_id}
    `;
    return Number(rows[0]?.c ?? 0);
  }
  if (filter?.title !== undefined) {
    const rows = await db.$client<{ c: string }[]>`
      SELECT COUNT(*)::text AS c FROM quarantine WHERE title = ${filter.title}
    `;
    return Number(rows[0]?.c ?? 0);
  }
  const rows = await db.$client<{ c: string }[]>`
    SELECT COUNT(*)::text AS c FROM quarantine
  `;
  return Number(rows[0]?.c ?? 0);
}

export async function fetchQuarantineByTitle(
  title: string,
): Promise<QuarantineRowOut> {
  const db = getDb();
  const rows = await db.$client<QuarantineRowOut[]>`
    SELECT id, source_question_id, batch_id, title, failure_kind,
           raw_responses, parse_errors, last_validation_error,
           last_finish_reason, prompt_version, model,
           quarantined_at::text AS quarantined_at
    FROM quarantine WHERE title = ${title} LIMIT 1
  `;
  const row = rows[0];
  if (!row) throw new Error(`quarantine row not found: title=${title}`);
  return row;
}

export class QuarantineRepo {
  async insert(row: QuarantineRow & { title: string }): Promise<void> {
    const db = getDb();
    await db.$client`
      INSERT INTO quarantine (
        id, source_question_id, batch_id, failure_kind, raw_responses,
        parse_errors, last_validation_error, last_finish_reason,
        prompt_version, model, quarantined_at, triage_state,
        triage_notes, title
      ) VALUES (
        ${row.id},
        ${row.source_question_id},
        ${row.batch_id},
        ${row.failure_kind},
        ${JSON.stringify(row.raw_responses)}::jsonb,
        ${JSON.stringify(row.parse_errors)}::jsonb,
        ${JSON.stringify(row.last_validation_error ?? null)}::jsonb,
        ${row.last_finish_reason ?? null},
        ${row.prompt_version},
        ${row.model},
        ${new Date(row.quarantined_at).toISOString()},
        ${row.triage_state ?? "Awaiting"},
        ${row.triage_notes ?? null},
        ${row.title}
      )
    `;
  }
}
