// Slice 03 — Run observability acceptance tests.
//
// Adapted to AI SDK 6 mock surface (MockLanguageModelV3 / MockEmbeddingModelV3
// per slice-01 + slice-02 patterns):
//   - doGenerate returns { content:[{type:'text',text}], finishReason:{unified,raw},
//     usage:{inputTokens:{total},outputTokens:{total},totalTokens}, warnings:[] }
//   - doEmbed returns { embeddings, usage:{tokens}, warnings:[] }
//
// Strategy: real Postgres + real ingestion service; LLM is mocked with
// programmable token-usage and latency per call.

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  existsSync,
  readFileSync,
  readdirSync,
  mkdtempSync,
  writeFileSync,
  chmodSync,
} from "node:fs";
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
  resetCorpus,
  countEnrichedQuestions,
  countQuarantine,
} from "@netea/db/test-helpers";

let sampleFilePath: string;
let logsDirRoot: string;
let runCounter = 0;

const FULL_CONTENT =
  "A detailed medical question stem of sufficient length to satisfy the " +
  "RawQuestionSchema minimum length requirement of fifty characters. " +
  "The clinical vignette would typically include patient history, " +
  "physical findings, and an investigative question.";

const TEN_TITLES = [
  "Renal: AKI vs CKD",
  "Endocrinology: DKA",
  "Neurology: Acute Stroke",
  "Toxicology: Acetaminophen overdose",
  "Pulmonology: Acute Asthma",
  "Hematology: Anemia Workup",
  "Cardiology: HF",
  "GI: PUD",
  "Derm: Psoriasis",
  "ID: Sepsis",
];

function generateTenQuestions() {
  return TEN_TITLES.map((title) => ({
    title,
    content: FULL_CONTENT,
    answers: [
      { content: "Correct option for this question", is_correct: true },
      { content: "Distractor option one", is_correct: false },
      { content: "Distractor option two", is_correct: false },
    ],
    explanation: "Reference explanation for the clinically correct answer.",
  }));
}

function v3UsageFromTokens(inputTokens: number, outputTokens: number) {
  return {
    inputTokens: {
      total: inputTokens,
      noCache: inputTokens,
      cacheRead: 0,
      cacheWrite: 0,
    },
    outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
    totalTokens: inputTokens + outputTokens,
  };
}

function extractTitleFromPrompt(prompt: LanguageModelV3Prompt): string {
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

const STOP = { unified: "stop" as const, raw: "stop" };

function validEnrichmentJson(title: string): string {
  // Title-derived but valid for every fixture — the slice-03 tests never
  // assert on enrichment content, only on aggregate cost/latency/validation.
  return JSON.stringify({
    bloom_level: "application",
    keywords: ["alpha", "beta", "gamma", title.split(":")[0] ?? "general"],
    medical_specialty: title.split(":")[0]?.trim() || "General",
  });
}

function deterministicValidModel(usage: {
  promptTokens: number;
  completionTokens: number;
}): LanguageModelV3 {
  return new MockLanguageModelV3({
    modelId: "mock-gpt-4o-mini",
    provider: "mock",
    doGenerate: async (opts: LanguageModelV3CallOptions) => {
      const title = extractTitleFromPrompt(opts.prompt);
      return {
        content: [{ type: "text", text: validEnrichmentJson(title) }],
        finishReason: STOP,
        usage: v3UsageFromTokens(usage.promptTokens, usage.completionTokens),
        warnings: [],
      } satisfies LanguageModelV3GenerateResult;
    },
  });
}

function deterministicValidModelWithLatencies(
  latencies: number[],
): LanguageModelV3 {
  let cursor = 0;
  return new MockLanguageModelV3({
    modelId: "mock-gpt-4o-mini",
    provider: "mock",
    doGenerate: async (opts: LanguageModelV3CallOptions) => {
      const idx = Math.min(cursor++, latencies.length - 1);
      const sleepMs = latencies[idx] ?? 100;
      await new Promise((r) => setTimeout(r, sleepMs));
      const title = extractTitleFromPrompt(opts.prompt);
      return {
        content: [{ type: "text", text: validEnrichmentJson(title) }],
        finishReason: STOP,
        usage: v3UsageFromTokens(1048, 120),
        warnings: [],
      } satisfies LanguageModelV3GenerateResult;
    },
  });
}

// 7 first-try pass, 2 retry-then-pass, 1 quarantine (after 3 invalid-JSON
// responses). Indexed by title.
function scriptedMixedOutcomes(): LanguageModelV3 {
  const cursor = new Map<string, number>();
  const firstTryTitles = new Set(TEN_TITLES.slice(0, 7));
  const retryTitles = new Set(TEN_TITLES.slice(7, 9));
  const quarantineTitle = TEN_TITLES[9]!;

  return new MockLanguageModelV3({
    modelId: "mock-gpt-4o-mini",
    provider: "mock",
    doGenerate: async (opts: LanguageModelV3CallOptions) => {
      const title = extractTitleFromPrompt(opts.prompt);
      const callIdx = cursor.get(title) ?? 0;
      cursor.set(title, callIdx + 1);

      const usage = v3UsageFromTokens(1048, 120);
      if (firstTryTitles.has(title)) {
        return {
          content: [{ type: "text", text: validEnrichmentJson(title) }],
          finishReason: STOP,
          usage,
          warnings: [],
        };
      }
      if (retryTitles.has(title)) {
        if (callIdx === 0) {
          // Bad bloom enum on first call, valid on retry.
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  bloom_level: "applying",
                  keywords: ["a", "b", "c"],
                  medical_specialty: "General",
                }),
              },
            ],
            finishReason: STOP,
            usage,
            warnings: [],
          };
        }
        return {
          content: [{ type: "text", text: validEnrichmentJson(title) }],
          finishReason: STOP,
          usage,
          warnings: [],
        };
      }
      if (title === quarantineTitle) {
        return {
          content: [
            { type: "text", text: '{"bloom_level": "recall", "keywords":' },
          ],
          finishReason: STOP,
          usage,
          warnings: [],
        };
      }
      throw new Error(`Unscripted title in scriptedMixedOutcomes: ${title}`);
    },
  });
}

