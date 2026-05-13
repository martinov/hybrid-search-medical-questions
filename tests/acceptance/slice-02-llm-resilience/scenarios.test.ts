// Slice 02 — LLM enrichment resilience acceptance tests.
//
// Adapted to the AI SDK 6 mock API surface (see slice-01 for V3 patterns):
//   - MockLanguageModelV3 / MockEmbeddingModelV3 from `ai/test`.
//   - doGenerate input: { prompt: LanguageModelV3Prompt } where Prompt is
//     Array<LanguageModelV3Message>; system content is a string, user content
//     is Array<{type:'text',text}>. Step 1's prompt format is one combined
//     user message with `Title: <title>` on the first line.
//   - doGenerate result: { content: [{type:'text',text}], finishReason:
//     {unified, raw}, usage: {inputTokens:{total},outputTokens:{total},totalTokens},
//     warnings: [] }
//
// Strategy: real Postgres + real Drizzle + real ingestion service; LLM is
// MockLanguageModelV3 with a programmable response queue so we can sequence
// F1/F2/F3/F5/F6/F7 + 429 transport failures deterministically.

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { writeFileSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MockLanguageModelV3, MockEmbeddingModelV3 } from "ai/test";
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3GenerateResult,
  LanguageModelV3Prompt,
} from "@ai-sdk/provider";

import { createIngestionService } from "@netea/ingestion-service";
import {
  countEnrichedQuestions,
  countQuarantine,
  fetchEnrichedQuestionByTitle,
  fetchQuarantineByTitle,
  resetCorpus,
} from "@netea/db/test-helpers";

type CallScript = Array<
  | {
      kind: "valid";
      bloom: "recall" | "application" | "analysis";
      keywords: string[];
      specialty: string;
    }
  | { kind: "invalid-json" }
  | { kind: "shape-mismatch" }
  | { kind: "bad-enum"; value: string }
  | { kind: "sparse-keywords"; keywords: string[] }
  | { kind: "truncated" }
  | { kind: "refusal" }
  | { kind: "rate-limit" }
>;

function v3UsageFromTokens(inputTokens: number, outputTokens: number) {
  return {
    inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: outputTokens, reasoning: 0 },
    totalTokens: inputTokens + outputTokens,
  };
}

function extractTitleFromPrompt(prompt: LanguageModelV3Prompt): string {
  // Step 1's prompt template puts `Title: <title>` on the first line of the
  // user message. AI SDK's generateObject wraps our `prompt` string into a
  // single user message with one text part.
  for (const message of prompt) {
    if (message.role === "user") {
      for (const part of message.content) {
        if (part.type === "text") {
          const match = part.text.match(/^Title:\s*(.+)$/m);
          if (match && match[1]) return match[1].trim();
        }
      }
    }
  }
  throw new Error("No title found in prompt");
}

function renderStep(step: CallScript[number]): LanguageModelV3GenerateResult {
  const stop = { unified: "stop" as const, raw: "stop" };
  const length = { unified: "length" as const, raw: "length" };
  const contentFilter = { unified: "content-filter" as const, raw: "content_filter" };
  const usage = v3UsageFromTokens(900, 80);

  switch (step.kind) {
    case "valid": {
      const text = JSON.stringify({
        bloom_level: step.bloom,
        keywords: step.keywords,
        medical_specialty: step.specialty,
      });
      return {
        content: [{ type: "text", text }],
        finishReason: stop,
        usage,
        warnings: [],
      };
    }
    case "invalid-json": {
      return {
        content: [{ type: "text", text: '{"bloom_level": "recall", "keywords":' }],
        finishReason: stop,
        usage,
        warnings: [],
      };
    }
    case "shape-mismatch": {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              bloomLevel: "recall",
              keywordsList: ["a", "b", "c"],
              specialty: "General",
            }),
          },
        ],
        finishReason: stop,
        usage,
        warnings: [],
      };
    }
    case "bad-enum": {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              bloom_level: step.value,
              keywords: ["a", "b", "c"],
              medical_specialty: "Endocrinology",
            }),
          },
        ],
        finishReason: stop,
        usage,
        warnings: [],
      };
    }
    case "sparse-keywords": {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              bloom_level: "recall",
              keywords: step.keywords,
              medical_specialty: "Hematology",
            }),
          },
        ],
        finishReason: stop,
        usage,
        warnings: [],
      };
    }
    case "truncated": {
      return {
        content: [{ type: "text", text: '{"bloom_level": "recall"' }],
        finishReason: length,
        usage,
        warnings: [],
      };
    }
    case "refusal": {
      return {
        content: [
          {
            type: "text",
            text: "I cannot provide medical advice on this question.",
          },
        ],
        finishReason: contentFilter,
        usage,
        warnings: [],
      };
    }
    case "rate-limit": {
      // Sentinel: the mock layer must THROW for this step, not return a
      // result, so the AI SDK retry / transport layer sees an error.
      throw new RateLimitMockError("Mock rate limit (429)");
    }
  }
}

