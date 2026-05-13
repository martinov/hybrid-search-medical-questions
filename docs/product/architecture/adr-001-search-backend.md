<!-- markdownlint-disable MD013 -->
# ADR-001 — Search backend: Postgres + pgvector with OpenSearch as named exit

**Status**: Accepted
**Date**: 2026-05-13
**Deciders**: system-architect
**Wave**: DESIGN (after DIVERGE recommendation)

## Context

The feature (`hybrid-search-medical-questions`) must support hybrid search
(lexical + semantic) over LLM-enriched medical exam questions. The backend
decision requires a credible short-list (OpenSearch, Pinecone, and
Postgres-class options) with explicit trade-offs.

The DIVERGE wave scored five candidate backends across ten dimensions
(scalability, maintenance, cost at PoC/10k/1M, time-to-PoC, hybrid quality,
stack fit, schema evolution, migration off). The recommendation (see
`docs/feature/hybrid-search-medical-questions/diverge/recommendation.md`) is
captured here as the binding ADR.

Constraints relevant to this decision:

- **8-hour PoC budget**. Time-to-PoC is a hard constraint.
- **Hybrid quality is the headline KPI** (KPI #3: top-3 contains a topical
  match for ≥ 80% of seed queries).
- **Re-enrichment must be cheap** (Expansion E: migration playbook for
  prompt-version changes).
- **Curriculum analytics (Expansion C)** depends on SQL-shaped aggregates
  over `bloom_level` and `medical_specialty`.
- **Stack-fit signal**: Netea's stated stack is AWS + OpenSearch + Pinecone.

## Decision

**Adopt Postgres 16 + pgvector + tsvector as a single store** for
source-of-truth, lexical index, and semantic index.

Specifics:

- **Lexical leg**: Postgres `tsvector` (generated column over `title`,
  `content`, `array_to_string(keywords, ' ')`), indexed with `GIN`,
  weighted via `setweight(...)` per field.
- **Semantic leg**: pgvector `vector(1536)` column, indexed with `HNSW`
  (`m=16, ef_construction=200` per pgvector recommended starting point).
- **Fusion**: application-side **Reciprocal Rank Fusion** with `k=60`
  (the universal default across Elasticsearch, OpenSearch, and Qdrant —
  see `diverge/options-matrix.md` §sources). Implemented in
  `packages/search` as a ~30-line TypeScript function.
- **Named exit**: OpenSearch managed (AWS) at M3 if/when (a) corpus
  exceeds 5M rows OR (b) retrieval-relevance KPI #3 falls below 80% at
  scale.

## Consequences

### Positive

- **Time-to-PoC unlocked**: walking skeleton (US-01) achievable in ~2 hours
  of pipeline work, leaving 6 of 8 hours for the staff-level work
  (resilience, observability, hallucination defense). This is the
  determinative factor at PoC scope.
- **No dual-write tax**: the same store holds source-of-truth, lexical
  index, and semantic index. Atomic INSERT means we never face the
  "wrote to Pinecone, failed to write to OpenSearch" failure mode.
  Re-enrichment (Expansion E §5) operates on one corpus with one
  `prompt_version` column.
- **SQL analytics**: Expansion C's curriculum-analytics views are direct
  SQL aggregates over `bloom_level` and `medical_specialty`. Cannot be
  served by Pinecone; would require ETL out of OpenSearch.
- **Schema evolution is cheap**: `ALTER TABLE ADD COLUMN` for new
  enrichment fields; `ALTER TYPE ... ADD VALUE` for additive enum changes
  (e.g., 3-level Bloom → 6-level Bloom per Expansion A §5).
- **Honest scale headroom**: pgvector HNSW measured at ~1.5 ms single-query
  latency on representative data, well into single-digit-million-row
  corpora (AWS benchmark cited in `options-matrix.md` §sources). Three
  orders of magnitude above the PoC horizon.
- **Operational simplicity**: one runtime to back up, monitor, version,
  and learn. Postgres ops knowledge is broadly available.

### Negative

- **No native RRF**: fusion is application-side. Trade-off: full control
  over the formula, but it's our code to maintain. Mitigation:
  `packages/search` exposes RRF as a pure function; unit-testable against
  golden ranked lists.
