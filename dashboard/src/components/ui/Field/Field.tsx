import type { ReactNode } from "react";
import { tv } from "tailwind-variants";

// The look shared by the controls that sit inside a Field.
export const control = tv({
  base: "w-full rounded-control border bg-surface-raised transition duration-160 ease-out outline-none placeholder:opacity-50 hover:bg-surface focus:bg-surface-raised",
  variants: {
    size: {
      sm: "px-3 control-py-1 text-sm",
      md: "px-3 control-py-2 text-sm",
      lg: "px-4 control-py-2 text-base",
    },
    state: {
      default: "border-edge focus-visible:border-accent",
      error: "border-error",
    },
  },
  defaultVariants: { size: "lg", state: "default" },
});

export type FieldProps = {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  size?: "sm" | "md" | "lg";
};

// The label, hint, and error around one control. The control is found
// by the label through the id `name`; the label, hint, and error carry
// the ids `<name>-label`, `<name>-hint`, and `<name>-error`.
export const Field = ({
  name,
  label,
  hint,
  error,
  children,
}: Omit<FieldProps, "size"> & { children: ReactNode }) => (
  <div className="flex flex-col gap-2">
    <label
      id={`${name}-label`}
      htmlFor={name}
      className="text-sm font-semibold"
    >
      {label}
    </label>
    {hint === undefined ? null : (
      <p id={`${name}-hint`} className="text-xs opacity-70">
        {hint}
      </p>
    )}
    {children}
    {error === undefined ? null : (
      <p id={`${name}-error`} className="text-xs text-error">
        {error}
      </p>
    )}
  </div>
);
