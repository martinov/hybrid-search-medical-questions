# Persona: Curriculum Designer (Tertiary)

**Persona ID**: `curriculum-designer`
**Role**: Internal stakeholder (analytics consumer)
**Primary jobs**: `analyze-bloom-distribution`
**Scope note**: Tertiary persona. Not addressed in PoC walking skeleton or Release 1.
The Bloom-level enrichment exists for student-facing filtering; this persona is the
secondary beneficiary, justifying the enrichment investment beyond a single use case.

## Snapshot

**Name (representative)**: Dr. Maria Lourdes Santos, MD, MEd
**Stage**: Curriculum lead at a medical school (or content director at the education platform). Designs the question-bank structure across subjects, sets coverage targets, identifies gaps.
**Context**: Reviews aggregate metrics weekly; commissions new content quarterly. NOT a daily user of the search tool.

## What she wants

- Reports showing how question coverage maps to Bloom's taxonomy levels per topic
  ("Cardiology has 200 questions but 90% are recall-level -- we need analysis-level coverage")
- Confidence that the Bloom-level labels are accurate enough to drive decisions
  (depends on `enrich-question-bank-reliably` outcomes)

## Why she matters for THIS feature even at PoC

She validates that the enrichment investment has more than a single consumer. The
Bloom-level field is not a "nice to have" for students -- it is also a curriculum
signal. This argues against cutting Bloom-level enrichment if scope pressure mounts:
it serves two distinct jobs.

## Out-of-scope explicitly

- Analytics dashboards (future slice, post-Release 2)
- Bloom-distribution charts in the UI
- Coverage gap recommendations
- Direct interaction with the chat UI

The PoC only needs to ensure the data foundation (Bloom level on each enriched
record) is in place. The curriculum-designer's UI is a downstream concern.
