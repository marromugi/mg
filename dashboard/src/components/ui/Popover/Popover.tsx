import {
  FloatingNode,
  FloatingPortal,
  autoUpdate,
  flip,
  offset as offsetBy,
  shift,
  size,
  useClick,
  useDismiss,
  useFloating,
  useFloatingNodeId,
  useInteractions,
  useRole,
} from "@floating-ui/react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import {
  cloneElement,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { Nested } from "../Floating/index.js";
import {
  useOrigin,
  usePlacement,
  type Align,
  type Direction,
} from "./hooks/usePlacement.js";

const VIEWPORT_MARGIN = 8;

// Whoever passes `open` holds the state, so it must also take the
// changes. Without `open` the popover holds the state itself.
type OpenState =
  | {
      open: boolean;
      onOpenChange: (open: boolean) => void;
      defaultOpen?: undefined;
    }
  | {
      open?: undefined;
      onOpenChange?: (open: boolean) => void;
      defaultOpen?: boolean;
    };

type PopoverProps = {
  trigger: ReactElement<Record<string, unknown>>;
  direction?: Direction;
  align?: Align;
  offset?: number;
  width?: "content" | "trigger";
  children: ReactNode;
} & OpenState;

// Opens `children` next to `trigger` when the trigger is clicked, and
// closes on a click outside or on Escape. It moves to the other side or
// slides along the trigger to stay inside the viewport. It draws nothing
// of its own: `children` bring their own surface and padding.
//
// With `width` "trigger" it is at least as wide as its trigger.
//
// The trigger is one element that passes the props it is given on to a
// button, as Button and IconButton do. The popover hands it the click
// handler, the ref, and the open state, and makes it a plain button.
const PopoverBody = ({
  trigger,
  direction = "bottom",
  align = "start",
  offset = 8,
  width = "content",
  open: givenOpen,
  onOpenChange,
  defaultOpen = false,
  children,
}: PopoverProps) => {
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const open = givenOpen ?? ownOpen;
  const setOpen = (next: boolean) => {
    if (givenOpen === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  };
  const nodeId = useFloatingNodeId();
  const { refs, floatingStyles, context, placement } = useFloating({
    nodeId,
    open,
    onOpenChange: setOpen,
    placement: usePlacement(direction, align),
    whileElementsMounted: autoUpdate,
    middleware: [
      offsetBy(offset),
      flip({ padding: VIEWPORT_MARGIN }),
      shift({ padding: VIEWPORT_MARGIN }),
      size({
        apply: ({ rects, elements }) => {
          elements.floating.style.minWidth =
            width === "trigger" ? `${rects.reference.width}px` : "";
        },
      }),
    ],
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    // Escape is taken where the key is pressed, so the innermost open
    // part closes first.
    useDismiss(context, { capture: { escapeKey: true } }),
    useRole(context),
  ]);
  const origin = useOrigin(placement);

  return (
    <>
      {cloneElement(trigger, {
        type: "button",
        ...getReferenceProps(trigger.props),
        ref: refs.setReference,
      })}
      <FloatingNode id={nodeId}>
        <FloatingPortal>
          <MotionConfig reducedMotion="user">
            <AnimatePresence>
              {open ? (
                <div
                  ref={refs.setFloating}
                  style={floatingStyles}
                  className="z-30"
                  {...getFloatingProps()}
                >
                  <motion.div
                    style={{ transformOrigin: origin }}
                    initial={{ opacity: 0, scale: 0.9 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.9 }}
                    transition={{
                      type: "spring",
                      bounce: 0.25,
                      duration: 0.3,
                    }}
                  >
                    {children}
                  </motion.div>
                </div>
              ) : null}
            </AnimatePresence>
          </MotionConfig>
        </FloatingPortal>
      </FloatingNode>
    </>
  );
};

export const Popover = (props: PopoverProps) => (
  <Nested>
    <PopoverBody {...props} />
  </Nested>
);
