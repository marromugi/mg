import { z } from "zod";
import { TOOL_NAMES } from "../../../definition/index.js";

// A model is either one from the list or one typed by hand.
const modelChoice = z.object({
  custom: z.boolean(),
  listed: z.string(),
  typed: z.string(),
});

export type ModelChoice = z.infer<typeof modelChoice>;

const emptyModel: ModelChoice = {
  custom: false,
  listed: "",
  typed: "",
};

const requireModel = (
  choice: ModelChoice,
  typed: boolean,
  at: string,
  add: (path: (string | number)[], message: string) => void,
): void => {
  if (typed) {
    if (choice.typed.trim() === "") {
      add([at, "typed"], "モデルの名前を入力してください");
    }
  } else if (choice.listed === "") {
    add([at, "listed"], "モデルを選んでください");
  }
};

// Everything the steps ask for, as it is typed. Each rule below names
// the field it belongs to, so a step can check only its own fields.
export const harnessSchema = z
  .object({
    name: z.string(),
    // What the face is drawn from; empty while it follows the name.
    avatar: z.string(),
    provider: z.enum(["openrouter", "ollama"]),
    baseUrl: z.string(),
    model: modelChoice,
    tools: z.array(z.enum(TOOL_NAMES)),
    root: z.string(),
    paths: z.array(z.object({ value: z.string() })),
    gate: z.boolean(),
    gateQuestion: z.string(),
    maxTurns: z.string(),
  })
  .superRefine((values, context) => {
    const add = (path: (string | number)[], message: string) =>
      context.addIssue({ code: "custom", path, message });

    if (values.name.trim() === "")
      add(["name"], "名前を入力してください");

    // Ollama has no list to choose from, so its model is always typed.
    const typesModel =
      values.provider === "ollama" || values.model.custom;
    requireModel(values.model, typesModel, "model", add);

    if (values.tools.length > 0) {
      const root = values.root.trim();
      if (root === "") add(["root"], "作業フォルダを入力してください");
      else if (!root.startsWith("/")) {
        add(["root"], "絶対パスで書いてください");
      }

      const paths = values.paths.filter(
        (path) => path.value.trim() !== "",
      );
      if (paths.length === 0 && !values.gate) {
        add(
          ["paths"],
          "許可するパスを 1 つ以上入れるか、ゲートを使ってください",
        );
      }

      if (values.gate && values.gateQuestion.trim() === "") {
        add(["gateQuestion"], "判定の質問を入力してください");
      }
    }

    if (!/^[1-9]\d*$/.test(values.maxTurns.trim())) {
      add(["maxTurns"], "1 以上の整数で入力してください");
    }
  });

export type HarnessValues = z.infer<typeof harnessSchema>;

export const emptyValues: HarnessValues = {
  name: "",
  avatar: "",
  provider: "openrouter",
  baseUrl: "",
  model: emptyModel,
  tools: [],
  root: "",
  paths: [{ value: "" }],
  gate: false,
  gateQuestion: "",
  maxTurns: "10",
};
