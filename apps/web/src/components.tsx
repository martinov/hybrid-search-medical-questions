// apps/web/src/components — Result cards, bloom badges, and no-match panel.
// Render the structured `search_questions` tool-output alongside the agent's
// prose so the bloom-level signal, specialty, and score are legible at a
// glance instead of buried in LLM-formatted markdown.

import type { ReactElement } from "react";

export type BloomLevel = "recall" | "application" | "analysis";

export type SearchResultItem = {
  id: string;
  title: string;
  content: string;
  bloom_level: BloomLevel;
  medical_specialty: string;
  score: number;
};

export type SearchResultsOutput = {
  kind: "results";
  results: SearchResultItem[];
  total: number;
};

export type NoMatchOutput = {
  kind: "no_match";
  results: [];
  reason: "no_match" | "no_match_with_filter";
};

export type SearchToolOutput = SearchResultsOutput | NoMatchOutput;

const BLOOM_PALETTE: Record<
  BloomLevel,
  { fg: string; bg: string; border: string }
> = {
  recall: { fg: "#1e40af", bg: "#dbeafe", border: "#bfdbfe" },
  application: { fg: "#b45309", bg: "#fef3c7", border: "#fde68a" },
  analysis: { fg: "#6d28d9", bg: "#ede9fe", border: "#ddd6fe" },
};

export function BloomBadge({ level }: { level: BloomLevel }): ReactElement {
  const palette = BLOOM_PALETTE[level];
  return (
    <span
      data-testid="bloom-badge"
      data-level={level}
      style={{
        display: "inline-block",
        padding: "0.15rem 0.55rem",
        fontSize: "0.72rem",
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: "0.04em",
        color: palette.fg,
        background: palette.bg,
        border: `1px solid ${palette.border}`,
        borderRadius: 999,
      }}
    >
      {level}
    </span>
  );
}

function clipExcerpt(content: string, max = 220): string {
  const cleaned = content.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  const cut = cleaned.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut}…`;
}

export function ResultCard({
  ordinal,
  result,
}: {
  ordinal: number;
  result: SearchResultItem;
}): ReactElement {
  return (
    <article
      data-testid="result-card"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.5rem",
        padding: "0.9rem 1rem",
        background: "#fff",
        border: "1px solid #e5e7eb",
        borderRadius: 10,
        boxShadow: "0 1px 2px rgba(0,0,0,0.03)",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "0.6rem",
          flexWrap: "wrap",
        }}
      >
        <span
          aria-hidden
          style={{
            color: "#9ca3af",
            fontVariantNumeric: "tabular-nums",
            fontSize: "0.8rem",
            fontWeight: 600,
          }}
        >
          #{ordinal}
        </span>
        <h3
          data-testid="result-card-title"
          style={{ margin: 0, fontSize: "1rem", fontWeight: 600, color: "#111827" }}
        >
          {result.title}
        </h3>
      </header>
      <p
        style={{
          margin: 0,
          color: "#374151",
          fontSize: "0.92rem",
          lineHeight: 1.55,
        }}
      >
        {clipExcerpt(result.content)}
      </p>
      <footer
        style={{
          display: "flex",
          alignItems: "center",
          gap: "0.6rem",
          flexWrap: "wrap",
          fontSize: "0.78rem",
          color: "#6b7280",
        }}
      >
        <BloomBadge level={result.bloom_level} />
        <span data-testid="result-card-specialty">{result.medical_specialty}</span>
        <span
          aria-hidden
          style={{ color: "#d1d5db" }}
        >
          •
        </span>
        <span title="Hybrid relevance score" style={{ fontVariantNumeric: "tabular-nums" }}>
          score {result.score.toFixed(2)}
        </span>
      </footer>
    </article>
  );
}

export function ResultsList({
  output,
}: {
  output: SearchResultsOutput;
}): ReactElement {
  return (
    <section
      aria-label={`${output.total} search results`}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.6rem",
        marginTop: "0.6rem",
      }}
    >
      {output.results.map((r, i) => (
        <ResultCard key={r.id} ordinal={i + 1} result={r} />
      ))}
    </section>
  );
}

export function NoMatchPanel({
  output,
}: {
  output: NoMatchOutput;
}): ReactElement {
  const isFiltered = output.reason === "no_match_with_filter";
  return (
    <section
      data-testid="no-match-panel"
      data-reason={output.reason}
      role="status"
      style={{
        marginTop: "0.6rem",
        padding: "0.8rem 1rem",
        background: "#fffbeb",
        border: "1px solid #fde68a",
        borderRadius: 10,
        color: "#78350f",
      }}
    >
      <strong style={{ display: "block", marginBottom: "0.25rem" }}>
        No matches found
      </strong>
      <span style={{ fontSize: "0.9rem", color: "#92400e" }}>
        {isFiltered
          ? "The active Bloom-level filter eliminated every candidate. The agent will offer to broaden or drop the filter."
          : "Nothing in the question bank matched this query. The agent will suggest reformulations."}
      </span>
    </section>
  );
}
