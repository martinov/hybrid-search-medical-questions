// tests/_helpers/fixtures.ts — Test data builders for Slice 02/03.

import type { RawQuestion } from "@netea/schemas";

export const __SCAFFOLD__ = true as const;

/**
 * Build a fully-formed RawQuestion from a partial stub (title only).
 * Slice 02 uses this so the per-question titles in the script Map align
 * with `RawQuestion`-shaped rows on disk.
 */
export function makeFullQuestion(_stub: { title: string }): RawQuestion {
  throw new Error("Not yet implemented — RED scaffold");
}

/**
 * Generate 10 diverse RawQuestions for the Slice 03 observability batch.
 */
export function generateTenQuestions(): RawQuestion[] {
  throw new Error("Not yet implemented — RED scaffold");
}
