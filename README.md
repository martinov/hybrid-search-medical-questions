# Netea — Hybrid Search + AI Ingestion Pipeline (Staff Engineer Take-Home)

Backend system that ingests raw medical exam questions, enriches them via an
LLM with Bloom's-taxonomy + medical-keyword metadata, indexes them into a
single Postgres store using both `tsvector` (lexical/BM25-like) and
`pgvector` (semantic/cosine) with **Reciprocal Rank Fusion** at the
application layer, and exposes the corpus through:

- a `POST /api/search` hybrid-search endpoint (discriminated `{kind: "results"} | {kind: "no_match"}` response)
- a `POST /api/chat` agent endpoint (AI SDK 6 streaming) with a `searchQuestions` tool
- a Vite + React 19 chat UI using `@ai-sdk/react` `useChat`

## What's in this submission

- **Architecture & Design docs** — `docs/product/architecture/brief.md` (C4 Context / Container / Component diagrams in Mermaid; data flow diagram; back-of-envelope) plus **11 ADRs** in the same directory.
- **Strategic Planning** — `docs/feature/hybrid-search-medical-questions/design/roadmap.md` (M0 → M3 milestones with named triggers and migration costs) and risk register in the feature-delta.
- **Pre-implementation waves** — full DISCUSS / DIVERGE / DESIGN / DISTILL artifacts under `docs/feature/hybrid-search-medical-questions/` (7 user stories, 6 elephant-carpaccio slices, 38 Gherkin acceptance scenarios, 4 staff-level expansions covering LLM non-determinism / cost model / curriculum analytics / fixture design).
- **Proof of concept** — working pnpm monorepo, 8 workspace packages, **40/40 acceptance tests green** end-to-end (all 6 slices implemented).

## Architecture at a glance

- **3 apps**: `apps/api` (Hono server), `apps/ingestion` (commander CLI), `apps/web` (Vite + React 19 + `@ai-sdk/react` `useChat`).
- **5 packages**: `@netea/schemas` (Zod 4), `@netea/db` (Drizzle 0.45), `@netea/enrichment` (5-layer LLM ACL with F1–F7 failure taxonomy), `@netea/search` (RRF fusion at k=60), `@netea/observability` (pino logger + run-record writer + pricing).
- **Hexagonal layering** per package: `domain/` → `application/ports/` → `infrastructure/adapters/`.
- **Storage**: Postgres 16 + pgvector 0.8 + pg_trgm. Single DB through M2; OpenSearch is the named M3 migration target (ADR-001).
- **LLM access**: OpenAI via Vercel AI SDK 6 (`ai@6.0.180` + `@ai-sdk/openai@^3`). No direct `openai` Node SDK — every call goes through `generateObject` / `embed` / `streamText` for provider-agnostic surfaces. `@mastra/core@^1.33` is installed; the runtime uses AI SDK direct because Mastra's transitive `@ai-sdk/ui-utils` still pins Zod 3 as a peer dep (open issue `ENRICH-DELIVER-01`).
- **Observability**: per-run JSON summary at `logs/runs/{batch_id}.json` (cost / latency p50/p95 / validation rate / quarantine count); structured stdout logs via pino. OTEL is M1+.

Full design: [`docs/product/architecture/brief.md`](docs/product/architecture/brief.md) and ADRs 001–011 under [`docs/product/architecture/`](docs/product/architecture/).

## Quickstart

```bash
# 1. Install dependencies
pnpm install

# 2. Configure environment
cp .env.example .env
# Edit .env and fill in OPENAI_API_KEY

# 3. Bring up Postgres + pgvector + pg_trgm
pnpm db:up

# 4. Run migrations (idempotent bootstrap SQL — creates the 5 tables, GIN + HNSW indexes, tsvector trigger)
pnpm db:migrate

# 5. Ingest the 10-question sample set
pnpm ingest

# 6. Start API + web in parallel
pnpm dev          # API on :3000, web on :5173
```

Then open <http://localhost:5173> and ask something like *"give me application-level questions about heart failure symptoms"* — the agent will call `searchQuestions` with `bloom_level=application`, the hybrid search returns RRF-fused results, and the agent streams them back.

If the corpus has no topical match (try *"questions about deep-sea hydrothermal vent biology"*), the agent must respond honestly with no fabricated titles and suggest reformulations — KPI #6, enforced by Slice 06's `@property` scenario.

## Test workflow

```bash
# Bring up the isolated test Postgres (port 5433, tmpfs-backed)
pnpm db:up:test

# Acceptance suite — 40 scenarios across 6 slices
pnpm test:acceptance

# Type-check everything
pnpm typecheck
```

The `test:acceptance` script bakes in `--no-file-parallelism` because `migrate()` runs in each file's `beforeAll` and the parallel default can race on schema creation. This is a known infra limitation documented in the open items.

