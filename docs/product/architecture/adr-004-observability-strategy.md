<!-- markdownlint-disable MD013 -->
# ADR-004 — Observability strategy: stdout JSON at PoC, OTEL+Prom at M1+

**Status**: Accepted
**Date**: 2026-05-13
**Deciders**: system-architect
**Wave**: DESIGN

## Context

The DISCUSS wave's US-03 (Pipeline run observability) requires per-run cost,
latency, and validation-rate reporting at PoC scope. The DISCUSS wave's
System Constraints explicitly state "no real telemetry backend in PoC scope".

Expansion A §6 names the metrics that matter for non-determinism observability
(first-try validation rate, retry-count distribution, quarantine rate,
`finish_reason` distribution, latency, cost per question) and the slicing
dimensions (`prompt_version`, `model`, `medical_specialty`).

The interview-time tension: a credible answer to "how would you monitor this
in production?" must point to OTEL+Prom-class instrumentation, even though
the PoC ships with neither. The honest framing is "the PoC captures the
right *data*; the production version wraps it in OTEL."

## Decision

**Two-stage observability strategy:**

1. **M0 (PoC)**: structured JSON logs to stdout. Per-run summary written to
   `logs/runs/{batch_id}.json` (US-03 AC). `jq` is the PoC-grade BI tool
   for historical comparison. **No OTEL, no Prom, no Grafana, no Loki, no
   third-party telemetry vendor at M0.**

2. **M1+**: OTEL traces + Prometheus metrics. Standard semantic conventions
   for HTTP, DB, and LLM calls. Metrics sliced by `prompt_version` and
   `model`. Traces span the per-request graph from API → search → Postgres
   and from CLI → enrichment → LLM → DB.

**We do not build OTEL in the PoC because**:

- The PoC's 8-hour budget is binding. OTEL setup (collector deployment,
  span instrumentation, vendor wiring) is ~2-4 hours of yak-shaving that
  delivers zero user-visible value at M0.
- The PoC has *one operator* (Sam) and *one process*; the value of
  distributed tracing kicks in at multi-process M1+.
- `logs/runs/{batch_id}.json` + `jq` captures the same data shape that
  OTEL/Prom would emit. The transition at M1 is "redirect the same
  measurements into the OTEL exporter", not "instrument from scratch".
- A real Prometheus deployment in the PoC is conformance theater — it
  signals "I know how to deploy Prom" rather than "I know how to solve the
  problem at this scale."

### Per-run JSON shape (M0)

Per US-03 AC, `logs/runs/{batch_id}.json` contains:

```jsonc
{
  "batch_id": "2026-05-13T10:42:00Z",
  "file": "data/sample-questions.json",
  "total": 10,
  "enriched": 9,
  "quarantined": 1,
  "first_try_pass": 7,
  "after_retry": 2,
  "duration_ms": 14200,
  "cost_usd_total": 0.0764,
  "cost_usd_avg": 0.00849,
  "latency_p50_ms": 978,
  "latency_p95_ms": 1420,
  "prompt_version": "v1",
  "model": "gpt-4o-mini",
  "embedding_model": "text-embedding-3-small",
  "per_question": [
    {
      "id": "q-001",
      "status": "ok",
      "retry_count": 0,
      "duration_ms": 912,
      "cost_usd": 0.00710,
      "tokens_in": 1024,
      "tokens_out": 118
    }
    // ...
  ]
}
```

### M1+ instrumentation shape (forward-looking)

- **OTEL traces**: each ingestion run = one root trace; each per-question
  enrichment = a child span. Spans for LLM call, Zod parse, embedding,
  DB insert.
- **Prometheus metrics**:
  - `enrichment_first_try_pass_total{prompt_version, model}` (counter)
  - `enrichment_retry_count_bucket{prompt_version, model}` (histogram)
  - `enrichment_quarantine_total{prompt_version, model}` (counter)
  - `llm_call_latency_seconds_bucket{model, operation}` (histogram)
  - `llm_call_cost_usd_total{model, operation}` (counter)
  - `search_query_latency_seconds_bucket{leg}` (histogram, leg ∈
    `{lexical, semantic, rrf}`)
  - `chat_first_token_latency_seconds_bucket` (histogram)
