import { useState, type ReactNode } from "react";
import type { ButtonElementProps } from "../Button/index.js";
import {
  Field,
  control,
  useDescribedBy,
  type FieldProps,
} from "../Field/index.js";
import { CheckIcon, ChevronDownIcon, Icon } from "../Icon/index.js";
import { Popover } from "../Popover/index.js";
import { useChosen, type Option } from "./hooks/useChosen.js";

// The control's text is one step smaller than a text field's at the
// largest size, on the same line height, so the two stay the same height.
const TEXT = { sm: "", md: "", lg: "text-sm leading-6" } as const;

// Whoever passes `value` holds the choice, so it must also take the
// changes. Without `value` the select holds the choice itself.
type Choice =
  | {
      value: string;
      onChange: (value: string) => void;
      defaultValue?: undefined;
    }
  | {
      value?: undefined;
      onChange?: (value: string) => void;
      defaultValue?: string;
    };

type SelectProps = FieldProps & {
  options: readonly Option[];
  placeholder?: string;
} & Choice;

// One choice out of `options`. With a mouse it opens its own list beside
// the control; on a touch device it is the browser's own select, so the
// list is the one the device gives. The browser's select is always the
// control the form submits.
export const Select = ({
  name,
  label,
  hint,
  error,
  size = "lg",
  options,
  placeholder = "選んでください",
  value: givenValue,
  onChange,
  defaultValue,
}: SelectProps) => {
  const [ownValue, setOwnValue] = useState(defaultValue);
  const [open, setOpen] = useState(false);
  const value = givenValue ?? ownValue;
  const choose = (next: string) => {
    if (givenValue === undefined) setOwnValue(next);
    onChange?.(next);
  };
  const chosen = useChosen(options, value);
  const describedBy = useDescribedBy(name, { hint, error });
  const state = error === undefined ? "default" : "error";

  return (
    <Field name={name} label={label} hint={hint} error={error}>
      <div className="relative pointer-fine:hidden">
        <select
          id={name}
          name={name}
          value={value ?? ""}
          onChange={(event) => choose(event.target.value)}
          aria-invalid={error === undefined ? undefined : true}
          aria-describedby={describedBy}
          className={control({
            size,
            state,
            className: `appearance-none ${TEXT[size]}`,
          })}
        >
          <option value="" disabled>
            {placeholder}
          </option>
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
          <Icon icon={ChevronDownIcon} />
        </span>
      </div>
      <div className="hidden pointer-fine:block">
        <Popover
          open={open}
          onOpenChange={setOpen}
          width="trigger"
          offset={4}
          trigger={
            <Opener
              look={control({
                size,
                state,
                className: `group flex cursor-pointer items-center justify-between gap-3 text-left ${TEXT[size]}`,
              })}
              aria-labelledby={`${name}-label`}
              aria-invalid={error === undefined ? undefined : true}
              aria-describedby={describedBy}
            >
              {chosen.kind === "chosen" ? (
                (chosen.option.content ?? chosen.option.label)
              ) : (
                <span className="opacity-50">{placeholder}</span>
              )}
            </Opener>
          }
        >
          <ul className="flex flex-col rounded-container border border-edge bg-surface-raised container-p-1 text-sm around-control-py-2">
            {options.map((option) => (
              <li key={option.value}>
                <button
                  type="button"
                  aria-pressed={option.value === value}
                  onClick={() => {
                    choose(option.value);
                    setOpen(false);
                  }}
                  className="flex w-full cursor-pointer items-center justify-between gap-3 rounded-control px-3 control-py-2 text-left transition duration-160 ease-out outline-none hover:bg-edge focus-visible:bg-edge"
                >
                  {option.content ?? option.label}
                  {option.value === value ? (
                    <Icon icon={CheckIcon} tone="accent" />
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        </Popover>
      </div>
    </Field>
  );
};

// The control that opens the list: it looks like the other controls of a
// Field and passes what the popover hands it on to its button.
const Opener = ({
  look,
  children,
  ...rest
}: ButtonElementProps & {
  look: string;
  children: ReactNode;
}) => (
  <button type="button" {...rest} className={look}>
    {children}
    <Icon
      icon={ChevronDownIcon}
      className="transition duration-160 ease-out group-aria-expanded:rotate-180"
    />
  </button>
);
