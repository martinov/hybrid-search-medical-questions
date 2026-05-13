# Netea — Hybrid Search PoC (Staff Engineer Take-Home)

Backend system that ingests raw medical exam questions, enriches them with an
LLM (Bloom's taxonomy + prominent keywords), indexes them into Postgres with
pgvector + pg_trgm, and exposes a hybrid (lexical + semantic) search API and
a chat agent over the corpus.

This repo contains a fully-scaffolded pnpm monorepo (DELIVER step 0). Step 1+
walks each acceptance scenario from RED to GREEN via Outside-In TDD.

## Architecture at a glance

- **3 apps**: `apps/api` (Hono), `apps/ingestion` (commander CLI), `apps/web`
  (Vite + React 19 + `useChat`).
- **6 packages**: `@netea/schemas` (Zod), `@netea/db` (Drizzle), `@netea/enrichment`,
  `@netea/search`, `@netea/observability`, plus the implicit `packages/conversation`
  promotion path at M1+.
- **Hexagonal layering** per package: `domain/` → `application/` (ports) → `infrastructure/` (adapters).
- **Storage**: Postgres 16 + pgvector 0.8+ + pg_trgm. Single DB; OpenSearch
  is a named M3 exit (ADR-001).
- **LLM**: OpenAI via the Vercel AI SDK (`ai` + `@ai-sdk/openai`). Mastra
  agent loop at the chat surface (ENRICH-DELIVER-01).
- **Observability**: stdout JSON + per-run summary at `logs/runs/{batch_id}.json`.
  OTEL at M1+.

Full design: [`docs/product/architecture/brief.md`](docs/product/architecture/brief.md)
and ADRs 001–011 under [`docs/product/architecture/`](docs/product/architecture/).

## Quickstart

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env
# Edit .env and fill in OPENAI_API_KEY

# 3. Bring up Postgres + pgvector + pg_trgm
pnpm db:up

# 4. Run database migrations (step 1+ — generates Drizzle migrations)
pnpm db:migrate

# 5. Ingest the sample question set (10 questions)
pnpm ingest

# 6. Start the API and web app for local development
pnpm dev          # API on :3000, web on :5173
```

## Test workflow

```bash
# Acceptance tests (Vitest; brings up Postgres test container on :5433)
pnpm db:up:test
pnpm test:acceptance

# Browser E2E (Playwright; requires apps/web + apps/api running)
pnpm test:e2e

# Type-check everything
pnpm typecheck
```

## Project structure

```text
apps/
  api/                       # Hono server (POST /api/search, /api/chat, GET /api/healthz)
  ingestion/                 # commander CLI: `pnpm ingest:one --file <path>`
  web/                       # Vite + React 19 + useChat chat UI
packages/
  schemas/                   # Zod schemas + types (shared kernel)
  db/                        # Drizzle schema + repos + test-helpers
  enrichment/                # EnrichmentService + 5-layer ACL prompts
  search/                    # HybridSearchService + RRF fusion (pure)
  observability/             # event bus, pricing, run-record writer, logger
data/
  sample-questions.json      # 10 medical exam questions (RawQuestionSchema)
  seed-queries.json          # 10 queries for manual relevance evaluation (KPI #3)
  empty-seed-queries.json    # 5 queries with no topical match (KPI #6)
docker/
  postgres-init.sql          # pgvector + pg_trgm + uuid-ossp on first boot
docs/
  product/architecture/      # brief.md + ADR-001 … ADR-011
  feature/.../               # DISCUSS/DESIGN/DISTILL artifacts for this PoC
tests/
  acceptance/                # 6 slices × {scenarios.feature, scenarios.test.ts}
  e2e/                       # Playwright spec (walking skeleton)
  manual/                    # kpi-p95-chat.md (KPI #1 manual measurement)
  _helpers/                  # mock + fixture support modules
```

## Commands cheatsheet

| Command                  | What it does                                      |
| ------------------------ | ------------------------------------------------- |
| `pnpm install`           | Install all workspace dependencies                |
| `pnpm typecheck`         | Run `tsc --noEmit` across every package           |
| `pnpm test`              | Run all Vitest tests (acceptance + unit)          |
| `pnpm test:acceptance`   | Run acceptance tests only                         |
| `pnpm test:e2e`          | Run Playwright E2E browser tests                  |
| `pnpm lint`              | Run ESLint                                        |
| `pnpm db:up`             | Bring up dev Postgres (port 5432)                 |
| `pnpm db:up:test`        | Bring up test Postgres (port 5433, tmpfs)         |
| `pnpm db:migrate`        | Apply Drizzle migrations                          |
| `pnpm ingest`            | Ingest `data/sample-questions.json`               |
| `pnpm ingest:one`        | Ingest one question (walking skeleton)            |
| `pnpm dev`               | Run API + web in parallel via Turborepo           |

## Step 0 scope

This commit lands the scaffold only. Every exported function, class, and
route handler throws `"Not yet implemented — RED scaffold"`. This is
deliberate per `D-DISTILL-3`: Vitest fails with assertion errors (RED),
not import errors (BROKEN), so step 1+ can walk each scenario to GREEN.

## Next steps

1. **Step 1** — Walking skeleton: bring the first Slice 01 scenario to GREEN
   (one question survives ingestion → search → chat).
2. **Step 2-7** — Per-slice TDD inner loops; one acceptance scenario at a
   time per the Outside-In TDD methodology.
3. **Step 8** — Adversarial review (`/nw-review`), polish, demo prep.

## License

Internal take-home submission.
