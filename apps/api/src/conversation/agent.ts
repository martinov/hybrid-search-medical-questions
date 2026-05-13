// apps/api/src/conversation/agent — Placeholder.
//
// ENRICH-DELIVER-01: at runtime we use AI SDK 6 `streamText` directly because
// `@mastra/core@1.33.0`'s peer dependency on `zod@^3.23` conflicts with the
// repository's `zod@^4.4`. The chat agent lives inline in `app.ts` for step 1.
// This module is kept as a stable home for the future Mastra wiring.

import type { LanguageModel } from "ai";

export type MedicalSearchAgent = {
  stream(args: {
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
  }): AsyncIterable<string>;
};

export function createMedicalSearchAgent(_opts: {
  chatModel: LanguageModel;
}): MedicalSearchAgent {
  throw new Error(
    "createMedicalSearchAgent: deferred. Step 1 uses AI SDK `streamText` directly per ENRICH-DELIVER-01.",
  );
}
