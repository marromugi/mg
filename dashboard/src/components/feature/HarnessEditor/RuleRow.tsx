import { TOOL_NAMES } from "../../../definition/index.js";
import type { RuleDraft } from "../../../harness-form/index.js";
import {
  Button,
  Checkbox,
  FieldGroup,
  Select,
  TextArea,
  TextField,
} from "../../ui/index.js";

const EFFECTS = [
  { value: "deny", label: "拒否する" },
  { value: "allow", label: "許可する" },
];

export const RuleRow = ({
  index,
  rule,
  errorOf,
}: {
  index: number;
  rule: RuleDraft;
  errorOf: (field: string) => string | undefined;
}) => {
  const at = `rules.${index}`;

  return (
    <FieldGroup legend={`ルール ${index + 1}`}>
      <FieldGroup
        legend="対象のツール"
        hint="何も選ばなければ、すべてのツールが対象です。"
        error={errorOf(`${at}.tools`)}
      >
        {TOOL_NAMES.map((tool) => (
          <Checkbox
            key={tool}
            name={`${at}.tools`}
            value={tool}
            label={tool}
            checked={rule.tools.includes(tool)}
          />
        ))}
      </FieldGroup>
      <TextArea
        name={`${at}.paths`}
        label="パスのパターン"
        hint="1 行に 1 つ書きます。空なら、すべてのパスが対象です。"
        value={rule.paths}
        error={errorOf(`${at}.paths`)}
      />
      <Select
        name={`${at}.effect`}
        label="扱い"
        options={EFFECTS}
        value={rule.effect}
        error={errorOf(`${at}.effect`)}
      />
      <TextField
        name={`${at}.reason`}
        label="理由"
        value={rule.reason}
        error={errorOf(`${at}.reason`)}
      />
      <div>
        <Button name="intent" value={`remove-rule:${index}`}>
          このルールを消す
        </Button>
      </div>
    </FieldGroup>
  );
};
