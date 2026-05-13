<!-- markdownlint-disable MD024 MD013 -->
# Options matrix — search backend (primary) and ingestion topology (secondary)

**Feature**: `hybrid-search-medical-questions`
**Wave**: DIVERGE
**Date**: 2026-05-13
**Source inputs**: `docs/Test Task - BE Staff Engineer.md`, `feature-delta.md`, expansions A/E/C.

This document is the full scoring table for both axes. `recommendation.md` distills it; `taste-filter.md` explains which options were cut and why. Scores use a 1-5 scale (1 = poor / 5 = excellent for the dimension). Where a dimension is genuinely a trade-off rather than a "more is better" axis, the cell carries a directional note.

A reminder on framing: the task asks for **2-3** options. We surface 5 candidates so the decision is *informed*, but the final recommendation will defend a short-list of 3 (the rest exist on this matrix to explain why they were not the short-list).

---

## Primary axis — search backend

### Dimensions

| Dim | What it measures | Why it matters here |
|---|---|---|
| **Scalability** | Headroom from 10 q → 1M q; failure mode when exceeded; migration cost | Task spec explicit; Expansion E sizes 10k / 100k / 1M corpora |
| **Maintenance** | Ops burden, schema evolution, version upgrades, monitoring, team learning curve | Task spec explicit; PoC is solo-engineer but interview discussion is staff-level |
| **Cost (PoC)** | Infra + license for the 8-hour PoC + 10-question seed | Bounds the "can you actually ship this in 8h?" question |
| **Cost (10k)** | Infra + license at 10k-question scale (one realistic content pack) | Expansion E's per-question cost is OpenAI-only; this dimension is the *infra* tail |
| **Cost (1M)** | Infra + license at 1M-question scale (publisher-scale) | The staff-level "how does it scale?" framing |
| **Time-to-PoC** | Hours of effort within the 8-hour budget to reach US-01 walking skeleton | Hard constraint per task spec |
| **Hybrid quality** | Native RRF / score normalization / per-field weighting support | KPI #3 is retrieval relevance; bad hybrid = the PoC's headline metric fails |
| **Stack fit** | Conformance with Netea's stated stack (AWS, OpenSearch, Pinecone) | "Free to choose" but conformance has signal value |
| **Schema evo** | Cost of adding fields (`medical_specialty`, `needs_reenrichment`) | Expansion C requires `medical_specialty`; Expansion E requires `needs_reenrichment` |
| **Migration path** | Cost to switch off this choice to a different option later | Honest staff framing — every PoC choice has an exit |

### Score table

| Option | Scal. | Maint. | Cost-PoC | Cost-10k | Cost-1M | TTPoC | Hybrid | Stack fit | Schema evo | Migration off |
|---|---|---|---|---|---|---|---|---|---|---|
| **A. Postgres + pgvector** | 3 | 5 | 5 | 5 | 3 | 5 | 3 | 3 | 5 | 4 |
| **B. OpenSearch (managed AWS)** | 5 | 3 | 2 | 3 | 4 | 2 | 5 | 5 | 4 | 3 |
| **C. Pinecone (vectors) + OpenSearch (lexical)** | 5 | 2 | 1 | 2 | 3 | 1 | 3 | 5 | 2 | 2 |
| **D. Qdrant self-hosted + Postgres lexical** | 4 | 3 | 3 | 3 | 4 | 3 | 4 | 2 | 3 | 3 |
| **E. Typesense / Meilisearch + pgvector** | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 2 | 3 | 2 |

### Per-cell justification

#### A. Postgres + pgvector (single store, tsvector + pgvector, app- or SQL-side RRF)

