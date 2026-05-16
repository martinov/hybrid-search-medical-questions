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
  it("renders the title, ordinal, bloom badge, specialty, and answer options inline", () => {
    const html = renderToStaticMarkup(
      <ResultCard ordinal={2} result={SAMPLE_RESULT} />,
    );
    expect(html).toContain("Cardiology: Patient Symptoms");
    expect(html).toContain("#2");
    expect(html).toContain('data-level="application"');
    expect(html).toContain("Cardiology");
    expect(html).toContain("score 0.87");
    // Options must be visible by default — no 'Show options' click required.
    expect(html).toContain("Acute decompensated heart failure");
    expect(html).toContain("Pulmonary embolism");
    expect(html).toMatch(
      /<button[^>]*data-testid="answer-option"[\s\S]*Acute decompensated heart failure/,
    );
  });

  it("renders the full question content without clipping", () => {
    // Regression guard: cards are the question the student has to answer,
    // not a teaser. Clipping would force them to act on incomplete text.
    const longContent =
      "A 68-year-old man with poorly controlled hypertension and type 2 " +
      "diabetes presents to the emergency department with progressively " +
      "worsening shortness of breath over the past four days, bilateral " +
      "lower-extremity swelling, orthopnea requiring three pillows at " +
      "night, paroxysmal nocturnal dyspnea, and an elevated jugular " +
      "venous pressure on examination. Which of the following is the " +
      "single most likely cause of this patient's presentation?";
    expect(longContent.length).toBeGreaterThan(220);
    const html = renderToStaticMarkup(
      <ResultCard
        ordinal={1}
        result={{ ...SAMPLE_RESULT, content: longContent }}
      />,
    );
    expect(html).not.toContain("…");
    // The full final sentence — would have been clipped under the old
    // 220-char rule — must be present in the rendered card.
    expect(html).toContain(
      "most likely cause of this patient&#x27;s presentation?",
    );
  });

  it("collapses whitespace noise but keeps the full text", () => {
    const messyContent =
      "Line one.\n\n  Line two with    extra spaces.\nLine three.";
    const html = renderToStaticMarkup(
      <ResultCard
        ordinal={1}
        result={{ ...SAMPLE_RESULT, content: messyContent }}
      />,
    );
    expect(html).toContain("Line one. Line two with extra spaces. Line three.");
  });

  it("hides feedback and explanation until the student has picked an answer", () => {
    const html = renderToStaticMarkup(
      <ResultCard ordinal={1} result={SAMPLE_RESULT} />,
    );
    expect(html).toContain('data-answered="false"');
    expect(html).not.toContain('data-testid="correct-marker"');
    expect(html).not.toContain('data-testid="incorrect-marker"');
    expect(html).not.toContain('data-testid="answer-feedback"');
    expect(html).not.toContain("Elevated JVP plus");
  });

  it("gives positive feedback when the student picks the correct answer", () => {
    const html = renderToStaticMarkup(
      <ResultCard ordinal={1} result={SAMPLE_RESULT} initialPickedIndex={0} />,
    );
    expect(html).toContain('data-answered="true"');
    expect(html).toContain('data-result="correct"');
    expect(html).toContain('data-testid="correct-marker"');
    // The picked option is the correct one — no incorrect marker should render.
    expect(html).not.toContain('data-testid="incorrect-marker"');
    expect(html).toMatch(
      /data-role="correct"[^>]*data-picked="true"[\s\S]*Acute decompensated heart failure/,
    );
    expect(html).toContain("Explanation");
    expect(html).toContain("Elevated JVP plus");
  });

  it("highlights both the student's wrong pick and the correct answer when the pick is wrong", () => {
    const html = renderToStaticMarkup(
      <ResultCard ordinal={1} result={SAMPLE_RESULT} initialPickedIndex={1} />,
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

  it("renders options as static (non-button) rows after answering — answered state is sticky", () => {
    const html = renderToStaticMarkup(
      <ResultCard ordinal={1} result={SAMPLE_RESULT} initialPickedIndex={0} />,
    );
    // None of the answer-option testids should be on a <button> once
    // picked — re-clicking to retry the same question is theater.
    expect(html).not.toMatch(
      /<button[^>]*data-testid="answer-option"/,
    );
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
