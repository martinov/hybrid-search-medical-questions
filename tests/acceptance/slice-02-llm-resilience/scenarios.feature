# Slice 02 — LLM enrichment resilience: retry, quarantine, transport separation
#
# Maps to US-02 and the F1-F7 failure taxonomy in expansions/A-llm-non-determinism.md.
#
# Failure-mode coverage (Expansion A §1 + decision matrix §3):
#   F1 invalid JSON                 → schema-retry budget, then quarantine
#   F2 shape mismatch               → schema-retry with feedback, then quarantine
#   F3 hallucinated enum value      → schema-retry with feedback, then quarantine
#   F5 sparse keywords array        → schema-retry, then quarantine
#   F6 truncated completion         → schema-retry, then quarantine
#   F7 safety refusal               → NO retry, immediate quarantine
#   Transport 429 / 5xx / network   → transport-retry budget, SEPARATE from schema budget
#
# Driving port: apps/ingestion CLI ("pnpm run ingest --file <path>").
# Tag legend matches Slice 01; @us-02 + @infrastructure-failure for adapter-failure scenarios.

Feature: Enrichment pipeline contains LLM non-determinism without corrupting the corpus
  As Sam (content-ops admin)
  I need the pipeline to validate, retry, quarantine, and report — never
  to silently corrupt the corpus or silently drop a record.

  Background:
    Given a clean local environment with Postgres and pgvector running via docker compose
    And the database schema has been migrated
    And a batch input file with ten well-formed medical questions exists at "data/sample-questions.json"

  @driving_port @real-io @us-02
  Scenario: Enrichment passes first try and writes provenance
    Given the language model returns a valid enrichment for "Renal: AKI vs CKD" on the first call
    When Sam runs the batch ingestion command on the sample file
    Then the enriched corpus contains a row for "Renal: AKI vs CKD" with retry count zero
    And the row carries a prompt version, a model name, and an enrichment timestamp
    And no quarantine row exists for "Renal: AKI vs CKD"

  @driving_port @real-io @us-02
  Scenario: Enrichment succeeds after one retry when first response fails schema validation
    Given the language model returns "applying" instead of a valid Bloom level for "Endocrinology: DKA" on the first call
    And the language model returns a valid enrichment on the second call
    When Sam runs the batch ingestion command on the sample file
    Then the enriched corpus contains a row for "Endocrinology: DKA" with retry count one
    And no quarantine row exists for "Endocrinology: DKA"
    And the operator-facing per-question line shows a schema-retry followed by success

  @driving_port @real-io @us-02 @infrastructure-failure
  Scenario: Question is quarantined after schema-retry budget is exhausted on invalid JSON (F1)
    Given the language model returns truncated invalid JSON for "Neurology: Acute Stroke" on the first call
    And the language model returns truncated invalid JSON on the second call
    And the language model returns truncated invalid JSON on the third call
    When Sam runs the batch ingestion command on the sample file
    Then no enriched-corpus row exists for "Neurology: Acute Stroke"
    And a quarantine row records the source question id, all three raw responses, all three parse errors, and a quarantined-at timestamp
    And the quarantine row's failure-kind is "F1"
    And the operator-facing per-question line shows two schema retries and then a quarantine notice

  @driving_port @real-io @us-02 @infrastructure-failure
  Scenario: Question is quarantined when the language model hallucinates an out-of-enum Bloom level (F3) repeatedly
    Given the language model returns "intermediate" as the Bloom level for "Endocrinology: DKA" on three consecutive calls
    When Sam runs the batch ingestion command on the sample file
    Then no enriched-corpus row exists for "Endocrinology: DKA"
    And the quarantine row's failure-kind is "F3"
    And the last validation error names the Bloom-level enum

  @driving_port @real-io @us-02 @infrastructure-failure
  Scenario: Question is quarantined on first call when the model refuses on safety grounds (F7) without consuming retries
    Given the language model returns a safety refusal with finish reason "content_filter" for "Toxicology: Acetaminophen overdose" on the first call
    When Sam runs the batch ingestion command on the sample file
    Then no enriched-corpus row exists for "Toxicology: Acetaminophen overdose"
    And the quarantine row's failure-kind is "F7"
    And the schema-retry budget was not consumed for that question

  @driving_port @real-io @us-02 @infrastructure-failure
  Scenario: Transient rate-limit is retried separately from the schema-retry budget
    Given the language model returns a rate-limit error for "Pulmonology: Acute Asthma" on the first call
    And the language model returns a valid enrichment on the second call
    When Sam runs the batch ingestion command on the sample file
    Then the enriched corpus contains a row for "Pulmonology: Acute Asthma" with retry count zero
    And no quarantine row exists for "Pulmonology: Acute Asthma"
    And the transport retry did not consume the schema-retry budget

  @driving_port @real-io @us-02 @infrastructure-failure
  Scenario: Question is quarantined when the model returns a sparse keyword list (F5) repeatedly
    Given the language model returns an enrichment with only one keyword for "Hematology: Anemia Workup" on three consecutive calls
    When Sam runs the batch ingestion command on the sample file
    Then no enriched-corpus row exists for "Hematology: Anemia Workup"
    And the quarantine row's failure-kind is "F5"
    And the last validation error references the keyword minimum

  @driving_port @real-io @us-02 @kpi
  Scenario: Run summary numbers match the database counts for the batch
    Given the language model returns valid enrichments for seven questions
    And the language model requires one retry then succeeds for two questions
    And the language model fails persistently for one question
    When Sam runs the batch ingestion command on the sample file
    Then the printed run summary reports nine enriched and one quarantined
    And the enriched-corpus count for the batch equals nine
    And the quarantine count for the batch equals one
    And the first-try-pass percentage in the summary equals seventy percent

  @property @driving_port @real-io @us-02
  Scenario: A quarantined question never reaches the enriched corpus regardless of how many retries were attempted
    Given any question whose enrichment never passes validation within the schema-retry budget
    When the batch ingestion completes
    Then that question appears in the quarantine table
    And that question does not appear in the enriched corpus
