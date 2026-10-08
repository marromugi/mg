import { useState } from "react";
import { IconButton, PlusIcon } from "../../ui/index.js";
import { HarnessCreator } from "./HarnessCreator.js";
import { useSave } from "./hooks/useSave.js";

const openHarnessPage = (id: string) => {
  window.location.assign(`/harnesses/${id}`);
};

type HarnessCreatorButtonProps = {
  // Called with the id of the harness once it is saved. Opens its page
  // when left out.
  onSaved?: (id: string) => void;
};

// A round button that opens the harness creation steps. The harness
// they ask for is saved, and once it is its page opens.
export const HarnessCreatorButton = ({
  onSaved = openHarnessPage,
}: HarnessCreatorButtonProps) => {
  const [open, setOpen] = useState(false);
  const save = useSave();

  return (
    <HarnessCreator
      trigger={
        <IconButton
          icon={PlusIcon}
          label="エージェントを作る"
          labelSide="bottom"
        />
      }
      open={open}
      onOpenChange={setOpen}
      onCreate={async (creation) => {
        const outcome = await save(creation);
        if (outcome.kind === "saved") {
          setOpen(false);
          onSaved(outcome.id);
        }
        return outcome;
      }}
    />
  );
};
