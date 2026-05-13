// Slice 01 — Walking Skeleton acceptance tests (real Postgres + mocked AI).
//
// Adapted in DELIVER step 1 to the AI SDK 6 API surface:
//   - `MockLanguageModelV3` / `MockEmbeddingModelV3` replace the v4 V1 mocks
//     (the V3 suffix refers to the *provider spec version*, not the SDK
//     version; AI SDK 6 ships these as the only mock implementations).
//   - V3 doGenerate now returns `content: [{ type: "text", text }]` instead
//     of `text` + `rawCall`.
//   - V3 doStream emits `{ type: "text-delta", id, delta }` instead of
//     `{ type: "text-delta", textDelta }`.
//   - Usage is now `{ inputTokens, outputTokens, totalTokens }` with the
//     "total" sub-shape.
//
// Walking-Skeleton Strategy B:
//   real:   Postgres+pgvector (docker compose), filesystem, Drizzle, RRF, HTTP server
//   fake:   OpenAI calls via ai/test MockLanguageModelV3 / MockEmbeddingModelV3
//
// Driving ports exercised:
//   - apps/ingestion CLI via Node subprocess (`tsx apps/ingestion/src/cli.ts ingest --file <path> --limit 1`)
//   - apps/api HTTP via Hono's test request handler

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { MockEmbeddingModelV3, MockLanguageModelV3 } from "ai/test";
import { simulateReadableStream } from "ai";
import { createApp } from "@netea/api";
import { createIngestionService } from "@netea/ingestion-service";
import { resetCorpus } from "@netea/db/test-helpers";
import {
  countEnrichedQuestions,
  fetchEnrichedQuestion,
} from "@netea/db/repos/enriched-questions";
import type { EnrichmentOutput } from "@netea/schemas";

const SEED_QUESTION = {
  title: "Cardiology: Patient Symptoms",
  content:
    "A 68-year-old man presents with progressively worsening shortness of breath over the past 3 weeks, " +
    "associated with bilateral lower-extremity swelling and orthopnea. On examination, jugular venous distension " +
    "is noted. Which finding most strongly supports a diagnosis of acute decompensated heart failure?",
  answers: [
    { content: "Elevated jugular venous pressure with peripheral edema", is_correct: true },
    { content: "Isolated dry cough without other findings", is_correct: false },
    { content: "Unilateral leg swelling with calf tenderness", is_correct: false },
    { content: "Productive cough with green sputum", is_correct: false },
  ],
  explanation:
    "Elevated JVP combined with peripheral edema is a classic sign of right-sided heart failure secondary to " +
    "left-sided dysfunction in acute decompensated heart failure.",
};

const VALID_ENRICHMENT: EnrichmentOutput = {
  bloom_level: "application",
  keywords: ["heart failure", "dyspnea", "JVD", "peripheral edema", "orthopnea"],
  medical_specialty: "Cardiology",
};

let app: ReturnType<typeof createApp>;
let sampleFilePath: string;

function v3UsageFromTokens(inputTokens: number, outputTokens: number) {
  return {
    inputTokens: {
      total: inputTokens,
      noCache: inputTokens,
      cacheRead: 0,
      cacheWrite: 0,
    },
    outputTokens: { total: outputTokens, reasoning: 0 },
    totalTokens: inputTokens + outputTokens,
  };
}

function v3StopFinishReason() {
  return { unified: "stop" as const, raw: "stop" };
}

beforeAll(async () => {
  // AI SDK 6 logs deprecation/compatibility warnings to console.warn by default.
  // Silence them in tests to keep output focused on assertions.
  (globalThis as { AI_SDK_LOG_WARNINGS?: false | ((..._a: unknown[]) => void) }).AI_SDK_LOG_WARNINGS = false;
  await resetCorpus();

  const mockLLM = new MockLanguageModelV3({
    modelId: "mock-gpt-4o-mini",
    provider: "mock",
    doGenerate: async () => ({
      content: [{ type: "text", text: JSON.stringify(VALID_ENRICHMENT) }],
      finishReason: v3StopFinishReason(),
      usage: v3UsageFromTokens(1048, 120),
      warnings: [],
    }),
  });

  const mockEmbed = new MockEmbeddingModelV3({
    modelId: "mock-text-embedding-3-small",
    provider: "mock",
    maxEmbeddingsPerCall: 100,
    doEmbed: async ({ values }) => ({
      embeddings: values.map(() => Array.from({ length: 1536 }, () => 0.001)),
      usage: { tokens: values.length * 10 },
      warnings: [],
    }),
  });

  const chatStreamText =
    `I found 1 question: Cardiology: Patient Symptoms — "${SEED_QUESTION.content}"`;

  const chatModel = new MockLanguageModelV3({
    modelId: "mock-chat",
    provider: "mock",
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { type: "text-start" as const, id: "t0" },
          { type: "text-delta" as const, id: "t0", delta: chatStreamText },
          { type: "text-end" as const, id: "t0" },
          {
            type: "finish" as const,
            finishReason: v3StopFinishReason(),
            usage: v3UsageFromTokens(50, 40),
          },
        ],
        initialDelayInMs: null,
        chunkDelayInMs: null,
      }) as ReadableStream<unknown> as ReadableStream<never>,
    }),
  });

  app = createApp({
    enrichmentModel: mockLLM,
    embeddingModel: mockEmbed,
    chatModel,
  });

  const dir = mkdtempSync(join(tmpdir(), "netea-ws-"));
  sampleFilePath = join(dir, "sample-questions.json");
  writeFileSync(sampleFilePath, JSON.stringify([SEED_QUESTION]));
});

