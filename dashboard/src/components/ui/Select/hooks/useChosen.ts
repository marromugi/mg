import type { ReactNode } from "react";

// `label` is the option's name as text: the browser's own select and
// screen readers can show nothing else. `content` is what the list and
// the control draw in its place when given.
export type Option = {
  value: string;
  label: string;
  content?: ReactNode;
};

export type Chosen =
  { kind: "chosen"; option: Option } | { kind: "none" };

// The option whose value is `value`, if there is one.
export const useChosen = (
  options: readonly Option[],
  value: string | undefined,
): Chosen => {
  const option = options.find((each) => each.value === value);
  return option === undefined
    ? { kind: "none" }
    : { kind: "chosen", option };
};
