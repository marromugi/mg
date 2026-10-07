import type { JSX, ReactNode, SVGProps } from "react";
import { tv } from "tailwind-variants";

const button = tv({
  base: "inline-flex cursor-pointer items-center rounded-control font-semibold transition duration-160 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:scale-97",
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

const iconStyle = tv({
  base: "shrink-0",
  variants: {
    size: { sm: "size-3", md: "size-4", lg: "size-4" },
  },
  defaultVariants: { size: "lg" },
});

type ButtonProps = {
  tone?: "primary" | "neutral" | "danger";
  size?: "sm" | "md" | "lg";
  icon?: (props: SVGProps<SVGSVGElement>) => JSX.Element;
  iconSide?: "left" | "right";
  children: ReactNode;
} & (
  | { href: string; name?: undefined; value?: undefined }
  | { href?: undefined; name?: string; value?: string }
);

// A link when it has an href, otherwise a button that submits its form.
// The icon is decorative, so screen readers skip it.
export const Button = ({
  tone,
  size,
  icon: Icon,
  iconSide = "left",
  href,
  name,
  value,
  children,
}: ButtonProps) => {
  const content = (
    <>
      {Icon !== undefined && iconSide === "left" ? (
        <Icon aria-hidden className={iconStyle({ size })} />
      ) : null}
      {children}
      {Icon !== undefined && iconSide === "right" ? (
        <Icon aria-hidden className={iconStyle({ size })} />
      ) : null}
    </>
  );
  return href === undefined ? (
    <button
      type="submit"
      name={name}
      value={value}
      className={button({ tone, size })}
    >
      {content}
    </button>
  ) : (
    <a href={href} className={button({ tone, size })}>
      {content}
    </a>
  );
};
