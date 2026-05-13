// @netea/schemas/ingestion — Raw input shape from sample JSON files.
// Mirrors brief §App Arch 5.5. The `data/sample-questions.json` file must
// parse against this schema (DELIVER step 0 gate #5).

import { z } from "zod";

export const __SCAFFOLD__ = true as const;

export const AnswerOptionSchema = z
  .object({
    content: z.string().min(1),
    is_correct: z.boolean(),
  })
  .strict();
export type AnswerOption = z.infer<typeof AnswerOptionSchema>;

export const RawQuestionSchema = z
  .object({
    title: z.string().min(1).max(200),
    content: z.string().min(50),
    answers: z
      .array(AnswerOptionSchema)
      .min(2)
      .refine(
        (arr) => arr.filter((a) => a.is_correct).length === 1,
        "exactly one answer must be marked is_correct",
      ),
    explanation: z.string().min(1),
  })
  .strict();
export type RawQuestion = z.infer<typeof RawQuestionSchema>;

export const RawQuestionBatchSchema = z.array(RawQuestionSchema).min(1);
export type RawQuestionBatch = z.infer<typeof RawQuestionBatchSchema>;