- **Scal. 3** — Honest ceiling: pgvector with HNSW handles single-digit-million-row corpora cleanly; AWS benchmark cited HNSW at ~1.5ms single-query latency vs ~2.4ms for IVFFlat on representative data. Past ~10M rows, single-node Postgres becomes a tuning project (memory, parallel scan, replicas). Migration to a dedicated vector store is non-trivial but well-documented. Not "infinite" headroom — but **3-4 orders of magnitude above PoC scale**, which is the relevant horizon.
- **Maint. 5** — One system to learn, monitor, back up, version. Postgres ops knowledge is broadly available. No new vendor relationship.
- **Cost-PoC 5** — Local Docker. $0 infra. Extension install is one SQL statement.
- **Cost-10k 5** — Single small managed Postgres ($25-50/mo on RDS/Neon/Supabase). pgvector index for 10k rows is <100MB.
- **Cost-1M 3** — Now you're sizing for a real RDS instance; memory pressure from HNSW (2-5× IVFFlat memory) becomes visible. Still fits one machine, but instance cost climbs to ~$200-400/mo region for comfortable headroom.
- **TTPoC 5** — Zero new infra. Migration creates extension; tsvector is a generated column; pgvector column with `vector(1536)`. The walking skeleton (US-01) is achievable in ~2 hours of pipeline work.
- **Hybrid 3** — No native RRF. Hybrid is **application-side**: run lexical and semantic queries separately, fuse by rank (RRF with k=60 default) or weighted score. This is ~30 lines of TypeScript. Trade-off: full control over the formula, but it's our code to maintain. Per-field weighting requires manual `setweight` on tsvector columns.
- **Stack fit 3** — Netea uses AWS + OpenSearch + Pinecone. Postgres on AWS (RDS) is a first-class citizen but pgvector is *not their stated stack*. Conformance-light but not conformance-hostile.
- **Schema evo 5** — Adding `medical_specialty` is `ALTER TABLE ADD COLUMN`. Adding `needs_reenrichment boolean` is the same. Generated tsvector column means lexical index updates automatically. Postgres enums are append-only at the type level (`ALTER TYPE ... ADD VALUE`) which is the exact migration shape Expansion A Section 5 assumes for the Bloom enum.
- **Migration off 4** — If we hit a ceiling and need to move to a dedicated vector store, the data is portable: embeddings are `float[]`, lexical index is rebuildable from source columns. The hard part is reproducing the SQL hybrid formula in the new store, but RRF is universal. ETL effort, not a rewrite.

#### B. OpenSearch (managed on AWS, BM25 + kNN + native RRF)

