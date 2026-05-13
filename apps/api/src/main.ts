// apps/api/src/main — Production composition root.

import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { config as dotenvConfig } from "dotenv";
import { migrate } from "@netea/db";
import {
  createOpenAiChatModel,
  createOpenAiEmbeddingModel,
  createOpenAiEnrichmentModel,
} from "@netea/enrichment";
import { createApp } from "./app.js";

dotenvConfig({ path: resolve(dirname(fileURLToPath(import.meta.url)), "../../../.env") });

async function main(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    process.stderr.write(
      "FATAL: OPENAI_API_KEY environment variable is not set.\n",
    );
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    process.stderr.write(
      "FATAL: DATABASE_URL environment variable is not set.\n",
    );
    process.exit(2);
  }

  await migrate(process.env.DATABASE_URL);

  const enrichmentModelName = process.env.OPENAI_MODEL_ENRICHMENT ?? "gpt-4o-mini";
  const embeddingModelName = process.env.OPENAI_MODEL_EMBEDDING ?? "text-embedding-3-small";
  const chatModelName = process.env.OPENAI_MODEL_CHAT ?? "gpt-4o-mini";

  const app = createApp({
    enrichmentModel: createOpenAiEnrichmentModel({ apiKey, model: enrichmentModelName }),
    embeddingModel: createOpenAiEmbeddingModel({ apiKey, model: embeddingModelName }),
    chatModel: createOpenAiChatModel({ apiKey, model: chatModelName }),
  });

  const port = parseInt(process.env.PORT ?? "3000", 10);
  serve({ fetch: app.fetch, port });
  process.stdout.write(`Netea API listening on http://localhost:${port}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}
