import { QueryProvider } from "../../../libs/query/index.js";
import { AppFrame } from "../../feature/AppFrame/index.js";
import { HarnessCreatorButton } from "../../feature/HarnessCreator/index.js";

type HomePageProps = {
  // Called with the id of a harness made here. Opens its page when
  // left out.
  onHarnessSaved?: (id: string) => void;
};

export const HomePage = ({ onHarnessSaved }: HomePageProps) => (
  <QueryProvider>
    <AppFrame
      current="home"
      actions={<HarnessCreatorButton onSaved={onHarnessSaved} />}
    />
  </QueryProvider>
);
