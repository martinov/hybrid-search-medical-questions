// @netea/db/repos/ingestion-batches — Run-level cohort persistence.

import { getDb } from "../client.js";

export type IngestionBatchRow = {
  id: string;
  file_path: string | null;
  started_at: string;
  closed_at: string | null;
  prompt_version: string;
  model: string;
  embedding_model: string;
  expected_count: number;
  total_count: number;
  success_count: number;
  quarantine_count: number;
  validation_failed_count: number;
  total_cost_usd: number;
  max_cost_usd: number | null;
  aborted_at: string | null;
  abort_reason: string | null;
};

export class IngestionBatchRepo {
  async open(
    params: Pick<
      IngestionBatchRow,
      | "id"
      | "file_path"
      | "prompt_version"
      | "model"
      | "embedding_model"
      | "expected_count"
    > & { max_cost_usd?: number | null },
  ): Promise<void> {
    const db = getDb();
    const startedAt = new Date().toISOString();
    await db.$client`
      INSERT INTO ingestion_batches (
        id, file_path, started_at, prompt_version, model, embedding_model,
        expected_count, max_cost_usd
      ) VALUES (
        ${params.id},
        ${params.file_path},
        ${startedAt},
        ${params.prompt_version},
        ${params.model},
        ${params.embedding_model},
        ${params.expected_count},
        ${params.max_cost_usd ?? null}
      )
    `;
  }

  async close(
    id: string,
    params: { aborted?: boolean; abort_reason?: string | null },
  ): Promise<void> {
    const db = getDb();
    const now = new Date().toISOString();
    await db.$client`
      UPDATE ingestion_batches
      SET closed_at = ${now},
          aborted_at = ${params.aborted ? now : null},
          abort_reason = ${params.abort_reason ?? null}
      WHERE id = ${id}
    `;
  }

  async findById(id: string): Promise<IngestionBatchRow | null> {
    const db = getDb();
    const rows = await db.$client<IngestionBatchRow[]>`
      SELECT * FROM ingestion_batches WHERE id = ${id}
    `;
    return rows[0] ?? null;
  }
}
