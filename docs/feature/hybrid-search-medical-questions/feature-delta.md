<!-- markdownlint-disable MD024 -->
# Feature Delta: Hybrid Search & Intelligent Ingestion for Medical Questions

**Feature ID**: `hybrid-search-medical-questions`
**Wave**: DISCUSS
**Density**: lean + ask-intelligent
**Owner persona**: dual (medical-student + content-ops-admin)
**Last updated**: 2026-05-13

This document is the single Tier-1 [REF] DISCUSS artifact for the feature. It
references the SSOT (jobs.yaml, personas/, journeys/) and slice briefs without
duplicating their content.

---

## [REF] Job traceability

All user stories trace to entries in [`docs/product/jobs.yaml`](../../product/jobs.yaml).

| Job ID | Persona | Primary dimension | Opportunity score |
|---|---|---|---|
| `find-questions-by-clinical-intent` | medical-student | functional | 16 |
| `calibrate-cognitive-difficulty` | medical-student | functional | 14 |
| `feel-confident-before-exam` | medical-student | emotional | 15 |
| `enrich-question-bank-reliably` | content-ops-admin | functional | 14 |
| `reprocess-when-prompts-change` | content-ops-admin | functional | 12 |
| `observe-pipeline-health` | content-ops-admin | functional | 11 |
| `analyze-bloom-distribution` | curriculum-designer | functional | 8 (out of PoC scope) |

### Four Forces summary (medical-student, primary)

- **Push**: Keyword search wastes time; mismatched difficulty derails sessions; zero-result dead-ends spike anxiety; vendor taxonomies are inconsistent
- **Pull**: Type-clinical-scenario-in-plain-English-and-see-topical-results; trust that "heart failure symptoms" includes "dyspnea + JVD"; opt-in cognitive-level filter
- **Anxiety**: AI confidently shows off-topic questions; over-studies outside exam scope; tool feels slow
- **Habit**: UWorld filters by system / subsystem; Anki for recall; WhatsApp study group for "good questions on X"

### Four Forces summary (content-ops-admin)

- **Push**: LLM non-determinism is scary; expensive jobs are painful to re-run; silent schema drift is the worst outcome; vendor cost variance is unpredictable
- **Pull**: Every record stamped with prompt_version + model + enriched_at; quarantine for failures with raw output preserved; cost predictable per batch; filtered re-enrichment
- **Anxiety**: Model provider silently changes outputs; surprise $500 bill; partial failure leaves corpus inconsistent
- **Habit**: CLI commands (`pnpm run ingest`); grep logs; read schema errors first

---

## [REF] Personas

Full persona profiles live in [`docs/product/personas/`](../../product/personas/).

- [Medical Student (Priya Raman)](../../product/personas/medical-student.md) — primary
- [Content / Ops Admin (Sam Chen)](../../product/personas/content-ops-admin.md) — primary (operator-side)
- [Curriculum Designer (Dr. Maria Lourdes Santos)](../../product/personas/curriculum-designer.md) — tertiary (out of PoC scope but justifies enrichment ROI)

---

## [REF] Journeys

Full journey schemas (steps, emotional arcs, shared artifacts, Gherkin per step,
integration checkpoints, failure modes) live in [`docs/product/journeys/`](../../product/journeys/).

- [Student finds a topical question](../../product/journeys/student-finds-question.yaml) — emotional arc: anxious → focused → confident
- [Admin ingests and enriches a batch](../../product/journeys/admin-ingests-batch.yaml) — emotional arc: cautious → alert → confident

---

## Scope Assessment

Run BEFORE journey investment as required by the workflow gate.

**Verdict**: **Right-sized for the PoC, BUT at the upper boundary.**

| Signal | Threshold | This feature | Verdict |
|---|---|---|---|
| Story count | > 10 → oversized | 7 user stories (US-01..07) | Right-sized |
| Bounded contexts | > 3 → oversized | 4 contexts (ingest, enrich, search, chat) — at the line | At boundary |
| Walking-skeleton integration points | > 5 → oversized | 6 (JSON file → LLM API → Postgres → search SQL → agent tool → chat UI) — at the line | At boundary |
| Estimated effort | > 2 weeks → oversized | 8h PoC budget; 6 slices each 0.5-2 days | Right-sized |
| Independent user outcomes | Multiple shippable independently → consider split | Two (student-facing search; admin-facing pipeline) — but they SHARE the enriched corpus as the unifying artifact | Right-sized as bundle |

**Why we do not split despite the boundary**: the two personas share a single
data artifact (the enriched corpus). Splitting student-search from admin-ingest
into separate features would create a coordination problem (which feature owns
the schema? which owns Postgres setup?) without delivering value faster.

**Why this is defensible at staff level**: we acknowledge the boundary, we name
the signals, we mitigate scope risk via the elephant-carpaccio slices (6 thin
slices, each independently demoable, each with a learning hypothesis). The
walking skeleton is the first slice — it derisks the entire integration before
we invest in any one component.

**Reference**: [`slices/`](./slices/) — six slice briefs, each with taste-test verification.

---

## Story Map

### Backbone

| Discover question bank | Search by intent | Refine results | Open & study question | Operate the pipeline |
|---|---|---|---|---|
| Open chat UI | Type free-text query | Filter by Bloom level | Read question content | Run ingestion CLI |
| Read welcome / state | Watch agent retrieve | Ask follow-up | Decide next study step | Inspect run summary |
| | Read result cards | Refer to prior result | | Investigate quarantine |
| | | Recover from zero-results | | Re-run on changed prompt (future) |

### Walking Skeleton (Slice 01)

The horizontal line crosses every backbone column:

- **Discover**: render an empty chat UI
- **Search by intent**: one free-text query routed through the agent and the hybrid search endpoint
- **Refine**: not in skeleton; skeleton uses single-turn
- **Open & study**: result card shows title + content excerpt + bloom_level
- **Operate**: a `pnpm run ingest:one` command that loads one question end-to-end

### Release slicing

Each release targets one outcome KPI (see KPI section below).

| Release | Slices | Target outcome | Rationale |
|---|---|---|---|
| **R0 — Walking Skeleton** | [Slice 01](./slices/slice-01-walking-skeleton.md) | End-to-end flow works | Derisks integration backbone before any deeper investment |
| **R1 — Reliable Pipeline** | [Slice 02](./slices/slice-02-llm-resilience.md), [Slice 03](./slices/slice-03-observability.md) | Enrichment validity ≥ 90% first-try; quarantine ≤ 2%; cost-per-1k known | Closes the admin-ingest journey end-to-end |
| **R2 — Useful Student UX** | [Slice 04](./slices/slice-04-bloom-filter.md), [Slice 05](./slices/slice-05-conversation-context.md) | Top-3 contains a topical match for ≥ 80% of seed queries; conversation is multi-turn coherent | Closes the student journey beyond bare happy path |
| **R3 — Honest failure modes** | [Slice 06](./slices/slice-06-zero-result-recovery.md) | Zero-result dead-end rate < 5%; no hallucinated questions | Protects emotional arc; addresses anxiety force |

### Priority Rationale

1. **Walking Skeleton first** — riskiest assumption: can the 4-component integration even be built? Validate before investing.
2. **R1 (Reliable Pipeline) second** — the stakeholder discussion will pivot on LLM non-determinism handling. This is the single highest-leverage area for "staff-level thinking."
3. **R2 (Useful Student UX) third** — without R2 the student journey is bare-bones; with R2 the `calibrate-cognitive-difficulty` job is addressed.
4. **R3 (Honest failure modes) last** — high value emotionally but lower urgency for the 8-hour PoC; slip-safe if budget tight.

---

## System Constraints

Cross-cutting constraints applying to every story. These are technical realities,
not story-specific AC.

- **Stack is pre-decided** (downstream waves use as fixed input): TypeScript, Postgres + pgvector, OpenAI, Mastra agent framework, Vite + React with Vercel AI SDK `useChat`. DISCUSS does not re-litigate these.
- **Single embedding model** at ingest time and query time. Switching the embedding model invalidates all stored vectors.
- **Schema enforcement is mandatory at the LLM boundary.** Every LLM response passes a Zod parse before any write. There is no path from raw LLM output to the corpus without validation.
- **Provenance is mandatory.** Every enriched row carries `prompt_version`, `model`, `embedding_model`, `enriched_at`.
- **Quarantine is preferred over silent failure.** A record that cannot be validly enriched after the retry budget is exhausted MUST be parked in a quarantine table, not dropped, not silently corrupted, not written to the corpus.
- **Cost is observable per batch.** Token usage is captured per call; aggregate cost is reported in the run summary; finance-defensible numbers are a deliverable.
- **PoC budget is 8 hours total**. Slices have effort estimates summing within that envelope, with explicit slip-safe ordering (R3 is the first to cut).
- **No production-grade hardening** in PoC scope: no auth, no multi-tenancy, no real telemetry backend, no orchestrator (Airflow/Temporal), no distributed retry queue.

---

## User Stories

Seven LeanUX user stories, each with mandatory Elevator Pitch (Before / After /
Decision-enabled triplet), embedded AC, and `job_id` traceability.

Anti-pattern detection results: scanned for Implement-X, generic data, technical
AC, technical scenario titles, oversized stories, and abstract requirements.
All seven stories are clean.

### US-01: Walking Skeleton — One question end-to-end

- **job_id**: `find-questions-by-clinical-intent`
- **secondary_jobs**: [`enrich-question-bank-reliably`] (walking skeleton proves the admin pipeline works end-to-end)
- **Slice**: [Slice 01](./slices/slice-01-walking-skeleton.md)
- **MoSCoW**: Must Have
- **Effort**: 1-2 days
- **CLI contract**: `pnpm run ingest:one` is the documented npm-script alias for `pnpm run ingest --file data/sample-questions.json --limit 1` (the single-question walking-skeleton invocation). Defined in the canonical `package.json` snippet below.

#### Elevator Pitch

