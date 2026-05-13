# Slice 05: Multi-turn conversation context

**Status**: Release 2 (companion to Slice 04 for richer student journey)
**Estimated effort**: 0.5-1 day
**Learning hypothesis**: The Mastra agent can carry conversation context across turns so that follow-up queries refine (rather than restart) the search, which is what creates the "in flow" emotional state.

## What is in this slice

| Task | Detail |
|---|---|
| Agent maintains message history | Vercel AI SDK `useChat` already does this client-side; agent gets the full history on each turn |
| Agent reuses prior search results when refining | Heuristic: if last turn had results and user is filtering, filter the existing results client-side OR re-search with combined filters — agent decides |
| Pronoun resolution | "Show me #2 in detail" / "the second one" / "open that one" routes to the correct question id |
| Topic shift detection | When user changes topic, agent issues a fresh search (does not stale-filter) |

## Why this slice is Release 2

Without conversation context, every turn is a fresh search and the experience feels like grep-from-a-terminal-disguised-as-chat. The student's emotional arc end-state ("in flow") requires that the tool keeps up with her thinking, which means the agent has to understand "show me more like #2."

## Out of scope

- Persistent conversation history across sessions (localStorage / DB)
- Conversation summarization for very long sessions
- Multi-user / authenticated sessions
- Conversation-level analytics (which queries dead-end most often, etc.)

## Demo

```
YOU:   Show me questions about a patient with shortness of breath, JVD,
       and ankle swelling
AGENT: I found 3 questions about heart failure... [3 results]

YOU:   Only application-level, please
AGENT: Filtering to bloom_level: application... [2 of 3 results]

YOU:   Open the second one
AGENT: [renders full content of result #2: HFrEF pharmacotherapy]

YOU:   What about questions on the diagnosis side instead?
AGENT: (Searching the question bank for diagnostic workup of heart failure...)
       [new search, distinct from filtering]
```

## Taste tests

- [x] Touches the chat activity in a new way (multi-turn coherence)
- [x] Produces user-visible output (correct references resolved, no jarring re-searches)
- [x] Independently demoable
- [x] Effort 0.5-1 day
