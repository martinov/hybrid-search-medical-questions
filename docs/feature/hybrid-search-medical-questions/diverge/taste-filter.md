<!-- markdownlint-disable MD024 MD013 -->
# Taste filter — what we cut and why

**Feature**: `hybrid-search-medical-questions`
**Wave**: DIVERGE
**Date**: 2026-05-13

The options matrix scores 5 search backends and 4 ingestion topologies. This document records the staff-level taste judgments behind the cuts — i.e., when an option scored "okay on paper" but violated something we care about that the matrix can't fully capture. The point is to make the *judgment* legible and defensible, not to hide it behind a number.

A useful test: if a teammate disagreed with a cut, would the argument be substantive or aesthetic? Substantive cuts stay; aesthetic cuts get re-examined.

---

## Search backend cuts

### Cut: Option C — Pinecone + OpenSearch split (application-side fusion)

**Where it looked attractive**: Two systems already in Netea's stack. Strongest scalability ceiling. The "production-grade" shape.

**Why we cut it**:

1. **PoC budget violation.** Three systems on the critical path (Postgres source-of-truth, Pinecone vectors, OpenSearch lexical) cannot reach the US-01 walking skeleton in 8 hours with the resilience/observability work still to do. The brief calls for a Staff Engineer's PoC — a Staff Engineer demonstrates judgment about scope, not stamina.
2. **The dual-write tax.** Re-enrichment (Expansion E) requires re-upserting to two stores. The 5-stage migration playbook in Expansion E Section 5 was written assuming **one** corpus. With two stores, the dual-read window is now a tri-read window. We'd be inventing complexity to defend a stack choice.
3. **Conformance theater risk.** Choosing Pinecone+OpenSearch *because Netea uses them* — without the corpus scale that justifies it — is exactly the trap the brief warns against ("free to choose what fits best"). A staff engineer who picks the bigger system because it's familiar has chosen wrong.

**What kept it in the matrix at all**: it's the strongest answer at 100M+ corpus scale, which is *not* the PoC horizon. It belongs in the "future" column of the recommendation, not the "now" column.

**If this cut is wrong**: the only world where Option C wins is one where (a) the corpus is already at multi-million scale at PoC time, AND (b) the team already has Pinecone+OpenSearch operational knowledge. Neither is true here.

### Cut: Option E — Typesense / Meilisearch + pgvector

**Where it looked attractive**: Best-in-class developer experience for lexical search. Lower ops burden than OpenSearch.

**Why we cut it**:

1. **Adds a system without earning its keep.** The dimensions where Typesense/Meilisearch genuinely beat Postgres tsvector are *typeahead*, *typo tolerance with synonym expansion*, and *fuzzy matching with rich relevance tuning*. These matter for e-commerce search; they matter less for a question-corpus search where the user's input is a clinical scenario, not a product-name typo. The marginal value over Postgres tsvector + trigram does not justify the marginal operational cost.
2. **Out-of-stack with no compensating quality jump.** Unlike Option D (Qdrant) — which buys a measurably better vector store — Typesense/Meilisearch buys "nicer lexical search than tsvector." Nicer is not enough to justify being off-menu for a staff-level decision.
3. **Hybrid is still application-side.** We're back to writing the same RRF code we'd write for Option A, but now spread across two stores instead of one SQL query.

**If this cut is wrong**: the lexical quality requirements would have to come from a real user signal (e.g., medical-specialty jargon failing on tsvector). KPI #3 (top-3 relevance ≥ 80%) on a 10-question PoC corpus does not produce that signal.

### Cut (semi-cut): Option D — Qdrant / Weaviate self-hosted

**Where it looked attractive**: Best vector-quality-per-dollar at the 100k-1M scale. Genuine engineering-grade vector store.

**Why we cut it from the short-list (but not from the matrix)**:

1. **PoC scope.** Qdrant or Weaviate as a vector store + Postgres as the lexical store + Postgres as source-of-truth = two systems. One more Docker service, one more SDK. The marginal value at PoC corpus size (10 questions) is zero.
2. **Stack-fit penalty.** Netea uses Pinecone for vectors. Picking Qdrant is "I rejected your managed vector store for a self-hosted one I personally find compelling." That's defensible but requires defending. At PoC scope, the defense is weak (no operational data, no benchmarks against the actual workload).

**Why we kept it in the matrix**: this is the option we'd recommend if the pushback is "OK but at 1M scale your pgvector choice is wrong." Qdrant or Weaviate is the **honest scale-up answer**, ahead of OpenSearch, *if* the workload at 1M scale is primarily semantic retrieval. If the workload is genuinely hybrid at scale, OpenSearch wins. So Option D is the conditional runner-up.

**If this cut is wrong**: Option D wins the moment we have measured evidence that pgvector's HNSW at 100k-1M rows is the latency bottleneck (it usually isn't — embedding latency dominates).

---

## Search backend kept short-list

### Kept: Option A — Postgres + pgvector (the recommendation)

Discussed in detail in `recommendation.md`. The taste argument:

- It is the **simplest thing that could possibly work for the PoC**, which is the correct taste-test for an 8-hour budget with hard scope (US-01 through US-07).
- It produces a **defensible production scale-up story** (Expansion E Section 7) without requiring the production scale-up to be built.
- It does **one thing well in one place**: source-of-truth, lexical index, and vector index in one transactional store, queried by one SQL statement.

### Kept: Option B — OpenSearch managed (the runner-up)

