// apps/web/src/components — Result cards, bloom badges, and no-match panel.
// Render the structured `search_questions` tool-output alongside the agent's
// prose so the bloom-level signal, specialty, and score are legible at a
// glance instead of buried in LLM-formatted markdown.

import { useState, type ReactElement } from "react";

export type BloomLevel = "recall" | "application" | "analysis";

export type SearchAnswer = {
  content: string;
  is_correct: boolean;
};

export type SearchResultItem = {
  id: string;
  title: string;
  content: string;
  bloom_level: BloomLevel;
  medical_specialty: string;
  score: number;
  answers: SearchAnswer[];
  explanation: string;
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

function normalizeQuestionText(content: string): string {
  // Collapse any weird whitespace (newline soup from JSON, double-spaces from
  // the LLM enrichment payload, etc.) but keep the full text. The card IS
  // the question the student has to answer — clipping it would force the
  // student to act on a teaser.
  return content.replace(/\s+/g, " ").trim();
}

const OPTION_LETTERS = ["A", "B", "C", "D", "E", "F"] as const;

export function ResultCard({
  ordinal,
  result,
  initialPickedIndex = null,
}: {
  ordinal: number;
  result: SearchResultItem;
  initialPickedIndex?: number | null;
}): ReactElement {
  // The card has one state bit: which answer (if any) the student picked.
  // Options are always visible inline with the question — splitting them
  // behind a 'Show answer options' click was friction. Once a pick is made
  // it's sticky for the session (no re-attempt path; the student already
  // knows the answer).
  const [pickedIndex, setPickedIndex] = useState<number | null>(initialPickedIndex);
  const answered = pickedIndex !== null;

  return (
    <article
      data-testid="result-card"
      data-answered={answered ? "true" : "false"}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "0.6rem",
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
        {normalizeQuestionText(result.content)}
      </p>

      <AnswersList
        answers={result.answers}
        pickedIndex={pickedIndex}
        onPick={setPickedIndex}
      />

      {answered ? (
        <AnswerFeedback
          answers={result.answers}
          pickedIndex={pickedIndex}
          explanation={result.explanation}
        />
      ) : null}

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
        <span aria-hidden style={{ color: "#d1d5db" }}>
          •
        </span>
        <span title="Hybrid relevance score" style={{ fontVariantNumeric: "tabular-nums" }}>
          score {result.score.toFixed(3)}
        </span>
      </footer>
    </article>
  );
}

type AnswerRole = "neutral" | "correct" | "incorrect-pick";

function classifyAnswer(
  index: number,
  answer: SearchAnswer,
  pickedIndex: number | null,
): AnswerRole {
  if (pickedIndex === null) return "neutral";
  if (answer.is_correct) return "correct";
  if (index === pickedIndex) return "incorrect-pick";
  return "neutral";
}

const ROLE_STYLES: Record<
  AnswerRole,
  {
    color: string;
    background: string;
    border: string;
    weight: 400 | 600;
    accent: string;
  }
> = {
  neutral: {
    color: "#374151",
    background: "transparent",
    border: "transparent",
    weight: 400,
    accent: "#6b7280",
  },
  correct: {
    color: "#065f46",
    background: "#ecfdf5",
    border: "#a7f3d0",
    weight: 600,
    accent: "#065f46",
  },
  "incorrect-pick": {
    color: "#991b1b",
    background: "#fef2f2",
    border: "#fecaca",
    weight: 600,
    accent: "#991b1b",
  },
};

function AnswersList({
  answers,
  pickedIndex,
  onPick,
}: {
  answers: SearchAnswer[];
  pickedIndex: number | null;
  onPick: (index: number) => void;
}): ReactElement {
  const answered = pickedIndex !== null;

  return (
    <ol
      data-testid="answers-list"
      style={{
        margin: 0,
        paddingLeft: 0,
        listStyle: "none",
        display: "flex",
        flexDirection: "column",
        gap: "0.35rem",
      }}
    >
      {answers.map((a, i) => {
        const letter = OPTION_LETTERS[i] ?? String(i + 1);
        const role = classifyAnswer(i, a, pickedIndex);
        const palette = ROLE_STYLES[role];
        const isPicked = pickedIndex === i;

        const content = (
          <>
            <span
              aria-hidden
              style={{
                fontWeight: 600,
                color: palette.accent,
                minWidth: "1.4rem",
              }}
            >
              {letter}.
            </span>
            <span style={{ flex: 1, textAlign: "left" }}>{a.content}</span>
            {role === "correct" ? (
              <span
                aria-label={isPicked ? "your correct answer" : "correct answer"}
                data-testid="correct-marker"
                style={{ color: "#059669", fontWeight: 700 }}
              >
                ✓
              </span>
            ) : null}
            {role === "incorrect-pick" ? (
              <span
                aria-label="your incorrect pick"
                data-testid="incorrect-marker"
                style={{ color: "#dc2626", fontWeight: 700 }}
              >
                ✗
              </span>
            ) : null}
          </>
        );

        const commonStyle = {
          display: "flex",
          alignItems: "center",
          gap: "0.55rem",
          padding: "0.5rem 0.65rem",
          borderRadius: 6,
          fontSize: "0.92rem",
          color: palette.color,
          background: palette.background,
          border: `1px solid ${palette.border === "transparent" ? "#e5e7eb" : palette.border}`,
          fontWeight: palette.weight,
          width: "100%",
          textAlign: "left" as const,
        };

        return (
          <li key={i} style={{ listStyle: "none" }}>
            {answered ? (
              <div
                data-testid="answer-option"
                data-role={role}
                data-picked={isPicked ? "true" : "false"}
                style={commonStyle}
              >
                {content}
              </div>
            ) : (
              <button
                type="button"
                data-testid="answer-option"
                data-role={role}
                data-picked="false"
                onClick={() => onPick(i)}
                style={{ ...commonStyle, cursor: "pointer" }}
              >
                {content}
              </button>
            )}
          </li>
        );
      })}
    </ol>
  );
}

function AnswerFeedback({
  answers,
  pickedIndex,
  explanation,
}: {
  answers: SearchAnswer[];
  pickedIndex: number;
  explanation: string;
}): ReactElement {
  const wasCorrect = answers[pickedIndex]?.is_correct === true;
  return (
    <div
      data-testid="answer-feedback"
      data-result={wasCorrect ? "correct" : "incorrect"}
      style={{ display: "flex", flexDirection: "column", gap: "0.45rem" }}
    >
      <FeedbackBanner wasCorrect={wasCorrect} />
      <div
        data-testid="answer-explanation"
        style={{
          color: "#374151",
          fontSize: "0.9rem",
          lineHeight: 1.55,
          padding: "0.55rem 0.65rem",
          background: "#fafafa",
          border: "1px solid #ececec",
          borderRadius: 6,
        }}
      >
        <strong
          style={{ display: "block", marginBottom: "0.2rem", color: "#111827" }}
        >
          Explanation
        </strong>
        {explanation}
      </div>
    </div>
  );
}

function FeedbackBanner({ wasCorrect }: { wasCorrect: boolean }): ReactElement {
  const palette = wasCorrect
    ? { color: "#065f46", background: "#ecfdf5", border: "#a7f3d0", icon: "✓" }
    : { color: "#991b1b", background: "#fef2f2", border: "#fecaca", icon: "✗" };
  return (
    <div
      data-testid="feedback-banner"
      data-result={wasCorrect ? "correct" : "incorrect"}
      role="status"
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.55rem",
        padding: "0.45rem 0.6rem",
        borderRadius: 6,
        color: palette.color,
        background: palette.background,
        border: `1px solid ${palette.border}`,
        fontSize: "0.9rem",
        fontWeight: 600,
      }}
    >
      <span aria-hidden style={{ fontSize: "1rem" }}>
        {palette.icon}
      </span>
      <span>
        {wasCorrect
          ? "Correct"
          : "Incorrect — the correct answer is highlighted below."}
      </span>
    </div>
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
