import { useState } from "react";
import type { HarnessDefinition } from "../../../definition/index.js";
import { AppFrame } from "../../feature/AppFrame/index.js";
import {
  HarnessChat,
  type Trial,
} from "../../feature/HarnessChat/index.js";
import { HarnessOverview } from "../../feature/HarnessOverview/index.js";

export type SaveOutcome =
  { kind: "saved" } | { kind: "failed"; reason: string };

type HarnessViewProps = {
  definition: HarnessDefinition;
  trial: Trial;
  save: (system: string) => Promise<SaveOutcome>;
};

// One agent in the app's frame: what it is in the middle, and the panel
// it is tried in at the side. The prompt being edited is the one tried.
export const HarnessView = ({
  definition,
  trial,
  save,
}: HarnessViewProps) => {
  const [saved, setSaved] = useState(definition.system ?? "");
  const [system, setSystem] = useState(saved);
  const [saving, setSaving] = useState(false);
  const [failure, setFailure] = useState<string>();
  const unsaved = system !== saved;

  const onSave = async () => {
    setSaving(true);
    const outcome = await save(system);
    setSaving(false);
    if (outcome.kind === "saved") {
      setSaved(system);
      setFailure(undefined);
    } else {
      setFailure(`保存できませんでした。${outcome.reason}`);
    }
  };

  return (
    <AppFrame
      current="harnesses"
      start={
        <nav
          aria-label="現在地"
          className="flex items-center gap-2 pl-3 text-sm"
        >
          <a href="/harnesses" className="opacity-70 hover:opacity-100">
            エージェント
          </a>
          <span aria-hidden className="opacity-40">
            /
          </span>
          <span aria-current="page" className="font-semibold">
            {definition.name}
          </span>
        </nav>
      }
      aside={
        <HarnessChat
          items={trial.items}
          state={trial.state}
          prompt={unsaved ? "unsaved" : "saved"}
          onSend={(input) => trial.send(input, system)}
          onStop={trial.stop}
          onReset={trial.reset}
        />
      }
    >
      <div className="mx-auto max-w-page p-6">
        <HarnessOverview
          definition={definition}
          promptState={
            saving ? "saving" : unsaved ? "unsaved" : "saved"
          }
          failure={failure}
          onPromptChange={setSystem}
          onSave={onSave}
        />
      </div>
    </AppFrame>
  );
};
