# Manual KPI — chat p95 latency < 4 s

**KPI**: Outcome KPIs Summary #1 — p95 chat response < 4 s.
**Why manual**: KPI #1 is impossible to assert deterministically in a
unit-test setting (the InMemory LLM mock streams instantly; the real
OpenAI latency is what the KPI measures). Automating this would either
require a live OpenAI smoke test (gated by `@requires_external`) or a
synthetic load harness that does not belong in PoC scope.

## Procedure (operator runs during the interview demo)

1. Start the stack against real OpenAI: `pnpm run dev` with
   `OPENAI_API_KEY` set (no `NETEA_USE_MOCK_LLM`).
2. Run the seed query set against `POST /api/chat` ten times, measuring
   from request start to stream close.
3. Compute p95 of the ten measurements.
4. Record in `logs/runs/manual-chat-p95-{date}.json`:
   ```json
   {
     "kpi": "chat-p95-latency-seconds",
     "target": 4,
     "samples_ms": [/* 10 numbers */],
     "p95_ms": 3450,
     "passed": true
   }
   ```

## Failure mode

If p95 > 4 s:

- Switch enrichment + chat to a faster model snapshot (gpt-4o-mini-2024-07-18 baseline).
- Verify network egress is not saturated.
- Check Mastra agent-loop turn count — if the agent fires the search tool then re-asks the user, two LLM turns inflate latency.

## When this becomes automated

At M1 (per design/roadmap.md), OTEL spans replace this manual check. The
`apps/api` emits `chat_first_token_seconds` and `chat_full_response_seconds`
histograms scraped by Prometheus; a Grafana panel shows the p95 over time.
