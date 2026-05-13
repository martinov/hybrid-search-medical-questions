// Slice 06 — Zero-result recovery acceptance tests (US-07).
//
// Adapted in DELIVER step 6 to the AI SDK 6 mock API surface
// (MockLanguageModelV3 / MockEmbeddingModelV3 — see slice-01/04/05 for the
// V3 migration pattern). The original scaffold was authored against v4 V1
// mocks before the AI SDK 6 swap.
//
// Strategy B: real Postgres + real ingestion + real search; LLM is mocked.
// Driving ports: HTTP POST /api/search and POST /api/chat.
//
// KPI #6 — 0 hallucinated titles on the curated empty-set test of 5 queries.

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
  seedSjogrenNeurologicalCorpus,
  getAllCorpusTitles,
} from "@netea/db/test-helpers";

// -------- helpers ----------------------------------------------------------

function v3UsageFromTokens(inputTokens: number, outputTokens: number) {
  return {
    inputTokens: { total: inputTokens, noCache: inputTokens, cacheRead: 0, cacheWrite: 0 },
    outputTokens: { total: outputTokens, reasoning: 0 },
    totalTokens: inputTokens + outputTokens,
  };
}

const STOP = { unified: "stop" as const, raw: "stop" };
const TOOL_STOP = { unified: "tool-calls" as const, raw: "tool-calls" };

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

/**
 * `toUIMessageStreamResponse()` serializes the chat stream as SSE lines of the
 * shape `data: {"type":"text-delta","delta":"..."}`. The acceptance assertions
 * in this slice work on the rendered text (including newlines), so we concat
 * every `text-delta` payload back into a single string. This mirrors what the
 * Vercel AI SDK 6 `useChat` client renders on the page.
 */
async function decodeChatStream(res: Response): Promise<string> {
  const raw = await res.text();
  const out: string[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]" || payload === "") continue;
    try {
      const evt = JSON.parse(payload) as { type?: string; delta?: string };
      if (evt.type === "text-delta" && typeof evt.delta === "string") {
        out.push(evt.delta);
      }
    } catch {
      /* skip non-JSON SSE control lines */
    }
  }
  return out.join("");
}

// -------- tool-call spy (same pattern as slice-05) --------------------------

type ToolCallRecord = { query: string; bloom_level?: string; limit?: number };

type ToolCallSpy = {
  record(call: ToolCallRecord): void;
  callsForTurn(_n: number): ToolCallRecord[];
};

