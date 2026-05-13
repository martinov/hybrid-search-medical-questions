<!-- markdownlint-disable MD024 MD013 -->
# Expansion C — Curriculum-designer analytics roadmap `[HOW]`

**Parent**: `feature-delta.md` (tertiary persona reference; `analyze-bloom-distribution` job; Bloom-level enrichment justification).
**Wave**: DISCUSS Tier-2 expansion.
**Density**: lean + ask-intelligent.
**Purpose**: defend the staff-level argument that the Bloom-level enrichment is a *platform investment*, not a *feature*, by showing how the same enrichment data unlocks the curriculum-designer's analytics job once the PoC ships.

This expansion does NOT add PoC scope. It shows the future surface that the PoC enables.

---

## 1. The future-state user

Dr. Maria Lourdes Santos, MD, MEd. Curriculum lead at a medical school. Her job, in her own vocabulary from [`docs/product/personas/curriculum-designer.md`](../../../product/personas/curriculum-designer.md):

> *"Cardiology has 200 questions but 90% are recall-level — we need analysis-level coverage."*

The frustration she lives with today: vendor question banks expose totals and topic counts but **not cognitive-level distribution**. So her job — identifying gaps where students lack practice at the right cognitive level — is reduced to manual inspection of question samples. She is the user whose work the existing tooling silently fails.

Quoted from her persona file: *"Reviews aggregate metrics weekly; commissions new content quarterly. NOT a daily user of the search tool."* This is important — she is not the persona who opens the chat UI. Her access pattern is a weekly aggregate view, not an interactive search. The implication is that the surface she needs is **reporting**, not retrieval, and the data shape must support aggregation.

---

## 2. The job, scored

From [`docs/product/jobs.yaml`](../../../product/jobs.yaml) (id `analyze-bloom-distribution`):

> *When I review a question bank for curriculum alignment, I want to see how questions distribute across Bloom's taxonomy levels per topic, so I can identify gaps where students lack practice at the right cognitive level.*

- **Opportunity score**: 8 (importance 6 + (6 − 4)). Under-served but lower urgency for the PoC.
- **Explicitly out of PoC scope** per the job's `notes` field: *"Out of scope for PoC walking skeleton and Release 1. The Bloom-level field on enriched records is the foundation; analytics views are a future slice."*
- **Strategic role**: justifies investing in *structured* Bloom enrichment now even though only the searcher persona uses it in PoC.

The staff-level framing: opportunity score 8 is not "ignore". It is "do not build the UI now, but **do not undermine the data foundation** that makes it possible later." Cutting the Bloom enrichment to save 4 hours of PoC effort would destroy this job. Keeping it costs nothing extra at PoC time (because the searcher persona also depends on `bloom_level` per US-05) but preserves the option.

---

## 3. Analytics views she'd want (once unlocked)

| View | What it shows | Why it matters |
|---|---|---|
| **Bloom distribution per content pack** | For each pack (e.g., "USMLE Step 1 Cardiology"): histogram of questions by Bloom level | Direct answer to her quoted frustration ("90% recall-level"). One-glance gap identification. |
| **Gap heatmap (specialty × Bloom × question count)** | 2D matrix: rows = specialty, columns = Bloom level, cells = question count + color intensity | Cross-pack gap detection. "Endocrinology Application is weak across the corpus" jumps out. |
| **Drift over time** | Time series: Bloom-distribution-per-pack, plotted weekly | Detects prompt-version regression (Expansion A Section 4): "did the new enrichment prompt accidentally rebalance the labels?" |
| **Low-Bloom-coverage alerts** | Automated alert when any (specialty, Bloom) cell falls below a configured threshold (e.g., "fewer than 10 analysis-level questions in Cardiology") | Anticipates the gap before she has to look |

The honest framing: views 1 and 2 are the immediate quick wins (`analyze-bloom-distribution` job answered directly). Views 3 and 4 are second-order; they depend on enrichment being run *consistently over time*, which depends on prompt-version provenance (Expansion A Section 4) and re-enrichment hygiene (Expansion E Section 5).

---

## 4. Data shape: what's there, what's missing

### What the PoC already produces

From `feature-delta.md` US-02 + the Zod sketch in Expansion A Section 7:

```text
enriched_questions
  id               PK
  bloom_level      enum (3-level PoC, 6-level future)   <-- analytics needs this
  keywords         text[]                                <-- analytics could use this
  embedding        vector(1536)                          (not needed for analytics)
  prompt_version   text                                  <-- needed for drift detection
  model            text                                  <-- needed for drift detection
  enriched_at      timestamptz                           <-- needed for time series
```

### What's missing for full analytics

