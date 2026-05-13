<!-- markdownlint-disable MD024 MD013 -->
# DIVERGE recommendation — search backend + ingestion topology

**Feature**: `hybrid-search-medical-questions`
**Wave**: DIVERGE
**Date**: 2026-05-13
**Inputs**: `feature-delta.md`, expansions A/E/C, `Test Task - BE Staff Engineer.md`, `options-matrix.md`, `taste-filter.md`

This is the DIVERGE deliverable the DESIGN wave (search-backend ADR) will distill. It picks one option per axis, names the runner-up, and names the option we killed. It is willing to disagree with the candidate's locked choice (`pgvector`) where the analysis warrants — and after running the analysis, it does *not* warrant disagreement, but the dissent path is documented honestly in Section 4 so the interview can answer the question without flinching.

---

## 1. Primary axis — search backend

### Recommendation: **Option A — Postgres + pgvector** (single store, tsvector for lexical, pgvector for semantic, application-side RRF for fusion)

**One-paragraph rationale**

Postgres + pgvector is the right PoC choice on three independent grounds, any one of which would carry the decision and the combination of which makes it dominant: (1) **scope fit** — the 8-hour PoC budget reaches the US-01 walking skeleton in roughly 2 hours of pipeline work, leaving 6 hours for the resilience (US-02), observability (US-03), bloom filter (US-05), and conversation context (US-06) where the staff-level signal actually lives; (2) **transactional integrity** — the same store holds source-of-truth, lexical index, and vector index, so the dual-write nightmare (Pinecone + OpenSearch in Option C, or Qdrant + Postgres in Option D) never appears, and the re-enrichment migration in Expansion E Section 5 operates on one corpus with one `prompt_version` column; (3) **honest scale headroom** — pgvector with HNSW indexed at default parameters (`m=16, ef_construction=200`) sits at AWS-measured ~1.5ms single-query latency well into single-digit-million-row corpora, which is three orders of magnitude above the PoC horizon and at least two orders of magnitude above the realistic Lecturio-scale content pack. The honest weakness — no native RRF — is a 30-line TypeScript function with a default `k=60` (the constant Elasticsearch, OpenSearch, and Qdrant all settled on), and DELIVER owns it.

**Runner-up: Option B — OpenSearch (managed AWS, native RRF via score-ranker-processor)**

OpenSearch is the right answer at *publisher-scale* (1M+ corpus, sustained high QPS) and the right stack-fit answer for Netea today. It loses the PoC bake-off on **time-to-PoC** alone: standing up a local OpenSearch instance, configuring the kNN plugin, building the hybrid search pipeline with score-ranker-processor (`rank_constant: 60`, weighted subqueries), wiring the AWS SDK, and reconciling the dual-store source-of-truth-vs-index split costs an estimated 4-5 hours before the walking skeleton works. That leaves the genuinely staff-level work (LLM resilience, observability, hallucination defense) under-resourced. If the budget were 24 hours, this becomes a real fight; at 8 hours, Option A wins decisively.

**Killed: Option C — Pinecone + OpenSearch split**

Three systems on the critical path, dual-write at ingest and at every re-enrichment, three sets of credentials, three monitoring surfaces, two SaaS signups, application-side fusion code spanning two network calls. The staff-level signal is *not* "I used Netea's stack"; the staff-level signal is "I matched the architecture to the corpus scale and the budget." For a 10-question PoC, this option is conformance theater. (Full reasoning: `taste-filter.md` "Cut: Option C".) It earns the "killed" label rather than "deferred" because at the *true production scale* where it might justify its complexity (10M+ vectors, multi-region, sustained 1k+ QPS), the workload doesn't match Lecturio's actual question-corpus shape — analytics and curriculum work (Expansion C) want SQL-shaped aggregates, which Pinecone can't serve.

### Diagram — recommended search backend topology

```text
                +-----------------------------------+
                |  Ingest CLI / API (TypeScript)    |
                +-----------------------------------+
                                 |
                                 v
                +-----------------------------------+
                |  OpenAI: gpt-4o-mini (enrich)     |
                |  OpenAI: text-embedding-3-small   |
                +-----------------------------------+
                                 |
                                 v
                +-----------------------------------+
                |  Postgres 16 + pgvector + pg_trgm |
                |                                   |
                |  enriched_questions               |
                |    id PK                          |
                |    title text                     |
                |    content text                   |
                |    keywords text[]                |
                |    bloom_level enum               |
                |    medical_specialty text         |
                |    embedding vector(1536)         |
                |    tsv tsvector GENERATED         |
                |      (title + content + keywords) |
                |    prompt_version text            |
                |    model text                     |
                |    enriched_at timestamptz        |
                |    needs_reenrichment boolean     |
                |                                   |
                |  Indexes:                         |
                |    GIN(tsv)         -- lexical    |
                |    HNSW(embedding)  -- semantic   |
                |                                   |
                |  quarantine (separate table)      |
                +-----------------------------------+
                                 |
                                 v
                +-----------------------------------+
                |  POST /api/search                 |
                |   - lexical query (ts_rank)       |
                |   - semantic query (1 - cosine)   |
                |   - RRF fusion (k=60) in app code |
                +-----------------------------------+
                                 |
                                 v
                +-----------------------------------+
                |  Mastra agent + Vercel AI useChat |
                +-----------------------------------+
```

