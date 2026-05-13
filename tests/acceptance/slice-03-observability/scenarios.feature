# Slice 03 — Run observability: cost, latency, validation rate, persisted run record
#
# Maps to US-03 and to KPIs #4 (observability surface) and #7 (cost).
# Driving port: apps/ingestion CLI ("pnpm run ingest --file <path>") plus GET /api/healthz.

Feature: Operator can defend pipeline cost, latency, and validation rate with numbers
  As Sam (content-ops admin)
  I need every run to surface cost, latency, and validation rates,
  and to persist a machine-readable record so historical comparison
  is possible.

  Background:
    Given a clean local environment with Postgres and pgvector running via docker compose
    And the database schema has been migrated
    And a batch input file with ten well-formed medical questions exists at "data/sample-questions.json"

  @driving_port @real-io @us-03 @kpi
  Scenario: Run summary reports total cost computed from token usage and pricing
    Given the language model returns deterministic token usage for every call
    When Sam runs the batch ingestion command on the sample file
    Then the printed run summary reports total input tokens used
    And the printed run summary reports total output tokens used
    And the printed run summary reports total cost in US dollars computed from the pricing table
    And the printed run summary reports an average cost per question

  @driving_port @real-io @us-03 @kpi
  Scenario: Run summary reports average and p95 latency
    Given the language model takes a known latency for each call
    When Sam runs the batch ingestion command on the sample file
    Then the printed run summary reports an average call latency in milliseconds
    And the printed run summary reports a p95 call latency in milliseconds
    And the printed run summary reports a total run duration

  @driving_port @real-io @us-03 @kpi
  Scenario: Run summary reports validation breakdown
    Given seven questions pass first-try, two pass after one retry, and one is quarantined
    When Sam runs the batch ingestion command on the sample file
    Then the printed run summary reports first-try-pass at seventy percent
    And the printed run summary reports after-retry at twenty percent
    And the printed run summary reports quarantine at ten percent

  @driving_port @real-io @us-03 @kpi
  Scenario: Run record is persisted to logs/runs as valid JSON
    When Sam runs the batch ingestion command on the sample file
    Then a run-record file exists at "logs/runs/{batch_id}.json"
    And that file is valid JSON
    And the file contains the same cost, latency, and validation numbers as the printed summary

  @driving_port @real-io @us-03
  Scenario: Two consecutive runs produce two distinct run records suitable for comparison
    When Sam runs the batch ingestion command twice in a row on the sample file
    Then two distinct run-record files exist under "logs/runs/"
    And the latency numbers in each are independently queryable

  @driving_port @real-io @us-03 @infrastructure-failure
  Scenario: Run aborts gracefully when cost cap is exceeded mid-run
    Given a cost cap of one cent is configured
    When Sam runs the batch ingestion command on the sample file
    Then the run aborts before completing all questions
    And a partial run record is persisted to "logs/runs/"
    And the partial record states the abort reason as "cost cap exceeded"
    And the enriched-corpus and quarantine counts in the partial record match the database

  @driving_port @real-io @us-03 @infrastructure-failure
  Scenario: Run aborts loudly when the logs directory is not writable
    Given the "logs/runs/" directory is read-only
    When Sam runs the batch ingestion command on the sample file
    Then the command exits with a non-zero code
    And the operator-facing error names the unwritable logs directory