Kept short-listed because:

- It is the **brief's lead example** ("OpenSearch vs. Pinecone vs. Postgres"); we cannot credibly omit it.
- It is Netea's actual stack; stack-fit is a real signal.
- Its native RRF support (score-ranker-processor in OpenSearch 2.19+ with configurable `rank_constant` and per-subquery weights) is a genuine quality argument.
- It is the right answer at *publisher-scale* (1M+ corpus, high QPS).

It loses at PoC scope on TTPoC alone. If the budget were 24 hours, Option B becomes competitive with Option A.

### Kept: Option C — Pinecone + OpenSearch split (the foil)

Kept short-listed *despite the cut above* because the brief explicitly mentions Pinecone and OpenSearch as the current stack. Eliminating it without naming it in the decision record would look like avoidance. It earns its slot in the short-list by being the *foil* against which Options A and B are defended.

This is a substantive taste judgment: the short-list is "what we'd actually consider", not "what we'd recommend". Option C is in the discussion.

---

## Ingestion topology cuts

### Cut: T3 — Separate worker process + DB-backed queue

**Where it looked attractive**: Closer to the production shape. Resumable.

**Why we cut it**:

1. **Premature production.** A queue table + worker process + claim/lease semantics is ~3 hours of yak-shaving that does not show up in any user story. We'd be building the production version of the pipeline at PoC time, which conflates two concerns. Expansion E Section 7 already commits to the production shape — the PoC doesn't need to preview it in code, only in argument.
2. **Failure-model split.** Expansion A Section 3's decision matrix is clean when retries and quarantine live in one process. Splitting them across a queue layer means retry-at-the-queue and retry-at-the-LLM become two policies that have to be reconciled. Not impossible, but the wrong scope for 8 hours.
3. **Demo cost.** The admin journey TUI mockup (`admin-ingests-batch.yaml` Step 1) shows a single CLI streaming per-question logs. A worker-process design either matches that UX by polling the worker (extra glue) or breaks it (Sam runs two terminals during the demo, which looks bad).

**If this cut is wrong**: T3 would win if we were demonstrating a *production* ingestion system rather than a PoC. The likely "how would you scale this?" question gets the Expansion E Section 7 answer, not the T3-implemented-in-PoC answer.

### Cut: T4 — Real queue (SQS / Redis Streams)

**Where it looked attractive**: Production-ready.

**Why we cut it**: same as T3, more severe. AWS dependency for an 8-hour PoC demo is wrong shape. Adds infra setup with zero PoC-scope benefit. Easy reject.

### Kept: T1 — Synchronous inline (the recommendation)

Discussed in `recommendation.md`. The taste argument: matches the TUI mockup in the journey artifact exactly. Maps the Expansion A Section 3 decision matrix to a single function. Zero infra. Maximally inspectable during the demo.

### Kept (acceptable alternative): T2 — Async in-process worker (concurrency pool)

Acceptable if the seed batch grows to >100 questions and total runtime becomes painful. A concurrency-of-3 pool (`p-limit`) is ~30 lines of code over T1. The recommendation is T1 *for 10 questions*; T2 *for batches above ~100*.

---

## Anti-patterns we explicitly rejected

These were tempting and wrong. Naming them explicitly so their absence is defensible.

### "Vector-only with no lexical leg"

A stakeholder might ask "why bother with hybrid? Just use embeddings." The taste answer: medical content has high-precision-vocabulary tokens (drug names, dosages, lab values, scoring scales like CHA2DS2-VASc, ICD codes). Pure semantic retrieval misses these (US-04 Domain Example 2 makes the case concretely — "ticagrelor vs clopidogrel mortality benefit" demands lexical precision). Hybrid is correct; rejecting it would be wrong.

### "Use LangChain instead of building the retrieval ourselves"

LangChain has retrieval abstractions. The taste answer: at this scale, the abstraction *costs more than it earns*. Our retrieval is 30 lines of SQL + 10 lines of RRF in TypeScript. LangChain's retriever interface adds indirection without adding functionality we don't already get from Postgres. And — separately — the stack is locked at Mastra (DISCUSS wave, System Constraints).

### "Build a real BI dashboard for cost/latency"

The temptation: graphs look professional in a demo. The taste answer: `logs/runs/{batch_id}.json` + `jq` is the PoC-grade BI tool. US-03 AC #5 (pricing table lives in code, trivially updatable) makes this self-service. Adding Grafana to a PoC is the kind of conformance theater the brief explicitly warns against ("we're not looking for perfect production code, but Staff-level thinking").

### "Pin to specific OpenAI snapshot ID"

Expansion A Section 8 Q4 names this. The taste answer: it's *correct for production*, but for PoC, pinning to `gpt-4o-mini-2024-07-18` means the M0 demo could fail if that snapshot has been deprecated. Document the policy ("we'd pin in production for medical content stability"), implement the floating alias for the PoC. This is taste: knowing when the right answer is not the answer-you-implement.

---

## Recommendation summary

After taste-filtering: the short-list for search backend is **A (pgvector)** with **B (OpenSearch)** as the defensible runner-up and **C (Pinecone+OpenSearch)** as the named-but-rejected foil. Options D and E are removed from the short-list but remain on the matrix for the "what if" stakeholder question. The short-list for ingestion topology is **T1 (synchronous inline)** with **T2 (concurrency pool)** as the scale-up trigger.

The recommendation document picks the winners and writes the rationale.
