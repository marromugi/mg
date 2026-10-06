import type { Problem } from "../../../definition/index.js";
import type { Draft } from "../../../harness-form/index.js";
import { AppFrame } from "../../feature/AppFrame/index.js";
import { HarnessEditor } from "../../feature/HarnessEditor/index.js";
import { TestRunForm } from "../../feature/TestRunForm/index.js";
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
  runProblem,
}: {
  target: EditorTarget;
  draft: Draft;
  problems: readonly Problem[];
  failure?: string;
  runProblem?: string;
}) => {
  const { heading, action, deleteHref, runAction } =
    useEditorTarget(target);

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
      {runAction === undefined ? null : (
        <TestRunForm action={runAction} problem={runProblem} />
      )}
    </AppFrame>
  );
};
