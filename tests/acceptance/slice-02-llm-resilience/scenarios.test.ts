// RED-ready: imports resolve once DELIVER step 0 lands the scaffolds at the
// paths listed in feature-delta.md "Scaffolds" section.
//
// Strategy: real Postgres + real Drizzle + real ingestion service; LLM is
// MockLanguageModelV1 with a programmable response queue so we can sequence
// F1/F2/F3/F5/F6/F7 + 429 transport failures deterministically.

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MockLanguageModelV1, MockEmbeddingModelV1 } from "ai/test";

import { createIngestionService } from "@netea/ingestion-service";
import {
  countEnrichedQuestions,
  countQuarantine,
  fetchEnrichedQuestionByTitle,
  fetchQuarantineByTitle,
  resetCorpus,
} from "@netea/db/test-helpers";

type CallScript = Array<
  | { kind: "valid"; bloom: "recall" | "application" | "analysis"; keywords: string[]; specialty: string }
  | { kind: "invalid-json" }
  | { kind: "shape-mismatch" }
  | { kind: "bad-enum"; value: string }
  | { kind: "sparse-keywords"; keywords: string[] }
  | { kind: "truncated" }
  | { kind: "refusal" }
  | { kind: "rate-limit" }
>;

function makeMockLLM(script: Map<string /* question title */, CallScript>): MockLanguageModelV1 {
  const cursor = new Map<string, number>();
  return new MockLanguageModelV1({
    defaultObjectGenerationMode: "json",
    doGenerate: async ({ prompt }) => {
      const title = extractTitleFromPrompt(prompt); // helper provided by DELIVER step 0 scaffold
      const steps = script.get(title);
      if (!steps) throw new Error(`No script for ${title}`);
      const idx = cursor.get(title) ?? 0;
      cursor.set(title, idx + 1);
      const step = steps[Math.min(idx, steps.length - 1)];
      return renderStep(step); // helper provided by DELIVER step 0 scaffold
    },
  });
}

declare function extractTitleFromPrompt(prompt: unknown): string;
declare function renderStep(step: CallScript[number]): {
  finishReason: string;
  usage: { promptTokens: number; completionTokens: number };
  text: string;
  rawCall: { rawPrompt: null; rawSettings: object };
};

let sampleFilePath: string;
const SAMPLE_QUESTIONS = [
  { title: "Renal: AKI vs CKD" },
  { title: "Endocrinology: DKA" },
  { title: "Neurology: Acute Stroke" },
  { title: "Toxicology: Acetaminophen overdose" },
  { title: "Pulmonology: Acute Asthma" },
  { title: "Hematology: Anemia Workup" },
];

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "netea-slice02-"));
  sampleFilePath = join(dir, "sample-questions.json");
  // Each fixture-question contains at minimum a title, content ≥ 50 chars, ≥2 answers (1 correct), explanation
  writeFileSync(sampleFilePath, JSON.stringify(SAMPLE_QUESTIONS.map(makeFullQuestion)));
});

beforeEach(async () => {
  await resetCorpus();
});

declare function makeFullQuestion(stub: { title: string }): unknown; // DELIVER step 0 scaffold provides

