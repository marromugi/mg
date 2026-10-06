import type { ReactNode } from "react";
import { tv } from "tailwind-variants";

const notice = tv({
  base: "rounded-container border container-p-4",
  variants: {
    tone: {
      error: "border-error bg-error-bg text-error-fg",
    },
  },
  defaultVariants: { tone: "error" },
});

export const Notice = ({
  tone,
  children,
}: {
  tone?: "error";
  children: ReactNode;
}) => (
  <div role="alert" className={notice({ tone })}>
    {children}
  </div>
);
