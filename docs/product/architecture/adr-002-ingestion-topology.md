<!-- markdownlint-disable MD013 -->
# ADR-002 — Ingestion topology: synchronous inline at PoC, async-pool at M1

**Status**: Accepted
**Date**: 2026-05-13
**Deciders**: system-architect
**Wave**: DESIGN (after DIVERGE recommendation)

## Context

The brief explicitly calls out "the asynchronous nature of the AI
enrichment" as a deliverable in the data-flow diagram. The DISCUSS wave
constrained: no orchestrator (Airflow / Temporal) in PoC scope. The
DIVERGE wave scored four ingestion topologies (`diverge/options-matrix.md`
secondary axis):

1. **T1** — Synchronous inline (CLI: `for q of batch { enrich; embed; insert }`)
2. **T2** — Async in-process worker pool (`p-limit(3)`)
3. **T3** — Separate worker process + Postgres-backed queue
4. **T4** — Real queue (SQS / Redis Streams)

Trade-off dimensions: PoC determinism, production scale-up shape, PoC
complexity, failure-model clarity, resumability.

Key constraints:

- **`admin-ingests-batch.yaml` Step 1** TUI mockup is a single CLI streaming
  per-question log lines with a summary at the end. The PoC topology must
  match this UX exactly.
- **Expansion A §3 decision matrix** (schema-retry budget separate from
  transport-retry budget; quarantine after exhaustion) maps cleanly into a
  single function with try/catch. Splitting across processes/queues
  complicates the matrix.
- **Expansion E §7** ("Production thinking: scaling to 10M questions")
  commits to wrapping the PoC's inner function in a queue producer for
  production. The PoC topology must be *re-usable*, not *replaceable*.

## Decision

**Adopt T1 (Synchronous inline) for PoC. Wrap the inner function in async
fan-out (T4: SQS+Lambda) at M1.**

Specifics:

- The PoC ingestion is a single TypeScript CLI process (`pnpm run ingest`).
- The inner per-question function (`enrich → validate → embed → insert`)
  is implemented as a **pure-ish function of `(question, prompt, model)`**:
  it has side effects (DB write, LLM call) but no shared in-process state.
  This is the unit of reuse for M1.
- T2 (async pool) is the natural intermediate step *if* PoC batch size grows
  beyond ~100 questions (estimated ~30 lines over T1, `p-limit(3)`). No
  production-shape difference; the trigger is demo wall-clock time.
- M1 wraps the same inner function in an SQS-triggered Lambda. The retry
  and quarantine semantics from Expansion A §3 do not change. See ADR-003
  for the async infrastructure choice.

## Consequences

### Positive

- **Demo legibility**: failure stack trace = program stack trace. Sam runs
  `pnpm run ingest`, sees per-question log lines, sees a summary. No queue
  to monitor, no worker to start, no out-of-band logs to tail. Matches the
  journey TUI mockup exactly.
- **Zero infrastructure**: no queue, no worker, no orchestrator. The
  ingestion runs against a local Postgres in `docker-compose` at dev time;
  the same code runs against a managed Postgres at deploy time.
- **Failure-model clarity**: the Expansion A §3 decision matrix
  (schema-retry, transport-retry, quarantine) maps directly to one
  function's try/catch. The answer to "how do you handle LLM
  non-determinism" is a single code path, not a distributed-systems story.
- **Re-usable inner function**: M1's SQS+Lambda wrap reuses the same
  `enrich(question)` function. No rewrite; only the loop around it changes.
  This is the "PoC is the inner loop; production wraps the outer loop"
  framing.
- **Within 8-hour PoC budget**: T1 reaches US-01 walking skeleton in ~2
  hours, leaving 6 hours for US-02 (resilience), US-03 (observability),
  US-04 (search UX), and the rest. Time-to-PoC is the binding constraint.

### Negative

- **No resumability**: a half-finished run is just half-finished. For 10
  questions this is fine; for 10k+ it's a problem — hence the M1 transition.
  Mitigation: `batch_id` on every row makes re-runs idempotent (the same
  batch_id + same `source_question_id` would conflict on the unique
  constraint and skip); a `--resume` flag can be added when needed.