The schema fields the PoC does NOT capture but a curriculum analytics view would need:

| Field | Why missing now | When to add |
|---|---|---|
| `medical_specialty` (Cardiology, Endocrinology, ...) | Listed in Expansion A's Zod sketch as a required enrichment output. The PoC seed data may not include this consistently. | **Add to the enrichment prompt now** — zero PoC cost, foundational for analytics. |
| `system_organ` (cardiovascular, endocrine, ...) | Out of PoC enrichment scope. Distinct from specialty (a single question can touch cardiology *and* endocrinology). | Add as a follow-up enrichment field post-PoC. Multi-label. |
| `difficulty_estimate` (numeric, distinct from Bloom level) | Hard to elicit from LLM reliably without calibration data. | Skip until we have student answer-correctness data to calibrate against. |
| `learning_objective_tags` | Requires per-institution taxonomy. | Out of scope unless an institutional taxonomy is provided. |

The PoC investment in **structured enrichment** with `medical_specialty` already covered makes views 1, 2, and 3 from Section 3 buildable without further enrichment changes. View 4 (low-coverage alerts) requires no schema changes, only a threshold-evaluation job.

### The non-obvious foundation: provenance

The drift-over-time view (Section 3, view 3) is impossible without `prompt_version` + `enriched_at` per row. The PoC stores both unconditionally (System Constraints in `feature-delta.md`). This means: the most demanding analytics view (drift detection) is unblocked by data the PoC was going to capture anyway. **This is the load-bearing argument for the "platform not feature" framing.**

---

## 5. Phasing

The analytics roadmap maps to four milestones. Only M0 is in PoC scope.

| Milestone | Scope | Effort estimate | Status |
|---|---|---|---|
| **M0** — Data foundation | Bloom level + medical_specialty + provenance on every enriched row | Already in PoC | **Locked by `feature-delta.md`** |
| **M1** — Read-only API endpoints | `GET /api/analytics/bloom-distribution?pack=<id>` returning histogram JSON; `GET /api/analytics/coverage-heatmap` | ~2-3 days, post-PoC | Future |
| **M2** — BI tool integration | Postgres read replica + Metabase or Superset connection; pre-built dashboards for views 1-3 | ~3-5 days, post-PoC | Future |
| **M3** — In-app dashboard | Curriculum-team UI showing Section 3 views with filtering and time-range controls | ~10-15 days, post-PoC | Future |

### Why M1 before M2

Read-only API endpoints come *before* BI tooling so that the data shape is interrogable from a script, not only from a dashboard. This is what makes the integration with Metabase/Superset (or any other BI tool) low-friction: the BI tool consumes the API or the Postgres view, not the application logic.

### Why M2 before M3

BI tools give the curriculum team self-service *before* engineering invests in a bespoke dashboard. If the BI views answer 80% of questions, M3 may never be needed. Avoiding M3 is a win, not a loss. This is the elephant-carpaccio mindset applied to the post-PoC roadmap.

### Tools comparison (informational)

- **Metabase**: easier setup, weaker custom-viz. Good for question-bank counts and percentages. Free OSS edition.
- **Superset**: more powerful, steeper learning curve. Good for the cross-specialty heatmap.
- **Recommendation**: start with Metabase at M2 because the views in Section 3 are mostly histograms and time series. Escalate to Superset only if the curriculum team asks for custom analytics that Metabase can't express.

---

## 6. Why this matters for the PoC decision

The single staff-level framing:

**The PoC builds a platform that serves two distinct jobs from one data investment.** The student's `find-questions-by-clinical-intent` job (opportunity score 16) drives the visible UX; the curriculum-designer's `analyze-bloom-distribution` job (opportunity score 8) is silently unblocked by the same `bloom_level` column. If we had cut the Bloom enrichment to save 4 hours, we'd have shipped a feature instead of a platform. The decision to keep it is a staff-level multi-job architectural call, not an accidental scope item.

The one-paragraph version:

> "We invested in structured Bloom-level enrichment in the PoC even though only the student persona uses it in Release 1, because the same `bloom_level` column unblocks the curriculum-designer's `analyze-bloom-distribution` job in a later release. The PoC adds `prompt_version` and `medical_specialty` to the same row at zero marginal cost. That single column choice converts the system from a question-search feature into a question-bank platform; the only thing the curriculum team will need post-PoC is the API endpoints in M1, which are SQL aggregates over existing data. We're not building the future; we're refusing to break it."

---

## Changelog

| Date | Change |
|---|---|
| 2026-05-13 | Initial Tier-2 expansion. Curriculum-designer roadmap, M0-M3 phasing, "platform not feature" framing. |
