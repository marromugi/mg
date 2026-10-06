import type { ReactNode } from "react";
import { AppFrame } from "../../feature/AppFrame/index.js";
import { Button, Heading } from "../../ui/index.js";

// `events` is where the run's pieces go. The stop button hides itself
// once a piece that ends the run (marked with data-ended) arrives.
export const RunPage = ({
  stopAction,
  events,
}: {
  stopAction: string;
  events: ReactNode;
}) => (
  <AppFrame current="harnesses">
    <div className="group/run">
      <Heading>テスト実行</Heading>
      <form
        method="post"
        action={stopAction}
        className="mb-4 group-has-data-ended/run:hidden"
      >
        <Button tone="danger">止める</Button>
      </form>
      <div>{events}</div>
    </div>
  </AppFrame>
);
