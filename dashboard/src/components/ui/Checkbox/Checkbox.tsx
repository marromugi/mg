import { Icon } from "../Icon/index.js";
import { CheckIcon } from "./CheckIcon.js";

type CheckboxProps = {
  name: string;
  value: string;
  label: string;
  checked?: boolean;
};

// The box is the input itself, drawn without the browser's own look; the
// mark sits over it and shows only while the input is checked.
export const Checkbox = ({
  name,
  value,
  label,
  checked,
}: CheckboxProps) => (
  <label className="group flex cursor-pointer items-center gap-3 py-1">
    <span className="grid shrink-0 place-items-center">
      <input
        type="checkbox"
        name={name}
        value={value}
        defaultChecked={checked}
        className="peer col-start-1 row-start-1 size-5 cursor-pointer appearance-none rounded-control border border-edge control-py-0 leading-5 transition duration-160 ease-out group-hover:bg-edge checked:border-on-accent/30 checked:bg-accent checked:group-hover:bg-accent/80 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-97"
      />
      <Icon
        icon={CheckIcon}
        size="sm"
        className="pointer-events-none invisible relative col-start-1 row-start-1 text-on-accent peer-checked:visible"
      />
    </span>
    <span className="transition duration-160 ease-out group-hover:opacity-70">
      {label}
    </span>
  </label>
);
