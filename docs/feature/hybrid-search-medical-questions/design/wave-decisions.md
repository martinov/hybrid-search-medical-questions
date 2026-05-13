<!-- markdownlint-disable MD013 MD024 -->
# DESIGN wave decisions — `hybrid-search-medical-questions`

**Feature**: `hybrid-search-medical-questions`
**Wave**: DESIGN (all three sub-waves complete)
**Date**: 2026-05-13
**Architects**: system-architect (Titan) → ddd-architect (Hera) →
solution-architect (Morgan)
**SSOT artifact**: [`docs/product/architecture/brief.md`](../../../product/architecture/brief.md)
**ADRs**: [`docs/product/architecture/adr-001..adr-011`](../../../product/architecture/)

This document is the consolidated decision register for the DESIGN
wave. It does not duplicate the detail in `brief.md` and the ADRs;
it is the **fast-readable summary** that DELIVER, DISTILL, and
platform-architect consume.

---

## 1. Key Decisions

### 1.1 Search backend and ingestion (system-architect)

- **D-001**: Postgres 16 + pgvector + tsvector as a single store; RRF
  fusion in TypeScript at `k=60`. **OpenSearch is the named M3 exit**
  if corpus exceeds 5M rows or KPI #3 falls below 80%. (ADR-001)
- **D-002**: Synchronous inline CLI ingestion at M0
  (`for q of batch { enrich; embed; insert }`). Async fan-out
  (SQS+Lambda) at M1. Inner `enrichQuestion(q, ctx)` function is the
  unit of reuse — never rewritten. (ADR-002)
- **D-003**: At M1+ — AWS SQS standard queue + Lambda workers + SQS
  DLQ + RDS Proxy (Lambda concurrency capped at 10–20). (ADR-003)
- **D-004**: Observability — stdout JSON + `logs/runs/{batch_id}.json`
  at M0; OTEL traces + Prometheus metrics at M1+. (ADR-004)
- **D-005**: Embedding model `text-embedding-3-small` (1536-dim,
  cosine distance). HNSW with `m=16, ef_construction=200`. (ADR-005)

### 1.2 Domain model (ddd-architect)

- **D-006**: Aggregates with emitted-but-not-sourced domain events.
  **No event sourcing.** Postgres rows are source-of-truth; events
  are facts that happened. Outbox pattern at M1+ for reliable
  publication only. (ADR-006)
- 4 bounded contexts: Ingestion (Supporting), Enrichment (CORE),
  Search (CORE, query-only), Conversation (Supporting).
- 6 aggregates: `Question`, `IngestionBatch`, `EnrichmentTask`,
  `Quarantine`, `ConversationSession`, `ChatTurn` (value object at
  M0, aggregate root at M1+).
- 16 domain events cataloged.
- Anti-Corruption Layer at the OpenAI seam (Enrichment); Conformist
  at the OpenAI streaming seam (Conversation).

### 1.3 Application architecture (solution-architect)

- **D-007**: Monorepo with pnpm 9 workspaces + Turborepo 2. Three
  apps + six packages. (ADR-007)
- **D-008**: Hono 4 HTTP framework (`@hono/zod-validator`,
  `@hono/node-server` at M0; `hono/aws-lambda` adapter at M1).
  (ADR-008)
- **D-009**: `drizzle-orm@0.45.2` (user-pinned 2026-05-13) + matching
  `drizzle-kit` + `drizzle-zod` (Zod-4-compatible release). Drizzle
  schema is SoT; Zod schemas derived via codegen; refinements
  composed on top. (ADR-009)
- **D-010**: `zod@4.x` (user-pinned, context7-verified) with `.strict()`
  on all boundary schemas. Native `z.toJSONSchema()` replaces the
  separate `zod-to-json-schema` package. Shared package
  `packages/schemas`. (ADR-010)
- **D-011**: Single `domain_events` table at M0; `delivered_at`
  column added at M1+ for outbox-pattern reliable publication.
  (ADR-011)
- **DM-1**: Bloom enum is a `text` column with CHECK constraint, not
  a Postgres enum (DIVERGE §5a). PoC subset: `recall | application |
  analysis`. Migration to 6-level Bloom 2001 per Expansion A §5.
- **DM-7**: RRF fusion in TypeScript (~30 lines), not in SQL.
- **DM-8**: Two parallel SQL queries (lexical + semantic) fused in
  application code, not a single CTE.
- **DM-9**: `SearchResultSchema` is a `z.discriminatedUnion("kind",
  [...])` — US-07's `{kind: "no_match", results: [], reason:
  "no_match"}` is expressible in Mastra tool result.

---

## 2. Architecture summary

### 2.1 C4 Level 2 — Container shape

```text
Browser (Student)                      Operator workstation
+------------------+                    +-----------------+
| apps/web         |                    | apps/ingestion  |
| Vite + React +   |                    | pnpm run ingest |
| Vercel AI SDK    |                    | sync inline (M0)|
+------------------+                    +-----------------+
        |                                       |
        | chat (SSE stream)                     | enrich + embed
        v                                       v
