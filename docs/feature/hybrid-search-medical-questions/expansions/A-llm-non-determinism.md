<!-- markdownlint-disable MD024 MD013 -->
# Expansion A — LLM non-determinism deep dive `[WHY]`

**Parent**: `feature-delta.md` (US-02 LLM resilience; US-03 observability; System Constraints).
**Wave**: DISCUSS Tier-2 expansion.
**Density**: lean + ask-intelligent.
**Purpose**: defend the staff-level reasoning behind how this pipeline contains LLM non-determinism, so the design discussion of US-02 / US-03 is substantive rather than templated.

This expansion does NOT introduce new requirements. It articulates the *why* behind the resilience policy already locked in `feature-delta.md` and points at the implementation sketch DESIGN/DELIVER will extend.

---

## 1. What "non-determinism" actually means here

When the slice brief and `feature-delta.md` say "LLM responses sometimes fail schema validation in roughly 5-15% of cases", that single number hides at least seven *kinds* of failure, and they need different containment strategies. The single biggest mistake a junior implementation makes is treating them as one bucket and throwing a generic `retry(3)` at all of them.

### Failure taxonomy

| # | Failure kind | Example signature | Detected by |
|---|---|---|---|
| F1 | **Invalid JSON** (parse-level) | Truncated output mid-string, unescaped quote inside a string, trailing comma | `JSON.parse` throws before Zod even runs |
| F2 | **Schema mismatch** (shape) | Missing required field, extra unknown field with `.strict()`, wrong type (`bloom_level: 3` instead of `"application"`) | `z.parse` returns issues array |
| F3 | **Hallucinated enum value** | `"bloom_level": "applying"` instead of `"application"`; `"bloom_level": "intermediate"` (not in our enum at all) | `z.enum(...)` refinement |
| F4 | **Off-by-one cognitive level** | `"bloom_level": "analysis"` for a pure recall question; the JSON is shape-valid but semantically wrong | NOT caught by schema — requires eval set or human spot-check |
| F5 | **Empty / ambiguous keyword arrays** | `"keywords": []` or `"keywords": ["heart"]` (too sparse to be useful for lexical match) | `z.array(z.string()).min(3).max(10)` refinement |
| F6 | **Partial completion** (truncation) | Response cut off because `max_tokens` was too low or the connection dropped; JSON ends mid-object | Either F1 (parse-level) or `finish_reason !== "stop"` from the API metadata |
| F7 | **Refusal / safety response** | `"I cannot provide medical advice..."` — the model refused to enrich for safety reasons | `finish_reason === "content_filter"` or no JSON at all |

**Why this matters**: F1 / F2 / F3 / F5 / F6 are *recoverable by retry with feedback*. F4 is *not detectable at the schema layer at all* — it requires an out-of-band eval and is what US-03's `first-try-pass rate` plus `prompt_version` provenance let us catch over time. F7 is *not retryable* — retrying a refusal usually produces another refusal; this is a quarantine-first situation.

A one-bucket retry policy collapses these into noise. A taxonomy-aware policy lets us reason about retry budget separately from validation rate, which is exactly what US-02 and US-03 separate.

### What this implies in design discussions

When asked "what's your retry policy", the answer is not "two retries with exponential backoff". The answer is "three retry regimes — schema-retry for F1/F2/F3/F5/F6, transport-retry for 429/5xx/network, no-retry-quarantine for F7 — and the schema-retry budget is independent of the transport-retry budget" (this is why `feature-delta.md` US-02 AC explicitly says "Transient errors (429, 5xx, network) are retried separately from schema-retry budget").

---

## 2. Containment layers (defense in depth)

The pipeline holds five layers between an LLM call and a write to `enriched_questions`. None of them is sufficient alone.

