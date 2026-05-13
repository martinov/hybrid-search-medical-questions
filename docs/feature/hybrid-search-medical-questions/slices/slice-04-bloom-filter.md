# Slice 04: Bloom-level filtering in the chat journey

**Status**: Release 2 (extends the student journey beyond walking skeleton)
**Estimated effort**: 1 day
**Learning hypothesis**: The Bloom-level metadata we are paying to enrich is actually useful for student-facing filtering (closes the `calibrate-cognitive-difficulty` job) and validates the enrichment investment.

## What is in this slice

| Task | Detail |
|---|---|
| Search API accepts a `bloom_level` filter | `POST /api/search` body field; SQL `WHERE bloom_level = $1` |
| Agent tool exposes `bloom_level` parameter | Mastra tool schema includes optional bloom_level enum |
| Agent extracts bloom intent from conversation | When user says "application-level only" the agent passes the filter |
| Result cards show Bloom level | Each result card shows e.g. "Bloom: Application" |
| Empty filtered result handling | "0 application-level questions matched; here are 2 analysis-level ones — useful?" |

## Why this slice is Release 2, not Release 1

The walking skeleton + Slice 02 (resilience) + Slice 03 (observability) together complete the admin journey AND the bare student happy path. Bloom filtering is the FIRST upgrade to the student journey — it converts the tool from "I get topical results" to "I get topical results AT THE RIGHT COGNITIVE LEVEL." That is when `calibrate-cognitive-difficulty` is actually addressed.

## Out of scope

- Multiple-level OR-filters ("application OR analysis") — single level only in this slice
- Bloom distribution analytics for `curriculum-designer` persona (future, post-PoC)
- Persistent user preferences for default bloom level
- Confidence scoring on bloom labels

## Demo

Conversation continues from the walking-skeleton demo:

```
YOU:   Only application-level, please

AGENT: Filtering to bloom_level: application

       1. [Cardiology] Acute decompensated HF in ED
          Bloom: Application
          "A 68-year-old man presents with..."

       2. [Cardiology] HFrEF pharmacotherapy
          Bloom: Application
          "Which medication has mortality benefit..."

       (2 of 3 results matched the filter)
```

## Taste tests

- [x] Touches the search and chat activities in a new way (the skeleton ignored bloom_level)
- [x] Produces user-visible output (filter applied, count visible)
- [x] Independently demoable
- [x] Effort 1 day
- [x] Real entry point: chat input ("application-level only") + `curl POST /api/search` with bloom_level field
