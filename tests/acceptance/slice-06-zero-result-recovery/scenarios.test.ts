// RED-ready: imports resolve once DELIVER step 0 lands the scaffolds.

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockLanguageModelV1, MockEmbeddingModelV1 } from "ai/test";

import { createApp } from "@netea/api";
import { resetCorpus, seedSjogrenNeurologicalCorpus, getAllCorpusTitles } from "@netea/db/test-helpers";

beforeEach(async () => {
  await resetCorpus();
});

describe("Given the corpus has no question about 'Sjogren posterior column degeneration'", () => {
  it("When a client searches /api/search, then the response carries kind='no_match', empty results, reason='no_match'", async () => {
    const app = createApp({
      enrichmentModel: new MockLanguageModelV1({ doGenerate: async () => { throw new Error("not used"); } }),
      embeddingModel: new MockEmbeddingModelV1({ doEmbed: async ({ values }) => ({ embeddings: values.map(() => Array(1536).fill(0)) }) }),
      chatModel: new MockLanguageModelV1({ doStream: async () => { throw new Error("not used"); } }),
    });

    const res = await app.request("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "Sjogren syndrome posterior column degeneration", limit: 5 }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { kind: "results" | "no_match"; results: unknown[]; reason?: string };
    expect(body.kind).toBe("no_match");
    expect(body.results).toEqual([]);
    expect(body.reason).toBe("no_match");
  });

  it("When the agent replies, then it states no matches and offers ≥2 reformulations without inventing titles", async () => {
    const app = createApp({
      enrichmentModel: new MockLanguageModelV1({ doGenerate: async () => { throw new Error("not used"); } }),
      embeddingModel: new MockEmbeddingModelV1({ doEmbed: async ({ values }) => ({ embeddings: values.map(() => Array(1536).fill(0)) }) }),
      chatModel: honestEmptyAgentMock(), // DELIVER step 0 scaffold provides
    });

    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "Sjogren syndrome posterior column degeneration" }] }),
    });
    const text = await res.text();

    expect(text.toLowerCase()).toMatch(/no.+match|did not find|0 questions/);

    // ≥2 reformulations: count numbered list items or bullet markers
    const suggestions = Array.from(text.matchAll(/(?:^|\n)\s*(?:\d+\.|[-*])\s+\S/g));
    expect(suggestions.length).toBeGreaterThanOrEqual(2);

    const knownTitles = new Set(await getAllCorpusTitles());
    const fakeTitles = Array.from(text.matchAll(/"([^"]{10,})"/g)).map((m) => m[1]).filter((t) => /Cardiology|Neurology|Endocrinology/i.test(t));
    for (const t of fakeTitles) expect(knownTitles.has(t)).toBe(true);
  });
});

describe("Given the corpus has no medical question about 'underwater basket weaving in medicine'", () => {
  it("When the agent replies, then it asks for clarification, claims no matches, and does not fabricate", async () => {
    const app = createApp({
      enrichmentModel: new MockLanguageModelV1({ doGenerate: async () => { throw new Error("not used"); } }),
      embeddingModel: new MockEmbeddingModelV1({ doEmbed: async ({ values }) => ({ embeddings: values.map(() => Array(1536).fill(0)) }) }),
      chatModel: clarificationAgentMock(), // DELIVER step 0 scaffold provides
    });

    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", content: "underwater basket weaving in medicine" }] }),
    });
    const text = await res.text();
    expect(text.toLowerCase()).toMatch(/no.+match|did not find|0 questions/);
    expect(text.toLowerCase()).toMatch(/did you mean|could you clarify|not a medical topic/);
    const fakeTitles = Array.from(text.matchAll(/"([^"]{10,})"/g)).map((m) => m[1]).filter((t) => /Cardiology|Neurology|Endocrinology/i.test(t));
    expect(fakeTitles).toHaveLength(0);
  });
});