```text
                +-------------------------------------------------+
                |  Prompt-side: schema in prompt, few-shot,       |
                |  temperature 0, model selection                  |
                +-------------------------------------------------+
                                  |
                                  v
                +-------------------------------------------------+
                |  Transport-side: OpenAI Structured Outputs       |
                |  (response_format = json_schema, strict: true)  |
                +-------------------------------------------------+
                                  |
                                  v
                +-------------------------------------------------+
                |  Validation-side: Zod parse (strict mode,        |
                |  refinements on enums + bounded arrays)         |
                +-------------------------------------------------+
                                  |
                                  v
                +-------------------------------------------------+
                |  Recovery-side: bounded retry with feedback     |
                |  ("your previous output failed because X")      |
                +-------------------------------------------------+
                                  |
                                  v
                +-------------------------------------------------+
                |  Quarantine-side: after N schema retries,       |
                |  park in `quarantine` table for human triage    |
                +-------------------------------------------------+
                                  |
                                  v
                       enriched_questions table
                           (only valid rows)
```

### Layer 1: Prompt-side

- **Schema in the prompt body**: even when using OpenAI Structured Outputs, restate the schema and the enum values in plain text inside the system prompt. The model needs to *see* the enum to align its sampling. This is empirically what reduces F3 (enum near-misses).
- **Few-shot exemplars**: 2-3 worked examples of `{question -> enriched JSON}` pairs covering different specialties (cardio, endocrine, neuro) and different Bloom levels. Place them in the system prompt, not the user message; this keeps the user message clean for batched ingestion.
- **Temperature 0 for enrichment**: enrichment is not creative writing; it is classification + extraction. `temperature = 0` is correct here. The natural pushback — "isn't temperature 0 deterministic?" — gets the honest answer: "no, OpenAI's `temperature=0` is *low-entropy*, not deterministic; backend nondeterminism (model versioning, MoE routing, KV cache behavior) means identical inputs can produce different outputs across calls. This is precisely why we still need Zod and quarantine."
- **Model selection rationale**: `gpt-4o-mini` for enrichment. Cheap enough to be defensible at scale (see Expansion E), capable enough for structured medical classification when paired with Structured Outputs + few-shot. If we observe sustained F4 (off-by-one Bloom) rates above some threshold (say 15%), the lever is to upgrade the *enrichment* model to `gpt-4o`, NOT to add more retries — because F4 is not retryable.

### Layer 2: Transport-side

OpenAI Structured Outputs with `response_format: { type: "json_schema", json_schema: { name, schema, strict: true } }`. This is the single biggest reduction in F1 (parse-level invalid JSON) — the model is constrained at decoding time to emit only JSON that matches the supplied schema.

**But it is not sufficient.** Three reasons:

1. Structured Outputs does not constrain enum *values* if the field is `type: string` in the JSON Schema. Even with `enum: ["remember", "understand", "apply", "analyze", "evaluate", "create"]`, the model can still emit `"applying"` under some conditions (especially with sparse few-shot coverage). We've observed this in similar pipelines.
2. Structured Outputs has its own failure modes: the API can return `finish_reason: "length"` with a truncated valid-prefix that still passes JSON Schema strict mode if the cut happens at a safe boundary, BUT is semantically empty.
3. Refusals (F7) bypass Structured Outputs entirely — `finish_reason: "content_filter"` produces no JSON.

So Structured Outputs is necessary but not sufficient. Zod is still mandatory. This is the answer to the predictable interview question "why both?".

### Layer 3: Validation-side

Zod with `.strict()` and refinements. The Zod sketch DESIGN/DELIVER will extend looks like:

```ts
// Sketch only — DESIGN wave ratifies the exact enum cardinality (see feature-delta.md
// DESIGN-wave open issue #2: 3-level vs 6-level Bloom).
import { z } from "zod";

const BloomLevel = z.enum([
  "remember", "understand", "apply", "analyze", "evaluate", "create"
]);

export const EnrichmentSchema = z.object({
  bloom_level: BloomLevel,
  keywords: z.array(z.string().min(2).max(60)).min(3).max(10),
  medical_specialty: z.string().min(2).max(80),
  rationale: z.string().min(20).max(500).optional(),
}).strict();
// .strict() rejects extra fields — important because hallucinated extra fields
// are a signal of prompt drift, not a benign addition.

export type Enrichment = z.infer<typeof EnrichmentSchema>;
```

Why each refinement matters:

