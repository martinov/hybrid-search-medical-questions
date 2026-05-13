// @netea/db/migrate-cli — Standalone migration entry point.
//
// Invoked by `pnpm db:migrate`. Reads DATABASE_URL from env and runs the
// idempotent bootstrap SQL in migrations.ts. Ingestion runs the same
// migrate() internally (apps/ingestion/src/cli.ts), so this CLI exists
// only for operators who want to apply the schema without ingesting.

import { migrate } from "./migrations.js";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  process.stderr.write(
    "FATAL: DATABASE_URL environment variable is not set. " +
      "See .env.example.\n",
  );
  process.exit(2);
}

try {
  await migrate(databaseUrl);
  process.stdout.write("Migration complete.\n");
} catch (err) {
  process.stderr.write(
    `Migration failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(1);
}
