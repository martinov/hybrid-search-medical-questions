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
});

describe("ResultsList", () => {
  it("renders one card per result", () => {
    const html = renderToStaticMarkup(
      <ResultsList
        output={{
          kind: "results",
          results: [
            SAMPLE_RESULT,
            { ...SAMPLE_RESULT, id: "22222222-2222-4222-8222-222222222222", title: "Pulmonology: Asthma" },
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
