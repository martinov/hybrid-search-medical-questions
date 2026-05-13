// @netea/schemas/bloom — Bloom taxonomy enum (PoC 3-level subset).
// Per brief §App Arch 5.2 and DIVERGE §5a: stored as `text` + CHECK constraint,
// NOT a Postgres enum. PoC scope = 3 levels; full 6-level migration is M1+.

import { z } from "zod";

export const __SCAFFOLD__ = true as const;

export const BLOOM_LEVELS_POC = ["recall", "application", "analysis"] as const;
export const BLOOM_LEVELS_FULL = [
  "remember",
  "understand",
  "apply",
  "analyze",
  "evaluate",
  "create",
] as const;

export const BloomLevel = z.enum(BLOOM_LEVELS_POC);
export type BloomLevel = z.infer<typeof BloomLevel>;
