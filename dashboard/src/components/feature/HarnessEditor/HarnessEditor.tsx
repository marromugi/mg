import type { Problem } from "../../../definition/index.js";
import { TOOL_NAMES } from "../../../definition/index.js";
import type { Draft } from "../../../harness-form/index.js";
import {
  Button,
  Checkbox,
  FieldGroup,
  Notice,
  Select,
  TextArea,
  TextField,
} from "../../ui/index.js";
import { useHarnessEditor } from "./hooks/useHarnessEditor.js";
import { RuleRow } from "./RuleRow.js";

const PROVIDERS = [
  { value: "openrouter", label: "OpenRouter" },
  { value: "ollama", label: "Ollama" },
];

type HarnessEditorProps = {
  action: string;
  draft: Draft;
  problems: readonly Problem[];
  failure?: string;
  deleteHref?: string;
};

export const HarnessEditor = ({
  action,
  draft,
  problems,
  failure,
  deleteHref,
}: HarnessEditorProps) => {
  const { errorOf, general } = useHarnessEditor(problems);

  return (
    <form method="post" action={action} className="flex flex-col gap-6">
      {/* Enter in a field presses the first submit button in the form. */}
      <button
        type="submit"
        name="intent"
        value="save"
        hidden
        tabIndex={-1}
      />
      {failure === undefined ? null : (
        <Notice>保存できませんでした。{failure}</Notice>
      )}
      {general.map((message) => (
        <Notice key={message}>{message}</Notice>
      ))}

      <TextField
        name="name"
        label="名前"
        value={draft.name}
        error={errorOf("name")}
      />

      <FieldGroup legend="LLM">
        <Select
          name="provider"
          label="プロバイダー"
          options={PROVIDERS}
          value={draft.provider}
          error={errorOf("provider")}
        />
        <TextField
          name="baseUrl"
          label="Ollama のアドレス"
          hint="Ollama のときだけ使います。省略できます。"
          value={draft.baseUrl}
          error={errorOf("baseUrl")}
        />
        <TextField
          name="model"
          label="モデル"
          value={draft.model}
          error={errorOf("model")}
        />
        <TextField
          name="maxTurns"
          label="ターン数の上限"
          type="number"
          value={draft.maxTurns}
          error={errorOf("maxTurns")}
        />
      </FieldGroup>

      <FieldGroup
        legend="ツール"
        hint="ツールを選ぶと、作業フォルダと、パスのルールか判定 LLM が要ります。何も選ばなければ、これより下の設定は保存されません。"
        error={errorOf("tools")}
      >
        {TOOL_NAMES.map((tool) => (
          <Checkbox
            key={tool}
            name="tools"
            value={tool}
            label={tool}
            checked={draft.tools.includes(tool)}
          />
        ))}
      </FieldGroup>

      <TextField
        name="root"
        label="作業フォルダ"
        hint="絶対パスで書きます。"
        value={draft.root}
        error={errorOf("root")}
      />

      <FieldGroup legend="パスのルール" error={errorOf("rules")}>
        {draft.rules.map((rule, index) => (
          <RuleRow
            key={index}
            index={index}
            rule={rule}
            errorOf={errorOf}
          />
        ))}
        <div>
          <Button name="intent" value="add-rule">
            ルールを追加
          </Button>
        </div>
      </FieldGroup>

      <FieldGroup
        legend="判定 LLM"
        hint="ハーネスと同じプロバイダーを使います。"
      >
        <Checkbox
          name="judge"
          value="on"
          label="判定 LLM を使う"
          checked={draft.judge}
        />
        <TextField
          name="judgeModel"
          label="判定 LLM のモデル"
          value={draft.judgeModel}
          error={errorOf("judgeModel")}
        />
        <TextArea
          name="judgeInstruction"
          label="判定 LLM への指示"
          value={draft.judgeInstruction}
          error={errorOf("judgeInstruction")}
        />
      </FieldGroup>

      <div className="flex gap-3">
        <Button tone="primary" name="intent" value="save">
          保存
        </Button>
        <Button href="/harnesses">キャンセル</Button>
        {deleteHref === undefined ? null : (
          <Button tone="danger" href={deleteHref}>
            削除
          </Button>
        )}
      </div>
    </form>
  );
};
