// Prompt version v1 — wraps the enrichment-v1.txt template.
//
// Contract: the first non-empty line is `Title: <title>` so the Slice 02
// scripted mock can route per-question responses.

export const PROMPT_VERSION = "v1" as const;

export const PROMPT_TEMPLATE_V1 = `Title: {{title}}

Content:
{{content}}

Answers:
{{answers}}

Explanation:
{{explanation}}

Return ONLY a JSON object matching the EnrichmentOutput schema.`;

export function buildEnrichmentPrompt(question: {
  title: string;
  content: string;
  answers: ReadonlyArray<{ content: string; is_correct: boolean }>;
  explanation: string;
}): string {
  const answersBlock = question.answers
    .map((a, i) => `${i + 1}. [${a.is_correct ? "correct" : "incorrect"}] ${a.content}`)
    .join("\n");
  return PROMPT_TEMPLATE_V1.replace("{{title}}", question.title)
    .replace("{{content}}", question.content)
    .replace("{{answers}}", answersBlock)
    .replace("{{explanation}}", question.explanation);
}

export const prompts = {
  v1: {
    version: PROMPT_VERSION,
    template: PROMPT_TEMPLATE_V1,
    build: buildEnrichmentPrompt,
  },
} as const;
