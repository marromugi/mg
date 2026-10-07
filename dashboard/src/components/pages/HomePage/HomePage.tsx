import { AppFrame } from "../../feature/AppFrame/index.js";
import { HarnessCreatorButton } from "../../feature/HarnessCreator/index.js";

export const HomePage = () => (
  <AppFrame current="home" actions={<HarnessCreatorButton />} />
);
