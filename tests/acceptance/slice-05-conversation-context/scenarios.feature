# Slice 05 — Multi-turn conversation context
#
# Maps to US-06 in feature-delta.md and Slice 05.
# Driving port: apps/api HTTP — POST /api/chat. Mocked chat model.

Feature: Agent maintains conversation context across turns
  As Priya (medical student)
  I want the agent to keep up with my refinements and ordinal references
  so the chat feels coherent rather than stateless.

  Background:
    Given a clean local environment with Postgres and pgvector running via docker compose
    And the database schema has been migrated
    And the corpus contains three questions about heart failure with mixed Bloom levels

  @driving_port @real-io @us-06
  Scenario: Ordinal reference resolves to a previously presented result without re-searching
    Given the chat language model is replaced by a mock that opens the second prior result without calling the search tool
    And the agent presented three heart-failure questions in the prior turn
    When Priya says "open the second one"
    Then the agent's reply renders the full content of the second prior result
    And the agent did not invoke the search tool during this turn

  @driving_port @real-io @us-06
  Scenario: Filtering refinement reuses the prior result set
    Given the chat language model is replaced by a mock that filters the prior set client-side
    And the agent presented three heart-failure results with two at Bloom level "application"
    When Priya says "only application-level among those"
    Then the agent's reply contains only the two prior application-level questions
    And the agent did not invoke the search tool during this turn

  @driving_port @real-io @us-06
  Scenario: Topic shift triggers a fresh search rather than reusing prior context
    Given the chat language model is replaced by a mock that detects topic shift and re-searches
    And the agent has been discussing heart-failure questions
    When Priya says "what about diabetic ketoacidosis questions instead?"
    Then the agent invokes the search tool with a query about diabetic ketoacidosis
    And the agent's reply does not reference any heart-failure question by title

  @driving_port @real-io @us-06
  Scenario: A twenty-turn conversation still produces a coherent reply
    Given the chat language model is replaced by a mock that responds normally
    And a twenty-turn conversation history is supplied
    When Priya asks a follow-up question
    Then the agent responds with a non-empty reply within five seconds

  @driving_port @real-io @us-06
  Scenario: Ordinal reference to a non-existent index degrades gracefully
    Given the chat language model is replaced by a mock that handles out-of-range ordinals
    And the agent presented three results in the prior turn
    When Priya says "open the seventh one"
    Then the agent's reply states no seventh result exists
    And the agent did not invent a question to fill the gap
