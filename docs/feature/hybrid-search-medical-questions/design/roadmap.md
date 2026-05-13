<!-- markdownlint-disable MD013 MD024 -->
# Plan of Action — Hybrid Search & Intelligent Ingestion Pipeline

**Project**: Netea (Lecturio) medical-education question search
**Feature**: `hybrid-search-medical-questions`
**Audience**: Netea staff-engineering interview discussion (per task spec
deliverable B "Strategic Planning")
**Date**: 2026-05-13

This is the operationally-honest roadmap from a working PoC to publisher
scale. It synthesizes four milestones from the system-architect's brief
(`brief.md §5`), pairs each with **measurable triggers** to advance, and
quantifies **migration cost** so the discussion is "we know the path" not
"we hope it works." Risk-assessment row at the bottom of each milestone.

---

## Milestone summary

| Milestone | Scope | Headline trigger to advance | Estimated effort to ship |
|---|---|---|---|
| **M0 — Walking-skeleton PoC** | 10 questions, sync CLI, single Postgres, single Node API, Vite SPA | First batch >100 questions OR first user-facing deploy | **8 hours** (the take-home itself) |
| **M1 — Reliable internal batch** | 10k–100k questions, async ingestion, OTEL, RDS Proxy, lazy re-enrichment | Student-facing deploy approval OR sustained QPS > 50 OR multi-tenant requirement | 2–3 engineer-weeks |
| **M2 — Public student-facing** | 100k–1M questions, auth + quotas, replica read, Redis cache, CDN | Corpus > 5M OR KPI #3 retrieval-relevance < 80% at scale OR multi-region | 4–6 engineer-weeks |
| **M3 — Scale ceiling exit** | OpenSearch substitution behind `packages/search` adapter; Postgres remains SoT + analytics | (terminal — re-evaluate per evidence) | 2–4 engineer-weeks once trigger fires |

Total runway from PoC to publisher scale: **~3–5 months of engineer
effort** spread over whatever business cadence dictates. Re-enrichment
of a 1M corpus is **a $300 line item** (Expansion E §2), not a
budget-blocking event.

---

## M0 — Walking-skeleton PoC (the 8-hour take-home)

### What it ships

- **Pipeline**: `pnpm run ingest:one` (US-01 single-question slice) and
  `pnpm run ingest --file data/sample-questions.json` (US-02 batch,
  10 questions). Synchronous inline; per-question stdout log lines;
  run summary printed and persisted to `logs/runs/{batch_id}.json`.
- **Stack** (per ADRs 001–011):
  - Postgres 16 + pgvector + pg_trgm via Docker Compose locally
  - Drizzle ORM with schema + migrations checked in
  - Single Node `apps/api` (Hono) exposing `POST /api/search` and
    `POST /api/chat`
  - Mastra agent + Vercel AI SDK `useChat` chat surface
  - Vite + React SPA at `apps/web`
- **Resilience**: F1-F7 failure taxonomy implemented; schema-retry budget
  separated from transport-retry budget; quarantine table populated on
  schema-budget exhaustion (US-02).
- **Observability**: per-run JSON with cost, latency p50/p95,
  first-try-pass / retry / quarantine counts (US-03).
- **Hybrid search**: tsvector + GIN lexical leg, pgvector + HNSW
  semantic leg, RRF fusion (k=60) in TypeScript (US-04).
- **Bloom filter**: enum text column + CHECK constraint; agent passes
  filter through (US-05).
- **Multi-turn chat**: `useChat` client-side history + server-side
  `ConversationSession` for ordinal-reference resolution (US-06).
- **Honest empty result**: `SearchResultSchema` discriminated union
  surfaces `kind: "no_match"` to the agent; system prompt instructs
  honest reformulation (US-07).
- **No auth, no multi-tenancy, no orchestrator, no real telemetry
  vendor** — these are explicitly out of scope per System Constraints.

### KPIs to hit

