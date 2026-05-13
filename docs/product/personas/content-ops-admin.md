# Persona: Content / Ops Admin (Ingester)

**Persona ID**: `content-ops-admin`
**Role**: Internal user (pipeline operator)
**Primary jobs**: `enrich-question-bank-reliably`, `reprocess-when-prompts-change`, `observe-pipeline-health`

## Snapshot

**Name (representative)**: Sam Chen
**Stage**: Content operations engineer at a medical-education platform. Owns the pipeline that takes question content from authors/vendors and gets it into the searchable corpus.
**Context**: Manages 10k-100k questions across multiple subject areas. New questions arrive in monthly batches (vendor licensing) plus continuous trickle (in-house authors). Already has data hygiene processes for raw content -- but the AI enrichment layer is new and unfamiliar.

## Demographics and constraints

- Backend engineer or technical operations role. Comfortable with CLI, Postgres, basic shell scripting
- Lives in a terminal and an IDE. Uses dashboards reluctantly -- prefers SQL queries and log greps
- Cost-conscious: knows that LLM tokens cost real money and that "just re-run it" is not a free operation
- Risk-averse about silent failures. A pipeline that silently mislabels 5% of questions is worse than one that crashes loudly on every error

## Mental model of "enrichment pipeline"

Sam thinks in terms of:

- **Idempotent operations**: "Can I re-run this on the same input and get the same result? If not, why not?"
- **Provenance**: "Which prompt version produced this row? Which model? When?"
- **Quarantine queues**: "What goes wrong gets parked, not silently dropped"
- **Cost per unit**: "What does it cost me to enrich 1000 questions? What if I have to re-do it?"
- **Schema contracts**: "If the LLM returns garbage JSON, where does that get caught?"

## Pains (Push forces)

1. **LLM non-determinism scares him.** He has seen pipelines where a prompt change subtly degrades quality and nobody notices for weeks.
2. **Re-running expensive jobs is painful.** If a prompt is bad, he wants to fix it and re-run only affected records, not the whole corpus.
3. **Silent schema drift is the worst outcome.** If a downstream consumer expects `bloom_level: "application"` and the LLM returns `"Application "` (trailing space) or `"applying"`, it should fail loud, not silent.
4. **Vendor-specific cost variance is unpredictable.** Token usage depends on question length; he wants a defensible cost model.

## Gains (Pull forces)

1. A pipeline where every enriched record is stamped with `prompt_version`, `model`, `enriched_at`
2. A quarantine table for records that fail validation, with the raw LLM output preserved for debugging
3. A simple retry policy with exponential backoff and a max-retry quarantine sink
4. Observable metrics: validation pass rate, retry rate, p95 latency per LLM call, total spend per batch
5. A way to re-enrich a filtered subset (e.g., "re-enrich all questions where `prompt_version < v3`") without touching the rest

## Anxieties

- "What if the LLM provider changes their model and my outputs drift without me knowing?"
- "What if I incur a $500 surprise bill because someone re-ran the whole corpus by accident?"
- "What if a partial failure leaves the corpus in an inconsistent state -- some questions enriched with v2 prompt, some with v3?"

## Habits

- Runs CLI commands. `pnpm run ingest` is a normal entry point for him.
- Greps logs. JSON-structured logs are preferred but pretty CLI output is fine for ad-hoc runs.
- Reads schema validation errors first when something fails

## What "success" feels like

A clean pipeline run with a summary at the end:

```
Ingested:    250 questions
Enriched:    247 (98.8%)
Quarantined:   3 (1.2%) -- see quarantine table
Cost:        $1.84 (avg $0.0074 / question)
Duration:    4m 12s
Prompt:      v3 (sha: 8af...)
Model:       gpt-4o-mini
```

He can defend that number to a finance team and re-run it tomorrow with identical results (modulo LLM noise).

## What he will judge the product on

1. Does the pipeline fail loud and recoverable, or silent and corrupting?
2. Is provenance complete enough to debug a quality regression three months later?
3. Is the cost predictable per batch?

## Out-of-scope for PoC

- Production-grade orchestration (Airflow, Temporal, etc.) -- a simple `pnpm run ingest` script is acceptable for PoC
- Multi-tenancy, RBAC, audit logs
- Distributed retry queues (in-memory or simple DB-backed retry is fine)
- Real-time alerting / on-call rotations
