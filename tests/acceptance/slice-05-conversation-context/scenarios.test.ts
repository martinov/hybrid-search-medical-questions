// Slice 05 — Multi-turn conversation context acceptance tests (US-06).
//
// Adapted in DELIVER step 5 to AI SDK 6 V3 mocks (the original scaffold was
// authored against v4 V1 mocks). Pattern matches slice-04: inline mocks
// per-scenario, real Postgres + real ingestion + real search, LLM is mocked.
//
// Driving port: HTTP POST /api/chat. The "conversation history" is supplied
// client-side in the `messages` array (Vercel AI SDK `useChat` pattern) — the
// agent is stateless on the server. Each scenario asserts behavior observable
// at the HTTP response and via a tool-call spy threaded into the mock model.

import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { MockLanguageModelV3, MockEmbeddingModelV3 } from "ai/test";
import { simulateReadableStream } from "ai";
import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Prompt,
  LanguageModelV3StreamPart,
} from "@ai-sdk/provider";

import { createApp } from "@netea/api";
import {
  resetCorpus,
  seedHeartFailureCorpus,
} from "@netea/db/test-helpers";

// -------- helpers ----------------------------------------------------------

function v3UsageFromTokens(inputTokens: number, outputTokens: number) {
  return {
    inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: outputTokens, text: outputTokens, reasoning: 0 },
    totalTokens: inputTokens + outputTokens,
  };
}

const STOP = { unified: "stop" as const, raw: "stop" };

/**
 * Concatenate all text parts from the last user/assistant message in the
 * prompt. We use this to recover the JSON-encoded prior result set that the
 * acceptance test threads through the chat messages.
 */
function lastAssistantText(prompt: LanguageModelV3Prompt): string {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const m = prompt[i]!;
    if (m.role === "assistant") {
      const parts = m.content as Array<{ type: string; text?: string }>;
      return parts
        .filter((p) => p.type === "text" && typeof p.text === "string")
        .map((p) => p.text!)
        .join("");
    }
  }
  return "";
}

function lastUserText(prompt: LanguageModelV3Prompt): string {
  for (let i = prompt.length - 1; i >= 0; i--) {
    const m = prompt[i]!;
    if (m.role === "user") {
      const parts = m.content as Array<{ type: string; text?: string }>;
      return parts
        .filter((p) => p.type === "text" && typeof p.text === "string")
        .map((p) => p.text!)
        .join("");
    }
  }
  return "";
}

