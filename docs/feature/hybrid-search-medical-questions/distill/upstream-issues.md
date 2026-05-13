<!-- markdownlint-disable MD024 MD013 -->
# DISTILL upstream issues — `hybrid-search-medical-questions`

**Wave**: DISTILL (acceptance-designer)
**Date**: 2026-05-13
**Severity legend**: BLOCKER (cannot proceed) | HIGH (must fix before DELIVER) | LOW (note for DELIVER, non-blocking)

This file captures reconciliation findings discovered while reading the
prior-wave artifacts BEFORE writing any acceptance scenarios. None of
the findings below blocked DISTILL — they are all LOW-severity drift or
soft-gate misses that DELIVER and the platform-architect should resolve
explicitly.

---

## Finding 1 — Stack-pin drift between `design/wave-decisions.md` §4 and the DISTILL-wizard lock (LOW)

**What**: `design/wave-decisions.md` §4 ("Technology stack — pinned
versions, 2026-05-13") lists Node 22.x and TypeScript 5.6+. The
DISTILL-wizard locked decisions pin Node 24 LTS and TypeScript 6.x
(latest stable as of 2026-05-13). `feature-delta.md §Application
Architecture` is post-corrected to the DISTILL-wizard pins (Node 24,
TS 6.x, `zod@4.x`, `drizzle-orm@0.45.2`, `@mastra/core@1.32.0`,
`ai@5.x`).

**Why it does not block DISTILL**: acceptance scenarios are
business-language and stack-agnostic at the Gherkin layer. The Vitest
mirror tests import package names (`@netea/schemas` etc.), not
versions; the version pin is a DELIVER step-0 concern.

**Resolution path**: DELIVER step 0 (scaffold monorepo) must
re-verify and re-pin against the **DISTILL-wizard values** (Node 24,
TS 6.x, etc.) and update `design/wave-decisions.md` §4 in flight. The
feature-delta §Application Architecture already reflects the
corrected pins; the design/wave-decisions.md table is the only stale
copy.

---

## Finding 2 — `docs/product/kpi-contracts.yaml` missing (LOW — soft gate)

**What**: The skill's Phase 1 gate includes a soft check for
`docs/product/kpi-contracts.yaml`. The file does not exist in this
repository.

**Why it does not block DISTILL**: the soft gate explicitly permits
proceeding with a warning. KPIs are captured directly in
`feature-delta.md §Outcome KPIs Summary` (KPIs 1-7) and in each user
story's `#### Outcome KPIs` block, which is sufficient for scenario
authoring. `@kpi`-tagged scenarios in this DISTILL output cover the
KPIs that are *automatable* (retrieval relevance, no-hallucination,
cost-per-run); KPI #1 chat p95 < 4s is documented for manual
measurement in `tests/manual/kpi-p95-chat.md`.

**Resolution path**: optional. If the platform-architect promotes
KPIs to a formal SSOT contract file (`kpi-contracts.yaml`), the
post-merge PO review will refer to it. For PoC scope, the in-line
KPIs in `feature-delta.md` are the SSOT.

---

## Finding 3 — `docs/feature/hybrid-search-medical-questions/devops/` missing (LOW — defaults apply)

**What**: The skill expects a DEVOPS-wave delta with
`environments.yaml` for the Mandate 4 / Dim 8 traceability check.
This feature did not produce a DEVOPS delta (no platform-architect
wave ran).

**Why it does not block DISTILL**: per the skill spec, when the
DEVOPS delta is missing, default environments apply (`clean`,
`with-pre-commit`, `with-stale-config`). For a greenfield PoC, the
walking-skeleton `Given` clauses reference one
environment-equivalent: `Given a clean local environment with
Postgres+pgvector running via docker compose`. The user-global "we
have docker compose preferred" plus the walking-skeleton strategy B
covers the runnable-environment dimension.

**Resolution path**: if a future DEVOPS wave produces
`environments.yaml`, re-run Dim 8 against it.

---

## Finding 4 — `ENRICH-DELIVER-01` (Mastra ↔ AI SDK bridge) is a known open issue (HIGH for DELIVER, not for DISTILL)

**What**: `brief.md §Application Architecture 12` and
`design/wave-decisions.md §6` both name this as the load-bearing
DELIVER smoke-test. The walking-skeleton chat scenario tests the
**chat surface** (response shape) without committing to which
internal implementation (Mastra agent loop OR AI SDK `streamText`
directly) backs it.

**Why it does not block DISTILL**: the scenario asserts observable
user outcomes (a response stream begins, references an ingested
question by title, includes a content excerpt). The agent's
internal architecture is below the test boundary. Either
implementation path passes the same scenario.

**Resolution path**: DELIVER step 0 scaffold creates
`apps/api/src/conversation/agent.ts` as a `ChatStreamingPort` stub.
DELIVER's walking-skeleton work decides Mastra-vs-streamText
internally. The acceptance scenario is unaffected by the choice.

---

## Reconciliation verdict

**All findings are LOW severity and non-blocking for DISTILL.** No
contradictions between locked decisions. Scenarios proceeded.

---

## Changelog

| Date | Change |
|---|---|
| 2026-05-13 | Initial DISTILL upstream-issues log. 4 findings, all LOW severity. |
