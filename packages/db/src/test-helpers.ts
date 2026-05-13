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

// === Seed-corpus fixtures ===

type SeedRow = {
  title: string;
  content: string;
  bloom_level: "recall" | "application" | "analysis";
  keywords: string[];
  medical_specialty: string;
};

function deterministicEmbedding(seed: string): number[] {
  // Tiny LCG-driven embedding so every seed-row gets a non-null,
  // deterministic but distinct 1536-d vector. We do not need cosine accuracy
  // here — the lexical leg drives ranking in tests.
  let s = 0;
  for (const ch of seed) s = (s * 1103515245 + ch.charCodeAt(0) + 12345) | 0;
  const out: number[] = new Array(1536);
  for (let i = 0; i < 1536; i++) {
    s = (s * 1103515245 + 12345) | 0;
    out[i] = ((s >>> 0) % 1000) / 100000; // small, bounded floats
  }
  return out;
}

async function insertSeedRows(rows: SeedRow[]): Promise<void> {
  await ensureMigrated();
  const db = getDb();
  const batchId = `seed-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  for (const row of rows) {
    const embedding = deterministicEmbedding(row.title);
    const embeddingLiteral = `[${embedding.join(",")}]`;
    const keywordsLiteral =
      "{" +
      row.keywords
        .map((k) => `"${k.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
        .join(",") +
      "}";
    const answersJson = JSON.stringify([
      { content: "Correct answer option", is_correct: true },
      { content: "Distractor option 1", is_correct: false },
      { content: "Distractor option 2", is_correct: false },
    ]);
    await db.$client`
      INSERT INTO enriched_questions (
        id, batch_id, title, content, answers, explanation,
        bloom_level, keywords, medical_specialty, embedding,
        prompt_version, model, model_temperature, embedding_model,
        enriched_at, retry_count, needs_reenrichment, status
      ) VALUES (
        gen_random_uuid(),
        ${batchId},
        ${row.title},
        ${row.content},
        ${answersJson}::jsonb,
        ${"Reference explanation for the clinically correct answer."},
        ${row.bloom_level},
        ${keywordsLiteral}::text[],
        ${row.medical_specialty},
        ${embeddingLiteral}::vector,
        ${"v1"},
        ${"mock-gpt-4o-mini"},
        ${0.0},
        ${"mock-text-embedding-3-small"},
        ${new Date().toISOString()},
        ${0},
        ${false},
        ${"indexed"}
      )
    `;
  }
}

const HEART_FAILURE_CONTENT =
  "A 68-year-old man presents with progressively worsening shortness of breath, " +
  "bilateral lower-extremity swelling, orthopnea, and elevated jugular venous " +
  "pressure consistent with acute decompensated heart failure.";

/**
 * Seed a heart-failure corpus spanning all three PoC Bloom levels:
 * 2 recall, 3 application, 2 analysis rows. Mirrors the comment in the
 * slice-04 scenarios file.
 */
export async function seedHeartFailureCorpus(): Promise<void> {
  const recallContent =
    "Heart failure: " + HEART_FAILURE_CONTENT + " The student should recall the classic findings.";
  const applicationContent =
    "Heart failure clinical case: " + HEART_FAILURE_CONTENT + " Apply the diagnostic criteria.";
  const analysisContent =
    "Heart failure differential analysis: " +
    HEART_FAILURE_CONTENT +
    " Analyze competing causes and integrate findings.";
  const rows: SeedRow[] = [
    {
      title: "Heart failure: Recall — Classic Triad",
      content: recallContent,
      bloom_level: "recall",
      keywords: ["heart failure", "JVD", "edema", "orthopnea"],
      medical_specialty: "Cardiology",
    },
    {
      title: "Heart failure: Recall — Drug Classes",
      content:
        "Heart failure pharmacology recall: name the four cornerstone drug " +
        "classes for guideline-directed medical therapy in heart failure with " +
        "reduced ejection fraction.",
      bloom_level: "recall",
      keywords: ["heart failure", "GDMT", "ARNi", "beta-blocker"],
      medical_specialty: "Cardiology",
    },
    {
      title: "Heart failure: Application — Acute Decompensation",
      content: applicationContent,
      bloom_level: "application",
      keywords: ["heart failure", "diuretic", "decompensation", "JVD"],
      medical_specialty: "Cardiology",
    },
    {
      title: "Heart failure: Application — Outpatient Titration",
      content:
        "Heart failure application case: a stable outpatient with HFrEF on " +
        "low-dose carvedilol presents for titration; apply the guideline " +
        "uptitration algorithm to select the next dose.",
      bloom_level: "application",
      keywords: ["heart failure", "HFrEF", "carvedilol", "titration"],
      medical_specialty: "Cardiology",
    },
    {
      title: "Heart failure: Application — Diuretic Resistance",
      content:
        "Heart failure application case: a patient with worsening heart failure " +
        "despite escalating loop diuretic — apply a strategy for diuretic " +
        "resistance including sequential nephron blockade.",
      bloom_level: "application",
      keywords: ["heart failure", "diuretic resistance", "metolazone"],
      medical_specialty: "Cardiology",
    },
    {
      title: "Heart failure: Analysis — HFrEF vs HFpEF",
      content: analysisContent,
      bloom_level: "analysis",
      keywords: ["heart failure", "HFpEF", "HFrEF", "differential"],
      medical_specialty: "Cardiology",
    },
    {
      title: "Heart failure: Analysis — Mimics",
      content:
        "Heart failure analysis: a patient presents with dyspnea and edema; " +
        "analyze the clues that distinguish heart failure from constrictive " +
        "pericarditis, cirrhosis, and nephrotic syndrome.",
      bloom_level: "analysis",
      keywords: ["heart failure", "constrictive pericarditis", "cirrhosis"],
      medical_specialty: "Cardiology",
    },
  ];
  await insertSeedRows(rows);
}

