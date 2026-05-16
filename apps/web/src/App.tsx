// apps/web/src/App — Lecturio chat UI with structured search results.
//
// AI SDK 6 `useChat` notes:
//   - `useChat()` returns `{messages, sendMessage, status}` and accepts a
//     `transport`. We construct `DefaultChatTransport({api: '/api/chat'})`.
//   - Messages carry `.parts: UIMessagePart[]`. Text parts render as markdown
//     (agent's framing/prose). Tool parts (`type: "tool-searchQuestions"`)
//     with `state === "output-available"` carry the structured search
//     output; we render that as `<ResultsList>` or `<NoMatchPanel>` so the
//     `bloom_level`, `medical_specialty`, and `score` signals are legible at
//     a glance rather than buried in LLM-formatted markdown.

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState, type ReactElement } from "react";
import { renderMessageBody } from "./render-message-body.js";
import {
  NoMatchPanel,
  ResultsList,
  type SearchToolOutput,
} from "./components.js";

export function App(): ReactElement {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });
  const [input, setInput] = useState("");

  const isStreaming = status === "streaming" || status === "submitted";

  const submit = (): void => {
    const trimmed = input.trim();
    if (!trimmed) return;
    void sendMessage({ text: trimmed });
    setInput("");
  };

  return (
    <main
      style={{
        maxWidth: 760,
        margin: "2rem auto",
        fontFamily: "system-ui",
        lineHeight: 1.5,
        color: "#222",
      }}
    >
      <h1 style={{ fontSize: "1.6rem", marginBottom: "0.25rem" }}>
        Lecturio - Medical Question Search
      </h1>
      <p style={{ color: "#555", marginTop: 0 }}>
        Welcome - ask about a clinical scenario or a medical topic.
      </p>

      <div style={{ marginTop: "1.5rem" }}>
        {messages.map((message) => {
          const text = extractText(message.parts);
          const toolOutput = extractSearchToolOutput(message.parts);
          const toolStatus = describeToolActivity(message.parts);
          const isUser = message.role === "user";
          const hasText = text.length > 0;

          // When the search tool returns results, the cards ARE the response.
          // Any framing prose the model emits ("Below are some questions I
          // found...") is redundant noise; we render the cards standalone,
          // without a chat bubble or "Netea" label, and ignore the text
          // entirely. Bubble chrome is reserved for prose-only responses
          // (no_match with reformulation suggestions, multi-turn ordinal
          // refs, refinements) and for user messages.
          if (!isUser && toolOutput?.kind === "results") {
            return (
              <div
                key={message.id}
                data-role={message.role}
                data-message-shape="results-only"
                style={{ margin: "0.9rem 0" }}
              >
                <ResultsList output={toolOutput} />
              </div>
            );
          }

          return (
            <div
              key={message.id}
              data-role={message.role}
              style={{
                padding: "0.85rem 1.1rem",
                margin: "0.9rem 0",
                borderRadius: 10,
                background: isUser ? "#eef2ff" : "#f7f7f8",
                border: isUser ? "1px solid #dde3ff" : "1px solid #ececec",
              }}
            >
              <strong
                style={{
                  display: "block",
                  marginBottom: "0.35rem",
                  color: isUser ? "#3344aa" : "#444",
                }}
              >
                {isUser ? "You" : "Netea"}
              </strong>
              <div>
                {hasText ? (
                  renderMessageBody({ role: message.role, text })
                ) : toolStatus ? (
                  <ActivityIndicator label={toolStatus} />
                ) : !isUser && isStreaming ? (
                  <ActivityIndicator label="Thinking…" />
                ) : null}
              </div>
              {toolOutput?.kind === "no_match" ? (
                <NoMatchPanel output={toolOutput} />
              ) : null}
            </div>
          );
        })}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about a topic or a clinical scenario..."
          style={{ flex: 1, padding: "0.6rem" }}
          disabled={isStreaming}
        />
        <button
          type="submit"
          disabled={isStreaming || input.trim().length === 0}
        >
          {isStreaming ? "Streaming…" : "Send"}
        </button>
      </form>
    </main>
  );
}

type TextPart = { type: "text"; text: string };
type UnknownPart = {
  type: string;
  state?: string;
  input?: unknown;
  output?: unknown;
};

function extractText(parts: readonly unknown[]): string {
  return parts
    .filter(
      (part): part is TextPart =>
        (part as { type?: string }).type === "text" &&
        typeof (part as TextPart).text === "string",
    )
    .map((part) => part.text)
    .join("");
}

// AI SDK 6 emits tool parts as `tool-<toolName>` with a state progression:
// input-streaming -> input-available -> output-available. We surface the
// structured output only once it's available; before that, the search is
// in-flight and we show the activity indicator.
function extractSearchToolOutput(
  parts: readonly unknown[],
): SearchToolOutput | null {
  for (const raw of parts) {
    const p = raw as UnknownPart;
    if (
      typeof p.type === "string" &&
      p.type.startsWith("tool-") &&
      p.type.toLowerCase().includes("search") &&
      p.state === "output-available" &&
      isSearchToolOutput(p.output)
    ) {
      return p.output;
    }
  }
  return null;
}

function isSearchToolOutput(value: unknown): value is SearchToolOutput {
  if (typeof value !== "object" || value === null) return false;
  const v = value as { kind?: unknown };
  return v.kind === "results" || v.kind === "no_match";
}

function describeToolActivity(parts: readonly unknown[]): string | null {
  let toolPart: UnknownPart | undefined;
  for (const raw of parts) {
    const p = raw as UnknownPart;
    if (typeof p.type === "string" && p.type.startsWith("tool-")) {
      toolPart = p;
    }
  }
  if (!toolPart) return null;
  if (toolPart.state === "output-available") return null;
  const query =
    toolPart.input &&
    typeof toolPart.input === "object" &&
    "query" in toolPart.input
      ? String((toolPart.input as { query?: unknown }).query ?? "")
      : "";
  return query ? `Searching the corpus for "${query}"…` : "Searching the corpus…";
}

function ActivityIndicator({ label }: { label: string }): ReactElement {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
        color: "#666",
        fontStyle: "italic",
      }}
    >
      <span
        aria-hidden
        style={{
          display: "inline-block",
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: "#888",
          animation: "netea-pulse 1.1s ease-in-out infinite",
        }}
      />
      <span>{label}</span>
      <style>{`@keyframes netea-pulse { 0%,100% { opacity: 0.25 } 50% { opacity: 1 } }`}</style>
    </div>
  );
}
