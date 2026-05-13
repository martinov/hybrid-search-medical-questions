// @netea/db/schema — Drizzle source-of-truth schema (per ADR-009).
// Mirrors brief §App Arch 6.1.

import { sql } from "drizzle-orm";
import {
  pgTable,
  text,
  jsonb,
  timestamp,
  integer,
  boolean,
  numeric,
  uuid,
  customType,
  index,
} from "drizzle-orm/pg-core";

// pgvector via customType. The driver writes/reads strings of the
// form `[v1,v2,...,vN]`; the parser keeps it numeric on the way back.
export const vector = customType<{ data: number[]; driverData: string }>({
  dataType() {
    return "vector(1536)";
  },
  toDriver(value: number[]): string {
    return `[${value.join(",")}]`;
  },
  fromDriver(value: string): number[] {
    if (Array.isArray(value)) return value as number[];
    const trimmed = String(value).trim();
    if (!trimmed.startsWith("[")) return [];
    return JSON.parse(trimmed);
  },
});

// Generated tsvector column. Drizzle has no first-class tsvector type, so
// we use customType+`text` shape and rely on the migration to declare the
// column as `GENERATED ALWAYS AS (...) STORED`.
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return "tsvector";
  },
});

// Raw questions (post-validation, pre-enrichment lifecycle)
export const questions = pgTable("questions", {
  id: uuid("id").primaryKey().defaultRandom(),
  batch_id: text("batch_id").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  answers: jsonb("answers").notNull(),
  explanation: text("explanation").notNull(),
  raw_input_hash: text("raw_input_hash").notNull(),
  raw_imported_at: timestamp("raw_imported_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  lifecycle_state: text("lifecycle_state").notNull().default("Raw"),
  updated_at: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// Enriched questions — the searchable corpus.
export const enriched_questions = pgTable(
  "enriched_questions",
  {
    id: uuid("id").primaryKey(),
    batch_id: text("batch_id").notNull(),
    title: text("title").notNull(),
    content: text("content").notNull(),
    answers: jsonb("answers").notNull(),
    explanation: text("explanation").notNull(),
    bloom_level: text("bloom_level").notNull(),
    keywords: text("keywords").array().notNull(),
    medical_specialty: text("medical_specialty").notNull(),
    embedding: vector("embedding"),
    tsv_content: tsvector("tsv_content"),
    prompt_version: text("prompt_version").notNull(),
    model: text("model").notNull(),
    model_temperature: numeric("model_temperature", {
      precision: 3,
      scale: 2,
    }).notNull(),
    embedding_model: text("embedding_model").notNull(),
    enriched_at: timestamp("enriched_at", { withTimezone: true }).notNull(),
    retry_count: integer("retry_count").notNull().default(0),
    cost_usd: numeric("cost_usd", { precision: 10, scale: 6 })
      .notNull()
      .default(sql`0`),
    indexed_at: timestamp("indexed_at", { withTimezone: true }),
    needs_reenrichment: boolean("needs_reenrichment").notNull().default(false),
    status: text("status").notNull().default("enriched"),
  },
  (table) => [
    index("enriched_questions_tsv_idx").using("gin", table.tsv_content),
    index("enriched_questions_embedding_idx").using(
      "hnsw",
      sql`${table.embedding} vector_cosine_ops`,
    ),
  ],
);

// Quarantine — F1-F7 failure parking lot.
export const quarantine = pgTable("quarantine", {
  id: uuid("id").primaryKey().defaultRandom(),
  source_question_id: uuid("source_question_id").notNull(),
  batch_id: text("batch_id").notNull(),
  failure_kind: text("failure_kind").notNull(),
  raw_responses: jsonb("raw_responses").notNull(),
  parse_errors: jsonb("parse_errors").notNull(),
  last_validation_error: jsonb("last_validation_error"),
  last_finish_reason: text("last_finish_reason"),
  prompt_version: text("prompt_version").notNull(),
  model: text("model").notNull(),
  quarantined_at: timestamp("quarantined_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  triage_state: text("triage_state").notNull().default("Awaiting"),
  triage_notes: text("triage_notes"),
  title: text("title").notNull(),
});

// Ingestion batches — run-level cohort metadata.
export const ingestion_batches = pgTable("ingestion_batches", {
  id: text("id").primaryKey(),
  file_path: text("file_path"),
  started_at: timestamp("started_at", { withTimezone: true }).notNull(),
  closed_at: timestamp("closed_at", { withTimezone: true }),
  prompt_version: text("prompt_version").notNull(),
  model: text("model").notNull(),
  embedding_model: text("embedding_model").notNull(),
  expected_count: integer("expected_count").notNull(),
  total_count: integer("total_count").notNull().default(0),
  success_count: integer("success_count").notNull().default(0),
  quarantine_count: integer("quarantine_count").notNull().default(0),
  validation_failed_count: integer("validation_failed_count")
    .notNull()
    .default(0),
  total_cost_usd: numeric("total_cost_usd", { precision: 10, scale: 4 })
    .notNull()
    .default(sql`0`),
  max_cost_usd: numeric("max_cost_usd", { precision: 10, scale: 4 }),
  aborted_at: timestamp("aborted_at", { withTimezone: true }),
  abort_reason: text("abort_reason"),
});

// Domain events — single table per ADR-011.
export const domain_events = pgTable("domain_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  event_type: text("event_type").notNull(),
  aggregate_type: text("aggregate_type").notNull(),
  aggregate_id: text("aggregate_id").notNull(),
  occurred_at: timestamp("occurred_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  payload: jsonb("payload").notNull(),
  prompt_version: text("prompt_version"),
  model: text("model"),
  correlation_id: text("correlation_id"),
});
