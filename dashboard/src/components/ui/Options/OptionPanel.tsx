import { FloatingNode, FloatingPortal } from "@floating-ui/react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import type { MouseEvent } from "react";
import { CheckIcon, HelpIcon, Icon } from "../Icon/index.js";
import { IconButton } from "../IconButton/index.js";
import { Popover } from "../Popover/index.js";
import type { Option } from "./hooks/useMatches.js";
import type { OptionPanelState } from "./hooks/useOptionPanel.js";
import { optionList, optionRow } from "./Options.js";

type OptionPanelProps = {
  panel: OptionPanelState;
  open: boolean;
  // The ids of the rows start with this, so they are unique on the page.
  idPrefix: string;
  options: readonly Option[];
  active: number | null;
  selection: "single" | "multiple";
  isChosen: (option: Option) => boolean;
  onPick: (option: Option) => void;
  empty: string;
};

// The list that opens under a text control: one row per option, a mark
// on the chosen ones, a button that opens an option's help when it has
// one, and `empty` when there is no option to show.
export const OptionPanel = ({
  panel,
  open,
  idPrefix,
  options,
  active,
  selection,
  isChosen,
  onPick,
  empty,
}: OptionPanelProps) => (
  <FloatingNode id={panel.nodeId}>
    <FloatingPortal>
      <MotionConfig reducedMotion="user">
        <AnimatePresence>
          {open ? (
            <div
              ref={panel.setPanel}
              style={panel.panelStyles}
              className="z-30"
              aria-multiselectable={
                selection === "multiple" ? true : undefined
              }
              {...panel.getPanelProps({
                // Keeps the focus in the control while a row is pressed.
                onMouseDown: (event: MouseEvent) =>
                  event.preventDefault(),
              })}
            >
              <motion.div
                className={optionList()}
                style={{ transformOrigin: "top left" }}
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{
                  type: "spring",
                  bounce: 0.2,
                  duration: 0.25,
                }}
              >
                {options.length === 0 ? (
                  <p className="px-3 control-py-2 opacity-70">
                    {empty}
                  </p>
                ) : (
                  options.map((option, index) => (
                    <div
                      key={option.value}
                      ref={(row) => {
                        panel.rows.current[index] = row;
                      }}
                      role="option"
                      id={`${idPrefix}-option-${option.value}`}
                      aria-selected={
                        selection === "multiple"
                          ? isChosen(option)
                          : index === active
                      }
                      className={optionRow({
                        active: index === active ? "yes" : "no",
                      })}
                      {...panel.getRowProps({
                        onClick: () => onPick(option),
                      })}
                    >
                      {option.content ?? option.label}
                      <span className="flex shrink-0 items-center gap-2">
                        {isChosen(option) ? (
                          <Icon icon={CheckIcon} tone="accent" />
                        ) : null}
                        {option.help === undefined ? null : (
                          // A press on the help button opens the help and
                          // goes no further, so it does not choose the row.
                          <span
                            className="inline-flex"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Popover
                              direction="right"
                              trigger={
                                <IconButton
                                  icon={HelpIcon}
                                  label={`${option.label}の説明を見る`}
                                  labelSide="top"
                                  size="xs"
                                />
                              }
                            >
                              <div className="max-w-xs rounded-container border border-edge bg-surface-raised container-p-3 text-sm shadow-float">
                                {option.help}
                              </div>
                            </Popover>
                          </span>
                        )}
                      </span>
                    </div>
                  ))
                )}
              </motion.div>
            </div>
          ) : null}
        </AnimatePresence>
      </MotionConfig>
    </FloatingPortal>
  </FloatingNode>
);
