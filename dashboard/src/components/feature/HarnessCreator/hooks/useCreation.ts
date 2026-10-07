import type {
  Draft,
  RuleDraft,
} from "../../../../harness-form/index.js";
import type { HarnessValues, ModelChoice } from "../schema.js";

// The tools the path rules can judge: each names the files it touches.
const FILE_TOOLS = ["read_file", "grep", "write_file", "edit_file"];

const NOT_ALLOWED_REASON = "許可していないパスです";

// What comes out of the steps: the draft a harness is saved from. Its
// gate is judged by Jev: an action goes through when Jev answers the
// question with yes.
export type Creation = { draft: Draft };

const modelOf = (choice: ModelChoice, typed: boolean): string =>
  typed ? choice.typed.trim() : choice.listed;

// The allowed paths as rules: one rule allows them, and a rule after it
// refuses the file tools everywhere else. With no path there is no rule.
const rulesOf = (paths: readonly string[]): RuleDraft[] =>
  paths.length === 0
    ? []
    : [
        {
          tools: [],
          paths: paths.join("\n"),
          effect: "allow",
          reason: "",
        },
        {
          tools: FILE_TOOLS,
          paths: "",
          effect: "deny",
          reason: NOT_ALLOWED_REASON,
        },
      ];

// What the face is drawn from: the seed that was picked, or the name
// until one is.
export const useAvatarSeed = (
  values: Pick<HarnessValues, "avatar" | "name">,
): string =>
  values.avatar === "" ? values.name.trim() : values.avatar;

// Without a tool there is nothing to guard, so the folder, the paths,
// and the gate are left out.
export const useCreation = (values: HarnessValues): Creation => {
  const guarded = values.tools.length > 0;
  const gated = guarded && values.gate;
  const paths = values.paths
    .map((path) => path.value.trim())
    .filter((path) => path !== "");

  return {
    draft: {
      name: values.name.trim(),
      avatar: useAvatarSeed(values),
      provider: values.provider,
      baseUrl:
        values.provider === "ollama" ? values.baseUrl.trim() : "",
      model: modelOf(
        values.model,
        values.provider === "ollama" || values.model.custom,
      ),
      maxTurns: values.maxTurns.trim(),
      tools: [...values.tools],
      root: guarded ? values.root.trim() : "",
      rules: guarded ? rulesOf(paths) : [],
      judge: false,
      judgeModel: "",
      judgeInstruction: "",
      gate: gated,
      gateQuestion: gated ? values.gateQuestion.trim() : "",
    },
  };
};
