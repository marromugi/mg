import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useState, type ReactNode } from "react";

type TooltipProps = {
  label: string;
  children: ReactNode;
};

// Shows `label` to the right of `children` while the pointer is over them
// or the keyboard focus is inside them. The label is for sighted users
// only; whatever is inside names itself for screen readers.
export const Tooltip = ({ label, children }: TooltipProps) => {
  const [shown, setShown] = useState(false);
  const show = () => setShown(true);
  const hide = () => setShown(false);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-y-0 left-full flex items-center pl-3"
      >
        <MotionConfig reducedMotion="user">
          <AnimatePresence>
            {shown ? (
              <motion.span
                className="origin-left rounded-control border border-edge bg-surface-raised px-2 control-py-1 text-xs whitespace-nowrap"
                initial={{ opacity: 0, scale: 0.6, x: -8 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                exit={{ opacity: 0, scale: 0.6, x: -8 }}
                transition={{
                  type: "spring",
                  bounce: 0.25,
                  duration: 0.4,
                }}
              >
                {label}
              </motion.span>
            ) : null}
          </AnimatePresence>
        </MotionConfig>
      </span>
    </span>
  );
};