describe("Given a clean batch of ten medical questions ready for enrichment", () => {
  it("When the model returns a valid enrichment on the first call for 'Renal: AKI vs CKD', then the row is stored with retry_count=0 and full provenance", async () => {
    const ingestion = createIngestionService({
      enrichmentModel: makeMockLLM(
        new Map([["Renal: AKI vs CKD", [{ kind: "valid", bloom: "analysis", keywords: ["AKI", "CKD", "creatinine", "FENa"], specialty: "Nephrology" }]]]),
      ),
      embeddingModel: new MockEmbeddingModelV1({ doEmbed: async ({ values }) => ({ embeddings: values.map(() => Array(1536).fill(0)) }) }),
    });

    await ingestion.ingestBatch({ filePath: sampleFilePath, onlyTitles: ["Renal: AKI vs CKD"] });

    const row = await fetchEnrichedQuestionByTitle("Renal: AKI vs CKD");
    expect(row.retry_count).toBe(0);
    expect(row.prompt_version).toMatch(/^v\d+/);
    expect(row.model).toBeTruthy();
    expect(row.enriched_at).toBeTruthy();
    expect(await countQuarantine({ title: "Renal: AKI vs CKD" })).toBe(0);
  });

  it("When the first response has Bloom='applying' (F3) and the second is valid, then row stored with retry_count=1", async () => {
    const ingestion = createIngestionService({
      enrichmentModel: makeMockLLM(
        new Map([
          [
            "Endocrinology: DKA",
            [
              { kind: "bad-enum", value: "applying" },
              { kind: "valid", bloom: "application", keywords: ["DKA", "insulin", "ketones", "anion gap"], specialty: "Endocrinology" },
            ],
          ],
        ]),
      ),
      embeddingModel: new MockEmbeddingModelV1({ doEmbed: async ({ values }) => ({ embeddings: values.map(() => Array(1536).fill(0)) }) }),
    });

    const result = await ingestion.ingestBatch({ filePath: sampleFilePath, onlyTitles: ["Endocrinology: DKA"] });
    const row = await fetchEnrichedQuestionByTitle("Endocrinology: DKA");
    expect(row.retry_count).toBe(1);
    expect(await countQuarantine({ title: "Endocrinology: DKA" })).toBe(0);
    expect(result.perQuestionLog.find((l) => l.title === "Endocrinology: DKA")?.events).toEqual([
      expect.objectContaining({ kind: "schema-retry", attempt: 1 }),
      expect.objectContaining({ kind: "ok" }),
    ]);
  });

  it("When three consecutive responses are invalid JSON (F1), then question is quarantined with failure_kind='F1' and three raw responses preserved", async () => {
    const ingestion = createIngestionService({
      enrichmentModel: makeMockLLM(new Map([["Neurology: Acute Stroke", Array(3).fill({ kind: "invalid-json" }) as CallScript]])),
      embeddingModel: new MockEmbeddingModelV1({ doEmbed: async ({ values }) => ({ embeddings: values.map(() => Array(1536).fill(0)) }) }),
    });

    await ingestion.ingestBatch({ filePath: sampleFilePath, onlyTitles: ["Neurology: Acute Stroke"] });

    expect(await countEnrichedQuestions({ title: "Neurology: Acute Stroke" })).toBe(0);
    const q = await fetchQuarantineByTitle("Neurology: Acute Stroke");
    expect(q.failure_kind).toBe("F1");
    expect(q.raw_responses).toHaveLength(3);
    expect(q.parse_errors).toHaveLength(3);
    expect(q.quarantined_at).toBeTruthy();
  });

  it("When the Bloom level is 'intermediate' (F3) three times, then question is quarantined with failure_kind='F3' and validation error names the enum", async () => {
    const ingestion = createIngestionService({
      enrichmentModel: makeMockLLM(new Map([["Endocrinology: DKA", Array(3).fill({ kind: "bad-enum", value: "intermediate" }) as CallScript]])),
      embeddingModel: new MockEmbeddingModelV1({ doEmbed: async ({ values }) => ({ embeddings: values.map(() => Array(1536).fill(0)) }) }),
    });

    await ingestion.ingestBatch({ filePath: sampleFilePath, onlyTitles: ["Endocrinology: DKA"] });

    const q = await fetchQuarantineByTitle("Endocrinology: DKA");
    expect(q.failure_kind).toBe("F3");
    expect(JSON.stringify(q.last_validation_error)).toMatch(/bloom_level/);
  });

  it("When the first call is a safety refusal (F7), then question is quarantined immediately with failure_kind='F7' and zero schema retries consumed", async () => {
    const ingestion = createIngestionService({
      enrichmentModel: makeMockLLM(new Map([["Toxicology: Acetaminophen overdose", [{ kind: "refusal" }]]])),
      embeddingModel: new MockEmbeddingModelV1({ doEmbed: async ({ values }) => ({ embeddings: values.map(() => Array(1536).fill(0)) }) }),
    });

    const result = await ingestion.ingestBatch({ filePath: sampleFilePath, onlyTitles: ["Toxicology: Acetaminophen overdose"] });

    const q = await fetchQuarantineByTitle("Toxicology: Acetaminophen overdose");
    expect(q.failure_kind).toBe("F7");
    expect(q.raw_responses).toHaveLength(1);
    expect(result.perQuestionLog.find((l) => l.title === "Toxicology: Acetaminophen overdose")?.events.filter((e) => e.kind === "schema-retry")).toHaveLength(0);
  });

  it("When first call is a 429 rate-limit and second is valid, then row stored with retry_count=0 and transport retry not counted toward schema budget", async () => {
    const ingestion = createIngestionService({
      enrichmentModel: makeMockLLM(
        new Map([
          [
            "Pulmonology: Acute Asthma",
            [{ kind: "rate-limit" }, { kind: "valid", bloom: "application", keywords: ["asthma", "albuterol", "bronchospasm"], specialty: "Pulmonology" }],
          ],
        ]),
      ),
      embeddingModel: new MockEmbeddingModelV1({ doEmbed: async ({ values }) => ({ embeddings: values.map(() => Array(1536).fill(0)) }) }),
    });

    const result = await ingestion.ingestBatch({ filePath: sampleFilePath, onlyTitles: ["Pulmonology: Acute Asthma"] });
    const row = await fetchEnrichedQuestionByTitle("Pulmonology: Acute Asthma");
    expect(row.retry_count).toBe(0); // schema retries, not transport retries
    expect(result.perQuestionLog.find((l) => l.title === "Pulmonology: Acute Asthma")?.events).toEqual(
      expect.arrayContaining([expect.objectContaining({ kind: "transport-retry" }), expect.objectContaining({ kind: "ok" })]),
    );
  });

  it("When the keyword list has only one keyword (F5) three times, then question is quarantined with failure_kind='F5'", async () => {
    const ingestion = createIngestionService({
      enrichmentModel: makeMockLLM(new Map([["Hematology: Anemia Workup", Array(3).fill({ kind: "sparse-keywords", keywords: ["anemia"] }) as CallScript]])),
      embeddingModel: new MockEmbeddingModelV1({ doEmbed: async ({ values }) => ({ embeddings: values.map(() => Array(1536).fill(0)) }) }),
    });

    await ingestion.ingestBatch({ filePath: sampleFilePath, onlyTitles: ["Hematology: Anemia Workup"] });
    const q = await fetchQuarantineByTitle("Hematology: Anemia Workup");
    expect(q.failure_kind).toBe("F5");
    expect(JSON.stringify(q.last_validation_error)).toMatch(/keyword|min/i);
  });

  it("When 7 succeed first-try, 2 succeed after one retry, 1 quarantines, then run summary matches DB counts and reports first-try-pass=70%", async () => {
    // Per-question scripts: seven first-try valid, two single-retry, one persistent failure.
    const script = new Map<string, CallScript>([
      ...["Renal: AKI vs CKD", "Pulmonology: Acute Asthma", "Cardiology: HF", "GI: PUD", "Derm: Psoriasis", "ID: Sepsis", "Hematology: Anemia Workup"].map<
        [string, CallScript]
      >((t) => [t, [{ kind: "valid", bloom: "application", keywords: ["a", "b", "c"], specialty: "General" }]]),
      ["Endocrinology: DKA", [{ kind: "bad-enum", value: "applying" }, { kind: "valid", bloom: "application", keywords: ["DKA", "ketones", "insulin"], specialty: "Endocrinology" }]],
      ["Neurology: Migraine", [{ kind: "shape-mismatch" }, { kind: "valid", bloom: "recall", keywords: ["migraine", "aura", "triptan"], specialty: "Neurology" }]],
      ["Neurology: Acute Stroke", Array(3).fill({ kind: "invalid-json" }) as CallScript],
    ]);

    const ingestion = createIngestionService({
      enrichmentModel: makeMockLLM(script),
      embeddingModel: new MockEmbeddingModelV1({ doEmbed: async ({ values }) => ({ embeddings: values.map(() => Array(1536).fill(0)) }) }),
    });

    const result = await ingestion.ingestBatch({ filePath: sampleFilePath });

    expect(result.summary.total).toBe(10);
    expect(result.summary.enrichedCount).toBe(9);
    expect(result.summary.quarantinedCount).toBe(1);
    expect(result.summary.firstTryPassPercent).toBe(70);
    expect(await countEnrichedQuestions({ batch_id: result.batchId })).toBe(9);
    expect(await countQuarantine({ batch_id: result.batchId })).toBe(1);
  });

  // Property-shaped invariant from .feature file's @property scenario
  it("[property] For any persistent enrichment failure, the question is NEVER in enriched_questions AND IS in quarantine", async () => {
    // Realised as a single concrete scenario here; DELIVER may upgrade to fast-check.
    const ingestion = createIngestionService({
      enrichmentModel: makeMockLLM(
        new Map<string, CallScript>([
          ["Neurology: Acute Stroke", Array(3).fill({ kind: "invalid-json" }) as CallScript],
          ["Endocrinology: DKA", Array(3).fill({ kind: "bad-enum", value: "intermediate" }) as CallScript],
          ["Hematology: Anemia Workup", Array(3).fill({ kind: "sparse-keywords", keywords: ["x"] }) as CallScript],
        ]),
      ),
      embeddingModel: new MockEmbeddingModelV1({ doEmbed: async ({ values }) => ({ embeddings: values.map(() => Array(1536).fill(0)) }) }),
    });

    await ingestion.ingestBatch({
      filePath: sampleFilePath,
      onlyTitles: ["Neurology: Acute Stroke", "Endocrinology: DKA", "Hematology: Anemia Workup"],
    });

    for (const title of ["Neurology: Acute Stroke", "Endocrinology: DKA", "Hematology: Anemia Workup"]) {
      expect(await countEnrichedQuestions({ title })).toBe(0);
      expect(await countQuarantine({ title })).toBe(1);
    }
  });
});