class RateLimitMockError extends Error {
  readonly isRetryable = true;
  readonly statusCode = 429;
  constructor(message: string) {
    super(message);
    this.name = "RateLimitMockError";
  }
}

function makeMockLLM(script: Map<string, CallScript>): LanguageModelV3 {
  const cursor = new Map<string, number>();
  return new MockLanguageModelV3({
    modelId: "mock-gpt-4o-mini",
    provider: "mock",
    doGenerate: async (opts: LanguageModelV3CallOptions) => {
      const title = extractTitleFromPrompt(opts.prompt);
      const steps = script.get(title);
      if (!steps) throw new Error(`No script for ${title}`);
      const idx = cursor.get(title) ?? 0;
      cursor.set(title, idx + 1);
      const step = steps[Math.min(idx, steps.length - 1)]!;
      return renderStep(step);
    },
  });
}

const FULL_CONTENT =
  "A detailed medical question stem of sufficient length to satisfy the " +
  "RawQuestionSchema minimum length requirement of fifty characters. " +
  "The clinical vignette would typically include patient history, " +
  "physical findings, and an investigative question.";

const SAMPLE_QUESTIONS = [
  { title: "Renal: AKI vs CKD" },
  { title: "Endocrinology: DKA" },
  { title: "Neurology: Acute Stroke" },
  { title: "Toxicology: Acetaminophen overdose" },
  { title: "Pulmonology: Acute Asthma" },
  { title: "Hematology: Anemia Workup" },
  { title: "Cardiology: HF" },
  { title: "GI: PUD" },
  { title: "Derm: Psoriasis" },
  { title: "ID: Sepsis" },
  { title: "Neurology: Migraine" },
];

function makeFullQuestion(stub: { title: string }) {
  return {
    title: stub.title,
    content: FULL_CONTENT,
    answers: [
      { content: "Correct option for this question", is_correct: true },
      { content: "Distractor option one", is_correct: false },
      { content: "Distractor option two", is_correct: false },
    ],
    explanation: "Reference explanation for the clinically correct answer.",
  };
}

let sampleFilePath: string;

beforeAll(() => {
  (
    globalThis as { AI_SDK_LOG_WARNINGS?: false | ((..._a: unknown[]) => void) }
  ).AI_SDK_LOG_WARNINGS = false;
  const dir = mkdtempSync(join(tmpdir(), "netea-slice02-"));
  sampleFilePath = join(dir, "sample-questions.json");
  writeFileSync(sampleFilePath, JSON.stringify(SAMPLE_QUESTIONS.map(makeFullQuestion)));
});

beforeEach(async () => {
  await resetCorpus();
});

function defaultEmbedding() {
  return new MockEmbeddingModelV3({
    modelId: "mock-text-embedding-3-small",
    provider: "mock",
    maxEmbeddingsPerCall: 100,
    doEmbed: async ({ values }) => ({
      embeddings: values.map(() => Array.from({ length: 1536 }, () => 0.001)),
      usage: { tokens: values.length * 10 },
      warnings: [],
    }),
  });
}

