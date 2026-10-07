import { tv } from "tailwind-variants";
import { Icon, type IconSource } from "../Icon/index.js";
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
  state?: "idle" | "current";
} & (
  | { href: string; name?: undefined; value?: undefined }
  | { href?: undefined; name?: string; value?: string }
);

// A round control that shows only an icon; `label` is its name for
// screen readers and the text of its tooltip. A link when it has an
// href, otherwise a button that submits its form.
export const IconButton = ({
  icon,
  label,
  state,
  href,
  name,
  value,
}: IconButtonProps) => (
  <Tooltip label={label}>
    {href === undefined ? (
      <button
        type="submit"
        name={name}
        value={value}
        aria-label={label}
        className={iconButton({ state })}
      >
        <Icon icon={icon} size="lg" />
      </button>
    ) : (
      <a
        href={href}
        aria-label={label}
        aria-current={state === "current" ? "page" : undefined}
        className={iconButton({ state })}
      >
        <Icon icon={icon} size="lg" />
      </a>
    )}
  </Tooltip>
);
