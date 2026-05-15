import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Root Vitest config.
 *
 * - Strategy B per D-DISTILL-1: real Postgres (docker compose) + real
 *   filesystem; LLM is mocked via `ai/test`.
 * - The Postgres container lifecycle is owned by the test runner script
 *   (`pnpm db:up:test` before `pnpm test`), NOT by Vitest.
 * - Alias keys with sub-paths MUST come before their parent prefix (the
 *   first matching alias wins).
 */
export default defineConfig({
  test: {
    globals: false,
    environment: "node",
    include: [
      "tests/acceptance/**/*.test.ts",
      "packages/**/src/**/*.test.ts",
      "apps/**/src/**/*.test.{ts,tsx}",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "tests/e2e/**"],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
  resolve: {
    alias: [
      {
        find: /^@netea\/schemas\/enrichment$/,
        replacement: resolve(__dirname, "packages/schemas/src/enrichment.ts"),
      },
      {
        find: /^@netea\/schemas\/bloom$/,
        replacement: resolve(__dirname, "packages/schemas/src/bloom.ts"),
      },
      {
        find: /^@netea\/schemas\/ingestion$/,
        replacement: resolve(__dirname, "packages/schemas/src/ingestion.ts"),
      },
      {
        find: /^@netea\/schemas\/search$/,
        replacement: resolve(__dirname, "packages/schemas/src/search.ts"),
      },
      {
        find: /^@netea\/schemas\/events$/,
        replacement: resolve(__dirname, "packages/schemas/src/events.ts"),
      },
      {
        find: /^@netea\/schemas\/config$/,
        replacement: resolve(__dirname, "packages/schemas/src/config.ts"),
      },
      {
        find: /^@netea\/schemas$/,
        replacement: resolve(__dirname, "packages/schemas/src/index.ts"),
      },
      {
        find: /^@netea\/db\/test-helpers$/,
        replacement: resolve(__dirname, "packages/db/src/test-helpers.ts"),
      },
      {
        find: /^@netea\/db\/repos\/enriched-questions$/,
        replacement: resolve(
          __dirname,
          "packages/db/src/repos/enriched-questions.ts",
        ),
      },
      {
        find: /^@netea\/db\/repos\/quarantine$/,
        replacement: resolve(__dirname, "packages/db/src/repos/quarantine.ts"),
      },
      {
        find: /^@netea\/db\/repos\/ingestion-batches$/,
        replacement: resolve(
          __dirname,
          "packages/db/src/repos/ingestion-batches.ts",
        ),
      },
      {
        find: /^@netea\/db\/repos\/domain-events$/,
        replacement: resolve(
          __dirname,
          "packages/db/src/repos/domain-events.ts",
        ),
      },
      {
        find: /^@netea\/db$/,
        replacement: resolve(__dirname, "packages/db/src/index.ts"),
      },
      {
        find: /^@netea\/enrichment$/,
        replacement: resolve(__dirname, "packages/enrichment/src/index.ts"),
      },
      {
        find: /^@netea\/search$/,
        replacement: resolve(__dirname, "packages/search/src/index.ts"),
      },
      {
        find: /^@netea\/observability$/,
        replacement: resolve(
          __dirname,
          "packages/observability/src/index.ts",
        ),
      },
      {
        find: /^@netea\/api$/,
        replacement: resolve(__dirname, "apps/api/src/index.ts"),
      },
      {
        find: /^@netea\/ingestion-service$/,
        replacement: resolve(__dirname, "apps/ingestion/src/index.ts"),
      },
    ],
  },
});