- **HNSW memory pressure at scale**: HNSW uses 2-5× the memory of IVFFlat
  (per `options-matrix.md` §sources). At 5M+ rows, this is a real
  operational concern. Mitigation: named exit to OpenSearch at M3; the
  pre-conditions to fire it are objective.
- **Stack-fit penalty (mild)**: pgvector is not Netea's stated stack. The
  defensible framing is "right tool for PoC scope; named migration to the
  stated stack at M3." This is not a stack-conformance exercise; it's a
  fit-for-purpose decision.
- **HNSW index rebuild cost**: parameter changes require a rebuild (see
  Risk R-07 in `brief.md`). Mitigation: pick parameters once at M0; use
  `CREATE INDEX CONCURRENTLY` + atomic name swap for any future change.

## Alternatives considered

The DIVERGE wave scored 5 candidates. The summary:

- **B. OpenSearch managed** (runner-up): native RRF via `score-ranker-processor`
  (OpenSearch 2.19+, configurable `rank_constant`, per-subquery weights);
  Netea's stated stack. Loses on time-to-PoC alone: 4-5 hours to walking
  skeleton would leave the staff-level work under-resourced.

- **C. Pinecone (vectors) + OpenSearch (lexical), application-side fusion**
  (killed): three systems on the critical path; dual-write tax at every
  re-enrichment; conformance-theater risk. Fit-for-purpose beats stack
  conformance at PoC scope.

- **D. Qdrant or Weaviate self-hosted + Postgres lexical** (cut from
  short-list, kept in matrix): genuine vector-store quality at 100k-1M
  scale; two systems on the critical path; stack-fit penalty without a
  compensating quality jump at PoC scope. Conditional runner-up *if* the
  workload at 1M+ scale is semantic-dominant.

- **E. Typesense / Meilisearch + pgvector** (cut): adds a system without
  earning its keep. The dimensions where Typesense/Meilisearch genuinely
  beat tsvector (typeahead, fuzzy matching, synonym expansion) matter
  less for clinical-scenario queries.

Full scoring at
[`docs/feature/hybrid-search-medical-questions/diverge/options-matrix.md`](../../feature/hybrid-search-medical-questions/diverge/options-matrix.md).
Taste-filter judgments at
[`docs/feature/hybrid-search-medical-questions/diverge/taste-filter.md`](../../feature/hybrid-search-medical-questions/diverge/taste-filter.md).

## Migration path

If the M3 trigger fires (corpus >5M OR KPI #3 <80%), migration to
OpenSearch is **substitution at the `packages/search` adapter boundary**,
not a rewrite. The application API (`POST /api/search`) does not change.

Sketch:

1. Stand up OpenSearch managed cluster (Netea's existing infra).
2. Backfill `enriched_questions` → OpenSearch via Bulk API. The `embedding`
   column on every Postgres row is portable as-is (float32 array).
3. Dual-write at ingestion (Postgres primary + OpenSearch replica) for a
   validation window. Compare retrieval relevance on a labeled set.
4. Flip search reads to OpenSearch. Validate KPI #3 + latency budgets in
   §4.3 of `brief.md` against the new backend.
5. Retire pgvector HNSW index. Keep `embedding` column in Postgres for
   analytics (curriculum-designer SQL aggregates per Expansion C).

The migration is bounded to one package (`packages/search`) and one job
(the backfill). Application code that depends on `Searcher` interface
remains untouched. This is the load-bearing argument for "Postgres now,
OpenSearch later" being a *plan* rather than a *gamble*.

## References

- `docs/feature/hybrid-search-medical-questions/diverge/recommendation.md`
- `docs/feature/hybrid-search-medical-questions/diverge/options-matrix.md`
- `docs/feature/hybrid-search-medical-questions/diverge/taste-filter.md`
- `docs/feature/hybrid-search-medical-questions/expansions/E-cost-and-reenrichment.md` (re-enrichment shape)
- `docs/product/architecture/brief.md` §1, §4.3, §5 (this ADR's data flow + budgets)
