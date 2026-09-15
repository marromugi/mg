import type { ReactNode } from "react";
import { tv } from "tailwind-variants";

const card = tv({
  base: "my-2.5 rounded-lg border border-edge px-3.5 py-2.5",
  variants: {
    tone: {
      default: "",
      error: "border-error bg-error-bg text-error-fg",
    },
  },
  defaultVariants: { tone: "default" },
});

export const Card = ({
  tone,
  children,
}: {
  tone?: "default" | "error";
  children: ReactNode;
}) => <div className={card({ tone })}>{children}</div>;