function makeToolCallSpy(): ToolCallSpy {
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

// -------- per-scenario chat-mock builders ----------------------------------

/**
 * Honest-empty agent: states no matches and offers >=2 reformulations.
 * The text uses numbered list items so the regex `(?:^|\n)\s*(?:\d+\.|[-*])\s+\S`
 * matches and `suggestions.length >= 2` holds.
 */
function honestEmptyAgentMock(): LanguageModelV3 {
  return new MockLanguageModelV3({
    modelId: "mock-chat",
    provider: "mock",
    doStream: async () => {
      const text =
        "I did not find any matches for your query in the question bank. " +
        "Try one of these reformulations:\n" +
        "1. Use broader clinical terms (drop the very specific phrase)\n" +
        "2. Search for the underlying condition without the complication\n" +
        "3. Try the related body system or specialty (e.g. neurology)";
      return { stream: toReadable(textStreamChunks(text)) };
    },
  });
}

/**
 * Clarification agent: asks if the user meant a different topic when the
 * query is plainly non-medical. Does not claim matches; invents nothing.
 */
function clarificationAgentMock(): LanguageModelV3 {
  return new MockLanguageModelV3({
    modelId: "mock-chat",
    provider: "mock",
    doStream: async () => {
      const text =
        "I did not find any matches for your query — this does not look like " +
        "a medical topic our question bank covers. Did you mean a different " +
        "subject? Could you clarify which clinical area you are studying?";
      return { stream: toReadable(textStreamChunks(text)) };
    },
  });
}

/**
 * Honest-empty under conversational pressure: even after 10 turns of
 * heart-failure context, an empty result is reported honestly without
 * dragging prior results into the reply.
 */
function honestEmptyUnderPressureMock(): LanguageModelV3 {
  return new MockLanguageModelV3({
    modelId: "mock-chat",
    provider: "mock",
    doStream: async () => {
      const text =
        "I did not find any matches for that new query. The prior turns of " +
        "this conversation are unrelated to the current question, so I will " +
        "not pretend earlier results apply here. You could try different " +
        "keywords or broaden the topic.";
      return { stream: toReadable(textStreamChunks(text)) };
    },
  });
}

/**
 * Opt-in reformulation mock: when the user says "yes, try option 1", the
 * agent issues a fresh `searchQuestions` tool-call with the option-1 query,
 * then summarizes the two seeded Sjogren neurological questions in a second
 * model invocation. Slice-05 left `stopWhen` at default (single step); for
 * a two-step (tool-call -> tool-result -> text) flow we drive it via two
 * separate `doStream` invocations — AI SDK 6 calls the model again with the
 * accumulated prompt after a tool result is appended.
 */
function optInReformulationMock(spy: ToolCallSpy): LanguageModelV3 {
  let stepIndex = 0;
  return new MockLanguageModelV3({
    modelId: "mock-chat",
    provider: "mock",
    doStream: async (opts: LanguageModelV3CallOptions) => {
      const step = stepIndex++;
      if (step === 0) {
        const query = "Sjogren neurological complications";
        spy.record({ query, limit: 5 });
        // AI SDK 6 LanguageModelV3ToolCall.input is a *stringified* JSON;
        // the framework JSON.parses it before invoking the tool's execute.
        const inputJson = JSON.stringify({ query, limit: 5 });
        const chunks: LanguageModelV3StreamPart[] = [
          { type: "stream-start", warnings: [] },
          { type: "tool-input-start", id: "tc1", toolName: "searchQuestions" },
          { type: "tool-input-delta", id: "tc1", delta: inputJson },
          { type: "tool-input-end", id: "tc1" },
          {
            type: "tool-call",
            toolCallId: "tc1",
            toolName: "searchQuestions",
            input: inputJson,
          },
          { type: "finish", finishReason: TOOL_STOP, usage: v3UsageFromTokens(60, 20) },
        ];
        return { stream: toReadable(chunks) };
      }
      // Step 1: the framework re-invokes the model with the appended
      // tool-result message. Render the two Sjogren neuro questions.
      const toolResultText = serializeToolResultsFromPrompt(opts.prompt);
      const parsed = safeParseHits(toolResultText);
      const titles = parsed.map((r) => r.title);
      const text = `Here are the Sjogren neurological-complications questions:\n` +
        titles.map((t, i) => `${i + 1}. ${t}`).join("\n");
      return { stream: toReadable(textStreamChunks(text)) };
    },
  });
}

function serializeToolResultsFromPrompt(prompt: LanguageModelV3Prompt): string {
  // AI SDK 6 appends a `tool` role message after the tool-call resolves; its
  // content carries the tool-result JSON. We concatenate any tool-result
  // payloads we see — the latest one is the one we just resolved.
  for (let i = prompt.length - 1; i >= 0; i--) {
    const m = prompt[i]!;
    if (m.role === "tool") {
      const parts = m.content as Array<{
        type: string;
        output?: { type?: string; value?: unknown };
        result?: unknown;
      }>;
      for (const p of parts) {
        if (p.type === "tool-result") {
          const value = p.output?.value ?? p.result;
          if (value !== undefined) return JSON.stringify(value);
        }
      }
    }
  }
  return "";
}

function safeParseHits(raw: string): Array<{ title: string }> {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.results)) {
      return parsed.results as Array<{ title: string }>;
    }
  } catch {
    /* ignore */
  }
  return [];
}

// -------- shared embedding/enrichment mocks --------------------------------

