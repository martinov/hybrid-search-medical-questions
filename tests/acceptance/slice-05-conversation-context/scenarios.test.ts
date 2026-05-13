// RED-ready: imports resolve once DELIVER step 0 lands the scaffolds.

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockLanguageModelV1, MockEmbeddingModelV1 } from "ai/test";

import { createApp } from "@netea/api";
import { resetCorpus, seedHeartFailureCorpus } from "@netea/db/test-helpers";

beforeEach(async () => {
  await resetCorpus();
});

describe("Given the corpus contains three heart-failure questions with mixed Bloom levels", () => {
  beforeEach(async () => {
    await seedHeartFailureCorpus();
  });

  it("When Priya says 'open the second one', then the agent renders content of the prior #2 and does NOT invoke search", async () => {
    const toolCallSpy = makeToolCallSpy();
    const app = createApp({
      enrichmentModel: new MockLanguageModelV1({ doGenerate: async () => { throw new Error("not used"); } }),
      embeddingModel: new MockEmbeddingModelV1({ doEmbed: async ({ values }) => ({ embeddings: values.map(() => Array(1536).fill(0)) }) }),
      chatModel: openSecondPriorResultMock(toolCallSpy),
    });

    const priorRes = await app.request("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "heart failure", limit: 3 }),
    });
    const prior = (await priorRes.json()) as { results: Array<{ id: string; title: string; content: string }> };

    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "user", content: "heart failure questions" },
          { role: "assistant", content: JSON.stringify(prior.results) },
          { role: "user", content: "open the second one" },
        ],
      }),
    });
    const text = await res.text();

    expect(text).toContain(prior.results[1].title);
    expect(text).toContain(prior.results[1].content.slice(0, 80));
    expect(toolCallSpy.callsForTurn(2)).toEqual([]); // no search tool invocation on this turn
  });

  it("When Priya says 'only application-level among those', then only prior application-level results appear and no search is invoked", async () => {
    const toolCallSpy = makeToolCallSpy();
    const app = createApp({
      enrichmentModel: new MockLanguageModelV1({ doGenerate: async () => { throw new Error("not used"); } }),
      embeddingModel: new MockEmbeddingModelV1({ doEmbed: async ({ values }) => ({ embeddings: values.map(() => Array(1536).fill(0)) }) }),
      chatModel: filterPriorByApplicationMock(toolCallSpy),
    });

    const priorRes = await app.request("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "heart failure", limit: 3 }),
    });
    const prior = (await priorRes.json()) as { results: Array<{ id: string; title: string; bloom_level: string }> };
    const expectedTitles = prior.results.filter((r) => r.bloom_level === "application").map((r) => r.title);

    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "user", content: "heart failure questions" },
          { role: "assistant", content: JSON.stringify(prior.results) },
          { role: "user", content: "only application-level among those" },
        ],
      }),
    });
    const text = await res.text();

    for (const t of expectedTitles) expect(text).toContain(t);
    expect(toolCallSpy.callsForTurn(2)).toEqual([]); // no fresh search
  });

  it("When Priya pivots to DKA, then the agent invokes search with a DKA query and the reply contains no heart-failure titles", async () => {
    const toolCallSpy = makeToolCallSpy();
    const app = createApp({
      enrichmentModel: new MockLanguageModelV1({ doGenerate: async () => { throw new Error("not used"); } }),
      embeddingModel: new MockEmbeddingModelV1({ doEmbed: async ({ values }) => ({ embeddings: values.map(() => Array(1536).fill(0)) }) }),
      chatModel: topicShiftToDkaMock(toolCallSpy),
    });

    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "user", content: "heart failure questions" },
          { role: "assistant", content: "(prior results omitted)" },
          { role: "user", content: "what about diabetic ketoacidosis questions instead?" },
        ],
      }),
    });
    const text = await res.text();

    expect(toolCallSpy.callsForTurn(2).map((c) => c.query)).toEqual(expect.arrayContaining([expect.stringMatching(/diabetic ketoacidosis|DKA/i)]));
    expect(text.toLowerCase()).not.toContain("heart failure");
  });

  it("When a 20-turn conversation is supplied, then the agent still replies within 5 seconds with non-empty content", async () => {
    const app = createApp({
      enrichmentModel: new MockLanguageModelV1({ doGenerate: async () => { throw new Error("not used"); } }),
      embeddingModel: new MockEmbeddingModelV1({ doEmbed: async ({ values }) => ({ embeddings: values.map(() => Array(1536).fill(0)) }) }),
      chatModel: normalReplyMock(),
    });

    const longHistory = Array.from({ length: 20 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: `turn ${i + 1}`,
    }));
    longHistory.push({ role: "user", content: "follow-up about heart failure" });

    const started = Date.now();
    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: longHistory }),
    });
    const elapsed = Date.now() - started;
    const text = await res.text();
    expect(elapsed).toBeLessThan(5000);
    expect(text.length).toBeGreaterThan(0);
  });

  it("When Priya asks 'open the seventh one' but only three results existed, then the reply states no seventh exists and invents nothing", async () => {
    const app = createApp({
      enrichmentModel: new MockLanguageModelV1({ doGenerate: async () => { throw new Error("not used"); } }),
      embeddingModel: new MockEmbeddingModelV1({ doEmbed: async ({ values }) => ({ embeddings: values.map(() => Array(1536).fill(0)) }) }),
      chatModel: outOfRangeOrdinalMock(),
    });

    const priorRes = await app.request("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "heart failure", limit: 3 }),
    });
    const prior = (await priorRes.json()) as { results: Array<{ title: string }> };

    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "user", content: "heart failure questions" },
          { role: "assistant", content: JSON.stringify(prior.results) },
          { role: "user", content: "open the seventh one" },
        ],
      }),
    });
    const text = await res.text();
    expect(text.toLowerCase()).toMatch(/no seventh|only 3|only three|out of range/);
    // No invented titles — every cited title must come from prior results.
    const cited = Array.from(text.matchAll(/\[Cardiology\][^\n]+/g)).map((m) => m[0].trim());
    const known = new Set(prior.results.map((r) => `[Cardiology] ${r.title}`));
    for (const c of cited) expect(known.has(c)).toBe(true);
  });
});

declare function makeToolCallSpy(): { callsForTurn: (n: number) => Array<{ query: string }> };
declare function openSecondPriorResultMock(spy: ReturnType<typeof makeToolCallSpy>): MockLanguageModelV1;
declare function filterPriorByApplicationMock(spy: ReturnType<typeof makeToolCallSpy>): MockLanguageModelV1;
declare function topicShiftToDkaMock(spy: ReturnType<typeof makeToolCallSpy>): MockLanguageModelV1;
declare function normalReplyMock(): MockLanguageModelV1;
declare function outOfRangeOrdinalMock(): MockLanguageModelV1;
