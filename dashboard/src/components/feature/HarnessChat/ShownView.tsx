import type { Shown } from "../../../trial/shown.js";
import { CodeBlock } from "../../ui/index.js";

// One piece of a tool call, drawn the way its kind says.
export const ShownView = ({ shown }: { shown: Shown }) => {
  switch (shown.kind) {
    case "code":
      return (
        <CodeBlock
          code={shown.text}
          language={shown.language}
          startLine={shown.startLine}
        />
      );
  }
};