- `z.enum(...)` catches F3 (enum near-misses like `"applying"`). The error message from Zod is then *fed back into the retry prompt* (Layer 4).
- `keywords` bounded `min(3).max(10)` catches F5 (sparse arrays). 3 is the lower bound for "useful for lexical leg in hybrid search"; 10 is the upper bound for "not a keyword stuffing attempt".
- `.strict()` catches the "hallucinated extra field" case that is otherwise invisible (the row would write fine but the schema would drift silently).
- `rationale` is optional — it's a debug aid, not a hard requirement. Optionality here is intentional: requiring it raises the surface area for failure without raising quality.

### Layer 4: Recovery-side (bounded retry with feedback)

On Zod parse failure, the retry prompt is NOT "try again". It is "your previous output failed validation because <Zod issue path + message>. Please return a corrected JSON object matching the schema." This *feedback retry* is empirically more effective than blind retry — the model has the error in context and can self-correct.

Retry budget: default 2 (per US-02 AC). Exponential backoff (1s, 2s) to avoid hammering the API on systemic issues.

**Critically**: this is the *schema-retry* budget. The *transport-retry* budget for 429 / 5xx / network errors is separate and uses its own backoff (and does not consume the schema-retry budget). This separation is the single most important policy decision in the pipeline — see the decision matrix in Section 3.

### Layer 5: Quarantine-side

After exhausting the schema-retry budget, the record is parked in `quarantine`. This table preserves:

- `source_question_id`
- `batch_id`
- `raw_responses` (array — one per attempt, including the original and each retry)
- `parse_errors` (array — one per attempt)
- `quarantined_at`
- `prompt_version`, `model` (provenance — see Section 4)

Quarantine is **not a retry queue**. It is a **triage queue inspected by a human**. The default expectation is: someone reads the raw output, decides whether to fix the prompt and re-enrich the batch, or whether the source question itself is malformed.

Why this is the right shape: dropping the record silently means data loss with no audit trail. Writing partial data to `enriched_questions` corrupts downstream search. Quarantine is the only path that preserves both the data and the auditability.

---

## 3. Decision matrix: retry vs. quarantine vs. accept-with-warning

Per failure kind, the policy is not uniform. This table is what defends US-02's design.

| Failure kind | Detection layer | Retry? | If retry exhausted | Notes |
|---|---|---|---|---|
| F1 — invalid JSON | Layer 2 / 3 (parse) | Yes (schema budget) | Quarantine | Structured Outputs makes this rare; if it persists, prompt is broken — quarantine and inspect |
| F2 — shape mismatch | Layer 3 (Zod) | Yes (schema budget, with feedback) | Quarantine | Feedback retry is most effective here |
| F3 — hallucinated enum | Layer 3 (Zod refinement) | Yes (schema budget, with feedback) | Quarantine | If F3 rate persists across many records, upgrade few-shot exemplars in prompt before bumping retry budget |
| F4 — off-by-one Bloom | Out-of-band eval only | **No — cannot detect at write time** | n/a — surfaces in eval | This is the case for US-03's `first-try-pass rate` over time + prompt_version provenance |
| F5 — sparse keywords | Layer 3 (Zod refinement) | Yes (schema budget) | Quarantine | A retry usually fixes this — the model adds more keywords |
| F6 — truncation | Layer 2 (finish_reason) or Layer 3 (parse) | Yes (and bump `max_tokens` if seen repeatedly) | Quarantine | If chronic, the prompt is producing too-long completions — re-engineer |
| F7 — refusal | Layer 2 (finish_reason: content_filter) | **No** | **Quarantine immediately** | Retrying a refusal is wasted spend; flag for human review of the source content |
| Transport: 429 | API response | Yes (transport budget, separate) | Surface as run error | NOT counted against schema-retry budget — this is US-02 AC #3 |
| Transport: 5xx / network | API response | Yes (transport budget, separate) | Surface as run error | Same |

