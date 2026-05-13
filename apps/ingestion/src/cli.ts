#!/usr/bin/env -S node --import tsx
// apps/ingestion/src/cli — commander-based CLI.
//
// pnpm run ingest:one --file <path>
// pnpm run ingest    --file <path> [--max-cost <usd>] [--dry-run] [--limit <n>]
//
// Per the Slice 01 missing-OPENAI_API_KEY scenario, this MUST exit with code 2
// and print a message naming `OPENAI_API_KEY` to stderr when the key is absent.

import { Command } from "commander";
import { config as dotenvConfig } from "dotenv";
import { migrate } from "@netea/db";
import {
  createOpenAiEnrichmentModel,
  createOpenAiEmbeddingModel,
} from "@netea/enrichment";
import { createIngestionService } from "./service.js";

dotenvConfig();

const program = new Command();

program
  .name("netea-ingest")
  .description("Netea ingestion CLI — ingest medical questions into the corpus");

program
  .command("ingest")
  .description("Ingest a JSON file of medical questions")
  .requiredOption("--file <path>", "Path to a JSON file matching RawQuestionSchema")
  .option("--limit <n>", "Process at most N questions", (v) => parseInt(v, 10))
  .option("--max-cost <usd>", "Abort if cumulative cost exceeds USD", (v) => parseFloat(v))
  .option("--dry-run", "Validate input but do not write to the corpus", false)
  .action(async (opts: { file: string; limit?: number; maxCost?: number; dryRun?: boolean }) => {
    if (!process.env.OPENAI_API_KEY) {
      process.stderr.write(
        "FATAL: OPENAI_API_KEY environment variable is not set. " +
          "Ingestion requires an OpenAI credential. See .env.example.\n",
      );
      process.exit(2);
    }
    if (!process.env.DATABASE_URL) {
      process.stderr.write(
        "FATAL: DATABASE_URL environment variable is not set. " +
          "Ingestion requires a Postgres connection string. See .env.example.\n",
      );
      process.exit(2);
    }

    const enrichmentModelName = process.env.OPENAI_MODEL_ENRICHMENT ?? "gpt-4o-mini";
    const embeddingModelName = process.env.OPENAI_MODEL_EMBEDDING ?? "text-embedding-3-small";

    const enrichmentModel = createOpenAiEnrichmentModel({
      apiKey: process.env.OPENAI_API_KEY,
      model: enrichmentModelName,
    });
    const embeddingModel = createOpenAiEmbeddingModel({
      apiKey: process.env.OPENAI_API_KEY,
      model: embeddingModelName,
    });

    await migrate(process.env.DATABASE_URL);

    const service = createIngestionService({
      enrichmentModel,
      embeddingModel,
      modelName: enrichmentModelName,
      embeddingModelName,
      promptVersion: process.env.PROMPT_VERSION ?? "v1",
      logsDir: "logs/runs",
    });

    const result = await service.ingestOne({ filePath: opts.file });
    process.stdout.write(
      `Ingestion ${result.outcome} — questionId=${result.questionId} costUsd=${result.costUsd}\n`,
    );
    process.exit(result.outcome === "ingested" ? 0 : 1);
  });

if (import.meta.url === `file://${process.argv[1]}`) {
  program.parseAsync(process.argv).catch((err) => {
    process.stderr.write(`${err instanceof Error ? err.stack ?? err.message : String(err)}\n`);
    process.exit(1);
  });
}

export { program };
