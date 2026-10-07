import type { Option } from "../../Options/index.js";

export type Summary =
  | { kind: "none" }
  | { kind: "one"; name: string }
  | { kind: "several"; count: string; names: string };

// What the control says of the chosen options while it is not being
// typed in: the name of a single one, or for more than one how many
// there are and their names in the order of the options. A chosen value
// that no option has is not counted.
export const useSummary = (
  options: readonly Option[],
  values: readonly string[],
): Summary => {
  const chosen = options.filter((option) =>
    values.includes(option.value),
  );
  const [first] = chosen;
  if (first === undefined) return { kind: "none" };
  if (chosen.length === 1) return { kind: "one", name: first.label };
  return {
    kind: "several",
    count: `${chosen.length} 件選択中`,
    names: chosen.map((option) => option.label).join("、"),
  };
};

// `values` with `value` added when it is missing and removed when it is
// there.
export const useToggled = (
  values: readonly string[],
  value: string,
): string[] =>
  values.includes(value)
    ? values.filter((each) => each !== value)
    : [...values, value];
