import type { ReactNode } from "react";
import { tv } from "tailwind-variants";

const button = tv({
  base: "inline-flex cursor-pointer items-center justify-center gap-2 rounded-control border font-sans font-semibold transition duration-160 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent active:duration-200 active:ease-bounce",
  variants: {
    tone: {
      primary:
        "border-accent bg-accent text-on-accent shadow-sm hover:bg-accent/90 hover:shadow-md active:scale-102 active:bg-accent/80 active:shadow-none",
      secondary:
        "border-transparent bg-accent/15 text-accent-text hover:bg-accent/25 active:scale-102 active:bg-accent/30",
      neutral:
        "border-edge bg-transparent text-current hover:bg-edge active:scale-102 active:bg-edge/80",
    },
    size: {
      sm: "px-4 control-py-2 text-sm",
      md: "px-6 control-py-3 text-base",
    },
    disabled: {
      true: "pointer-events-none opacity-50",
      false: "",
    },
  },
  defaultVariants: { tone: "neutral", size: "md", disabled: false },
});

type ButtonProps = {
  tone?: "primary" | "secondary" | "neutral";
  size?: "sm" | "md";
  type?: "submit" | "button";
  href?: string;
  disabled?: boolean;
  children: ReactNode;
};

export const Button = ({
  tone,
  size,
  type = "submit",
  href,
  disabled,
  children,
}: ButtonProps) => {
  const className = button({ tone, size, disabled });

  if (href !== undefined) {
    return (
      <a
        className={className}
        href={disabled ? undefined : href}
        aria-disabled={disabled ? "true" : undefined}
      >
        {children}
      </a>
    );
  }

  return (
    <button className={className} type={type} disabled={disabled}>
      {children}
    </button>
  );
};
