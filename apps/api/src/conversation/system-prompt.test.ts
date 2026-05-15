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

  it("forbids re-listing tool results in prose (cards render them)", () => {
    // Regression guard: the user reported every result rendering twice when
    // the prompt told the model to emit a markdown ordered list of results.
    expect(SYSTEM_PROMPT).toMatch(/Do NOT list each result/i);
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
