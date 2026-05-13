<!-- markdownlint-disable MD024 MD013 -->
# Expansion F — Fixture design discussion `[WHY]`

**Parent**: `feature-delta.md` (D-DISTILL-1 Strategy B; all 6 slice features).
**Wave**: DISTILL Tier-2 expansion.
**Density**: lean + ask-intelligent.
**Purpose**: defend, at staff level, *why* the LLM-mock fixtures are shaped the way they are, *what scope* each fixture holds, and *what they cannot model*. The defense of the acceptance suite hinges on this — anyone who finds the fixtures load-bearing for the test outcomes will (correctly) reject the entire suite as Fixture Theater.

This expansion does NOT introduce new fixtures. It articulates the reasoning behind the choices already encoded in `tests/acceptance/*/scenarios.test.ts` and locked by `D-DISTILL-1` (Strategy B: real local + fake costly).

---

## 1. The fixture taxonomy

Fixtures in this suite fall into four categories. Each category exists at a different point on the *real ↔ fake* spectrum, and the placement is deliberate per Strategy B.

### 1a. Real-adapter fixtures (Postgres + filesystem)

- **Postgres 16 + pgvector + pg_trgm** — brought up via `docker-compose.test.yml` once per `pnpm test` invocation. The container is the *fixture* in the loosest sense (Vitest does not own its lifecycle; the test script wraps it with `docker compose up -d` / `down`). Inside the suite, the connection lives in a session-scoped Drizzle pool exported from `@netea/db/test-helpers`.
- **Real filesystem (tmp dirs)** — `mkdtempSync(join(tmpdir(), "netea-…"))` is the standard pattern for the sample-questions JSON file each slice writes. The fixture lifetime matches the test file (created in `beforeAll`, never cleaned — `tmpdir` is the OS's problem).
- **Real schema migrations** — Drizzle migrations run once before the suite via the same docker compose hook. Migration is *not* a per-test fixture; running migrations per test would dominate the test time budget for no isolation benefit (truncation gives us isolation more cheaply).
- **`resetCorpus()`** — the per-test cleanup fixture. Truncates every table between scenarios. Imported from `@netea/db/test-helpers` and called in `beforeEach`. This is the *only* fixture that runs at scenario granularity for the DB.

### 1b. Fake LLM fixtures (`MockLanguageModelV1` / `MockEmbeddingModelV1`)

- **`MockLanguageModelV1`** from `ai/test` (AI SDK 5's first-party test provider). Two shapes used:
  - **One-shot mock** in Slice 01 — `doGenerate: async () => ({ text: JSON.stringify(VALID_ENRICHMENT), … })` returns a fixed payload for every call. Sufficient because the walking skeleton tests one question.
  - **Scripted call-cursor mock** in Slice 02 (and re-used in Slices 03/04 wherever non-determinism injection is needed) — a `Map<questionTitle, CallScript>` lookup plus a per-title `cursor` so successive calls for the same question return successive scripted responses. This is what lets us deterministically inject F1/F2/F3/F5/F6/F7 + 429 sequences from Expansion A's taxonomy and assert the retry/quarantine policy responds correctly.
- **`MockEmbeddingModelV1`** — `doEmbed: async ({ values }) => ({ embeddings: values.map(() => Array.from({ length: 1536 }, () => 0.001)) })`. Returns a deterministic 1536-dim vector. The dimension matches `text-embedding-3-small` (ADR-005), so the pgvector column type is the same in tests and production.
- **`doStream` shape** for chat — Slice 01 and Slice 05 use the streaming form (`doStream` returns a `ReadableStream` of `{ type: "text-delta", textDelta }` chunks ended by `{ type: "finish", finishReason: "stop" }`). This is the AI SDK 5 V1 stream protocol; the production code path consumes it identically whether the source is OpenAI or the mock.

### 1c. Seed-data fixtures

- **Sample medical-question JSON** — one canonical cardiology question for Slice 01 (defined inline as `SEED_QUESTION`); six diverse-specialty questions for Slice 02; specialty-balanced sets for Slices 04-06. Each is written to a tmp file in `beforeAll`. The data shape is the production input shape (title + content + answers[] + explanation per `brief.md §Domain Model 2`).
- **Canonical enrichment payloads** (`VALID_ENRICHMENT` constants) — pre-shaped Zod-compliant enrichment outputs paired with each seed question. These are what the mock LLM returns for the happy path. Co-locating the seed input and the expected enrichment in the test file is intentional: it lets a reader audit, at a glance, *which* mock response the production code received.
- **No cached real OpenAI embeddings.** We deliberately do *not* embed seed text via real OpenAI and snapshot the vectors. The mock embedding is `[0.001, 0.001, …]` — useless for measuring semantic quality but perfectly sufficient for proving RRF wires up (the lexical leg does the actual differentiating work in tests). See §3 for what this *cannot* model.

### 1d. Browser fixtures (Playwright)

- One Playwright spec at `tests/e2e/slice-01-walking-skeleton.spec.ts`. It boots the real `apps/api` server (with mocked LLM injected via env-var override) and points a real Chromium at `apps/web`. Page contexts are per-test; the API server is per-spec. No mocking at the `/api/*` boundary — the browser test exercises the *same* mocked-LLM stack the acceptance tests use, just through one more layer (the browser).

---

## 2. Scope choices and why

Vitest fixture scope is the load-bearing decision behind reliable test isolation. The choices below are deliberate; deviating from them produces either slow tests or order-dependent flakes.

| Fixture | Scope | Reason |
|---|---|---|
| Postgres container (docker compose) | **Global** (suite-wide, owned by test script not Vitest) | Container startup is ~3-5 s; running it per test file would inflate wall time by ~20× across 6 slices |
| Drizzle migrations | **Global, once before suite** | Migrations are append-only; running them per test gives zero isolation benefit |
| `resetCorpus()` (truncate all tables) | **`beforeEach`** | Per-test isolation is mandatory: shared corpus state across scenarios is the most common source of order-dependent BDD flakes |
| Sample JSON file in tmp dir | **`beforeAll` per file** | The file is read-only input; per-test write would be wasted I/O |
| `MockLanguageModelV1` instance | **`beforeEach`** (mandatory reset) | The scripted-mock's cursor MUST reset between scenarios — otherwise F2's retry sequence bleeds into the next scenario, producing a false GREEN in the next test |
| `MockEmbeddingModelV1` instance | **`beforeAll`** is acceptable (stateless) | The mock returns the same constant vector for every input; no per-test reset needed |
| `createApp({ deps })` | **`beforeAll`** | The Hono app composition is expensive (~100 ms with Drizzle wiring) and is itself stateless; per-test app creation is wasteful |
| Playwright page context | **per test** (Playwright default) | Browser cookies / localStorage leak between tests if shared |

The per-scenario mock-LLM reset is the single most important rule in this list. Slice 02 sequences mock responses as `[bad-enum, valid]` to prove the feedback-retry path works. If the cursor carries over to the next scenario (which expects to start from `[invalid-json]`), the test reads response index 2 (out of bounds → undefined → mock throws) and the GREEN signal is meaningless. The `beforeEach` reset is what makes the F1-F7 injection in Slice 02 trustworthy.

**One-test-at-a-time enforcement**: per Quinn's Core Rule 5 + D-DISTILL-3, all scenarios except the WS in Slice 01 are marked `it.skip` initially. DELIVER step 0 lands the scaffolds, DELIVER step 1 enables the first WS scenario, walks it to GREEN, commits, then enables the next. The Vitest `.skip` mechanism is the implementation of "one at a time".

---

## 3. What the fakes CANNOT model

Honest accounting. A staff-level reader will ask this; the answer must be specific, not hand-waved.

### 3a. `MockLanguageModelV1` cannot reproduce

- **Real-world latency variance.** The mock resolves synchronously. KPI #1 (p95 chat < 4 s) is therefore *unverifiable* in this suite — it lives in `tests/manual/kpi-p95-chat.md` and is measured with real OpenAI. The mock-driven E2E test asserts only the *first-byte-within-2s* guardrail, which is upper-bounded by the test's own latency (effectively zero).
- **Tokenization differences.** The mock emits whatever text we hand it. Real OpenAI's BPE tokenization affects `max_tokens` semantics, prompt-cost calculations, and (rarely) breaks structured-output enforcement when a JSON token straddles a tokenization boundary. None of this is exercised by the mock.
- **Content-filter rejections (F7).** We *can* inject F7 by handing the mock a script step that returns `{ finishReason: "content_filter", text: "" }`, and we do (Slice 02). But we *cannot* test the actual filter heuristics — that's behavioural surface of OpenAI's moderation model, not our system.
- **Real model drift.** When OpenAI silently swaps the `gpt-4o-mini` snapshot behind the alias (Expansion A §8 Q4), the mock notices nothing. Detection of that drift is observability-side (US-03 metrics sliced by `model`), not test-side.

### 3b. `MockEmbeddingModelV1` cannot reproduce

- **Real OpenAI embedding quality on medical text.** The deterministic `[0.001, …]` vector is fine for proving RRF's *correctness* (rank merging with `k=60` per `brief.md §App Arch 7`) but says *nothing* about whether the semantic leg actually surfaces "MI presentation" when the corpus says "myocardial infarction". KPI #3 (top-3 contains topical match ≥ 80%) is therefore measurable only against real embeddings — it lives in the manual KPI procedure plus the M1+ eval harness recommended in Expansion C.
- **Embedding-model deprecation paths.** ADR-005 pins us to `text-embedding-3-small` at 1536 dims; the dimension is in our column type. The mock matches the dim, but cannot help us prepare for the next model swap. That's a migration concern, not a test concern.

### 3c. Suite-wide blind spots

- **OpenAI 429 cascade dynamics.** Slice 02 injects a single 429 and asserts the transport-retry budget consumes correctly. We *cannot* test sustained rate-limit pressure cascading across a parallel ingestion batch — that needs real OpenAI under load. This is intentionally deferred to a `@requires_external` smoke test (D-DISTILL-1 tag legend) that runs only when `OPENAI_API_KEY` is set and `RUN_EXTERNAL=1`.
- **Prompt-injection / jailbreak defenses.** Mock LLMs respond with whatever script we hand them. A real adversarial input would never reach the mock as anything but bytes. Mitigation lives in the real-OpenAI smoke layer plus manual red-team review (out of scope for the PoC suite).
- **Cross-tenant data leakage** — irrelevant at PoC scope, single-tenant assumption per `brief.md §System Constraints`.

---

## 4. The Mastra ↔ AI SDK bridge (ENRICH-DELIVER-01)

`wave-decisions.md §D-DISTILL-1 Rationale` identifies the Mastra ↔ AI SDK bridge as the load-bearing integration risk. Fixtures must remain implementation-agnostic so DELIVER can choose between (a) full Mastra agent-loop wiring or (b) AI SDK `streamText` fallback, without rewriting the test suite.

The design rule: **the test injects `MockLanguageModelV1` instances at the `createApp({ chatModel, enrichmentModel })` boundary, never at the Mastra `Agent` or `streamText` boundary directly.** Both Mastra agents and `streamText` accept an AI SDK `LanguageModelV1` interface; whichever path DELIVER picks, the dependency-injection seam is identical from the test's perspective.

Concretely, the WS test does this:

```ts
app = createApp({
  enrichmentModel: mockLLM,   // LanguageModelV1
  embeddingModel: mockEmbed,  // EmbeddingModelV1
  chatModel: mockChatLLM,     // LanguageModelV1 (streaming-capable)
});
```

If DELIVER ships Mastra: the agent receives `chatModel` and routes its `generate` / `stream` calls through it. If DELIVER ships AI SDK direct: `streamText({ model: chatModel, … })` receives it. The test cares about neither path — only that the chat reply streams and references the ingested question by title.

This is the single most important property of the fixture design: **the acceptance suite does not depend on which side of the ENRICH-DELIVER-01 fork DELIVER takes.** If Mastra integration turns out to be blocked (the documented risk), DELIVER can ship the AI SDK fallback and the acceptance suite goes GREEN without modification.

---

## 5. Sample fixture code sketches

Three short shapes DELIVER step 0 will implement. None of these exist yet — they are part of the scaffold contract.

### 5a. Postgres docker-compose service definition

```yaml
# docker-compose.test.yml
services:
  postgres:
    image: pgvector/pgvector:pg16
    environment:
      POSTGRES_USER: netea
      POSTGRES_PASSWORD: netea
      POSTGRES_DB: netea_test
    ports: ["5433:5432"]   # 5433 to avoid clashing with a local dev Postgres
    tmpfs: ["/var/lib/postgresql/data"]   # in-memory, faster, scrubbed per up/down
    healthcheck:
      test: ["CMD", "pg_isready", "-U", "netea"]
      interval: 1s
```

The `tmpfs` mount is deliberate: tests are ephemeral by design, and ramfs storage cuts the migration step from ~800 ms to ~120 ms.

### 5b. Vitest fixture injecting an F4 off-by-one Bloom value

```ts
// Slice 02 — F4 off-by-one (Bloom is "analysis" for a pure-recall question)
const f4Mock = new MockLanguageModelV1({
  defaultObjectGenerationMode: "json",
  doGenerate: async () => ({
    finishReason: "stop",
    usage: { promptTokens: 1048, completionTokens: 110 },
    text: JSON.stringify({
      bloom_level: "analysis",   // F4: shape-valid, semantically wrong
      keywords: ["digoxin", "toxicity", "potassium"],
      medical_specialty: "Toxicology",
    }),
    rawCall: { rawPrompt: null, rawSettings: {} },
  }),
});
```

The point of this fixture (per Expansion A §1 F4): **it must produce a row that passes Zod and writes successfully.** F4 is the case our system *cannot* catch at write time — the acceptance test for F4 therefore asserts that the row was written and that `first_try_pass_rate` recorded it as a pass. The eval-set check for semantic correctness is out-of-band (Expansion A §8 Q5).

### 5c. Deterministic embedding from a seed string

```ts
import { createHash } from "node:crypto";

function deterministicVector(seed: string): number[] {
  const h = createHash("sha256").update(seed).digest();
  return Array.from({ length: 1536 }, (_, i) => (h[i % 32] / 255) * 2 - 1);
}

const seededEmbed = new MockEmbeddingModelV1({
  doEmbed: async ({ values }) => ({
    embeddings: values.map((v) => deterministicVector(String(v))),
  }),
});
```

Used in Slice 04 and Slice 06 where the *semantic ranking* matters (not just the lexical leg). The hash-based shape gives stable-across-runs vectors that still differentiate inputs, which is exactly what RRF needs to merge meaningful semantic-leg rankings. (For the Slice 01 walking skeleton, the constant-vector shape in §1b is fine — the lexical leg carries the ranking.)

---

## 6. Stakeholder talking points

Three questions a stakeholder is most likely to surface during the artifact discussion. Each gets a one-paragraph answer grounded in the artifacts above.

### Q1: "How do you test that the LLM retry actually works without burning OpenAI dollars?"

Through the scripted-cursor `MockLanguageModelV1` in Slice 02 (§5b shape, scripted variant). For each test question we hand the mock a `CallScript` like `[{kind: "bad-enum", value: "applying"}, {kind: "valid", …}]`; the mock returns the first on call #1, the second on call #2. The production retry handler sees `bad-enum` on attempt 1, feeds Zod's error message back into the prompt (Expansion A §2 Layer 4), retries, gets `valid`, and writes the row. The test asserts the row was written *and* asserts `retry_count = 1` on the provenance row. Zero real OpenAI calls. The per-`beforeEach` cursor reset (§2) is what makes this deterministic — every scenario starts from a known cursor position.

### Q2: "How do you keep mock-based tests from masking real production issues?"

Three layers. First, the *real-adapter perimeter*: Postgres, pgvector, Drizzle, RRF, Hono, and the filesystem are all real (Strategy B). Mocks live only at the OpenAI boundary. Wiring bugs, SQL bugs, RRF bugs, and JSON schema bugs all surface in tests because the real adapters run. Second, the `@requires_external` smoke layer: a small set of scenarios (Slice 01 WS + one Slice 02 happy path) can run against real OpenAI when `OPENAI_API_KEY` is set, gated behind an env var so CI defaults are free but pre-merge can run them. Third, the *honest accounting* in §3 of this expansion: we explicitly enumerate what the mocks cannot model (latency variance, embedding quality, content-filter behavior) and route each to a different coverage mechanism — manual KPI procedure for latency, eval set for embedding quality, real-OpenAI smoke for safety-filter behavior. The mock is a deliberate narrowing, not a pretense of coverage.

### Q3: "When would you flip to real OpenAI in CI?"

Two triggers. (1) **Pre-merge smoke on `main` only**, gated by `RUN_EXTERNAL=1` and a budget cap of $0.10 per CI run (cost-capping policy from Expansion E §4). The smoke runs the WS scenario from Slice 01 plus one happy-path enrichment, validating that production credentials + the production API surface remain compatible. If `gpt-4o-mini` is silently swapped behind the alias, this catches it within one merge. (2) **Nightly eval job** (not CI strictly) that runs `data/bloom-eval.json` (Expansion A §8 Q5) through real OpenAI and reports first-try pass rate, F4 accuracy, and cost per question into `logs/runs/`. The acceptance suite stays fast and free; the eval job catches the drift the suite is structurally blind to. Both flows live downstream of M0 and are explicitly not in this DISTILL deliverable — but the fixture design makes them additive, not retrofits: the same `createApp({ … })` seam takes a real `openai("gpt-4o-mini")` model in place of the mock, nothing else changes.

---

## 7. What DELIVER inherits from this expansion

1. **The scoped fixture layout in §1** — implement each category at the boundary declared. Do not push the LLM mock deeper than the `createApp({ … })` seam.
2. **The per-scenario mock-LLM reset rule in §2** — `beforeEach { mockLLM.reset() }` or equivalent. The Slice 02 scripted-cursor pattern is specifically what depends on this.
3. **The Mastra ↔ AI SDK seam in §4** — wire both potential implementations through the same `LanguageModelV1` injection point. Whichever path is chosen for ENRICH-DELIVER-01, the test suite must not change.
4. **The docker-compose shape in §5a** — `tmpfs` for the PG data dir is the documented performance choice.
5. **The honest blind-spot inventory in §3** — keep this list current. If a new failure mode is identified that the mocks cannot model, document it here and route it to a coverage mechanism (manual / `@requires_external` / eval set).

What this expansion does NOT do (still belongs to DELIVER):

- Decide the exact prompt-extraction helper for `extractTitleFromPrompt` in the Slice 02 scripted mock.
- Choose between `vitest --pool=threads` and `--pool=forks` (the docker-compose container is shared across pools either way; choice affects test isolation overhead).
- Implement `mockLLM.reset()` — depends on whether DELIVER picks a closure-state mock (§5b style) or a class-based mock with explicit reset.

---

## Changelog

| Date | Change |
|---|---|
| 2026-05-13 | Initial Tier-2 expansion. Fixture taxonomy (real-adapter / fake LLM / seed-data / browser), Vitest scope decisions, blind-spot inventory, Mastra ↔ AI SDK bridge handling, three code sketches, stakeholder talking points. |
