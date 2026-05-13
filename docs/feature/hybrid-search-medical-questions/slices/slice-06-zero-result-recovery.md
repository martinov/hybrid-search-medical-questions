# Slice 06: Zero-result recovery and reformulation

**Status**: Release 3 (post-PoC polish; may slip if 8-hour budget tight)
**Estimated effort**: 0.5 day
**Learning hypothesis**: When the corpus genuinely has no topical match, the agent's failure mode is the difference between "tool is broken" and "I learned that my query needed reframing." Closing this loop is what protects the student's emotional arc.

## What is in this slice

| Task | Detail |
|---|---|
| Agent detects empty result set | Tool returns `{ results: [], reason: "no_match" }` (not just empty array) |
| Agent does NOT fabricate | Explicitly state "no questions matched"; no hallucinated titles |
| Suggested reformulations | Agent proposes 2-3 broader queries based on the original (uses LLM, not retrieval) |
| Optional broader retry | Agent offers "Want me to try a broader search?" — user opts in |

## Why this matters disproportionately for emotional arc

For the medical student, a zero-result search is the spike-anxiety moment ("am I using the wrong vocabulary? am I behind?"). The default LLM behavior is to hallucinate plausible-sounding question titles to fill the gap, which destroys trust. This slice makes the failure mode honest AND useful.

## Out of scope

- Personalized reformulation based on user history (no user accounts in PoC)
- Active-learning loop where the system learns which reformulations work
- Quality scoring of suggested reformulations

## Demo

```
YOU:   Show me questions about Sjogren syndrome posterior column degeneration

AGENT: I did not find any questions matching that combination of concepts
       in the corpus.

       Three angles you could try instead:
       1. "questions about Sjogren syndrome neurological complications"
       2. "questions about posterior column degeneration" (broader)
       3. "questions about peripheral neuropathy in autoimmune disease"

       Want me to try option 1?

YOU:   Yes please

AGENT: (Searching for Sjogren neurological complications...)
       I found 2 questions: ...
```

## Taste tests

- [x] Touches search + chat in a new way (failure-mode handling)
- [x] Produces user-visible output (honest empty response + actionable suggestions)
- [x] Independently demoable
- [x] Effort 0.5 day
