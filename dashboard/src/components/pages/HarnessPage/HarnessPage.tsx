import type { HarnessDefinition } from "../../../definition/index.js";
import { QueryProvider } from "../../../libs/query/index.js";
import { useTrial } from "../../feature/HarnessChat/index.js";
import { HarnessView } from "./HarnessView.js";
import { useSavePrompt } from "./hooks/useSavePrompt.js";

const Connected = ({
  definition,
}: {
  definition: HarnessDefinition;
}) => (
  <HarnessView
    definition={definition}
    trial={useTrial(definition.id)}
    save={useSavePrompt(definition.id)}
  />
);

// The page of one agent, tried and saved through the API.
export const HarnessPage = ({
  definition,
}: {
  definition: HarnessDefinition;
}) => (
  <QueryProvider>
    <Connected definition={definition} />
  </QueryProvider>
);
