import type { HarnessDefinition } from "../../../definition/index.js";
import { AppFrame } from "../../feature/AppFrame/index.js";
import { HarnessList } from "../../feature/HarnessList/index.js";
import { Button, Heading, Notice } from "../../ui/index.js";

export const HarnessesPage = ({
  definitions,
  unreadable,
  failure,
}: {
  definitions: readonly HarnessDefinition[];
  unreadable: readonly string[];
  failure?: string;
}) => (
  <AppFrame current="harnesses">
    <Heading>ハーネス</Heading>
    <div className="mb-4">
      <Button tone="primary" href="/harnesses/new">
        ハーネスを作る
      </Button>
    </div>
    {failure === undefined ? (
      <HarnessList definitions={definitions} unreadable={unreadable} />
    ) : (
      <Notice>{`ハーネスの一覧を読み込めませんでした。${failure}`}</Notice>
    )}
  </AppFrame>
);
