<!-- markdownlint-disable MD013 -->
# ADR-006 — Aggregates with emitted events, no event sourcing

**Status**: Accepted
**Date**: 2026-05-13
**Deciders**: ddd-architect
**Wave**: DESIGN (DDD sub-wave)

## Context

The feature (`hybrid-search-medical-questions`) decomposes into four
bounded contexts (Ingestion, Enrichment, Search, Conversation — see
`brief.md` §Domain Model 1). The Enrichment context owns the most
complex state machine in the system (the F1–F7 failure taxonomy decision
matrix per Expansion A §3), and the Ingestion context tracks batches and
per-question lifecycle transitions.

A reasonable DDD architect would ask: "is this an event-sourced system?"
This ADR captures the explicit decision **not** to event-source, and the
shape of the alternative we adopt.

Constraints relevant to this decision:

- **Postgres is the source-of-truth** (ADR-001). The state of any
  aggregate is the current value in `enriched_questions`, `quarantine`,
  or `ingestion_batches`.
- **US-03 wants observability**, not full audit. Per-run cost / latency /
  validation-rate captured in `logs/runs/{batch_id}.json` is the visible
  contract; no requirement to replay-to-state.
- **Re-enrichment policy** (Expansion E §5) uses **`prompt_version`
  comparison**, not full event history.
- **PoC budget is 8 hours**. Event sourcing has a non-trivial setup cost
  (event store, replay logic, snapshot policy, projection management)
  that would consume hours we do not have.
- **No published "rebuild from log" requirement** anywhere in the SSOT.

## Decision

**Adopt state-based aggregates with emitted-but-not-sourced domain events.**

Specifics:

