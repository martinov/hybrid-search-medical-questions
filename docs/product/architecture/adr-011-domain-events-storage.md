<!-- markdownlint-disable MD013 -->
# ADR-011 — Domain events storage: single `domain_events` table at PoC, outbox at M1+

**Status**: Accepted
**Date**: 2026-05-13
**Deciders**: solution-architect
**Wave**: DESIGN (Application architecture sub-wave)

## Context

ADR-006 (Aggregates with emitted events, no event sourcing) committed
the project to **emitted-but-not-sourced domain events**. The DDD
architect's brief (brief.md Domain Model 3) catalogs 16 distinct events
across the four bounded contexts. ADR-006 §Migration path specifies:

- **M0**: in-process events via typed EventEmitter; subscribers are the
  `logs/runs/{batch_id}.json` writer and the cross-context state updater.
- **M1+**: outbox pattern on the Postgres write side for reliable
  publication.

This ADR ratifies the **physical storage shape at M0** and the M1+
migration boundary. ADR-006 left the question "single events table or
per-context tables?" open; this ADR closes it.

Constraints:

- **No event sourcing** (ADR-006). Events are records of facts that
  happened, not the system of record.
- **Observability is the immediate value** (US-03): every event payload
  feeds `logs/runs/{batch_id}.json` aggregation.
- **PoC budget is binding**: a single inspectable surface is cheaper
  than 16 per-event tables or 4 per-context tables.
