import type { HarnessDefinition } from "../../../definition/index.js";
import { QueryProvider } from "../../../libs/query/index.js";
import { AppFrame } from "../../feature/AppFrame/index.js";
import { HarnessCreatorButton } from "../../feature/HarnessCreator/index.js";
import { HarnessList } from "../../feature/HarnessList/index.js";

type HarnessesPageProps = {
  definitions: readonly HarnessDefinition[];
  // The names of stored files that could not be read as an agent.
  unreadable: readonly string[];
  // Why the list could not be read at all.
  failure?: string;
};

// The page of saved agents, with the button that makes a new one.
export const HarnessesPage = ({
  definitions,
  unreadable,
  failure,
}: HarnessesPageProps) => (
  <QueryProvider>
    <AppFrame current="harnesses" actions={<HarnessCreatorButton />}>
      <div className="mx-auto flex max-w-page flex-col gap-4 p-3">
        {failure === undefined ? null : (
          <p role="alert" className="text-sm text-error">
            エージェントを読み込めませんでした。{failure}
          </p>
        )}
        {unreadable.length === 0 ? null : (
          <p role="alert" className="text-sm text-error">
            読み込めなかったファイルがあります: {unreadable.join("、")}
          </p>
        )}
        {failure === undefined ? (
          <HarnessList definitions={definitions} />
        ) : null}
      </div>
    </AppFrame>
  </QueryProvider>
);