- **Dashboards**: Grafana (or Netea's existing tool) panels for the
  before/after view across `prompt_version` (Expansion A §6).

## Consequences

### Positive

- **PoC scope honored**: M0 ships with no telemetry vendor dependency. The
  demo runs on `docker-compose up` + `pnpm run ingest`. No Grafana, no
  Loki, no shared cluster.
- **The right data is captured at M0**: cost, latency, validation rate,
  per-question tokens — all in `logs/runs/`. Historical comparison via
  `jq` over the directory works for the PoC and is honest at staff level.
- **M0→M1 transition is additive**: the OTEL instrumentation is wrapped
  around the same measurements (`logs/runs/`) the PoC already takes. No
  re-instrumentation; the existing measurement points become span events
  and metric increments.
- **Sliceable by the dimensions that matter**: Expansion A §6's slicing
  by `prompt_version` and `model` works at both M0 (each JSON file has the
  prompt/model in the top-level keys) and M1+ (label dimensions on the
  Prom metric).
- **No vendor lock-in at M1**: OTEL is vendor-agnostic. The collector can
  ship traces to Honeycomb, Datadog, AWS X-Ray, Jaeger, or Tempo
  interchangeably; the application code does not change.

### Negative

- **No real-time alerting at M0**: a regression in first-try-pass rate is
  visible only post-hoc, after Sam reads the run summary. For 10 questions
  this is fine; if the PoC corpus grows to 1000, real-time alerting becomes
  desirable — which is exactly the M1 trigger.
- **No cross-process tracing at M0**: distributed tracing buys little when
  there's only one process. At M1 (Lambda + API + Postgres), tracing
  matters; at M0, stdout suffices.
- **`jq` BI is operator-grade, not stakeholder-grade**: Finance cannot
  query `logs/runs/*.json` with `jq`. For PoC scope this is correct (the
  one stakeholder is Sam); at M1+ we'd want a dashboard for the cost
  metric specifically (the "defend pipeline cost to Finance" outcome in
  US-03 Domain Example 1).
- **OTEL deployment at M1 has its own complexity**: collector deployment,
  exporter configuration, sampling strategy. Mitigation: the M1 ADR (out
  of this doc's scope) will name a specific exporter; AWS X-Ray is the
  default-fit option given the stack but is replaceable.

## Alternatives considered

- **Build OTEL + Grafana in the PoC** (rejected): conformance theater
  cost. ~3-4 hours of setup. Zero PoC-scope value. Named in the taste
  filter (`diverge/taste-filter.md` §"Build a real BI dashboard for
  cost/latency") as an anti-pattern.

- **Datadog APM agent in the PoC** (rejected): vendor-specific, costs
  money, adds a dependency on a SaaS for a take-home demo. Wrong tool for
  M0.

- **Pino structured logger + ELK** (rejected for M0, viable at M1+): the
  Pino part is reasonable (it's a JSON logger); the ELK part is the same
  conformance-theater cost as Grafana. We use built-in `console.log` with
  manual JSON formatting at M0 (or Pino if it's free; it usually is).

- **OpenTelemetry-instrumented-from-day-1** (rejected at M0 with a caveat):
  OTEL spans cost <5% perf overhead and can run with a no-op exporter at
  M0 (output goes nowhere). This is *almost* worth doing — the temptation
  is real. We don't, because: (a) Mastra's OTEL story is not yet validated
  for our use case; (b) at M0 the spans go nowhere and add visual noise to
  the codebase without paying back. Re-considered if Mastra ships
  native OTEL support that's free at the import.

## Migration path

**M0 → M1 transition** (stdout JSON → OTEL + Prom):

1. Extract the measurement points (currently `Date.now() - start`, token
   counting, cost computation) into `packages/observability`. No
   semantic change to M0 code.
2. Add an OTEL SDK setup module. Default exporter at M1 is AWS X-Ray
   (stack-fit); replaceable.
3. Replace direct `Date.now()` measurements with OTEL span lifecycle calls
   (`tracer.startSpan(...)` / `span.end()`).
4. Add Prometheus counters/histograms alongside the existing
   `logs/runs/{batch_id}.json` writer. Both can coexist — the JSON file
   remains useful for offline analysis (`jq`) even after dashboards exist.
5. Wire metrics into a Prometheus-compatible scraper (CloudWatch
   Prometheus, AMP, or self-hosted).

The `logs/runs/{batch_id}.json` writer is **not removed** at M1+. It
remains the operator's offline-inspectable record of any single ingestion
run. The transition is *additive*.

## References

- US-03 (Pipeline run observability) in `docs/feature/hybrid-search-medical-questions/feature-delta.md`
- `docs/feature/hybrid-search-medical-questions/expansions/A-llm-non-determinism.md` §6 (metrics that matter, slicing dimensions)
- `docs/feature/hybrid-search-medical-questions/diverge/taste-filter.md` §"Build a real BI dashboard for cost/latency"
- `docs/product/architecture/brief.md` §5 (M0/M1 milestones)