describe("Given the agent offered 3 reformulations and the corpus contains 2 Sjogren neurological questions", () => {
  beforeEach(async () => {
    await seedSjogrenNeurologicalCorpus();
  });

  it("When Priya says 'yes, try option 1', then the agent re-searches with the option-1 query and presents both Sjogren neuro questions", async () => {
    const toolCallSpy = makeToolCallSpy();
    const app = createApp({
      enrichmentModel: new MockLanguageModelV1({ doGenerate: async () => { throw new Error("not used"); } }),
      embeddingModel: new MockEmbeddingModelV1({ doEmbed: async ({ values }) => ({ embeddings: values.map(() => Array(1536).fill(0)) }) }),
      chatModel: optInReformulationMock(toolCallSpy), // DELIVER step 0 scaffold provides
    });

    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [
          { role: "user", content: "Sjogren syndrome posterior column degeneration" },
          {
            role: "assistant",
            content:
              "I did not find matches. Try: (1) Sjogren neurological complications, (2) posterior column degeneration alone, (3) peripheral neuropathy in autoimmune disease.",
          },
          { role: "user", content: "yes, try option 1" },
        ],
      }),
    });
    const text = await res.text();
    expect(toolCallSpy.callsForTurn(2).map((c) => c.query)).toEqual(expect.arrayContaining([expect.stringMatching(/sjogren.+neurological|neurological.+sjogren/i)]));
    expect(text).toMatch(/Sjogren/i);
    expect((text.match(/Sjogren/gi) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("Given a 10-turn heart-failure conversation has accumulated and the latest search returns no_match", () => {
  it("When the agent replies, then it states no matches and does not pretend prior heart-failure results match the new query", async () => {
    const app = createApp({
      enrichmentModel: new MockLanguageModelV1({ doGenerate: async () => { throw new Error("not used"); } }),
      embeddingModel: new MockEmbeddingModelV1({ doEmbed: async ({ values }) => ({ embeddings: values.map(() => Array(1536).fill(0)) }) }),
      chatModel: honestEmptyUnderPressureMock(), // DELIVER step 0 scaffold provides
    });

    const longHistory = buildHeartFailureHistory(10); // DELIVER step 0 scaffold provides
    longHistory.push({ role: "user", content: "obscure-topic-not-in-corpus" });

    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: longHistory }),
    });
    const text = await res.text();
    expect(text.toLowerCase()).toMatch(/no.+match|did not find/);
    expect(text.toLowerCase()).not.toContain("heart failure");
  });
});

describe("[property] Given an empty-set test set of 5 queries", () => {
  it("When the agent replies to each, then no reply contains a question title that is not in the corpus", async () => {
    const emptySetQueries = [
      "Sjogren syndrome posterior column degeneration",
      "underwater basket weaving in medicine",
      "treatment of fictitious-virus-zeta in pediatrics",
      "ancient-egyptian-pharmacology approach to migraine",
      "klingon anatomy of the cardiovascular system",
    ];

    const app = createApp({
      enrichmentModel: new MockLanguageModelV1({ doGenerate: async () => { throw new Error("not used"); } }),
      embeddingModel: new MockEmbeddingModelV1({ doEmbed: async ({ values }) => ({ embeddings: values.map(() => Array(1536).fill(0)) }) }),
      chatModel: honestEmptyAgentMock(),
    });

    const knownTitles = new Set(await getAllCorpusTitles());
    for (const q of emptySetQueries) {
      const res = await app.request("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: q }] }),
      });
      const text = await res.text();
      const quoted = Array.from(text.matchAll(/"([^"]{10,})"/g)).map((m) => m[1]).filter((t) => /:\s/.test(t));
      for (const t of quoted) expect(knownTitles.has(t)).toBe(true);
    }
  });
});

declare function honestEmptyAgentMock(): MockLanguageModelV1;
declare function clarificationAgentMock(): MockLanguageModelV1;
declare function honestEmptyUnderPressureMock(): MockLanguageModelV1;
declare function optInReformulationMock(spy: ReturnType<typeof makeToolCallSpy>): MockLanguageModelV1;
declare function makeToolCallSpy(): { callsForTurn: (n: number) => Array<{ query: string }> };
declare function buildHeartFailureHistory(turns: number): Array<{ role: "user" | "assistant"; content: string }>;
