// Unit test for the chat-agent system prompt.
//
// Polish change (post-feature): the assistant was emitting inline run-on
// numbered lists ("1) ... 2) ...") that rendered as a wall of text. We now
// instruct the model to emit markdown so the web UI's markdown renderer
// produces a readable list. These assertions pin the formatting policy in
// the prompt so a future refactor cannot silently drop it.

import { describe, it, expect } from "vitest";
import { SYSTEM_PROMPT } from "./system-prompt.js";

describe("SYSTEM_PROMPT formatting policy", () => {
  it("declares a Formatting policy section", () => {
    expect(SYSTEM_PROMPT).toMatch(/Formatting policy/i);
  });

  it("instructs the model to use markdown ordered lists for results", () => {
    expect(SYSTEM_PROMPT.toLowerCase()).toContain("markdown");
    expect(SYSTEM_PROMPT).toMatch(/ordered list/i);
  });

  it("forbids inline run-on numbered lists", () => {
    // The model used to emit "1) ... 2) ..." inline, producing a wall of text.
    expect(SYSTEM_PROMPT).toMatch(/1\)\s*\.\.\.\s*2\)|inline.*1\)|run-on/i);
  });

  it("preserves the existing anti-hallucination policy", () => {
    // Regression guard: adding the formatting section must not drop the
    // load-bearing Zero-Result / no-invented-titles constraints.
    expect(SYSTEM_PROMPT).toMatch(/NEVER invent titles/);
    expect(SYSTEM_PROMPT).toMatch(/Zero-Result Policy/);
  });
});
