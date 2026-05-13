# Persona: Medical Student (Exam Prep)

**Persona ID**: `medical-student`
**Role**: End-user (searcher)
**Primary jobs**: `find-questions-by-clinical-intent`, `calibrate-cognitive-difficulty`, `feel-confident-before-exam`

## Snapshot

**Name (representative)**: Priya Raman
**Stage**: 3rd-year medical student preparing for USMLE Step 1 (or equivalent national board exam)
**Context**: 6-8 weeks out from the exam, studying 8-12 hours/day across rotations and dedicated review blocks. Mix of UWorld, Anki, lecture review, and practice question banks.

## Demographics and constraints

- Late 20s. ESL is common in this audience but not universal -- prefers concise English in clinical vocabulary
- Studies on a laptop in libraries, coffee shops, hospital break rooms. Browser-based tools are the default
- Switches between desktop (deep study) and mobile (commute drilling) -- but for THIS feature, desktop browser is the primary target
- Limited attention budget per query: 5-10 seconds to decide if a search result is worth opening
- High intrinsic motivation but high background anxiety. Decision fatigue is real

## Mental model of "search for questions"

She does NOT think in keywords. She thinks in clinical scenarios:

- "Questions like the one with the patient who has crushing chest pain radiating to the jaw"
- "Show me heart failure questions that test pathophys, not just drug names"
- "I keep getting the AKI vs. CKD distinction wrong -- give me more of those"

She does NOT have time to read a syntax guide. She types a sentence, hits enter, and judges the tool in 2 seconds based on whether the first 3 results look topical.

## Pains (Push forces)

1. **Keyword search wastes her time**. Typing "left ventricular failure" misses questions phrased "decompensated heart failure with reduced ejection fraction" even though they test the same concept.
2. **Mismatched difficulty derails sessions**. A pure-recall question when she needs application-level practice feels insulting; a complex multi-step analysis question when she is reviewing basics feels demoralizing.
3. **Zero-result dead-ends spike anxiety**. A search returning nothing makes her question her vocabulary, then her preparation, then her career choice. (Catastrophizing under exam stress is real.)
4. **Vendor-specific question taxonomies are inconsistent**. She has to learn each platform's filter system.

## Gains (Pull forces)

1. A search bar where she can type a clinical scenario in her own words and immediately see 3-5 topical results
2. Confidence that the system understands "heart failure symptoms" includes "dyspnea on exertion" and "JVD" even if those words appear in her query
3. The ability to constrain results by cognitive level when she explicitly wants to (e.g., "give me application-level questions on this")
4. A session that ends with her feeling like she made progress, not like she fought a tool

## Anxieties (Anxiety forces -- the new solution might fail her)

- "What if the AI 'understands' my query wrong and confidently shows me off-topic questions? I'll waste time AND lose trust in the tool"
- "What if it shows me a question that is actually outside the exam scope? I'll over-study"
- "What if it's slow? I have 100s of questions to get through today"

## Habits (Habit forces -- what she does today)

- Opens UWorld, filters by system (Cardiology) and subsystem (Heart Failure), scrolls through a flat list of 200+ questions
- Uses Anki cloze deletions to fill the recall gap; never uses it for application/analysis questions
- Asks her study group (WhatsApp) for "good questions on X"

## What "success" feels like

End of a 1-hour session: a small list of 5-10 questions reviewed, 2-3 weak spots identified, no rage-quit moments, no dead-end zero-result searches. Anxiety converted into a concrete to-do list for tomorrow.

## What she will judge the product on (in 2 seconds)

1. Does the first response come back fast (under 3 seconds)?
2. Do the top 3 results look topically relevant for her query?
3. When she asks a clarifying follow-up, does the agent maintain context?

## Out-of-scope for PoC

- Mobile / responsive design polish
- Personal progress tracking, spaced repetition
- Multi-language UI
- Question authoring or annotation

These are valid future jobs but are not part of the PoC scope.
