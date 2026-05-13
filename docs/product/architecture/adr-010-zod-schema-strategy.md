<!-- markdownlint-disable MD013 -->
# ADR-010 — Zod schema strategy: strict mode, shared package, single direction of truth

**Status**: Accepted
**Date**: 2026-05-13
**Deciders**: solution-architect
**Wave**: DESIGN (Application architecture sub-wave)

## Context

The DISCUSS wave's System Constraints declare: "Schema enforcement is
mandatory at the LLM boundary. Every LLM response passes a Zod parse
before any write. There is no path from raw LLM output to the corpus
without validation." The Enrichment context's Anti-Corruption Layer
(brief.md Domain Model 5.5) is "literally the five-layer defense from
Expansion A §2" — Zod is layer 3 of that defense.

Expansion A §7 sketched the canonical Zod schemas. ADR-009 commits to
Drizzle → Zod codegen as the drift-prevention mechanism. This ADR
ratifies the cross-cutting Zod policy.

Constraints:

- **Validation must run on every LLM response** (System Constraints).
- **Refinements are mandatory** (Expansion A §2 layer 3): `.strict()`
  mode, enum refinements, bounded arrays.
- **Schemas are shared between client and server** (US-04 AC: the chat
  UI renders agent responses that reference search results; the contract
  is one Zod schema for the search request and one for the result).