- **Scal. 5** — Built for this. Horizontal sharding, replica tuning, snapshot/restore are mature. Real publishers run multi-billion-doc OpenSearch clusters.
- **Maint. 3** — Two systems on the critical path (Postgres for source-of-truth + OpenSearch for indexing) unless we put everything in OpenSearch (then we lose transactional integrity on enriched_questions). Cluster version upgrades, snapshot management, JVM tuning are real ops costs. AWS managed reduces but doesn't eliminate these.
- **Cost-PoC 2** — AWS OpenSearch Serverless has a minimum spend (typically ~$24/day OCU pricing); even the smallest non-serverless cluster is ~$25/mo for a t3.small.search. Local dev requires running OpenSearch in Docker (1-2GB RAM minimum, JVM tuning to keep it from OOM-ing on a developer laptop). This is non-trivial PoC friction.
- **Cost-10k 3** — t3.small.search single-node ~$25/mo; comfortable for 10k. Add embedding storage (kNN plugin) and you're around $30-50/mo.
- **Cost-1M 4** — Genuinely good here. Sharded cluster of ~3 nodes at $100-200/mo handles 1M with headroom. Beats pgvector at this scale on cost-per-query, especially with high QPS.
- **TTPoC 2** — Local Docker setup + index template + ingest pipeline + kNN plugin config + hybrid search pipeline (score-ranker-processor introduced in OpenSearch 2.19) + AWS SDK plumbing. The 8-hour budget is tight. Realistic: 4-5 hours to walking skeleton, leaves 3-4 hours for everything else (resilience, observability, UI). Risk: a single OpenSearch yak-shave eats the budget.
- **Hybrid 5** — Native. OpenSearch 2.19+ ships a `score-ranker-processor` with RRF technique (default `rank_constant: 60`), configurable per-subquery weights, no application-side fusion needed. This is the strongest argument for OpenSearch on this dimension. Per-field boosting on the BM25 side is also native and mature.
- **Stack fit 5** — Their stated stack. The interview discussion has signal value here ("you chose what we already run").
- **Schema evo 4** — Adding a field is an index template update + reindex (or dynamic mapping if we're loose). Reindex on a 1M-doc index is a real operation but well-tooled. Not as cheap as `ALTER TABLE` but not painful either.
- **Migration off 3** — Hard to leave because the data is in OpenSearch's specific document shape; you'd export, transform, reimport into the new store. Search formulas in OpenSearch DSL don't port to other backends directly. Lock-in is real.

#### C. Pinecone (vectors) + OpenSearch (lexical), application-side fusion

- **Scal. 5** — Both components scale independently. Pinecone is managed-only and is essentially infinite from the user's perspective (price scales, not feasibility).
- **Maint. 2** — **Three systems** on the critical path: Postgres (source-of-truth), Pinecone (vectors), OpenSearch (lexical). Three sets of credentials, three monitoring dashboards, three failure modes. Re-enrichment (Expansion E) requires re-upserting to both Pinecone and OpenSearch. The complexity tax is the highest of any option.
- **Cost-PoC 1** — Pinecone has a free tier (1 index, ~100k vectors) but you still need OpenSearch running. Two systems to stand up. Network calls to two external services on every search.
- **Cost-10k 2** — Pinecone starter ~$70/mo + OpenSearch ~$30/mo = ~$100/mo. For 10k questions, this is 3-4× a single Postgres.
- **Cost-1M 3** — Pinecone standard at 1M vectors is ~$70-200/mo depending on tier + OpenSearch ~$100-200/mo. Total ~$170-400/mo. Competitive with single OpenSearch, slightly more than single Postgres.
- **TTPoC 1** — Two SaaS signups (Pinecone account, AWS OpenSearch instance), two SDK integrations, application-side fusion code, dual-write logic in the pipeline. Realistic budget: 5-6 hours just to walking skeleton. **High risk of not finishing the PoC.**
- **Hybrid 3** — Application-side fusion. Same code complexity as Postgres option, but spanning two network calls instead of one SQL query. Latency adds up.
- **Stack fit 5** — Both components in Netea's stated stack.
- **Schema evo 2** — Adding a field to enriched questions means update Postgres + reindex OpenSearch + re-upsert Pinecone metadata. Three migration paths, none atomic.
- **Migration off 2** — You're locked into Pinecone's API for vectors and OpenSearch's DSL for lexical. Migrating off either means re-architecting fusion logic. The combination is the worst migration path of any option.

#### D. Qdrant or Weaviate self-hosted + Postgres lexical

- **Scal. 4** — Qdrant scales to billions of vectors with sharding. Weaviate similar. Both are vector-first.
- **Maint. 3** — New runtime to operate (Rust-based for Qdrant). Smaller community than Postgres or OpenSearch. Two systems on the critical path.
- **Cost-PoC 3** — Local Docker. Free OSS.
- **Cost-10k 3** — Self-hosted on a small VM (~$10-20/mo) + Postgres = ~$30-50/mo. Comparable to Postgres-only.
- **Cost-1M 4** — Dedicated vector store performs well here; possibly faster QPS than pgvector. Infra cost ~$50-100/mo.
- **TTPoC 3** — One extra Docker service, one extra SDK. Roughly +1 hour over the pgvector option. Doable in budget but tighter.
- **Hybrid 4** — Qdrant 1.x has native hybrid with `prefetch` + fusion. Weaviate has hybrid search with alpha-weighting. Both have decent native support, slightly less mature than OpenSearch's RRF.
- **Stack fit 2** — Not in Netea's stack. Picking this requires an "outside the menu" defense in the interview.
- **Schema evo 3** — Adding a field requires Qdrant payload update + Postgres ALTER. Two systems, but Qdrant payloads are schemaless so it's not painful.
- **Migration off 3** — Better than Pinecone (open-source, exportable) but still a re-architecture if you leave.

#### E. Typesense / Meilisearch + pgvector

- **Scal. 3** — Typesense and Meilisearch are purpose-built lexical engines optimized for the developer-experience-first crowd. Both can scale to ~10M docs comfortably; beyond that, less proven than OpenSearch.
- **Maint. 3** — Another system to operate. Both have simpler ops surface than OpenSearch (no JVM, no cluster topology drama) but it's still +1 service.
- **Cost-PoC 3** — Free OSS. Docker.
- **Cost-10k 3** — Comparable to other "Postgres + something" splits.
- **Cost-1M 3** — Workable but at this scale OpenSearch's tooling maturity wins.
- **TTPoC 3** — One extra Docker service. Hybrid logic still application-side (same as pgvector but across two stores).
- **Hybrid 3** — Typesense has built-in vector search and hybrid; Meilisearch added vector search relatively recently. Neither has RRF as natively-named as OpenSearch.
- **Stack fit 2** — Not in Netea's stack.
- **Schema evo 3** — Two systems.
- **Migration off 2** — Both have proprietary-ish APIs.

---

## Secondary axis — ingestion topology

The journey artifact (`admin-ingests-batch.yaml`) explicitly calls out "the asynchronous nature of the AI enrichment" via the task spec. The DISCUSS wave already constrained: no orchestrator (Airflow/Temporal) in PoC scope. So this axis is shorter than the search backend.

### Dimensions

| Dim | What it measures |
|---|---|
| **Determinism for PoC demo** | Can Sam run `pnpm run ingest` and see deterministic output in <30s for 10 questions? |
| **Production scale-up** | Does the PoC topology survive being wrapped for production (10M-question Expansion E Section 7)? |
| **PoC complexity** | Lines of glue code; infra components added |
| **Failure model clarity** | Can we explain retry/quarantine semantics simply at the interview? |
| **Resumability** | Can a half-finished run be resumed? |

### Score table

| Option | PoC determinism | Prod scale-up | PoC complexity | Failure model | Resumability |
|---|---|---|---|---|---|
| **T1. Synchronous inline (in CLI)** | 5 | 2 | 5 | 5 | 1 |
| **T2. Async in-process worker (Promise pool)** | 4 | 3 | 4 | 4 | 2 |
| **T3. Async separate worker process + DB queue** | 3 | 4 | 2 | 3 | 4 |
| **T4. Real queue (SQS/Redis Streams)** | 2 | 5 | 1 | 3 | 5 |

### Per-cell justification

#### T1. Synchronous inline — `for question of batch { enrich; embed; insert }`

- **PoC determinism 5** — Single process, linear log lines, easy to demo. Exactly what `admin-ingests-batch.yaml` Step 1 shows in the TUI mockup.
- **Prod scale-up 2** — Becomes a producer that writes to a queue (Expansion E Section 7). The inner enrich/embed function is reusable; the loop is rewritten. Acceptable trade.
- **PoC complexity 5** — Zero infrastructure. One TypeScript file. The simplest thing that could work.
- **Failure model 5** — Per-question try/catch, retry-with-feedback, quarantine, summary. The decision matrix from Expansion A Section 3 maps directly.
- **Resumability 1** — None. A half-finished run is just half-finished. For 10 questions this is fine; for 10k it's a problem. PoC scope makes the trade-off worth taking.

#### T2. Async in-process worker (concurrency pool)

- **PoC determinism 4** — Per-question logs interleave; order is preserved if you queue them, but parallelism makes the timing variable. Demoable but less clean.
- **Prod scale-up 3** — Same producer-shaped function inside, easier to factor out for queue migration than T1's tight loop.
- **PoC complexity 4** — Promise pool library or hand-rolled (p-limit). +30 lines.
- **Failure model 4** — Per-task isolation is good. Aggregating retry counts across concurrent tasks is fiddly but tractable.
- **Resumability 2** — In-memory queue. Resume after crash = restart from scratch.

#### T3. Async separate worker process + Postgres-backed queue

- **PoC determinism 3** — Two processes. Demo requires running both. Possible but the demo gets longer.
- **Prod scale-up 4** — This is *most of* the production shape: producer writes to a queue table, worker drains. Just swap queue table for SQS/Kafka at scale.
- **PoC complexity 2** — Adds a `ingest_queue` table, worker process, claim/lease semantics, dead-letter logic. Easily 3+ hours of effort that doesn't show up in any KPI.
- **Failure model 3** — Now you have to reason about message visibility, retries-at-the-queue-layer vs retries-at-the-LLM-layer, and quarantine. The decision matrix in Expansion A no longer maps cleanly; it's split across two services.
- **Resumability 4** — Crash-restart resumes from the queue. Good for production. Overkill for 10 questions.

#### T4. Real queue (SQS / Redis Streams)

- **PoC determinism 2** — External managed service in the demo path. AWS dependency for a take-home is wrong shape.
- **Prod scale-up 5** — Production-ready out of the gate.
- **PoC complexity 1** — Requires AWS/Redis infra, IAM, credentials in the demo, two-process orchestration. Wrong tool for 10 questions.
- **Failure model 3** — Same as T3 plus the at-least-once-delivery semantics that queues bring.
- **Resumability 5** — Native.

---

## Cross-axis notes

- The search backend choice (A) and the ingestion topology choice (T1) are **independent decisions**. Choosing pgvector does not force inline ingestion; choosing OpenSearch does not require a queue.
- Two combinations are particularly natural: **A + T1** (lowest PoC complexity, max staff-engineer-defensible if framed correctly) and **B + T3** (the production-shape preview, but at 2× the PoC complexity).
- The recommendation traces from this matrix to `recommendation.md`. The cells that drove the recommendation are: **A**'s Scal=3 (honest ceiling above PoC horizon), **A**'s Cost-PoC=5 and TTPoC=5 (fit-for-purpose), **B**'s TTPoC=2 (the elimination criterion at 8-hour budget), **C**'s combined Maint=2 + TTPoC=1 (the disqualification).

## Sources

- OpenSearch RRF (`score-ranker-processor`, introduced in OpenSearch 2.19, `rank_constant` configurable, per-subquery weights) — [Introducing reciprocal rank fusion for hybrid search](https://opensearch.org/blog/introducing-reciprocal-rank-fusion-hybrid-search/), [Score ranker - OpenSearch Documentation](https://docs.opensearch.org/latest/search-plugins/search-pipelines/score-ranker-processor/)
- pgvector HNSW vs IVFFlat latency/recall (AWS measured ~1.5ms HNSW vs ~2.4ms IVFFlat single-query; HNSW uses 2-5× IVFFlat memory; 0.8.0 added iterative scans for WHERE-clause recall) — [AWS Blog: pgvector indexing deep dive](https://aws.amazon.com/blogs/database/optimize-generative-ai-applications-with-pgvector-indexing-a-deep-dive-into-ivfflat-and-hnsw-techniques/), [pgvector/pgvector on GitHub](https://github.com/pgvector/pgvector), [Instaclustr pgvector performance benchmarks](https://www.instaclustr.com/education/vector-database/pgvector-performance-benchmark-results-and-5-ways-to-boost-performance/)
- RRF `k=60` default and its rationale across Elasticsearch / OpenSearch / Qdrant — [Reciprocal Rank Fusion: the one-line algorithm](https://blog.serghei.pl/posts/reciprocal-rank-fusion-explained/), [Elasticsearch RRF reference](https://www.elastic.co/docs/reference/elasticsearch/rest-apis/reciprocal-rank-fusion)
