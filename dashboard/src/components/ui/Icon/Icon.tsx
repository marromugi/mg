import type { JSX, SVGProps } from "react";
import { tv } from "tailwind-variants";

const icon = tv({
  base: "shrink-0",
  variants: {
    size: { sm: "size-3", md: "size-4", lg: "size-5" },
    tone: {
      current: "",
      accent: "text-accent-text",
      error: "text-error",
    },
  },
  defaultVariants: { size: "md", tone: "current" },
});

export type IconSource = (
  props: SVGProps<SVGSVGElement>,
) => JSX.Element;

type IconProps = {
  icon: IconSource;
  size?: "sm" | "md" | "lg";
  tone?: "current" | "accent" | "error";
  className?: string;
};

// Draws the given SVG at a set size and colour. It is decorative, so
// screen readers skip it. Classes in `className` win over the variants.
export const Icon = ({
  icon: Source,
  size,
  tone,
  className,
}: IconProps) => (
  <Source aria-hidden className={icon({ size, tone, className })} />
);
