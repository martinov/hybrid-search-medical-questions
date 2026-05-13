<!-- markdownlint-disable MD013 -->
# ADR-009 — ORM and migrations: Drizzle ORM with pgvector driver

**Status**: Accepted
**Date**: 2026-05-13
**Deciders**: solution-architect
**Wave**: DESIGN (Application architecture sub-wave)

## Context

ADR-001 commits Postgres + pgvector as the single store. The application
must:

1. Execute hybrid search SQL (CTE combining tsvector + pgvector legs;
   per ADR-001 §Decision and the RRF fusion in TypeScript).
2. INSERT into `enriched_questions` with a 1536-dim `vector` column and
   array columns (`keywords text[]`).
3. INSERT into `quarantine` with JSONB payloads (raw responses, parse
   errors).
4. Issue SQL migrations (CREATE EXTENSION pgvector, table DDL, index DDL
   for HNSW + GIN).
5. Be auditable at code-review time — the developer reading the query
   must know what SQL hits the DB.

The DDD architect (brief.md Domain Model 8) names the constraint:
"`packages/schemas`'s Zod types and `packages/db`'s schema must not
drift". This ADR resolves that drift via a single source-of-truth
strategy.

Constraints relevant to this decision:

- **pgvector compatibility**: the chosen ORM/query-builder must support
  the `vector` column type (or expose raw-SQL paths that don't fight it).
- **TypeScript-first**: types flow from schema to query result without
  manual typings.
- **Migration tooling**: schema migrations must be checked into git,
  runnable from `pnpm run db:migrate` (US-01 AC mentions this command).
- **No magic ORM**: full SQL visibility for the hybrid-search CTE. We
  will write SQL; the tool must accept it.

## Decision

**Adopt Drizzle ORM `drizzle-orm@0.45.2` (user-pinned, 2026-05-13) with the official `drizzle-orm/pg-core`
schema + `drizzle-kit` for migrations. Vector column via
`drizzle-orm/pg-core`'s vector helper or raw `customType`. Source-of-truth
direction: Drizzle schema → derived Zod schemas via `drizzle-zod`.**

Specifics:

- **Schema definition**: lives in `packages/db/src/schema.ts`. Drizzle
  schema is the canonical write-path source-of-truth for column shapes.
- **Zod schemas**: derived from Drizzle via `drizzle-zod`
  (`createSelectSchema`, `createInsertSchema`). Hand-curated refinements
  (e.g., `keywords` `.min(3).max(10)`, `bloom_level` enum literal) are
  composed on top of the derived base schema. This means: changing the
  DB column produces a typecheck error in the Zod schema layer, which
  is the load-bearing prevention of the drift named in Domain Model 8.
- **Vector column**: declared as
  `customType<{ data: number[]; driverData: string }>({ dataType: () => 'vector(1536)' })`.
  Drizzle does not yet have first-class `vector` support across all
  drivers; the `customType` escape hatch is officially supported.
- **Hybrid search SQL**: written as a raw Drizzle `sql\`...\`` template
  literal in `packages/search`. We do NOT try to build the CTE through
  Drizzle's query builder — the SQL is too domain-specific and the
  visibility cost of hiding it isn't justified.
- **Migrations**: `drizzle-kit generate` produces migration files from
  the schema diff; `drizzle-kit migrate` applies them. Migrations are
  committed to `packages/db/migrations/`.
- **Driver**: `postgres` (porsager/postgres) at the bottom. Drizzle's
  `node-postgres` driver also supported; we pick `postgres` for its
  superior performance and simpler connection-pool story at M1.
- **Embedding insert**: vectors converted to the pgvector text
  representation (`'[0.1,0.2,...]'`) at the driver boundary. Helper in
  `packages/db/src/vector.ts` to keep the conversion out of route code.

## Consequences

### Positive

- **No ORM lock-in for queries**: Drizzle's `sql\`...\`` accepts arbitrary
  SQL with typed result inference. The hybrid CTE lives as inspectable
  SQL in the repo — code reviewers see the query that hits the DB.
- **Schema-to-Zod codegen eliminates the drift risk** (Domain Model 8,
  Open Issue): one source of truth (Drizzle schema), Zod schemas
  generated. The application validator and the DB columns are
  guaranteed type-aligned at compile time.
- **Migrations as code**: `drizzle-kit`'s diff-based migration generation
  is fast for PoC iteration; the generated SQL is reviewable and
  hand-editable when (a) pgvector index DDL needs `m=16,
  ef_construction=200` parameters that Drizzle's schema can't express,
  or (b) `CREATE EXTENSION pgvector` must run before the table DDL.
- **Active maintenance** (2026): Drizzle is well-funded, released
  frequently, and has explicit pgvector docs (the `vector` column type
  is mentioned in the docs and the GH issue tracker).
- **MIT license**: zero adoption risk.

### Negative

- **Drizzle's pgvector helper is newer than the rest of the schema
  builder**. Some pgvector index features (HNSW parameters, custom
  distance ops) require raw SQL in migration files. Mitigation: we
  write the index DDL by hand in the first migration; it's a 4-line
  SQL block, not a Drizzle DSL miss.
- **`drizzle-zod` derived schemas are not always exactly what the app
  wants**: e.g., the DB stores `keywords text[]` (no length constraint
  at DB level), but the Zod schema wants `.min(3).max(10)`. Mitigation:
  compose hand-written refinements on top of derived base.
- **Two source-of-truth directions debate**: we picked Drizzle → Zod
  (DB → schema). The alternative (Zod → Drizzle via codegen) is also
  defensible. Our choice keeps the SQL-shape decision in one place
  (the DB), which we judged the load-bearing concern given pgvector
  specifics.
- **Drizzle's API has evolved across 0.x → 1.x preview**: pinning the
  version in `package.json` matters; document the version in
  CONTRIBUTING.

## Alternatives considered

- **Kysely** (rejected, close call): excellent type-safe query builder,
  no migration runner of its own (use `kysely-codegen` + a separate
  migration tool). The Drizzle bundle (ORM + migrations + schema +
  Zod-codegen) is more cohesive at PoC scale. Kysely wins on raw
  query-builder elegance; Drizzle wins on holistic developer
  experience for "model + migrations + schemas + DB layer" in one
  install.
- **Prisma** (rejected): ORM-shaped, generates a custom client,
  notoriously poor pgvector support (the `Unsupported` column type
  hack is required for `vector`). The hidden SQL is a real cost for
  hybrid-search debugging. Prisma's strengths (developer ergonomics,
  Studio GUI) don't compensate for the pgvector and SQL-opacity
  weaknesses at our scope.
