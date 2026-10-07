import { useState } from "react";
import { IconButton, PlusIcon } from "../../ui/index.js";
import { HarnessCreator } from "./HarnessCreator.js";
import type { Creation } from "./hooks/useCreation.js";

// A round button that opens the harness creation steps. The steps close
// once a harness has been asked for.
export const HarnessCreatorButton = ({
  onCreate,
}: {
  onCreate?: (creation: Creation) => void;
}) => {
  const [open, setOpen] = useState(false);

  return (
    <HarnessCreator
      trigger={
        <IconButton
          icon={PlusIcon}
          label="ハーネスを作る"
          labelSide="bottom"
        />
      }
      open={open}
      onOpenChange={setOpen}
      onCreate={(creation) => {
        onCreate?.(creation);
        setOpen(false);
      }}
    />
  );
};
