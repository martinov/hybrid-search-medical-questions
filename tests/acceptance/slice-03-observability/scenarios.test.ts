// RED-ready: imports resolve once DELIVER step 0 lands the scaffolds.

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, mkdtempSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { MockLanguageModelV1, MockEmbeddingModelV1 } from "ai/test";

import { createIngestionService } from "@netea/ingestion-service";
import { resetCorpus, countEnrichedQuestions, countQuarantine } from "@netea/db/test-helpers";

let sampleFilePath: string;
let logsDir: string;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "netea-slice03-"));
  sampleFilePath = join(dir, "sample-questions.json");
  logsDir = join(dir, "logs", "runs");
  writeFileSync(sampleFilePath, JSON.stringify(generateTenQuestions()));
});

beforeEach(async () => {
  await resetCorpus();
});

declare function generateTenQuestions(): unknown[];

describe("Given a 10-question batch and deterministic mocked LLM token usage and latency", () => {
  it("When ingestion runs, then the printed summary reports tokens, cost in USD, average, and per-question average", async () => {
    const ingestion = createIngestionService({
      enrichmentModel: deterministicValidModel({ promptTokens: 1048, completionTokens: 120 }),
      embeddingModel: deterministicValidEmbed(),
      logsDir,
    });

    const result = await ingestion.ingestBatch({ filePath: sampleFilePath });
    expect(result.summary.totalInputTokens).toBe(1048 * 10);
    expect(result.summary.totalOutputTokens).toBe(120 * 10);
    expect(result.summary.totalCostUsd).toBeCloseTo(
      (1048 * 10 * 0.15) / 1e6 + (120 * 10 * 0.6) / 1e6 + /* embedding */ (300 * 10 * 0.02) / 1e6,
      6,
    );
    expect(result.summary.avgCostPerQuestionUsd).toBeCloseTo(result.summary.totalCostUsd / 10, 6);
    expect(result.summary.printed).toMatch(/Total cost/);
    expect(result.summary.printed).toMatch(/\$\d/);
  });

  it("When latency is varied per call, then the summary reports avg, p95, and total duration", async () => {
    const latencies = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1400];
    const ingestion = createIngestionService({
      enrichmentModel: deterministicValidModelWithLatencies(latencies),
      embeddingModel: deterministicValidEmbed(),
      logsDir,
    });

    const result = await ingestion.ingestBatch({ filePath: sampleFilePath });
    expect(result.summary.avgLatencyMs).toBe(590);
    expect(result.summary.p95LatencyMs).toBe(1400); // 95th of 10 with the upper sample
    expect(result.summary.totalDurationMs).toBeGreaterThanOrEqual(latencies.reduce((a, b) => a + b, 0));
  });

  it("When 7 pass first-try, 2 after one retry, 1 quarantined, then summary reports 70% / 20% / 10%", async () => {
    const ingestion = createIngestionService({
      enrichmentModel: scriptedMixedOutcomes(),
      embeddingModel: deterministicValidEmbed(),
      logsDir,
    });

    const result = await ingestion.ingestBatch({ filePath: sampleFilePath });
    expect(result.summary.firstTryPassPercent).toBe(70);
    expect(result.summary.afterRetryPercent).toBe(20);
    expect(result.summary.quarantinePercent).toBe(10);
  });

  it("When ingestion completes, then a single run-record JSON file exists at logs/runs/{batch_id}.json with matching numbers", async () => {
    const ingestion = createIngestionService({
      enrichmentModel: deterministicValidModel({ promptTokens: 1048, completionTokens: 120 }),
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
    const ingestion = createIngestionService({
      enrichmentModel: deterministicValidModel({ promptTokens: 1048, completionTokens: 120 }),
      embeddingModel: deterministicValidEmbed(),
      logsDir,
    });
    const r1 = await ingestion.ingestBatch({ filePath: sampleFilePath });
    const r2 = await ingestion.ingestBatch({ filePath: sampleFilePath });
    expect(r1.batchId).not.toBe(r2.batchId);
    const files = readdirSync(logsDir).filter((f) => f.endsWith(".json"));
    expect(files).toHaveLength(2);
    for (const f of files) {
      expect(() => JSON.parse(readFileSync(join(logsDir, f), "utf8"))).not.toThrow();
    }
  });

  it("When cost cap of $0.01 is configured, then run aborts mid-batch and a partial run record names the abort reason", async () => {
    const ingestion = createIngestionService({
      enrichmentModel: deterministicValidModel({ promptTokens: 10_000, completionTokens: 5_000 }), // expensive to trip the cap fast
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
    expect(record.processedCount).toBe(await countEnrichedQuestions({ batch_id: result.batchId })
      + await countQuarantine({ batch_id: result.batchId }));
  });

  it("When logs/runs is read-only, then the command exits non-zero and the error names the unwritable directory", async () => {
    chmodSync(logsDir, 0o555);
    const ingestion = createIngestionService({
      enrichmentModel: deterministicValidModel({ promptTokens: 1048, completionTokens: 120 }),
      embeddingModel: deterministicValidEmbed(),
      logsDir,
    });
    await expect(ingestion.ingestBatch({ filePath: sampleFilePath })).rejects.toThrow(/logs.*not writable|EACCES/i);
  });
});

// === DELIVER step 0 scaffold helpers (declared, not implemented here) ===
declare function deterministicValidModel(usage: { promptTokens: number; completionTokens: number }): MockLanguageModelV1;
declare function deterministicValidModelWithLatencies(latencies: number[]): MockLanguageModelV1;
declare function deterministicValidEmbed(): MockEmbeddingModelV1;
declare function scriptedMixedOutcomes(): MockLanguageModelV1;
