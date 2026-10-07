import {
  FloatingFocusManager,
  FloatingNode,
  FloatingOverlay,
  FloatingPortal,
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
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from "react";
import { tv } from "tailwind-variants";
import { Nested } from "../Floating/index.js";
import { CloseIcon } from "../Icon/index.js";
import { IconButton } from "../IconButton/index.js";
import { useScrollEdges, type Edges } from "./hooks/useScrollEdges.js";

// The body scrolls under a fade at each end, shown while content is out
// of view there, so what leaves the view thins out and is not cut off.
// Under a title it starts a little below it; with no title it starts at
// the very top. Its end padding keeps the content clear of the actions
// lying over it.
const body = tv({
  base: "min-h-0 flex-1 overflow-y-auto",
  variants: {
    title: { present: "pt-4", absent: "" },
    actions: { present: "pb-24", absent: "" },
  },
});

const fade = tv({
  base: "pointer-events-none absolute inset-x-0 h-4 from-surface-raised to-transparent transition-opacity duration-160 ease-out",
  variants: {
    edge: {
      top: "top-0 bg-linear-to-b",
      bottom: "bottom-0 bg-linear-to-t",
      above: "bottom-full bg-linear-to-t",
    },
    shown: { yes: "opacity-100", no: "opacity-0" },
  },
});

// A modal is named by its title when it shows one, and by `label`, which
// is read out but not shown, when it does not.
type Name =
  | { title: string; label?: undefined }
  | { title?: undefined; label: string };

// Whoever passes `open` holds the state, so it must also take the
// changes. Without `open` the modal holds the state itself.
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

type ModalProps = {
  trigger?: ReactElement<Record<string, unknown>>;
  closeButton?: "shown" | "hidden";
  dismiss?: "easy" | "explicit";
  actions?: ReactNode;
  children: ReactNode;
} & Name &
  OpenState;

// A dialog over the page that keeps the focus inside it until it closes,
// then hands the focus back to where it was. On opening, the focus goes
// to the dialog itself, not to a control in it.
//
// With `dismiss` "easy" a press outside it or Escape closes it. With
// "explicit" only a control inside it does: its close button, or a
// control in `children` or `actions` that sets `open`. Use "explicit"
// where closing by accident would lose what was typed.
//
// `children` scroll when they are taller than the window allows; the
// header and `actions` stay in view.
//
// `trigger`, when given, is one element that passes the props it is
// given on to a button, as Button and IconButton do.
const ModalBody = ({
  trigger,
  title,
  label,
  closeButton = "shown",
  dismiss = "easy",
  actions,
  open: givenOpen,
  onOpenChange,
  defaultOpen = false,
  children,
}: ModalProps) => {
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const open = givenOpen ?? ownOpen;
  const setOpen = (next: boolean) => {
    if (givenOpen === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  };
  const titleId = useId();

  const scroller = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState<Edges>({
    above: false,
    below: false,
  });
  const measure = () => {
    const area = scroller.current;
    if (area === null) return;
    const next = useScrollEdges({
      offset: area.scrollTop,
      content: area.scrollHeight,
      view: area.clientHeight,
    });
    setEdges((now) =>
      now.above === next.above && now.below === next.below ? now : next,
    );
  };
  useLayoutEffect(measure);

  const nodeId = useFloatingNodeId();
  const { refs, context } = useFloating({
    nodeId,
    open,
    onOpenChange: setOpen,
  });
  const { getReferenceProps, getFloatingProps } = useInteractions([
    useClick(context),
    useDismiss(context, {
      enabled: dismiss === "easy",
      capture: { escapeKey: true },
    }),
    useRole(context, { role: "dialog" }),
  ]);

  // The close button casts a shadow, so it reads as lying over whatever
  // it overlaps.
  const close = (
    <span className="inline-flex rounded-full shadow-float">
      <IconButton
        icon={CloseIcon}
        label="閉じる"
        labelSide="left"
        size="sm"
        type="button"
        onClick={() => setOpen(false)}
      />
    </span>
  );

  return (
    <>
      {trigger === undefined
        ? null
        : cloneElement(trigger, {
            type: "button",
            ...getReferenceProps(trigger.props),
            ref: refs.setReference,
          })}
      <FloatingNode id={nodeId}>
        <FloatingPortal>
          <MotionConfig reducedMotion="user">
            <AnimatePresence>
              {open ? (
                <FloatingOverlay
                  lockScroll
                  className="z-20 grid place-items-center p-6"
                >
                  <motion.div
                    aria-hidden
                    className="absolute inset-0 bg-scrim"
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    transition={{ duration: 0.16 }}
                  />
                  <FloatingFocusManager
                    context={context}
                    modal
                    returnFocus
                    initialFocus={refs.floating}
                  >
                    <motion.div
                      ref={refs.setFloating}
                      aria-modal
                      aria-labelledby={
                        title === undefined ? undefined : titleId
                      }
                      aria-label={label}
                      className="relative flex max-h-full w-full max-w-2xl flex-col overflow-hidden rounded-container border border-edge bg-surface-raised container-p-6 outline-none"
                      initial={{ opacity: 0, scale: 0.94 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.94 }}
                      transition={{
                        type: "spring",
                        bounce: 0.2,
                        duration: 0.3,
                      }}
                      {...getFloatingProps()}
                    >
                      {title === undefined ? null : (
                        <div className="flex min-h-8 items-center justify-between gap-3">
                          <h2
                            id={titleId}
                            className="text-base font-semibold"
                          >
                            {title}
                          </h2>
                          {closeButton === "shown" ? close : null}
                        </div>
                      )}
                      {title === undefined &&
                      closeButton === "shown" ? (
                        <div className="absolute top-6 right-6 z-10">
                          {close}
                        </div>
                      ) : null}
                      <div className="relative flex min-h-0 flex-1 flex-col">
                        <div
                          ref={scroller}
                          onScroll={measure}
                          className={body({
                            title:
                              title === undefined
                                ? "absent"
                                : "present",
                            actions:
                              actions === undefined
                                ? "absent"
                                : "present",
                          })}
                        >
                          {children}
                        </div>
                        <div
                          className={fade({
                            edge: "top",
                            shown: edges.above ? "yes" : "no",
                          })}
                        />
                        {actions === undefined ? (
                          <div
                            className={fade({
                              edge: "bottom",
                              shown: edges.below ? "yes" : "no",
                            })}
                          />
                        ) : null}
                      </div>
                      {actions === undefined ? null : (
                        <div className="absolute inset-x-0 bottom-0 flex justify-end gap-2 bg-surface-raised px-6 py-4">
                          <div
                            className={fade({
                              edge: "above",
                              shown: edges.below ? "yes" : "no",
                            })}
                          />
                          {actions}
                        </div>
                      )}
                    </motion.div>
                  </FloatingFocusManager>
                </FloatingOverlay>
              ) : null}
            </AnimatePresence>
          </MotionConfig>
        </FloatingPortal>
      </FloatingNode>
    </>
  );
};

export const Modal = (props: ModalProps) => (
  <Nested>
    <ModalBody {...props} />
  </Nested>
);