Browser E2E (Playwright spec lives at `tests/e2e/`):

```bash
pnpm dev          # in one terminal — API + web
pnpm test:e2e     # in another
```

## Slice progression (the 6 commits that built the PoC)

| Commit | Slice | What landed | Acceptance scenarios |
|---|---|---|---|
| `f33c9a6` | 01 — Walking Skeleton | One question end-to-end: CLI → AI SDK `generateObject` (mocked) → `embed` → Drizzle write → `/api/search` RRF → `/api/chat` `streamText` → React `useChat` UI | 5/5 |
| `dfaba7d` | 02 — LLM Resilience | F1-F7 failure taxonomy, retry-with-feedback, separate schema vs transport retry budgets, quarantine writes, prompt-versioning provenance | 9/9 |
| `f8624d6` | 03 — Observability | Real token-usage cost tracking, per-run `logs/runs/{batch_id}.json` summary, `INGEST_MAX_COST_USD` guardrail with exit-code-3 abort, `--dry-run` cost estimator | 7/7 |
| `8891c4e` | 04 — Bloom filter | `bloom_level` filter applied pre-RRF on both lexical and semantic legs, `no_match_with_filter` discriminator, agent-side Bloom-intent extraction | 8/8 |
| `c604db8` | 05 — Conversation Context | Multi-turn handling via client-side `useChat` history, ordinal-reference resolution, topic-shift detection, out-of-range graceful degradation | 5/5 |
| `9ebda7a` | 06 — Zero-Result Recovery | `{kind: "no_match"}` discriminator end-to-end, anti-hallucination clause in system prompt, up-to-1 reformulation per user turn, KPI #6 property scenario | 6/6 |
| **Total** | — | **40 acceptance scenarios green** | **40/40** |

## Project structure

```text
apps/
  api/                  Hono server: POST /api/search, /api/chat, GET /api/healthz
  ingestion/            commander CLI: pnpm ingest [--file <p>] [--limit N] [--max-cost <usd>] [--dry-run]
  web/                  Vite + React 19 + @ai-sdk/react useChat
packages/
  schemas/              Zod 4 schemas (Enrichment, Search, Events, Observability) — the shared kernel
  db/                   Drizzle schema + 4 repos + bootstrap migrations + test helpers
  enrichment/           EnrichmentService + 5-layer ACL + F1-F7 classifier + retry-policy + prompts/v1
  search/               HybridSearchService + RRF fusion (pure fn, k=60) + pg-lexical + pg-semantic adapters
  observability/        pino logger + RunSummaryWriter + pricing constants + DomainEventsBus
data/
  sample-questions.json       10 medical exam questions spanning 6 specialties + 3 Bloom levels
  seed-queries.json           10 queries for manual relevance evaluation (KPI #3)
  empty-seed-queries.json     5 queries with no topical match (KPI #6 anti-hallucination test)
docker/
  postgres-init.sql           pgvector + pg_trgm + uuid-ossp extensions on first boot
docs/
  Test Task - BE Staff Engineer.{md,pdf}    the original task spec
  product/
    architecture/             brief.md + ADR-001 … ADR-011
    journeys/                 student-finds-question.yaml, admin-ingests-batch.yaml
    personas/                 medical-student.md, content-ops-admin.md, curriculum-designer.md
    jobs.yaml                 7 JTBD entries with four-forces analysis
  feature/hybrid-search-medical-questions/
    feature-delta.md          single-file SSOT with DISCUSS/DIVERGE/DESIGN/DISTILL/DELIVER sections
    expansions/               A (LLM non-determinism), C (curriculum analytics), E (cost model), F (fixture design)
    slices/                   slice-01 … slice-06 briefs (one per elephant-carpaccio slice)
    {diverge,design,distill}/ wave-decisions + upstream-issues per wave
tests/
  acceptance/                 6 slices × {scenarios.feature, scenarios.test.ts}
  e2e/                        Playwright spec (walking skeleton browser path)
  manual/                     kpi-p95-chat.md (manual measurement procedure for KPI #1)
```

## Stack pins

Verified against the npm registry at submission time (2026-05-13):

