// The ids of the texts that describe the field `name`, for
// `aria-describedby`; undefined when it has neither a hint nor an error.
export const useDescribedBy = (
  name: string,
  texts: { hint?: string; error?: string },
): string | undefined => {
  const ids = [
    texts.hint === undefined ? undefined : `${name}-hint`,
    texts.error === undefined ? undefined : `${name}-error`,
  ].filter((id) => id !== undefined);
  return ids.length === 0 ? undefined : ids.join(" ");
};
