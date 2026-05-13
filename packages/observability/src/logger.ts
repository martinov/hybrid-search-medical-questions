// @netea/observability/logger — Structured (pino) logger shared by apps.
// At M0 the contract is "stdout JSON" per ADR-004. OTEL at M1+.

import pino, { type Logger } from "pino";

export const __SCAFFOLD__ = true as const;

export function createLogger(name: string): Logger {
  return pino({
    name,
    level: process.env.LOG_LEVEL ?? "info",
    base: undefined, // no pid/hostname noise in dev
  });
}
