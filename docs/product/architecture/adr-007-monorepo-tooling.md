<!-- markdownlint-disable MD013 -->
# ADR-007 — Monorepo tooling: pnpm workspaces + Turborepo

**Status**: Accepted
**Date**: 2026-05-13
**Deciders**: solution-architect
**Wave**: DESIGN (Application architecture sub-wave)

## Context

The DISCUSS wave locked a monorepo shape: `apps/{ingestion,api,web}` plus
`packages/{search,db,schemas}` (extended here with `enrichment` and
`observability`). System-architect (ADR-002 §Migration path) and ddd-architect
(brief.md Domain Model 8) both presuppose pnpm workspaces. This ADR ratifies
the tooling and adds a task runner.

Constraints:

- **PoC budget is 8 hours**. Build orchestration must be zero-setup for
  contributors (`pnpm install` then `pnpm run ingest` / `pnpm run dev`).
- **Multi-app monorepo with shared packages** (Domain Model 8 maps four
  bounded contexts to packages; the same Zod schema package is imported by
  both `apps/ingestion` (write path) and `apps/api` (read path) so they
  cannot drift).
- **No CI infrastructure at M0** beyond what GitHub Actions offers freely;
  any task runner must work locally and in CI without a hosted cache vendor.
- **Stack-fit**: TypeScript-only repo. No Bazel, no Nx-required platform.

## Decision

**Adopt pnpm workspaces as the package manager + Turborepo as the task
runner.**

Specifics:

- **Package manager**: pnpm (≥ 9.x). Workspaces defined in
  `pnpm-workspace.yaml` enumerating `apps/*` and `packages/*`.
- **Task runner**: Turborepo (≥ 2.x). `turbo.json` defines pipelines for
  `build`, `test`, `lint`, `typecheck`, `dev` with explicit
  `dependsOn` declarations so a change in `packages/schemas` rebuilds
  `apps/ingestion` and `apps/api` but not `apps/web` unless it consumes
  the schemas package.
- **No remote cache at M0**: local Turbo cache only. Remote cache (Vercel
  or self-hosted) is an M1+ optional addition; M0 doesn't justify the
  signup or token handling.
- **Single TypeScript version pinned at the root** via `pnpm.overrides`;
  per-package `tsconfig.json` extends a root `tsconfig.base.json`.

## Consequences

### Positive

- **Fast installs**: pnpm's content-addressable store gives ~3× install
  speed vs npm and zero phantom-dependency surface. Contributor onboarding
  is `pnpm install` + an OpenAI key.
- **Incremental builds**: Turborepo's content hashing means a one-line
  edit to `apps/web` doesn't rebuild `apps/ingestion`. At PoC scale this
  is luxury; at M1+ when CI runs are frequent it earns its keep.
- **Workspace protocol**: `"@netea/schemas": "workspace:*"` in
  `apps/api/package.json` makes the import unambiguous — no version
  drift, no accidental npm-registry resolution.
- **Honest scale**: pnpm + Turborepo is the de-facto standard for
  TypeScript monorepos at 2026; both have stable v2+ releases with strong
  community support.
- **Turborepo is OSS (MPL-2.0)**: no proprietary lock-in. Self-hostable
  remote cache available; Vercel's hosted cache is optional and a
  drop-in replacement.

### Negative

- **Learning curve for `turbo.json` pipelines**: contributors unfamiliar
  with the task-runner DAG must read the docs. Mitigation: keep
  `turbo.json` minimal at M0 (~6 tasks); document the pipeline in the
  repo README.
- **Local cache can mask broken builds**: Turbo will serve a cached
  result even after an `.env` change if input files don't change.
  Mitigation: `turbo run build --force` in CI runs; document the escape
  hatch in CONTRIBUTING.
- **Mild lock-in to the Turbo workflow**: replacing Turborepo with Nx
  or moon is a multi-hour migration. The risk is bounded because pnpm
  workspaces are tool-agnostic — Turborepo sits on top of pnpm, doesn't
  replace it.

## Alternatives considered

- **Nx** (rejected): more powerful than Turborepo (project graph,
  custom executors, generators) but heavier setup. Nx earns its keep on
  multi-language repos (Angular + Node + Python) or where code generation
  matters. Our repo is TypeScript-only with conventional scripts;
  Turborepo's "build, test, lint, typecheck" DAG is sufficient. Nx
  becomes the right answer at M3+ if we add a Python analytics service.
- **Lerna** (rejected): legacy. Maintenance has been spotty since the
  Nx team took it over; the modern Lerna effectively is Nx. No reason
  to pick this over Turborepo.
- **Plain pnpm workspaces, no task runner** (considered, rejected for
  early-M1): viable at PoC; one `pnpm -r run build` invocation suffices.
  Loses the incremental-build benefit but saves 10 minutes of `turbo.json`
  setup. Borderline call. We pick Turborepo because it's additive — `pnpm
  -r` still works — and the M1+ CI cost is real.
- **Bazel** (rejected): industrial-strength but enormous setup cost.
  Wrong tool for a TypeScript-only PoC.
- **Yarn workspaces with Berry** (rejected): yarn 4 is excellent but
  pnpm has better DX for monorepos in 2026 and is the community default
  for TypeScript monorepos. No upside to yarn here.

## Migration path

This decision is stable through M3. At M3+ if a non-TypeScript service
joins (e.g., Python analytics worker for Expansion C M2+ BI views), the
options are:

1. Add the Python package via pnpm's `package.json` heuristics is
   awkward — at that point we'd move task orchestration to Nx (which
   handles polyglot natively) or accept a separate `tools/` directory
   with its own runner.
2. Keep TypeScript as the primary; treat the Python service as an
   external dependency consumed via Docker.

Neither migration affects M0–M2. The pnpm + Turborepo combination is
the right answer for the next ~18 months.

## Architectural enforcement

Per principle 11 (architectural rules need enforcement), the
package-boundary rules are encoded in tooling:

- **eslint-plugin-import + import/no-restricted-paths**: forbid
  `apps/api` from importing internal modules of `apps/ingestion` and
  vice versa. All cross-app communication MUST go through a
  `packages/*` shared module. Lint-time enforcement.
- **eslint-plugin-boundaries**: declarative rules per package category
  (`app`, `domain`, `infra`, `schemas`) restricting which categories
  may import which. Equivalent to `dependency-cruiser` rule sets; chosen
  for being a single ESLint plugin (one tool, not two).
- **TypeScript project references**: `"composite": true` in each
  package's tsconfig enforces import-graph at compile time, in addition
  to lint.

## References

- `docs/product/architecture/brief.md` §Domain Model 8 (handoff naming
  `packages/enrichment`)
- ADR-002 §Migration path (extracted `enrichQuestion` to `packages/enrichment`)
- pnpm workspaces documentation
- Turborepo v2 documentation
