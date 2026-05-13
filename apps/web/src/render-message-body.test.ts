// Unit test for the message-body renderer used inside the assistant bubble.
//
// Polish change: the assistant emits markdown (numbered lists, bold titles).
// The chat UI used to render raw text, producing a wall of text. We now route
// assistant text through a markdown renderer while leaving user text as-is.
//
// Driving port: the `renderMessageBody({role, text})` pure function. We assert
// at the observable boundary — the HTML string produced by React's static
// renderer.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderMessageBody } from "./render-message-body.js";

const ASSISTANT_MARKDOWN = [
  "Here are the results:",
  "",
  "1. **Cardiology: Patient Symptoms**",
  "   A 68-year-old man presents with shortness of breath.",
  "",
  "2. **Pulmonology: Asthma**",
  "   A 22-year-old woman with episodic wheezing.",
].join("\n");

describe("renderMessageBody", () => {
  it("renders an assistant markdown numbered list as <ol>/<li>", () => {
    const html = renderToStaticMarkup(
      renderMessageBody({ role: "assistant", text: ASSISTANT_MARKDOWN }),
    );
    expect(html).toContain("<ol");
    expect(html).toContain("<li");
    expect(html).toContain("<strong>Cardiology: Patient Symptoms</strong>");
  });

  it("renders user messages as plain text (no markdown processing)", () => {
    // A user typing "1) my question" should NOT become a list — we keep
    // user input verbatim so we never silently transform what they wrote.
    const html = renderToStaticMarkup(
      renderMessageBody({ role: "user", text: "1) shortness of breath" }),
    );
    expect(html).not.toContain("<ol");
    expect(html).not.toContain("<li");
    expect(html).toContain("1) shortness of breath");
  });

  it("does not execute embedded HTML in assistant content (XSS guard)", () => {
    // react-markdown's default safe pipeline must NOT render raw HTML script.
    const html = renderToStaticMarkup(
      renderMessageBody({
        role: "assistant",
        text: "hello <script>alert('xss')</script> world",
      }),
    );
    expect(html).not.toContain("<script>");
  });
});
