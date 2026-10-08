import {
  Field,
  control,
  useDescribedBy,
  type ControlProps,
  type FieldProps,
} from "../Field/index.js";

// A password field takes no value: it is always drawn empty.
type TextFieldProps = FieldProps &
  ControlProps<"input"> & { placeholder?: string } & (
    | { type?: "text" | "number"; value?: string }
    | { type: "password"; value?: undefined }
  );

export const TextField = ({
  name,
  label,
  layout,
  required,
  hint,
  error,
  placeholder,
  size,
  value,
  type,
  ...rest
}: TextFieldProps) => (
  <Field
    name={name}
    label={label}
    layout={layout}
    required={required}
    hint={hint}
    error={error}
  >
    <input
      {...rest}
      id={name}
      name={name}
      type={type ?? "text"}
      defaultValue={value}
      placeholder={placeholder}
      autoComplete={type === "password" ? "new-password" : undefined}
      aria-required={required}
      aria-invalid={error === undefined ? undefined : true}
      aria-describedby={useDescribedBy(name, { hint, error })}
      className={control({
        size,
        state: error === undefined ? "default" : "error",
      })}
    />
  </Field>
);
