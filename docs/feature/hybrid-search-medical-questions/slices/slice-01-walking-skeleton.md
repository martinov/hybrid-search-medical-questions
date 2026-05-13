# Slice 01: Walking Skeleton — End-to-end thinnest slice

**Status**: Walking Skeleton (highest priority — derisks the integration backbone)
**Estimated effort**: 1-2 days (within PoC budget)
**Learning hypothesis**: We can take a raw JSON question, enrich it with a Zod-validated LLM call, write it to Postgres with both lexical and vector indexing, query it via hybrid search, retrieve it through an agent tool call, and render it in a chat UI — within a single integrated path.

## What is in this slice

Exactly one task per backbone activity. No retries, no quarantine, no cost telemetry, no bloom filtering. Just the wire.

| Activity | Task in this slice | What it proves |
|---|---|---|
| Ingest raw questions | Read **one** hardcoded question from `data/sample-questions.json` | JSON loader works |
| Enrich with LLM | Call OpenAI with structured output, Zod-parse, write to Postgres | LLM integration + schema enforcement |
| Index for hybrid search | `enriched_questions` table has both a `tsvector` generated column and a `pgvector` column populated | pgvector + tsvector together |
| Hybrid search retrieval | `POST /api/search` returns the top-1 result combining lexical + semantic ranking | Hybrid query works end-to-end |
| Agent retrieval | Mastra agent with one tool `search_questions` calls the search endpoint and returns the result | Agent framework wired |
| Chat UI display | Vite+React page with Vercel AI SDK `useChat`, single chat input, streams the agent response | Browser-visible result |

## Walking-skeleton scope explicitly

- **One** sample question (e.g., "Cardiology: Patient Symptoms")
- **One** enrichment call (no retries — if it fails, fail loud)
- **One** indexed row in Postgres with both indexes populated
- **One** search query path (hybrid, even at k=1)
- **One** agent tool invocation
- **One** chat exchange in the browser

## Out of scope for this slice

- Retries / quarantine (Slice 02)
- Cost / latency telemetry (Slice 03)
- Bloom-level filtering in queries (Slice 04)
- Conversation context / multi-turn (Slice 05)
- Multiple questions / batch processing (Slice 02 expands the ingest loop)
- Error UI in chat (Slice 02)

## Demo

```
Terminal A:                                    Browser:
$ pnpm run ingest:one                          [Chat]
Enriched 1 question (id=q-001).                YOU: "shortness of breath patient"
                                               AGENT: I found 1 question:
                                                      Cardiology: Patient Symptoms
```

## Taste tests (must all pass)

- [x] Touches every backbone activity (ingest, enrich, index, search, agent, UI)
- [x] Produces user-visible output (chat message in browser)
- [x] Independently demoable in a single session
- [x] Failure of any single component is loud (no silent fallback that masks broken wiring)
- [x] Effort within 1-3 days
- [x] Has a real entry point: `pnpm run ingest:one` AND `curl POST /api/chat` AND browser

## Risks specific to this slice

- **LLM returning non-conformant JSON on first attempt**: in the skeleton we accept loud failure; Slice 02 introduces retry/quarantine
- **pgvector + tsvector dual-write atomicity**: use a Postgres-generated tsvector column to make this automatic; the embedding write is application-managed
- **OpenAI rate limit on a single call**: acceptable risk for the skeleton; a single 429 is loud and recoverable
