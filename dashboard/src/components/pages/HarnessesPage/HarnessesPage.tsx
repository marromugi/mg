import { AppFrame } from "../../feature/AppFrame/index.js";
import { EmptyState, Heading } from "../../ui/index.js";

export const HarnessesPage = () => (
  <AppFrame current="harnesses">
    <Heading>ハーネス</Heading>
    <EmptyState title="ハーネスはまだありません" />
  </AppFrame>
);
