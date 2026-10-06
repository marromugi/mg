// The ids of the hint and error lines that Field draws for `name`,
// joined for aria-describedby.
export const useDescribedBy = (
  name: string,
  parts: { hint?: string; error?: string },
): string | undefined => {
  const ids = [
    parts.hint === undefined ? undefined : `${name}-hint`,
    parts.error === undefined ? undefined : `${name}-error`,
  ].filter((id) => id !== undefined);
  return ids.length === 0 ? undefined : ids.join(" ");
};