- **TypeORM** (rejected): heavy, decorator-based, slower-moving. Wrong
  shape for a 2026 TypeScript-first repo.
- **Raw `postgres` + `node-pg-migrate`** (rejected as primary; viable
  fallback): the lightest possible stack. Loses the typed-result-set
  feature that Drizzle/Kysely give for free. Acceptable for a single
  file; doesn't scale to a multi-package repo with shared schema.
- **MikroORM** (rejected): high-quality but DDD-flavored (Identity
  Map, Unit of Work) — overlaps with our explicit DDD layer in a
  redundant way. Wrong fit.

## Migration path

This decision is stable for M0–M3. If pgvector support in Drizzle
matures further (first-class HNSW index support in the schema DSL),
we update; the data model doesn't change.

If we ever move off pgvector (M3 OpenSearch substitution per ADR-001),
the `packages/search` adapter contains the pgvector-specific SQL; the
`packages/db` schema retains `embedding vector(1536)` as a source-of-truth
column even after Search reads move to OpenSearch (per ADR-001 §Migration
path stage 5). Drizzle remains the SoT for Postgres-side schema; an
OpenSearch index template is added alongside, generated from the same
Drizzle schema (via a small custom mapping or hand-written).

## Architectural enforcement

- **eslint-plugin-boundaries**: only `packages/db` and `packages/search`
  may import `drizzle-orm`. Application code (`apps/api`,
  `apps/ingestion`) imports from `packages/db`'s exported repository
  functions; route handlers never write SQL directly. Lint-time.
- **No raw `pg`/`postgres` imports outside `packages/db`**: enforced
  via the same lint plugin. Centralizes the connection pool and the
  vector-encoding helper.
- **Migration smoke test**: a Vitest test in `packages/db` runs all
  migrations against a clean Postgres instance (docker-compose service)
  and asserts the final schema diff is empty (`drizzle-kit check`
  exit code 0).

## References

- ADR-001 (Postgres + pgvector commitment)
- `docs/product/architecture/brief.md` §Domain Model 8 (Zod-DB drift
  prevention is named here)
- US-01 AC #5 (`pnpm run db:migrate`)
- Drizzle ORM documentation, `drizzle-zod` plugin documentation
- pgvector documentation (HNSW parameters)