| # | Target | How measured |
|---|---|---|
| KPI #1 latency p95 | end-to-end ingest < 8s; chat < 4s; search DB p95 < 800ms | `logs/runs/*.json` + Date.now() deltas |
| KPI #2 enrichment validity | ≥ 90% first-try + after-retry; ≤ 2% quarantined | SQL count over `enriched_questions` vs `quarantine` |
| KPI #3 retrieval relevance | top-3 contains a topical match for ≥ 80% of seed queries | `data/seed-queries.json` + manual eval |
| KPI #4 observability surface | 100% of runs produce `logs/runs/{batch_id}.json` | Presence check |
| KPI #5 bloom filter precision | 100% of returned questions match requested bloom_level when explicit | UAT scenarios |
| KPI #6 no hallucination | 0 invented question titles on `data/empty-seed-queries.json` (5 queries) | Manual review |
| KPI #7 cost | < $10/1k enriched questions | `logs/runs/*.json` aggregate |

### Decision triggers to leave M0

Any one of the following advances us to M1:

1. **Batch size > 100 questions**: sync inline serial latency
   (~1s/question per `brief.md §4.2`) makes a 100+ batch a >2 min
   demo — beyond comfortable. T2 (`p-limit(3)`) is the cheap
   intermediate; for ≥ 1000 questions, queue-based M1 is preferred.
2. **First user-facing deploy approval**: M0 has no auth, no rate
   limits — putting it on a public URL with a live OpenAI key is
   risk. M1 adds basic API auth.
3. **2+ stakeholders ingesting concurrently**: only one Sam can run
   `pnpm run ingest` at a time without coordinating. M1's queue
   handles concurrency naturally.

### Migration cost (M0 → M1)

- **2–3 engineer-weeks** including AWS provisioning, Lambda + SQS
  scripts, OTEL integration, idempotency-key DB migration, RDS Proxy
  setup, and reliable-publication outbox (ADR-011 M1 promotion).
- **No code rewrite**: the inner `enrichQuestion(q, ctx)` function is
  reused unchanged. The CLI's surrounding loop is replaced by an SQS
  producer; the Lambda is a thin wrapper around the same function.
  ADR-002 §Migration path has the explicit 4-step transition.
- **One-time AWS spend setup**: ~$0 — Lambda free tier covers the
  first 1M invocations/month; SQS first 1M requests/month free. RDS
  cost rises slightly when the Proxy is added.

### Risks named at M0 (and how we mitigate)

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Mastra + Vercel AI SDK bridging is awkward (ENRICH-DELIVER-01) | Med | High | Smoke-test in walking skeleton; if awkward, fall back to AI SDK `streamText` directly. Bounded to `apps/api/src/conversation/agent.ts`. |
| LLM provider 429 cascade during ingest demo | Med | Med | Exponential backoff; transport-retry budget separate from schema-retry (Expansion A §3). |
| OpenAI silently changes `gpt-4o-mini` distribution | Med | High | `prompt_version` + `model` stamped per row; before/after telemetry by `prompt_version` (Expansion A §6). |
| 8-hour PoC budget overrun | High | Med | Elephant-carpaccio slicing; US-07 is slip-safe; walking skeleton first means even a half-finished PoC demos. |
| Demo OpenAI connectivity fails during interview | Med | High | Pre-record demo video; have offline backup; document key fallback. |
| HNSW parameters are unbenchmarked on real corpus | Low | Low (at 10q) / Med (at 10k+) | Document Open Issue 1; benchmark at M1 ≥100 questions. |
| Cost runaway from accidental re-run | Med | High | `INGEST_MAX_COST_USD=5.00` default cap; pipeline aborts gracefully if exceeded (Expansion E §6). |

---

## M1 — Reliable internal batch (10k–100k questions, internal use)

### What it ships (additions to M0)

- **Async ingestion**: AWS SQS standard queue + Lambda workers + SQS
  DLQ (ADR-003). The `enrichQuestion` function is unchanged; the
  loop around it is replaced.
- **RDS Proxy** in front of Postgres: pools connections for the
  Lambda fan-out (Risk R-09 in `brief.md`).
- **Idempotency keys** on enrichment writes (Risk R-08): unique
  constraint on `(source_question_id, prompt_version)` so SQS's
  at-least-once delivery doesn't produce duplicate rows.
