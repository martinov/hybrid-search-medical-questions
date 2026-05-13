<!-- markdownlint-disable MD013 -->
# ADR-005 — Embedding model: text-embedding-3-small (1536-dim)

**Status**: Accepted
**Date**: 2026-05-13
**Deciders**: system-architect
**Wave**: DESIGN

## Context

The PoC embeds enriched questions into a 1536-dim vector space for semantic
retrieval (pgvector cosine similarity). The embedding model is chosen once
at ingest time and must match at query time (DISCUSS wave System Constraints:
"Single embedding model at ingest time and query time. Switching the
embedding model invalidates all stored vectors").

Constraints relevant to this decision:

- **Cost**: Expansion E §1 budgets the embedding call at 300 tokens p50;
  the embedding cost is <3% of the per-question total. Embedding cost is
  *not* the bottleneck.
- **Dimensions**: storage cost scales linearly with vector dimensions
  (§4.5 of `brief.md`: 1536 × float32 = 6,144 bytes per row for the
  embedding alone — the dominant per-row size).
- **Quality at scale**: KPI #3 (top-3 retrieval relevance ≥ 80%) is the
  binding quality metric. Better embeddings = better recall on edge cases.
- **Domain**: medical questions with high-precision vocabulary (drug
  names, dosages, scoring scales) and clinical-scenario phrasing.

Candidate models evaluated:

- **OpenAI `text-embedding-3-small`** (1536 dim, $0.02 / 1M tokens)
- **OpenAI `text-embedding-3-large`** (3072 dim, $0.13 / 1M tokens)
- **OpenAI `text-embedding-ada-002`** (1536 dim, deprecated 2024-25)
- **Sentence-transformers `all-MiniLM-L6-v2`** (384 dim, self-hosted,
  free)
- **Cohere `embed-english-v3.0`** (1024 dim)
- **BGE-M3** (1024 dim, self-hosted, multilingual)
- **Domain-specific medical embeddings** (BioBERT, ClinicalBERT, MedCPT)

## Decision

**Adopt OpenAI `text-embedding-3-small` (1536-dim, float32).**

Specifics:

- **Column type**: `embedding vector(1536)` (pgvector).
- **Index**: HNSW with cosine distance (`vector_cosine_ops`). Parameters
  `m=16, ef_construction=200` (pgvector recommended starting point per
  `options-matrix.md` §sources).
- **Provenance**: `embedding_model` column stamped on every enriched row
  with the model identifier used at ingest. Search-time embedding uses the
  same model.
- **Input shape**: title + content + keywords concatenated (~300 tokens
  p50). Answers and explanation are *not* embedded — they're for student
  reading at result-open time, not for retrieval ranking.

## Consequences

### Positive

- **Cost-aligned with the corpus owner's budget**: at $0.02 / 1M tokens
  and ~300 tokens per question, the embedding cost is ~$0.0000060 per
  question (Expansion E §1). At 1M corpus, total embedding cost is $6.
  Trivially absorbed.
- **Dimensions match pgvector's HNSW sweet spot**: 1536 dim is the same
  shape as the deprecated `ada-002` and many open-source models; pgvector
  HNSW operates efficiently here per the AWS benchmark cited in
  `options-matrix.md` §sources.
- **Quality is competitive for general English**: `text-embedding-3-small`
  beats `ada-002` on MTEB benchmarks at lower cost. For medical content
  specifically, no public benchmark fully captures USMLE-style content,
  but the lexical leg (tsvector + GIN) catches the high-precision
  vocabulary that pure semantic might miss — the hybrid design (ADR-001)
  is the load-bearing argument for "good enough" embeddings being good
  enough.
- **Same AI SDK path as enrichment**: `ai`'s `embed` / `embedMany` use the
  same `@ai-sdk/openai` provider that `generateObject` uses. No second SDK,
  no second credential, no second rate-limit budget to manage. One vendor,
  one client, one provisioning path.
- **Lower storage and memory footprint vs `text-embedding-3-large`**:
  1536 × 4 bytes = 6,144 bytes per row; the `large` model at 3072 dims is
  12,288 bytes per row, doubling the HNSW memory footprint (which is
  already the dominant Postgres memory consumer at 100k+ rows).

### Negative

- **Vendor lock-in**: changing the embedding model invalidates *every*
  stored vector. This is a structural property of vector search, not a
  defect of OpenAI specifically. Mitigation: provenance + the documented
  re-embedding playbook (R-11 in `brief.md`).
- **Deprecation risk** (Risk R-11): OpenAI EOL'd `text-embedding-ada-002`
  in 2024-25 with ~12 months notice; `text-embedding-3-small` will
  eventually face the same fate. Mitigation: stamped provenance per row;
  documented migration playbook; alerts on deprecation announcements. The
  cost to re-embed 1M questions on a replacement model is ~$6 — trivially
  absorbed.
- **Not domain-specific**: BioBERT / ClinicalBERT / MedCPT are trained on
  medical corpora and *may* outperform `text-embedding-3-small` on clinical
  vocabulary. We don't have empirical evidence for this at PoC scope, and
  the operational cost of self-hosting (a model server, a model file, a
  GPU instance) is real. The hybrid design (lexical + semantic) shifts the
  burden of medical-specific precision onto the lexical leg, where
  `tsvector` plus medical-keyword extraction (US-02) lands it well.
- **Fixed 1536 dimensions** (no `dimensions` parameter): unlike
  `text-embedding-3-large`, the `small` model doesn't support truncation
  to fewer dimensions. We pay the full 1536 storage cost. At 1M corpus
  scale (29 GB total per §4.5 of `brief.md`) this is fine; at 10M it
  starts to argue for `large` with truncated dimensions OR the M3 move to
  OpenSearch where dimension management is more flexible.

## Alternatives considered

- **`text-embedding-3-large` (3072 dim)** (rejected for PoC): 6.5× the
  per-call cost and 2× the storage. Worth it *only* if we have evidence
  the small model misses medical content. We don't have that evidence at
  PoC scope. The hybrid design covers the gap. Re-evaluated at M2+ if
  KPI #3 stalls and semantic-leg recall is the bottleneck.

- **`text-embedding-ada-002`** (rejected): deprecated; using it would buy
  a forced migration in the near future. No upside.

- **Sentence-transformers `all-MiniLM-L6-v2` (384 dim, self-hosted)**
  (rejected for PoC, viable later): free per-call (no API spend); requires
  hosting a model server. At PoC scope, the operational complexity (a
  Python service, a Docker image, GPU/CPU sizing) is not worth the API
  cost saved (~$6 at 1M scale). Becomes more attractive at M3+ if API
  costs become a real budget line — but even then, the comparison is "$6
  for 1M questions vs a model server we have to operate", and the math
  rarely favors self-hosting at this scale.

- **Cohere `embed-english-v3.0` (1024 dim)** (rejected for PoC): adds a
  second vendor (second API key, second rate-limit, second SLA, second
  privacy posture). Quality is competitive but the *operational* cost of
  multi-vendor is real. Re-evaluated if OpenAI deprecates or if
  evaluation shows Cohere materially outperforms on medical content.

- **Domain-specific medical embeddings (BioBERT / ClinicalBERT / MedCPT)**
  (rejected for PoC): potentially higher quality on medical vocabulary;
  self-hosted (~2-4 GB model files; GPU recommended for low latency);
  operational complexity is substantial. The cost-benefit at PoC scope is
  clearly against. At M3+ this becomes the natural "if KPI #3 is stalling
  on medical-specific edge cases, try a domain model" experiment, and the
  hybrid design + provenance makes the migration tractable.

## Migration path (if we need to change embedding model)

The corpus-re-embed playbook is the same shape as the prompt-v1→v2
migration playbook (Expansion E §5), applied to the `embedding` column:

1. **Stage 0**: pin the new embedding model in code; set
   `embedding_model = "v2-model-id"` on new ingests.
2. **Stage 1 (shadow eval)**: run the new model against ~30 hand-labeled
   retrieval queries; compute top-3 relevance against the labeled set.
   Gate: ≥3pp improvement or measurably lower cost.
3. **Stage 2 (coexistence)**: not possible for embeddings (unlike
   prompt-versioning). Embeddings from different models are not
   comparable; the read path can only query one model's vector space at
   a time. So we go directly to stage 3.
4. **Stage 3 (drain)**: a background job re-embeds every row with the
   new model. Updates `embedding` and `embedding_model` in place.
   Rate-limit aware. Persists progress. At ~$0.02/1M tokens and 1M
   questions × 300 tokens, this costs ~$6 and takes a few hours.
5. **Stage 4 (validate)**: KPI #3 measured on the labeled retrieval set.
   If it regresses, freeze writes, re-embed back to v1 (the v1 model is
   still in the OpenAI catalog at this point).
6. **Stage 5 (flip)**: read path is implicitly flipped because every row
   has the new vector. The HNSW index needs to be **rebuilt** (Risk R-07)
   because the underlying vectors changed. Use `CREATE INDEX CONCURRENTLY`
   on a side index, swap names atomically.

This migration is **not free** — it costs ~$6 plus a HNSW rebuild plus
operational attention for the validation window. It is, however,
**tractable**: every step is named, every cost is sized, every gate is
objective. Risk R-11 is named in `brief.md` for this reason.

## References

- DISCUSS System Constraints in `docs/feature/hybrid-search-medical-questions/feature-delta.md`
- `docs/feature/hybrid-search-medical-questions/expansions/E-cost-and-reenrichment.md` §1 (per-call cost)
- `docs/feature/hybrid-search-medical-questions/expansions/E-cost-and-reenrichment.md` §5 (migration playbook shape)
- `docs/product/architecture/brief.md` §4.5 (storage estimates), §7 (Risk R-11)
- ADR-001 (the search backend that hosts these embeddings)
