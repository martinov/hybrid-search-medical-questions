// @netea/db/migrations — Direct SQL migration runner.
//
// For the walking skeleton we bypass drizzle-kit's CLI-managed migration
// pipeline and apply the schema with a single idempotent SQL script. The
// schema in `schema.ts` is the SoT for ORM reads/writes; this migration
// builds the matching database objects (including the generated tsvector
// column + GIN/HNSW indexes that Drizzle cannot fully express in pg-core).
//
// Step 2+ should replace this with proper drizzle-kit migration files
// under `packages/db/drizzle/`. Until then, this gives us a reliable
// schema-bootstrap for the walking skeleton and the test suite.

import postgres from "postgres";

const BOOTSTRAP_SQL = `
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- IMMUTABLE wrapper around to_tsvector so it can be used in a generated
-- column expression. Pinning the regconfig inside the function body makes
-- the function deterministic regardless of default_text_search_config.
CREATE OR REPLACE FUNCTION immutable_to_tsvector(txt text)
RETURNS tsvector
LANGUAGE sql
IMMUTABLE
PARALLEL SAFE
AS $$ SELECT to_tsvector('pg_catalog.english'::regconfig, txt) $$;

CREATE TABLE IF NOT EXISTS questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  answers jsonb NOT NULL,
  explanation text NOT NULL,
  raw_input_hash text NOT NULL,
  raw_imported_at timestamptz NOT NULL DEFAULT now(),
  lifecycle_state text NOT NULL DEFAULT 'Raw',
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS enriched_questions (
  id uuid PRIMARY KEY,
  batch_id text NOT NULL,
  title text NOT NULL,
  content text NOT NULL,
  answers jsonb NOT NULL,
  explanation text NOT NULL,
  bloom_level text NOT NULL,
  keywords text[] NOT NULL,
  medical_specialty text NOT NULL,
  embedding vector(1536),
  tsv_content tsvector,
  prompt_version text NOT NULL,
  model text NOT NULL,
  model_temperature numeric(3,2) NOT NULL,
  embedding_model text NOT NULL,
  enriched_at timestamptz NOT NULL,
  retry_count integer NOT NULL DEFAULT 0,
  cost_usd numeric(10,6) NOT NULL DEFAULT 0,
  indexed_at timestamptz,
  needs_reenrichment boolean NOT NULL DEFAULT false,
  status text NOT NULL DEFAULT 'enriched',
  CHECK (bloom_level IN ('recall','application','analysis')),
  CHECK (status IN ('enriched','embedded','indexed'))
);

-- Trigger to populate tsv_content from title + content + keywords on
-- INSERT/UPDATE. Using a trigger rather than a GENERATED column because
-- to_tsvector() is not strictly IMMUTABLE per Postgres' planner rules.
CREATE OR REPLACE FUNCTION enriched_questions_tsv_update()
RETURNS trigger
LANGUAGE plpgsql
AS 'BEGIN
  NEW.tsv_content :=
    to_tsvector(''pg_catalog.english''::regconfig,
      coalesce(NEW.title, '''') || '' '' ||
      coalesce(NEW.content, '''') || '' '' ||
      coalesce(array_to_string(NEW.keywords, '' ''), '''')
    );
  RETURN NEW;
END;';

DROP TRIGGER IF EXISTS enriched_questions_tsv_trigger ON enriched_questions;
CREATE TRIGGER enriched_questions_tsv_trigger
BEFORE INSERT OR UPDATE OF title, content, keywords
ON enriched_questions
FOR EACH ROW EXECUTE FUNCTION enriched_questions_tsv_update();

CREATE INDEX IF NOT EXISTS enriched_questions_tsv_idx
  ON enriched_questions USING gin (tsv_content);

CREATE INDEX IF NOT EXISTS enriched_questions_embedding_idx
  ON enriched_questions USING hnsw (embedding vector_cosine_ops);

CREATE TABLE IF NOT EXISTS quarantine (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_question_id uuid NOT NULL,
  batch_id text NOT NULL,
  failure_kind text NOT NULL,
  raw_responses jsonb NOT NULL,
  parse_errors jsonb NOT NULL,
  last_validation_error jsonb,
  last_finish_reason text,
  prompt_version text NOT NULL,
  model text NOT NULL,
  quarantined_at timestamptz NOT NULL DEFAULT now(),
  triage_state text NOT NULL DEFAULT 'Awaiting',
  triage_notes text,
  title text NOT NULL
);

CREATE TABLE IF NOT EXISTS ingestion_batches (
  id text PRIMARY KEY,
  file_path text,
  started_at timestamptz NOT NULL,
  closed_at timestamptz,
  prompt_version text NOT NULL,
  model text NOT NULL,
  embedding_model text NOT NULL,
  expected_count integer NOT NULL,
  total_count integer NOT NULL DEFAULT 0,
  success_count integer NOT NULL DEFAULT 0,
  quarantine_count integer NOT NULL DEFAULT 0,
  validation_failed_count integer NOT NULL DEFAULT 0,
  total_cost_usd numeric(10,4) NOT NULL DEFAULT 0,
  max_cost_usd numeric(10,4),
  aborted_at timestamptz,
  abort_reason text
);

CREATE TABLE IF NOT EXISTS domain_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL,
  aggregate_type text NOT NULL,
  aggregate_id text NOT NULL,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  payload jsonb NOT NULL,
  prompt_version text,
  model text,
  correlation_id text
);
`;

export async function migrate(databaseUrl: string): Promise<void> {
  if (!databaseUrl) {
    throw new Error("migrate: databaseUrl is required");
  }
  const sql = postgres(databaseUrl, {
    max: 1,
    onnotice: () => {
      /* silent: bootstrap migration is idempotent, NOTICEs are noise */
    },
  });
  try {
    await sql.unsafe(BOOTSTRAP_SQL);
  } finally {
    await sql.end({ timeout: 5 });
  }
}