- **Serial latency at scale**: at p50 ingestion ~1s/question (§4.2 of
  `brief.md`), 100 questions takes ~100 seconds serial. T2 (async pool of
  3) brings this to ~35s. T1 is fine for ≤100; T2 is the trigger if the
  batch grows.
- **No concurrent operators**: only one Sam can run `pnpm run ingest` at
  a time without coordinating. At PoC there's one Sam; at M1+ this would
  be unacceptable, hence the queue-based M1 design.
- **No retry-across-restart**: if the CLI crashes mid-run, the in-progress
  question is lost. Quarantine records that *have* been written persist;
  the rest needs a re-run. For 10 questions, acceptable. For 100k, this
  is exactly what SQS+DLQ at M1 solves.

## Alternatives considered

- **T2 — Async in-process worker pool** (acceptable alternative): a
  `p-limit(3)` concurrency pool. ~30 lines over T1. The recommendation
  flips T1→T2 around batch size 100, *not* based on production-readiness
  arguments but based on demo wall-clock time. No fundamental architecture
  change. We keep T2 as the "if batch grows" upgrade within the PoC.

- **T3 — Separate worker process + DB-backed queue** (cut): premature
  production. Adds a queue table, claim/lease semantics, worker process,
  dead-letter logic. ~3 hours of effort that doesn't advance any user
  story. Also splits the Expansion A §3 decision matrix across two
  services (retry-at-the-queue vs retry-at-the-LLM), complicating the
  failure-model story.

- **T4 — Real queue (SQS / Redis Streams)** (cut for PoC, adopted for M1):
  AWS dependency for an 8-hour PoC is wrong shape. Adds infra setup
  with zero PoC-scope benefit. *However*, this is the correct M1 choice
  (ADR-003) — we just don't build it in M0.

Full scoring at
[`docs/feature/hybrid-search-medical-questions/diverge/options-matrix.md`](../../feature/hybrid-search-medical-questions/diverge/options-matrix.md)
§Secondary axis.

## Migration path

**M0 → M1 transition** (synchronous → SQS-wrapped async):

1. Extract the inline per-question function into `packages/enrichment`:
   `export async function enrichQuestion(q: RawQuestion, ctx: EnrichmentCtx): Promise<EnrichResult>`.
   No semantic change from PoC code; just a module boundary.
2. Add an SQS-producing CLI alongside the existing one. Same input file
   parsing, different consumer: write each question to SQS as a message
   with `MessageDeduplicationId = (source_question_id, prompt_version)`.
3. Deploy a Lambda triggered by SQS that calls `enrichQuestion(q, ctx)`.
   The DLQ is wired to the same SQS service for poisoned messages
   (transport-poisoned; schema-poisoned still go to the `quarantine`
   table via the same function).
4. Cut over: change default `pnpm run ingest` to producer mode. The
   synchronous CLI stays in the codebase as `pnpm run ingest:sync` for
   emergency replays.

The contract at the function boundary (`enrichQuestion`) does not change.
The infrastructure around it changes. This is the load-bearing claim for
"PoC topology is re-usable, not replaceable".

## References

- `docs/feature/hybrid-search-medical-questions/diverge/recommendation.md` §2
- `docs/feature/hybrid-search-medical-questions/diverge/options-matrix.md` (secondary axis)
- `docs/feature/hybrid-search-medical-questions/expansions/A-llm-non-determinism.md` §3 (retry/quarantine matrix)
- `docs/feature/hybrid-search-medical-questions/expansions/E-cost-and-reenrichment.md` §7 (production scale-up shape)
- `docs/feature/hybrid-search-medical-questions/journeys/admin-ingests-batch.yaml` Step 1 (TUI mockup)
- ADR-003 (the M1 queue infrastructure choice)
- `docs/product/architecture/brief.md` §3 (data flow), §5 (M0→M1 transition)
