import { AppFrame } from "../../feature/AppFrame/index.js";
import { EmptyState, Heading } from "../../ui/index.js";

export const ApiKeysPage = () => (
  <AppFrame current="api-keys">
    <Heading>API キー</Heading>
    <EmptyState title="API キーはまだありません" />
  </AppFrame>
);
