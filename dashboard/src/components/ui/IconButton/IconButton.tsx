import { tv } from "tailwind-variants";
import type { ButtonElementProps } from "../Button/index.js";
import { Icon, type IconSource } from "../Icon/index.js";
import type { Direction } from "../Popover/index.js";
import { Tooltip } from "../Tooltip/index.js";

const iconButton = tv({
  base: "inline-flex size-10 cursor-pointer items-center justify-center rounded-full border border-edge bg-surface-raised transition duration-160 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-97",
  variants: {
    state: {
      idle: "hover:bg-edge",
      current: "text-accent-text shadow-ring",
    },
  },
  defaultVariants: { state: "idle" },
});

type IconButtonProps = {
  icon: IconSource;
  label: string;
  labelSide?: Direction;
  state?: "idle" | "current";
} & (
  | { href: string }
  | ({ href?: undefined } & Omit<ButtonElementProps, "aria-label">)
);

// A round control that shows only an icon; `label` is its name for
// screen readers and the text of its tooltip, which shows on
// `labelSide` of it. A link when it has an
// href, otherwise a button, which submits its form unless told otherwise.
export const IconButton = ({
  icon,
  label,
  labelSide,
  state,
  ...rest
}: IconButtonProps) => (
  <Tooltip label={label} direction={labelSide}>
    {rest.href === undefined ? (
      <button
        type="submit"
        {...rest}
        aria-label={label}
        className={iconButton({ state })}
      >
        <Icon icon={icon} size="lg" />
      </button>
    ) : (
      <a
        href={rest.href}
        aria-label={label}
        aria-current={state === "current" ? "page" : undefined}
        className={iconButton({ state })}
      >
        <Icon icon={icon} size="lg" />
      </a>
    )}
  </Tooltip>
);