- **OTEL traces + Prometheus metrics** (ADR-004): per-LLM-call spans,
  per-search-leg latency histograms, cost counters, first-try-pass
  rate gauges — all sliceable by `prompt_version` and `model`.
- **Lazy re-enrichment job** driven by `needs_reenrichment = true`
  column. 7-day drain ceiling per Expansion E §4. Worker
  rate-limit-aware; resumable on crash.
- **Basic API auth**: bearer token (or AWS IAM with API Gateway in
  front of `apps/api`). Internal-only.
- **Outbox pattern on `domain_events`** (ADR-011 M1 promotion):
  reliable publication to OTEL collector + future analytics
  consumers.
- **Postgres read replica** (optional at M1; mandatory at M2).
- **Pact-JS consumer-driven contracts** for OpenAI Chat Completions +
  Embeddings APIs in the CI acceptance stage (per platform-architect
  handoff).
- **Playwright end-to-end smoke test** for the chat surface in CI
  (verifies the useChat ↔ server protocol stays compatible).

### KPIs to hit

| # | Target | How measured |
|---|---|---|
| Ingest throughput | 10–14 questions/s steady-state | CloudWatch SQS metrics + RDS metrics |
| 100k re-enrich time | < 2 hours | Drain worker run record |
| 1M re-enrich time | < 20 hours | Drain worker run record |
| Validity rate sliced by prompt_version | Sustained ≥ 90% (alert on -3pp regression) | Prometheus `enrichment_first_try_pass_total` over 1h |
| Quarantine rate sliced by prompt_version | ≤ 2% (alert at 5%) | Prometheus `enrichment_quarantine_total` over 1h |
| Search latency p95 (internal user) | < 500ms | OTEL traces |
| RDS connections used | < 80% of pool size | RDS `DatabaseConnections` metric |
| OpenAI cost per 10k batch | < $4 (per Expansion E §2 with retry factor) | Per-batch cost in `logs/runs/` and Prometheus counter |

### Decision triggers to leave M1

Any one of the following advances us to M2:

1. **First student-facing deploy approval**: public-facing UI requires
   auth at the API surface and quota enforcement per student session
   (Risk R-10: API quota exhaustion at student burst).
2. **Sustained read QPS > 50 req/s**: the single Node API process is
   a soft SPOF (`brief.md §8` Open Issue 4); M2 runs multiple
   stateless API instances behind a load balancer.
3. **Multi-tenant requirements**: per-tenant `medical_specialty` or
   `tenant_id` scoping. Postgres declarative partitioning at M2.

### Migration cost (M1 → M2)

- **4–6 engineer-weeks** including auth + quota implementation,
  read-replica provisioning + cutover, Redis cache layer, CDN
  configuration, per-tenant partitioning.
- **No core code rewrite**: API surface (`POST /api/search`,
  `POST /api/chat`) unchanged. Read-side adapter in
  `packages/search` accepts a connection string at M1; pointing to
  the replica is a config change.
- **AWS spend at M1 baseline**: ~$50–100/mo (RDS t3.medium-equivalent
  + Lambda + SQS + minimal OTEL collector).

### Risks named at M1

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| SQS at-least-once → duplicate enrichment | High | Med | DB unique constraint + idempotency keys (R-08). |
| Lambda fan-out exhausts Postgres pool | High | High | RDS Proxy at this milestone; Lambda concurrency capped (R-09). |
| HNSW index rebuild cost at scale | Med | High | Fixed parameters; future changes via CONCURRENTLY + atomic swap (R-07). |
| Embedding-model deprecation (e.g., OpenAI announces EOL) | Low | Critical | Provenance per row + documented re-embed playbook (~$6 at 1M scale) (R-11). |
| OpenAI 429 cascade under re-enrichment burst | Med | Med | Producer-side token bucket; backoff with jitter (R-10). |
| Prompt-version regression undetected | Low | High | Before/after dashboards sliced by `prompt_version` (Expansion A §6); manual eval gate before prompt promotion (Expansion E §5 Stage 1). |

---

## M2 — Public student-facing (100k–1M questions, M1+ → M2)

### What it ships (additions to M1)

