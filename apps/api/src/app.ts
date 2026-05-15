// apps/api/src/app — `createApp({deps})` factory.
//
// Returns a Hono app extended with a `.deps` accessor so tests can read back
// the wired-in models (acceptance tests do `app.deps.enrichmentModel`).
//
// Chat path uses `@mastra/core` Agent — the framework named by the brief is
// load-bearing. Mastra@1.33 peer-supports Zod 4 (`^3.25.0 || ^4.0.0`); the
// earlier DLV-5 reasoning about a Zod-4 peer-mismatch was stale (mastra's
// `@ai-sdk/ui-utils-v5` is a npm-aliased internal dependency, not a peer).
// Agent.stream() output is piped through `@mastra/ai-sdk`'s `toAISdkStream`
// + AI SDK's `createUIMessageStream*` so `useChat` on the client renders the
// same UI message stream protocol it always did.

import { getDb } from "@netea/db";
import { hybridSearch } from "@netea/search";
import {
  SearchQuerySchema,
  BLOOM_LEVELS_POC,
  type SearchQuery,
} from "@netea/schemas";
import { Hono } from "hono";
import { Agent } from "@mastra/core/agent";
import { toAISdkStream } from "@mastra/ai-sdk";
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  stepCountIs,
  type EmbeddingModel,
  type LanguageModel,
  type ModelMessage,
} from "ai";
import { z } from "zod";
import { SYSTEM_PROMPT } from "./conversation/system-prompt.js";
import { makeSearchQuestionsTool } from "./conversation/tools/search-questions.js";

export type AppDeps = {
  enrichmentModel: LanguageModel;
  embeddingModel: EmbeddingModel;
  chatModel: LanguageModel;
};

export type NeteaApp = Hono & { deps: AppDeps };

const SearchBodySchema = SearchQuerySchema;

const ChatBodySchema = z.object({
  messages: z.array(
    z.union([
      // legacy short shape used by acceptance tests
      z.object({
        role: z.enum(["user", "assistant", "system"]),
        content: z.string(),
      }),
      // AI SDK 6 UIMessage shape: parts[]
      z.object({
        id: z.string().optional(),
        role: z.enum(["user", "assistant", "system"]),
        parts: z.array(
          z.union([
            z.object({ type: z.literal("text"), text: z.string() }),
            z.object({ type: z.string() }).passthrough(),
          ]),
        ),
      }),
    ]),
  ),
});

function uiOrLegacyMessagesToModelMessages(
  messages: z.infer<typeof ChatBodySchema>["messages"],
): ModelMessage[] {
  return messages.map((m) => {
    if ("content" in m && typeof m.content === "string") {
      return { role: m.role, content: m.content } as ModelMessage;
    }
    if ("parts" in m) {
      const text = m.parts
        .filter(
          (p): p is { type: "text"; text: string } =>
            (p as { type?: string }).type === "text",
        )
        .map((p) => p.text)
        .join("");
      return { role: m.role, content: text } as ModelMessage;
    }
    return { role: "user", content: "" } as ModelMessage;
  });
}

export function createApp(deps: AppDeps): NeteaApp {
  const app = new Hono() as NeteaApp;
  app.deps = deps;

  app.get("/api/healthz", async (c) => {
    let dbHealthy = false;
    try {
      const db = getDb();
      await db.$client`SELECT 1`;
      dbHealthy = true;
    } catch {
      dbHealthy = false;
    }
    const status = dbHealthy ? 200 : 503;
    return c.json(
      {
        api: "healthy",
        database: dbHealthy ? "healthy" : "unhealthy",
      },
      status,
    );
  });

  app.post("/api/search", async (c) => {
    const raw = await c.req.json().catch(() => ({}));
    const parsed = SearchBodySchema.safeParse(raw);
    if (!parsed.success) {
      const bloomIssue = parsed.error.issues.find((iss) =>
        iss.path.some((p) => p === "bloom_level"),
      );
      if (bloomIssue) {
        return c.json(
          {
            error: "invalid_bloom_level: must be one of the valid Bloom levels",
            valid_values: [...BLOOM_LEVELS_POC],
            issues: parsed.error.issues,
          },
          400,
        );
      }
      return c.json(
        { error: "invalid_query", issues: parsed.error.issues },
        400,
      );
    }
    const query: SearchQuery = parsed.data;
    const result = await hybridSearch(query, {
      embeddingModel: deps.embeddingModel,
    });
    return c.json(result, 200);
  });

  // Chat agent: framework-aligned (Mastra) per brief. The tool factory closes
  // over `deps.embeddingModel` so the search adapter has what it needs without
  // a wider runtime context.
  const searchQuestionsTool = makeSearchQuestionsTool({
    embeddingModel: deps.embeddingModel,
  });

  const chatAgent = new Agent({
    id: "medical-question-search",
    name: "medical-question-search",
    instructions: SYSTEM_PROMPT,
    // `deps.chatModel` is an AI SDK LanguageModel (real or `MockLanguageModelV3`
    // in acceptance tests). Mastra accepts AI SDK language models directly.
    model: deps.chatModel as never,
    tools: { searchQuestions: searchQuestionsTool },
  });

  app.post("/api/chat", async (c) => {
    const raw = await c.req.json().catch(() => ({}));
    const parsed = ChatBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json(
        { error: "invalid_chat_body", issues: parsed.error.issues },
        400,
      );
    }
    const modelMessages = uiOrLegacyMessagesToModelMessages(parsed.data.messages);

    // Slice 06 / US-07: cap at 2 steps so a tool-call (step 1) can be followed
    // by a text-rendering step (step 2). The Zero-Result Policy bounds
    // reformulations to at most one per user turn; `stopWhen: stepCountIs(2)`
    // enforces that at the runtime layer.
    const mastraStream = await chatAgent.stream(modelMessages, {
      stopWhen: stepCountIs(2),
    });

    const uiMessageStream = createUIMessageStream({
      originalMessages: parsed.data.messages as never,
      execute: async ({ writer }) => {
        // `@mastra/ai-sdk@1.4.x` is typed against AI SDK v5 chunk shapes; the
        // project uses AI SDK v6. The wire protocol is compatible (`finish`
        // chunk drops the v5-only `"unknown"` finishReason at runtime); we
        // cast to keep the type-checker happy.
        for await (const part of toAISdkStream(mastraStream as never, {
          from: "agent",
        })) {
          await writer.write(part as never);
        }
      },
    });

    return createUIMessageStreamResponse({ stream: uiMessageStream });
  });

  return app;
}