function deterministicValidEmbed() {
  return new MockEmbeddingModelV3({
    modelId: "mock-text-embedding-3-small",
    provider: "mock",
    maxEmbeddingsPerCall: 100,
    doEmbed: async ({ values }) => ({
      embeddings: values.map(() => Array.from({ length: 1536 }, () => 0.001)),
      // The slice-03 cost test pins the embedding charge at 300 tokens per
      // question (Expansion E §1 p50 sizing).
      usage: { tokens: values.length * 300 },
      warnings: [],
    }),
  });
}

function freshLogsDir(): string {
  runCounter += 1;
  const dir = join(logsDirRoot, `run-${runCounter}`);
  return dir;
}

beforeAll(() => {
  (
    globalThis as { AI_SDK_LOG_WARNINGS?: false | ((..._a: unknown[]) => void) }
  ).AI_SDK_LOG_WARNINGS = false;
  const dir = mkdtempSync(join(tmpdir(), "netea-slice03-"));
  sampleFilePath = join(dir, "sample-questions.json");
  logsDirRoot = join(dir, "logs", "runs");
  writeFileSync(sampleFilePath, JSON.stringify(generateTenQuestions()));
});

beforeEach(async () => {
  await resetCorpus();
});

describe("Given a 10-question batch and deterministic mocked LLM token usage and latency", () => {
  it("When ingestion runs, then the printed summary reports tokens, cost in USD, average, and per-question average", async () => {
    const ingestion = createIngestionService({
      enrichmentModel: deterministicValidModel({
        promptTokens: 1048,
        completionTokens: 120,
      }),
      embeddingModel: deterministicValidEmbed(),
      logsDir: freshLogsDir(),
    });

    const result = await ingestion.ingestBatch({ filePath: sampleFilePath });
    expect(result.summary.totalInputTokens).toBe(1048 * 10);
    expect(result.summary.totalOutputTokens).toBe(120 * 10);
    expect(result.summary.totalCostUsd).toBeCloseTo(
      (1048 * 10 * 0.15) / 1e6 +
        (120 * 10 * 0.6) / 1e6 +
        (300 * 10 * 0.02) / 1e6,
      6,
    );
    expect(result.summary.avgCostPerQuestionUsd).toBeCloseTo(
      result.summary.totalCostUsd / 10,
      6,
    );
    expect(result.summary.printed).toMatch(/Total cost/);
    expect(result.summary.printed).toMatch(/\$\d/);
  });

  it("When latency is varied per call, then the summary reports avg, p95, and total duration", async () => {
    const latencies = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1400];
    const ingestion = createIngestionService({
      enrichmentModel: deterministicValidModelWithLatencies(latencies),
      embeddingModel: deterministicValidEmbed(),
      logsDir: freshLogsDir(),
    });

    const result = await ingestion.ingestBatch({ filePath: sampleFilePath });
    // avg = 590 +/- tolerance; setTimeout drift can shift values slightly
    expect(Math.abs(result.summary.avgLatencyMs - 590)).toBeLessThanOrEqual(60);
    // p95 is the 9th index (ceil(10*.95)-1=9) in the sorted latencies.
    // Allow a small upper tolerance because real timer drift can push 1400ms
    // to 1410ms, but the 9th value is still the largest observed.
    expect(result.summary.p95LatencyMs).toBeGreaterThanOrEqual(1400);
    expect(result.summary.p95LatencyMs).toBeLessThanOrEqual(1600);
    expect(result.summary.totalDurationMs).toBeGreaterThanOrEqual(
      latencies.reduce((a, b) => a + b, 0),
    );
  });

  it("When 7 pass first-try, 2 after one retry, 1 quarantined, then summary reports 70% / 20% / 10%", async () => {
    const ingestion = createIngestionService({
      enrichmentModel: scriptedMixedOutcomes(),
      embeddingModel: deterministicValidEmbed(),
      logsDir: freshLogsDir(),
    });

    const result = await ingestion.ingestBatch({ filePath: sampleFilePath });
    expect(result.summary.firstTryPassPercent).toBe(70);
    expect(result.summary.afterRetryPercent).toBe(20);
    expect(result.summary.quarantinePercent).toBe(10);
  });

  it("When ingestion completes, then a single run-record JSON file exists at logs/runs/{batch_id}.json with matching numbers", async () => {
    const logsDir = freshLogsDir();
    const ingestion = createIngestionService({
      enrichmentModel: deterministicValidModel({
        promptTokens: 1048,
        completionTokens: 120,
      }),
      embeddingModel: deterministicValidEmbed(),
      logsDir,
    });
    const result = await ingestion.ingestBatch({ filePath: sampleFilePath });
    const recordPath = join(logsDir, `${result.batchId}.json`);
    expect(existsSync(recordPath)).toBe(true);
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    expect(record.totalCostUsd).toBeCloseTo(result.summary.totalCostUsd, 6);
    expect(record.firstTryPassPercent).toBe(result.summary.firstTryPassPercent);
    expect(record.batchId).toBe(result.batchId);
  });

  it("When ingestion runs twice in a row, then two distinct run-record files exist and both can be parsed", async () => {
    const logsDir = freshLogsDir();
    const ingestion = createIngestionService({
      enrichmentModel: deterministicValidModel({
        promptTokens: 1048,
        completionTokens: 120,
      }),
      embeddingModel: deterministicValidEmbed(),
      logsDir,
    });
    const r1 = await ingestion.ingestBatch({ filePath: sampleFilePath });
    // The batch id is timestamp-based; ensure clock advances at least 1 ms
    // to guarantee a distinct id even under fast test runners.
    await new Promise((r) => setTimeout(r, 2));
    const r2 = await ingestion.ingestBatch({ filePath: sampleFilePath });
    expect(r1.batchId).not.toBe(r2.batchId);
    const files = readdirSync(logsDir).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(2);
    for (const f of files) {
      expect(() =>
        JSON.parse(readFileSync(join(logsDir, f), "utf8")),
      ).not.toThrow();
    }
  });

  it("When cost cap of $0.01 is configured, then run aborts mid-batch and a partial run record names the abort reason", async () => {
    const logsDir = freshLogsDir();
    const ingestion = createIngestionService({
      enrichmentModel: deterministicValidModel({
        promptTokens: 10_000,
        completionTokens: 5_000,
      }), // expensive to trip the cap fast
      embeddingModel: deterministicValidEmbed(),
      logsDir,
      maxCostUsd: 0.01,
    });
    const result = await ingestion.ingestBatch({ filePath: sampleFilePath });
    expect(result.aborted).toBe(true);
    expect(result.abortReason).toBe("cost cap exceeded");
    expect(result.summary.processedCount).toBeLessThan(10);
    const recordPath = join(logsDir, `${result.batchId}.json`);
    expect(existsSync(recordPath)).toBe(true);
    const record = JSON.parse(readFileSync(recordPath, "utf8"));
    expect(record.aborted).toBe(true);
    expect(record.processedCount).toBe(
      (await countEnrichedQuestions({ batch_id: result.batchId })) +
        (await countQuarantine({ batch_id: result.batchId })),
    );
  });

  it("When logs/runs is read-only, then the command exits non-zero and the error names the unwritable directory", async () => {
    const logsDir = freshLogsDir();
    // Pre-create as read-only so the preflight fails.
    const { mkdirSync } = await import("node:fs");
    mkdirSync(logsDir, { recursive: true });
    chmodSync(logsDir, 0o555);
    try {
      const ingestion = createIngestionService({
        enrichmentModel: deterministicValidModel({
          promptTokens: 1048,
          completionTokens: 120,
        }),
        embeddingModel: deterministicValidEmbed(),
        logsDir,
      });
      await expect(
        ingestion.ingestBatch({ filePath: sampleFilePath }),
      ).rejects.toThrow(/logs.*not writable|EACCES/i);
    } finally {
      // restore so cleanup can happen
      chmodSync(logsDir, 0o755);
    }
  });
});

