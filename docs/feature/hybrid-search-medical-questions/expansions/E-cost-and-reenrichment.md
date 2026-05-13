<!-- markdownlint-disable MD024 MD013 -->
# Expansion E — Cost model and re-enrichment policy `[HOW]`

**Parent**: `feature-delta.md` (US-02 LLM resilience; US-03 observability; System Constraints; KPI #7 cost-per-1k).
**Wave**: DISCUSS Tier-2 expansion.
**Density**: lean + ask-intelligent.
**Purpose**: produce defensible cost numbers for the PoC and show the re-enrichment migration shape, so the "this scales" discussion in the interview has actual numbers behind it.

This expansion does NOT add new requirements. It puts numbers on the KPIs already in `feature-delta.md` (specifically KPI #7: "Cost per 1000 enriched questions stays within budget; estimate < $10/1k for gpt-4o-mini + text-embedding-3-small") and articulates the re-enrichment policy that the `prompt_version` column (System Constraints: "Provenance is mandatory") enables.

---

## 1. Per-question cost decomposition

A single enriched question consumes three priced operations against the OpenAI API:

| Op | Model | Input | Output | Pricing dimension |
|---|---|---|---|---|
| **Enrichment** | `gpt-4o-mini` | system prompt + few-shot exemplars + question (title + content + answers + explanation) | structured JSON (bloom_level, keywords, specialty, optional rationale) | input tokens × in-rate + output tokens × out-rate |
| **Embedding** | `text-embedding-3-small` | the searchable text blob (title + content + keywords) | 1536-dim vector | input tokens × embedding-rate |
| **(Chat at query time)** | `gpt-4o-mini` | system prompt + tool definitions + conversation history + tool results | streamed response | input tokens × in-rate + output tokens × out-rate |

For this expansion, "per-question cost" means **enrichment + embedding** (the two costs paid once at ingest). Chat cost is paid per-query and is borne by the searcher, not the corpus owner; we model that separately at the end.

### Token sizing for the PoC corpus

The sample questions in this domain (USMLE-style) have a typical shape. From inspection of the seed data referenced in `feature-delta.md` (`data/sample-questions.json`):

| Component | Tokens (est, p50) | Tokens (est, p90) |
|---|---|---|
| Question title | 8 | 14 |
| Question content (vignette) | 220 | 400 |
| Answer choices (5 options) | 60 | 110 |
| Explanation | 280 | 520 |
| **Per-question input subtotal** | **568** | **1,044** |
| System prompt (schema + few-shot, amortized per call) | 480 | 480 |
| Per-call total input (enrichment) | **~1,048** | **~1,524** |
| Per-call output (structured JSON: bloom + ~5 keywords + specialty + rationale) | **120** | **180** |
| Per-call total embedding input (title + content + keywords) | **300** | **520** |

These are honest estimates from the shape of board-exam questions in the public USMLE-style corpus. They are **assumed**; actual numbers should be verified against `data/sample-questions.json` once the seed data is finalized. I flag this explicitly because it materially affects every dollar figure below.

### Cost per question (worked, p50)

> Pricing as of 2026-05-13. Source: OpenAI pricing page for `gpt-4o-mini` and `text-embedding-3-small`. **These rates should be verified before any production commitment** — model pricing has shifted multiple times since 2024, and the assumed values here are: `gpt-4o-mini` input $0.15 / 1M tokens, output $0.60 / 1M tokens; `text-embedding-3-small` $0.02 / 1M tokens. If actual rates differ when verified, scale the totals linearly.

```text
Enrichment:
  input:   1048 tokens × $0.15 / 1M = $0.0001572
  output:   120 tokens × $0.60 / 1M = $0.0000720
  subtotal:                            $0.0002292

Embedding:
  input:    300 tokens × $0.02 / 1M = $0.0000060

Per-question total (p50, single attempt):  $0.000235
                                           ~~~~~~~~~~
                                           ~$0.00024
```

Cost per question p90 (one attempt, worst-case sizing):

```text
Enrichment:  1524 × 0.15/1M + 180 × 0.60/1M = $0.0003366
Embedding:    520 × 0.02/1M                  = $0.0000104
Per-question total (p90):                     $0.000347  (~$0.00035)
```

### Effective cost per question with retries factored in

Per the failure taxonomy in Expansion A and `feature-delta.md` US-02 KPI #2 (≥ 90% first-try OR after-retry; ≤ 2% quarantined):

Assumed distribution at steady state on a healthy `prompt_version`:

- 80% first-try success (1 enrichment call, 1 embedding call)
- 10% after-1-retry (2 enrichment calls, 1 embedding call)
- 8% after-2-retries (3 enrichment calls, 1 embedding call)
- 2% quarantined (3 enrichment calls, 0 embedding calls — quarantined records don't get embedded)

Weighted enrichment-attempts per ingested question:

```text
0.80 × 1 + 0.10 × 2 + 0.08 × 3 + 0.02 × 3 = 0.80 + 0.20 + 0.24 + 0.06 = 1.30
```

So effective cost per question (p50 sizing):

```text
Enrichment cost: $0.0002292 × 1.30        = $0.000298
Embedding cost:  $0.0000060 × 0.98 (only non-quarantined embed) = $0.0000059
Effective total per question (p50):        $0.000304
                                           ~~~~~~~~~
                                           ~$0.00030
```

This is the number that goes into the per-batch budget cap (Section 4).

---

## 2. Worked totals at scale

Three corpus sizes, three cost views.

| Corpus size | Embedding only (no enrichment) | Enrichment only (no embedding) | Both (effective, with retry factor) |
|---|---|---|---|
| 10,000 | $0.06 | $2.98 | $3.04 |
| 100,000 | $0.60 | $29.80 | $30.36 |
| 1,000,000 | $6.00 | $298.00 | $303.60 |

### What this number means at the staff-level discussion

- **Below $10/1k threshold (KPI #7)?** Yes — $3.04 per 1k is well under the $10/1k budget guardrail. Three things would push it over: (a) much longer questions (p90 sizing pushes per-question to $0.000347, still under $10/1k at $3.47/1k); (b) sustained 30%+ retry rate from a bad prompt (would roughly double effective enrichment cost, still under); (c) model upgrade to `gpt-4o` (roughly 25× pricier per token, would push per-1k to roughly $76 — at that point the model upgrade is a business decision, not an oversight).
- **PoC ingest cost** (10 questions, the seed batch): ~$0.003. Trivially absorbed by the take-home budget. The interview discussion isn't "can we afford the PoC?" — it's "how does this scale?"
- **10k-question milestone** (a reasonable single-content-pack size at a real medical-ed publisher): ~$3. This is the cost of one prompt-version migration on a real corpus. It is **affordable enough to re-enrich aggressively** when the prompt changes, which materially shapes the policy in Section 3.
- **1M-question milestone**: ~$300 to re-enrich the entire corpus. This is the largest single-pack cost we'd realistically see in this domain (publisher-scale). $300 is "operator approves the run, doesn't need a VP signoff". This shapes the policy too: even at the largest realistic scale, re-enrichment is not a budget-blocking event.

### What's NOT in these numbers

- **Chat (query-time) cost**: borne by the searcher, not the corpus owner. Rough sizing: ~2500 input tokens (system + tools + history) + ~250 output tokens streamed per turn = $0.000525 per turn at `gpt-4o-mini`. A 10-turn session is ~$0.005 per student per session. For a student using the tool every day for 6 weeks: ~$0.20 of API cost per student per exam cycle. Reasonable.
- **Postgres + pgvector hosting**: out of scope for the OpenAI bill; depends on infra choice.
- **Manpower to triage quarantine**: real but uncountable here.

---

## 3. Re-enrichment triggers

When do we re-enrich, and when is it optional?

| Trigger | Necessity | Action |
|---|---|---|
| **Prompt change** (wording, few-shot exemplars, schema instruction) | **Necessary** if the change is semantic (changes what `bloom_level` maps to); **optional** if cosmetic | Lazy re-enrichment of `prompt_version < new` rows |
| **Model upgrade** (e.g., `gpt-4o-mini-2024-07-18` → `gpt-4o-mini-2025-04-12`) | **Conditional** — depends on whether eval shows behavior drift on the same prompt | Spot-check 100 random rows; if eval delta > 3 percentage points, re-enrich |
| **Bloom enum change** (3-level → 6-level) | **Necessary** — old values don't map to new without recomputation | Dual-read window per Expansion A Section 5, then re-enrich |
| **Schema field addition** (new field like `medical_subspecialty`) | **Necessary** for that field; optional for other fields | Re-enrich to backfill the new field; existing fields stay intact |
| **Corpus drift detection** (eval set scores drop on unchanged prompt/model — usually indicates the underlying model's behavior has shifted) | **Necessary** if drop > 5 percentage points | Investigate first (could be eval-set rot); re-enrich if confirmed model drift |

The honest staff-level framing: re-enrichment policy is not "always re-enrich on every change". It's a decision tree gated on (a) is the change semantic? and (b) is the cost within budget? At $3 per 10k questions, the budget gate almost never blocks — but the *time* gate (re-enriching 100k questions takes ~30 minutes serially at typical OpenAI latency, in line with the `reprocess-when-prompts-change` desired outcome in `jobs.yaml`) does, and dictates the policy below.

---

## 4. Re-enrichment policy: full vs. lazy vs. lazy-on-query

Three policy shapes, recommendation, and rationale.

### Option A: Full re-enrichment

On any qualifying trigger, run a batch job that re-enriches every row. Atomic at the corpus level.

- **Pro**: Simple. Corpus is uniform at all times.
- **Con**: Even at $3/10k it's wasteful on rows that wouldn't change. Locks the corpus for the duration. Doesn't scale gracefully to multi-tenant scenarios.

### Option B: Lazy re-enrichment (recommended)

Mark rows with `needs_reenrichment = true` when the trigger qualifies. A background worker drains the queue. Application reads serve the *current* row while the queue drains (dual-read window per Expansion A Section 5).

- **Pro**: Bounded blast radius (only the affected rows get re-enriched). Queue-driven means rate-limit-friendly and resumable. Corpus is always queryable.
- **Con**: Corpus is non-uniform for the duration of the drain. Requires the read path to handle both old and new schema (which Expansion A Section 5 already establishes as the migration pattern).

### Option C: Lazy-on-query (also known as just-in-time)

Re-enrich a row only when it's hit by a query. No background worker.

- **Pro**: Zero wasted spend on never-queried rows.
- **Con**: Adds LLM latency to query path (catastrophic for the p95 < 800ms target in US-04). Cold rows stay stale forever — failure for the curriculum-designer's analytics use case (Expansion C), which depends on uniform Bloom labels across the corpus.

### Recommendation

**Option B (Lazy)** with a hard ceiling: `needs_reenrichment` rows must drain within 7 days. If the queue is not draining (e.g., ingestion is also competing for the same API quota), surface an alert. This matches the desired outcome in `jobs.yaml` `reprocess-when-prompts-change`: "Minimize the time to re-enrich a subset (target: replay a 1000-question batch in under 30 min)" — at typical OpenAI throughput, this is achievable.

The hard ceiling exists because a stale corpus is *worse* than the eventual-consistency window: if 30% of rows are on `prompt_version: v1` and 70% on `v2`, ranking quality drifts in unpredictable ways. The 7-day ceiling is a guardrail, not a SLA.

---

## 5. Migration playbook: prompt v1 → v2

The concrete operational playbook for the most common re-enrichment trigger.

### Stage 0: Prepare

- Define `prompt_v2` in `src/prompts/enrichment-v2.ts` alongside the existing `enrichment-v1.ts`. **Do not delete v1.**
- Update the pipeline config to emit `prompt_version: "v2"` on new rows.
- Eval set ready: `data/bloom-eval.json` with ~30 hand-labeled questions (recommended in Expansion A Section 8 / Q5).

### Stage 1: Shadow eval

- Run `prompt_v2` against the 30-question eval set. Compute:
  - First-try-pass rate (Section 6 of Expansion A).
  - Bloom-level agreement with hand labels.
  - Quarantine rate.
  - Cost per question.
- **Gate**: v2 must beat v1 on the eval set by at least 3 percentage points on Bloom agreement, OR show parity with measurably lower cost. If neither, do not proceed.

### Stage 2: Coexistence

- Production pipeline now emits `prompt_version: "v2"` for **new** ingests only. Existing rows remain on `v1`. Read path serves both — `EnrichmentSchema` (Expansion A Section 7) is widened to accept both Bloom enum shapes during this window.

### Stage 3: Spot-check N% on real production rows

- Re-enrich 5% of the v1 corpus (random sample) under `prompt_v2`. Compare row-by-row:
  - Cases where v2 changed the Bloom label.
  - Cases where v2 produced a quarantine event but v1 hadn't.
  - Cost delta on the sample.
- **Gate**: if >10% of Bloom labels flipped *and* the eval set didn't predict this, halt. Investigate prompt-eval-set mismatch before proceeding.

### Stage 4: Drain the queue

- Mark all remaining `prompt_version: "v1"` rows with `needs_reenrichment = true`.
- Background worker drains. Rate-limit aware. Persists progress every 100 rows so it's resumable.
- Run summary per drained batch (US-03 instrumentation already in place).

### Stage 5: Validate uniformity

- `SELECT COUNT(*) FROM enriched_questions WHERE prompt_version = 'v1'` should reach 0 (modulo a small tail of records that quarantine under v2 — those go to `quarantine` per US-02).
- Flip the read path to v2-only.
- Keep v1 prompt file in the repo for one release cycle in case rollback is needed.

### Rollback

If at any stage v2 is producing measurably worse outcomes (eval set drop, ranking regression in `KPI #3`):

- Revert the pipeline config to emit `prompt_version: "v1"`.
- Existing v2 rows can be re-enriched back to v1 (treat v2 → v1 as another migration; same playbook, opposite direction).
- The dual-read window has been maintaining v1-compatibility throughout, so the rollback is non-destructive.

### Why this playbook is staff-level

It treats prompt change as a **schema migration**, not a configuration change. The interview answer to "how do you change a prompt in production?" is "the same way I'd change a database schema: shadow, coexist, sample, drain, flip, retain rollback." This is the discipline `feature-delta.md` System Constraints implies but doesn't spell out.

---

## 6. Budget guardrails

The numbers in Section 2 are the steady-state. Guardrails protect against the non-steady-state.

### Per-run cost cap

`pnpm run ingest --file ... --max-cost 5.00` — the pipeline aborts mid-run if accumulated cost exceeds the cap. Default cap can be set in env (`INGEST_MAX_COST_USD=5.00`). Abort is graceful: writes the partial run record, surfaces the abort reason in stdout, leaves the corpus in a consistent state (no partial writes mid-question).

This is what justifies KPI #7 ("Cost per 1000 enriched questions stays within budget"): not a passive measurement, but an *active* limiter. The PoC implementation can be simple — compute running cost from the same per-call token usage already captured for US-03, compare against the cap before each next call.

### Daily token budget

For a production deployment (out of PoC scope, but the interview will ask): a daily token cap across all runs, tracked in Postgres. Alert at 80% utilization. Hard abort at 100%. This is the protection against the runaway-script failure mode (`feature-delta.md` Risk Register: "LLM cost spikes from accidental re-runs").

### Alert at 80%

For the PoC, "alert" is a stderr line in the run summary: `[WARN] This run consumed 82% of the configured cost cap.` In production, it's a metric on a dashboard with a real notification channel.

### Why this is in DISCUSS, not DESIGN

Because the AC in US-03 already mentions "Total cost reported per run, computed from token usage × pricing table" — the data is captured. The guardrail is a one-line policy: "if running total exceeds cap, abort." DESIGN ratifies the abort UX (CLI exit code, message format); DISCUSS commits to the *behavior*.

---

## 7. Production thinking: scaling to 10M questions

This section is for the inevitable "and how would you scale this?" question in the interview. The PoC does not build any of it.

### The shape of the change

At 10M questions, the steady-state effective cost is ~$3,036 for a full re-enrichment. That's no longer a "operator approves the run" cost — it's a budget line. Three architectural shifts become necessary:

1. **Batch API instead of per-call requests.** OpenAI's Batch API (50% discount on input/output) brings the 10M-question cost to ~$1,500. Latency goes from "per-call" to "24-hour async" — fine for re-enrichment, unacceptable for ingest of a single new question. So the pipeline branches: real-time path for `ingest:one`, batch path for `ingest:bulk`.
2. **Async fan-out via a real queue.** PoC's `for question of batch` loop becomes a producer that writes to a queue (SQS, Redis Streams, whatever the platform standardizes on). Multiple consumer workers drain. Each consumer applies its own retry/quarantine policy. Quarantine table is the central deadletter.
3. **Eventual consistency in the read path.** With 10M questions and a drain rate of (say) 1000 questions/minute, a full re-enrichment takes 7 days. The dual-read window from Section 5 becomes a *normal operating mode*, not a transient one. The application's read path must always handle the union schema; the "flip to v2-only" stage never happens for the global corpus, only for tenants/packs that have fully drained.

### What does NOT change

- The Zod schema. Same one.
- The provenance columns (`prompt_version`, `model`, etc.). Same ones, more important than ever.
- The decision matrix from Expansion A Section 3. Same one, just applied per-worker.
- The metrics in US-03. Same ones, aggregated across workers instead of being run-local.

### Why this matters for the PoC discussion

The shape of the PoC is *aligned* with the production shape. We don't have to throw away anything to scale up — we add a queue layer, swap real-time for batch when latency permits, and let the existing schema/provenance/metrics carry through. The honest interview framing: "the PoC is the inner loop; production wraps an outer loop around it without redesigning the inner one."

---

## 8. What DESIGN inherits from this expansion

1. **The per-question cost number (~$0.00030 effective)** as the planning constant for ingestion budgets.
2. **The recommended Option B (lazy) re-enrichment policy** with a 7-day drain ceiling and `needs_reenrichment` flag column on `enriched_questions`.
3. **The 5-stage migration playbook (Section 5)** as the operational discipline for prompt changes.
4. **The per-run cost cap** as a hard requirement on US-03's run loop (one line of policy, materially derisks the runaway-script failure mode in the Risk Register).
5. **The shape of the production scale-up (Section 7)** as the "we know how this scales" answer, not as PoC scope.

What this expansion does NOT do:

- Verify the actual OpenAI pricing as of 2026-05-13 (stated as **assumed**; the operator running the PoC should sanity-check against the OpenAI billing page before the interview demo).
- Decide whether `needs_reenrichment` is a boolean or an enum (`pending`, `in_progress`, `failed`). DESIGN's call.
- Implement the queue infrastructure for Section 7. Explicitly out of PoC scope.

---

## Changelog

| Date | Change |
|---|---|
| 2026-05-13 | Initial Tier-2 expansion. Per-question cost decomposition, scale totals (10k/100k/1M), re-enrichment triggers + policy, prompt migration playbook, budget guardrails, production scale-up shape. |
