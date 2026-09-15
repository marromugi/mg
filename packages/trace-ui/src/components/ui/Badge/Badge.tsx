import type { ReactNode } from "react";
import { tv } from "tailwind-variants";

const badge = tv({
  variants: {
    tone: {
      error: "font-semibold text-error",
    },
  },
});

export const Badge = ({
  tone,
  children,
}: {
  tone: "error";
  children: ReactNode;
}) => <div className={badge({ tone })}>{children}</div>;
