import type { ComponentProps, ReactNode } from "react";
import { tv } from "tailwind-variants";
import { Icon, type IconSource } from "../Icon/index.js";

const button = tv({
  base: "inline-flex cursor-pointer items-center rounded-control font-semibold transition duration-160 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-97 disabled:pointer-events-none disabled:opacity-50",
  variants: {
    size: {
      sm: "gap-1 px-2 control-py-1 text-xs",
      md: "gap-2 px-3 control-py-1 text-sm",
      lg: "gap-2 px-4 control-py-2 text-sm",
    },
    tone: {
      primary:
        "border border-on-accent/30 bg-accent text-on-accent hover:brightness-110",
      neutral: "border border-edge hover:bg-edge",
      danger:
        "border border-on-accent/30 bg-error text-on-accent hover:brightness-110",
    },
  },
  defaultVariants: { tone: "neutral", size: "lg" },
});

const ICON_SIZE = { sm: "sm", md: "md", lg: "md" } as const;

type ButtonProps = {
  tone?: "primary" | "neutral" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: IconSource;
  iconSide?: "left" | "right";
  children: ReactNode;
} & ({ href: string } | ({ href?: undefined } & ButtonElementProps));

// What the button element takes besides what Button itself decides.
// `type` is "submit" unless given; another part that opens on this
// button passes its handlers, ref, and state through here.
export type ButtonElementProps = Omit<
  ComponentProps<"button">,
  "className" | "style" | "children"
>;

// A link when it has an href, otherwise a button, which submits its form
// unless told otherwise.
export const Button = ({
  tone,
  size = "lg",
  icon,
  iconSide = "left",
  children,
  ...rest
}: ButtonProps) => {
  const mark =
    icon === undefined ? null : (
      <Icon icon={icon} size={ICON_SIZE[size]} />
    );
  const content = (
    <>
      {iconSide === "left" ? mark : null}
      {children}
      {iconSide === "right" ? mark : null}
    </>
  );
  return rest.href === undefined ? (
    <button type="submit" {...rest} className={button({ tone, size })}>
      {content}
    </button>
  ) : (
    <a href={rest.href} className={button({ tone, size })}>
      {content}
    </a>
  );
};
