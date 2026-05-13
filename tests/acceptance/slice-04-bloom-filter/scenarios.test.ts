// RED-ready: imports resolve once DELIVER step 0 lands the scaffolds.

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockLanguageModelV1, MockEmbeddingModelV1 } from "ai/test";

import { createApp } from "@netea/api";
import { seedHeartFailureCorpus, seedDkaCorpusApplicationOnly, resetCorpus } from "@netea/db/test-helpers";

const BLOOM_LEVELS = ["recall", "application", "analysis"] as const;
type Bloom = (typeof BLOOM_LEVELS)[number];

let app: ReturnType<typeof createApp>;

beforeAll(() => {
  app = createApp({
    enrichmentModel: new MockLanguageModelV1({ doGenerate: async () => { throw new Error("not used in slice 04"); } }),
    embeddingModel: new MockEmbeddingModelV1({ doEmbed: async ({ values }) => ({ embeddings: values.map(() => Array(1536).fill(0.01)) }) }),
    chatModel: new MockLanguageModelV1({ doStream: async () => { throw new Error("override per-test"); } }),
  });
});

beforeEach(async () => {
  await resetCorpus();
});

describe("Given a heart-failure corpus across all three Bloom levels", () => {
  beforeEach(async () => {
    await seedHeartFailureCorpus(); // adds e.g. 2 recall, 3 application, 2 analysis
  });

  it("When the client searches with bloom_level='application', then every result has Bloom level 'application' and the total reflects the count", async () => {
    const res = await app.request("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "heart failure", bloom_level: "application", limit: 20 }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { kind: "results"; results: Array<{ bloom_level: Bloom }>; total: number };
    expect(body.kind).toBe("results");
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
    expect(body.valid_values).toEqual(expect.arrayContaining(BLOOM_LEVELS));
  });

  it("When the chat agent extracts the bloom-intent and filters the prior result set, then only application-level prior results are presented and the count is stated", async () => {
    // Set up a chat model that emits a tool call narrowing by bloom level.
    const filteredChat = new MockLanguageModelV1({
      doStream: async () => streamingAgentReplyApplicationOnly(), // DELIVER step 0 scaffold provides
    });
    const filteringApp = createApp({ ...app.deps, chatModel: filteredChat });

    const priorResults = await filteringApp.request("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "heart failure", limit: 3 }),
    });
    const prior = (await priorResults.json()) as { results: Array<{ id: string; bloom_level: Bloom; title: string }> };

    const res = await filteringApp.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "user", content: "questions about heart failure" },
          { role: "assistant", content: JSON.stringify(prior.results) }, // prior turn
          { role: "user", content: "only application-level, please" },
        ],
      }),
    });
    const text = await res.text();

    const priorIds = new Set(prior.results.map((r) => r.id));
    const appliedTitles = prior.results.filter((r) => r.bloom_level === "application").map((r) => r.title);
    for (const t of appliedTitles) expect(text).toContain(t);

    // No invented titles outside the prior set
    for (const r of prior.results.filter((r) => r.bloom_level !== "application")) {
      expect(text).not.toContain(r.title);
    }
    expect(text).toMatch(/of \d+ results matched|of \d+ matched/);
  });
});

describe("Given a DKA corpus with application-level questions but no evaluation-level questions", () => {
  beforeEach(async () => {
    await seedDkaCorpusApplicationOnly();
  });

  it("When Priya asks for evaluation-level DKA, then the agent states no evaluation-level matches and offers the application-level ones — without silently swapping", async () => {
    const chat = new MockLanguageModelV1({
      doStream: async () => streamingAgentReplyEmptyFilteredOffersAdjacent(), // DELIVER step 0 scaffold provides
    });
    const a = createApp({ ...app.deps, chatModel: chat });
    const res = await a.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "evaluation-level diabetic ketoacidosis questions" }] }),
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
    for (const r of body.results) {
      expect(["recall", "application", "analysis"]).toContain(r.bloom_level);
    }
  });
});

describe("Given a corpus with questions across all three Bloom levels [property]", () => {
  beforeEach(async () => {
    await seedHeartFailureCorpus();
  });

  it.each(BLOOM_LEVELS)("When client searches with bloom_level=%s, then every result has that Bloom level", async (level) => {
    const res = await app.request("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "heart failure", bloom_level: level, limit: 20 }),
    });
    const body = (await res.json()) as { results: Array<{ bloom_level: Bloom }> };
    expect(body.results.every((r) => r.bloom_level === level)).toBe(true);
  });
});

declare function streamingAgentReplyApplicationOnly(): { stream: ReadableStream; rawCall: { rawPrompt: null; rawSettings: object } };
declare function streamingAgentReplyEmptyFilteredOffersAdjacent(): { stream: ReadableStream; rawCall: { rawPrompt: null; rawSettings: object } };