+--------------------------+         +--------------------------+
| apps/api                 |         |                          |
| Hono + Mastra agent      |<--------+                          |
| POST /api/chat           |  shared |                          |
| POST /api/search         |--->>----+--> OpenAI                |
+--------------------------+         |     gpt-4o-mini          |
        |                            |     text-embedding-3-small|
        | hybrid SQL                 +--------------------------+
        v                                       |
+----------------------------------+            |
| Postgres 16 + pgvector + pg_trgm |<-----------+
|                                  |
| enriched_questions (tsv + emb)   |
| quarantine                       |
| ingestion_batches                |
| domain_events                    |
+----------------------------------+
```

Full C4 diagrams in `brief.md` §1.2 (Container), §Application
Architecture 2.2 (Enrichment Component), §Application Architecture
2.3 (Search Component).

### 2.2 Hexagonal layout

Every package follows `domain/` → `application/{ports/, services/}`
→ `infrastructure/{adapters}`. Composition root in the app's
`main.ts` / `cli.ts`. Enforced by `eslint-plugin-boundaries`.

### 2.3 Bounded-context mapping

| Context | Subdomain | Owns package(s) |
|---|---|---|
| Ingestion | Supporting | `apps/ingestion/` |
| Enrichment | **CORE** | `packages/enrichment/` |
| Search | **CORE** | `packages/search/` |
| Conversation | Supporting | `apps/web/` (UI) + `apps/api/src/conversation/` (server); `packages/conversation/` at M1+ |
| (cross-cutting) | — | `packages/schemas`, `packages/db`, `packages/observability` |

---

## 3. Reuse Analysis (hard gate)

| Existing Component | File | Overlap | Decision | Justification |
|---|---|---|---|---|
| (greenfield) | n/a | n/a | CREATE NEW (entire feature) | Initial PoC; repo contains only documentation at this writing |

**No existing code to reuse.** Greenfield. All design choices are
fresh. Hard gate satisfied via explicit "no prior code" finding.

---

## 4. Technology stack (pinned versions, 2026-05-13)

All OSS, permissive licenses. **Zero proprietary.** DELIVER
re-verifies versions at install.

| Concern | Choice | Version | License |
|---|---|---|---|
| Node.js | LTS | 24.x (user-pinned 2026-05-13) | MIT |
| TypeScript | — | 6.x (user-pinned 2026-05-13) | Apache-2.0 |
| Package mgmt | pnpm workspaces | 9.x | MIT |
| Task runner | Turborepo | 2.x | MPL-2.0 |
| HTTP | Hono | 4.x | MIT |
| Hono extras | zod-validator + node-server | 0.4 + 1.x | MIT |
| Agent framework | `@mastra/core` | 1.32.0 (user-pinned) | Apache-2.0 |
| AI SDK (server) | Vercel AI SDK (`ai`) | 5.x (latest stable; 6.x is beta) | Apache-2.0 |
| AI SDK (React UI hooks) | `@ai-sdk/react` (provides `useChat`; only in `apps/web`) | pairs with `ai@5.x` | Apache-2.0 |
| LLM provider | `@ai-sdk/openai` (consumed by `ai`) | pairs with `ai@5.x` | Apache-2.0 |
| ORM | Drizzle | 0.45.2 (user-pinned) | Apache-2.0 |
| Migrations | drizzle-kit | matching 0.45.x line | Apache-2.0 |
| Drizzle ↔ Zod | drizzle-zod | Zod-4-compatible release (verify at install) | Apache-2.0 |
| Postgres driver | `postgres` (porsager) | 3.4+ | The Unlicense |
| Postgres | 16 with pgvector + pg_trgm | 16 + 0.8 | PostgreSQL License |
| Validation | Zod | 4.x (user-pinned) | MIT |
| JSON Schema export | `z.toJSONSchema()` (built-in in Zod 4; AI SDK consumes Zod schemas directly) | bundled | MIT |
| Testing | Vitest | 2.x | MIT |
| React | — | 19.x | MIT |
| Vite | — | 5.x / 6.x | MIT |
| Browser HTTP | native fetch | — | — |
| CLI | commander | 12.x | MIT |
| Env | dotenv | 16.x | BSD-2-Clause |
| Logging (optional) | pino | 9.x | MIT |
| Lint | ESLint + boundaries + import + @ts-eslint | 9.x | MIT |

Verification note: context7 MCP for Mastra and Vercel AI SDK was
referenced in the prompt but not exposed as a callable tool in this
session. Version pins above are based on knowledge cutoff January
2026. **DELIVER must re-verify at install** — particularly Mastra
(rapidly evolving) and `ai` 3.x vs 4.x. See open issue
ENRICH-DELIVER-01 below.

---

## 5. Constraints

Inherited from DISCUSS System Constraints + DESIGN-wave decisions:

- **Stack pre-decided** (TypeScript, Postgres+pgvector, OpenAI, Mastra,
  Vite+React) — not relitigated.
- **Schema enforcement is mandatory at the LLM boundary** — every
  response Zod-parsed before any write.
- **Provenance is mandatory** on every enriched row
  (`prompt_version`, `model`, `model_temperature`, `embedding_model`,
  `enriched_at`, `retry_count`).
- **Quarantine over silent failure** — failed records preserved in a
  separate aggregate, not dropped.
- **Per-batch cost observable**; per-run hard cap available
  (`INGEST_MAX_COST_USD` per Expansion E §6).
- **No auth, no multi-tenancy, no orchestrator, no real telemetry
  vendor at M0**.
- **PoC budget**: 8 hours total; slip-safe ordering ensures even a
  partial PoC has demo value.
- **Single embedding model at ingest and query time** — switching
  invalidates all stored vectors.

Application-level constraints layered on top:

- **`.strict()` on all boundary Zod schemas** (ADR-010).
- **OSS-only with permissive licenses** — no GPL, AGPL, or proprietary
  dependencies.
- **Package-boundary enforcement** via `eslint-plugin-boundaries` —
  `apps/api` cannot import `apps/ingestion` internals; shared code
  must live in `packages/*` (ADR-007).
- **In-process events transactional with aggregate writes at M0**
  (ADR-011) — events and aggregate rows commit/roll back together.
- **Drizzle schema is the SoT for Postgres column shapes**; Zod
  derived via `drizzle-zod` (ADR-009).

---

## 6. Upstream Changes (handoff to DISTILL + DELIVER + platform-architect)

### To DISTILL (acceptance-designer)

- Use the C4 Component diagrams (`brief.md §Application
  Architecture 2.2, 2.3`) as the visual referent for scenarios
  spanning multiple components.
- The canonical Zod schemas (`brief.md §Application Architecture 5`)
  are the data shapes acceptance tests fixture against.
- The `SearchResultSchema` discriminated union (`kind: "results" |
  "no_match"`) is **load-bearing for US-07** — acceptance tests
  exercise both variants.
- DISTILL writes behavior-shaped scenarios; the 8 DELIVER open
  issues should NOT show up in acceptance tests directly.

### To DELIVER (software-crafter)

- Open issues to track: ENRICH-DELIVER-01 (Mastra ↔ AI SDK bridge,
  smoke-test in walking skeleton); DELIVER-02 through DELIVER-08 in
  `brief.md §Application Architecture 12`.
- **Standard nw-software-crafter (not the functional variant)** —
  OOP/mixed TypeScript per the DISCUSS lock. Mastra is class-shaped.
- Drizzle schema in `packages/db/src/schema.ts` ← Zod codegen via
  `drizzle-zod` ← refinements layered.
- DB migrations in `packages/db/migrations/` via `drizzle-kit`.
- The hybrid SQL exact wording is DELIVER's call (DELIVER-03), but
  the shape (two queries, RRF in TS) is settled.

### To platform-architect (DEVOPS wave)

External integrations requiring contract tests:

- **OpenAI Chat Completions** (Structured Outputs `response_format:
  json_schema`): consumer-driven contracts via Pact-JS at the
  `LlmEnrichmentPort` boundary. CI: M1+ acceptance stage.
- **OpenAI Embeddings**: same Pact contract file, separate
  interaction.
- **Mastra agent framework** (in-process): CI integration smoke test
  in the agent loop (mock OpenAI, real Mastra).
- **Vercel AI SDK `useChat` ↔ server protocol**: Playwright
  end-to-end smoke test of the chat surface.

Other DEVOPS-wave hooks:

- M0 deployment = `docker-compose up` + `pnpm run dev` locally.
  Optional Vercel/Netlify static deploy of `apps/web`.
- M1 deployment = AWS RDS (managed Postgres with pgvector enabled),
  Lambda, SQS, optionally RDS Proxy. ADR-003 has the M1 specifics.
- Secrets: `OPENAI_API_KEY` only at M0; AWS IAM at M1+ for SQS +
  Lambda. No secret-management vendor required at PoC.

---

## 7. Cross-references

- Architecture brief: [`docs/product/architecture/brief.md`](../../../product/architecture/brief.md)
- All 11 ADRs: [`docs/product/architecture/adr-*.md`](../../../product/architecture/)
- DISCUSS feature-delta: [`../feature-delta.md`](../feature-delta.md)
- DIVERGE recommendation: [`../diverge/recommendation.md`](../diverge/recommendation.md)
- Expansions:
  [A — LLM non-determinism](../expansions/A-llm-non-determinism.md),
  [E — Cost + re-enrichment](../expansions/E-cost-and-reenrichment.md),
  [C — Curriculum analytics](../expansions/C-curriculum-analytics-roadmap.md)
- Plan of Action (Netea deliverable B): [`./roadmap.md`](./roadmap.md)
