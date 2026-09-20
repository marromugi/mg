import type { ReactNode } from "react";
import { tv } from "tailwind-variants";

const badge = tv({
  base: "font-semibold",
  variants: {
    tone: {
      default: "",
      error: "text-error",
    },
  },
  defaultVariants: { tone: "default" },
});

export const Badge = ({
  tone,
  children,
}: {
  tone?: "default" | "error";
  children: ReactNode;
}) => <div className={badge({ tone })}>{children}</div>;
