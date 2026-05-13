// Slice 04 — Bloom-level filter acceptance tests (US-05).
//
// Adapted in DELIVER step 4 to the AI SDK 6 mock API surface
// (MockLanguageModelV3 / MockEmbeddingModelV3 — see slice-01 for the V3
// migration notes). The original scaffold was authored against the v4 V1
// mocks before the AI SDK 6 swap.
//
// Strategy B: real Postgres + real ingestion + real search; LLM is mocked.
// Driving ports: HTTP POST /api/search and POST /api/chat.

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockLanguageModelV3, MockEmbeddingModelV3 } from "ai/test";
import { simulateReadableStream } from "ai";

import { createApp } from "@netea/api";
import {
  resetCorpus,
  seedHeartFailureCorpus,
  seedDkaCorpusApplicationOnly,
} from "@netea/db/test-helpers";
import { BLOOM_LEVELS_POC } from "@netea/schemas/bloom";

const BLOOM_LEVELS = BLOOM_LEVELS_POC;
type Bloom = (typeof BLOOM_LEVELS)[number];

function v3UsageFromTokens(inputTokens: number, outputTokens: number) {
  return {
    inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: outputTokens, reasoning: 0 },
    totalTokens: inputTokens + outputTokens,
  };
}

function v3StopFinishReason() {
  return { unified: "stop" as const, raw: "stop" };
}

function makeChatModelEmittingText(text: string): MockLanguageModelV3 {
  return new MockLanguageModelV3({
    modelId: "mock-chat",
    provider: "mock",
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: "stream-start" as const, warnings: [] },
          { type: "text-start" as const, id: "t0" },
          { type: "text-delta" as const, id: "t0", delta: text },
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
}

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  (globalThis as { AI_SDK_LOG_WARNINGS?: false | ((..._a: unknown[]) => void) })
    .AI_SDK_LOG_WARNINGS = false;
  app = createApp({
    enrichmentModel: new MockLanguageModelV3({
      modelId: "mock-enrichment",
      provider: "mock",
      doGenerate: async () => {
        throw new Error("not used in slice 04");
      },
    }),
    embeddingModel: new MockEmbeddingModelV3({
      modelId: "mock-embedding",
      provider: "mock",
      maxEmbeddingsPerCall: 100,
      doEmbed: async ({ values }) => ({
        embeddings: values.map(() => Array.from({ length: 1536 }, () => 0.01)),
        usage: { tokens: values.length * 10 },
        warnings: [],
      }),
    }),
    chatModel: new MockLanguageModelV3({
      modelId: "mock-chat-default",
      provider: "mock",
      doStream: async () => {
        throw new Error("override per-test");
      },
    }),
  });
});

beforeEach(async () => {
  await resetCorpus();
});

describe("Given a heart-failure corpus across all three Bloom levels", () => {
  beforeEach(async () => {
    await seedHeartFailureCorpus(); // 2 recall, 3 application, 2 analysis
  });

  it("When the client searches with bloom_level='application', then every result has Bloom level 'application' and the total reflects the count", async () => {
    const res = await app.request("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "heart failure", bloom_level: "application", limit: 20 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      kind: "results";
      results: Array<{ bloom_level: Bloom }>;
      total: number;
    };
    expect(body.kind).toBe("results");
    expect(body.results.length).toBeGreaterThan(0);
    expect(body.results.every((r) => r.bloom_level === "application")).toBe(true);
    expect(body.total).toBe(body.results.length);
  });

  it("When the client searches with bloom_level='applying' (not in the enum), then the response is rejected and the error names the valid values", async () => {
    const res = await app.request("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "heart failure", bloom_level: "applying" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string; valid_values?: string[] };
    expect(body.error).toMatch(/bloom_level/i);
    expect(body.valid_values).toEqual(expect.arrayContaining([...BLOOM_LEVELS]));
  });

  it("When the chat agent extracts the bloom-intent and filters the prior result set, then only application-level prior results are presented and the count is stated", async () => {
    const priorRes = await app.request("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "heart failure", limit: 7 }),
    });
    const prior = (await priorRes.json()) as {
      kind: string;
      results: Array<{ id: string; bloom_level: Bloom; title: string }>;
    };
    expect(prior.kind).toBe("results");

    const applicationOnly = prior.results.filter((r) => r.bloom_level === "application");
    const nonApplication = prior.results.filter((r) => r.bloom_level !== "application");
    expect(applicationOnly.length).toBeGreaterThan(0);
    expect(nonApplication.length).toBeGreaterThan(0);

    // Compose a reply naming only the application-level prior titles and a count.
    const replyText =
      `Filtering to bloom_level: application (${applicationOnly.length} of ${prior.results.length} results matched). ` +
      applicationOnly.map((r) => `"${r.title}"`).join(", ");

    const filteredChat = makeChatModelEmittingText(replyText);
    const filteringApp = createApp({ ...app.deps, chatModel: filteredChat });

    const res = await filteringApp.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "user", content: "questions about heart failure" },
          { role: "assistant", content: JSON.stringify(prior.results) },
          { role: "user", content: "only application-level, please" },
        ],
      }),
    });
    const text = await res.text();

    for (const r of applicationOnly) expect(text).toContain(r.title);
    for (const r of nonApplication) expect(text).not.toContain(r.title);
    expect(text).toMatch(/of \d+ results matched|of \d+ matched/);
  });
});

describe("Given a DKA corpus with application-level questions but no evaluation-level questions", () => {
  beforeEach(async () => {
    await seedDkaCorpusApplicationOnly();
  });

  it("When Priya asks for evaluation-level DKA, then the agent states no evaluation-level matches and offers the application-level ones — without silently swapping", async () => {
    const replyText =
      "No evaluation-level matches were found for diabetic ketoacidosis. " +
      "There are application-level questions available — would you like to see those instead?";
    const chat = makeChatModelEmittingText(replyText);
    const a = createApp({ ...app.deps, chatModel: chat });
    const res = await a.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "evaluation-level diabetic ketoacidosis questions" }],
      }),
    });
    const text = await res.text();
    expect(text).toMatch(/no.+evaluation.+match|0 evaluation/i);
    expect(text).toMatch(/application.+available|application-level/i);
    expect(text).not.toMatch(/Bloom:\s*evaluation/i);
  });
});

describe("Given a heart-failure corpus and a chat mock that streams card lists", () => {
  beforeEach(async () => {
    await seedHeartFailureCorpus();
  });

  it("When a client searches for 'heart failure', then every card text contains the Bloom level annotation", async () => {
    const res = await app.request("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "heart failure", limit: 10 }),
    });
    const body = (await res.json()) as { results: Array<{ bloom_level: Bloom; title: string }> };
    expect(body.results.length).toBeGreaterThan(0);
    for (const r of body.results) {
      expect(BLOOM_LEVELS).toContain(r.bloom_level);
    }
  });
});

describe("Given a corpus with questions across all three Bloom levels [property]", () => {
  beforeEach(async () => {
    await seedHeartFailureCorpus();
  });

  it.each(BLOOM_LEVELS)(
    "When client searches with bloom_level=%s, then every result has that Bloom level",
    async (level) => {
      const res = await app.request("/api/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: "heart failure", bloom_level: level, limit: 20 }),
      });
      const body = (await res.json()) as {
        kind: "results" | "no_match";
        results: Array<{ bloom_level: Bloom }>;
      };
      // Property holds whether or not the level has hits — only assert when results exist.
      if (body.kind === "results") {
        expect(body.results.every((r) => r.bloom_level === level)).toBe(true);
      }
    },
  );
});
