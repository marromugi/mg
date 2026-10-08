import { useState, type ChangeEvent, type KeyboardEvent } from "react";
import {
  Field,
  control,
  useDescribedBy,
  type FieldProps,
} from "../Field/index.js";
import { Nested } from "../Floating/index.js";
import { ChevronDownIcon, Icon } from "../Icon/index.js";
import {
  OptionPanel,
  useMatches,
  useOptionPanel,
  type Option,
} from "../Options/index.js";
import { Tooltip } from "../Tooltip/index.js";
import { useSummary, useToggled } from "./hooks/useSummary.js";

// The control's text is one step smaller than a text field's at the
// largest size, on the same line height, so the two stay the same height.
const TEXT = { sm: "", md: "", lg: "text-sm leading-6" } as const;

// Whoever passes `value` holds the choices, so it must also take the
// changes. Without `value` the combobox holds the choices itself.
type Choices =
  | {
      value: readonly string[];
      onChange: (value: string[]) => void;
      defaultValue?: undefined;
    }
  | {
      value?: undefined;
      onChange?: (value: string[]) => void;
      defaultValue?: readonly string[];
    };

type MultiComboboxProps = FieldProps & {
  options: readonly Option[];
  placeholder?: string;
  empty?: string;
} & Choices;

// Any number of choices out of `options`, found by typing part of a
// name. Choosing a row adds it, choosing it again removes it, and the
// list stays open. While the list is closed the control names a single
// choice, or says how many are chosen with a tooltip that names them. The form submits each chosen
// value under `name`.
const MultiComboboxBody = ({
  name,
  label,
  layout,
  required,
  hint,
  error,
  size = "lg",
  options,
  placeholder = "入力して探す",
  empty = "見つかりません",
  value: givenValue,
  onChange,
  defaultValue,
}: MultiComboboxProps) => {
  const [ownValue, setOwnValue] = useState<readonly string[]>(
    defaultValue ?? [],
  );
  const value = givenValue ?? ownValue;
  const choose = (next: string[]) => {
    if (givenValue === undefined) setOwnValue(next);
    onChange?.(next);
  };
  const summary = useSummary(options, value);
  // What the control shows while its list is closed.
  const resting =
    summary.kind === "none"
      ? ""
      : summary.kind === "one"
        ? summary.name
        : summary.count;

  const [typed, setTyped] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const matches = useMatches(options, typed);

  const close = () => {
    setOpen(false);
    setTyped("");
    setActive(null);
  };
  const panel = useOptionPanel({
    open,
    onOpenChange: (next) => (next ? setOpen(true) : close()),
    active,
    onNavigate: setActive,
  });
  const pick = (option: Option) => {
    choose(useToggled(value, option.value));
    setTyped("");
  };

  return (
    <Field
      name={name}
      label={label}
      layout={layout}
      required={required}
      hint={hint}
      error={error}
    >
      {value.map((each) => (
        <input key={each} type="hidden" name={name} value={each} />
      ))}
      <Tooltip
        label={!open && summary.kind === "several" ? summary.names : ""}
        direction="top"
      >
        <div
          className="group/combobox relative w-full"
          data-open={open ? "" : undefined}
        >
          <input
            ref={panel.setControl}
            id={name}
            value={open ? typed : resting}
            placeholder={placeholder}
            autoComplete="off"
            aria-autocomplete="list"
            aria-required={required}
            aria-invalid={error === undefined ? undefined : true}
            aria-describedby={useDescribedBy(name, { hint, error })}
            className={control({
              size,
              state: error === undefined ? "default" : "error",
              className: `pr-10 ${TEXT[size]}`,
            })}
            {...panel.getControlProps({
              onChange: (event: ChangeEvent<HTMLInputElement>) => {
                setTyped(event.target.value);
                setActive(0);
                setOpen(true);
              },
              onClick: () => setOpen(true),
              onKeyDown: (event: KeyboardEvent) => {
                const option =
                  active === null ? undefined : matches[active];
                if (
                  event.key === "Enter" &&
                  open &&
                  option !== undefined
                ) {
                  event.preventDefault();
                  pick(option);
                }
              },
            })}
          />
          <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
            <Icon
              icon={ChevronDownIcon}
              className="transition duration-160 ease-out group-data-open/combobox:rotate-180"
            />
          </span>
        </div>
      </Tooltip>
      <OptionPanel
        panel={panel}
        open={open}
        idPrefix={name}
        options={matches}
        active={active}
        selection="multiple"
        isChosen={(option) => value.includes(option.value)}
        onPick={pick}
        empty={empty}
      />
    </Field>
  );
};

export const MultiCombobox = (props: MultiComboboxProps) => (
  <Nested>
    <MultiComboboxBody {...props} />
  </Nested>
);
