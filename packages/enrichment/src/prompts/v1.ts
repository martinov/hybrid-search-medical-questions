// Prompt version v1 — enrichment prompt template.
//
// Contract: the first non-empty line is `Title: <title>` so the Slice 02
// scripted mock (and operator log-lines) can route by question title.
//
// Slice 02 adds an optional `feedback` argument used by the retry-with-feedback
// loop (Expansion A §2 Layer 4). When present, the feedback block is appended
// AFTER the title line so the title remains the first content line — this
// preserves the routing contract.

export const PROMPT_VERSION = "v1" as const;

export const PROMPT_TEMPLATE_V1 = `Title: {{title}}

Content:
{{content}}

Answers:
{{answers}}

Explanation:
{{explanation}}

Return ONLY a JSON object matching the EnrichmentOutput schema.`;

export type EnrichmentPromptQuestion = {
  title: string;
  content: string;
  answers: ReadonlyArray<{ content: string; is_correct: boolean }>;
  explanation: string;
};

export function buildEnrichmentPrompt(
  question: EnrichmentPromptQuestion,
  options?: { feedback?: string },
): string {
  const answersBlock = question.answers
    .map(
      (a, i) =>
        `${i + 1}. [${a.is_correct ? "correct" : "incorrect"}] ${a.content}`,
    )
    .join("\n");
  const base = PROMPT_TEMPLATE_V1.replace("{{title}}", question.title)
    .replace("{{content}}", question.content)
    .replace("{{answers}}", answersBlock)
    .replace("{{explanation}}", question.explanation);
  if (options?.feedback && options.feedback.length > 0) {
    return `${base}\n\nRetry feedback (your previous attempt was rejected):\n${options.feedback}`;
  }
  return base;
}

export const prompts = {
  v1: {
    version: PROMPT_VERSION,
    template: PROMPT_TEMPLATE_V1,
    build: buildEnrichmentPrompt,
  },
} as const;
