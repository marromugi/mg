import type { ReactNode } from "react";
import { tv } from "tailwind-variants";

const card = tv({
  base: "my-2.5 rounded-container border border-edge container-p-3",
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
