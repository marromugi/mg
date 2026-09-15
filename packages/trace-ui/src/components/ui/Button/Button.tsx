import type { ReactNode } from "react";
import { tv } from "tailwind-variants";

const button = tv({
  base: "inline-flex items-center justify-center gap-2 rounded-md border font-sans font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
  variants: {
    tone: {
      primary:
        "border-accent bg-accent text-on-accent shadow-sm hover:-translate-y-0.5 hover:bg-accent/90 hover:shadow-md active:translate-y-0 active:scale-95 active:bg-accent/80 active:shadow-none",
      neutral:
        "border-edge bg-transparent text-current hover:bg-edge active:scale-95 active:bg-edge/80",
    },
    size: {
      sm: "h-9 px-4 text-sm",
      md: "h-11 px-6 text-base",
    },
    disabled: {
      true: "pointer-events-none opacity-50",
      false: "",
    },
  },
  defaultVariants: { tone: "neutral", size: "md", disabled: false },
});

type ButtonProps = {
  tone?: "primary" | "neutral";
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
