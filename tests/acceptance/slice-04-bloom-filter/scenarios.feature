# Slice 04 — Bloom-level filtering in the search and chat journey
#
# Maps to US-05 in feature-delta.md.
# Driving port: apps/api HTTP — POST /api/search and POST /api/chat.
# Uses Bloom enum PoC subset: recall | application | analysis (DIVERGE §5a, DM-1).

Feature: Student filters questions by Bloom cognitive level
  As Priya (medical student)
  I want to focus the result set on a specific cognitive level
  so I can practice recall vs application vs analysis intentionally.

  Background:
    Given a clean local environment with Postgres and pgvector running via docker compose
    And the database schema has been migrated
    And the corpus contains questions about heart failure at three Bloom levels — recall, application, and analysis

  @driving_port @real-io @us-05 @kpi
  Scenario: Search endpoint returns only application-level questions when explicitly filtered
    When a client searches for "heart failure" filtered to Bloom level "application"
    Then every result has Bloom level "application"
    And the total count in the response equals the number of application-level heart-failure questions

  @driving_port @real-io @us-05
  Scenario: Search endpoint rejects an out-of-enum Bloom level with a clear error
    When a client searches for "heart failure" filtered to Bloom level "applying"
    Then the response is rejected as invalid input
    And the error names the valid Bloom-level values

  @driving_port @real-io @us-05
  Scenario: Chat agent extracts the Bloom-level intent from a natural-language refinement
    Given the chat language model is replaced by a mock that extracts the bloom-level intent and invokes the search tool
    And the agent presented three results with mixed Bloom levels in the prior turn
    When Priya says "only application-level, please"
    Then the agent's next reply presents only application-level results from the prior set
    And the agent's next reply states how many of the prior results matched
    And the agent does not introduce any question outside the prior result set

  @driving_port @real-io @us-05
  Scenario: Chat agent handles an empty filtered set by offering the adjacent unfiltered level
    Given the corpus contains application-level questions but no evaluation-level questions about diabetic ketoacidosis
    And the chat language model is replaced by a mock that follows the empty-filtered-set policy
    When Priya asks for evaluation-level diabetic ketoacidosis questions
    Then the agent's reply explicitly states no evaluation-level matches were found
    And the agent offers the available application-level questions as an adjacent option
    And the agent does not silently swap the Bloom level

  @driving_port @real-io @us-05 @kpi
  Scenario: Result cards include the Bloom level for every question
    Given the chat language model is replaced by a mock that streams a card list
    When a client searches for "heart failure"
    Then every result card text contains "Bloom: Recall", "Bloom: Application", or "Bloom: Analysis"

  @property @driving_port @real-io @us-05
  Scenario: Any explicit Bloom filter returns only questions of that Bloom level
    Given the corpus contains questions across all three Bloom levels
    When a client searches with any of the valid Bloom-level filters
    Then every result has the requested Bloom level