- **API auth + per-session quotas**: token bucket on `/api/chat`
  (Risk R-10). Per-IP rate limit.
- **Postgres read replicas** (mandatory): search/chat reads from
  replica; ingestion writes to primary.
- **Search-result caching**: query-hash → result-ids in Redis
  (ElastiCache) or Postgres unlogged table. TTL 1h; invalidated on
  `prompt_version` bump.
- **CDN for `apps/web`**: CloudFront / Vercel edge. Reduces SPA load
  TTFB to <50ms.
- **Per-tenant partitioning** if multi-tenant: Postgres declarative
  partitioning by `tenant_id` on `enriched_questions`.
- **ChatTurn persistence**: `chat_turns` table populated; audit trail
  for agent behavior; fine-tuning dataset accrual.
- **Curriculum analytics M1 read-only API** (Expansion C M1 milestone):
  `GET /api/analytics/bloom-distribution`,
  `GET /api/analytics/coverage-heatmap`.

### KPIs to hit

| # | Target | How measured |
|---|---|---|
| Sustained read QPS | ≥ 50 req/s without latency degradation | OTEL p95 latency over CloudWatch |
| Search p95 (student-facing) | < 500ms | OTEL |
| Search cache hit rate | ≥ 30% for repeat queries | Redis stats |
| Auth-rejected requests | < 0.1% false positive | OTEL trace inspection |
| Chat history audit completeness | 100% of turns persisted in `chat_turns` | SQL count vs OTEL trace count |
| Bloom-distribution API latency p95 | < 200ms | OTEL |

### Decision triggers to leave M2

Any one of the following advances us to M3 (OpenSearch substitution):

1. **Corpus > 5M rows**: HNSW memory pressure becomes the dominant
   Postgres operational cost; OpenSearch's tooling at this scale wins
   on operational maturity.
2. **KPI #3 retrieval relevance < 80% at scale**: the
   application-side RRF doesn't have native per-field-weight tuning
   that OpenSearch's `score-ranker-processor` offers; the migration
   becomes a quality call.
3. **Multi-region read latency requirement**: OpenSearch's geographic
   replication is more mature than Postgres logical replication at
   this scale.

### Migration cost (M2 → M3)

- **2–4 engineer-weeks** including OpenSearch cluster setup, bulk
  backfill from Postgres, dual-write window, validation, cutover.
- **No application-code rewrite**: substitution at the
  `packages/search` adapter boundary (ADR-001 §Migration path).
  Application API (`POST /api/search`) unchanged.
- **AWS spend at M2 baseline**: ~$200–400/mo (RDS + replica +
  ElastiCache + CDN + Lambda + SQS).

### Risks named at M2

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| Replica lag affects search freshness | Med | Med | Monitor `pg_stat_replication`; alert on lag > 5s; document the "stale-read window" as expected for search but NOT for the post-enrichment `QuestionIndexed` confirmation. |
| Redis cache stampede on prompt-version bump | Med | Med | TTL with jitter; warm-cache strategy on prompt promotion. |
| Multi-tenant data leak via partition mis-routing | Low | Critical | Per-tenant partition tests in CI; row-level security policies as a defense-in-depth. |
| Public API key exposure / abuse | Med | High | Per-session quotas; OpenAI key rotation; daily token budget cap (Expansion E §6). |
| `SearchPerformed` event volume cost | Med | Low | At 50 QPS, ~4M events/day in `domain_events` — partition by `occurred_at` monthly; sampling kicks in at M3+ if cost-significant (DM 6.4). |

---

## M3 — Scale ceiling exit (OpenSearch substitution)

### What it ships

- **OpenSearch managed cluster** (AWS), sized for the corpus +
  expected QPS.
- **Backfill job**: `enriched_questions` → OpenSearch via Bulk API.
  The `embedding` column on Postgres rows is portable as `float[]`
  array.
- **Dual-write window** at ingestion: Postgres primary +
  OpenSearch replica for a validation period (compare top-3
  retrieval-relevance on labeled set).
- **Search adapter swap**: the `LexicalSearchPort` +
  `SemanticSearchPort` implementations in `packages/search` are
  replaced by an OpenSearch adapter using the
  `score-ranker-processor` (RRF native).
