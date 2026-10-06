import { isAbsolute } from "node:path";
import {
  TOOL_NAMES,
  type HarnessDefinition,
  type PathRule,
  type Problem,
  type ToolName,
} from "../definition/index.js";

export type ParseResult =
  | { ok: true; definition: HarnessDefinition }
  | { ok: false; problems: Problem[] };

type Fields = Record<string, unknown>;
type Means = NonNullable<HarnessDefinition["means"]>;

const isFields = (value: unknown): value is Fields =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isToolName = (value: unknown): value is ToolName =>
  TOOL_NAMES.some((name) => name === value);

const isHttpUrl = (candidate: string): boolean => {
  try {
    const { protocol } = new URL(candidate);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
};

const toTuple = (
  names: ToolName[],
): [ToolName, ...ToolName[]] | undefined => {
  const [first, ...rest] = names;
  return first === undefined ? undefined : [first, ...rest];
};

const NEEDS_GATE =
  "ツールを使うハーネスには、パスのルールか判定 LLM が要ります";

export const parseDefinition = (value: unknown): ParseResult => {
  if (!isFields(value)) {
    return {
      ok: false,
      problems: [
        { field: "", message: "ハーネスの形式が正しくありません" },
      ],
    };
  }

  const problems: Problem[] = [];
  const reject = (field: string, message: string): undefined => {
    problems.push({ field, message });
    return undefined;
  };

  const text = (
    source: Fields,
    key: string,
    field: string,
    message: string,
  ): string | undefined => {
    const entry = source[key];
    return typeof entry === "string" && entry.trim() !== ""
      ? entry.trim()
      : reject(field, message);
  };

  const readProvider = ():
    HarnessDefinition["provider"] | undefined => {
    const provider = value["provider"];
    const kind = isFields(provider) ? provider["kind"] : undefined;
    if (
      !isFields(provider) ||
      (kind !== "openrouter" && kind !== "ollama")
    ) {
      return reject("provider.kind", "プロバイダーを選んでください");
    }
    if (kind === "openrouter") return { kind };

    const baseUrl = provider["baseUrl"];
    if (baseUrl === undefined) return { kind };
    if (typeof baseUrl !== "string" || !isHttpUrl(baseUrl.trim())) {
      return reject(
        "provider.baseUrl",
        "http か https のアドレスを書いてください",
      );
    }
    return { kind, baseUrl: baseUrl.trim() };
  };

  const readHarness = (): HarnessDefinition["harness"] | undefined => {
    const harness = value["harness"];
    if (!isFields(harness) || harness["kind"] !== "loop") {
      return reject("harness.kind", "ハーネスの種類は loop だけです");
    }
    const model = text(
      harness,
      "model",
      "harness.model",
      "モデルを入力してください",
    );
    const maxTurns = harness["maxTurns"];
    if (
      typeof maxTurns !== "number" ||
      !Number.isInteger(maxTurns) ||
      maxTurns < 1
    ) {
      return reject(
        "harness.maxTurns",
        "1 以上の整数で入力してください",
      );
    }
    return model === undefined
      ? undefined
      : { kind: "loop", model, maxTurns };
  };

  const readToolNames = (
    entry: unknown,
    field: string,
  ): ToolName[] | undefined =>
    Array.isArray(entry) && entry.length > 0 && entry.every(isToolName)
      ? entry
      : reject(field, "使えるツールの名前を 1 つ以上選んでください");

  const readRule = (
    entry: unknown,
    field: string,
  ): PathRule | undefined => {
    if (!isFields(entry)) {
      return reject(field, "ルールの形式が正しくありません");
    }
    const before = problems.length;
    const rule: { -readonly [K in keyof PathRule]: PathRule[K] } = {
      allowed: true,
    };

    if (entry["tools"] !== undefined) {
      const tools = readToolNames(entry["tools"], `${field}.tools`);
      if (tools !== undefined) rule.tools = tools;
    }

    const paths = entry["paths"];
    if (paths !== undefined) {
      if (
        Array.isArray(paths) &&
        paths.length > 0 &&
        paths.every(
          (path) => typeof path === "string" && path.trim() !== "",
        )
      ) {
        rule.paths = paths.map((path: string) => path.trim());
      } else {
        reject(
          `${field}.paths`,
          "パスのパターンは 1 つ以上の文字列で書いてください",
        );
      }
    }

    if (typeof entry["allowed"] === "boolean") {
      rule.allowed = entry["allowed"];
    } else {
      reject(`${field}.allowed`, "許可か拒否を選んでください");
    }

    const reason = entry["reason"];
    if (typeof reason === "string") rule.reason = reason;
    else if (reason !== undefined) {
      reject(`${field}.reason`, "理由は文字列で書いてください");
    }

    return problems.length === before ? rule : undefined;
  };

  const readJudge = (
    entry: unknown,
  ): { model: string; instruction: string } | undefined => {
    if (!isFields(entry)) {
      return reject("means.judge", "判定 LLM の形式が正しくありません");
    }
    const model = text(
      entry,
      "model",
      "means.judge.model",
      "判定 LLM のモデルを入力してください",
    );
    const instruction = text(
      entry,
      "instruction",
      "means.judge.instruction",
      "判定 LLM への指示を入力してください",
    );
    return model === undefined || instruction === undefined
      ? undefined
      : { model, instruction };
  };

  const readMeans = (): Means | undefined => {
    const means = value["means"];
    if (!isFields(means)) {
      return reject("means", "ツールの設定の形式が正しくありません");
    }

    let root = text(
      means,
      "root",
      "means.root",
      "作業フォルダを入力してください",
    );
    if (root !== undefined && !isAbsolute(root)) {
      root = reject("means.root", "絶対パスで書いてください");
    }

    const names = readToolNames(means["tools"], "means.tools");
    const tools = names === undefined ? undefined : toTuple(names);

    const entries = means["rules"];
    const rules = Array.isArray(entries)
      ? entries.map((entry: unknown, index) =>
          readRule(entry, `means.rules.${index}`),
        )
      : reject("means.rules", "ルールの形式が正しくありません");

    const judge =
      means["judge"] === undefined
        ? undefined
        : readJudge(means["judge"]);

    if (rules?.length === 0 && means["judge"] === undefined) {
      reject("means.rules", NEEDS_GATE);
    }

    const valid = rules?.filter((rule) => rule !== undefined);
    if (
      root === undefined ||
      tools === undefined ||
      valid === undefined ||
      valid.length !== rules?.length ||
      (means["judge"] !== undefined && judge === undefined)
    ) {
      return undefined;
    }
    return judge === undefined
      ? { root, tools, rules: valid }
      : { root, tools, rules: valid, judge };
  };

  const id = text(value, "id", "id", "id が必要です");
  const name = text(value, "name", "name", "名前を入力してください");
  const provider = readProvider();
  const harness = readHarness();
  const means = value["means"] === undefined ? undefined : readMeans();

  if (
    problems.length > 0 ||
    id === undefined ||
    name === undefined ||
    provider === undefined ||
    harness === undefined
  ) {
    return { ok: false, problems };
  }

  return {
    ok: true,
    definition:
      means === undefined
        ? { id, name, provider, harness }
        : { id, name, provider, harness, means },
  };
};
