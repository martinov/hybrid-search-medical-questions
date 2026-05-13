<!-- markdownlint-disable MD013 MD024 -->
# DISTILL wave decisions — `hybrid-search-medical-questions`

**Feature**: `hybrid-search-medical-questions`
**Wave**: DISTILL (acceptance-designer)
**Date**: 2026-05-13
**Designer**: Quinn (acceptance-designer)
**Density**: lean + ask-intelligent
**SSOT references**: `feature-delta.md`, `docs/product/architecture/brief.md`,
`docs/product/journeys/*.yaml`

This document is the consolidated decision register for the DISTILL
wave. It does not duplicate scenarios; it captures the strategic
choices that bind DISTILL's outputs to DELIVER's inner-loop work.

---

## D-DISTILL-1 — Walking-Skeleton Strategy: **B (real local + fake costly)**

**Decision**: All walking-skeleton scenarios run against real Postgres
+ pgvector (via `docker compose`), real filesystem, real Drizzle, real
RRF fusion, real Hono HTTP server. The two paid externals — OpenAI
chat and OpenAI embeddings — are replaced with the AI SDK test
provider (`MockLanguageModelV1` / `MockEmbeddingModelV1` from
`ai/test`).

**Rationale**:

- The Mastra ↔ AI SDK bridge (ENRICH-DELIVER-01) is the load-bearing
  risk; testing through real adapters everywhere *except* the LLM is
  the only way the walking skeleton meaningfully de-risks the
  integration backbone.
- Per user-global rule "prefer docker compose for orchestration",
  Postgres-via-compose is the natural local-stack choice.
- Per user-global rule "we have playwright-cli installed, use it for
  e2e tests", the browser-side `useChat` round-trip is a Playwright
  test (`tests/e2e/slice-01-walking-skeleton.spec.ts`).

**Tag convention**:

| Tag | Meaning |
|---|---|
| `@walking_skeleton` | Proves the full integration backbone end-to-end |
| `@driving_port` | Invoked through CLI or HTTP entry point (Mandate 1) |
| `@real-io` | Real Postgres, real filesystem; mocked LLM only |
| `@adapter-integration` | Dedicated scenario exercising one driven adapter with real I/O |
| `@in-memory` | InMemory test double — used only at the LLM-mock boundary |
| `@requires_external` | Hits real OpenAI; optional, smoke-test only, gated by env var |
| `@infrastructure-failure` | Driven-adapter failure path (per Mandate 6 / Dim 1 error coverage) |
| `@kpi` | Verifies a KPI from `feature-delta.md §Outcome KPIs Summary` |
| `@property` | Universal invariant; DELIVER may upgrade to property-based test |
| `@us-NN` | Story traceability (Dim 8 Check A) |

---

## D-DISTILL-2 — BDD executor: **Vitest with describe/it mirroring Given-When-Then**

**Decision**: `.feature` files are the canonical human-readable artifact
(delivered for the stakeholder review). Each `.feature` scenario is
mirrored in a Vitest `.test.ts` file whose `describe`/`it` names echo
the Given-When-Then phrasing.

**Rationale**:

- User-global rule pins **Vitest** as the preferred test runner.
- Adding `@cucumber/cucumber` doubles the toolchain weight for no
  added value at PoC scope — Vitest's describe/it nesting is
  expressive enough to mirror Gherkin one-to-one.
- The `.feature` files remain executable in spirit (each scenario
  has a 1:1 test) and remain the discussion artifact in the
  interview (proper Gherkin English).

**File layout**:

```text
tests/
├── acceptance/
│   ├── slice-01-walking-skeleton/
│   │   ├── scenarios.feature
│   │   └── scenarios.test.ts
│   ├── slice-02-llm-resilience/
│   │   ├── scenarios.feature
│   │   └── scenarios.test.ts
│   ├── slice-03-observability/
│   │   ├── scenarios.feature
│   │   └── scenarios.test.ts
│   ├── slice-04-bloom-filter/
│   │   ├── scenarios.feature
│   │   └── scenarios.test.ts
│   ├── slice-05-conversation-context/
│   │   ├── scenarios.feature
│   │   └── scenarios.test.ts
│   └── slice-06-zero-result-recovery/
│       ├── scenarios.feature
│       └── scenarios.test.ts
├── e2e/
│   └── slice-01-walking-skeleton.spec.ts        # Playwright
└── manual/
    └── kpi-p95-chat.md                          # KPI #1, manual measurement
```

---

## D-DISTILL-3 — Scaffold-contract handoff to DELIVER step 0

