# Slice 06 — Zero-result recovery and honest reformulation
#
# Maps to US-07 in feature-delta.md, Slice 06, and KPI #6 (0 hallucinated titles).
# Load-bearing on SearchResultSchema (discriminated union, kind: "results" | "no_match", DM-9).

Feature: Agent handles zero-result searches honestly and proposes reformulations
  As Priya (medical student)
  I need the agent to admit when the corpus has nothing and to suggest
  rewording — not to invent question titles.

  Background:
    Given a clean local environment with Postgres and pgvector running via docker compose
    And the database schema has been migrated

  @driving_port @real-io @us-07 @kpi
  Scenario: Search endpoint returns the no-match discriminator when the corpus has no topical question
    Given the corpus does not contain any question about "Sjogren posterior column degeneration"
    When a client searches for "Sjogren syndrome posterior column degeneration"
    Then the search response carries the discriminator "no_match"
    And the response's results array is empty
    And the response's reason field is "no_match"

  @driving_port @real-io @us-07 @kpi
  Scenario: Agent reply on zero results states no match and offers 2-3 reformulations without inventing titles
    Given the corpus does not contain any question about "Sjogren posterior column degeneration"
    And the chat language model is replaced by a mock that follows the honest-empty policy
    When Priya asks about "Sjogren syndrome posterior column degeneration"
    Then the agent's reply explicitly states no questions matched
    And the agent's reply offers at least 2 alternative reformulations of the original query
    And the agent's reply does not contain any invented question titles

  @driving_port @real-io @us-07 @kpi
  Scenario: Agent reply on off-topic query asks for clarification rather than fabricating results
    Given the corpus has no questions for "underwater basket weaving in medicine"
    And the chat language model is replaced by a mock that asks for clarification
    When Priya asks "underwater basket weaving in medicine"
    Then the agent's reply does not claim any matches were found
    And the agent's reply asks whether the user meant a different topic
    And the agent's reply does not contain any invented question titles

  @driving_port @real-io @us-07
  Scenario: Student opts into a reformulation and the agent issues a fresh search
    Given the agent has offered three reformulations for "Sjogren posterior column degeneration"
    And the corpus contains two questions about "Sjogren neurological complications"
    And the chat language model is replaced by a mock that re-searches with the chosen reformulation
    When Priya says "yes, try option 1"
    Then the agent invokes the search tool with the option 1 query
    And the agent presents both Sjogren neurological-complications questions

  @driving_port @real-io @us-07 @kpi
  Scenario: Even under a 10-turn conversation, an empty search result is reported honestly
    Given a 10-turn heart-failure conversation has accumulated
    And the latest search returns no results
    And the chat language model is replaced by a mock that follows the honest-empty policy under conversational pressure
    When Priya asks a new query that has no matches
    Then the agent's reply explicitly states no matches were found
    And the agent's reply does not refer to any prior heart-failure result as if it matched the new query

  @property @driving_port @real-io @us-07
  Scenario: Across a labeled empty-set test set, zero invented titles appear in agent replies
    Given an empty-set test set of five queries known to return no_match
    And the chat language model is replaced by a mock that follows the honest-empty policy
    When the agent replies to each empty-set query
    Then every reply contains no question title that is not in the corpus
