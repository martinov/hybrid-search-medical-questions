# Slice 01 — Walking Skeleton: One medical question end-to-end
#
# Maps to US-01 in feature-delta.md and slices/slice-01-walking-skeleton.md.
# Walking-Skeleton Strategy B (real local + fake costly): real Postgres+pgvector
# via docker compose, real filesystem, real Drizzle, real RRF; fake OpenAI via
# AI SDK MockLanguageModelV1 / MockEmbeddingModelV1.
#
# All scenarios use Given-When-Then in business language. Driving ports invoked:
#   - apps/ingestion CLI ("pnpm run ingest:one <path>")
#   - apps/api HTTP: POST /api/search, POST /api/chat
#   - apps/web browser surface (Playwright, in tests/e2e/)
#
# Tag legend:
#   @walking_skeleton — proves the integration backbone end-to-end
#   @driving_port     — invoked through a public entry point (CLI or HTTP)
#   @real-io          — real Postgres + real filesystem; mocked LLM only
#   @kpi              — verifies a KPI from feature-delta.md §Outcome KPIs Summary
#   @us-01            — story traceability

Feature: A medical student finds an ingested question end-to-end
  As Priya (3rd-year medical student preparing for USMLE Step 1)
  And as Sam (content-ops admin building the pipeline)
  We need the walking skeleton to prove that one raw question can be
  ingested, enriched, indexed, searched, retrieved through an agent,
  and seen in a chat reply — within a single integrated path.

  Background:
    Given a clean local environment with Postgres and pgvector running via docker compose
    And the database schema has been migrated
    And the OpenAI model is replaced by a deterministic mock that returns a valid enrichment for the seed question

  @walking_skeleton @driving_port @real-io @us-01 @kpi
  Scenario: One sample question survives the full pipeline
    Given a sample questions file at "data/sample-questions.json" containing one question titled "Cardiology: Patient Symptoms"
    When Sam runs the single-question ingestion command on that file
    Then exactly one enriched question is stored in the corpus
    And the stored question has a Bloom level
    And the stored question has at least 3 prominent keywords
    And the stored question has an embedding vector
    And the stored question is searchable by both keyword and meaning

  @walking_skeleton @driving_port @real-io @us-01 @kpi
  Scenario: Student finds the ingested question through the search endpoint
    Given Sam has ingested the "Cardiology: Patient Symptoms" question
    When a client searches for "patient with dyspnea and JVD" through the search endpoint
    Then the search response contains at least one result
    And the first result is the ingested cardiology question
    And the first result includes title, content, Bloom level, and a relevance score

  @walking_skeleton @driving_port @real-io @us-01 @kpi
  Scenario: Student sees the ingested question referenced in a chat reply
    Given Sam has ingested the "Cardiology: Patient Symptoms" question
    And the chat language model is replaced by a mock that streams a reply citing the search result
    When Priya asks "shortness of breath with leg swelling" through the chat endpoint
    Then the chat reply begins streaming within 2 seconds
    And the chat reply references the ingested question by its title
    And the chat reply includes a content excerpt of at least 100 characters
    And the chat reply does not invent any question titles

  @driving_port @real-io @us-01
  Scenario: Missing OpenAI credential aborts the run before any database write
    Given the OPENAI_API_KEY environment variable is not set
    And the corpus is empty
    When Sam runs the single-question ingestion command
    Then the command exits with code 2
    And the operator-facing error names the missing OPENAI_API_KEY
    And the corpus remains empty

  @driving_port @real-io @us-01
  Scenario: Health endpoint reports the system is ready
    When a client requests the health endpoint
    Then the response confirms the api is healthy
    And the response confirms the database connection is healthy
