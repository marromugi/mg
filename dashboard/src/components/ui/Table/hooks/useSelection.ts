// The table library keeps the selected rows as a record from row id to
// true; the Table's own props speak of a list of row ids.

export const useSelectionRecord = (
  ids: readonly string[],
): Record<string, true> =>
  Object.fromEntries(ids.map((id) => [id, true as const]));

export const useSelectedIds = (
  record: Readonly<Record<string, true>>,
): string[] => Object.keys(record);