/**
 * Seed a DKA corpus with ONLY application-level questions. Used to prove the
 * "empty filtered set" path: a filter for evaluation-level DKA must return
 * no_match_with_filter rather than silently swapping to another level.
 */
export async function seedDkaCorpusApplicationOnly(): Promise<void> {
  const baseContent =
    "A 22-year-old type 1 diabetic presents with nausea, vomiting, Kussmaul " +
    "respirations, and serum glucose 480 mg/dL. Apply the diagnostic and " +
    "management framework for diabetic ketoacidosis.";
  const rows: SeedRow[] = [
    {
      title: "DKA: Application — Initial Fluid Strategy",
      content: baseContent + " Initial fluid resuscitation is the priority.",
      bloom_level: "application",
      keywords: ["DKA", "diabetic ketoacidosis", "fluid resuscitation"],
      medical_specialty: "Endocrinology",
    },
    {
      title: "DKA: Application — Insulin Drip Titration",
      content: baseContent + " Apply the insulin drip titration protocol.",
      bloom_level: "application",
      keywords: ["DKA", "insulin", "titration", "anion gap"],
      medical_specialty: "Endocrinology",
    },
    {
      title: "DKA: Application — Electrolyte Management",
      content: baseContent + " Apply potassium repletion guidance during DKA management.",
      bloom_level: "application",
      keywords: ["DKA", "potassium", "electrolytes"],
      medical_specialty: "Endocrinology",
    },
  ];
  await insertSeedRows(rows);
}

/**
 * Seed a Sjogren-neurological-complications corpus with exactly two questions.
 * Used by Slice 06 (US-07) to verify that when the user opts into a
 * reformulation, the agent's fresh search resolves both seeded items.
 */
export async function seedSjogrenNeurologicalCorpus(): Promise<void> {
  const baseContent =
    "A 47-year-old woman with longstanding Sjogren syndrome presents with " +
    "progressive sensory ataxia and impaired proprioception. MRI of the " +
    "cervical spine shows T2 hyperintensity in the dorsal columns consistent " +
    "with Sjogren-related neurological complications.";
  const rows: SeedRow[] = [
    {
      title: "Sjogren: Neurological Complications — Sensory Ganglionopathy",
      content:
        baseContent +
        " Recognize sensory ganglionopathy as a hallmark neurological " +
        "complication of Sjogren syndrome and identify its electrodiagnostic " +
        "features.",
      bloom_level: "application",
      keywords: [
        "Sjogren",
        "neurological complications",
        "sensory ganglionopathy",
        "dorsal column",
      ],
      medical_specialty: "Neurology",
    },
    {
      title: "Sjogren: Neurological Complications — Posterior Column Involvement",
      content:
        baseContent +
        " Apply the diagnostic workup for posterior-column degeneration in a " +
        "patient with Sjogren syndrome and distinguish it from B12 deficiency " +
        "and tabes dorsalis.",
      bloom_level: "analysis",
      keywords: [
        "Sjogren",
        "neurological complications",
        "posterior column",
        "differential",
      ],
      medical_specialty: "Neurology",
    },
  ];
  await insertSeedRows(rows);
}
