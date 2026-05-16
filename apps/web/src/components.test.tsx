// Unit tests for the structured search-result components.
//
// Driving port: the React components rendered to static HTML. We assert at
// the observable boundary — testid hooks, data attributes, and visible text.

import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BloomBadge,
  NoMatchPanel,
  ResultCard,
  ResultsList,
  type SearchResultItem,
} from "./components.js";

const SAMPLE_RESULT: SearchResultItem = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "Cardiology: Patient Symptoms",
  content:
    "A 68-year-old man presents with shortness of breath, leg swelling, and elevated JVP on exam. " +
    "What is the most likely cause of his presentation? The patient has a history of hypertension " +
    "and diabetes mellitus type 2 with poorly controlled glucose levels.",
  bloom_level: "application",
  medical_specialty: "Cardiology",
  score: 0.87,
  answers: [
    { content: "Acute decompensated heart failure", is_correct: true },
    { content: "Pulmonary embolism", is_correct: false },
    { content: "Pneumonia with sepsis", is_correct: false },
  ],
  explanation:
    "Elevated JVP plus bilateral leg swelling with progressive dyspnea on a hypertensive diabetic " +
    "patient is the classic presentation of acute decompensated heart failure.",
};

describe("BloomBadge", () => {
  it("renders the level as text and a data-level attribute", () => {
    const html = renderToStaticMarkup(<BloomBadge level="analysis" />);
    expect(html).toContain('data-level="analysis"');
    expect(html).toContain("analysis");
    expect(html).toContain('data-testid="bloom-badge"');
  });

  it("uses distinct visual treatments per level (color-coded)", () => {
    const recall = renderToStaticMarkup(<BloomBadge level="recall" />);
    const application = renderToStaticMarkup(<BloomBadge level="application" />);
    const analysis = renderToStaticMarkup(<BloomBadge level="analysis" />);
    // background colors differ per level — sufficient signal that the
    // visual treatment is level-distinguishing.
    expect(new Set([recall, application, analysis]).size).toBe(3);
  });
});

describe("ResultCard", () => {
  it("renders the title, ordinal, bloom badge, and specialty", () => {
    const html = renderToStaticMarkup(
      <ResultCard ordinal={2} result={SAMPLE_RESULT} />,
    );
    expect(html).toContain("Cardiology: Patient Symptoms");
    expect(html).toContain("#2");
    expect(html).toContain('data-level="application"');
    expect(html).toContain("Cardiology");
    expect(html).toContain("score 0.87");
  });

  it("clips long content to an excerpt", () => {
    const longContent = "Lorem ipsum ".repeat(60); // ~720 chars
    const html = renderToStaticMarkup(
      <ResultCard
        ordinal={1}
        result={{ ...SAMPLE_RESULT, content: longContent }}
      />,
    );
    expect(html).toContain("…");
  });

  it("defaults to the collapsed reveal state with neither options nor explanation visible", () => {
    const html = renderToStaticMarkup(
      <ResultCard ordinal={1} result={SAMPLE_RESULT} />,
    );
    expect(html).toContain('data-reveal-state="collapsed"');
    expect(html).toContain('data-testid="reveal-options-button"');
    // Answer choices and explanation should not be in the DOM at all yet.
    expect(html).not.toContain("Acute decompensated heart failure");
    expect(html).not.toContain("Elevated JVP plus");
  });

  it("renders answer choices as clickable buttons in the options state", () => {
    const html = renderToStaticMarkup(
      <ResultCard
        ordinal={1}
        result={SAMPLE_RESULT}
        initialRevealState="options"
      />,
    );
    expect(html).toContain('data-reveal-state="options"');
    expect(html).toContain("Acute decompensated heart failure");
    expect(html).toContain("Pulmonary embolism");
    expect(html).toMatch(
      /<button[^>]*data-testid="answer-option"[\s\S]*Acute decompensated heart failure/,
    );
    // No correctness signal yet — the student is meant to attempt first.
    expect(html).not.toContain('data-testid="correct-marker"');
    expect(html).not.toContain('data-testid="incorrect-marker"');
    expect(html).not.toContain('data-testid="feedback-banner"');
    expect(html).not.toContain("Elevated JVP plus");
    // A "pick the answer" prompt should be visible.
    expect(html).toContain('data-testid="answers-prompt"');
  });

  it("gives positive feedback when the student picks the correct answer", () => {
    const html = renderToStaticMarkup(
      <ResultCard
        ordinal={1}
        result={SAMPLE_RESULT}
        initialRevealState="answered"
        initialPickedIndex={0}
      />,
    );
    expect(html).toContain('data-reveal-state="answered"');
    expect(html).toContain('data-result="correct"');
    expect(html).toContain('data-testid="correct-marker"');
    // The picked option is the correct one — no incorrect marker should render.
    expect(html).not.toContain('data-testid="incorrect-marker"');
    expect(html).toMatch(
      /data-role="correct"[^>]*data-picked="true"[\s\S]*Acute decompensated heart failure/,
    );
    expect(html).toContain("Explanation");
    expect(html).toContain("Elevated JVP plus");
    // After answering the card offers a "Try again" affordance.
    expect(html).toContain('data-testid="try-again-button"');
  });

  it("highlights both the student's wrong pick and the correct answer when the pick is wrong", () => {
    const html = renderToStaticMarkup(
      <ResultCard
        ordinal={1}
        result={SAMPLE_RESULT}
        initialRevealState="answered"
        initialPickedIndex={1}
      />,
    );
    expect(html).toContain('data-result="incorrect"');
    expect(html).toContain('data-testid="incorrect-marker"');
    expect(html).toContain('data-testid="correct-marker"');
    // The picked option (index 1, Pulmonary embolism) carries the incorrect role.
    expect(html).toMatch(
      /data-role="incorrect-pick"[^>]*data-picked="true"[\s\S]*Pulmonary embolism/,
    );
    // The actual correct option (index 0) is still flagged correct.
    expect(html).toMatch(
      /data-role="correct"[\s\S]*Acute decompensated heart failure/,
    );
    expect(html).toContain("Explanation");
  });
});

describe("ResultsList", () => {
  it("renders one card per result", () => {
    const html = renderToStaticMarkup(
      <ResultsList
        output={{
          kind: "results",
          results: [
            SAMPLE_RESULT,
            {
              ...SAMPLE_RESULT,
              id: "22222222-2222-4222-8222-222222222222",
              title: "Pulmonology: Asthma",
            },
          ],
          total: 2,
        }}
      />,
    );
    const cardMatches = html.match(/data-testid="result-card"/g) ?? [];
    expect(cardMatches.length).toBe(2);
    expect(html).toContain("Pulmonology: Asthma");
  });
});

describe("NoMatchPanel", () => {
  it("renders a status panel with the no_match reason", () => {
    const html = renderToStaticMarkup(
      <NoMatchPanel output={{ kind: "no_match", results: [], reason: "no_match" }} />,
    );
    expect(html).toContain('data-testid="no-match-panel"');
    expect(html).toContain('data-reason="no_match"');
    expect(html).toContain("No matches found");
  });

  it("calls out the Bloom filter when reason is no_match_with_filter", () => {
    const html = renderToStaticMarkup(
      <NoMatchPanel
        output={{
          kind: "no_match",
          results: [],
          reason: "no_match_with_filter",
        }}
      />,
    );
    expect(html).toContain('data-reason="no_match_with_filter"');
    expect(html.toLowerCase()).toContain("bloom");
  });
});
