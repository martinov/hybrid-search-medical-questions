// @netea/db/test-helpers — Test-scoped helpers consumed by tests/acceptance/*.

import { getDb } from "./client.js";
import { migrate } from "./migrations.js";

export {
  countEnrichedQuestions,
  fetchEnrichedQuestion,
  fetchEnrichedQuestionByTitle,
} from "./repos/enriched-questions.js";
export type {
  EnrichedQuestionRow,
  CountFilter,
} from "./repos/enriched-questions.js";

export { countQuarantine, fetchQuarantineByTitle } from "./repos/quarantine.js";
export type {
  QuarantineRowOut,
  QuarantineFilter,
} from "./repos/quarantine.js";

let migrationApplied = false;

function databaseUrl(): string {
  return (
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgresql://netea:netea@localhost:5433/netea_test"
  );
}

async function ensureMigrated(): Promise<void> {
  if (migrationApplied) return;
  await migrate(databaseUrl());
  migrationApplied = true;
}

/**
 * Truncate every domain table. Called from `beforeEach` in every acceptance test.
 */
export async function resetCorpus(): Promise<void> {
  await ensureMigrated();
  const db = getDb();
  await db.$client.unsafe(
    "TRUNCATE TABLE questions, enriched_questions, quarantine, ingestion_batches, domain_events RESTART IDENTITY CASCADE",
  );
}

/**
 * Return every distinct enriched-question title in the live corpus.
 */
export async function getAllCorpusTitles(): Promise<string[]> {
  const db = getDb();
  const rows = await db.$client<{ title: string }[]>`
    SELECT DISTINCT title FROM enriched_questions
  `;
  return rows.map((r) => r.title);
}

// === Seed-corpus fixtures (out of scope for step 1; remain unimplemented) ===

export async function seedHeartFailureCorpus(): Promise<void> {
  throw new Error("seedHeartFailureCorpus: not implemented (Slice 04/05 scope)");
}

export async function seedDkaCorpusApplicationOnly(): Promise<void> {
  throw new Error("seedDkaCorpusApplicationOnly: not implemented (Slice 04 scope)");
}

export async function seedSjogrenNeurologicalCorpus(): Promise<void> {
  throw new Error("seedSjogrenNeurologicalCorpus: not implemented (Slice 06 scope)");
}
