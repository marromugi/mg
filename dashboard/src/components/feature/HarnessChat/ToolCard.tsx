import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { useState } from "react";
import { tv } from "tailwind-variants";
import { ChevronDownIcon, Icon, ShieldIcon } from "../../ui/index.js";
import { ShownView } from "./ShownView.js";
import { useToolCard } from "./hooks/useToolCard.js";
import type { Shown } from "../../../trial/shown.js";
import type { ChatItem } from "./transcript.js";

const card = tv({
  base: "flex flex-col rounded-container bg-surface-raised container-p-4",
  variants: { state: { working: "shimmer", done: "", refused: "" } },
});

const summary = tv({
  base: "flex min-w-0 items-center gap-1 text-xs",
  variants: {
    state: {
      working: "opacity-70",
      done: "opacity-70",
      refused: "text-error",
    },
  },
});

const chevron = tv({
  base: "shrink-0 opacity-70 transition duration-160 ease-out",
  variants: { open: { true: "rotate-180", false: "" } },
});

const Detail = ({ label, shown }: { label: string; shown: Shown }) => (
  <div className="flex flex-col gap-2 rounded-container bg-surface container-p-3">
    <p className="text-xs font-semibold opacity-70">{label}</p>
    <ShownView shown={shown} />
  </div>
);

// One tool call as a card: which tool, and one line on what it is
// doing or did. A band of light crosses it while the tool works.
// Pressing it opens what the tool was given and what it gave back, which
// spring into place and fade in.
export const ToolCard = ({
  item,
}: {
  item: Extract<ChatItem, { kind: "tool" }>;
}) => {
  const [open, setOpen] = useState(false);
  const view = useToolCard(item);

  return (
    <div className="appear">
      <div className={card({ state: view.state })}>
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="flex w-full cursor-pointer items-center gap-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-xs font-semibold">{view.title}</span>
            <span className={summary({ state: view.state })}>
              {view.state === "refused" ? (
                <Icon icon={ShieldIcon} size="sm" />
              ) : null}
              <span className="truncate">{view.summary}</span>
            </span>
          </span>
          <span className={chevron({ open })}>
            <Icon icon={ChevronDownIcon} />
          </span>
        </button>
        <MotionConfig reducedMotion="user">
          <AnimatePresence initial={false}>
            {open ? (
              <motion.div
                className="overflow-hidden"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{
                  height: {
                    type: "spring",
                    bounce: 0.25,
                    duration: 0.4,
                  },
                  opacity: { duration: 0.2, ease: "easeOut" },
                }}
              >
                <div className="flex flex-col gap-3 pt-4">
                  <Detail label="入力" shown={item.input} />
                  {item.result === undefined ? null : (
                    <Detail
                      label={
                        item.result.refused ? "拒否の理由" : "結果"
                      }
                      shown={item.result.shown}
                    />
                  )}
                </div>
              </motion.div>
            ) : null}
          </AnimatePresence>
        </MotionConfig>
      </div>
    </div>
  );
};