---

## 2. Secondary axis — ingestion topology

### Recommendation: **T1 — Synchronous inline** (`for question of batch { enrich; embed; insert }` in a single CLI process)

**One-paragraph rationale**

The journey artifact `admin-ingests-batch.yaml` Step 1 already shows the target UX: a single CLI streaming per-question log lines, a summary at the end. T1 matches it exactly. The Expansion A Section 3 decision matrix — schema-retry budget separate from transport-retry budget, quarantine after exhaustion — maps cleanly into a single function with try/catch. Failure modes are immediately legible in the interview demo because the failure stack trace is the program stack trace, not a queue handoff. Production scale-up (Expansion E Section 7) wraps T1's inner function in a queue producer without redesigning the retry/quarantine semantics — the inner loop is the unit of reuse. This is the most honest "PoC is the inner loop, production wraps an outer loop around it" framing.

**Runner-up: T2 — Async in-process concurrency pool (`p-limit(3)`)**

Becomes the right choice if the seed batch grows beyond ~100 questions and serial latency starts to make the demo painful. Costs ~30 lines over T1. The recommendation flips from T1 to T2 around batch size 100, not based on production-readiness arguments but based on demo wall-clock time. No production-shape difference between them.

**Killed: T3 — Separate worker process + Postgres-backed queue, and T4 — Real queue (SQS / Redis Streams)**

Premature production. T3 splits the failure model across two processes (retry-at-the-queue vs retry-at-the-LLM) and adds ~3 hours of queue/worker infrastructure that does not advance any user story. T4 adds an AWS dependency to a take-home demo. Both are correct at production scale (Expansion E Section 7) and wrong at PoC scale. Full reasoning in `taste-filter.md`.

---

## 3. Decision trace (job → research → score → recommendation)

This section makes the recommendation traceable.

| Job (`jobs.yaml`) | Constraint it imposes | Matrix dimension it drives | Option that wins |
|---|---|---|---|
| `find-questions-by-clinical-intent` (p95 < 2.5s end-to-end) | Search latency budget | Hybrid quality + Scal. | A wins on PoC scale; B wins at 1M+ |
| `calibrate-cognitive-difficulty` (Bloom filter precision) | Need bloom_level column with stable enum | Schema evo | A wins (`ALTER TABLE ADD COLUMN`); C/D lose (multi-store evo) |
| `feel-confident-before-exam` (no hallucination, honest empty-result) | Search must return `reason: "no_match"` cleanly | (orthogonal to backend) | All options can satisfy; not a deciding dimension |
| `enrich-question-bank-reliably` (≥90% validity, ≤2% quarantine) | Pipeline reliability | (orthogonal to backend) | T1 cleanest; T3/T4 split the model |
| `reprocess-when-prompts-change` (1k questions re-enriched in 30min) | Re-enrichment cost + speed | Schema evo + Cost-10k | A wins (single-corpus migration); C loses (tri-store) |
| `observe-pipeline-health` (cost/latency per run) | Run summary instrumentation | (orthogonal to backend) | All options can satisfy |
| `analyze-bloom-distribution` (future analytics) | SQL aggregates over bloom_level | Schema evo + analytical access | A wins decisively (native SQL); B/C/D need ETL to a warehouse |

**Reading**: of 7 jobs, 3 are orthogonal to backend choice, 4 are differentially served. Of those 4, Option A wins 3 outright and ties 1 (with B). This is the score basis for the recommendation.

---

## 4. Dissenting case — "what if pgvector is wrong?"

The candidate has pre-decided pgvector. This section is the honest answer to "but what if you're rationalizing?". Two scenarios where the recommendation flips, and one where the recommendation is held but the *framing* changes.

### 4a. If the corpus is already 100k+ at PoC time → Option B wins

The Expansion E cost numbers ($30/1k at 10k → $300/1k at 1M for *enrichment only*) say the bottleneck at 100k+ is **OpenAI spend**, not Postgres. The matrix cell that flips is **Hybrid quality (B=5, A=3)**: at 100k+ rows, the difference between native RRF (predictable behavior, configurable per-subquery weights, score-pipeline observability) and application-side RRF (our code, our edge cases) starts to matter to KPI #3 (retrieval relevance ≥ 80%). Plus stack-fit becomes a real operational cost amortized over months. **Trigger to revisit**: real corpus exceeds 100k *and* KPI #3 falls below 80%.

### 4b. If the workload is genuinely semantic-heavy at scale → Option D wins

If at 1M+ corpus, the analysis shows lexical retrieval contributes <20% to top-3 relevance (semantic dominates), the right answer is a *dedicated* vector store (Qdrant/Weaviate) + Postgres lexical, not OpenSearch. OpenSearch's strength is hybrid; if hybrid weighting becomes weighted 80/20 toward semantic, the lexical leg is over-resourced and the dedicated vector store is faster and cheaper. **Trigger to revisit**: usage analytics show semantic-leg recall dominates lexical-leg recall by a wide margin.

