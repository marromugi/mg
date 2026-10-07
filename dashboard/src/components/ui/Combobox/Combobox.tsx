import { useState, type ChangeEvent, type KeyboardEvent } from "react";
import {
  Field,
  control,
  useDescribedBy,
  type FieldProps,
} from "../Field/index.js";
import { ChevronDownIcon, Icon } from "../Icon/index.js";
import {
  OptionPanel,
  useMatches,
  useOptionPanel,
  type Option,
} from "../Options/index.js";

// The control's text is one step smaller than a text field's at the
// largest size, on the same line height, so the two stay the same height.
const TEXT = { sm: "", md: "", lg: "text-sm leading-6" } as const;

// Whoever passes `value` holds the choice, so it must also take the
// changes. Without `value` the combobox holds the choice itself. No
// choice is null.
type Choice =
  | {
      value: string | null;
      onChange: (value: string | null) => void;
      defaultValue?: undefined;
    }
  | {
      value?: undefined;
      onChange?: (value: string | null) => void;
      defaultValue?: string;
    };

type ComboboxProps = FieldProps & {
  options: readonly Option[];
  placeholder?: string;
  empty?: string;
} & Choice;

// One choice out of `options`, found by typing part of its name. The
// list under the control narrows as the text changes; the arrow keys
// move through it, Enter chooses, and Escape closes it. Only an option
// can be the value: text that was typed but not chosen is dropped when
// the control is left, and clearing the text clears the choice. The
// form submits the chosen option's value under `name`.
export const Combobox = ({
  name,
  label,
  hint,
  error,
  size = "lg",
  options,
  placeholder = "入力して探す",
  empty = "見つかりません",
  value: givenValue,
  onChange,
  defaultValue,
}: ComboboxProps) => {
  const [ownValue, setOwnValue] = useState<string | null>(
    defaultValue ?? null,
  );
  const value = givenValue === undefined ? ownValue : givenValue;
  const choose = (next: string | null) => {
    if (givenValue === undefined) setOwnValue(next);
    onChange?.(next);
  };
  const chosen = options.find((option) => option.value === value);

  // What is being typed, or null while the control shows the choice.
  const [typed, setTyped] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState<number | null>(null);
  const matches = useMatches(options, typed ?? "");

  const close = () => {
    setOpen(false);
    setTyped(null);
    setActive(null);
  };
  const panel = useOptionPanel({
    open,
    onOpenChange: (next) => (next ? setOpen(true) : close()),
    active,
    onNavigate: setActive,
  });
  const pick = (option: Option) => {
    choose(option.value);
    close();
  };

  return (
    <Field name={name} label={label} hint={hint} error={error}>
      <input type="hidden" name={name} value={value ?? ""} />
      <div
        className="group/combobox relative"
        data-open={open ? "" : undefined}
      >
        <input
          ref={panel.setControl}
          id={name}
          value={typed ?? chosen?.label ?? ""}
          placeholder={placeholder}
          autoComplete="off"
          aria-autocomplete="list"
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
              if (event.target.value === "") choose(null);
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
            onBlur: () => setTyped(null),
          })}
        />
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center">
          <Icon
            icon={ChevronDownIcon}
            className="transition duration-160 ease-out group-data-open/combobox:rotate-180"
          />
        </span>
      </div>
      <OptionPanel
        panel={panel}
        open={open}
        idPrefix={name}
        options={matches}
        active={active}
        selection="single"
        isChosen={(option) => option.value === value}
        onPick={pick}
        empty={empty}
      />
    </Field>
  );
};