- **At-most-once delivery is acceptable at M0**: an in-process emitter
  can lose an event if the process crashes between emit and subscribe.
  Since observability is the only M0 consumer and observability is
  recovered from `logs/runs/` (which is fsync'd before exit), this
  trade-off is acceptable.

## Decision

**Adopt a single `domain_events` table at M0 as a write-through audit
surface. Promote to an outbox pattern (same table, with a `delivered_at`
column) at M1+ when external subscribers exist.**

Specifics:

### M0 storage shape

Single table `domain_events`:

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK (v7) | Sortable by time |
| `event_type` | `text` NOT NULL | E.g., `'EnrichmentSucceeded'`; constrained by a CHECK against the catalog values from Domain Model 3 |
| `aggregate_type` | `text` NOT NULL | `'Question' \| 'IngestionBatch' \| 'EnrichmentTask' \| 'Quarantine' \| 'ConversationSession'` |
| `aggregate_id` | `text` NOT NULL | The aggregate's own identity |
| `occurred_at` | `timestamptz` NOT NULL DEFAULT `now()` | Event time, not insert time |
| `payload` | `jsonb` NOT NULL | The full event payload from Domain Model 3 |
| `prompt_version` | `text` | Denormalized for slicing |
| `model` | `text` | Denormalized for slicing |
| `correlation_id` | `text` | Trace ID for cross-event correlation (request, batch, session) |

Indexes (M0):

- B-tree on `(aggregate_type, aggregate_id)` for per-aggregate trace queries
- B-tree on `(event_type, occurred_at DESC)` for histogram queries
- GIN on `payload` (optional at M0; required at M1+ for slicing by
  payload fields). M0 ships without it (10 questions = ~50 events; no
  index needed).

### M0 emission path

- In-process: a typed `EventBus` in `packages/observability/src/events.ts`
  exposes `emit<E extends DomainEvent>(event: E)`. Subscribers register
  via `bus.on('EnrichmentSucceeded', handler)`.
- **Two subscribers at M0**:
  1. `domainEventsRepo.insert(event)` — writes the row to
     `domain_events` synchronously *within the same Drizzle
     transaction* as the aggregate row. This is the load-bearing
     atomicity claim: the aggregate write and the event write commit
     or roll back together.
  2. `runSummaryAggregator.observe(event)` — in-memory aggregation for
     `logs/runs/{batch_id}.json`.
- **Cross-context handoff**: e.g., Enrichment emits `EnrichmentSucceeded`
  → an in-process listener calls `Question.markEnriched()` (Ingestion)
  to update lifecycle state. Both updates happen in adjacent calls;
  for PoC scope, eventual consistency between them is sub-second.

### M1+ promotion to outbox

The same table grows columns:

| New column | Type | Purpose |
|---|---|---|
| `delivered_at` | `timestamptz NULL` | NULL = not yet published; set when relay confirms |
| `delivery_attempts` | `integer DEFAULT 0` | For retry/backoff |
| `last_attempt_error` | `text NULL` | For poison-pill diagnosis |

A relay worker (`packages/observability/src/outbox-relay.ts`) polls
for `delivered_at IS NULL` rows, ships to the OTEL collector (ADR-004)
and to AWS EventBridge for cross-service consumption (Expansion C M1+
analytics service), sets `delivered_at` on success.

The relay is **at-least-once** delivery; subscribers must be idempotent.
The outbox row is the source of truth for *what should have been
delivered*; the actual external state is downstream and may be replayed
from `delivered_at IS NULL`.

## Consequences

### Positive

- **One table, all events**: trivial to query at PoC scope. `SELECT *
  FROM domain_events WHERE aggregate_id = ?` gives the per-aggregate
  trace. No joins, no per-event-type schema management.
- **Atomicity with aggregate writes**: at M0, the event insert and the
  aggregate insert share a Drizzle transaction. There is no scenario
  where the aggregate is written but the event is missed (or vice
  versa). This is the "events are facts that happened" contract,
  enforced.
- **Smooth M1 migration**: adding outbox columns is `ALTER TABLE ADD
  COLUMN` — no data migration. The application code that emits to the
  table stays unchanged; the relay is a *new* worker that drains
  un-delivered rows.
- **Sliceable by `prompt_version` and `model`**: denormalized columns
  on the table avoid expensive JSONB extraction for the slicing
  queries Expansion A §6 names.
- **GIN-on-JSONB at M1+**: when payload-field queries become common
  (e.g., "all `EnrichmentRetryScheduled` events with `failure_kind =
  F3`"), the GIN index handles them efficiently without a per-event-type
  table per kind.

### Negative

- **JSONB payload is schema-opaque to Postgres**: a typo in an
  application-side event payload (e.g., `bloom_lvl` instead of
  `bloom_level`) isn't caught by DB constraints. Mitigation: every
  event-emission point goes through a Zod schema (`packages/schemas`'s
  per-event Zod schema). The Zod parse is the type guarantee; the
  JSONB payload is "we Zod-validated this on the way in".
- **Single table grows large at M1+**: 16 events × scaled-up rate could
  produce millions of rows. Mitigation: partition by `occurred_at`
  (monthly) at M1+; older partitions move to cold storage. Not a
  PoC concern.
- **Cross-context handoff via in-process listener has a quiet
  failure mode at M0**: if the Enrichment context emits
  `EnrichmentSucceeded` but the in-process listener throws before
  updating the Question, the lifecycle_state stays stale. Mitigation:
  at M0, the listener is colocated and the throw bubbles to the
  emitter's call stack — visible in the run log. At M1+ when contexts
  span Lambda boundaries, the outbox + relay is the durability
  guarantee.
- **`SearchPerformed` event volume**: per Open Issue 6.4, this event
  fires for every search. At PoC scale: ~1 event per chat turn,
  trivial. At M2+ sustained 50 QPS: 50 events/s × 86,400 s =
  ~4.3M events/day for `SearchPerformed` alone. This is when
  partitioning + sampling becomes necessary (deferred to M2+ as that
  ADR-006 §Open Issue 6.4 notes).

## Alternatives considered

- **Per-event-type tables** (rejected): 16 tables, 16 migrations, 16
  query surfaces. The strongest argument *for* this design is
  per-event indexing (avoid the JSONB cost). At PoC scale we don't
  need it; at M1+ the GIN+payload approach gives the same result with
  one query plan.
- **Per-context tables** (rejected): 4 tables (one per bounded
  context). Less ceremony than per-event-type, more than single-table.
  No clear win at PoC; the boundary the Domain Model wants enforced
  is at the *aggregate* level (which the single table captures via
  `aggregate_type`).
- **Append-only event log in a separate store** (e.g., Kafka,
  EventBridge from day 1) (rejected): would re-introduce the
  event-sourcing infrastructure ADR-006 explicitly rejects. The
  outbox-in-Postgres at M1+ is the minimum reliable-delivery
  infrastructure for our scale.
- **No events table at all, only logs** (rejected): would lose the
  per-aggregate trace query (US-03 implies this: "Sam can decide
  if validation rate has regressed since the last prompt change"
  requires aggregating over events, ideally with SQL). The
  `logs/runs/{batch_id}.json` file gives a per-run aggregate;
  `domain_events` adds the per-aggregate-over-time slice.
- **AWS Kinesis Firehose from day 1** (rejected): cloud lock-in for a
  PoC. Right answer at M3+ if event volume becomes a Postgres
  pressure.

## Migration path

- **M0 → M1**: `ALTER TABLE domain_events ADD COLUMN delivered_at,
  delivery_attempts, last_attempt_error`. Add the relay worker.
  Update emission code to NOT immediately consider the event
  "delivered"; the relay handles that. Backfill: at M1 first start,
  all existing rows are marked `delivered_at = NOW()` (one-shot SQL),
  since their M0 subscribers already consumed them.
- **M1 → M2**: GIN index on payload. Partition by `occurred_at`
  monthly. Add EventBridge target for cross-service consumption
  (Expansion C analytics service).
- **M2 → M3**: if event volume from `SearchPerformed` exceeds Postgres
  capacity, switch to sampling (emit 1-in-N events) OR move that
  specific event type to Kinesis Firehose. The migration is
  per-event-type; other events remain in `domain_events`.

## Architectural enforcement

- **eslint-plugin-boundaries**: only `packages/observability` may
  insert into `domain_events`. Application code emits via the
  `EventBus`; the bus is the only writer. Centralizes the audit point.
- **Zod schema per event type** (`packages/schemas/src/events.ts`):
  every emit call passes through `EventSchema.parse(payload)` before
  insert. Drift between code and DB caught at runtime; smoke-tested
  at unit-test time.
- **DB CHECK constraint** on `event_type`: limits to the 16 catalog
  values. Migration ALTER if a new event is added.

## References

- ADR-006 (the parent decision: aggregates with emitted events, no ES)
- `docs/product/architecture/brief.md` §Domain Model 3 (the 16-event
  catalog)
- `docs/product/architecture/brief.md` §Domain Model 7 Criterion 4
  ("DR is Postgres-shaped, not bespoke")
- US-03 (observability requirements; per-run summary aggregation)
- Expansion A §6 (slicing dimensions: `prompt_version`, `model`,
  `medical_specialty`)
- Expansion C (M1+ analytics consumer)
- ADR-004 (OTEL at M1+ as the relay target)
