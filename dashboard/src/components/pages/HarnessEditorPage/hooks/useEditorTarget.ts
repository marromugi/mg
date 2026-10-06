export type EditorTarget =
  { kind: "new" } | { kind: "edit"; id: string };

export type EditorTargetView = {
  heading: string;
  action: string;
  deleteHref?: string;
};

export const useEditorTarget = (
  target: EditorTarget,
): EditorTargetView =>
  target.kind === "new"
    ? { heading: "ハーネスを作る", action: "/harnesses/new" }
    : {
        heading: "ハーネスを編集",
        action: `/harnesses/${target.id}`,
        deleteHref: `/harnesses/${target.id}/delete`,
      };
