import { tv } from "tailwind-variants";
import { useDescribedBy } from "./hooks/useDescribedBy.js";

const input = tv({
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

// A password field takes no value: it is always drawn empty.
type TextFieldProps = {
  name: string;
  label: string;
  hint?: string;
  error?: string;
  placeholder?: string;
  size?: "sm" | "md" | "lg";
} & (
  | { type?: "text" | "number"; value?: string }
  | { type: "password"; value?: undefined }
);

export const TextField = ({
  name,
  label,
  hint,
  error,
  placeholder,
  size,
  value,
  type,
}: TextFieldProps) => (
  <div className="flex flex-col gap-2">
    <label htmlFor={name} className="text-sm font-semibold">
      {label}
    </label>
    {hint === undefined ? null : (
      <p id={`${name}-hint`} className="text-xs opacity-70">
        {hint}
      </p>
    )}
    <input
      id={name}
      name={name}
      type={type ?? "text"}
      defaultValue={value}
      placeholder={placeholder}
      autoComplete={type === "password" ? "new-password" : undefined}
      aria-invalid={error === undefined ? undefined : true}
      aria-describedby={useDescribedBy(name, { hint, error })}
      className={input({
        size,
        state: error === undefined ? "default" : "error",
      })}
    />
    {error === undefined ? null : (
      <p id={`${name}-error`} className="text-xs text-error">
        {error}
      </p>
    )}
  </div>
);