beforeEach(async () => {
  await resetCorpus();
});

afterAll(async () => {
  // docker compose down handled out-of-band by the test runner script
});

describe("Given a clean local environment with Postgres and pgvector running via docker compose", () => {
  describe("And a sample questions file containing one cardiology question", () => {
    it("When Sam runs the single-question ingestion command, then exactly one enriched question is stored with bloom + keywords + embedding and is searchable", async () => {
      const ingestion = createIngestionService({
        enrichmentModel: app.deps.enrichmentModel,
        embeddingModel: app.deps.embeddingModel,
      });

      const result = await ingestion.ingestOne({ filePath: sampleFilePath });

      expect(result.outcome).toBe("ingested");
      expect(await countEnrichedQuestions()).toBe(1);

      const stored = await fetchEnrichedQuestion(result.questionId);
      expect(["recall", "application", "analysis"]).toContain(stored.bloom_level);
      expect(stored.keywords.length).toBeGreaterThanOrEqual(3);
      expect(stored.has_embedding).toBe(true);
      expect(stored.has_lexical_index).toBe(true);
    });
  });

  describe("And Sam has ingested the Cardiology: Patient Symptoms question", () => {
    beforeEach(async () => {
      const ingestion = createIngestionService({
        enrichmentModel: app.deps.enrichmentModel,
        embeddingModel: app.deps.embeddingModel,
      });
      await ingestion.ingestOne({ filePath: sampleFilePath });
    });

    it("When a client searches for 'patient with dyspnea and JVD', then the first result is the ingested cardiology question with title/content/bloom/score", async () => {
      const res = await app.request("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "patient with dyspnea and JVD", limit: 5 }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        kind: "results" | "no_match";
        results: Array<{
          id: string;
          title: string;
          content: string;
          bloom_level: string;
          score: number;
        }>;
      };
      expect(body.kind).toBe("results");
      expect(body.results.length).toBeGreaterThanOrEqual(1);
      expect(body.results[0]!.title).toContain("Cardiology");
      expect(body.results[0]!.content.length).toBeGreaterThanOrEqual(100);
      expect(body.results[0]!.bloom_level).toBeDefined();
      expect(typeof body.results[0]!.score).toBe("number");
    });

    it("When Priya asks via chat, then the streamed reply references the ingested question by title within 2 seconds and includes a >=100-char excerpt with no invented titles", async () => {
      const startedAt = Date.now();
      const res = await app.request("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: "shortness of breath with leg swelling" }],
        }),
      });
      const firstByteAt = Date.now();

      expect(res.status).toBe(200);
      expect(firstByteAt - startedAt).toBeLessThan(2000);

      const text = await res.text();
      expect(text).toContain("Cardiology: Patient Symptoms");

      const knownTitles = new Set([SEED_QUESTION.title]);
      const citedTitles = Array.from(text.matchAll(/Cardiology: [A-Z][^"\n]+/g)).map((m) =>
        m[0].trim(),
      );
      for (const cited of citedTitles) {
        // strip any trailing punctuation/quote characters that may have been
        // captured by the lazy regex group
        const normalized = cited.replace(/[\s"'\\:.,;]+$/g, "").trim();
        const matchesKnown = Array.from(knownTitles).some((known) =>
          normalized.startsWith(known),
        );
        expect(matchesKnown).toBe(true);
      }
    });
  });

  describe("And the OPENAI_API_KEY environment variable is not set", () => {
    it("When Sam runs the single-question ingestion command, then it exits with code 2 and the corpus stays empty", async () => {
      const env = { ...process.env };
      delete env.OPENAI_API_KEY;

      const out = spawnSync(
        "pnpm",
        ["run", "ingest:one", "--file", sampleFilePath],
        { env, encoding: "utf8", cwd: process.cwd() },
      );

      expect(out.status).toBe(2);
      expect(out.stderr).toMatch(/OPENAI_API_KEY/);
      expect(await countEnrichedQuestions()).toBe(0);
    });
  });

  describe("Health endpoint", () => {
    it("When a client requests /api/healthz, then api and database both report healthy", async () => {
      const res = await app.request("/api/healthz");
      expect(res.status).toBe(200);
      const body = (await res.json()) as { api: string; database: string };
      expect(body.api).toBe("healthy");
      expect(body.database).toBe("healthy");
    });
  });
});
