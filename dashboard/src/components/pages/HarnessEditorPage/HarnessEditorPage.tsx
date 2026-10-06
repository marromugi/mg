import type { Problem } from "../../../definition/index.js";
import type { Draft } from "../../../harness-form/index.js";
import { AppFrame } from "../../feature/AppFrame/index.js";
import { HarnessEditor } from "../../feature/HarnessEditor/index.js";
import { Heading } from "../../ui/index.js";
import {
  useEditorTarget,
  type EditorTarget,
} from "./hooks/useEditorTarget.js";

export const HarnessEditorPage = ({
  target,
  draft,
  problems,
  failure,
}: {
  target: EditorTarget;
  draft: Draft;
  problems: readonly Problem[];
  failure?: string;
}) => {
  const { heading, action, deleteHref } = useEditorTarget(target);

  return (
    <AppFrame current="harnesses">
      <Heading>{heading}</Heading>
      <HarnessEditor
        action={action}
        draft={draft}
        problems={problems}
        failure={failure}
        deleteHref={deleteHref}
      />
    </AppFrame>
  );
};
