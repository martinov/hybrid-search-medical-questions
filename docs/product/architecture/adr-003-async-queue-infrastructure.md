<!-- markdownlint-disable MD013 -->
# ADR-003 — Async queue infrastructure: AWS SQS + Lambda at M1

**Status**: Accepted (for M1; M0 is synchronous per ADR-002)
**Date**: 2026-05-13
**Deciders**: system-architect
**Wave**: DESIGN (forward-looking — M1 scope)

## Context

ADR-002 commits to synchronous inline ingestion at M0 and async fan-out at
M1 (≈100k questions, internal use). This ADR selects the specific async
infrastructure for M1.

Constraints:

- **Stack target**: Netea uses AWS. Any M1+ infra should be AWS-native unless
  there's a compelling reason otherwise.
- **At-least-once delivery is acceptable** if writes are idempotent. The
  ingest function is a pure-ish function of `(question, prompt, model)`, so
  idempotency is achievable via a DB-level unique constraint (Risk R-08).
- **Operator visibility**: poison messages must be inspectable, not silently
  retried into oblivion (DLQ requirement).
- **Operational cost**: M1 is the "internal use, ≤100k corpus" milestone.
  Infra cost should not exceed ~$50/mo at this scale.

Alternative candidates considered: AWS SQS+Lambda, BullMQ (Redis-backed),
pg-boss (Postgres-backed), Kafka, Temporal, EventBridge.

## Decision

**Adopt AWS SQS (standard queue) + AWS Lambda workers at M1.** A separate
**SQS DLQ** captures poison messages (transport-poisoned). The existing
`quarantine` table continues to capture schema-poisoned messages — they
remain operationally distinct triage queues.

Specifics:

- **Queue**: SQS standard (not FIFO). At-least-once delivery accepted;
  idempotency is enforced application-side via
  `INSERT ... ON CONFLICT (source_question_id, prompt_version) DO NOTHING`.
- **Visibility timeout**: 6× the p99 per-question latency budget (Expansion A
  §3 max retries × per-call latency from `brief.md` §4.2) — initial value
  ~3 minutes; tunable as observed.
- **Lambda concurrency**: capped at 10–20 at M1 (Risk R-09). Above that,
  the Postgres connection pool is the bottleneck and **RDS Proxy** is
  added at the same milestone to pool connections.
- **DLQ**: poison messages (transport-failures exhausting the transport-retry
  budget) move to the DLQ after 5 failed delivery attempts. Operator
  inspects via the AWS Console or a thin `pnpm run dlq:list` CLI.
- **Message structure**: `{batch_id, source_question_id, prompt_version, payload_s3_uri?}`.
  Large question payloads (>200KB) are stored in S3 and referenced by URI;
  small payloads are inline.

The schema-retry budget from Expansion A §3 lives **inside** the Lambda
handler (same code as M0). The SQS visibility-timeout-based retry is the
**transport** retry. These two budgets are independent, per Expansion A §3.

## Consequences

### Positive

- **Managed infrastructure**: no servers to patch, no Kafka cluster to
  operate. Lambda and SQS are AWS-native; cost is per-request, not
  per-hour.
- **Native DLQ**: poison messages have a dedicated quarantine surface;
  operator inspection is one AWS console click or one CLI call.
- **Backpressure built-in**: if Lambda concurrency is capped and Postgres
  is busy, SQS messages queue up rather than overwhelming the database.
  This is the cleanest backpressure mechanism for our workload shape.
- **Re-usable from M0**: the Lambda handler invokes the same
  `enrichQuestion(q, ctx)` function that the M0 CLI uses (ADR-002 §Migration
  path). No semantic change to the inner function.
- **Cost predictable**: at 100k re-enrichments per month, SQS is <$0.10
  (first 1M requests free) and Lambda compute is ~$2-3. Compare to the
  OpenAI bill at the same scale (~$30 effective) — infra is <10% of API
  cost.
- **Standard AWS observability**: CloudWatch metrics for queue depth, age
  of oldest message, Lambda invocation count, error rate. OTEL hooks
  (ADR-004) emit traces from the Lambda.

