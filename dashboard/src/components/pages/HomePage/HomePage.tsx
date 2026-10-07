import { QueryProvider } from "../../../libs/query/index.js";
import { AppFrame } from "../../feature/AppFrame/index.js";
import { HarnessCreatorButton } from "../../feature/HarnessCreator/index.js";

export const HomePage = () => (
  <QueryProvider>
    <AppFrame current="home" actions={<HarnessCreatorButton />} />
  </QueryProvider>
);
