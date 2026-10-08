import {
  isValidElement,
  memo,
  type ReactElement,
  type ReactNode,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "../CodeBlock/index.js";
import { useBlocks } from "./hooks/useBlocks.js";

type MarkdownProps = {
  text: string;
  // While "arriving", the unfinished end of the text is shown in the
  // form it is growing into, and none of its syntax shows. Once
  // "complete", the text is drawn exactly as written.
  state?: "arriving" | "complete";
};

// Only links out to the web are followed.
const webOnly = (url: string): string =>
  /^https?:\/\//i.test(url) ? url : "";

type CodeElement = ReactElement<{
  className?: string;
  children?: ReactNode;
}>;

const textOf = (node: ReactNode): string =>
  typeof node === "string"
    ? node
    : Array.isArray(node)
      ? node.map(textOf).join("")
      : "";

const COMPONENTS: Components = {
  h1: ({ children }) => (
    <h3 className="text-sm font-semibold">{children}</h3>
  ),
  h2: ({ children }) => (
    <h4 className="text-sm font-semibold">{children}</h4>
  ),
  h3: ({ children }) => <h5 className="font-semibold">{children}</h5>,
  h4: ({ children }) => <h6 className="font-semibold">{children}</h6>,
  h5: ({ children }) => <h6 className="font-semibold">{children}</h6>,
  h6: ({ children }) => <h6 className="font-semibold">{children}</h6>,
  p: ({ children }) => <p className="break-words">{children}</p>,
  strong: ({ children }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  a: ({ href, children }) =>
    href === undefined || href === "" ? (
      <span className="text-accent-text underline">{children}</span>
    ) : (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className="text-accent-text underline"
      >
        {children}
      </a>
    ),
  ul: ({ children }) => (
    <ul className="flex list-disc flex-col gap-1 pl-5">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="flex list-decimal flex-col gap-1 pl-5">
      {children}
    </ol>
  ),
  blockquote: ({ children }) => (
    <blockquote className="border-l-2 border-edge pl-3 opacity-80">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="border-edge" />,
  code: ({ children }) => (
    <code className="rounded-control bg-surface-raised px-1 font-mono">
      {children}
    </code>
  ),
  // A fenced block: the language is the word after the fence.
  pre: ({ children }) => {
    const code = isValidElement(children)
      ? (children as CodeElement)
      : undefined;
    const language = /language-(\S+)/.exec(
      code?.props.className ?? "",
    )?.[1];
    return (
      <div className="rounded-container bg-surface-raised container-p-3">
        <CodeBlock
          code={textOf(code?.props.children).replace(/\n$/, "")}
          language={language ?? "text"}
        />
      </div>
    );
  },
  table: ({ children }) => (
    <div className="overflow-auto">
      <table className="w-full border-collapse text-left">
        {children}
      </table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border-b border-edge px-2 py-1 font-semibold">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="border-b border-edge px-2 py-1">{children}</td>
  ),
};

// One block, drawn again only when its own Markdown changes.
const Block = memo(({ markdown }: { markdown: string }) => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    components={COMPONENTS}
    urlTransform={webOnly}
  >
    {markdown}
  </ReactMarkdown>
));
Block.displayName = "Block";

// Text written in Markdown, drawn as what it describes: headings,
// lists, tables, code. It takes the size of the text around it. HTML in
// the text is shown as written, not drawn.
export const Markdown = ({
  text,
  state = "complete",
}: MarkdownProps) => (
  <div className="flex flex-col gap-3 leading-relaxed">
    {useBlocks(text, state).map((block, index) => (
      <Block key={index} markdown={block} />
    ))}
  </div>
);
