// Renders the body of a single chat message bubble.
//
// Assistant messages flow through react-markdown so the model's markdown
// output (numbered lists, **bold** titles, fenced code) renders as DOM
// instead of a wall of text. User messages stay verbatim so we never
// silently transform what the user typed.
//
// Default react-markdown pipeline is HTML-safe (no rehype-raw): raw <script>
// tags in model output are not executed.

import type { ReactElement } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

type Role = "user" | "assistant" | "system" | (string & {});

type RenderMessageBodyArgs = {
  role: Role;
  text: string;
};

// Trim default browser margins on common markdown elements so a list inside
// a small chat bubble does not blow out the layout. Inline-style only —
// keeps the no-build-step constraint already in App.tsx.
const tightBlock = { margin: "0.25rem 0" };
const tightInline = { margin: 0 };

const MARKDOWN_COMPONENTS = {
  p: (props: { children?: React.ReactNode }) => (
    <p style={tightBlock}>{props.children}</p>
  ),
  ol: (props: { children?: React.ReactNode }) => (
    <ol style={{ ...tightBlock, paddingLeft: "1.5rem" }}>{props.children}</ol>
  ),
  ul: (props: { children?: React.ReactNode }) => (
    <ul style={{ ...tightBlock, paddingLeft: "1.5rem" }}>{props.children}</ul>
  ),
  li: (props: { children?: React.ReactNode }) => (
    <li style={{ margin: "0.15rem 0" }}>{props.children}</li>
  ),
  h1: (props: { children?: React.ReactNode }) => (
    <h3 style={{ ...tightBlock, fontSize: "1.05rem" }}>{props.children}</h3>
  ),
  h2: (props: { children?: React.ReactNode }) => (
    <h3 style={{ ...tightBlock, fontSize: "1.05rem" }}>{props.children}</h3>
  ),
  h3: (props: { children?: React.ReactNode }) => (
    <h3 style={{ ...tightBlock, fontSize: "1.05rem" }}>{props.children}</h3>
  ),
  code: (props: { children?: React.ReactNode }) => (
    <code
      style={{
        background: "#eee",
        padding: "0.1rem 0.3rem",
        borderRadius: 3,
        fontSize: "0.9em",
      }}
    >
      {props.children}
    </code>
  ),
  pre: (props: { children?: React.ReactNode }) => (
    <pre
      style={{
        background: "#eee",
        padding: "0.5rem",
        borderRadius: 4,
        overflowX: "auto",
        ...tightInline,
        marginTop: "0.25rem",
        marginBottom: "0.25rem",
      }}
    >
      {props.children}
    </pre>
  ),
} as const;

export function renderMessageBody({
  role,
  text,
}: RenderMessageBodyArgs): ReactElement {
  if (role === "assistant") {
    return (
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MARKDOWN_COMPONENTS}>
        {text}
      </ReactMarkdown>
    );
  }
  return <span style={{ whiteSpace: "pre-wrap" }}>{text}</span>;
}
