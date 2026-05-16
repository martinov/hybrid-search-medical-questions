// Unit test for the chat-agent system prompt.
//
// Polish change (v2): the UI now renders structured result cards for the
// `searchQuestions` tool-output. The prompt must NOT instruct the model to
// re-list results in prose, or the user sees every match twice (once as a
// card, once as markdown). These assertions pin that policy.

import { describe, it, expect } from "vitest";
import { SYSTEM_PROMPT } from "./system-prompt.js";

describe("SYSTEM_PROMPT formatting policy", () => {
  it("declares a Formatting policy section", () => {
    expect(SYSTEM_PROMPT).toMatch(/Formatting policy/i);
  });

  it("instructs the model to emit no text when searchQuestions returns results", () => {
    // Regression guard: even brief framing prose ('Below are some questions
    // I found:') is redundant noise once the UI renders cards. The prompt
    // must require silence in the results branch, not just 'don't list'.
    expect(SYSTEM_PROMPT).toMatch(/Emit NO text/i);
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("card");
  });

  it("still requires a markdown list for no_match reformulation suggestions", () => {
    // The no_match branch has no cards, so the agent's prose IS the reply
    // and reformulation suggestions still need to render as a readable list.
    expect(SYSTEM_PROMPT).toMatch(/reformulation suggestions[\s\S]*markdown list/i);
  });

  it("preserves the existing anti-hallucination policy", () => {
    // Regression guard: editing the formatting section must not drop the
    // load-bearing Zero-Result / no-invented-titles constraints.
    expect(SYSTEM_PROMPT).toMatch(/NEVER invent titles/);
    expect(SYSTEM_PROMPT).toMatch(/Zero-Result Policy/);
  });
});
