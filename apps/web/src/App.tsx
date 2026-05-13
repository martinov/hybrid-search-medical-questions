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

export function App(): ReactElement {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
  });
  const [input, setInput] = useState("");

  const isStreaming = status === "streaming" || status === "submitted";

  function onSubmit(e: React.FormEvent<HTMLFormElement>): void {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed) return;
    void sendMessage({ text: trimmed });
    setInput("");
  }

  return (
    <main style={{ maxWidth: 720, margin: "2rem auto", fontFamily: "system-ui" }}>
      <h1>Netea — Medical Question Search</h1>
      <p>Welcome — ask about a clinical scenario or a medical topic.</p>

      <div style={{ marginTop: "1.5rem" }}>
        {messages.map((message) => {
          const textBlocks = message.parts
            .filter(
              (part): part is { type: "text"; text: string } =>
                part.type === "text",
            )
            .map((part) => part.text)
            .join("");
          return (
            <div
              key={message.id}
              data-role={message.role}
              style={{
                padding: "0.75rem 1rem",
                margin: "0.5rem 0",
                borderRadius: 8,
                background: message.role === "user" ? "#eef" : "#f6f6f6",
              }}
            >
              <strong>{message.role === "user" ? "You" : "Netea"}</strong>
              <div data-testid="result-card-title">{textBlocks}</div>
            </div>
          );
        })}
      </div>

      <form onSubmit={onSubmit} style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
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
