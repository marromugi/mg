import { useLayoutEffect, useRef, type ReactNode } from "react";

// How close to the end still counts as being at it, in pixels.
const NEAR = 24;

type PanelProps = {
  label: string;
  top?: ReactNode;
  bottom?: ReactNode;
  // With "follow" the end of `children` stays in view as they grow,
  // unless the person has scrolled away from it.
  scroll?: "free" | "follow";
  children: ReactNode;
};

// A wide column on its own surface: `top` and `bottom` stay in place,
// and `children` scroll in the space between them.
export const Panel = ({
  label,
  top,
  bottom,
  scroll = "free",
  children,
}: PanelProps) => {
  const body = useRef<HTMLDivElement>(null);
  const atEnd = useRef(true);

  useLayoutEffect(() => {
    const area = body.current;
    if (area === null || scroll !== "follow" || !atEnd.current) return;
    area.scrollTop = area.scrollHeight;
  });

  return (
    <aside
      aria-label={label}
      className="flex h-full w-96 shrink-0 flex-col gap-4 rounded-container bg-surface container-p-4 around-control-py-2"
    >
      {top}
      <div
        ref={body}
        className="min-h-0 flex-1 overflow-auto"
        onScroll={(event) => {
          const area = event.currentTarget;
          atEnd.current =
            area.scrollHeight - area.scrollTop - area.clientHeight <
            NEAR;
        }}
      >
        {children}
      </div>
      {bottom}
    </aside>
  );
};
