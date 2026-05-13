# Slice 03: Pipeline observability — cost, latency, validation rate

**Status**: Release 1 (paired with Slice 02 for the admin journey)
**Estimated effort**: 0.5-1 day
**Learning hypothesis**: We can give Sam (content-ops admin) the numbers he needs to defend the pipeline to Finance and to spot quality regressions before users do, without building a real telemetry stack.

## What is in this slice

| Task | Detail |
|---|---|
| Per-call latency tracking | Capture wall-clock per LLM call; aggregate into run summary (avg, p95) |
| Cost estimation | Multiply token usage by per-1k-token rate from a hardcoded pricing table; show per-call and aggregate |
| Validation-rate metric | Schema-pass-first-try / schema-pass-after-retry / quarantine rates |
| Run record persistence | Write each run's summary to `runs` table (or a JSON log file under `logs/runs/`) so historical trends are inspectable |

## Why this slice exists

The Plan-of-Action in the design wave will recommend production telemetry (OTEL, Prometheus, etc.) — but for the PoC, "did the LLM call respond in 900ms and cost $0.007" is enough signal. The stakeholder framing can then be "in production we would emit OTEL spans here" rather than "we have no idea what this costs."

## Out of scope

- Real-time dashboards
- Alerting on threshold breach
- Per-model A/B comparison
- Distributed tracing
- Anything requiring a separate telemetry backend

## Demo

```
$ pnpm run ingest --file data/sample-questions.json

[ ... per-question lines as in slice 02 ... ]

Run summary
============================================
File:           data/sample-questions.json
Total:          10
Enriched:        9 (90.0%)
   first-try pass: 7 (70.0%)
   after retry:    2 (20.0%)
Quarantined:     1 (10.0%)
Total cost:    $0.0764  (input tokens: 4,210, output: 2,830)
Avg cost/q:    $0.0085
Avg latency:   978ms
p95 latency:   1.42s
Duration:      14.2s
```

## Taste tests

- [x] Adds visible value to the admin journey
- [x] Produces user-visible output (numbers in CLI + persisted run record)
- [x] Independently demoable
- [x] Effort 0.5-1 day
- [x] Real entry point: `pnpm run ingest` (existing) — the numbers are added to the summary
