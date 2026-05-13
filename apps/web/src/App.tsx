// apps/web/src/App — Minimal Vite + React 19 chat UI.
//
// AI SDK 6 `useChat` notes (discovered while wiring DELIVER step 1):
//   - The legacy `{input, handleInputChange, handleSubmit}` API is gone.
//   - `useChat()` now returns `{messages, sendMessage, status, ...}` and
//     accepts a `transport`, not an `api` string. We construct a
//     `DefaultChatTransport({api: '/api/chat'})` to point at our Hono route.
//   - Messages no longer carry `.content`; they have `.parts: UIMessagePart[]`.
//     We render the text parts and ignore tool-call parts at this stage.
//   - The send-message lifecycle is driven by component-local input state.

import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import { useState, type ReactElement } from "react";
import { renderMessageBody } from "./render-message-body.js";

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
    <main style={{ maxWidth: 760, margin: "2rem auto", fontFamily: "system-ui", lineHeight: 1.5, color: "#222" }}>
      <h1 style={{ fontSize: "1.6rem", marginBottom: "0.25rem" }}>Lecturio - Medical Question Search</h1>
      <p style={{ color: "#555", marginTop: 0 }}>Welcome - ask about a clinical scenario or a medical topic.</p>

      <div style={{ marginTop: "1.5rem" }}>
        {messages.map((message) => {
          const text = message.parts
            .filter(
              (part): part is { type: "text"; text: string } =>
                part.type === "text",
            )
            .map((part) => part.text)
            .join("");
          const toolStatus = describeToolActivity(message.parts);
          const isUser = message.role === "user";
          const hasText = text.length > 0;
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
              <strong style={{ display: "block", marginBottom: "0.35rem", color: isUser ? "#3344aa" : "#444" }}>
                {isUser ? "You" : "Netea"}
              </strong>
              <div data-testid="result-card-title">
                {hasText
                  ? renderMessageBody({ role: message.role, text })
                  : toolStatus
                  ? <ActivityIndicator label={toolStatus} />
                  : !isUser && isStreaming
                  ? <ActivityIndicator label="Thinking…" />
                  : null}
              </div>
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
        <button type="submit" disabled={isStreaming || input.trim().length === 0}>
          {isStreaming ? "Streaming…" : "Send"}
        </button>
      </form>
    </main>
  );
}

type UnknownPart = { type: string; state?: string; input?: unknown };

// AI SDK 6 emits tool parts as `type: "tool-<toolName>"` with a `state`
// progression: input-streaming → input-available → output-available. While
// the search runs (embed + DB query), no text exists yet — surface the
// activity so the bubble does not look frozen.
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
    toolPart.input && typeof toolPart.input === "object" && "query" in toolPart.input
      ? String((toolPart.input as { query?: unknown }).query ?? "")
      : "";
  return query ? `Searching the corpus for "${query}"…` : "Searching the corpus…";
}

function ActivityIndicator({ label }: { label: string }): ReactElement {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "#666", fontStyle: "italic" }}>
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