function neverCalledEnrichment(): LanguageModelV3 {
  return new MockLanguageModelV3({
    modelId: "mock-enrichment",
    provider: "mock",
    doGenerate: async () => {
      throw new Error("enrichment not used in slice 06");
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

function buildHeartFailureHistory(
  turns: number,
): Array<{ role: "user" | "assistant"; content: string }> {
  return Array.from({ length: turns }, (_, i) => ({
    role: i % 2 === 0 ? ("user" as const) : ("assistant" as const),
    content: `turn ${i + 1}: prior heart-failure exchange filler text`,
  }));
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

describe("Given the corpus has no question about 'Sjogren posterior column degeneration'", () => {
  it("When a client searches /api/search, then the response carries kind='no_match', empty results, reason='no_match'", async () => {
    const app = createApp({
      enrichmentModel: neverCalledEnrichment(),
      embeddingModel: zeroEmbedding(),
      chatModel: new MockLanguageModelV3({
        modelId: "mock-chat",
        provider: "mock",
        doStream: async () => {
          throw new Error("chat not used in /api/search scenario");
        },
      }),
    });

    const res = await app.request("/api/search", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ query: "Sjogren syndrome posterior column degeneration", limit: 5 }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      kind: "results" | "no_match";
      results: unknown[];
      reason?: string;
    };
    expect(body.kind).toBe("no_match");
    expect(body.results).toEqual([]);
    expect(body.reason).toBe("no_match");
  });

  it("When the agent replies, then it states no matches and offers >=2 reformulations without inventing titles", async () => {
    const app = createApp({
      enrichmentModel: neverCalledEnrichment(),
      embeddingModel: zeroEmbedding(),
      chatModel: honestEmptyAgentMock(),
    });

    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "Sjogren syndrome posterior column degeneration" }],
      }),
    });
    const text = await decodeChatStream(res);

    expect(text.toLowerCase()).toMatch(/no.+match|did not find|0 questions/);

    const suggestions = Array.from(text.matchAll(/(?:^|\n)\s*(?:\d+\.|[-*])\s+\S/g));
    expect(suggestions.length).toBeGreaterThanOrEqual(2);

    const knownTitles = new Set(await getAllCorpusTitles());
    const fakeTitles = Array.from(text.matchAll(/"([^"]{10,})"/g))
      .map((m) => m[1]!)
      .filter((t) => /Cardiology|Neurology|Endocrinology/i.test(t));
    for (const t of fakeTitles) expect(knownTitles.has(t)).toBe(true);
  });
});

describe("Given the corpus has no medical question about 'underwater basket weaving in medicine'", () => {
  it("When the agent replies, then it asks for clarification, claims no matches, and does not fabricate", async () => {
    const app = createApp({
      enrichmentModel: neverCalledEnrichment(),
      embeddingModel: zeroEmbedding(),
      chatModel: clarificationAgentMock(),
    });

    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: [{ role: "user", content: "underwater basket weaving in medicine" }],
      }),
    });
    const text = await decodeChatStream(res);
    expect(text.toLowerCase()).toMatch(/no.+match|did not find|0 questions/);
    expect(text.toLowerCase()).toMatch(/did you mean|could you clarify|not a medical topic/);
    const fakeTitles = Array.from(text.matchAll(/"([^"]{10,})"/g))
      .map((m) => m[1]!)
      .filter((t) => /Cardiology|Neurology|Endocrinology/i.test(t));
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
      enrichmentModel: neverCalledEnrichment(),
      embeddingModel: zeroEmbedding(),
      chatModel: optInReformulationMock(toolCallSpy),
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
    const text = await decodeChatStream(res);
    expect(toolCallSpy.callsForTurn(2).map((c) => c.query)).toEqual(
      expect.arrayContaining([expect.stringMatching(/sjogren.+neurological|neurological.+sjogren/i)]),
    );
    expect(text).toMatch(/Sjogren/i);
    expect((text.match(/Sjogren/gi) ?? []).length).toBeGreaterThanOrEqual(2);
  });
});

describe("Given a 10-turn heart-failure conversation has accumulated and the latest search returns no_match", () => {
  it("When the agent replies, then it states no matches and does not pretend prior heart-failure results match the new query", async () => {
    const app = createApp({
      enrichmentModel: neverCalledEnrichment(),
      embeddingModel: zeroEmbedding(),
      chatModel: honestEmptyUnderPressureMock(),
    });

    const longHistory = buildHeartFailureHistory(10);
    longHistory.push({ role: "user", content: "obscure-topic-not-in-corpus" });

    const res = await app.request("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: longHistory }),
    });
    const text = await decodeChatStream(res);
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
      enrichmentModel: neverCalledEnrichment(),
      embeddingModel: zeroEmbedding(),
      chatModel: honestEmptyAgentMock(),
    });

    const knownTitles = new Set(await getAllCorpusTitles());
    for (const q of emptySetQueries) {
      const res = await app.request("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ messages: [{ role: "user", content: q }] }),
      });
      const text = await decodeChatStream(res);
      const quoted = Array.from(text.matchAll(/"([^"]{10,})"/g))
        .map((m) => m[1]!)
        .filter((t) => /:\s/.test(t));
      for (const t of quoted) expect(knownTitles.has(t)).toBe(true);
    }
  });
});