**Headline rule**: never let a *schema* retry budget be consumed by a *transport* failure. They are different problems with different upper bounds (transport retries can be larger because they're cheap; schema retries cost real tokens and time).

### What "accept with warning" looks like

There is one case where we accept-with-warning rather than quarantine: when the *rationale* field is omitted but all required fields parse cleanly. `rationale` is optional and informational. We log the omission to the run record but write the row. This is the only accept-with-warning case in the PoC — the temptation to add more is high and should be resisted, because "we accepted X anyway" is how schema drift starts.

---

## 4. Prompt versioning as a first-class artifact

Every enriched row carries `prompt_version`, `model`, `model_temperature`, `embedding_model`, `enriched_at`. This is mandated by `feature-delta.md` System Constraints ("Provenance is mandatory"). The non-obvious payoff is *re-enrichment as migration*.

### The pattern

When the prompt changes (let's call the new version `v2`), we don't blow away the old data. Instead:

1. The new ingestion pipeline writes rows with `prompt_version: "v2"`.
2. Existing rows still have `prompt_version: "v1"` and continue to serve search queries.
3. A re-enrichment job queries `SELECT * FROM enriched_questions WHERE prompt_version < 'v2'`, re-enriches each, and updates the row in place (or writes to a side table for spot-check before flipping over — see Expansion E).
4. Search continues during re-enrichment; the corpus is never inconsistent because every row has a valid `prompt_version` value.

This is the answer to US-02's AC about traceability: traceability is not a forensic feature, it's the *operating mechanism* for prompt evolution. Without it, every prompt change is an "all-or-nothing reflood the corpus" operation.

### Why `model_temperature` is on the row

It costs almost nothing to store, and it disambiguates the cause of an observed regression in eval scores: "did the prompt change cause the regression, or did the temperature drift because someone set it via env var in CI?". For the cost of one float per row, we eliminate a future debugging dead-end.

---

## 5. Schema evolution: changing the Bloom enum without breaking the corpus

Suppose DESIGN ratifies the 3-level subset (`recall | application | analysis`) for PoC, and after Release 2 we want to expand to the full 6-level Bloom 2001 taxonomy (`remember | understand | apply | analyze | evaluate | create`). How does this not break already-indexed data?

### Lazy re-enrichment + dual-read window

Stage 1 — additive change. New schema accepts both old (3-level) and new (6-level) values during a dual-read window. The DB column type is `text` (or a Postgres enum that has been `ALTER TYPE ... ADD VALUE` to add the new values — Postgres enums are append-only at the type level). The Zod schema is widened to `z.union([Bloom3, Bloom6])` for the read path.

Stage 2 — re-enrichment. Background job re-enriches all `prompt_version: "v1"` rows with the new prompt (which produces 6-level outputs). Writes back with `prompt_version: "v2"`. Application code reads both during this window — old rows render their 3-level value, new rows render the 6-level value, both are valid.

Stage 3 — flip read mode. Once re-enrichment completes for >99% of the corpus, the read path narrows to 6-level only. Stragglers either get a final batch re-enrichment or get quarantined for inspection. The 3-level rows are gone.

Stage 4 — drop legacy enum values. `ALTER TYPE ... RENAME VALUE` (Postgres 12+) or recreate the column type. This is the only destructive step and it happens after the corpus has been validated 6-level-only.

The honest answer is: "we never do a flag-day cutover on the corpus; every schema change is a multi-stage migration with a dual-read window. The `prompt_version` column makes this safe."

### Why this isn't over-engineered for a PoC

It isn't *built* in the PoC. The PoC stores `prompt_version` on every row and stops there. The expansion shows the path is clear; DESIGN can decide whether to put any of stages 1-4 into Release 3+. The point is to demonstrate the foundation is migration-ready, not migration-implemented.

---

## 6. Observability hooks tying back to US-03

The metrics already in `feature-delta.md` US-03 are the right metrics for non-determinism observability — they just need to be sliced correctly. The non-obvious dimension is *slicing by `prompt_version`*.

### Metrics that matter

| Metric | What it tells us | Slice by |
|---|---|---|
| First-try validation rate | Are most LLM calls passing Zod on attempt 1? | `prompt_version`, `model`, `medical_specialty` |
| Retry count distribution | If a record was enriched, how many tries did it take? | `prompt_version` (regression detector) |
| Quarantine rate | What fraction of records are unrecoverable? | `prompt_version`, `medical_specialty` (specialty-specific failure?) |
| `finish_reason` distribution | Are we seeing more `content_filter` or `length` than expected? | `prompt_version`, `model` |
| Latency p50 / p95 | Is the LLM getting slower? | `model` (across model upgrades) |
| Cost per question | Is the spend stable? | `model`, `prompt_version` |

### The single most valuable view

Before/after view across a prompt version change:

```text
prompt_version  | first_try | retry_rate | quarantine | cost_per_q | f4_eval (manual)
v1              | 87.3%     | 9.4%       | 3.3%       | $0.0084    | 78% accurate
v2              | 92.1%     | 6.8%       | 1.1%       | $0.0086    | 84% accurate
```

If this view exists, the rollout/rollback decision is data-driven, not vibes-driven. The PoC doesn't build a dashboard, but `logs/runs/{batch_id}.json` (US-03 AC #4) already contains the data; `jq` over the runs directory is the PoC-grade BI tool (US-03 Domain Example 1 already implies this with the latency-regression detection scenario).

---

## 7. Reference Zod sketch (extending Section 2)

This is the implementation seed. DESIGN/DELIVER extends it; this expansion just commits to the shape.

```ts
// File expected: src/schemas/enrichment.ts (DESIGN to confirm path)
import { z } from "zod";

// Bloom enum: DESIGN-wave open issue #2. PoC may ship the 3-level subset
// behind a feature flag. The 6-level shape is shown here as the upgrade target.
export const BloomLevelFull = z.enum([
  "remember", "understand", "apply", "analyze", "evaluate", "create"
]);

export const BloomLevelPoC = z.enum([
  "recall", "application", "analysis"
]);

// During the dual-read window (see Section 5), the read schema is a union.
export const BloomLevelRead = z.union([BloomLevelFull, BloomLevelPoC]);

export const EnrichmentSchema = z.object({
  bloom_level: BloomLevelFull, // write path uses full; flag-controlled
  keywords: z.array(z.string().min(2).max(60)).min(3).max(10),
  medical_specialty: z.string().min(2).max(80),
  rationale: z.string().min(20).max(500).optional(),
}).strict();

export type Enrichment = z.infer<typeof EnrichmentSchema>;

// Provenance schema — written to every row alongside the enrichment.
// This is what makes Section 4 + Section 5 work.
export const ProvenanceSchema = z.object({
  prompt_version: z.string().regex(/^v\d+(\.\d+)?$/),
  model: z.string(),
  model_temperature: z.number().min(0).max(2),
  embedding_model: z.string(),
  enriched_at: z.string().datetime(),
  retry_count: z.number().int().min(0).max(5),
});

export type Provenance = z.infer<typeof ProvenanceSchema>;

// Quarantine row shape (separate table; see US-02).
export const QuarantineRowSchema = z.object({
  source_question_id: z.string(),
  batch_id: z.string().uuid(),
  raw_responses: z.array(z.string()).min(1),
  parse_errors: z.array(z.string()).min(1),
  prompt_version: z.string(),
  model: z.string(),
  quarantined_at: z.string().datetime(),
});
```

What's intentionally *not* in this sketch and belongs to DESIGN:

- The exact retry-with-feedback prompt template (DESIGN ratifies the wording).
- Whether `prompt_version` is a string or a semver-shaped object.
- Whether the dual-read union schema is exposed to consumers or wrapped behind a `normalizeBloom(level)` helper.

---

## 8. Stakeholder talking points

These are the questions a stakeholder is most likely to ask. Each gets a one-paragraph answer that traces back to the artifact above.

### Q1: "Why not pure JSON mode without Structured Outputs?"

Pure JSON mode constrains the *format* (valid JSON) but not the *shape*. The model can return `{"foo": "bar"}` and pass JSON mode. Structured Outputs adds schema constraint at decode time, which collapses F1 (invalid JSON) and most of F2 (shape mismatch) into near-zero rates. We still run Zod on top because Structured Outputs does not enforce enum *values* reliably (F3) and does not catch refusals (F7) or truncations (F6 cases where the cut is at a "legal" boundary). The combination is correct; using either alone is not.

### Q2: "What happens at scale when retries spike?"

Two things have to happen. First, the *schema-retry budget* is fixed at 2 per record — so a retry spike doesn't fan out unboundedly per record; the worst case per record is 3 LLM calls (initial + 2 retries) before quarantine. Second, the *transport-retry budget* is separate and uses its own backoff with a higher ceiling, but the same per-record bounded shape. Aggregate spend during a retry spike is therefore bounded by `batch_size × (1 + max_schema_retries + max_transport_retries)`, which is `batch_size × 6` worst case. US-03's cost report surfaces this in real time. If spend exceeds the per-run budget cap (see Expansion E), the run aborts rather than burning the bill. The systemic answer to chronic retry spikes is *prompt revision*, not *more retries*; the metrics in Section 6 sliced by `prompt_version` make this obvious to the operator.

### Q3: "How do you A/B prompts?"

We don't, in the PoC — there's no harness for it. But the *foundation* for A/B is in place: every row has `prompt_version` provenance. The path is: enrich half of a representative seed batch with `prompt_v1`, half with `prompt_v2`, compute first-try-pass rate / quarantine rate / cost / eval-set accuracy for each, choose the winner. The hard part — provenance — is already done. The easy part — splitting traffic — is one shell loop. For production we'd want a proper experimentation harness, but the data shape is correct for it.

### Q4: "What if OpenAI changes the model behind `gpt-4o-mini` without telling us?"

This happens, and it's the strongest argument for the metrics in Section 6 sliced by `model` + `prompt_version`. The signal would be: first-try-pass rate drops on the *same prompt_version* across the *same model alias*. The mitigation is two-layered: (1) detection — US-03's run record makes the regression visible within one batch; (2) rollback — we pin `model` to a specific snapshot ID (`gpt-4o-mini-2024-07-18` rather than `gpt-4o-mini`) once we've validated a prompt against it. Pinning to a snapshot is a one-line config change; the cost is we have to opt into upgrades explicitly, which is the correct tradeoff for medical content.

### Q5: "How do you know the Bloom labels are actually right? Zod can't tell you that."

Correct — Zod validates *shape*, not *semantic correctness* (F4 in the taxonomy). The answer is a small labeled eval set: `data/seed-queries.json` for retrieval relevance (already in `feature-delta.md` US-04 KPI #3) plus a `data/bloom-eval.json` with ~30 questions hand-labeled by a medical educator (per the curriculum-designer persona — see Expansion C). The eval runs out-of-band, once per prompt change. Target ≥ 85% agreement with the hand labels (this matches the desired outcome in `jobs.yaml` under `calibrate-cognitive-difficulty`). For the M0 demo, the smaller seed eval is sufficient; for production we'd want a continuous eval pipeline. The honest framing: "Zod prevents bad data; the eval set prevents wrong data; they're complementary."

---

## 9. What DESIGN inherits from this expansion

1. **The taxonomy in Section 1** as the failure model — design the retry handler around it, not around a single retry budget.
2. **The five containment layers in Section 2** as the boundary structure — each layer is independently testable.
3. **The decision matrix in Section 3** as the policy table — encode it in code, do not let it drift into tribal knowledge.
4. **The Zod sketch in Section 7** as the seed implementation.
5. **The metrics in Section 6** as the observability contract — the metrics already in US-03 are correct; what this expansion adds is the *slicing* dimensions (`prompt_version`, `model`, `medical_specialty`).

What this expansion does NOT do (still belongs to DESIGN/DELIVER):

- Choose the exact retry-with-feedback prompt wording.
- Decide whether the dual-read union schema is exposed or hidden.
- Decide on snapshot-pinning the model in the PoC vs. accepting the floating alias.
- Build the eval harness (`data/bloom-eval.json` is a recommendation, not a deliverable for DISCUSS).

---

## Changelog

| Date | Change |
|---|---|
| 2026-05-13 | Initial Tier-2 expansion. Failure taxonomy (F1-F7), 5-layer defense, decision matrix, prompt versioning, schema evolution, stakeholder talking points. |
