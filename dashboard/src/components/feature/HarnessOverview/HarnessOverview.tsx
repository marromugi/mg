import type { ReactNode } from "react";
import type { HarnessDefinition } from "../../../definition/index.js";
import { useHarnessFacts } from "../../../hooks/useHarnessFacts.js";
import { Avatar, Button, Tag, TextArea } from "../../ui/index.js";

export type PromptState = "saved" | "unsaved" | "saving";

type HarnessOverviewProps = {
  definition: HarnessDefinition;
  promptState: PromptState;
  // Why the last save did not happen.
  failure?: string;
  onPromptChange: (system: string) => void;
  onSave: () => void;
};

const Section = ({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) => (
  <section className="flex flex-col gap-2">
    <h2 className="text-sm font-semibold">{title}</h2>
    {children}
  </section>
);

// What one agent is: its face and name, the model it talks to, what it
// is told before a conversation, and the tools it may use. The prompt
// is edited in place and saved with the button under it.
export const HarnessOverview = ({
  definition,
  promptState,
  failure,
  onPromptChange,
  onSave,
}: HarnessOverviewProps) => {
  const facts = useHarnessFacts(definition);

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-4">
        <Avatar seed={facts.seed} size="lg" />
        <div className="min-w-0">
          <h1 className="truncate text-heading font-semibold">
            {definition.name}
          </h1>
          <p className="truncate text-meta opacity-70">
            {facts.provider}・{facts.model}・最大{" "}
            {definition.harness.maxTurns} ターン
          </p>
        </div>
      </div>

      <div className="flex flex-col items-end gap-3">
        <div className="w-full">
          <TextArea
            name="system"
            label="システムプロンプト"
            value={definition.system ?? ""}
            placeholder="会話の前にエージェントへ伝えること"
            size="md"
            rows={6}
            height="content"
            maxRows={24}
            error={failure}
            onChange={(event) => onPromptChange(event.target.value)}
          />
        </div>
        <Button
          type="button"
          tone="primary"
          size="md"
          disabled={promptState !== "unsaved"}
          onClick={onSave}
        >
          {promptState === "saving" ? "保存中" : "保存"}
        </Button>
      </div>

      <Section title="ツール">
        {facts.tools.length === 0 ? (
          <p className="text-sm opacity-70">会話のみ</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {facts.tools.map((tool) => (
              <Tag key={tool}>{tool}</Tag>
            ))}
          </div>
        )}
      </Section>

      {definition.means === undefined ? null : (
        <>
          <Section title="作業フォルダ">
            <p className="font-mono text-sm break-all">
              {definition.means.root}
            </p>
          </Section>
          {facts.guards.length === 0 ? null : (
            <Section title="守り方">
              <div className="flex flex-wrap gap-2">
                {facts.guards.map((guard) => (
                  <Tag key={guard}>{guard}</Tag>
                ))}
              </div>
            </Section>
          )}
        </>
      )}
    </div>
  );
};