- **Feedback retry needs structured Zod errors** (Expansion A §2 layer 4:
  "your previous output failed validation because <Zod issue path +
  message>"). The error format is load-bearing.

## Decision

**Adopt Zod `zod@4.x` (current stable, user-pinned 2026-05-13, verified via context7 `/colinhacks/zod` — available versions: v3.24.2, v4.0.1+) as the universal runtime-validation library. Store
all canonical schemas in `packages/schemas`. Enforce `.strict()` on every
LLM-boundary schema. Use Zod-derived TypeScript types as the canonical
type system; never hand-write a duplicate interface.**

Specifics:

- **Package layout**: `packages/schemas/src/index.ts` re-exports named
  schemas grouped by domain context (`enrichment`, `search`,
  `conversation`, `ingestion`). Each context's file holds related
  schemas, e.g., `enrichment.ts` exports `EnrichmentInputSchema`,
  `EnrichmentOutputSchema`, `EnrichedQuestionSchema`,
  `QuarantineRowSchema`.
- **`.strict()` policy**: every schema that crosses an external
  boundary (LLM, HTTP API, file system) uses `.strict()` (rejects
  extra keys). Internal in-process schemas may omit `.strict()` (we
  control both sides).
- **Refinements live next to schemas, not in code**: refinements like
  `keywords` `.min(3).max(10)` and `bloom_level` `.refine(v =>
  ALLOWED_BLOOMS.includes(v))` live in the schema definition file.
  Refinement messages are explicit (used in feedback-retry prompts).
- **Bloom enum**: as a `z.enum([...])` value, with the enum literal
  sourced from a shared constant in `packages/schemas/src/bloom.ts`.
  Per the locked decision (DIVERGE §5a), the DB column is `text` with
  a CHECK constraint (not a Postgres enum); the Zod schema is the
  application-side enforcement. Both layers must agree; the constant
  is the single source of literal values.
- **Schema-DB coupling**: per ADR-009, Drizzle-shape schemas are the
  source-of-truth for DB column shapes. `drizzle-zod` generates base
  Zod schemas; hand-written refinements (e.g., `.strict()`, the array
  bounds) compose on top via `.extend()` / `.refine()`. The result is
  one canonical exported schema per concept.
- **HTTP API validation**: every Hono route handler wraps its body
  parser with `@hono/zod-validator`. Failed validation → 400 with the
  Zod issue array, JSON-serialized. (US-05 AC: invalid `bloom_level`
  returns 400 explaining valid enum values — this is literally what
  Zod's default error format does.)
- **OpenAI Structured Outputs**: the JSON schema submitted to OpenAI's
  `response_format` is derived from the Zod schema via
  `zod-to-json-schema`. One source of truth (the Zod schema), two
  rendered forms (Zod for parsing, JSON Schema for OpenAI's decoder).
  This is the policy that prevents the "Zod and the schema we sent to
  OpenAI drifted" failure mode.
- **Zod issue formatting for retry prompts**: a helper
  `formatZodIssuesForLLM(issues)` produces a flat human-readable
  description (e.g., `bloom_level: Expected one of [remember,
  understand, apply, ...]; received "applying"`) used by the
  recovery-side retry-with-feedback (Expansion A §2 layer 4).

## Consequences

### Positive

- **Single source of truth**: one Zod schema → TypeScript type via
  `z.infer<typeof X>`, validation logic, AND OpenAI JSON Schema. No
  drift across forms.
- **Excellent error messages**: Zod's issue tree is structured (path +
  code + message), perfect for both UI surfacing (US-05 enum error
  → 400 body) and retry-feedback prompts (Expansion A F1-F7 handling).
- **`.strict()` catches hallucinated fields silently**: an LLM adding
  a `confidence: 0.87` field that wasn't asked for is a quiet drift
  signal; `.strict()` makes it loud. This is the load-bearing argument
  for picking `.strict()` over the default permissive mode.
- **Mature ecosystem in 2026**: Zod is the de-facto runtime validator
  for TypeScript; the auxiliary libraries (`zod-to-json-schema`,
  `drizzle-zod`, `@hono/zod-validator`, `zod-form-data`) are all
  actively maintained.
- **MIT license**: zero adoption risk.

### Negative

- **`.strict()` raises the surface area for valid-but-rejected
  responses**: if OpenAI legitimately starts returning a `usage`
  field we didn't anticipate, `.strict()` rejects it. Mitigation: AI SDK's
  `generateObject` returns the parsed `object` separately from the
  response envelope — we `.strict()`-parse only the *content* (the JSON
  the model generated, not the AI SDK's envelope or token-usage block).
- **Zod 4 ships `z.toJSONSchema()` built-in**: the legacy
  `zod-to-json-schema` package is no longer needed. AI SDK 5 also
  consumes Zod schemas directly via `generateObject({ schema })` and
  handles the OpenAI Structured Outputs `response_format: json_schema`
  submission for us. Risk reduced compared to managing the JSON-Schema
  conversion ourselves.
- **Runtime parsing has a cost**: parsing every LLM response is the
  hot path. At PoC scale this is sub-millisecond; at 1k QPS it would
  warrant `safeParse` plus selective `.passthrough()` for high-volume
  internal endpoints. Not a concern through M2.
- **Zod 4 is the pinned version, not a future migration.** Zod 4 shipped
  in 2025 with non-trivial API changes vs v3 (notably: native
  `z.toJSONSchema()` built-in, restructured error format, stricter
  `z.coerce.*`, `.parseAsync` removed in favor of unified
  `.parseAsync`-via-promise sites, JSON Schema improvements aligning with
  OpenAI Structured Outputs). The codebase is greenfield on Zod 4 — no
  v3→v4 migration cost. The `drizzle-zod` and `@hono/zod-validator`
  releases pinned in DELIVER must support Zod 4 (verify at install).

## Alternatives considered

- **Valibot** (rejected): smaller bundle than Zod, similar API. Less
  ecosystem support in 2026; the auxiliary tools we rely on
  (`@hono/zod-validator`, `drizzle-zod`, `zod-to-json-schema`) don't
  have first-class Valibot equivalents. Wins on bundle size; loses on
  ecosystem cohesion. Re-evaluate if bundle size on `apps/web` becomes
  a problem.
- **`yup`** (rejected): older, slower-evolving, weaker TypeScript-type
  inference. The community has shifted to Zod for new TypeScript
  projects.
- **`io-ts`** (rejected): more functional / type-theoretic; steeper
  learning curve; smaller community. Wrong shape for a pragmatic PoC.
- **TypeBox + `@sinclair/typebox`** (rejected as primary; potentially
  viable for the OpenAI JSON Schema submission side): TypeBox is
  schema-first JSON-Schema-shaped (you write JSON Schema, get types).
  Excellent for the OpenAI submission direction; awkward for the
  general application-validation direction. Sticking with one tool
  (Zod) reduces cognitive load.
- **Hand-written validation** (rejected): correctness risk, no shared
  types, exhausting to maintain. Non-starter at staff level.

## Migration path

This decision is stable across all milestones. Zod v3 → v4 is a future
migration with bounded blast radius (`packages/schemas` only). The
drift-prevention story strengthens at M1+ when more contexts emit
events with payloads — every event-payload Zod schema goes in
`packages/schemas` alongside the others, so a consumer can validate
event payloads at the boundary too.

## Architectural enforcement

Per principle 11 (enforceable architecture rules):

- **eslint-plugin-boundaries**: only `packages/schemas` may export
  Zod schemas to other packages. No package may define a schema-shaped
  object outside `packages/schemas/`. Lint-time enforcement.
- **Custom ESLint rule (or test)** asserts that any schema using
  `z.object` at the public exports of `packages/schemas` ALSO calls
  `.strict()` (boundary schemas only — internal helpers may omit).
- **Smoke test**: a Vitest test in `packages/schemas` round-trips each
  exported schema through `zod-to-json-schema` and asserts the OpenAI
  JSON Schema validates the same fixture that Zod accepts. Catches
  drift between Zod features and `zod-to-json-schema` capabilities.

## References

- DISCUSS System Constraints (Schema enforcement mandatory; Provenance
  mandatory; Quarantine preferred)
- Expansion A §2 (5-layer defense), §3 (decision matrix), §7 (Zod sketch)
- ADR-009 (Drizzle → Zod codegen direction)
- US-05 AC (400 response on invalid bloom_level enum)
- `docs/product/architecture/brief.md` §Domain Model 5.5 (the
  Enrichment ACL)
- Zod documentation, `zod-to-json-schema`, `drizzle-zod`, `@hono/zod-validator`