### Negative

- **AWS lock-in (mild)**: SQS + Lambda are AWS-specific. Migration to GCP
  Pub/Sub or Azure Service Bus is non-zero work. Mitigation: the queue
  abstraction inside `packages/enrichment` exposes a `Producer` and
  `Consumer` interface; concrete SQS implementations are pluggable.
- **Cold-start latency on Lambda**: typical cold start ~500ms-2s for a
  Node.js Lambda with the AI SDK (`ai` + `@ai-sdk/openai`) loaded. Mitigation: Provisioned
  Concurrency at M2+ if cold-starts become a problem. At M1 (internal
  use), occasional cold starts are acceptable.
- **At-least-once delivery means duplicates are real**: Risk R-08 is the
  named risk; mitigation is the DB unique constraint. The cost is one
  potentially-wasted LLM call per duplicate. At an estimated <0.1%
  duplicate rate (SQS standard's typical behavior), this is a sub-$1
  cost at 100k corpus scale.
- **Lambda concurrency × Postgres connections** is a real failure mode
  (Risk R-09). Mitigation: RDS Proxy at the same milestone, hard cap on
  Lambda concurrency. Named explicitly so the M1 deployment doesn't ship
  without it.

## Alternatives considered

- **BullMQ (Redis-backed)** (rejected): introduces a Redis dependency
  whose only purpose is being a queue. AWS already provides SQS at a
  managed cost lower than running ElastiCache for queuing. Wins on
  developer experience (rich job-typing in TS) but loses on operational
  surface. We'd reconsider this if we already ran Redis for caching at M1
  — which we don't until M2.

- **pg-boss (Postgres-backed queue)** (rejected): seductive because
  Postgres is already deployed. But: (1) the Lambda fan-out story still
  needs Postgres connection management — pg-boss makes Postgres *both* the
  queue and the DB, doubling the contention; (2) the operator triage
  surface for poison messages is "another SQL table" — fine for M0, weak
  at scale; (3) the failure-mode story under burst load (queue and DB
  share the same I/O capacity) is worse than SQS+RDS. pg-boss is excellent
  for low-scale T3-style work; for M1+ we want the queue and the DB to be
  separate failure domains.

- **Kafka (MSK)** (rejected for M1): correct for high-throughput
  event-streaming workloads (millions of events/sec). Our M1 workload is
  ≤100k re-enrichments per *month*, which is ~0.04 events/sec average.
  Kafka is overkill. We'd revisit if we adopted event-sourcing — which
  the locked decisions explicitly rule out.

- **Temporal** (rejected): excellent for long-running workflows with
  complex retry/state machines. Our enrichment workflow is "call LLM,
  validate, embed, insert" — a single linear pipeline that fits in one
  Lambda invocation. Temporal's complexity earns its keep when workflows
  span minutes/hours with multiple decision points. Ours doesn't.

- **AWS EventBridge** (rejected for queuing role): excellent for fan-out
  to many consumers, weak as a queue (no native DLQ-style triage). It's
  the right tool for M1+ *event* distribution (e.g., "enrichment-completed"
  event consumed by analytics and re-indexing), but not for the work
  queue itself. Re-considered at M2+ as an addition, not a replacement.

## Migration path

This ADR is *forward-looking* — it commits M1 to SQS+Lambda. The M0→M1
transition mechanics are in ADR-002 §Migration path.

If M1 SQS+Lambda needs to be replaced (e.g., the team moves off AWS), the
`Producer`/`Consumer` interfaces in `packages/enrichment` are the
substitution boundary. Concrete SQS implementations are ~50 lines each;
replacing them is a one-PR change.

## References

- ADR-002 (the topology decision that this ADR's M1 portion implements)
- `docs/feature/hybrid-search-medical-questions/expansions/E-cost-and-reenrichment.md` §7 (production scale-up shape)
- `docs/feature/hybrid-search-medical-questions/expansions/A-llm-non-determinism.md` §3 (retry-budget separation)
- `docs/product/architecture/brief.md` §5 (M1 milestone), §7 (Risk R-08, R-09, R-10)