| Package | Version | Why |
|---|---|---|
| Node.js | 24 LTS | Current LTS |
| TypeScript | 6.0.3 | Current stable |
| `ai` | 6.0.180 | Latest stable Vercel AI SDK; AI SDK 6 ships `streamText` + provider-agnostic abstractions |
| `@ai-sdk/openai` | ^3.0 | Pairs with `ai@6` |
| `@ai-sdk/react` | ^3.0 | `useChat` hook (UI hooks split out of the base `ai` package in v5+) |
| `@mastra/core` | ^1.33 | Installed; not used at runtime (ENRICH-DELIVER-01) |
| `zod` | 4.4.3 | Native `z.toJSONSchema()` replaces `zod-to-json-schema` |
| `drizzle-orm` | 0.45.2 | pgvector via `customType` + raw-SQL escape hatch |
| `drizzle-zod` | ^0.8 | Drizzle → Zod codegen for repository typing |
| `hono` | ^4.12 | Web-Standards request/response; Lambda adapter for M1+ |
| `vitest` | ^2.1 | Test runner |
| `vite` | ^6.0 | Bundler for `apps/web` |
| `react` | ^19.2 | Stable as of submission |
| `postgres` | ^3.4 | porsager driver; fast + clean pool semantics |
| `pino` | ^10 | Structured logging |
| `commander` | ^14 | CLI parser |
| Postgres | 16 | with pgvector + pg_trgm |

## Commands cheatsheet

| Command | What it does |
| --- | --- |
| `pnpm install` | Install all workspace dependencies |
| `pnpm typecheck` | Run `tsc --noEmit` across every package |
| `pnpm test:acceptance` | Run all 40 acceptance scenarios (sequentially, baked-in `--no-file-parallelism`) |
| `pnpm test:e2e` | Run Playwright E2E browser tests (requires dev stack running) |
| `pnpm lint` | Run ESLint |
| `pnpm db:up` | Bring up dev Postgres on port 5432 |
| `pnpm db:up:test` | Bring up isolated test Postgres on port 5433 |
| `pnpm db:migrate` | Apply bootstrap migrations |
| `pnpm ingest` | Ingest `data/sample-questions.json` (10 questions) |
| `pnpm ingest:one` | Ingest one question (alias for `--limit 1`) |
| `pnpm dev` | Run API + web in parallel |

## Decision highlights — defensible in the discussion round

- **pgvector over OpenSearch for the PoC** (ADR-001 + DIVERGE matrix) — time-to-PoC, transactional integrity, scale headroom (~5M-row ceiling). OpenSearch is the named M3 exit when corpus > 5M OR retrieval-relevance KPI #3 < 80% at scale.
- **F1–F7 failure taxonomy with separate retry budgets** (Expansion A + Slice 02) — the schema-retry budget is NOT consumed by transport-level 429/5xx errors; F4 (off-by-one Bloom) is explicitly non-retryable and surfaces in out-of-band eval, not at the schema layer; F7 (content-filter refusal) is immediate quarantine with zero retries.
- **Reciprocal Rank Fusion at k=60** (the universal default) implemented as a pure function in `packages/search/src/domain/rrf.ts` — preserves provider-agnostic semantics; the alternative weighted-sum approach is brittle to score scaling.
- **AI SDK over a custom Mastra wiring** — pragmatic ENRICH-DELIVER-01 fallback; Mastra is installed for future evolution but the chat path uses `streamText` directly so the Zod-4 peer-dep mismatch in Mastra's transitive `@ai-sdk/ui-utils` doesn't bite.
- **Single Postgres through M2** (Domain Model 5 + DDD ADR-006) — shared kernel justified as deliberate PoC simplification with an explicit migration cost in the roadmap; not an oversight.

## Known limitations + what would come next

These are interview-mentionable, not bugs:

- **Test parallelism**: `pnpm test:acceptance` requires `--no-file-parallelism` because `migrate()` races on schema creation when multiple files boot concurrently. Fix would be a per-DB advisory-lock mutex in `ensureMigrated`.
- **Real-cost smoke test pending**: the per-question cost numbers in run summaries are calculated from real `usage.inputTokens.total` / `usage.outputTokens.total` totals, but the figures haven't been validated against an actual paid OpenAI run on the candidate's machine. The pricing constants are explicitly marked "assumed, verify before production" in `packages/observability/src/pricing.ts`.
- **`SEARCH_MIN_RRF_SCORE` threshold not implemented** — discriminator union only has `no_match` and `no_match_with_filter`, no `below_threshold`. Simple add when needed.
- **`tests/_helpers/chat-mocks.ts`** is still RED-scaffold; each slice inlined its own mock builders. Cleanup: hoist the shared `v3UsageFromTokens` / `STOP` / `textStreamChunks` / `toReadable` helpers into a `tests/_helpers/v3-stream.ts` module.
- **Mastra runtime adoption** deferred until Mastra publishes a Zod-4-compatible release (or until ENRICH-DELIVER-01 is resolved by Mastra upstream). The architecture supports flipping back to Mastra Agent without disturbing the test boundary — `apps/api/src/app.ts` is the only file that would change.
- **OTEL pipeline, RDS Proxy, SQS+Lambda async ingest** — all designed (system architecture brief §5; M1 milestone in roadmap.md) but not built in M0.

## License

Internal take-home submission.
