// @netea/observability/events — In-process domain event bus.
// Persistence is delegated to @netea/db/repos/domain-events (per ADR-011).

import type { DomainEvent } from "@netea/schemas";

export const __SCAFFOLD__ = true as const;

export type EventListener = (event: DomainEvent) => void | Promise<void>;

export class DomainEventBus {
  private listeners: EventListener[] = [];

  emit(_event: DomainEvent): void {
    throw new Error("Not yet implemented — RED scaffold");
  }

  subscribe(_listener: EventListener): () => void {
    throw new Error("Not yet implemented — RED scaffold");
  }
}
