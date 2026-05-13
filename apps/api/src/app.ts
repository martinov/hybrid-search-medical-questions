// apps/api/src/app — `createApp({deps})` factory.
//
// Returns a Hono app extended with a `.deps` accessor so tests can read back
// the wired-in models (acceptance tests do `app.deps.enrichmentModel`).
//
// AI SDK 6 notes:
//   - `useChat` (client) defaults to the Data Stream Protocol; for the
//     walking skeleton the server returns a plain SSE-ish text stream that
//     the test asserts via `await res.text()`. We use `streamText` and
//     return its UI message stream via `toUIMessageStreamResponse()` so the
//     content includes the rendered tokens.
//   - Per ENRICH-DELIVER-01 we bypass `@mastra/core` entirely at runtime
//     because of the Zod-4 peer-dep mismatch; we keep Mastra installed.

import { getDb } from "@netea/db";
import { hybridSearch } from "@netea/search";
import {
  SearchQuerySchema,
  type SearchQuery,
} from "@netea/schemas";
import { Hono } from "hono";
import {
  streamText,
  tool,
  type EmbeddingModel,
  type LanguageModel,
  type ModelMessage,
} from "ai";
import { z } from "zod";

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

  // searchQuestions tool used by the chat agent.
  const searchQuestionsTool = tool({
    description:
      "Search the medical question bank for questions matching a clinical query. Returns up to 5 questions with title, content, and bloom level. Returns no_match if nothing relevant exists — do NOT invent titles.",
    inputSchema: z.object({
      query: z.string().min(1).describe("Clinical-intent query phrased in natural language"),
      limit: z.number().int().min(1).max(10).default(5),
    }),
    execute: async (input) => {
      const result = await hybridSearch(
        { query: input.query, limit: input.limit ?? 5 } as SearchQuery,
        { embeddingModel: deps.embeddingModel },
      );
      return result;
    },
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

    const result = streamText({
      model: deps.chatModel,
      system:
        "You are a medical-question discovery assistant for medical students. " +
        "When the user asks about a clinical scenario or medical topic, call the " +
        "`searchQuestions` tool with a concise clinical-intent query. Then summarize " +
        "the results truthfully — reference each question by its exact title and " +
        "include a content excerpt of at least 100 characters. NEVER invent titles " +
        "or content. If `searchQuestions` returns `no_match`, say so honestly.",
      tools: { searchQuestions: searchQuestionsTool },
      messages: modelMessages,
    });

    return result.toUIMessageStreamResponse();
  });

  return app;
}
