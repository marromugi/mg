import type { HarnessDefinition } from "../../../definition/index.js";
import { AppFrame } from "../../feature/AppFrame/index.js";
import { HarnessList } from "../../feature/HarnessList/index.js";
import { Button, Heading } from "../../ui/index.js";

export const HarnessesPage = ({
  definitions,
  unreadable,
}: {
  definitions: readonly HarnessDefinition[];
  unreadable: readonly string[];
}) => (
  <AppFrame current="harnesses">
    <Heading>ハーネス</Heading>
    <div className="mb-4">
      <Button tone="primary" href="/harnesses/new">
        ハーネスを作る
      </Button>
    </div>
    <HarnessList definitions={definitions} unreadable={unreadable} />
  </AppFrame>
);
