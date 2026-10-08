import type { ComponentProps, ReactNode } from "react";
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

// What a control inside a Field takes besides what the Field decides:
// its handlers and ref, as a form library hands them over.
export type ControlProps<Element extends "input" | "textarea"> = Pick<
  ComponentProps<Element>,
  "ref" | "onChange" | "onBlur" | "onKeyDown" | "disabled" | "autoFocus"
>;

const frame = tv({
  base: "flex flex-col",
  variants: { layout: { labelled: "gap-2", bare: "gap-1" } },
  defaultVariants: { layout: "labelled" },
});

const caption = tv({
  variants: {
    layout: { labelled: "text-sm font-semibold", bare: "sr-only" },
  },
  defaultVariants: { layout: "labelled" },
});

export type FieldProps = {
  name: string;
  label: string;
  layout?: "labelled" | "bare";
  required?: boolean;
  hint?: string;
  error?: string;
  size?: "sm" | "md" | "lg";
};

// The label, hint, and error around one control. The control is found
// by the label through the id `name`; the label, hint, and error carry
// the ids `<name>-label`, `<name>-hint`, and `<name>-error`. With the
// layout "bare" the label is read out but not shown. A `required` field
// shows a badge beside its label; the control inside says so to screen
// readers itself.
export const Field = ({
  name,
  label,
  layout,
  required = false,
  hint,
  error,
  children,
}: Omit<FieldProps, "size"> & { children: ReactNode }) => (
  <div className={frame({ layout })}>
    <div className="flex items-center gap-2">
      <label
        id={`${name}-label`}
        htmlFor={name}
        className={caption({ layout })}
      >
        {label}
      </label>
      {required && layout !== "bare" ? (
        <span
          aria-hidden
          className="rounded-control bg-error-fill px-2 control-py-0 text-xs text-on-accent"
        >
          必須
        </span>
      ) : null}
    </div>
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