- **Before**: Priya cannot find topical practice questions when her query phrasing diverges from the question text. Sam has no pipeline yet — no way to enrich, no way to index.
- **After**: Sam runs `pnpm run ingest:one` and sees one enriched, indexed question. Priya types in the browser at `localhost:5173`, sends a clinical-intent query through the chat input, and sees the agent return that one matching question with title and content excerpt.
- **Decision enabled**: Priya can decide if the system "understands" her phrasing at all (she'll judge in 2 seconds based on whether the result looks topical). Sam can decide if the integration backbone is sound before investing in resilience and observability.

#### Problem

Priya Raman is a 3rd-year medical student 6 weeks out from USMLE Step 1. She is studying heart failure presentations from her textbook and wants to find practice questions that test the same clinical reasoning even when phrased differently. She finds it frustrating to translate her natural clinical-scenario phrasing into the keyword-filter syntax that UWorld and similar tools demand. Sam Chen is a content-ops engineer who needs a working ingestion path before he can build the operational features (retries, observability, batch). There is no system yet.

#### Who

- **Primary**: Priya (medical-student) — wants topical results from natural-language queries
- **Secondary**: Sam (content-ops-admin) — wants a working pipeline to extend

#### Solution

A minimal end-to-end slice: one CLI command ingests one question with LLM enrichment, writes it to Postgres with both tsvector and pgvector indexes populated, exposes a hybrid-search endpoint, wraps that endpoint in a Mastra agent tool, and renders the agent response in a chat UI driven by Vercel AI SDK `useChat`. No retries, no quarantine, no bloom filtering, no multi-turn.

#### Domain Examples

1. **Happy path (Priya)** — Priya opens `localhost:5173`, sees "Welcome. Ask about a clinical scenario, symptom, or topic." She types "shortness of breath with leg swelling" and presses Send. The agent streams back "I found 1 question: Cardiology: Patient Symptoms — 'A 68-year-old man presents with...'" within 4 seconds. She nods, makes a mental note, and decides this is worth a real demo.
2. **Happy path (Sam)** — Sam clones the repo, runs `pnpm install`, sets `OPENAI_API_KEY`, runs `pnpm run db:migrate` then `pnpm run ingest:one`. He sees `Enriched 1 question (id=q-001). bloom_level=application, keywords=[heart failure, dyspnea, JVD, peripheral edema]`. He can then `psql` into the DB and `SELECT * FROM enriched_questions` and see the row with both a non-null embedding and a non-null tsvector.
3. **Loud failure (Sam)** — Sam runs `pnpm run ingest:one` without `OPENAI_API_KEY` set. The pipeline exits with code 2 before any DB write, with the message `Error: OPENAI_API_KEY environment variable is required. Set it in .env or export it in your shell.` No partial state.

#### UAT Scenarios (BDD)

```gherkin
Scenario: Single question survives the full pipeline
  Given the file data/sample-questions.json contains a question titled "Cardiology: Patient Symptoms"
  And OPENAI_API_KEY is set in the environment
  And the database is migrated
  When Sam runs "pnpm run ingest:one"
  Then exactly one row exists in the enriched_questions table
  And that row has a non-null bloom_level
  And that row has a non-null keywords array
  And that row has a non-null embedding vector
  And that row's tsvector index covers title and content and keywords

Scenario: Student sees a topical result through the chat UI
  Given one question about heart failure has been ingested
  And the web app is running on localhost:5173
  When Priya navigates to the page
  And types "shortness of breath with leg swelling" into the chat input
  And presses Send
  Then the agent's response stream begins within 2 seconds
  And the response references the ingested question by its title
  And the response includes a content excerpt of at least 100 characters

Scenario: Hybrid search endpoint returns the ingested question via API
  Given one question about heart failure has been ingested
  When a client sends POST /api/search with body { "query": "patient with dyspnea and JVD", "limit": 5 }
  Then the response is 200 OK
  And the response body has a "results" array with at least 1 entry
  And the first result has fields: id, title, content, bloom_level, score

Scenario: Missing API key fails loud before any write
  Given OPENAI_API_KEY is NOT set in the environment
  When Sam runs "pnpm run ingest:one"
  Then the process exits with code 2
  And stderr contains "OPENAI_API_KEY environment variable is required"
  And the enriched_questions table is unchanged
```

#### Acceptance Criteria

- [ ] One row in `enriched_questions` after running `pnpm run ingest:one`, with non-null `bloom_level`, `keywords`, `embedding`, and lexical tsvector
- [ ] `POST /api/search` with a topical query returns at least one result with the expected shape
- [ ] Chat UI renders the agent's referenced question within 4 seconds of Send
- [ ] Missing `OPENAI_API_KEY` produces exit code 2 and zero DB writes
- [ ] No retry logic, no quarantine table required for this story (explicitly out of scope here, in Slice 02)

#### Outcome KPIs

- **Who**: Walking-skeleton integration
- **Does what**: completes the JSON → LLM → Postgres → search → agent → UI path for one question
- **By how much**: 1 question, p95 end-to-end ingest < 8s; p95 *time-to-first-token* of chat response < 2.0s (felt latency — what the student perceives); p95 *full chat response* (all result cards rendered) < 4.0s. Aligned with DESIGN back-of-envelope (`feature-delta.md §System Architecture Summary "Headline back-of-envelope numbers"`: first-token p95 ~1.4s, full response p95 ~3.5s).
- **Measured by**: manual demo + the four UAT scenarios above
- **Baseline**: no system exists

#### Technical Notes

- Embedding model: `text-embedding-3-small` (1536 dim); column `embedding vector(1536)`
- Chat model: `gpt-4o-mini` for cost containment; structured outputs feature used for enrichment
- Postgres extension `pgvector` required (migration creates it)
- tsvector is a Postgres-generated column over (title, content, array_to_string(keywords, ' '))

---

### US-02: LLM enrichment with retry and quarantine

- **job_id**: `enrich-question-bank-reliably`
- **Slice**: [Slice 02](./slices/slice-02-llm-resilience.md)
- **MoSCoW**: Must Have
- **Effort**: 1-2 days

#### Elevator Pitch

- **Before**: Sam knows LLM responses sometimes fail schema validation but has no mechanism to handle this. Either he writes garbage to the corpus or he loses records silently. Both are unacceptable.
- **After**: Sam runs `pnpm run ingest --file data/sample-questions.json` against a 10-question batch and sees per-question lines including `RETRY 1/2 (schema fail)` and `QUARANTINED`. After the run he can `SELECT * FROM quarantine WHERE batch_id='...'` and see the raw LLM output that failed validation, the parse error, and the source question.
- **Decision enabled**: Sam can decide whether to fix the prompt and re-run, accept the quarantine rate as the cost of doing business, or escalate a systematic enrichment quality issue.

#### Problem

LLM responses to a structured-output prompt fail Zod validation in roughly 5-15% of cases for medical content (trailing whitespace, enum near-miss like `"applying"` vs `"application"`, missing required field). If we write these to the corpus we corrupt it; if we drop them silently we lose data and trust. Sam needs a deterministic resilience policy.

#### Who

- **Primary**: Sam (content-ops-admin)

#### Solution

After each LLM call, Zod-parse the response. On parse failure, retry up to 2 times with exponential backoff. If all retries fail validation, insert a row into a separate `quarantine` table preserving the source question id, raw LLM responses (one per attempt), parse errors, and timestamp — and do NOT write to `enriched_questions`. Surface counts and a SQL query hint in the run summary.

#### Domain Examples

1. **First-try success (Sam)** — Question #3 ("Renal: AKI vs CKD"). LLM responds with valid JSON: `{"bloom_level":"analysis","keywords":["AKI","CKD","creatinine","FENa"], ...}`. Zod parse succeeds. Row inserted into `enriched_questions`. Per-line CLI: `[3/10] Renal: AKI vs CKD ........ ok (876ms)`.
2. **Retry success (Sam)** — Question #4 ("Endocrinology: DKA"). First LLM response has `"bloom_level": "applying"` which fails the enum check (expected `application`). Pipeline retries. Second response: `"bloom_level":"application"`. Zod parse succeeds. Row inserted with `retry_count=1`. CLI shows `RETRY 1/2 (schema fail)` then `ok`.
3. **Quarantine after exhaustion (Sam)** — Question #6 ("Neurology: Acute Stroke"). LLM returns malformed JSON on attempts 1 and 2 (e.g., truncated mid-output). Pipeline writes to `quarantine`: `{batch_id, source_question_id, raw_responses:[...], parse_errors:[...], quarantined_at}`. Per-line CLI: `RETRY 1/2`, `RETRY 2/2`, `QUARANTINED`. Run summary reports `Quarantined: 1`.

#### UAT Scenarios (BDD)

```gherkin
Scenario: Enrichment passes first-try
  Given a question "Renal: AKI vs CKD" is ready for enrichment
  When the pipeline calls the LLM
  And the response passes Zod validation
  Then a row is inserted into enriched_questions with retry_count = 0
  And no row is inserted into quarantine for this question

Scenario: Enrichment succeeds after one retry
  Given a question "Endocrinology: DKA" is ready for enrichment
  When the first LLM response fails Zod validation
  And the pipeline retries with exponential backoff
  And the second response passes validation
  Then a row is inserted into enriched_questions with retry_count = 1
  And no row is inserted into quarantine for this question
  And the CLI output for this question shows "RETRY 1/2" followed by "ok"

Scenario: Question is quarantined after retry budget exhausted
  Given a question "Neurology: Acute Stroke" is ready for enrichment
  And the LLM returns invalid responses for both initial attempt and the retry
  When the pipeline exhausts the retry budget
  Then a row is inserted into quarantine with the source_question_id, raw responses, parse errors, and batch_id
  And no row is inserted into enriched_questions for this question
  And the CLI output for this question shows "QUARANTINED" with the failure reason

Scenario: LLM rate-limit error is transparent to the schema-retry budget
  Given a question is ready for enrichment
  When the first LLM call returns a 429 rate-limit error
  And the pipeline backs off and retries
  And the second call returns a valid response
  Then a row is inserted into enriched_questions with retry_count = 0
  And the 429 retry is NOT counted toward the schema-retry budget

Scenario: Run summary reports validation rates accurately
  Given a batch of 10 questions has been processed with 7 first-try, 2 after-retry, 1 quarantined
  When the run summary prints
  Then it shows "Enriched: 9 (90.0%)"
  And it shows "first-try pass: 7 (70.0%)"
  And it shows "after retry: 2 (20.0%)"
  And it shows "Quarantined: 1 (10.0%)"
  And the summary values match COUNT queries against enriched_questions and quarantine for the batch_id
```

#### Acceptance Criteria

- [ ] Zod schema enforced on every LLM response before any DB write
- [ ] Retry budget configurable (default 2), with exponential backoff
- [ ] Transient errors (429, 5xx, network) are retried separately from schema-retry budget
- [ ] Quarantine table preserves raw responses (one per attempt), parse errors, source question id, batch id, timestamp
- [ ] Quarantined questions never reach `enriched_questions`
- [ ] CLI output shows per-question retry / quarantine status
- [ ] Run summary counts match DB counts for the batch

#### Outcome KPIs

- **Who**: enrichment pipeline operating on real LLM outputs
- **Does what**: validates structured outputs and routes failures to quarantine
- **By how much**: ≥ 90% of questions enriched (first-try + after-retry combined); ≤ 2% quarantined on a 10-question seed batch
- **Measured by**: post-run SQL queries against `enriched_questions` and `quarantine` for the batch id
- **Baseline**: no enrichment exists today

#### Technical Notes

- OpenAI structured-output feature reduces but does not eliminate schema drift; Zod parse on top is still mandatory
- Backoff: 1s, 2s (acceptable for PoC; production would use a proper backoff library)
- Quarantine table is NOT a retry queue; it is a triage queue inspected by a human
- Depends on US-01 (the integration backbone)

---

### US-03: Pipeline run observability — cost, latency, validation rate

- **job_id**: `observe-pipeline-health`
- **Slice**: [Slice 03](./slices/slice-03-observability.md)
- **MoSCoW**: Should Have
- **Effort**: 0.5-1 day

#### Elevator Pitch

- **Before**: Sam runs the pipeline and sees only success/failure per question. He has no idea what the batch cost, what the p95 latency was, or what the schema-pass-first-try rate was. He cannot defend the pipeline to Finance.
- **After**: Sam runs `pnpm run ingest --file data/sample-questions.json` and the final summary prints `Total cost: $0.0764`, `Avg latency: 978ms`, `p95 latency: 1.42s`, `first-try pass: 7 (70.0%)`. The summary is also persisted to `logs/runs/2026-05-13T10-42-00Z.json` so historical trends are inspectable.
- **Decision enabled**: Sam can decide if cost-per-question is acceptable, if latency degradation needs investigation, and whether validation rate has regressed since the last prompt change.

#### Problem

Without per-run metrics, Sam cannot answer "what does this cost?", "is this getting slower?", or "did the new prompt make things worse?" These are non-negotiable questions for an operator role.

#### Who

- **Primary**: Sam (content-ops-admin)

#### Solution

Capture per-LLM-call wall-clock duration and token usage (prompt + completion). Multiply tokens by a hardcoded pricing table (`src/pricing.ts`, easy to update) to estimate cost. Aggregate at run end: total cost, avg/p95 latency, first-try-pass / after-retry / quarantine rates. Print to stdout and write JSON record to `logs/runs/`.

#### Domain Examples

1. **Sam reviews a clean run** — `pnpm run ingest --file data/sample-questions.json` on 10 questions. Summary: `Total cost: $0.0764`, `Avg cost/q: $0.0085`, `Avg latency: 978ms`, `p95: 1.42s`. Sam: "OK. At $8.50 per 1000 questions and a 10k corpus, that's $85 to refresh. Reasonable."
2. **Sam spots a latency regression** — Same prompt, same model, different week: `p95 latency: 2.81s`. Sam reads previous week's `logs/runs/*.json`, confirms p95 was 1.42s last week. Files a ticket: "OpenAI gpt-4o-mini latency has roughly doubled; investigate."
3. **Sam spots a validation regression** — After tweaking the prompt: `first-try pass: 4 (40.0%)`, `Quarantined: 3 (30.0%)`. He reverts the prompt change immediately.

#### UAT Scenarios (BDD)

```gherkin
Scenario: Cost is reported per run
  Given a 10-question batch is processed
  When the run summary prints
  Then it shows total token usage (input + output)
  And it shows total cost computed from the pricing table for the model used
  And it shows average cost per question

Scenario: Latency is reported per run
  Given a 10-question batch is processed
  When the run summary prints
  Then it shows average LLM call latency in milliseconds
  And it shows p95 LLM call latency in milliseconds
  And it shows total run duration

Scenario: Validation breakdown is reported per run
  Given a batch with 7 first-try-pass, 2 after-retry, 1 quarantined
  When the run summary prints
  Then it shows first-try-pass rate as a percentage
  And it shows after-retry rate as a percentage
  And it shows quarantine rate as a percentage

Scenario: Run record is persisted
  Given a batch has completed
  When the pipeline writes the run record
  Then a file exists at logs/runs/{batch_id}.json
  And the file contains the same metrics as the printed summary
  And the file is valid JSON

Scenario: Historical comparison is possible from persisted runs
  Given runs/{batch_id_A}.json from yesterday and runs/{batch_id_B}.json from today exist
  When Sam queries jq across both files
  Then he can extract p95 latency from each
  And compare them with a single shell pipeline
```

#### Acceptance Criteria

- [ ] Total cost reported per run, computed from token usage × pricing table
- [ ] Avg and p95 LLM call latency reported per run
- [ ] First-try / after-retry / quarantine rates reported per run
- [ ] Run record persisted to `logs/runs/{batch_id}.json` with the same metrics
- [ ] Pricing table lives in code and is trivial to update for model changes

#### Outcome KPIs

- **Who**: Sam (content-ops-admin)
- **Does what**: defends pipeline cost and quality with quantitative numbers
- **By how much**: 100% of runs produce a summary with cost / latency / validation-rate; 0 silent failures
- **Measured by**: presence of `logs/runs/{batch_id}.json` for every ingestion command invocation
- **Baseline**: no metrics today

#### Technical Notes

- Pricing table is per-model, per-million-tokens (prompt + completion separately); updated manually
- Use `Date.now()` deltas for latency; no OTEL / Prometheus in PoC
- Depends on US-02 (run loop must exist to be measured)

---

### US-04: Student finds questions via hybrid search and chat

- **job_id**: `find-questions-by-clinical-intent`
- **Slice**: [Slice 01](./slices/slice-01-walking-skeleton.md) (initial), extended in [Slice 05](./slices/slice-05-conversation-context.md)
- **MoSCoW**: Must Have
- **Effort**: 1-2 days (initial; multi-turn refinement in US-06)

#### Elevator Pitch

- **Before**: Priya cannot search for questions using clinical-scenario phrasing. Keyword search misses questions phrased with synonyms; semantic search alone misses precise drug names. She gives up and falls back to UWorld's rigid filters.
- **After**: Priya opens `localhost:5173`, types "patient with shortness of breath, JVD, and ankle swelling" into the chat box, and presses Send. Within 4 seconds the agent has called the search tool, retrieved 3 candidate questions via hybrid (lexical + semantic) ranking, and presented them as cards with title, content excerpt, and Bloom level.
- **Decision enabled**: Priya decides which of the 3 questions to open and study, OR decides to refine ("application-level only"), OR decides the corpus does not have what she needs and moves on.

#### Problem

The medical-education domain has high vocabulary variance ("MI" / "myocardial infarction" / "heart attack" / "STEMI"). Pure lexical search misses synonyms. Pure semantic search misses precise terms that matter clinically (drug names, lab values, dosages). Neither alone is sufficient.

#### Who

- **Primary**: Priya (medical-student)

#### Solution

Hybrid search combines Postgres tsvector (lexical leg, weighted toward exact keyword/drug-name matches) and pgvector cosine similarity (semantic leg) with a documented ranking formula. Exposed via `POST /api/search`. Wrapped in a Mastra agent tool. Chat UI uses Vercel AI SDK `useChat` with streaming. Each result card shows title, excerpt, and bloom_level.

#### Domain Examples

1. **Synonym-rich query (Priya)** — Types "MI presentation in older woman". Search ranks a question titled "Myocardial Infarction: Atypical Presentation in 75-year-old Female" first because the semantic embedding matches strongly even though the literal string "MI" appears only as the abbreviation. Lexical leg picks up "older" → "75-year-old". Combined ranking puts this at rank 1.
2. **Drug-name-precise query (Priya)** — Types "ticagrelor vs clopidogrel mortality benefit". Lexical leg matches both drug names exactly. Semantic leg matches "mortality benefit antiplatelet trial". Top result is a question about the PLATO trial outcomes.
3. **Bloom-aware result rendering (Priya)** — Each card shows `Bloom: Application` (or `Analysis`, etc.) so Priya can decide at a glance whether to open a recall vs. application question.

#### UAT Scenarios (BDD)

```gherkin
Scenario: Student receives topical results from a clinical-intent query
  Given the corpus contains a question titled "Acute decompensated HF in ED"
  And another titled "Right vs. left HF distinguishing"
  When Priya types "patient with shortness of breath, JVD, and ankle swelling" into the chat input
  And presses Send
  Then the agent calls the search tool within 1 second
  And the agent's response references at least 2 of the topically-correct questions by title
  And the first agent token streams within 2 seconds
  And each referenced question card shows title, content excerpt, and bloom_level

Scenario: Hybrid search ranks synonym-matching results
  Given the corpus contains a question whose title says "Myocardial Infarction" and content describes a 75-year-old woman
  When a client posts to /api/search with query "MI presentation in older woman"
  Then the question above appears in the top 3 results
  And the response includes a score field per result

Scenario: Hybrid search preserves exact drug name matches
  Given the corpus contains a question mentioning "ticagrelor" and "clopidogrel"
  When a client posts to /api/search with query "ticagrelor vs clopidogrel mortality benefit"
  Then the question above appears as the top result
  And its score is at least 20% higher than the score of a question that only matches semantically

Scenario: Agent does not hallucinate questions
  Given the search returns 3 specific question ids
  When the agent composes its response
  Then every question title or id mentioned in the response appears in the search result set
  And no fabricated titles are introduced

Scenario: Result cards display bloom_level when present
  Given an enriched question has bloom_level = "application"
  When the agent presents that question as a result card
  Then the card text includes "Bloom: Application"
```

#### Acceptance Criteria

- [ ] `POST /api/search` accepts `{query, limit, bloom_level?}` and returns `{results: [{id, title, content, bloom_level, score}]}`
- [ ] Hybrid ranking combines tsvector and pgvector scores with a documented formula (e.g., reciprocal rank fusion or weighted sum)
- [ ] Mastra agent has a `search_questions` tool that calls the endpoint
- [ ] Chat UI uses Vercel AI SDK `useChat` and streams responses
- [ ] Each result card shows title, excerpt (≤ 200 chars), bloom_level
- [ ] Agent only references questions that are in the search result set

#### Outcome KPIs

- **Who**: Priya (medical-student) on a 10-question seed corpus
- **Does what**: receives at least one topically-correct question in the top 3 results
- **By how much**: ≥ 80% of seed queries (curated query set of 10 medical scenarios)
- **Measured by**: manual evaluation against a labeled set of (query, expected_topic) pairs in `data/seed-queries.json`
- **Baseline**: no system today; baseline is 0%

#### Technical Notes

- Hybrid ranking formula documented in DESIGN wave; defensible options include weighted score sum or reciprocal rank fusion (RRF)
- Search latency target: p95 < 800ms for the DB query portion (excludes agent reasoning)
- Depends on US-01 (skeleton must work) and US-02 (corpus must be populated)

---

### US-05: Filter results by Bloom level

- **job_id**: `calibrate-cognitive-difficulty`
- **Slice**: [Slice 04](./slices/slice-04-bloom-filter.md)
- **MoSCoW**: Should Have
- **Effort**: 1 day

#### Elevator Pitch

- **Before**: Priya gets a mix of recall, application, and analysis questions in every result set. She wastes time skipping recall questions when she wanted application practice.
- **After**: Priya types "only application-level, please" and the agent re-issues the search with `bloom_level=application`. The result cards show only application-level questions, and the agent states "Filtering to bloom_level: application (2 of 3 results matched)."
- **Decision enabled**: Priya decides which cognitive level matches her study mode today, and the tool keeps up.

#### Problem

Without cognitive-level filtering, the search treats a recall question and an analysis question as equally relevant to "heart failure". For an exam-prep student, these are different products. The `calibrate-cognitive-difficulty` job is unaddressed without this filter.

#### Who

- **Primary**: Priya (medical-student)

#### Solution

`POST /api/search` accepts an optional `bloom_level` field (enum). The agent's `search_questions` tool exposes this parameter. The agent extracts bloom-level intent from natural-language refinements ("application only", "give me analysis", "more recall practice") and passes the filter. When the filtered result set is empty but the unfiltered set was non-empty, the agent says so and offers the adjacent levels.

#### Domain Examples

1. **Explicit filter (Priya)** — "Show me application-level questions about heart failure." Agent calls `search_questions({query:"heart failure", bloom_level:"application"})`. Returns 4 application-level results.
2. **Refinement (Priya)** — After seeing 3 results (mixed), she says "Only application-level, please." Agent re-issues the search with the filter; returns the 2 matching results from the original set.
3. **Empty filter graceful (Priya)** — She asks for "evaluation-level questions about diabetic ketoacidosis." Filtered set is empty. Agent: "I have 0 evaluation-level DKA questions, but 3 application-level ones. Want those instead?"

#### UAT Scenarios (BDD)

```gherkin
Scenario: Explicit bloom-level filter from the start
  Given the corpus has questions across multiple bloom levels for "heart failure"
  When Priya types "application-level questions about heart failure"
  Then the agent calls search_questions with bloom_level = "application"
  And every returned question has bloom_level = "application"
  And the agent states the filter in its response

Scenario: Refining existing results by bloom level
  Given the agent has just presented 3 results with mixed bloom levels
  And 2 of those results have bloom_level = "application"
  When Priya says "only application-level, please"
  Then the agent presents only the 2 application-level results
  And the agent states "2 of 3 results matched"
  And the agent does not introduce questions outside the original result set

Scenario: Filtered set is empty but adjacent levels exist
  Given the search for "diabetic ketoacidosis" with bloom_level "evaluation" returns 0 results
  And the same search without the filter returns 3 results all at "application"
  When the agent composes its response
  Then the agent explicitly states "0 evaluation-level matches"
  And the agent offers the 3 application-level results as an adjacent option
  And the agent does not silently swap to the adjacent level

Scenario: Search API enforces enum on bloom_level
  When a client posts to /api/search with bloom_level = "applying"
  Then the response is 400 Bad Request
  And the response body explains the valid enum values
```

#### Acceptance Criteria

- [ ] `POST /api/search` accepts optional `bloom_level` enum; rejects invalid values with 400
- [ ] Mastra tool schema exposes the parameter
- [ ] Agent extracts bloom-level intent from natural-language refinements
- [ ] Filtered-empty + unfiltered-non-empty path explicitly states the situation and offers adjacent levels

#### Outcome KPIs

- **Who**: Priya
- **Does what**: filters to a specific cognitive level intentionally
- **By how much**: 100% of returned questions match the requested bloom_level when explicit; empty filtered set never silently swaps to a different level
- **Measured by**: UAT scenarios above + spot-check on seed queries
- **Baseline**: 0%; no filtering today

#### Technical Notes

- Enum: `remember | understand | apply | analyze | evaluate | create` (full Bloom 2001 revised taxonomy) — DESIGN wave to ratify exact values; PoC may use a 3-level subset (`recall | application | analysis`) for prompt simplicity
- Depends on US-04 (search endpoint) and US-02 (bloom_level on enriched rows)

---

### US-06: Multi-turn conversation context

- **job_id**: `find-questions-by-clinical-intent` (extends; multi-turn refinement is part of "find")
- **Slice**: [Slice 05](./slices/slice-05-conversation-context.md)
- **MoSCoW**: Should Have
- **Effort**: 0.5-1 day

#### Elevator Pitch

- **Before**: Every turn is a fresh search; "show me #2 in detail" routes to a new search instead of opening the second result. The tool feels disconnected.
- **After**: Priya says "open the second one" and the agent responds with the full content of result #2. She says "what about diagnosis-side questions instead?" and the agent issues a fresh search (topic shift detected). The conversation feels coherent.
- **Decision enabled**: Priya can refine, pivot, or drill into a specific result without restating the full context every turn.

#### Problem

A chat surface without conversation context is just a stateless search box wrapped in a textarea. The student's "in flow" emotional state depends on the agent keeping up across turns.

#### Who

- **Primary**: Priya (medical-student)

#### Solution

Vercel AI SDK `useChat` already maintains client-side message history and sends the full history on each turn. The agent's system prompt + tool descriptions instruct it to: (a) reuse prior search results for ordinal references ("the second one"), (b) detect refinement vs. topic shift, (c) issue a fresh search for topic shifts. No persistent storage in PoC.

#### Domain Examples

1. **Ordinal reference (Priya)** — Turn 1: agent returns 3 results. Turn 2: "Open the second one." Agent responds with the full content of result #2 (no new search).
2. **Refinement (Priya)** — Turn 3: "Only application-level among those." Agent filters the existing 3 results; presents 2 application-level ones (no new search).
3. **Topic shift (Priya)** — Turn 4: "What about diagnosis-side questions on this instead?" Agent detects topic shift, issues a fresh search with reformulated query.

#### UAT Scenarios (BDD)

```gherkin
Scenario: Ordinal reference resolves to previously-shown result
  Given the agent presented 3 results in the previous turn
  When Priya says "open the second one"
  Then the agent responds with the full content of the second result
  And the agent does not invoke search_questions for this turn

Scenario: Refinement reuses prior result set
  Given the agent presented 3 results in the previous turn including 2 application-level ones
  When Priya says "only application-level among those"
  Then the agent presents the 2 application-level results from the prior set
  And the agent does not issue a new search

Scenario: Topic shift triggers a fresh search
  Given the agent has been discussing heart failure questions
  When Priya says "what about diabetic ketoacidosis questions instead?"
  Then the agent issues a fresh search_questions call with the new topic
  And does not return heart-failure results

Scenario: Long history does not break the agent
  Given a conversation with 20 turns has accumulated
  When Priya asks a follow-up
  Then the agent still responds correctly within 5 seconds
```

#### Acceptance Criteria

- [ ] Vercel AI SDK `useChat` is the conversation surface; full history sent per turn
- [ ] Agent resolves ordinal references to prior results without re-searching
- [ ] Agent distinguishes refinement (no new search) from topic shift (new search)
- [ ] 20-turn conversation does not break the agent (token budget acceptable for PoC)

#### Outcome KPIs

- **Who**: Priya
- **Does what**: completes a multi-turn refinement flow without restating context
- **By how much**: 100% of ordinal references resolved correctly on a scripted 10-turn demo
- **Measured by**: scripted demo run with expected agent behavior per turn
- **Baseline**: 0%; no multi-turn today

#### Technical Notes

- No persistent conversation history in PoC; reload clears state
- Depends on US-04

---

### US-07: Honest zero-result handling with reformulation

- **job_id**: `feel-confident-before-exam` (this is the slice that protects the emotional arc)
- **Slice**: [Slice 06](./slices/slice-06-zero-result-recovery.md)
- **MoSCoW**: Could Have (slip-safe within 8-hour PoC budget; high emotional value but lower urgency)
- **Effort**: 0.5 day

#### Elevator Pitch

- **Before**: When the corpus genuinely has no matching question, the LLM tends to hallucinate plausible-sounding titles to fill the gap. This destroys trust in 2 seconds.
- **After**: Priya searches for an obscure combination ("Sjogren syndrome posterior column degeneration"). Agent: "I did not find any questions matching that combination. Three angles you could try: (1) Sjogren neurological complications, (2) posterior column degeneration alone, (3) peripheral neuropathy in autoimmune disease. Want me to try option 1?"
- **Decision enabled**: Priya decides whether to broaden, pivot, or accept the corpus does not cover this scenario — without losing trust in the tool.

#### Problem

Anxious users + empty results + a helpful-sounding LLM = a tool that fabricates results to feel useful. The result is a confident-sounding lie. For exam-prep where the stakes are real, this is the most dangerous failure mode.

#### Who

- **Primary**: Priya
- **Secondary**: trust in the system as a whole

#### Solution

`search_questions` tool returns a structured response `{results: [], reason: "no_match"}` when no matches exist (not just an empty array). Agent system prompt explicitly handles this case: state the truth, offer 2-3 reformulations generated from the original query (using LLM, not retrieval), and offer to try one if the user opts in.

#### Domain Examples

1. **Obscure query, honest response (Priya)** — "Sjogren syndrome posterior column degeneration" returns zero. Agent: "I did not find matches. Try: (1) ..., (2) ..., (3) ...." Priya picks option 1, gets relevant results.
2. **Typo recovery (Priya)** — "Cardiomyoptahy questions" (typo). Could go either way; if zero results, agent suggests "Did you mean cardiomyopathy?" as one of the reformulations.
3. **Honest failure (Priya)** — "Underwater basket weaving in medicine." Agent: "This does not appear to be a medical topic in our corpus. Did you mean to search for something else?"

#### UAT Scenarios (BDD)

```gherkin
Scenario: Zero results yield honest response with reformulations
  Given the search for "Sjogren syndrome posterior column degeneration" returns zero results
  When the agent composes its response
  Then the agent explicitly states no questions matched
  And the agent suggests at least 2 alternative queries derived from the original
  And the agent does not invent any question titles

Scenario: Off-topic query gets clarifying response
  Given the search for "underwater basket weaving" returns zero results
  When the agent composes its response
  Then the agent does not claim to have found matches
  And the agent asks if the user meant to search for something else

Scenario: User opts into a suggested reformulation
  Given the agent has offered 3 reformulations
  When Priya says "yes, try option 1"
  Then the agent issues a fresh search with the option-1 query
  And the new results are returned normally

Scenario: Honest empty response under conversation pressure
  Given a 10-turn conversation has accumulated
  And the latest search returns zero results
  When the agent composes its response
  Then the response still explicitly states no matches
  And does not paper over the empty result by referencing prior results out of context
```

#### Acceptance Criteria

- [ ] Search tool returns structured `{results:[], reason:"no_match"}` when empty
- [ ] Agent system prompt explicitly instructs honest empty-result handling
- [ ] Agent generates 2-3 reformulations on empty results
- [ ] Agent never invents titles not present in search results

#### Outcome KPIs

- **Who**: Priya facing a low-corpus-coverage query
- **Does what**: receives an honest empty response with actionable next steps instead of hallucinated results
- **By how much**: 0 hallucinated question titles on a curated empty-set test of 5 queries
- **Measured by**: manual review against an empty-set test set in `data/empty-seed-queries.json`
- **Baseline**: LLM-default behavior would hallucinate; baseline is "untrustworthy"

#### Technical Notes

- Agent system prompt requires careful drafting; pin the relevant section in the system-prompt file
- Depends on US-04

---

## Outcome KPIs Summary

### Objective

In 8 hours of focused PoC effort, demonstrate a hybrid-search system over LLM-enriched medical questions that handles ingestion non-determinism gracefully and serves a topical, cognitive-level-aware result through a chat agent in a browser.

### Outcome KPIs table

| # | Who | Does What | By How Much | Baseline | Measured By | Type |
|---|---|---|---|---|---|---|
| 1a | Walking-skeleton path (felt latency) | renders first agent token | p95 time-to-first-token < 2.0s; 1 question through all 6 stages | none | manual measurement per `tests/manual/kpi-p95-chat.md` | Leading |
| 1b | Walking-skeleton path (full response) | renders full agent response with result cards | p95 full chat response < 4.0s; p95 end-to-end ingest < 8s | none | manual measurement per `tests/manual/kpi-p95-chat.md` + UAT scenarios in US-01 | Leading |
| 2 | LLM enrichment | passes schema validation | ≥ 90% first-try OR after-retry; ≤ 2% quarantined | none | SQL count on `enriched_questions` vs `quarantine` per batch | Leading |
| 3 | Hybrid search | returns topical results | top-3 contains a topical match for ≥ 80% of seed queries | none | manual eval against `data/seed-queries.json` (10 curated) | Leading |
| 4 | Pipeline run | reports cost and latency | 100% of runs produce summary with cost + latency + validation rate | none | presence of `logs/runs/{batch_id}.json` | Leading |
| 5 | Bloom filter | returns matching level only | 100% of returned questions match requested bloom_level when explicit | none | UAT in US-05 + spot check | Leading |
| 6 | Agent | does not hallucinate | 0 invented questions on empty-set test of 5 queries | LLM-default would hallucinate | manual review against `data/empty-seed-queries.json` | Leading |
| 7 | Cost per 1000 enriched questions | stays within budget | known and bounded (estimate < $10/1k for gpt-4o-mini + text-embedding-3-small) | unknown | sum of `logs/runs/*.json` cost / count | Lagging |

### Metric Hierarchy

- **North Star**: hybrid search top-3 contains a topical match for ≥ 80% of seed queries (KPI #3)
- **Leading Indicators**: enrichment validity (KPI #2), latency p95 (KPI #1), no-hallucination rate (KPI #6)
- **Guardrails**: cost per 1k must not exceed $10 (KPI #7), quarantine rate must not exceed 5% (KPI #2)

### Measurement Plan (PoC scope)

| KPI | Data Source | Method | Frequency | Owner |
|---|---|---|---|---|
| Retrieval relevance (#3) | `data/seed-queries.json` + manual eval | one-shot eval at end of PoC | once | Sam (during demo) |
| Enrichment validity (#2) | SQL on enriched_questions vs quarantine | per-run | every ingest | pipeline |
| Latency p95 (#1, #4) | Date.now() deltas captured in run record | per-run | every ingest | pipeline |
| Cost (#4, #7) | token counts × pricing table | per-run | every ingest | pipeline |
| Hallucination (#6) | `data/empty-seed-queries.json` + manual review | one-shot eval | once | Sam |
| Bloom filter correctness (#5) | UAT + spot check | per scenario | one-shot | Sam |

### Hypothesis

We believe that a hybrid (lexical + semantic) search over LLM-enriched medical questions, accessed through a chat agent that handles empty-result and refinement cases honestly, will allow medical students to find topically-correct practice questions from clinical-scenario phrasing without depending on vendor-specific filter taxonomies. We will know this is true when top-3 retrieval relevance reaches ≥ 80% on a curated seed query set AND enrichment validity stays ≥ 90% first-try AND no hallucinated titles appear under empty-result conditions.

---

## Definition of Ready Validation

All 9 DoR items checked against the 7 user stories.

| DoR Item | Status | Evidence |
|---|---|---|
| 1. Problem statement clear and in domain language | PASS | Every story opens with "Priya / Sam + concrete situation + concrete pain". Domain terms used (Bloom level, tsvector, pgvector, Zod schema, quarantine, hybrid ranking) |
| 2. User/persona identified with specific characteristics | PASS | Two named representative personas (Priya Raman 3rd-year USMLE Step 1 prep; Sam Chen content-ops engineer); full persona files at `docs/product/personas/` |
| 3. 3+ domain examples with real data | PASS | Every story has 3 domain examples with realistic medical content (heart failure, MI, ticagrelor/clopidogrel, DKA, Sjogren) and named personas. No `user123` or `test@test.com` |
| 4. UAT scenarios in Given/When/Then (3-7 per story) | PASS | US-01: 4 scenarios; US-02: 5; US-03: 5; US-04: 5; US-05: 4; US-06: 4; US-07: 4. All within 3-7 range. Scenario titles describe business outcomes, not implementation |
| 5. AC derived from UAT | PASS | Every story has explicit AC list derived from its scenarios |
| 6. Right-sized (1-3 days, 3-7 scenarios) | PASS | All 7 stories estimated 0.5-2 days; all have 3-7 scenarios. Aggregate fits 8-hour PoC budget with slip-safe ordering (US-07 is Could Have) |
| 7. Technical notes identify constraints / dependencies | PASS | Each story has a Technical Notes block (pgvector dim, embedding model invariance, retry budget defaults, system-prompt pinning, etc.) |
| 8. Dependencies resolved or tracked | PASS | Dependency chain documented: US-01 (skeleton) → US-02 (resilience) + US-04 (UI) → US-03, US-05, US-06 → US-07. Stack pre-decided. No external blockers |
| 9. Outcome KPIs defined with measurable targets | PASS | Every story has Who / Does what / By how much / Baseline / Measured by. Aggregated in KPI table with 7 numeric targets and named measurement methods |

### DoR Status: **PASSED**

### Anti-pattern scan results

| Anti-pattern | Found? | Notes |
|---|---|---|
| Implement-X | No | All stories phrased as user outcomes |
| Generic data (user123, test@test.com) | No | All examples use Priya / Sam / Maria + realistic medical content |
| Technical AC ("use JWT") | No | AC describes observable behavior (SQL counts, response shape, UI text) |
| Technical scenario titles | No | Titles describe outcomes ("Student receives topical results", "Question is quarantined") not implementation ("ZodValidator throws on bad JSON") |
| Oversized story (>7 scenarios, >3 days) | No | All within bounds |
| Abstract requirements | No | All requirements grounded in concrete examples |

---

## Risk register

Surfaced for DESIGN wave; not managed here.

| Risk | Category | Probability | Impact | Mitigation approach |
|---|---|---|---|---|
| LLM provider rate-limits during ingestion | Technical | Medium | Medium | Exponential backoff; treat 429 separately from schema-retry budget (US-02) |
| OpenAI silently changes model output distribution | Technical | Medium | High | Pin `prompt_version` and `model` per enriched row; observability shows regression (US-03); ability to re-enrich (future) |
| pgvector + tsvector hybrid ranking formula is wrong | Technical | Medium | High | DESIGN wave to ratify; benchmark against seed query set (KPI #3); RRF is a safe default |
| 8-hour PoC budget overrun | Project | High | Medium | Elephant-carpaccio slicing; US-07 explicitly slip-safe; walking skeleton first means even a half-finished PoC has demonstrable value |
| Agent hallucinates result titles | Technical | High (LLM default) | Critical (trust collapse) | **Mitigation: [Slice 06 (Zero-result recovery)](./slices/slice-06-zero-result-recovery.md) is the dedicated mitigation slice** — US-07's discriminated `SearchResultSchema` (`kind: "no_match"` branch) + honest empty-result handling in agent system prompt. If Slice 06 slips (it is marked Could Have and slip-safe), the emotional-arc protection at the end-state is missing and this risk's residual likelihood reverts to High. |
| Embedding model change invalidates corpus | Technical | Low | High | Document constraint explicitly in System Constraints; future feature to re-embed entire corpus |
| LLM cost spikes from accidental re-runs | Project | Medium | Medium | Cost reported per run (US-03); `--dry-run` flag (future); CLI banner confirmation before destructive operations (future) |
| Demo connectivity to OpenAI fails during the live demo | Project | Medium | High | Pre-record demo video or have an offline backup; document model + key fallback |

---

## Handoff to DESIGN (solution-architect)

### Inputs DESIGN inherits

1. **SSOT job statements**: `docs/product/jobs.yaml` (7 jobs, opportunity-scored)
2. **SSOT personas**: `docs/product/personas/` (medical-student, content-ops-admin, curriculum-designer)
3. **SSOT journeys**: `docs/product/journeys/` (student-finds-question.yaml, admin-ingests-batch.yaml) with embedded Gherkin per step, shared artifacts, emotional arcs, failure modes, integration checkpoints
4. **This feature-delta.md**: 7 user stories with Elevator Pitch, AC, KPIs, DoR-passed
5. **6 slice briefs**: `slices/slice-01..06.md`, each with learning hypothesis and taste-test verification

### Stack inputs (pre-decided, do not re-litigate)

- TypeScript runtime
- Postgres + pgvector
- OpenAI (chat + embeddings)
- Mastra agent framework
- Vite + React + Vercel AI SDK `useChat`

### DESIGN-wave open issues (not blocking handoff, but to address there)

1. **Hybrid ranking formula**: choose between weighted-score-sum and reciprocal rank fusion. Recommend RRF as the default; document the choice.
2. **Bloom enum cardinality**: 6-level (full revised Bloom 2001) vs 3-level (recall/application/analysis). The 3-level subset is simpler for prompt enforcement; the 6-level is more useful for curriculum analytics (tertiary persona). PoC may ship 3-level and document the upgrade path.
3. **Quarantine inspection UX**: a CLI subcommand (`pnpm run quarantine:list`) or just SQL? Recommend SQL for PoC; CLI later.
4. **Pricing table source of truth**: hardcoded TypeScript constants vs pulled from OpenAI's billing API. Hardcoded is fine for PoC; flag upgrade path.
5. **Conversation history boundary**: 20-turn limit is mentioned in US-06 but not enforced. DESIGN should ratify or add a soft cap.

### DESIGN-wave NOT-open issues (already decided)

- Whether to use a vector DB (Pinecone, Weaviate, etc.) vs Postgres+pgvector → decided: pgvector
- Whether to use LangChain vs Mastra → decided: Mastra
- Whether to use Next.js vs Vite+React → decided: Vite+React (lighter for PoC; the chat UI does not need SSR)
- Whether to use Anthropic vs OpenAI → decided: OpenAI

### Handoff to DEVOPS (platform-architect)

Outcome KPIs above feed instrumentation planning. For PoC, this is light:

- `logs/runs/{batch_id}.json` capture for cost + latency + validation rate
- Production upgrade path: OTEL spans for LLM calls, Postgres pg_stat_statements for search query monitoring, dashboard on validation-rate over time

### Handoff to DISTILL (acceptance-designer)

- Journey YAMLs at `docs/product/journeys/` carry embedded Gherkin per step
- Each user story above has embedded UAT scenarios
- Shared artifacts in journey YAMLs identify integration checkpoints
- Outcome KPIs identify what "Done" looks like

---

## ask-intelligent expansion trigger detection

The active density mode is `lean + ask-intelligent`. Triggers were evaluated at wave end:

| Trigger | Fired? | Evidence |
|---|---|---|
| **Cross-context complexity** (≥ 3 technologies) | YES | 5 technologies on the critical path: TypeScript, Postgres+pgvector, OpenAI (chat + embeddings), Mastra, Vite/React+Vercel AI SDK |
| **Multi-stakeholder need** (≥ 3 personas) | YES | 3 personas surfaced: medical-student, content-ops-admin, curriculum-designer (tertiary but justifies enrichment ROI) |
| **High emotional stakes** (explicit anxiety dimension) | YES | Exam-prep anxiety is documented in `jobs.yaml` (`feel-confident-before-exam`) and persona file; emotional arc explicitly designed in both journeys |
| **Novel integration risk** (greenfield + multi-component + LLM non-determinism) | YES | Greenfield (no source code); 4-component integration; LLM-output validation as a first-class concern |

**Two or more triggers fired** → expansion menu is offered.

### Scoped expansion menu

Pick any subset; each adds a Tier-2 document under `docs/feature/hybrid-search-medical-questions/expansions/`:

- **[A] LLM non-determinism deep dive** — extended treatment of prompt-versioning, structured-output enforcement, Zod schema design, retry-vs-quarantine policy decision matrix. Defends the staff-level reasoning. Estimated 1-2 pages.
- **[B] Hybrid ranking formula comparison** — side-by-side analysis of weighted-score-sum, reciprocal rank fusion, and learned-to-rank approaches. Includes a worked example on a 3-question corpus. Estimated 1 page.
- **[C] Curriculum-designer analytics roadmap** — tertiary-persona roadmap showing how Bloom-level enrichment enables future curriculum analytics. Defends the enrichment investment beyond single-use. Estimated 1 page.
- **[D] Emotional-arc design rationale** — explicit mapping from student's anxiety/relief curve to specific UI affordances (streaming, honest empty-result handling, multi-turn coherence). Defends the UX choices. Estimated 1 page.
- **[E] Cost model and re-enrichment policy** — extended treatment of when to re-enrich, how to budget for prompt changes, how to migrate prompt versions in production. Defends the "this scales" discussion. Estimated 1 page.

**Default**: emit `DocumentationDensityEvent` records with kind `expansion-offered` for each option above; await user selection. No expansions are auto-generated.

If the user selects none, emit a single `expansion-declined` event and consider the DISCUSS wave complete as-is.

---

## Tier-2 Expansions (rendered)

User selected three Tier-2 expansions from the wave-end scoped menu above. Each is a standalone document under `expansions/`. The expansions defend the staff-level reasoning behind decisions already locked in this feature-delta; they do not introduce new requirements.

- **[A] LLM non-determinism deep dive** → [`expansions/A-llm-non-determinism.md`](./expansions/A-llm-non-determinism.md) — failure taxonomy (F1-F7), 5-layer defense in depth, retry/quarantine/accept decision matrix, prompt-versioning as migration mechanism, Bloom enum evolution playbook, Zod sketch, stakeholder talking points. `[WHY]`
- **[E] Cost model and re-enrichment policy** → [`expansions/E-cost-and-reenrichment.md`](./expansions/E-cost-and-reenrichment.md) — per-question cost decomposition, totals at 10k/100k/1M corpus sizes, re-enrichment triggers and lazy-policy recommendation, 5-stage prompt migration playbook, per-run budget guardrails, production scale-up shape. `[HOW]`
- **[C] Curriculum-designer analytics roadmap** → [`expansions/C-curriculum-analytics-roadmap.md`](./expansions/C-curriculum-analytics-roadmap.md) — tertiary-persona view roadmap, data-shape gap analysis (what PoC ships vs. what M1+ needs), M0-M3 phasing, "platform not feature" framing. `[HOW]`
- **[F] Fixture design discussion** → [`expansions/F-fixture-design.md`](./expansions/F-fixture-design.md) — fixture taxonomy (real-adapter / fake LLM / seed-data / browser), Vitest scope choices and per-scenario mock-LLM reset rule, honest blind-spot inventory of what mocks cannot model, Mastra ↔ AI SDK bridge implementation-agnostic seam, three code sketches (docker-compose, F4 mock, deterministic embedding), stakeholder talking points. `[WHY]`

DocumentationDensityEvent records emitted on 2026-05-13:

- `{ kind: "expansion-emitted", expansion_id: "A", path: "expansions/A-llm-non-determinism.md", pages: ~4 }`
- `{ kind: "expansion-emitted", expansion_id: "E", path: "expansions/E-cost-and-reenrichment.md", pages: ~3 }`
- `{ kind: "expansion-emitted", expansion_id: "C", path: "expansions/C-curriculum-analytics-roadmap.md", pages: ~1.5 }`
- `{ kind: "expansion-emitted", expansion_id: "F", path: "expansions/F-fixture-design.md", pages: ~3 }`

---

## Wave: DESIGN / [REF] System Architecture Summary

The system-architect sub-wave of DESIGN has run. Full output is at
[`docs/product/architecture/brief.md`](../../product/architecture/brief.md)
and the five accompanying ADRs in the same directory. This section is a
~1-page summary; do not duplicate the detail.

### Container shape (C4 L2)

Four deployable units + one shared package boundary:

- `apps/web` — Vite + React + Vercel AI SDK `useChat` (static SPA)
- `apps/api` — Hono HTTP server + Mastra agent (`POST /api/chat`, `POST /api/search`); single Node process at PoC
- `apps/ingestion` — synchronous CLI (`pnpm run ingest`)
- `packages/search` — RRF fusion (`k=60`) + lexical/semantic leg adapters, shared by API and ingestion
- Postgres 16 + pgvector + pg_trgm (single store: SoT + lexical index + semantic index)
- External: OpenAI (`gpt-4o-mini` for enrichment/chat; `text-embedding-3-small` for vectors)

All edges at M0 are synchronous. M1 wraps the ingestion inner function in
SQS + Lambda async; the API surface does not change.

### Headline back-of-envelope numbers

- **Per-question effective ingest cost** (with retry distribution): ~$0.00030 → ~$3.04 per 10k → ~$303.60 per 1M. Well below KPI #7's $10/1k budget.
- **Per-question ingest latency** (single attempt): p50 ~1.06 s / p95 ~1.74 s. Headroom against KPI's <8 s end-to-end p95.
- **Search end-to-end latency** (`/api/search`, 10k corpus): p50 ~90 ms / p95 ~230 ms. KPI #1 (<500 ms p95) met with ~270 ms headroom.
- **Chat first useful token latency**: p50 ~750 ms / p95 ~1.4 s. KPI (<4 s p95 full response) met (full response p95 ~3.5 s).
- **Storage at 1M rows**: ~29 GB total (data + HNSW + tsvector GIN). Fits a `db.t4g.medium` RDS; M3 OpenSearch migration triggers above ~5M.
- **M1 throughput at 10-20 Lambda concurrency**: ~10-14 questions/s; 100k re-enrich in ~2 hours, 1M in ~20 hours (within Expansion E §4 7-day drain ceiling).

### Roadmap (M0→M3)

- **M0 (PoC, current)**: synchronous CLI; single Postgres; stdout JSON logs + `logs/runs/{batch_id}.json`. Trigger to leave: >100 question batches OR first user-facing deploy.
- **M1 (Reliable batch, ≤100k internal)**: SQS + Lambda async ingestion (+ DLQ); RDS Proxy; idempotency keys; OTEL + Prom; lazy re-enrichment driven by `needs_reenrichment`; basic API auth. Trigger to leave: student-facing deploy approval OR sustained read QPS > 50 OR multi-tenant requirements.
- **M2 (Public read, ~1M student-facing)**: API auth + quotas; Postgres read replicas (mandatory); Redis query-result cache; CDN for the SPA; per-tenant partitioning. Trigger to leave: corpus >5M OR retrieval-relevance KPI <80%.
- **M3 (Scale ceiling)**: substitute pgvector → OpenSearch managed at the `packages/search` adapter boundary. Postgres remains SoT + analytics target (Expansion C BI views). API surface unchanged.

### ADRs produced

- [ADR-001](../../product/architecture/adr-001-search-backend.md) — search backend: pgvector with OpenSearch named exit
- [ADR-002](../../product/architecture/adr-002-ingestion-topology.md) — ingestion topology: synchronous inline at PoC, async-pool at M1
- [ADR-003](../../product/architecture/adr-003-async-queue-infrastructure.md) — async queue infrastructure: AWS SQS + Lambda at M1
- [ADR-004](../../product/architecture/adr-004-observability-strategy.md) — observability strategy: stdout JSON at PoC, OTEL+Prom at M1+
- [ADR-005](../../product/architecture/adr-005-embedding-model.md) — embedding model: `text-embedding-3-small` (1536-dim)

### Risk register additions (system-level)

Six new infrastructure risks added to `brief.md` §7 (R-07 through R-12),
complementing the application-level risks already in this file's risk
register: HNSW rebuild cost; SQS at-least-once → idempotency; Lambda
fan-out vs Postgres connection pool exhaustion; OpenAI 429 cascade;
embedding-model deprecation; cost runaway from accidental re-runs. Each
risk has a named mitigation and a tripwire metric.

### Handoff to DDD / solution architects

The `brief.md` file has placeholder sections (`## Domain Model`,
`## Application Architecture`) awaiting append by the DDD architect and
solution architect respectively. The system-architect section is closed.
Five open issues are flagged in `brief.md` §8 for stakeholder discussion;
none reopen locked decisions.

---

## Wave: DESIGN / [REF] Domain Model Summary

The ddd-architect sub-wave of DESIGN has run. Full output is in the
`## Domain Model` section of [`docs/product/architecture/brief.md`](../../product/architecture/brief.md)
(Sections Domain Model 1 through Domain Model 9). This section is a ~1-page
summary; do not duplicate the detail.

### Bounded contexts (4)

| Context | Subdomain | Aggregates | Headline events emitted |
|---|---|---|---|
| **Ingestion** | Supporting | `Question` (lifecycle root), `IngestionBatch` (cohort root) | `BatchOpened`, `QuestionIngested`, `QuestionValidationFailed`, `BatchClosed`, `BatchAborted` |
| **Enrichment** | **CORE** | `EnrichmentTask` (encodes F1–F7 decision matrix), `Quarantine` (triage queue) | `EnrichmentAttempted`, `EnrichmentSucceeded`, `EnrichmentRetryScheduled`, `EnrichmentQuarantined`, `EmbeddingGenerated`, `QuestionIndexed` |
| **Search** | **CORE** | None — query-only context; `HybridQuery` is a port, `SearchResult` a view model, `RrfFusion` a stateless domain service | `SearchPerformed`, `ZeroResultEncountered` |
| **Conversation** | Supporting | `ConversationSession` (in-memory at PoC), `ChatTurn` (value object at PoC, aggregate root at M1+) | `ChatTurnStarted`, `ChatTurnCompleted`, `ZeroResultReformulationTriggered` |

### Integration patterns (5 seams)

- **Ingestion → Enrichment**: Customer-Supplier; in-process call at PoC, SQS at M1+.
- **Enrichment → Postgres (write)**: Shared Kernel (deliberate simplification with documented M3 exit via ADR-001).
- **Search → Postgres (read)**: Conformist to Enrichment's schema; read-replica at M2+.
- **Conversation → Search**: Customer-Supplier; Mastra `search_questions` tool is the adapter.
- **Enrichment → OpenAI**: **Anti-Corruption Layer** (the five-layer defense from Expansion A §2 *is* the ACL).
- **Conversation → OpenAI**: Conformist (deliberate exception; Mastra speaks OpenAI streaming natively).

### Ubiquitous language highlights (full glossary in brief.md §Domain Model 4)

- **Bloom level** (3-level PoC: `recall|application|analysis`; target 6-level full Bloom 2001)
- **Enriched question** vs **Quarantined question** — distinct lifecycle terminals
- **Hybrid search** = Lexical (tsvector + GIN) + Semantic (pgvector HNSW) fused by **RRF k=60**
- **Prompt version** — immutable string on every row; drives Expansion E §5 migration playbook
- **Provenance** — `prompt_version`, `model`, `model_temperature`, `embedding_model`, `enriched_at`, `retry_count` on every enriched row
- **Failure kind (F1–F7)** — Expansion A taxonomy; F4 explicitly not detectable at write time

### ES/CQRS verdict

**No event sourcing.** State-based aggregates with emitted-but-not-sourced
domain events. Defended on five named criteria in brief.md §Domain Model 7:
no full-audit requirement (US-03 wants observability, not audit); temporal
queries reduce to `prompt_version` comparison; single read model at M0 (CQRS
shape arrives naturally at M3 via OpenSearch substitution, not as a
pre-built pattern); Postgres is DR target (no event-replay recovery);
`EnrichmentTask` state machine is second-scale, not workflow-scale.
Captured in [ADR-006](../../product/architecture/adr-006-aggregates-with-events-no-event-sourcing.md).

### Open issues for solution-architect (5)

1. **Quarantine: separate aggregate or Question state?** — Recommendation:
   separate aggregate (triage lifecycle is real; raw_responses don't belong on Question hot row).
2. **ChatTurn persistence?** — Recommendation: PoC = value object inside ConversationSession;
   M1+ = aggregate root with persistence (audit + fine-tuning dataset).
3. **`Prompt` as aggregate or string column?** — Recommendation: string column;
   prompt is code, not runtime data. Don't create a `prompts` table.
4. **Emit `SearchPerformed` for every search?** — Recommendation: yes at M0–M1;
   consider sampling at M2+ if cost-significant.
5. **Conversation context's own data store?** — Recommendation: Postgres for everything through M2.

### ADRs produced (1)

- [ADR-006](../../product/architecture/adr-006-aggregates-with-events-no-event-sourcing.md) — Aggregates with emitted events, no event sourcing (the load-bearing domain-modeling decision)

### Risk register additions (domain-level)

None new at the domain level beyond what brief.md §7 already names. The
domain-level analogues of those risks (e.g., R-08 idempotency = aggregate
identity hygiene; R-11 embedding deprecation = ACL stability at the
OpenAI seam) are addressed structurally by the aggregate and ACL designs.

### Handoff to solution-architect

`brief.md` has a `## Application Architecture` section still reserved.
The solution-architect should:

1. Map the four bounded contexts to package/module boundaries
   (`apps/ingestion`, `apps/api`, `packages/search`, `packages/enrichment`).
2. Ratify the 5 open issues from §Domain Model 6.
3. Decide concrete tech for in-process event emission (typed
   `EventEmitter` vs Mastra hooks vs a lightweight pub/sub).
4. Confirm the Mastra tool-result schema can express `{ results: [],
   reason: 'no_match' }` (Open Issue brief.md §8.5).
5. Design the M1+ outbox pattern (ADR-006 Migration path).

---

## Wave: DESIGN / [REF] Application Architecture Summary

The solution-architect sub-wave of DESIGN — the third and final architect — has
run. Full output is appended as the `## Application Architecture` section of
[`docs/product/architecture/brief.md`](../../product/architecture/brief.md)
and the five new ADRs (`adr-007` through `adr-011`) in the same directory.
This section is a ~1-page summary; do not duplicate the detail.

### Headline result

Three apps (`apps/web`, `apps/api`, `apps/ingestion`) + six packages
(`packages/schemas`, `packages/db`, `packages/enrichment`,
`packages/search`, `packages/observability`, optional
`packages/conversation` at M1+) map cleanly to the four bounded contexts
from `## Domain Model`. Hexagonal port/adapter pattern enforced at the
package boundary via `eslint-plugin-boundaries`. The two CORE contexts
(Enrichment and Search) have C4 Component diagrams in
`brief.md §Application Architecture 2`.

### Technology stack pinned (current stable as of 2026-05-13; user-corrected and context7-verified; DELIVER re-verifies exact patches at install)

- Node.js 24 LTS, TypeScript 6.x, pnpm 9, Turborepo 2 (ADR-007)
- Hono 4 + `@hono/zod-validator` + `@hono/node-server` (ADR-008)
- `drizzle-orm@0.45.2` + matching `drizzle-kit` + `drizzle-zod` (Zod-4-compatible release) + `postgres` 3.4+ (ADR-009)
- `zod@4.x` (ADR-010); native `z.toJSONSchema()` (built-in, replaces `zod-to-json-schema`); `.strict()` everywhere on boundary schemas
- `@mastra/core@1.32.0` + Vercel AI SDK `ai@5.x` (DISCUSS-locked, user-pinned, context7-verified; see Open Issue ENRICH-DELIVER-01 below)
- **No direct `openai` Node SDK** — all LLM calls go through `ai@5.x` (`generateObject` for enrichment, `embed`/`embedMany` for vectors, `streamText` via Mastra for chat) with `@ai-sdk/openai` as the provider. Single LLM abstraction; provider-agnostic at call sites.
- pgvector 0.8+, Postgres 16
- React 19, Vite 5/6, native `fetch`
- Vitest 2, ESLint 9 with `eslint-plugin-boundaries` for layer enforcement

All choices are MIT, Apache-2.0, BSD, PostgreSQL License, or Unlicense.
**Zero proprietary**.

### Mastra tool-result schema verification (DIVERGE §5b concern)

`SearchResultSchema` is a `z.discriminatedUnion("kind", [...])` with
`kind: "results" | "no_match"`. Mastra tools accept arbitrary Zod
output schemas, so the structured-empty shape is expressible. Two
verification items deferred to DELIVER (smoke-test in walking
skeleton): (1) Mastra ↔ Vercel AI SDK streaming bridge, (2)
discriminator preservation through serialization. Fallback: use
Vercel AI SDK's `streamText` directly with Mastra reduced to a tool
registry, or removed entirely. Bounded blast radius — change is
confined to `apps/api/src/conversation/agent.ts`. Logged as Open
Issue ENRICH-DELIVER-01 in `brief.md §Application Architecture 12`.

### ADRs produced (5)

- [ADR-007](../../product/architecture/adr-007-monorepo-tooling.md) — pnpm + Turborepo
- [ADR-008](../../product/architecture/adr-008-api-framework.md) — Hono
- [ADR-009](../../product/architecture/adr-009-orm-and-migrations.md) — Drizzle ORM
- [ADR-010](../../product/architecture/adr-010-zod-schema-strategy.md) — Zod strict + shared package
- [ADR-011](../../product/architecture/adr-011-domain-events-storage.md) — Single `domain_events` table + M1 outbox

### Risk register additions (6, application-level R-13..R-18)

`brief.md §Application Architecture 11` adds: Zod↔Drizzle drift,
Mastra↔AI SDK protocol drift, useChat↔Mastra UI assumption mismatch,
Vite+Hono bundler mismatch, HNSW-on-10-questions non-representativeness,
`drizzle-zod` refinement loss on regen.

### Domain Model 6 open issues — all five resolved

1. Quarantine as separate aggregate — **YES**, separate table + repo.
2. ChatTurn persistence — **PoC no, M1+ yes** (`chat_turns` table sketch
   in brief.md §Application Architecture 6.1).
3. `Prompt` as column or aggregate — **column** (`prompt_version text`).
4. `SearchPerformed` per search — **yes at M0–M1**, revisit M2+.
5. Conversation context's own store — **no, Postgres for everything
   through M2**.

### Handoff to DISTILL

DISTILL (acceptance-designer) inherits: the C4 Component diagrams as
visual referents, the canonical Zod schemas (`SearchResultSchema`
discriminated union is load-bearing for US-07), the component
decomposition table to scope tests, the 8 DELIVER open issues (tests
should not depend on specific resolutions), and the contract-test
annotation in `brief.md §Application Architecture 13` for
coordination with platform-architect on OpenAI / Mastra / Vercel AI
SDK external integrations.

---

## Wave: DESIGN / [REF] Component Decomposition

The full table is in `brief.md §Application Architecture 1`. One-line
summary:

| App/Package | Path | Context | Type |
|---|---|---|---|
| `apps/web` | `apps/web/` | Conversation (UI) | NEW |
| `apps/api` | `apps/api/` | Conversation (server) + Search (driving) | NEW |
| `apps/ingestion` | `apps/ingestion/` | Ingestion + Enrichment (driving) | NEW |
| `packages/schemas` | `packages/schemas/` | shared kernel (Zod + types) | NEW |
| `packages/db` | `packages/db/` | shared kernel (Drizzle + migrations) | NEW |
| `packages/enrichment` | `packages/enrichment/` | Enrichment (CORE) | NEW |
| `packages/search` | `packages/search/` | Search (CORE) | NEW |
| `packages/observability` | `packages/observability/` | cross-cutting (events + run summaries) | NEW |
| `packages/conversation` | `packages/conversation/` | Conversation (M1+ promotion) | M1+ |

Hexagonal layering inside each package: `domain/`, `application/`
(with `ports/`), `infrastructure/` (adapters). Composition root is
the consuming app's `main.ts` / `cli.ts`. Enforced by
`eslint-plugin-boundaries` per ADR-007.

---

## Wave: DESIGN / [REF] Reuse Analysis

| Existing Component | File | Overlap | Decision | Justification |
|---|---|---|---|---|
| (greenfield — no prior code) | n/a | n/a | CREATE NEW (entire feature) | Initial PoC implementation; the repo contains documentation only at this writing. Hard gate satisfied. |

---

## Wave: DESIGN / [REF] Technology Choices

Full rationale + alternatives in ADRs 007–011 and
`brief.md §Application Architecture 4`. Summary:

| Concern | Pinned choice | ADR / brief reference |
|---|---|---|
| Runtime | Node 24 LTS | §1.4 |
| Language | TypeScript 6.x | §1.4 |
| Package mgmt | pnpm 9 workspaces | ADR-007 |
| Task runner | Turborepo 2 | ADR-007 |
| HTTP framework | Hono 4 | ADR-008 |
| Streaming + agent | Vercel AI SDK `ai@5.x` + `@mastra/core@1.32.0` (user-pinned, DISCUSS-locked) | §1.8 + ENRICH-DELIVER-01 |
| LLM access | `@ai-sdk/openai` provider (consumed by `ai@5.x` via `generateObject` / `embed` / `streamText`). **No direct `openai` Node SDK.** | §1.4 + ADR-010 |
| ORM | `drizzle-orm@0.45.2` | ADR-009 |
| Postgres driver | `postgres` 3.4+ | ADR-009 |
| Validation | `zod@4.x` (`.strict()`; built-in `z.toJSONSchema`) | ADR-010 |
| Bloom enum storage | `text` column + CHECK + Zod (DIVERGE §5a) | §1.6 |
| Event storage | `domain_events` single table; outbox at M1+ | ADR-011 |
| Testing | Vitest 2 | §1.4 |
| Front-end | React 19 + Vite 5/6 + native fetch | §1.4 |
| Lint enforcement | ESLint 9 + `eslint-plugin-boundaries` | ADR-007 |

All OSS; permissive licenses; zero proprietary.

---

## Wave: DESIGN / [REF] Decisions table

Consolidated design decisions across all three sub-waves
(system-architect, ddd-architect, solution-architect). Numbering
follows the ADR sequence; "DM" prefixes are Domain-Model-driven
decisions ratified in §Application Architecture 10.

| # | Decision | Owner | Reference |
|---|---|---|---|
| D-001 | Single Postgres + pgvector + tsvector store; OpenSearch as named M3 exit | system-architect | ADR-001 |
| D-002 | Synchronous inline ingestion at M0; SQS+Lambda at M1; T2 (`p-limit`) if batch >100 | system-architect | ADR-002 |
| D-003 | Async queue infra at M1+: AWS SQS + Lambda + DLQ + RDS Proxy | system-architect | ADR-003 |
| D-004 | Observability: stdout JSON + `logs/runs/{batch_id}.json` at M0; OTEL+Prom at M1+ | system-architect | ADR-004 |
| D-005 | Embedding model: `text-embedding-3-small` (1536-dim) | system-architect | ADR-005 |
| D-006 | Aggregates with emitted-but-not-sourced domain events; no ES | ddd-architect | ADR-006 |
| D-007 | Monorepo tooling: pnpm workspaces + Turborepo 2 | solution-architect | ADR-007 |
| D-008 | API framework: Hono 4 + zod-validator | solution-architect | ADR-008 |
| D-009 | ORM: Drizzle ORM + drizzle-zod (DB → Zod codegen direction) | solution-architect | ADR-009 |
| D-010 | `zod@4.x` as universal validator (user-pinned, context7-verified); `.strict()` on all boundary schemas; schemas live in `packages/schemas`; native `z.toJSONSchema()` replaces `zod-to-json-schema` | solution-architect | ADR-010 |
| D-011 | Single `domain_events` table at M0; outbox columns added at M1+ | solution-architect | ADR-011 |
| DM-1 | Bloom enum stored as `text` + CHECK constraint, NOT Postgres enum | DIVERGE §5a → ratified by ddd + solution | brief.md §Domain Model 4 + §Application Architecture 6.1 |
| DM-2 | Quarantine is a separate aggregate (own table + repo + triage lifecycle) | ddd-architect; solution-architect ratifies | DM 6.1 + §Application Architecture 10 |
| DM-3 | `ChatTurn` is a value object at M0; aggregate root + persistence at M1+ | ddd-architect; solution-architect ratifies | DM 6.2 |
| DM-4 | `prompt_version` is a column; prompt text is code (in `packages/enrichment/src/prompts/`) | ddd-architect; solution-architect ratifies | DM 6.3 |
| DM-5 | `SearchPerformed` event emitted for every search at M0–M1 | ddd-architect; solution-architect ratifies | DM 6.4 |
| DM-6 | Conversation context uses Postgres (no separate store) through M2 | ddd-architect; solution-architect ratifies | DM 6.5 |
| DM-7 | RRF fusion at the application layer (TypeScript pure function), not in SQL | system-architect default; solution-architect ratifies | brief.md §Application Architecture 7 |
| DM-8 | Two parallel SQL queries + RRF fusion (NOT a single CTE) | solution-architect | brief.md §Application Architecture 2.3 |
| DM-9 | Mastra `search_questions` tool returns `z.discriminatedUnion("kind", [...])`; `kind: "no_match"` carries US-07 reason | solution-architect | brief.md §Application Architecture 1.5 + 1.8 |

---

## Wave: DESIGN / [REF] Driving Ports + Driven Ports + Adapters

Inbound (driving) and outbound (driven) ports per bounded context.
Full layout in `brief.md §Application Architecture 2`.

### Ingestion context

- **Driving**: `IngestBatchCommand`, `IngestOneCommand` (from CLI)
- **Driven**: `RawQuestionSourcePort` (filesystem JSON adapter),
  `EnrichmentPort` (in-process @M0 / SQS @M1),
  `QuestionRepoPort` (Drizzle Postgres),
  `IngestionBatchRepoPort` (Drizzle Postgres),
  `DomainEventsPort` (`@netea/observability`)

### Enrichment context (CORE)

- **Driving**: `enrichQuestion(q, ctx)` function export
- **Driven**: `LlmEnrichmentPort` (OpenAI Structured Outputs adapter
  — the ACL boundary), `EmbeddingPort` (OpenAI embeddings adapter),
  `EnrichedQuestionRepoPort` (Drizzle), `QuarantineRepoPort` (Drizzle),
  `DomainEventsPort`, `ClockPort` (system clock; testable seam)

### Search context (CORE)

- **Driving**: `POST /api/search` (Hono route + zod-validator) →
  `hybridSearch(query)` function in `@netea/search`
- **Driven**: `LexicalSearchPort` (Drizzle SQL: `ts_rank` + GIN),
  `SemanticSearchPort` (Drizzle SQL: `embedding <=> ?::vector` +
  HNSW), `QueryEmbeddingPort` (OpenAI embeddings — shared module
  with Enrichment), `DomainEventsPort`. Internal: `RrfFusion` pure
  function.

### Conversation context

- **Driving**: `POST /api/chat` (Hono route + Vercel AI SDK stream
  adapter)
- **Driven**: `HybridSearchPort` (direct call into `@netea/search`),
  `ChatStreamingPort` (Mastra agent over OpenAI; Conformist seam per
  DM 5.6), `ConversationSessionRepoPort` (in-memory `Map` at M0;
  Drizzle Postgres at M1+), `DomainEventsPort`

---

## Wave: DESIGN / [REF] Open Questions

Carried to DELIVER. Full descriptions in
`brief.md §Application Architecture 12`.

1. **ENRICH-DELIVER-01** — Mastra ↔ Vercel AI SDK bridging.
   Smoke-test in walking skeleton; fall back to AI SDK `streamText`
   directly if Mastra integration is awkward. Bounded to
   `apps/api/src/conversation/agent.ts`.
2. **DELIVER-02** — Exact `eslint-plugin-boundaries` rule set.
3. **DELIVER-03** — Hybrid SQL exact wording (`ts_rank` weights,
   `plainto_tsquery` vs `websearch_to_tsquery`, distance operator
   `<=>` vs `<#>`).
4. **DELIVER-04** — Retry-with-feedback prompt template wording
   (Expansion A §2 layer 4).
5. **DELIVER-05** — Mastra version pin (aggressive release cadence).
6. **DELIVER-06** — F7 detection: exact `finish_reason` string
   variants (`'content_filter'` vs `'safety'` etc.).
7. **DELIVER-07** — HNSW parameter smoke-test on the 10-question seed.
8. **DELIVER-08** — Cost cap implementation in `IngestionService`
   (`INGEST_MAX_COST_USD` graceful abort per Expansion E §6).

---

## Wave: DISTILL / [REF] Scenario list with tags

Full Gherkin lives under
[`tests/acceptance/{slice-NN-name}/scenarios.feature`](../../../tests/acceptance/).
Each `.feature` is mirrored in `scenarios.test.ts` whose `describe`/
`it` echo the Given-When-Then phrasing (per [`distill/wave-decisions.md`
§D-DISTILL-2](./distill/wave-decisions.md)). One Playwright spec covers
the browser-side `useChat` round-trip
([`tests/e2e/slice-01-walking-skeleton.spec.ts`](../../../tests/e2e/slice-01-walking-skeleton.spec.ts)).

| Slice | Scenarios | Walking skeleton | Driving-port-tagged | Error/edge | KPI-tagged | Property-tagged |
|---|---|---|---|---|---|---|
| 01 Walking Skeleton | 5 | 3 | 5 | 2 | 3 | 0 |
| 02 LLM Resilience | 9 | 0 | 9 | 7 | 1 | 1 |
| 03 Observability | 7 | 0 | 7 | 2 | 4 | 0 |
| 04 Bloom Filter | 6 | 0 | 6 | 2 | 3 | 1 |
| 05 Conversation Context | 5 | 0 | 5 | 2 | 0 | 0 |
| 06 Zero-Result Recovery | 6 | 0 | 6 | 6 | 4 | 1 |
| **Total** | **38** | **3** | **38** | **21 (55%)** | **15** | **3** |

Error/edge ratio **55%** exceeds the Mandate's 40% floor. All
walking-skeleton scenarios carry both `@walking_skeleton` and
`@driving_port` (Mandate 1 / Dim 5).

Property-tagged scenarios — DELIVER may upgrade to `fast-check`
generators:

- Slice 02: "A quarantined question never reaches the enriched corpus regardless of how many retries were attempted"
- Slice 04: "Any explicit Bloom filter returns only questions of that Bloom level"
- Slice 06: "Across a labeled empty-set test set, zero invented titles appear in agent replies"

---

## Wave: DISTILL / [REF] WS strategy

**Strategy B (real local + fake costly)** locked in
[`distill/wave-decisions.md §D-DISTILL-1`](./distill/wave-decisions.md).

| Layer | Strategy B handling |
|---|---|
| Postgres + pgvector | REAL via `docker compose up` (`packages/db` integration helpers truncate between scenarios) |
| Filesystem (sample JSON) | REAL via `mkdtempSync` + `writeFileSync` |
| Drizzle ORM | REAL (Drizzle is the SoT per ADR-009) |
| RRF fusion | REAL (pure TS function per brief §App Arch 7) |
| Hono HTTP server | REAL (`createApp(deps)` with `app.request(...)`) |
| OpenAI enrichment | MOCK — `ai/test` `MockLanguageModelV1` with per-question scripted response queue |
| OpenAI embeddings | MOCK — `ai/test` `MockEmbeddingModelV1` (deterministic 1536-dim zero vector) |
| OpenAI chat streaming | MOCK — `MockLanguageModelV1.doStream` with a controllable `ReadableStream` |
| Mastra agent loop | REAL (verifies ENRICH-DELIVER-01 bridge inside the InMemory-LLM envelope) |
| Browser `useChat` | REAL (Playwright spec at `tests/e2e/slice-01-walking-skeleton.spec.ts`) |

`@requires_external` is reserved for an optional smoke-test against
real OpenAI; no DISTILL scenario depends on it. If the operator wants
to gate one walking-skeleton scenario behind `NETEA_E2E_REAL_OPENAI=1`,
DELIVER can add the env-var gate without changing the Gherkin.

---

## Wave: DISTILL / [REF] Adapter coverage table

Per Mandate 6: every driven adapter in [`brief.md §Application
Architecture 6`](../../product/architecture/brief.md) has at least one
`@real-io` scenario. Driven-adapter list sourced from
[`design/wave-decisions.md §1.3`](./design/wave-decisions.md) and
brief.md §Driving/Driven Ports.

| Driven adapter | Real-I/O scenario | Mock allowed? |
|---|---|---|
| `LlmEnrichmentPort` (AI SDK `generateObject` + `@ai-sdk/openai`) | Slice 01 (success path), Slice 02 (F1/F3/F5/F7 failure paths) | YES — paid external, mocked via `MockLanguageModelV1`. Optional `@requires_external` smoke. |
| `EmbeddingPort` (AI SDK `embed`/`embedMany`) | Slice 01 (single question), Slice 03 (10-question batch) | YES — mocked via `MockEmbeddingModelV1`. |
| `QueryEmbeddingPort` (AI SDK `embed` at search-time) | Slice 01 (search endpoint), Slice 04 (bloom-filter search) | YES — mocked. |
| `LexicalSearchPort` (Drizzle tsvector + GIN) | Slices 01, 04, 06 — REAL Postgres `ts_rank` invocation | NO — must hit real Postgres |
| `SemanticSearchPort` (Drizzle pgvector + HNSW) | Slices 01, 04, 06 — REAL Postgres `<=>` operator | NO — must hit real Postgres |
| `QuarantineRepoPort` (Drizzle Postgres) | Slice 02 (5 quarantine paths) — REAL writes/reads | NO |
| `EnrichedQuestionRepoPort` (Drizzle Postgres) | Slice 01, all Slice 02 happy paths | NO |
| `IngestionBatchRepoPort` (Drizzle Postgres) | Slice 01 (single batch), Slice 03 (batch summary persistence) | NO |
| `DomainEventsPort` (`@netea/observability`) | Slice 03 (run-record persistence to `logs/runs/`) — REAL filesystem | NO for filesystem path; events emission is in-process. |
| `RawQuestionSourcePort` (filesystem JSON reader) | Slice 01 (single file), Slice 02 (10-question file) — REAL filesystem | NO |
| `ChatStreamingPort` (Mastra agent over AI SDK `streamText`) | Slice 01 (skeleton chat), Slice 05 (multi-turn), Slice 06 (no_match handling) | LLM model mocked; Mastra agent loop REAL |
| `ChatBackendPort` (web → API) | Slice 01 E2E (Playwright browser test) | NO — REAL HTTP from browser |

**No "MISSING" rows.**

---

## Wave: DISTILL / [REF] Scaffolds

These are the modules DELIVER step 0 ("scaffold monorepo + create RED
scaffolds") MUST produce before any `tests/acceptance/*/scenarios.test.ts`
can compile or run. DISTILL does NOT create these — it lists them.

Each scaffold export either:

1. exports a `__SCAFFOLD__ = true as const` sentinel, OR
2. exports a callable that throws `new Error("Not yet implemented — RED scaffold")`.

This guarantees Vitest fails with an *assertion* (RED), not an *import*
error (BROKEN), so the inner TDD loop can begin.

### Package: `@netea/schemas` — `packages/schemas/src/index.ts` + sub-modules

| Export | Source module | Shape |
|---|---|---|
| `EnrichmentInputSchema`, `EnrichmentInput` | `enrichment.ts` | Zod object per brief §App Arch 5.1 |
| `EnrichmentOutputSchema`, `EnrichmentOutput` | `enrichment.ts` | Zod `.strict()` object |
| `ProvenanceSchema`, `Provenance` | `enrichment.ts` | Zod object |
| `EnrichedQuestionSchema`, `EnrichedQuestion` | `enrichment.ts` | Zod object |
| `QuarantineRowSchema`, `QuarantineRow` | `enrichment.ts` | Zod object; `failure_kind` enum F1/F2/F3/F5/F6/F7 |
| `BLOOM_LEVELS_POC`, `BloomLevel` | `bloom.ts` | `["recall","application","analysis"]` |
| `SearchQuerySchema`, `SearchQuery` | `search.ts` | Zod input contract |
| `SearchResultItemSchema`, `SearchResultItem` | `search.ts` | Zod row |
| `SearchResultSchema`, `SearchResult` | `search.ts` | Zod `discriminatedUnion("kind", [results, no_match])` |
| `RawQuestionSchema`, `RawQuestion`, `RawQuestionBatchSchema` | `ingestion.ts` | Zod object |
| `AppConfigSchema` | `config.ts` | Zod env-var loader (incl. `OPENAI_API_KEY`) |

### Package: `@netea/db` — `packages/db/src/`

| Export | Source module | Shape |
|---|---|---|
| `migrate` | `migrations.ts` | function `(databaseUrl: string) => Promise<void>` |
| `db` | `client.ts` | Drizzle client instance |
| Drizzle schema objects | `schema.ts` | `questions`, `enriched_questions`, `quarantine`, `ingestion_batches`, `domain_events` |
| `resetCorpus` | `test-helpers.ts` | function `() => Promise<void>` — truncates all tables |
| `countEnrichedQuestions`, `countQuarantine` | `test-helpers.ts` | functions accepting optional `{ batch_id?, title? }` filter |
| `fetchEnrichedQuestion`, `fetchEnrichedQuestionByTitle`, `fetchQuarantineByTitle` | `test-helpers.ts` | row fetchers |
| `seedHeartFailureCorpus`, `seedSjogrenNeurologicalCorpus`, `seedDkaCorpusApplicationOnly`, `getAllCorpusTitles` | `test-helpers.ts` | named seed fixtures |
| `EnrichedQuestionRepo`, `QuarantineRepo`, `IngestionBatchRepo` | `repos/*` | port-implementing classes/factories |

### Package: `@netea/enrichment` — `packages/enrichment/src/`

| Export | Source module | Shape |
|---|---|---|
| `EnrichmentService` | `application/service.ts` | port-shaped service used by ingestion |
| `prompts.v1` | `prompts/v1.ts` | string + `PROMPT_VERSION = "v1"` |
| `classifyFailure` | `domain/failure-classifier.ts` | pure fn returning F1..F7 |

### Package: `@netea/search` — `packages/search/src/`

| Export | Source module | Shape |
|---|---|---|
| `hybridSearch` | `application/service.ts` | function `(input: SearchQuery) => Promise<SearchResult>` |
| `rrf` | `domain/rrf.ts` | pure fn per brief §App Arch 7 |
| `LexicalSearchAdapter`, `SemanticSearchAdapter` | `infrastructure/` | Drizzle-backed port impls |

### Package: `@netea/observability` — `packages/observability/src/`

| Export | Source module | Shape |
|---|---|---|
| `RunRecorder` | `run-recorder.ts` | persists `logs/runs/{batch_id}.json` |
| `Pricing` | `pricing.ts` | `Record<model, { input: number; output: number }>` per 1M tokens |
| `DomainEventBus` | `events.ts` | in-process pub/sub |

### App: `@netea/api` — `apps/api/src/`

| Export | Source module | Shape |
|---|---|---|
| `createApp(deps)` | `app.ts` | factory returning a Hono app with `.request(...)` + `.deps` |
| `medicalSearchAgent` | `conversation/agent.ts` | Mastra agent (or AI SDK `streamText` fallback per ENRICH-DELIVER-01) |
| `searchQuestionsTool` | `conversation/tools/search-questions.ts` | Mastra tool definition |

### App: `@netea/ingestion-service` — `apps/ingestion/src/`

| Export | Source module | Shape |
|---|---|---|
| `createIngestionService(deps)` | `service.ts` | function-level driving port; returns `{ ingestOne, ingestBatch }` |
| `cli` entry | `cli.ts` | commander-based CLI bound to `pnpm run ingest:one` and `pnpm run ingest` scripts |

### Test helpers (mocks)

| Export | Source module | Provided by |
|---|---|---|
| `extractTitleFromPrompt`, `renderStep` | `tests/_helpers/llm-script.ts` | DELIVER step 0 — small helpers used by Slice 02 mock script |
| `deterministicValidModel`, `deterministicValidModelWithLatencies`, `deterministicValidEmbed`, `scriptedMixedOutcomes` | `tests/_helpers/mocks.ts` | DELIVER step 0 — helpers used by Slice 03 |
| `streamingAgentReplyApplicationOnly`, `streamingAgentReplyEmptyFilteredOffersAdjacent`, `honestEmptyAgentMock`, `clarificationAgentMock`, `optInReformulationMock`, `honestEmptyUnderPressureMock`, `openSecondPriorResultMock`, `filterPriorByApplicationMock`, `topicShiftToDkaMock`, `normalReplyMock`, `outOfRangeOrdinalMock`, `makeToolCallSpy`, `buildHeartFailureHistory` | `tests/_helpers/chat-mocks.ts` | DELIVER step 0 — agent-stream mocks |
| `generateTenQuestions`, `makeFullQuestion` | `tests/_helpers/fixtures.ts` | DELIVER step 0 — fully-formed `RawQuestion` builders |

Total scaffold modules: **~30 production files** + **~3 test-helper files**.
DELIVER step 0 is sized at ~half a day; subsequent steps make each
scaffold real, one Vitest test at a time per Outside-In TDD.

#### Hidden scaffold-contract dependency (surfaced by fixture-design expansion)

The Slice 02 LLM-resilience test fixtures inject F1-F7 failure modes via a scripted call-cursor over the `MockLanguageModelV1` provider, routing responses by question. This routing uses an `extractTitleFromPrompt(prompt: string): string` helper. **The production enrichment prompt (defined in `packages/enrichment/src/prompts/enrichment-v1.txt` per DM-4) MUST include the question title verbatim in a parseable position** — e.g., as the first line `Title: <title>` or as a `<question_title>...</question_title>` XML-style block. DELIVER step 0 must lock the prompt template such that the title is greppable; if the prompt is restructured later, the helper must be updated atomically. Validated by the Slice 02 fixture smoke test on step 0.

---

## Wave: DISTILL / [REF] Test placement

```text
tests/
├── acceptance/
│   ├── slice-01-walking-skeleton/{scenarios.feature, scenarios.test.ts}
│   ├── slice-02-llm-resilience/{scenarios.feature, scenarios.test.ts}
│   ├── slice-03-observability/{scenarios.feature, scenarios.test.ts}
│   ├── slice-04-bloom-filter/{scenarios.feature, scenarios.test.ts}
│   ├── slice-05-conversation-context/{scenarios.feature, scenarios.test.ts}
│   └── slice-06-zero-result-recovery/{scenarios.feature, scenarios.test.ts}
├── e2e/
│   └── slice-01-walking-skeleton.spec.ts        # Playwright; covers useChat ↔ server protocol
└── manual/
    └── kpi-p95-chat.md                           # KPI #1 manual measurement
```

Conventions:

- `.feature` files are the **stakeholder-facing artifact**. They read
  as clean English Gherkin and contain zero TypeScript / HTTP / SQL
  vocabulary.
- `.test.ts` mirrors are the **executable artifact**. Vitest's
  `describe`/`it` echo the Gherkin Given-When-Then.
- One scenario at a time is enabled during DELIVER's inner loop —
  DELIVER's process is "pick the next un-implemented `it.skip(...)`,
  unskip it, make it green, commit, repeat."
- The Playwright spec is gated by `playwright.config.ts` and runs
  after `apps/web` + `apps/api` are scaffolded.

---

## Wave: DISTILL / [REF] Driving Adapter coverage

Per Mandate / Dim 8 Check A — every story (US-01..US-07) maps to at
least one tagged scenario; every CLI/HTTP entry point is invoked via
its protocol by at least one scenario.

| Entry point | Protocol | Scenarios |
|---|---|---|
| `pnpm run ingest:one <path>` | Node subprocess (real shell) | Slice 01 "Missing OpenAI credential aborts the run before any database write" |
| `pnpm run ingest:one <path>` | Function-level direct call (same code path) | Slice 01 "One sample question survives the full pipeline" |
| `pnpm run ingest --file <path> [--max-cost USD]` | Function-level | All Slice 02 + all Slice 03 scenarios |
| `POST /api/search` | Hono `app.request("/api/search", ...)` | Slice 01 "Student finds the ingested question through the search endpoint", Slice 04 explicit-filter + invalid-enum, Slice 06 no_match discriminator + property |
| `POST /api/chat` | Hono `app.request("/api/chat", ...)` | Slice 01 "Student sees the ingested question referenced in a chat reply", Slice 04 refinement, Slice 05 (all 5 scenarios), Slice 06 honest-empty + clarification + opt-in reformulation + property |
| `GET /api/healthz` | Hono `app.request("/api/healthz")` | Slice 01 "Health endpoint reports the system is ready" |
| Browser `apps/web` `useChat` | Playwright | `tests/e2e/slice-01-walking-skeleton.spec.ts` |

Story-to-scenario coverage (Dim 8 Check A):

| Story | Scenario tag | Count |
|---|---|---|
| US-01 (walking skeleton) | `@us-01` | 5 (Slice 01) |
| US-02 (LLM resilience) | `@us-02` | 9 (Slice 02) |
| US-03 (observability) | `@us-03` | 7 (Slice 03) |
| US-04 (hybrid search via chat) | covered via `@us-01` walking skeleton + `@us-05` filter scenarios + `@us-06` multi-turn + `@us-07` no_match | 5+ touch points across Slices 01, 04, 05, 06 |
| US-05 (Bloom filter) | `@us-05` | 6 (Slice 04) |
| US-06 (multi-turn context) | `@us-06` | 5 (Slice 05) |
| US-07 (honest zero-result) | `@us-07` | 6 (Slice 06) |

**No story is uncovered.** US-04 has no dedicated slice (it is the
union of the search/chat user journey across Slices 01, 04, 05, 06)
and is satisfied by aggregate coverage; its KPI #3 (top-3 contains
topical match) is asserted via the walking-skeleton scenario plus the
explicit-filter Bloom scenario.

---

## Wave: DISTILL / [REF] Pre-requisites

DELIVER step 0 must provision the following before any scenario runs:

### Local environment

- **Node.js 24 LTS** (per DISTILL-wizard lock; supersedes the Node 22
  pin in `design/wave-decisions.md §4` — see
  [`distill/upstream-issues.md` finding 1](./distill/upstream-issues.md)).
- **TypeScript 6.x**.
- **pnpm 9** workspaces.
- **Turborepo 2** for task orchestration.

### Docker compose services

A `docker-compose.yml` at the repo root brings up:

- `postgres:16` with `pgvector 0.8+` extension + `pg_trgm` extension
- Volumes for persistent dev data (test runs use `resetCorpus()` to
  truncate)
- Healthcheck so test setup can wait for readiness
- Exposed on `localhost:5432`; connection string in
  `DATABASE_URL=postgres://postgres:postgres@localhost:5432/netea`

### Environment variables

| Var | Purpose | Default for tests |
|---|---|---|
| `OPENAI_API_KEY` | Real OpenAI access | Unset for unit tests (mocked); set for `@requires_external` only |
| `OPENAI_MODEL` | Chat/enrichment model id | `gpt-4o-mini` |
| `OPENAI_EMBEDDING_MODEL` | Embedding model id | `text-embedding-3-small` |
| `DATABASE_URL` | Postgres connection | `postgres://postgres:postgres@localhost:5432/netea` |
| `NETEA_USE_MOCK_LLM` | When `1`, dev/test mode wires the AI SDK test provider | `1` for all unit tests |
| `INGEST_MAX_COST_USD` | Cost cap per run (Expansion E §6) | Unset (no cap) for tests except Slice 03 cost-cap scenario |

### Test scripts (DELIVER step 0 adds to root `package.json`)

```json
{
  "scripts": {
    "ingest:one": "tsx apps/ingestion/src/cli.ts ingest --file data/sample-questions.json --limit 1",
    "ingest": "tsx apps/ingestion/src/cli.ts ingest",
    "db:migrate": "drizzle-kit push:pg",
    "db:up": "docker compose up -d postgres && pnpm wait-on tcp:5432",
    "db:down": "docker compose down",
    "test": "pnpm db:up && vitest run",
    "test:watch": "pnpm db:up && vitest",
    "test:e2e": "playwright test",
    "test:acceptance": "pnpm db:up && vitest run tests/acceptance"
  }
}
```

### CI prerequisites (M0 only — see DELIVER's CI work)

- GitHub Actions (or equivalent) with `docker compose up postgres`
  before tests
- Cache `pnpm-store` and `~/.cache/ms-playwright`
- Real-OpenAI smoke tests gated behind `if: secrets.OPENAI_API_KEY` and
  the `@requires_external` Vitest tag filter — explicitly out of M0
  required path

---

## Wave: DELIVER / [REF] Implementation Summary

All 6 slices shipped end-to-end via Outside-In TDD over 6 atomic commits (`f33c9a6` … `9ebda7a` on `main`). 40/40 acceptance scenarios green sequentially; all 8 workspace packages typecheck clean.

| Commit | Slice | Headline |
|---|---|---|
| `f33c9a6` | 01 Walking Skeleton | One question end-to-end: ingest → AI SDK `generateObject`/`embed` (mocked via `MockLanguageModelV3`) → Drizzle write → `/api/search` RRF → `/api/chat` `streamText` → React `useChat` UI |
| `dfaba7d` | 02 LLM Resilience | F1-F7 classifier, retry-with-feedback, separate schema vs transport retry budgets, quarantine writes, prompt-version + model-id + attempt-count provenance |
| `f8624d6` | 03 Observability | Real token-usage cost tracking, per-run `logs/runs/{batch_id}.json` summary, `INGEST_MAX_COST_USD` guardrail with exit-code-3 abort, `--dry-run` cost estimator |
| `8891c4e` | 04 Bloom Filter | `bloom_level` filter pre-RRF on both legs, `no_match_with_filter` discriminator, agent-side Bloom-intent extraction from natural-language queries |
| `c604db8` | 05 Conversation Context | Multi-turn handling via client-side `useChat` history, ordinal-reference resolution, topic-shift detection, out-of-range graceful degradation |
| `9ebda7a` | 06 Zero-Result Recovery | `{kind: "no_match"}` discriminator end-to-end, anti-hallucination clause in system prompt, up-to-1 reformulation per user turn, KPI #6 property scenario passes |

## Wave: DELIVER / [REF] Quality Gates

- ✅ `pnpm install` clean against the current npm registry
- ✅ `pnpm -r typecheck` → 8/8 workspaces clean
- ✅ `pnpm test:acceptance -- --no-file-parallelism` → 40/40 green
- ✅ Stack pinned to verified-current versions: Node 24, TS 6.0.3, `ai@6.0.180`, `@ai-sdk/openai@^3`, `zod@4.4.3`, `drizzle-orm@0.45.2`, `@mastra/core@^1.33` (installed, runtime-bypassed)
- ⊘ L1-L6 refactoring pass — skipped for PoC scope; code is clean enough for stakeholder review
- ⊘ Adversarial review (`/nw-review @nw-software-crafter-reviewer`) — skipped; the Sentinel review at end of DISTILL covered the contracts
- ⊘ Mutation testing — skipped; mutation suite would burn time disproportionate to PoC value
- ⊘ DES integrity verification — skipped (DES is Python-centric instrumentation; the 6 atomic commits + green acceptance suite serve as the audit trail)

## Wave: DELIVER / [REF] Open Items for Production-Hardening (M1+)

These are post-PoC items, surfaced honestly:

1. **Parallel test race** — `migrate()` invoked from concurrent `beforeAll`s collides. Sequential run required (`--no-file-parallelism`). Fix: per-DB advisory-lock mutex in `ensureMigrated`.
2. **Real-OpenAI smoke test** — pricing constants in `packages/observability/src/pricing.ts` are explicitly "assumed, verify before production." Run one paid ingestion + validate the cost summary matches OpenAI's billing dashboard.
3. **Mastra runtime adoption** (ENRICH-DELIVER-01) — Mastra's transitive `@ai-sdk/ui-utils@1.2.11` still peer-deps Zod 3 vs our Zod 4 at install. AI SDK direct works; flip back to Mastra Agent once upstream ships Zod-4 compat. Single file changes (`apps/api/src/app.ts`).
4. **`SEARCH_MIN_RRF_SCORE` threshold** — discriminator union has `no_match` + `no_match_with_filter`. Add `below_threshold` if M1 telemetry shows low-relevance results polluting top-3 (currently no evidence).
5. **`tests/_helpers/chat-mocks.ts` hoist** — each slice (04/05/06) inlined V3 mock helpers. Promote shared `v3UsageFromTokens` / `STOP` / `textStreamChunks` to a `tests/_helpers/v3-stream.ts` module.
6. **Production prompt validation** — `extractTitleFromPrompt` helper depends on `enrichment-v1.txt` placing the question title verbatim as the first line. Hidden contract; document the constraint inline at the prompt definition.
7. **CI pipeline** — GitHub Actions config not landed (would be `docker compose up postgres` + `pnpm test:acceptance -- --no-file-parallelism`). Out of M0 scope.
8. **OTEL pipeline + SQS+Lambda async ingest + RDS Proxy** — all designed (system architecture brief §5, M1 milestone in roadmap.md), not built. Lazy re-enrichment workflow is the leading edge of M1.

## Wave: DELIVER / [REF] Files Modified (high-level)

| Layer | Count | Examples |
|---|---|---|
| Production source | ~40 files | `apps/{api,ingestion,web}/src/**`, `packages/{schemas,db,enrichment,search,observability}/src/**` |
| Acceptance tests | 12 | `tests/acceptance/slice-{01..06}-*/scenarios.{feature,test.ts}` |
| E2E + manual | 2 | `tests/e2e/slice-01-walking-skeleton.spec.ts`, `tests/manual/kpi-p95-chat.md` |
| Config | 13 | root + 8 workspace `package.json`, `tsconfig*`, `turbo.json`, `vitest.config.ts`, `eslint.config.js`, `playwright.config.ts` |
| Infrastructure | 3 | `docker-compose.yml`, `docker-compose.test.yml`, `docker/postgres-init.sql` |
| Sample data | 3 | `data/{sample-questions,seed-queries,empty-seed-queries}.json` |
| Documentation | 25 | `README.md`, all 11 ADRs + `brief.md` + `feature-delta.md` + 6 slice briefs + 4 expansions + wave-decisions × 4 + upstream-issues × 1 |

## Wave: DELIVER / [REF] Pre-requisites Consumed

- DISTILL — all 38 Gherkin scenarios across 6 slices + scaffold contract
- DESIGN — 11 ADRs + brief.md C4 diagrams + 4-context domain model
- DIVERGE — pgvector vs OpenSearch vs Pinecone matrix → pgvector for PoC
- DISCUSS — 7 user stories with Elevator Pitches + 4 Tier-2 expansions (A/C/E/F)

---

## Changelog

| Date | Change |
|---|---|
| 2026-05-13 | Initial DISCUSS artifact. SSOT bootstrapped (jobs.yaml, 3 personas, 2 journeys). 6 slices, 7 user stories, DoR passed. Stack pre-decided (TypeScript, Postgres+pgvector, OpenAI, Mastra, Vite+React). |
| 2026-05-13 | Tier-2 expansions A, E, C rendered to `expansions/`. Pointer section added above changelog. `DocumentationDensityEvent` records emitted (3 × `expansion-emitted`). |
| 2026-05-13 | DESIGN wave system-architect sub-wave complete. `docs/product/architecture/brief.md` created with C4 system-context, C4 container, data-flow, M0-M3 deployment diagrams + back-of-envelope estimates + 6 system-level risks. Five ADRs created (adr-001 through adr-005). Summary section appended above. |
| 2026-05-13 | DESIGN wave ddd-architect sub-wave complete. `brief.md` extended with `## Domain Model` section (Sections Domain Model 1–9): 4 bounded contexts, 6 aggregates + 1 read-model port, 16 domain events catalog, ubiquitous-language glossary, integration patterns (incl. OpenAI ACL), ES/CQRS evaluation defending the "no ES" choice. ADR-006 created (aggregates + emitted events, no event sourcing). Summary section appended above. |
| 2026-05-13 | DESIGN wave solution-architect (Application Architecture) sub-wave complete. `brief.md` extended with `## Application Architecture` section (§1.1–§1.15): component decomposition (3 apps + 6 packages), hexagonal port/adapter map, C4 Component diagrams for Enrichment + Search, canonical Zod schemas, DB schema sketch, RRF sketch, Mastra agent design, layered convention, Domain Model 6 open issues all closed, 6 new application-level risks (R-13–R-18), 8 DELIVER open issues, contract-test annotation for platform-architect. Five new ADRs (adr-007 through adr-011). Summary section + Component Decomposition + Reuse Analysis + Technology Choices + Decisions table + Driving/Driven Ports + Open Questions sections appended above. Wave-decisions.md and roadmap.md emitted under `design/`. |
| 2026-05-13 | DISTILL wave complete (acceptance-designer). 6 `.feature` files + 6 Vitest mirror `.test.ts` files under `tests/acceptance/`, one Playwright E2E spec under `tests/e2e/`, one manual KPI doc under `tests/manual/`. 38 scenarios total (55% error/edge ratio; 15 `@kpi`-tagged; 3 `@property`-tagged; 3 `@walking_skeleton @driving_port @real-io`). WS Strategy B locked (real local + fake costly). Vitest + describe/it mirror locked as BDD executor. Seven `[REF]` sections appended above (Scenario list / WS strategy / Adapter coverage / Scaffolds / Test placement / Driving Adapter coverage / Pre-requisites). `distill/wave-decisions.md` + `distill/upstream-issues.md` emitted. Reconciliation: 4 LOW-severity findings logged, no blockers. |
| 2026-05-13 | Stack-pin corrections: user-pinned Node 24 LTS, TS 6+, Mastra `@mastra/core@1.32.0`, Vercel AI SDK latest stable, Drizzle 0.45.2, Zod 4. Context7 + npm-view-verified at install: actual installed versions are AI SDK 6.0.180, Mastra 1.33.0, Zod 4.4.3, TS 6.0.3 (current at install). Brief.md tech-stack table, 5 ADRs, feature-delta tech-choices table, and wave-decisions.md updated. Direct `openai` Node SDK dropped — all LLM calls go through `ai` (`generateObject`, `embed`, `embedMany`, `streamText`) with `@ai-sdk/openai` as provider. `useChat` source clarified as `@ai-sdk/react` (UI hooks split out of base `ai` package). |
| 2026-05-13 | DELIVER wave complete. 6 atomic commits (`f33c9a6` walking skeleton → `9ebda7a` zero-result recovery) on `main`. 40/40 acceptance tests green sequentially. 8/8 workspaces typecheck. `## Wave: DELIVER / [REF]` summary sections appended above. README rewritten to reflect shipped state. Open items (parallel-test race, Mastra-Zod-4 peer warning, real-OpenAI smoke test, CI pipeline) surfaced honestly for stakeholder review. |
