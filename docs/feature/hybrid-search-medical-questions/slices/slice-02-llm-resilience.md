# Slice 02: LLM resilience — retry, quarantine, and batch ingest

**Status**: Release 1 (highest-value increment after the skeleton)
**Estimated effort**: 1-2 days
**Learning hypothesis**: We can handle LLM non-determinism (invalid JSON, schema drift, transient errors) without corrupting the corpus or silently dropping records, and we can process a small batch (5-10 questions) reliably.

## Why this is the first slice after the skeleton

This is THE story that defines whether the system is staff-level engineering or a toy. LLM non-determinism is explicitly listed in the task's evaluation criteria ("Handling Ambiguity"). The walking skeleton proves the wires connect; this slice proves the wires don't fray under realistic conditions.

## What is in this slice

| Story-map task | Task in this slice |
|---|---|
| Ingest raw questions | Loop over all questions in `data/sample-questions.json` |
| Enrich with LLM | Retry up to 2 times on Zod parse failure with backoff; quarantine on exhaustion |
| Quarantine sink | New `quarantine` table; raw LLM output + parse error + source question id preserved |
| Index for hybrid search | (unchanged from skeleton, runs after enrichment) |
| Run summary | Per-batch summary: total / enriched / quarantined / duration / prompt version / model |

## Acceptance scenarios in scope

- Enrichment succeeds first try
- Enrichment fails Zod parse, retries, succeeds
- Enrichment fails N times, quarantined with raw response preserved
- LLM provider transient 429/5xx — exponential backoff, retried; does NOT consume schema-retry budget
- Run summary numbers match DB counts

## Out of scope for this slice

- Cost telemetry (Slice 03)
- Bloom-filter querying from the UI (Slice 04)
- Multi-turn conversation context (Slice 05)
- Re-enrichment on prompt change (Slice 06 / future)

## Demo

```
$ pnpm run ingest --file data/sample-questions.json
Netea ingestion v0.2
File:           data/sample-questions.json
Count:          10 questions
Prompt version: v1 (sha: 8af3c2)
Model:          gpt-4o-mini

[1/10] Cardiology: Patient Symptoms ........... ok (912ms)
[2/10] Pulmonology: Acute Asthma .............. ok (1.04s)
[3/10] Renal: AKI vs CKD ...................... ok (876ms)
[4/10] Endocrinology: Diabetic Ketoacidosis ... RETRY 1/2 (schema fail)
[4/10] Endocrinology: Diabetic Ketoacidosis ... ok (after retry)
[5/10] Hematology: Anemia Workup .............. ok
[6/10] Neurology: Acute Stroke ................ RETRY 1/2
[6/10] Neurology: Acute Stroke ................ RETRY 2/2
[6/10] Neurology: Acute Stroke ................ QUARANTINED
...

Run summary:
  Total: 10, Enriched: 9 (90%), Quarantined: 1 (10%)
  See:   SELECT * FROM quarantine WHERE batch_id='...'
```

## Taste tests

- [x] Touches the ingestion activity in a way the skeleton did not (loop + error paths)
- [x] Produces user-visible output (per-question CLI lines + summary, plus the quarantine table is queryable)
- [x] Independently demoable
- [x] Failure path (quarantine) is loud and recoverable
- [x] Effort 1-2 days
- [x] Real entry point: `pnpm run ingest`

## Risks specific to this slice

- **Retry budget exhaustion is real LLM cost**: each retry costs tokens. Default retry count is 2 and configurable. Document this.
- **Quarantine table schema choice**: must preserve raw LLM output (not a parsed/normalized version), because that is what makes debugging possible.
