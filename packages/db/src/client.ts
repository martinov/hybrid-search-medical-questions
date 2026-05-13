// @netea/db/client — Drizzle + postgres-js client factory.
//
// Exposes a `createDbClient(databaseUrl)` factory for composition roots AND a
// `getDb()` helper that lazily resolves a shared connection. The test
// helpers and module-level repo helpers both use `getDb()` so they share a
// single connection pool keyed by the resolved DATABASE_URL.

import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres, { type Sql } from "postgres";
import * as schema from "./schema.js";

export type DrizzleClient = PostgresJsDatabase<typeof schema> & {
  $client: Sql;
};

let cached: { url: string; client: DrizzleClient } | null = null;

function resolveDatabaseUrl(): string {
  const url =
    process.env.TEST_DATABASE_URL ??
    process.env.DATABASE_URL ??
    "postgresql://netea:netea@localhost:5433/netea_test";
  return url;
}

export function createDbClient(databaseUrl: string): DrizzleClient {
  if (!databaseUrl) {
    throw new Error("createDbClient: databaseUrl is required");
  }
  const sql = postgres(databaseUrl, {
    max: 10,
    onnotice: () => {
      /* silence "relation already exists" notices during idempotent migrations */
    },
  });
  return drizzle(sql, { schema }) as DrizzleClient;
}

export function getDb(): DrizzleClient {
  const url = resolveDatabaseUrl();
  if (cached && cached.url === url) return cached.client;
  if (cached) {
    // URL changed — close prior pool.
    void cached.client.$client.end({ timeout: 1 });
  }
  cached = { url, client: createDbClient(url) };
  return cached.client;
}

export async function closeDb(): Promise<void> {
  if (cached) {
    await cached.client.$client.end({ timeout: 5 });
    cached = null;
  }
}
