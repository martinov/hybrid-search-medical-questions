<!-- markdownlint-disable MD013 -->
# ADR-008 — API framework: Hono

**Status**: Accepted
**Date**: 2026-05-13
**Deciders**: solution-architect
**Wave**: DESIGN (Application architecture sub-wave)

## Context

`apps/api` exposes two HTTP endpoints at M0: `POST /api/search` (US-04)
and `POST /api/chat` (US-04 / US-06). The chat endpoint must stream
responses compatible with Vercel AI SDK's `useChat` data protocol on
the browser. The search endpoint is request/response JSON.

Constraints relevant to this decision:

- **Streaming support**: must produce a streaming HTTP response (SSE or
  fetch streams) without library gymnastics. Vercel AI SDK's `useChat`
  expects the Vercel AI Data Stream Protocol (`text/event-stream` shape
  with specific event types).
- **TypeScript-first ergonomics**: typed route handlers, typed request
  parsing (via Zod), typed middleware.
- **Single Node process at M0** (brief.md §1 C4 L2). No clustering, no
  separate gateway.
- **Footprint**: smaller dependency tree = faster cold starts at M1 when
  this lives in a Lambda or container.
- **OSS, permissive license**: MIT or equivalent.

## Decision

**Adopt Hono (≥ 4.x) as the HTTP framework for `apps/api`.**

Specifics:

- **Hono** (MIT licensed). Routes defined as `app.post('/api/search',
  handler)` with `@hono/zod-validator` for input schema enforcement
  (Zod schemas imported from `packages/schemas`).
- **Adapter**: `@hono/node-server` at M0 (Node runtime). The same Hono
  app object is portable to AWS Lambda (`hono/aws-lambda` adapter) at
  M1 without rewriting routes.
- **Streaming for `/api/chat`**: Hono's `streamSSE` helper plus the
  Vercel AI SDK's `toDataStreamResponse` / `toAIStreamResponse` adapter
  produces the protocol shape `useChat` expects. Verified at
  DELIVER-time prototyping.
- **Middleware**: built-in `logger`, `cors`, plus a custom
  request-id middleware that propagates `x-request-id` for correlation
  with `logs/runs/`.

## Consequences

### Positive

- **Tiny dependency footprint**: Hono's core is ~14 KB; the install
  graph is ~10 packages vs Express's ~50+. Cold-start advantage real at
  M1 Lambda.
- **TypeScript-first**: types flow from route definitions through
  middleware to handlers. Type errors at the route level catch contract
  drift between client and server.
- **Vercel AI SDK integration is first-class**: Vercel's `ai` package
  ships an adapter for Hono in the docs; the streaming protocol is
  built around standards (Web Streams, Response objects) Hono uses
  natively.
- **Web Standards-based**: Hono uses `Request`/`Response` (Fetch API)
  rather than Node-specific `req`/`res`. Means the same code runs on
  Node, Bun, Deno, Cloudflare Workers, AWS Lambda (via the Lambda
  adapter) — relevant when M1 wraps the API in a serverless runtime.
- **Active maintenance** (2026): weekly releases, large community,
  responsive maintainer.

### Negative

- **Smaller ecosystem than Express**: some Express-specific middleware
  has no Hono equivalent. Mitigation: at PoC scope we don't need exotic
  middleware (just CORS, logging, body parsing — all built in).
- **Newer than Express/Fastify**: less battle-tested at million-RPS
  scale. Not relevant at our M0/M1 traffic; if it becomes relevant at
  M3+, we'd be on OpenSearch or behind a load balancer where the API
  framework is incidental.
- **The Lambda adapter (`hono/aws-lambda`) has its own quirks** for
  binary/event payloads. Smoke-test at M1 transition; document
  workarounds.

## Alternatives considered

- **Express** (rejected): the historical default. Loses on TypeScript
  ergonomics (Express's types are bolted-on via `@types/express`),
  streaming-from-routes (manual `res.write` + `res.end`; brittle), and
  bundle size. The Vercel AI SDK has Express adapters but they're
  thinner and more manual than Hono's.
- **Fastify** (close runner-up): excellent TypeScript story, strong
  validation hooks (`fastify-zod`), better raw throughput than Express.
  Loses to Hono on (a) Vercel AI SDK adapter maturity; (b) Lambda
  adapter ergonomics; (c) Web Standards alignment (Fastify is still
  Node-`req`/`res`-shaped). If we were not using Vercel AI SDK on the
  chat path, Fastify would be a tie.
- **tRPC** (rejected as the *primary* framework): tRPC is a typed-RPC
  layer, not a framework. We're exposing real REST endpoints (`POST
  /api/search` per US-04 AC); tRPC's RPC-shaped contract would force a
  layer-on-top. tRPC could sit *inside* a Hono app for an admin
  surface in M1+, but it's not the right primary at M0.
- **Bare Node `http`** (rejected): no.
- **Next.js API routes** (rejected): the DISCUSS-locked decision is
  Vite + React for `apps/web`. Adopting Next.js for routing would
  contradict that without justification. Vite + SPA front-end + Hono
  back-end is the explicit shape.

## Migration path

This ADR is stable across M0–M3. The Lambda adapter migration at M1 is
a 30-line change (swap `@hono/node-server` for `hono/aws-lambda`); routes
are unchanged.

If Hono ever stagnates (the maintainer is solo; bus factor risk), the
migration to Fastify is non-trivial but bounded: route signatures are
shallow, middleware contracts re-implement easily. The high-cost
re-implementation is the Vercel AI SDK streaming adapter — but Vercel
ships adapters for several frameworks; the choice would be data-driven
at the time.

## Architectural enforcement

- **eslint-plugin-boundaries**: `apps/api` may import from
  `packages/schemas`, `packages/db`, `packages/search`,
  `packages/enrichment`, `packages/observability` — but NOT directly
  from `apps/ingestion` (cross-app coupling forbidden). Lint-time.
- **Hono validator middleware**: every route handler is wrapped in
  `zValidator('json', schema)` from `@hono/zod-validator`. Static
  audit: a custom ESLint rule (or a smoke test) asserts that no route
  handler exists without a validator wrapper.

## References

- US-04 AC (`POST /api/search` accepting `{query, limit, bloom_level?}`)
- US-07 AC (`{results: [], reason: "no_match"}` structured response)
- ADR-002 §Migration path (M1 wraps API in serverless)
- `docs/product/architecture/brief.md` §1 C4 L2 (single Node process at M0)
- Hono documentation (verify version at install time)
- Vercel AI SDK documentation (`toDataStreamResponse` integration)
