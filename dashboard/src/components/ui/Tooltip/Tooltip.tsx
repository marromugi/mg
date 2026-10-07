import {
  autoUpdate,
  flip,
  offset,
  shift,
  useFloating,
} from "@floating-ui/react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useState, type ReactNode } from "react";
import { useOrigin, type Direction } from "../Popover/index.js";

const GAP = 12;
const VIEWPORT_MARGIN = 8;
const TRAVEL = 8;

// Where the label starts from before it springs into place: a little
// towards its trigger.
const FROM: Record<Direction, { x: number; y: number }> = {
  top: { x: 0, y: TRAVEL },
  right: { x: -TRAVEL, y: 0 },
  bottom: { x: 0, y: -TRAVEL },
  left: { x: TRAVEL, y: 0 },
};

type TooltipProps = {
  label: string;
  direction?: Direction;
  children: ReactNode;
};

// Shows `label` beside `children`, on `direction` of them, while the
// pointer is over them or the keyboard focus is inside them. It moves to
// the other side or slides along to stay inside the viewport. The label
// is for sighted users only; whatever is inside names itself for screen
// readers.
export const Tooltip = ({
  label,
  direction = "right",
  children,
}: TooltipProps) => {
  const [shown, setShown] = useState(false);
  const show = () => setShown(true);
  const hide = () => setShown(false);
  const { refs, floatingStyles, placement } = useFloating({
    open: shown,
    placement: direction,
    whileElementsMounted: autoUpdate,
    middleware: [
      offset(GAP),
      flip({ padding: VIEWPORT_MARGIN }),
      shift({ padding: VIEWPORT_MARGIN }),
    ],
  });
  const side = placement.split("-")[0] as Direction;

  return (
    <span
      ref={refs.setReference}
      className="inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      <MotionConfig reducedMotion="user">
        <AnimatePresence>
          {shown ? (
            <span
              ref={refs.setFloating}
              aria-hidden
              style={floatingStyles}
              className="pointer-events-none z-10"
            >
              <motion.span
                className="block rounded-control border border-edge bg-surface-raised px-2 control-py-1 text-xs whitespace-nowrap"
                style={{ transformOrigin: useOrigin(placement) }}
                initial={{ opacity: 0, scale: 0.6, ...FROM[side] }}
                animate={{ opacity: 1, scale: 1, x: 0, y: 0 }}
                exit={{ opacity: 0, scale: 0.6, ...FROM[side] }}
                transition={{
                  type: "spring",
                  bounce: 0.25,
                  duration: 0.4,
                }}
              >
                {label}
              </motion.span>
            </span>
          ) : null}
        </AnimatePresence>
      </MotionConfig>
    </span>
  );
};