**Decision**: DISTILL does NOT create production-side TypeScript
source files. DELIVER step 0 ("scaffold monorepo + create RED
scaffolds") is responsible for producing every module the
`scenarios.test.ts` files import.

**Why**: this feature is greenfield. The `package.json` workspace
roots, `tsconfig.json`s, and Drizzle schema do not exist yet. DELIVER
step 0 is the natural place for that work, and producing the
scaffolds there allows DELIVER to choose final pin versions
(re-verified at install) rather than locking them in DISTILL.

**Contract** — the exact module paths and exports DELIVER step 0
MUST produce are enumerated in `feature-delta.md §Wave: DISTILL /
[REF] Scaffolds`. Each scaffold export either:

- exports a `__SCAFFOLD__ = true as const` sentinel marker; OR
- exports a callable that throws `"Not yet implemented — RED scaffold"`.

Vitest tests then fail with assertion errors (not import errors)
which is the desired RED state.

---

## D-DISTILL-4 — Test pyramid and out-of-scope deferrals

**In scope (DISTILL produces)**:

- 7 `.feature` files (6 slices + the property/cross-slice
  invariants that don't fit one slice are captured inline)
- 7 Vitest mirror `.test.ts` files
- 1 Playwright E2E spec (Slice 01, browser-side useChat surface)
- 1 manual KPI procedure (`tests/manual/kpi-p95-chat.md`) — KPI #1
  cannot be automated without real OpenAI traffic; DELIVER does not
  inherit it.

**Explicitly NOT in scope (DELIVER inherits)**:

- Unit tests for `packages/search/src/domain/rrf.ts` (the four
  fixture cases enumerated in `brief.md §Application Architecture 7`
  are unit-level, not acceptance-level; DELIVER's inner loop adds them).
- Unit tests for Zod schema refinements (`drizzle-zod` round-trip
  per Risk R-13).
- Pact-JS contract tests for OpenAI Chat Completions / Embeddings —
  per `design/wave-decisions.md §6` these belong to the
  platform-architect at M1+ and are explicitly out of M0 / PoC scope.
- Property-based tests with `fast-check` — the four `@property`-tagged
  scenarios are realised as single-case scenarios in DISTILL;
  DELIVER's crafter MAY upgrade them to fast-check generators
  (the tag signals intent, not requirement).

---

## D-DISTILL-5 — KPI coverage strategy

**Automatable KPIs (each has at least one `@kpi`-tagged scenario)**:

| KPI | Coverage | Where |
|---|---|---|
| #2 Enrichment validity ≥ 90% first-try | aggregate over Slice 02 retry/quarantine scenarios | `slice-02-llm-resilience/scenarios.feature` |
| #3 Top-3 contains topical match ≥ 80% | walking-skeleton + Slice 04 explicit filter scenarios | Slices 01 + 04 |
| #4 Run summary on every run | Slice 03 "Run record is persisted" | `slice-03-observability/scenarios.feature` |
| #5 Bloom filter precision = 100% | Slice 04 explicit + property scenarios | `slice-04-bloom-filter/scenarios.feature` |
| #6 0 hallucinated titles | Slice 06 property + per-query scenarios | `slice-06-zero-result-recovery/scenarios.feature` |
| #7 Cost per 1k < $10 | Slice 03 cost-cap scenario asserts the guardrail path | `slice-03-observability/scenarios.feature` |

**Non-automatable KPI**:

| KPI | Strategy |
|---|---|
| #1 p95 chat < 4 s | Manual measurement; procedure in `tests/manual/kpi-p95-chat.md` |

KPI contracts file (`docs/product/kpi-contracts.yaml`) is not present
(see `upstream-issues.md` finding 2). KPIs sourced inline from
`feature-delta.md §Outcome KPIs Summary` instead.

---

## D-DISTILL-6 — Mandate compliance evidence (CM-A through CM-D)

| Mandate | Evidence | Where |
|---|---|---|
| CM-A — driving ports only | Every test imports either `@netea/api` (HTTP), `@netea/ingestion-service` (function-level CLI port), or shells out to `pnpm run ingest:one`. Zero internal imports of `packages/enrichment/src/domain/*` etc. | `tests/acceptance/*/scenarios.test.ts` import listings |
| CM-B — business language | Gherkin files contain no terms from {HTTP, JSON, status code, controller, repository, service}. Step phrasing uses domain terms (corpus, enriched, quarantined, Bloom level). | `tests/acceptance/*/scenarios.feature` grep |
| CM-C — user-journey completeness | Three walking-skeleton scenarios all express user goals (Sam ingests, student searches via API, student sees reply via chat). 30+ focused scenarios cover boundaries. Ratio 3 WS : 30+ focused is within the 2-5 WS guideline. | Scenario count audit below |
| CM-D — pure functions extracted | RRF is the principal pure function — `packages/search/src/domain/rrf.ts` is an explicit pure function per `brief.md §App Arch 7`. Acceptance tests exercise RRF through the search endpoint (acceptance-layer) and DELIVER's inner loop adds the 4 unit fixtures from §App Arch 7. Mandate 4 / CM-D handoff to DELIVER. | `design/wave-decisions.md §3` reuse line + DELIVER step 0 contract |

---

## D-DISTILL-7 — Scenario count and error-path ratio

| Slice | Total scenarios | Error/edge | Error % |
|---|---|---|---|
| Slice 01 — walking skeleton | 5 | 1 (missing key) + 1 (health) | 40% |
| Slice 02 — LLM resilience | 9 | 7 (5 quarantine + 1 transport-retry + 1 property) | 78% |
| Slice 03 — observability | 7 | 2 (cost cap, unwritable logs) | 29% (mitigated — see note) |
| Slice 04 — bloom filter | 6 | 2 (invalid enum, empty filtered) | 33% |
| Slice 05 — conversation context | 5 | 2 (out-of-range ordinal, long history) | 40% |
| Slice 06 — zero-result recovery | 6 | 6 (all scenarios cover the negative path) | 100% |
| **Total** | **38** | **21** | **55%** |

**Aggregate error/edge-case ratio: 55% — well above Mandate's 40% floor.**

Slice 03 note: the slice is *about* the success path of observability;
the error-path counter-balance lives in Slice 02 (which is one slice
the operator runs together with Slice 03 in the admin journey).

---

## D-DISTILL-8 — Driving Adapter coverage (Mandate 5)

| Driving entry point | Tested in | Protocol |
|---|---|---|
| `pnpm run ingest:one <path>` (CLI) | Slice 01 (subprocess + function-level both) | Node subprocess + direct service call |
| `pnpm run ingest --file <path> [--max-cost USD]` (CLI) | Slice 02 (function-level), Slice 03 (cost cap) | Direct service call |
| `POST /api/search` (HTTP) | Slices 01, 04, 06 | Hono test request |
| `POST /api/chat` (HTTP) | Slices 01, 04, 05, 06 | Hono test request |
| `GET /api/healthz` (HTTP) | Slice 01 | Hono test request |
| Browser `useChat` (in `apps/web`) | Slice 01 E2E | Playwright |

**No driving entry point lacks coverage.**

---

## D-DISTILL-9 — Trigger-detection (ask-intelligent)

Triggered at wave end per skill spec:

| Trigger | Fired? | Evidence |
|---|---|---|
| Cross-context complexity (≥3 technologies) | YES | LLM (AI SDK), Postgres+pgvector, Mastra, Vite/Playwright |
| Novel pattern: walking skeleton + LLM mock via AI SDK test provider | YES | First time `ai/test` is used in this project; mock contract is non-trivial |
| WS strategy = D (real costly) | NO | Strategy B is the explicit choice |
| Compliance / regulatory | NO | PoC scope; no PHI |

**Scoped expansion menu offered to the user**:

- **[A] `fixture-design-discussion`** — WHY the MockLanguageModelV1
  fixtures shape the way they do (per-question script Map +
  call-cursor pattern); when to upgrade to a record-replay tape
  versus a hand-written response.
- **[B] `scaffold-authoring-recipes`** — HOW DELIVER step 0 should
  shape each scaffold export so Vitest fails RED (not BROKEN);
  pattern for `__SCAFFOLD__` sentinel + thrown-error stub.
- **[C] `pbt-strategy-notes`** — for the four `@property`-tagged
  scenarios: when to keep the single-case form versus upgrade to
  `fast-check` generators; specifically applicable to the RRF
  invariants in `brief.md §App Arch 7`.

**Recommendation** (per skill spec):

1. `scaffold-authoring-recipes` (HOW) — most concretely useful at
   the DELIVER handoff boundary.
2. `fixture-design-discussion` (WHY) — defends the LLM-mock
   choices for stakeholders.

The user can request any subset; none are auto-generated.

---

## Cross-references

- DISCUSS feature-delta: [`../feature-delta.md`](../feature-delta.md)
- DESIGN wave decisions: [`../design/wave-decisions.md`](../design/wave-decisions.md)
- DESIGN roadmap: [`../design/roadmap.md`](../design/roadmap.md)
- Architecture brief: [`../../../product/architecture/brief.md`](../../../product/architecture/brief.md)
- DISTILL upstream issues: [`./upstream-issues.md`](./upstream-issues.md)
- All 6 slice briefs: [`../slices/`](../slices/)
- Tier-2 expansions: [`../expansions/`](../expansions/)

---

## Changelog

| Date | Change |
|---|---|
| 2026-05-13 | Initial DISTILL wave decisions. 38 scenarios across 6 slice features + 1 Playwright E2E + 1 manual KPI doc. WS Strategy B locked. Vitest + describe/it mirror locked as BDD executor. |
