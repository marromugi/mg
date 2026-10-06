import type { ReactNode } from "react";
import { tv } from "tailwind-variants";

// The look shared by the controls that sit inside a Field.
export const control = tv({
  base: "w-full rounded-control border px-3 control-py-2 transition duration-160 ease-out outline-none",
  variants: {
    state: {
      default: "border-edge focus-visible:shadow-ring",
      error: "border-error focus-visible:shadow-ring-error",
    },
  },
  defaultVariants: { state: "default" },
});

export type FieldProps = {
  name: string;
  label: string;
  hint?: string;
  error?: string;
};

export const Field = ({
  name,
  label,
  hint,
  error,
  children,
}: FieldProps & { children: ReactNode }) => (
  <div className="flex flex-col gap-1">
    <label htmlFor={name} className="font-semibold">
      {label}
    </label>
    {hint === undefined ? null : (
      <p id={`${name}-hint`} className="text-meta">
        {hint}
      </p>
    )}
    {children}
    {error === undefined ? null : (
      <p id={`${name}-error`} className="text-meta text-error">
        {error}
      </p>
    )}
  </div>
);