- **Aggregate state lives in Postgres rows.** The current state of any
  aggregate (e.g., a `Question`'s `lifecycle_state`, an `EnrichmentTask`'s
  `state`, a `Quarantine`'s `triage_state`) is the value in the
  corresponding column. Reading state is a SQL query; writing state is a
  SQL update.
- **Domain events are facts that happened**, emitted at aggregate boundary
  crossings (state transitions, terminal outcomes, cross-context
  hand-offs). See `brief.md` §Domain Model 3 for the full catalog (16
  events).
- **Events are NOT the system of record.** They are emitted for:
  1. **Observability** (US-03): per-run summaries aggregate events into
     the `logs/runs/{batch_id}.json` shape.
  2. **Decoupling between contexts**: Enrichment publishes
     `EnrichmentSucceeded` / `EnrichmentQuarantined`; Ingestion subscribes
     to update `Question.lifecycle_state`. No cross-context aggregate
     loading.
  3. **Future audit / fine-tuning datasets** (M1+): `ChatTurnCompleted`
     events become a fine-tuning corpus when chat persistence is added.
- **Events are NEVER replayed to reconstruct state.** If Postgres is
  lost, DR is point-in-time-recovery from a Postgres backup, not event
  replay.
- **At M0**: events are in-process function calls / a thin EventEmitter.
  No outbox, no message bus.
- **At M1+**: an **outbox pattern** is added for reliable publication to
  external subscribers (e.g., observability collectors, future analytics).
  The outbox is NOT the system of record; it is a reliable-publication
  helper.

## Consequences

### Positive

- **Time-to-PoC unlocked**: no event store to set up, no projection
  pipeline to build. The walking skeleton (US-01) ships in hours, not
  days. Within the 8-hour budget.
- **Cognitive simplicity for the interview discussion**: "Postgres holds
  the state, events tell us what happened" is a one-sentence model. ES
  would require explaining stream design, snapshotting, schema versioning,
  and replay semantics — all of which are real but none of which help
  any user story.
- **Native SQL analytics preserved** (Expansion C): the curriculum-
  designer's Bloom-distribution view is `SELECT bloom_level, COUNT(*) FROM
  enriched_questions GROUP BY bloom_level`. In an ES system, this query
  would need to read a projection — building and maintaining that
  projection is pure overhead at this scale.
- **DR is Postgres-shaped, not bespoke**: point-in-time recovery is a
  managed RDS feature. No event-store backup to engineer.
- **The aggregates are still real DDD aggregates**: invariants,
  consistency boundaries, by-ID references, eventual consistency outside
  the boundary. Vernon's four rules are honored. The pattern we reject is
  *event sourcing* — not *DDD*.

### Negative

- **No "time travel"**: we cannot ask "what was the state of Question X
  at 2026-04-01T10:00Z?" without ad-hoc reconstruction. For our domain
  this is acceptable (no auditor will ask), but it is a real capability
  we don't have.
- **State changes that *don't* emit an event are invisible**: if a
  developer mutates `Question.lifecycle_state` without emitting the
  corresponding event, observability misses it. Mitigation: domain
  methods that mutate state also emit the event in the same function (a
  hand-discipline rule; enforceable via code review and a few unit tests).
- **Replay-as-debugging is not free**: in ES, you can replay events
  against a new projection to debug "what did the system see?". Without
  ES, debugging is reading logs + Postgres rows. For our scale this is
  fine; at a larger scale where event volume is millions per day, the
  trade-off would be revisited.
- **Outbox at M1+ adds infrastructure**: when reliable cross-service event
  publication arrives, we'll need an outbox table + a relay worker.
  Standard pattern, but real work.

## Alternatives considered

- **Full event sourcing** (rejected): event store as system-of-record;
  Postgres rows as cached projections. Cost: ~6-10 hours of PoC setup
  (event store schema, append-only invariants, snapshot policy, replay
  harness, projection rebuilders) for zero observable user benefit at
  PoC scope. The user pre-decided NO ES; this ADR ratifies and defends.

- **"ES-lite": outbox pattern as event store** (rejected for PoC,
  partially adopted at M1+): the outbox pattern reliably publishes events
  *alongside* state changes — but the outbox is not the source-of-truth
  for state. We adopt outbox at M1 for **reliable cross-service
  publication**, not as a degenerate event store. At PoC scope no outbox
  is needed (in-process emitter suffices).

- **CQRS without ES** (rejected at PoC; arrives naturally at M3): separate
  write model (Enrichment writes to `enriched_questions`) and read model
  (Search reads from indexes on the same table) is already CQRS-shaped —
  but it's at the table level, not a separate-store level. At M3 when
  Search migrates to OpenSearch (ADR-001 named exit), the CQRS shape
  becomes architecturally explicit. Pre-building it at PoC would be
  conformance theater.

- **No events at all (CRUD with logs only)** (rejected): we DO want
  domain events for the three benefits named in the Decision section
  (observability, decoupling, future audit). Without events,
  observability would have to scrape DB tables — a worse contract.

## Migration path

This decision is stable across milestones:

- **M0 (PoC)**: in-process events via a typed EventEmitter (or Mastra's
  built-in event hooks). Subscribers: the `logs/runs/{batch_id}.json`
  writer; the cross-context state updater (Enrichment → Ingestion).
- **M1**: introduce the **outbox pattern** on Enrichment's write path.
  Same domain events; reliable publication to an OTEL collector
  (ADR-004) + future analytics consumers. Outbox is in Postgres
  (`enrichment_events_outbox` table); relay worker drains to the
  observability pipeline. *Postgres rows remain source-of-truth.*
- **M2+**: outbox publishes to AWS EventBridge or SNS for cross-service
  consumption (e.g., curriculum-analytics service per Expansion C M1+).
  No change to aggregate design; no change to "events are emitted not
  sourced".
- **M3**: even with OpenSearch as Search's read store (ADR-001), Postgres
  remains source-of-truth for aggregate state. The CQRS shape is at the
  store level; the event-emission pattern is unchanged.

If we ever need true ES (audit-grade legal requirement; complex
multi-actor workflows; replay-for-debugging at scale), the migration is
**non-trivial**: it would require adopting an event store, re-keying
aggregates by stream-ID, and projecting current state. We name this as
the "known migration cost" — not free, but tractable on a year-long
horizon if business value justifies it.

## References

- `docs/product/architecture/brief.md` §Domain Model 1–8 (the domain
  model this ADR ratifies)
- `docs/product/architecture/brief.md` §Domain Model 7 (the ES/CQRS
  evaluation — extended defense)
- `docs/feature/hybrid-search-medical-questions/feature-delta.md`
  (US-03 observability requirement; Locked Decisions: "no ES")
- `docs/feature/hybrid-search-medical-questions/expansions/A-llm-non-determinism.md`
  §3 (the F1–F7 decision matrix encoded in `EnrichmentTask` state
  transitions)
- `docs/feature/hybrid-search-medical-questions/expansions/E-cost-and-reenrichment.md`
  §5 (re-enrichment via `prompt_version` column comparison, no event
  replay)
- ADR-001 (Postgres as source-of-truth)
- ADR-002 (ingestion topology — the inner enrich-function is pure-ish
  over `(question, prompt, model)`, which is what makes
  emitted-not-sourced events sufficient)