- **Postgres remains source-of-truth**: enrichment writes Postgres
  (not OpenSearch); analytics SQL views (Expansion C M2+) continue
  against Postgres.
- **HNSW index retired** on Postgres; `embedding` column kept for
  re-export.
- **OTEL traces span Postgres → OpenSearch flow** (write to Postgres,
  read from OpenSearch — the CQRS shape arrives naturally per ADR-006).

### KPIs to hit

| # | Target | How measured |
|---|---|---|
| Sustained search p95 latency | ≤ 500ms (no regression from M2) | OTEL |
| Retrieval relevance (KPI #3) | Restored to ≥ 80% after migration | Labeled eval set on representative corpus |
| Backfill completion | 100% of `enriched_questions` indexed in OpenSearch | Index doc count == DB row count |
| Dual-write parity | < 0.1% divergence between Postgres and OpenSearch on a randomly-sampled row set | Periodic reconciliation job |

### Decision triggers (post-M3)

M3 is terminal in this roadmap. Beyond M3:

- **Domain-specific embeddings** (BioBERT / MedCPT) — re-evaluated
  if KPI #3 stalls on medical-vocabulary edge cases.
- **Curriculum-analytics M2 → M3 dashboards** (Expansion C M2–M3) —
  Metabase or Superset on the Postgres replica.
- **Multi-region** — OpenSearch cross-cluster replication.
- **Fine-tuned chat model** — using the persisted `chat_turns` from
  M2 as the training corpus.

### Migration cost (post-M3)

Out of horizon. The architecture is intentionally re-decidable at
each step.

### Risks named at M3

| Risk | Probability | Impact | Mitigation |
|---|---|---|---|
| OpenSearch RRF formula behaves differently from Postgres app-side RRF | Med | Med | Validation window with labeled retrieval eval; rollback by flipping read adapter back. |
| Search adapter swap breaks edge cases | Low | High | All edge cases covered by `packages/search` unit tests against the original Postgres adapter; same tests run against OpenSearch adapter pre-cutover. |
| OpenSearch operational cost surprise | Med | Med | Two-week dual-write period with cost tracking; cancel migration if monthly cost > 2× projection. |

---

## Cross-milestone bottlenecks and mitigations

Per the task spec deliverable B's "Risk Assessment", these are the
**named bottlenecks** of the entire system across all milestones, with
mitigation that lives in the architecture (not just in operations):

### 1. LLM latency

- **Bottleneck**: ~900ms p50 / 1.4s p95 per enrichment call
  (`brief.md §4.2`); dominates the ingest p95 budget.
- **At M0**: serial sync is fine for 10 questions.
- **Mitigation at M1+**: async fan-out via SQS+Lambda (10–14 q/s);
  OpenAI Batch API (50% discount, 24h async) at scale (Expansion E §7).
- **Tripwire**: if per-question latency p95 doubles, slice by `model`
  + `prompt_version`; pin model snapshot if floating alias drifted.

### 2. LLM cost

- **Bottleneck**: $0.000304/question effective (with retry factor);
  $304 for 1M corpus re-enrichment.
- **At M0**: trivially affordable.
- **Mitigation across milestones**: per-run cost cap (`INGEST_MAX_COST_USD`
  default $5 at M0; daily token cap at M2+); lazy re-enrichment policy
  (Expansion E §4); model selection (don't upgrade to gpt-4o unless
  F4 eval rate justifies it); Batch API at M2+.

### 3. Index drift / re-enrichment cost

- **Bottleneck**: every prompt version change re-enriches affected rows.
- **At M0**: not exercised (single prompt version).
- **Mitigation**: `prompt_version` column on every row; lazy
  `needs_reenrichment` flag at M1+; 5-stage migration playbook
  (Expansion E §5: shadow eval → coexistence → spot-check → drain →
  validate).

### 4. Hybrid ranking quality

- **Bottleneck**: KPI #3 (top-3 retrieval relevance ≥ 80%) is the
  binding quality metric.
- **At M0**: validated against 10-query seed.
- **Mitigation**: RRF k=60 is a universal default, not tuned;
  curated `data/seed-queries.json` + manual eval gates promotion;
  M3 OpenSearch substitution if k=60 doesn't suffice at scale.

### 5. Agent hallucination

- **Bottleneck**: LLM-default tendency to invent question titles.
- **At M0**: addressed by US-07 honest empty-result + the
  hallucination check in US-04 AC (`result_question_ids ⊆ tool_call
  results`).
- **Mitigation across milestones**: discriminated-union `SearchResult`
  (`kind: "no_match"`); system prompt's no-hallucinate clause;
  `ChatTurnCompleted.tool_calls + result_question_ids` audit at M1+
  to detect regressions.

### 6. Quarantine triage backlog

- **Bottleneck**: at scale, the human triage rate may not keep up with
  the quarantine accrual rate.
- **At M0**: 10 questions; trivial.
- **Mitigation**: quarantine rate ≤ 2% by KPI; alert at 5% rate; if
  chronic, the lever is prompt revision (not more retries).

### 7. PoC budget overrun (project risk)

- **Bottleneck**: 8 hours is tight.
- **Mitigation**: elephant-carpaccio slicing (6 slices, each
  demoable); slip-safe ordering (US-07 first to cut); walking
  skeleton first.

---

## Open issues for DELIVER and beyond

Tracked in `brief.md §Application Architecture 12` and surfaced in
`design/wave-decisions.md §6`:

1. **ENRICH-DELIVER-01**: Mastra ↔ Vercel AI SDK bridging smoke-test;
   fallback to AI SDK `streamText` if needed.
2. **DELIVER-02**: Exact `eslint-plugin-boundaries` rule JSON.
3. **DELIVER-03**: Hybrid SQL exact wording (operators, weights,
   tsquery variant).
4. **DELIVER-04**: Retry-with-feedback prompt template wording
   (Expansion A §2 layer 4).
5. **DELIVER-05**: Mastra version pin.
6. **DELIVER-06**: F7 detection — exact `finish_reason` string.
7. **DELIVER-07**: HNSW parameter smoke-test on the 10-question seed.
8. **DELIVER-08**: Cost cap implementation (`INGEST_MAX_COST_USD`
   graceful abort).

---

## One-paragraph framing for the interview

> The PoC is the *inner loop* of a system whose *outer loops* scale.
> M0 hits every measurable KPI on a 10-question seed; M1 wraps the
> same `enrichQuestion` function in a queue for 100k corpora; M2 adds
> the auth, caching, and replicas student-facing traffic requires;
> M3 substitutes OpenSearch at the `packages/search` adapter when
> measurable evidence (corpus > 5M OR KPI #3 < 80% OR multi-region)
> demands it. Every transition has a named trigger, a quantified
> migration cost, and a documented playbook (Expansion A §5,
> Expansion E §5, ADR-001 §Migration path). Re-enriching the entire
> 1M-question corpus costs $300, takes 20 hours, and never requires
> stopping the read path. The architecture optimizes for one thing:
> *no transition forces a rewrite*. That is the staff-level claim.

---

## References

- Architecture brief: [`docs/product/architecture/brief.md`](../../../product/architecture/brief.md)
  (§5 Roadmap, §7 Risks, §Application Architecture)
- ADRs: [`docs/product/architecture/adr-001..adr-011`](../../../product/architecture/)
- Expansion A — LLM non-determinism: [`../expansions/A-llm-non-determinism.md`](../expansions/A-llm-non-determinism.md)
- Expansion E — Cost + re-enrichment policy: [`../expansions/E-cost-and-reenrichment.md`](../expansions/E-cost-and-reenrichment.md)
- Expansion C — Curriculum analytics: [`../expansions/C-curriculum-analytics-roadmap.md`](../expansions/C-curriculum-analytics-roadmap.md)
- DIVERGE recommendation: [`../diverge/recommendation.md`](../diverge/recommendation.md)
- DISCUSS feature-delta: [`../feature-delta.md`](../feature-delta.md)
- Wave decisions summary: [`./wave-decisions.md`](./wave-decisions.md)