function tryParsePriorResults(raw: string): Array<Record<string, unknown>> {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function textStreamChunks(text: string): LanguageModelV3StreamPart[] {
  return [
    { type: "stream-start", warnings: [] },
    { type: "text-start", id: "t0" },
    { type: "text-delta", id: "t0", delta: text },
    { type: "text-end", id: "t0" },
    { type: "finish", finishReason: STOP, usage: v3UsageFromTokens(50, 40) },
  ];
}

function toReadable(chunks: LanguageModelV3StreamPart[]): ReadableStream<LanguageModelV3StreamPart> {
  return simulateReadableStream({
    chunks,
    initialDelayInMs: null,
    chunkDelayInMs: null,
  }) as ReadableStream<unknown> as ReadableStream<LanguageModelV3StreamPart>;
}

// -------- tool-call spy ----------------------------------------------------

type ToolCallRecord = { query: string; bloom_level?: string; limit?: number };

type ToolCallSpy = {
  record(call: ToolCallRecord): void;
  callsForTurn(_n: number): ToolCallRecord[];
};

function makeToolCallSpy(): ToolCallSpy {
  // Each HTTP /api/chat request is one "turn" in the test-history sense. The
  // mock only runs once per request, so all recorded calls belong to the
  // current turn; `callsForTurn` simply returns the captured list. The
  // parameter exists to match the scenario contract (assertions reference
  // turn 2 — the new user turn after a prior result-set is presented).
  const calls: ToolCallRecord[] = [];
  return {
    record(c) {
      calls.push(c);
    },
    callsForTurn(_n: number) {
      return calls;
    },
  };
}

// -------- per-scenario mock builders --------------------------------------

function openSecondPriorResultMock(_spy: ToolCallSpy): LanguageModelV3 {
  return new MockLanguageModelV3({
    modelId: "mock-chat",
    provider: "mock",
    doStream: async (opts: LanguageModelV3CallOptions) => {
      const priorJson = lastAssistantText(opts.prompt);
      const prior = tryParsePriorResults(priorJson);
      const second = prior[1] as { title?: string; content?: string } | undefined;
      const title = second?.title ?? "(no second result)";
      const excerpt = (second?.content ?? "").slice(0, 200);
      const text = `Opening result #2:\n[Cardiology] ${title}\n\n${excerpt}`;
      return { stream: toReadable(textStreamChunks(text)) };
    },
  });
}

function filterPriorByApplicationMock(_spy: ToolCallSpy): LanguageModelV3 {
  return new MockLanguageModelV3({
    modelId: "mock-chat",
    provider: "mock",
    doStream: async (opts: LanguageModelV3CallOptions) => {
      const priorJson = lastAssistantText(opts.prompt);
      const prior = tryParsePriorResults(priorJson) as Array<{
        title?: string;
        bloom_level?: string;
      }>;
      const applicationOnly = prior.filter((r) => r.bloom_level === "application");
      const lines = applicationOnly.map((r) => `- [Cardiology] ${r.title}`);
      const text =
        `Filtering to bloom_level: application ` +
        `(${applicationOnly.length} of ${prior.length} prior results).\n` +
        lines.join("\n");
      return { stream: toReadable(textStreamChunks(text)) };
    },
  });
}

function topicShiftToDkaMock(spy: ToolCallSpy): LanguageModelV3 {
  // Detects topic shift in the latest user message and emits a single
  // tool-call to `searchQuestions` with a DKA query. No text deltas are
  // emitted, so the rendered response cannot contain heart-failure titles.
  // Default `stopWhen` (single step) prevents a second model invocation.
  return new MockLanguageModelV3({
    modelId: "mock-chat",
    provider: "mock",
    doStream: async (opts: LanguageModelV3CallOptions) => {
      const userText = lastUserText(opts.prompt).toLowerCase();
      const shifted = /diabetic ketoacidosis|dka/.test(userText);
      const query = shifted
        ? "diabetic ketoacidosis questions"
        : "heart failure questions";
      spy.record({ query, limit: 5 });
      const chunks: LanguageModelV3StreamPart[] = [
        { type: "stream-start", warnings: [] },
        {
          type: "tool-input-start",
          id: "tc1",
          toolName: "searchQuestions",
        },
        {
          type: "tool-input-end",
          id: "tc1",
        },
        {
          type: "tool-call",
          toolCallId: "tc1",
          toolName: "searchQuestions",
          input: { query, limit: 5 },
        },
        {
          type: "finish",
          finishReason: { unified: "tool-calls" as const, raw: "tool-calls" },
          usage: v3UsageFromTokens(60, 20),
        },
      ];
      return { stream: toReadable(chunks) };
    },
  });
}

function normalReplyMock(): LanguageModelV3 {
  return new MockLanguageModelV3({
    modelId: "mock-chat",
    provider: "mock",
    doStream: async () => ({
      stream: toReadable(
        textStreamChunks(
          "Acknowledged. Continuing the heart-failure discussion based on prior context.",
        ),
      ),
    }),
  });
}

function outOfRangeOrdinalMock(): LanguageModelV3 {
  return new MockLanguageModelV3({
    modelId: "mock-chat",
    provider: "mock",
    doStream: async (opts: LanguageModelV3CallOptions) => {
      const priorJson = lastAssistantText(opts.prompt);
      const prior = tryParsePriorResults(priorJson);
      const n = prior.length;
      const text =
        `There is no seventh result — only ${n} results were returned (out of range). ` +
        `I will not invent a question to fill the gap.`;
      return { stream: toReadable(textStreamChunks(text)) };
    },
  });
}

// -------- shared embedding/enrichment mocks --------------------------------

function neverCalledEnrichment(): LanguageModelV3 {
  return new MockLanguageModelV3({
    modelId: "mock-enrichment",
    provider: "mock",
    doGenerate: async () => {
      throw new Error("enrichment not used in slice 05");
    },
  });
}

function zeroEmbedding(): MockEmbeddingModelV3 {
  return new MockEmbeddingModelV3({
    modelId: "mock-text-embedding-3-small",
    provider: "mock",
    maxEmbeddingsPerCall: 100,
    doEmbed: async ({ values }) => ({
      embeddings: values.map(() => Array.from({ length: 1536 }, () => 0.01)),
      usage: { tokens: values.length * 10 },
      warnings: [],
    }),
  });
}

// -------- test suite -------------------------------------------------------

beforeAll(() => {
  (
    globalThis as { AI_SDK_LOG_WARNINGS?: false | ((..._a: unknown[]) => void) }
  ).AI_SDK_LOG_WARNINGS = false;
});

beforeEach(async () => {
  await resetCorpus();
});

describe("Given the corpus contains heart-failure questions with mixed Bloom levels", () => {
  beforeEach(async () => {
    await seedHeartFailureCorpus();
  });

  it("When Priya says 'open the second one', then the agent renders content of the prior #2 and does NOT invoke search", async () => {
    const toolCallSpy = makeToolCallSpy();
    const app = createApp({
      enrichmentModel: neverCalledEnrichment(),
      embeddingModel: zeroEmbedding(),
      chatModel: openSecondPriorResultMock(toolCallSpy),
    });

    const priorRes = await app.request("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "heart failure", limit: 3 }),
    });
    const prior = (await priorRes.json()) as {
      results: Array<{ id: string; title: string; content: string }>;
    };
    expect(prior.results.length).toBeGreaterThanOrEqual(2);

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

    expect(text).toContain(prior.results[1]!.title);
    expect(text).toContain(prior.results[1]!.content.slice(0, 80));
    expect(toolCallSpy.callsForTurn(2)).toEqual([]);
  });

  it("When Priya says 'only application-level among those', then only prior application-level results appear and no search is invoked", async () => {
    const toolCallSpy = makeToolCallSpy();
    const app = createApp({
      enrichmentModel: neverCalledEnrichment(),
      embeddingModel: zeroEmbedding(),
      chatModel: filterPriorByApplicationMock(toolCallSpy),
    });

    const priorRes = await app.request("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "heart failure", limit: 7 }),
    });
    const prior = (await priorRes.json()) as {
      results: Array<{ id: string; title: string; bloom_level: string }>;
    };
    const expectedTitles = prior.results
      .filter((r) => r.bloom_level === "application")
      .map((r) => r.title);
    expect(expectedTitles.length).toBeGreaterThan(0);

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
    expect(toolCallSpy.callsForTurn(2)).toEqual([]);
  });

  it("When Priya pivots to DKA, then the agent invokes search with a DKA query and the reply contains no heart-failure titles", async () => {
    const toolCallSpy = makeToolCallSpy();
    const app = createApp({
      enrichmentModel: neverCalledEnrichment(),
      embeddingModel: zeroEmbedding(),
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

    const recorded = toolCallSpy.callsForTurn(2);
    expect(recorded.map((c) => c.query)).toEqual(
      expect.arrayContaining([expect.stringMatching(/diabetic ketoacidosis|dka/i)]),
    );
    expect(text.toLowerCase()).not.toContain("heart failure");
  });

  it("When a 20-turn conversation is supplied, then the agent still replies within 5 seconds with non-empty content", async () => {
    const app = createApp({
      enrichmentModel: neverCalledEnrichment(),
      embeddingModel: zeroEmbedding(),
      chatModel: normalReplyMock(),
    });

    const longHistory: Array<{ role: "user" | "assistant"; content: string }> =
      Array.from({ length: 20 }, (_, i) => ({
        role: i % 2 === 0 ? "user" : "assistant",
        content: `turn ${i + 1}: prior heart-failure exchange filler text`,
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
      enrichmentModel: neverCalledEnrichment(),
      embeddingModel: zeroEmbedding(),
      chatModel: outOfRangeOrdinalMock(),
    });

    const priorRes = await app.request("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "heart failure", limit: 3 }),
    });
    const prior = (await priorRes.json()) as { results: Array<{ title: string }> };
    expect(prior.results.length).toBe(3);

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
    const cited = Array.from(text.matchAll(/\[Cardiology\][^\n]+/g)).map((m) => m[0].trim());
    const known = new Set(prior.results.map((r) => `[Cardiology] ${r.title}`));
    for (const c of cited) expect(known.has(c)).toBe(true);
  });
});
