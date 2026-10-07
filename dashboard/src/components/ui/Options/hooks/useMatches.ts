import type { ReactNode } from "react";

// `label` is the option's name as text: it is what typing is matched
// against and what the control says of a chosen option. `content` is
// what the list draws in its place when given.
export type Option = {
  value: string;
  label: string;
  content?: ReactNode;
};

// The options whose name contains what was typed, ignoring case and
// the spaces around it. Nothing typed matches every option.
export const useMatches = (
  options: readonly Option[],
  typed: string,
): Option[] => {
  const wanted = typed.trim().toLowerCase();
  return options.filter((option) =>
    option.label.toLowerCase().includes(wanted),
  );
};