### 4c. If pgvector wins but is fragile in production → keep A, change the *framing*

This is the most likely real outcome: pgvector is correct for the PoC AND correct up to ~5M rows AND becomes a tuning problem above that. The dissent here isn't "switch to OpenSearch"; it's "be explicit that pgvector is the PoC + Release 1-3 choice and that the migration path to OpenSearch is on the roadmap." The migration is well-understood: dump `enriched_questions`, transform to OpenSearch document shape, bulk-index, swap the search adapter behind the existing `POST /api/search` endpoint. The work is real but the path is unambiguous. **This is the framing we recommend even when the recommendation is held**: pgvector for now, OpenSearch is the named exit.

### Has the candidate's locked choice been validated by this analysis?

**Yes, for the PoC.** With one caveat the candidate should internalize: the recommendation is *pgvector for PoC + Release 1-3*, not *pgvector forever*. The interview discussion is strongest when this honesty is foregrounded.

---

## 5. Surfaced concerns about the locked stack

Two architectural concerns we found while scoring. Both feed the DESIGN wave; neither is a stop-ship.

### 5a. Postgres enums vs text columns for `bloom_level`

Expansion A Section 5's dual-read migration assumes Postgres enums with `ALTER TYPE ... ADD VALUE`. That works (Postgres 12+) but is a one-way door — you cannot easily *remove* values from a Postgres enum without recreating the type. **Concern**: if DESIGN ratifies the 3-level Bloom PoC subset and later expands to 6-level, the additive migration is clean; if it later *retreats* (say, replaces "create" with "synthesize"), the migration is destructive. **Mitigation**: use `text` with a Zod-enforced check constraint at the application layer rather than a Postgres enum. The validation cost is the same; the migration cost is much lower. DESIGN should ratify text-with-CHECK-constraint over native enum.

### 5b. Mastra agent framework + multi-tool retrieval

The DISCUSS wave locked Mastra as the agent framework. While scoring, we noted that the hybrid-search retrieval is *one tool call*; the architecturally-significant question for Mastra is whether the agent can express the `{results: [], reason: "no_match"}` distinction cleanly (US-07). Mastra's tool-result-typing should support this; if it doesn't, DESIGN should flag it. **This is not a stop-ship**; it's a "verify on the first prototype" item for DELIVER. We've left it on the DESIGN wave's open-issue list.

### 5c. (Non-concern) Embedding model immutability

The DISCUSS wave already documents: changing the embedding model invalidates all stored vectors. This is correct and not a defect of pgvector — it's a property of vector search in general. Just naming it so the interview doesn't confuse the question.

---

## 6. Handoff to DESIGN

**One-line decision statement (for the search-backend ADR in DESIGN)**:

> Adopt Postgres + pgvector as the single store for source-of-truth, lexical (tsvector + GIN), and semantic (pgvector + HNSW) indexes; implement RRF fusion (`k=60`) in TypeScript at the `/api/search` boundary; document OpenSearch as the named migration target if/when the corpus exceeds 5M rows or KPI #3 falls below 80% at scale.

**Ingestion topology decision statement**:

> Adopt synchronous inline ingestion for the PoC (US-01..US-03 batch sizes ≤ 100). The inner enrich+embed+insert function is structured to be re-used as a queue consumer in production (Expansion E Section 7) without redesigning retry/quarantine semantics.

**What DESIGN owns next**:

1. Ratify text-with-CHECK-constraint vs Postgres enum for `bloom_level` (Section 5a).
2. Ratify the exact hybrid SQL — single-statement CTE with two legs union'd and rank'd, vs two queries fused in application code. Both work; one statement is more elegant but harder to debug.
3. Confirm Mastra tool-result schema can express `{results: [], reason: "no_match"}` (Section 5b).
4. Pin specific pgvector index parameters: HNSW (`m=16, ef_construction=200`) per pgvector recommended starting point.
5. Decide the dual-read window mechanics for prompt-version migrations (Expansion A Section 5 says it; DESIGN ratifies the implementation).

**What DESIGN does NOT need to reopen**:

- The choice itself (pgvector vs OpenSearch vs Pinecone). DIVERGE delivered it.
- The ingestion topology choice (T1 inline). DIVERGE delivered it.
- The agent framework (Mastra). Locked at DISCUSS.

---

## 7. Path to this file

This recommendation lives at:

`/home/martin/Projects/netea-task/docs/feature/hybrid-search-medical-questions/diverge/recommendation.md`

Supporting artifacts in the same directory:

- `options-matrix.md` — full scoring on 10 dimensions for 5 backend options + 5 dimensions for 4 ingestion topologies.
- `taste-filter.md` — staff-level taste judgments behind the cuts.

JTBD analysis is not re-produced in this wave (it lives in `feature-delta.md` and `docs/product/jobs.yaml`); decision-trace mapping appears in Section 3 above.
