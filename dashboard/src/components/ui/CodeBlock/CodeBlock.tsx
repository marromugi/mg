import { useHighlighted } from "./hooks/useHighlighted.js";

type CodeBlockProps = {
  code: string;
  // The language the code is coloured as. One that is not known shows
  // as plain text.
  language: string;
  // The number of the first line. Without it no line is numbered.
  startLine?: number;
};

// Code in a fixed-width face, coloured by its language, with its lines
// numbered when it says where they start. It is as tall as its lines up
// to a limit, then scrolls.
export const CodeBlock = ({
  code,
  language,
  startLine,
}: CodeBlockProps) => {
  const html = useHighlighted(code, language);
  const box = {
    className:
      startLine === undefined ? "code-block" : "code-block code-lines",
    style:
      startLine === undefined
        ? undefined
        : { counterReset: `line ${startLine - 1}` },
  };

  return html === undefined ? (
    <div {...box}>
      <pre>
        <code>
          {code.split("\n").flatMap((line, index) => [
            index === 0 ? null : "\n",
            <span key={index} className="line">
              {line}
            </span>,
          ])}
        </code>
      </pre>
    </div>
  ) : (
    <div {...box} dangerouslySetInnerHTML={{ __html: html }} />
  );
};
