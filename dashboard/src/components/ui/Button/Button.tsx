import type { ReactNode } from "react";
import { tv } from "tailwind-variants";

const button = tv({
  base: "inline-block cursor-pointer rounded-control px-4 control-py-2 font-semibold transition duration-160 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
  variants: {
    tone: {
      primary: "bg-accent text-on-accent",
      neutral: "border border-edge hover:bg-edge",
      danger: "bg-error text-on-accent",
    },
  },
  defaultVariants: { tone: "neutral" },
});

type ButtonProps = {
  tone?: "primary" | "neutral" | "danger";
  children: ReactNode;
} & (
  | { href: string; name?: undefined; value?: undefined }
  | { href?: undefined; name?: string; value?: string }
);

// A link when it has an href, otherwise a button that submits its form.
export const Button = ({
  tone,
  href,
  name,
  value,
  children,
}: ButtonProps) =>
  href === undefined ? (
    <button
      type="submit"
      name={name}
      value={value}
      className={button({ tone })}
    >
      {children}
    </button>
  ) : (
    <a href={href} className={button({ tone })}>
      {children}
    </a>
  );
