-- Postgres init script for Netea PoC.
-- Runs once on a fresh data dir (pgvector/pgvector:pg16 entrypoint).
-- Extensions are required by:
--   - pgvector   → embedding vector(1536) column + HNSW index (ADR-005)
--   - pg_trgm    → fuzzy lexical matches in hybrid search (DM-7)
--   - uuid-ossp  → uuid_generate_v4() (UUID v7 fallback; pinned in Drizzle schema)

CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
