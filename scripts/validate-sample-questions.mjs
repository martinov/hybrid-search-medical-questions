#!/usr/bin/env node
// Step-0 gate #5: sample-questions.json must parse against RawQuestionSchema.
// One-time validation; deletable after step 1+ wires this into the CI suite.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, "..");
const dataFile = join(repoRoot, "data", "sample-questions.json");

// Replicate the production schema. The production version is at
// packages/schemas/src/ingestion.ts — keep these in sync until step 1+ wires
// in the real import.
const AnswerOption = z.object({ content: z.string().min(1), is_correct: z.boolean() }).strict();
const RawQuestion = z
  .object({
    title: z.string().min(1).max(200),
    content: z.string().min(50),
    answers: z
      .array(AnswerOption)
      .min(2)
      .refine((a) => a.filter((x) => x.is_correct).length === 1, "exactly one is_correct"),
    explanation: z.string().min(1),
  })
  .strict();
const RawQuestionBatch = z.array(RawQuestion).min(1);

const raw = JSON.parse(readFileSync(dataFile, "utf8"));
const result = RawQuestionBatch.safeParse(raw);
if (!result.success) {
  console.error("FAIL data/sample-questions.json:");
  console.error(JSON.stringify(result.error.format(), null, 2));
  process.exit(1);
}
console.log(`OK data/sample-questions.json — ${result.data.length} questions parse cleanly.`);
