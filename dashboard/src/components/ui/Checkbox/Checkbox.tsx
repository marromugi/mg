import { useLayoutEffect, useRef } from "react";
import { tv } from "tailwind-variants";
import { CheckIcon, Icon, MinusIcon } from "../Icon/index.js";

const frame = tv({
  base: "group/checkbox flex cursor-pointer items-center",
  variants: {
    layout: { labelled: "py-1", bare: "" },
    size: { sm: "gap-2 text-sm", md: "gap-3" },
  },
  defaultVariants: { layout: "labelled", size: "md" },
});

const box = tv({
  base: "peer col-start-1 row-start-1 cursor-pointer appearance-none rounded-control border border-edge control-py-0 transition duration-160 ease-out group-hover/checkbox:bg-edge checked:border-on-accent/30 checked:bg-accent checked:group-hover/checkbox:bg-accent/80 indeterminate:border-on-accent/30 indeterminate:bg-accent indeterminate:group-hover/checkbox:bg-accent/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-97",
  variants: {
    size: { sm: "size-4 leading-4", md: "size-5 leading-5" },
  },
  defaultVariants: { size: "md" },
});

const text = tv({
  variants: {
    layout: {
      labelled:
        "transition duration-160 ease-out group-hover/checkbox:opacity-70",
      bare: "sr-only",
    },
  },
  defaultVariants: { layout: "labelled" },
});

// Whoever passes `checked` holds the state, so it must also take the
// changes. Without `checked` the box holds the state itself.
type Checked =
  | {
      checked: boolean;
      onChange: (checked: boolean) => void;
      defaultChecked?: undefined;
    }
  | {
      checked?: undefined;
      onChange?: (checked: boolean) => void;
      defaultChecked?: boolean;
    };

type CheckboxProps = {
  label: string;
  layout?: "labelled" | "bare";
  size?: "sm" | "md";
  indeterminate?: boolean;
  name?: string;
  value?: string;
} & Checked;

// The box is the input itself, drawn without the browser's own look; a
// mark sits over it while the input is checked. `indeterminate` is the
// state of a box that stands for several others, some checked and some
// not. With
// the layout "bare" the label is read out but not shown.
export const Checkbox = ({
  label,
  layout,
  size,
  indeterminate = false,
  name,
  value,
  checked,
  onChange,
  defaultChecked,
}: CheckboxProps) => {
  const ref = useRef<HTMLInputElement>(null);
  useLayoutEffect(() => {
    if (ref.current !== null) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <label className={frame({ layout, size })}>
      <span className="grid shrink-0 place-items-center">
        <input
          ref={ref}
          type="checkbox"
          name={name}
          value={value}
          checked={checked}
          defaultChecked={defaultChecked}
          onChange={
            onChange === undefined
              ? undefined
              : (event) => onChange(event.target.checked)
          }
          className={box({ size })}
        />
        <Icon
          icon={CheckIcon}
          size="sm"
          className="pointer-events-none invisible relative col-start-1 row-start-1 text-on-accent peer-checked:visible peer-indeterminate:invisible"
        />
        <Icon
          icon={MinusIcon}
          size="sm"
          className="pointer-events-none invisible relative col-start-1 row-start-1 text-on-accent peer-indeterminate:visible"
        />
      </span>
      <span className={text({ layout })}>{label}</span>
    </label>
  );
};
