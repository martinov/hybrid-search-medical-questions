// @netea/db/repos/domain-events — Domain event store per ADR-011.

import type { DomainEvent } from "@netea/schemas";
import { getDb } from "../client.js";

export type DomainEventRow = {
  id: string;
  event_type: string;
  aggregate_type: string;
  aggregate_id: string;
  occurred_at: string;
  payload: unknown;
  prompt_version: string | null;
  model: string | null;
  correlation_id: string | null;
};

function aggregateFromEvent(event: DomainEvent): {
  aggregate_type: string;
  aggregate_id: string;
} {
  switch (event.type) {
    case "BatchOpened":
    case "BatchClosed":
      return { aggregate_type: "IngestionBatch", aggregate_id: event.batch_id };
    default:
      return { aggregate_type: "Unknown", aggregate_id: "unknown" };
  }
}

export class DomainEventsRepo {
  async append(
    event: DomainEvent,
    context?: { correlation_id?: string },
  ): Promise<void> {
    const db = getDb();
    const { aggregate_type, aggregate_id } = aggregateFromEvent(event);
    await db.$client`
      INSERT INTO domain_events (
        event_type, aggregate_type, aggregate_id, payload, correlation_id
      ) VALUES (
        ${event.type},
        ${aggregate_type},
        ${aggregate_id},
        ${JSON.stringify(event)}::jsonb,
        ${context?.correlation_id ?? null}
      )
    `;
  }

  async findByAggregate(
    aggregateType: string,
    aggregateId: string,
  ): Promise<DomainEventRow[]> {
    const db = getDb();
    const rows = await db.$client<DomainEventRow[]>`
      SELECT * FROM domain_events
      WHERE aggregate_type = ${aggregateType}
        AND aggregate_id = ${aggregateId}
      ORDER BY occurred_at ASC
    `;
    return rows;
  }
}
