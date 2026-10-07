export type Direction = "top" | "right" | "bottom" | "left";
export type Align = "start" | "center" | "end";
export type Placement = Direction | `${Direction}-${"start" | "end"}`;

// The placement that puts the popover on `direction` of its trigger,
// lined up with it by `align`.
export const usePlacement = (
  direction: Direction,
  align: Align,
): Placement =>
  align === "center" ? direction : `${direction}-${align}`;

const OPPOSITE: Record<Direction, string> = {
  top: "bottom",
  right: "left",
  bottom: "top",
  left: "right",
};

// The corner or edge of the popover that touches its trigger at
// `placement`, as a CSS transform-origin, so it grows out of the trigger.
export const useOrigin = (placement: Placement): string => {
  const [direction, align] = placement.split("-") as [
    Direction,
    "start" | "end" | undefined,
  ];
  const near = OPPOSITE[direction];
  const vertical = direction === "top" || direction === "bottom";
  if (align === undefined) return `${near} center`;
  if (vertical)
    return `${near} ${align === "start" ? "left" : "right"}`;
  return `${near} ${align === "start" ? "top" : "bottom"}`;
};