describe("Given a clean batch of medical questions ready for enrichment", () => {
  it("When the model returns a valid enrichment on the first call for 'Renal: AKI vs CKD', then the row is stored with retry_count=0 and full provenance", async () => {
    const ingestion = createIngestionService({
      enrichmentModel: makeMockLLM(
        new Map([
          [
            "Renal: AKI vs CKD",
            [
              {
                kind: "valid",
                bloom: "analysis",
                keywords: ["AKI", "CKD", "creatinine", "FENa"],
                specialty: "Nephrology",
              },
            ],
          ],
        ]),
      ),
      embeddingModel: defaultEmbedding(),
    });

    await ingestion.ingestBatch({
      filePath: sampleFilePath,
      onlyTitles: ["Renal: AKI vs CKD"],
    });

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
              {
                kind: "valid",
                bloom: "application",
                keywords: ["DKA", "insulin", "ketones", "anion gap"],
                specialty: "Endocrinology",
              },
            ],
          ],
        ]),
      ),
      embeddingModel: defaultEmbedding(),
    });

    const result = await ingestion.ingestBatch({
      filePath: sampleFilePath,
      onlyTitles: ["Endocrinology: DKA"],
    });
    const row = await fetchEnrichedQuestionByTitle("Endocrinology: DKA");
    expect(row.retry_count).toBe(1);
    expect(await countQuarantine({ title: "Endocrinology: DKA" })).toBe(0);
    expect(
      result.perQuestionLog.find((l) => l.title === "Endocrinology: DKA")?.events,
    ).toEqual([
      expect.objectContaining({ kind: "schema-retry", attempt: 1 }),
      expect.objectContaining({ kind: "ok" }),
    ]);
  });

  it("When three consecutive responses are invalid JSON (F1), then question is quarantined with failure_kind='F1' and three raw responses preserved", async () => {
    const ingestion = createIngestionService({
      enrichmentModel: makeMockLLM(
        new Map([
          [
            "Neurology: Acute Stroke",
            Array(3).fill({ kind: "invalid-json" }) as CallScript,
          ],
        ]),
      ),
      embeddingModel: defaultEmbedding(),
    });

    await ingestion.ingestBatch({
      filePath: sampleFilePath,
      onlyTitles: ["Neurology: Acute Stroke"],
    });

    expect(
      await countEnrichedQuestions({ title: "Neurology: Acute Stroke" }),
    ).toBe(0);
    const q = await fetchQuarantineByTitle("Neurology: Acute Stroke");
    expect(q.failure_kind).toBe("F1");
    expect(q.raw_responses).toHaveLength(3);
    expect(q.parse_errors).toHaveLength(3);
    expect(q.quarantined_at).toBeTruthy();
  });

  it("When the Bloom level is 'intermediate' (F3) three times, then question is quarantined with failure_kind='F3' and validation error names the enum", async () => {
    const ingestion = createIngestionService({
      enrichmentModel: makeMockLLM(
        new Map([
          [
            "Endocrinology: DKA",
            Array(3).fill({ kind: "bad-enum", value: "intermediate" }) as CallScript,
          ],
        ]),
      ),
      embeddingModel: defaultEmbedding(),
    });

    await ingestion.ingestBatch({
      filePath: sampleFilePath,
      onlyTitles: ["Endocrinology: DKA"],
    });

    const q = await fetchQuarantineByTitle("Endocrinology: DKA");
    expect(q.failure_kind).toBe("F3");
    expect(JSON.stringify(q.last_validation_error)).toMatch(/bloom_level/);
  });

  it("When the first call is a safety refusal (F7), then question is quarantined immediately with failure_kind='F7' and zero schema retries consumed", async () => {
    const ingestion = createIngestionService({
      enrichmentModel: makeMockLLM(
        new Map([
          ["Toxicology: Acetaminophen overdose", [{ kind: "refusal" }]],
        ]),
      ),
      embeddingModel: defaultEmbedding(),
    });

    const result = await ingestion.ingestBatch({
      filePath: sampleFilePath,
      onlyTitles: ["Toxicology: Acetaminophen overdose"],
    });

    const q = await fetchQuarantineByTitle("Toxicology: Acetaminophen overdose");
    expect(q.failure_kind).toBe("F7");
    expect(q.raw_responses).toHaveLength(1);
    expect(
      result.perQuestionLog
        .find((l) => l.title === "Toxicology: Acetaminophen overdose")
        ?.events.filter((e) => e.kind === "schema-retry"),
    ).toHaveLength(0);
  });

  it("When first call is a 429 rate-limit and second is valid, then row stored with retry_count=0 and transport retry not counted toward schema budget", async () => {
    const ingestion = createIngestionService({
      enrichmentModel: makeMockLLM(
        new Map([
          [
            "Pulmonology: Acute Asthma",
            [
              { kind: "rate-limit" },
              {
                kind: "valid",
                bloom: "application",
                keywords: ["asthma", "albuterol", "bronchospasm"],
                specialty: "Pulmonology",
              },
            ],
          ],
        ]),
      ),
      embeddingModel: defaultEmbedding(),
    });

    const result = await ingestion.ingestBatch({
      filePath: sampleFilePath,
      onlyTitles: ["Pulmonology: Acute Asthma"],
    });
    const row = await fetchEnrichedQuestionByTitle("Pulmonology: Acute Asthma");
    expect(row.retry_count).toBe(0); // schema retries, not transport retries
    expect(
      result.perQuestionLog.find((l) => l.title === "Pulmonology: Acute Asthma")
        ?.events,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: "transport-retry" }),
        expect.objectContaining({ kind: "ok" }),
      ]),
    );
  });

  it("When the keyword list has only one keyword (F5) three times, then question is quarantined with failure_kind='F5'", async () => {
    const ingestion = createIngestionService({
      enrichmentModel: makeMockLLM(
        new Map([
          [
            "Hematology: Anemia Workup",
            Array(3).fill({
              kind: "sparse-keywords",
              keywords: ["anemia"],
            }) as CallScript,
          ],
        ]),
      ),
      embeddingModel: defaultEmbedding(),
    });

    await ingestion.ingestBatch({
      filePath: sampleFilePath,
      onlyTitles: ["Hematology: Anemia Workup"],
    });
    const q = await fetchQuarantineByTitle("Hematology: Anemia Workup");
    expect(q.failure_kind).toBe("F5");
    expect(JSON.stringify(q.last_validation_error)).toMatch(/keyword|min/i);
  });

  it("When 7 succeed first-try, 2 succeed after one retry, 1 quarantines, then run summary matches DB counts and reports first-try-pass=70%", async () => {
    const validStep = {
      kind: "valid" as const,
      bloom: "application" as const,
      keywords: ["alpha", "beta", "gamma"],
      specialty: "General",
    };
    const script = new Map<string, CallScript>();
    for (const t of [
      "Renal: AKI vs CKD",
      "Pulmonology: Acute Asthma",
      "Cardiology: HF",
      "GI: PUD",
      "Derm: Psoriasis",
      "ID: Sepsis",
      "Hematology: Anemia Workup",
    ]) {
      script.set(t, [validStep]);
    }
    script.set("Endocrinology: DKA", [
      { kind: "bad-enum", value: "applying" },
      {
        kind: "valid",
        bloom: "application",
        keywords: ["DKA", "ketones", "insulin"],
        specialty: "Endocrinology",
      },
    ]);
    script.set("Neurology: Migraine", [
      { kind: "shape-mismatch" },
      {
        kind: "valid",
        bloom: "recall",
        keywords: ["migraine", "aura", "triptan"],
        specialty: "Neurology",
      },
    ]);
    script.set(
      "Neurology: Acute Stroke",
      Array(3).fill({ kind: "invalid-json" }) as CallScript,
    );

    const onlyTitles = Array.from(script.keys());
    const ingestion = createIngestionService({
      enrichmentModel: makeMockLLM(script),
      embeddingModel: defaultEmbedding(),
    });

    const result = await ingestion.ingestBatch({
      filePath: sampleFilePath,
      onlyTitles,
    });

    expect(result.summary.total).toBe(10);
    expect(result.summary.enrichedCount).toBe(9);
    expect(result.summary.quarantinedCount).toBe(1);
    expect(result.summary.firstTryPassPercent).toBe(70);
    expect(await countEnrichedQuestions({ batch_id: result.batchId })).toBe(9);
    expect(await countQuarantine({ batch_id: result.batchId })).toBe(1);
  });

  it("[property] For any persistent enrichment failure, the question is NEVER in enriched_questions AND IS in quarantine", async () => {
    const ingestion = createIngestionService({
      enrichmentModel: makeMockLLM(
        new Map<string, CallScript>([
          [
            "Neurology: Acute Stroke",
            Array(3).fill({ kind: "invalid-json" }) as CallScript,
          ],
          [
            "Endocrinology: DKA",
            Array(3).fill({ kind: "bad-enum", value: "intermediate" }) as CallScript,
          ],
          [
            "Hematology: Anemia Workup",
            Array(3).fill({
              kind: "sparse-keywords",
              keywords: ["x"],
            }) as CallScript,
          ],
        ]),
      ),
      embeddingModel: defaultEmbedding(),
    });

    await ingestion.ingestBatch({
      filePath: sampleFilePath,
      onlyTitles: [
        "Neurology: Acute Stroke",
        "Endocrinology: DKA",
        "Hematology: Anemia Workup",
      ],
    });

    for (const title of [
      "Neurology: Acute Stroke",
      "Endocrinology: DKA",
      "Hematology: Anemia Workup",
    ]) {
      expect(await countEnrichedQuestions({ title })).toBe(0);
      expect(await countQuarantine({ title })).toBe(1);
    }
  });
});
