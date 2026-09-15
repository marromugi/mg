# Worked example

One feature component, the ui part it uses, the page, the route, and the
stories, written the way composer asks. Paths are relative to
`packages/trace-ui/src/`.

## The task

Show the messages an LLM call received and produced. The data arrives as a
JSON string in the span attribute `mg.llm.messages.input`; it may fail to
parse, in which case the raw string is shown.

## 1. Decide the layer

This knows what a message is, so it is `feature/ChatMessages`. The bordered
block that shows one message has no domain meaning, so that part is
`ui/Quote`.

## 2. Props first

```ts
// components/feature/ChatMessages/ChatMessages.tsx
type ChatMessagesProps = {
  label: string;   // "Input" or "Output"
  raw: string;     // the attribute value, untouched
};
```

The feature part takes the raw string, not the parsed messages. Parsing is
its job, and the route must not do it.

## 3. The hook and its test

```ts
// components/feature/ChatMessages/hooks/useChatMessages.ts
export type ChatToolCall = { id?: string; name?: string; arguments?: unknown };
export type ChatMessage = { role: string; content?: string; toolCalls?: ChatToolCall[]; toolCallId?: string };

export type ChatMessagesResult =
  | { kind: "parsed"; messages: ChatMessage[] }
  | { kind: "raw"; raw: string };

const isChatMessage = (value: unknown): value is ChatMessage => {
  if (typeof value !== "object" || value === null) return false;
  const { role, content } = value as { role?: unknown; content?: unknown };
  return typeof role === "string" && (content === undefined || typeof content === "string");
};

export const useChatMessages = (raw: string): ChatMessagesResult => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every(isChatMessage)) {
      return { kind: "parsed", messages: parsed };
    }
  } catch {
    // fall through
  }
  return { kind: "raw", raw };
};
```

```ts
// components/feature/ChatMessages/hooks/useChatMessages.test.ts
import { describe, expect, it } from "vitest";
import { useChatMessages } from "./useChatMessages.js";

describe("useChatMessages", () => {
  it("parses an array of messages", () => {
    const result = useChatMessages(JSON.stringify([{ role: "user", content: "hi" }]));
    expect(result).toEqual({ kind: "parsed", messages: [{ role: "user", content: "hi" }] });
  });
  it("returns raw when the JSON is invalid", () => {
    expect(useChatMessages("{not json")).toEqual({ kind: "raw", raw: "{not json" });
  });
  it("returns raw when an element is not a message", () => {
    const raw = JSON.stringify([{ role: "user" }, { content: 1 }]);
    expect(useChatMessages(raw)).toEqual({ kind: "raw", raw });
  });
});
```

A discriminated union (`kind`) rather than `ChatMessage[] | undefined` so the
markup branches on a name, and a test can say what it expects.

## 4. The ui part with variants

```tsx
// components/ui/Quote/Quote.tsx
import type { ReactNode } from "react";
import { tv } from "tailwind-variants";

const quote = tv({
  base: "border-l-2 py-1 px-3 my-2",
  variants: {
    tone: {
      neutral: "border-edge",
      accent: "border-accent",
    },
  },
  defaultVariants: { tone: "neutral" },
});

type QuoteProps = {
  tone?: "neutral" | "accent";
  heading?: string;
  children: ReactNode;
};

export const Quote = ({ tone, heading, children }: QuoteProps) => (
  <div className={quote({ tone })}>
    {heading !== undefined ? (
      <div className="text-xs font-semibold uppercase text-muted">{heading}</div>
    ) : null}
    <div className="whitespace-pre-wrap">{children}</div>
  </div>
);
```

`border-edge`, `border-accent`, `text-muted` exist because `tokens.css`
defines `--color-edge`, `--color-accent`, `--color-muted`. If one of them
did not, the next step would be asking the developer for it, not writing
the colour. No `className` prop; a caller who wants a third tone adds a
variant here.

## 5. The feature markup

```tsx
// components/feature/ChatMessages/ChatMessages.tsx
import { Quote } from "../../ui";
import { useChatMessages } from "./hooks/useChatMessages.js";

export const ChatMessages = ({ label, raw }: ChatMessagesProps) => {
  const result = useChatMessages(raw);

  return (
    <section>
      <h3 className="mt-2 font-semibold">{label}</h3>
      {result.kind === "raw" ? (
        <pre className="whitespace-pre-wrap">{result.raw}</pre>
      ) : (
        result.messages.map((message, index) => (
          <Quote key={index} heading={message.role}>
            {message.content}
          </Quote>
        ))
      )}
    </section>
  );
};
```

Call the hook, branch, return markup. Nothing else.

## 6. Stories

```tsx
// components/feature/ChatMessages/ChatMessages.stories.tsx
import type { Meta, StoryObj } from "@storybook/react";
import { ChatMessages } from "./ChatMessages.js";
import { inputMessagesJson } from "../../../stories/fixtures.js";

const meta = { component: ChatMessages } satisfies Meta<typeof ChatMessages>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Parsed: Story = { args: { label: "Input", raw: inputMessagesJson } };
export const Unparsable: Story = { args: { label: "Input", raw: "{not json" } };
```

Two stories, two snapshots, both cases of the hook visible in Storybook.

## 7. Page and route

```tsx
// components/pages/SessionPage/SessionPage.tsx
import type { SessionTree } from "@mg/trace/store";
import { Layout, Heading } from "../../ui";
import { SpanTree } from "../../feature/SpanTree";

export const SessionPage = ({ session }: { session: SessionTree }) => (
  <Layout title={`Session ${session.sessionId}`}>
    <Heading>{session.sessionId}</Heading>
    {session.traces.map((trace) => (
      <SpanTree key={trace.root.spanId} root={trace.root} />
    ))}
  </Layout>
);
```

```tsx
// routes/session.tsx
import type { Hono } from "hono";
import type { TraceReader } from "@mg/trace/store";
import { SessionPage } from "../components/pages/SessionPage";
import { renderPage } from "./render.js";

export const registerSession = (app: Hono, reader: TraceReader): void => {
  app.get("/sessions/:id", async (c) => {
    const session = await reader.readSession(c.req.param("id"));
    if (session === undefined) return c.notFound();
    return c.html(renderPage(<SessionPage session={session} />));
  });
};
```

The route reads and hands over. The page takes the reader's type as-is. The
feature parts parse. The ui parts style. Each layer can be tested without
the one above it.
