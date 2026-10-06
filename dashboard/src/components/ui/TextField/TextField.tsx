import {
  Field,
  control,
  useDescribedBy,
  type FieldProps,
} from "../Field/index.js";

// A password field takes no value: it is always drawn empty.
type TextFieldProps = FieldProps &
  (
    | { type?: "text" | "number"; value?: string }
    | { type: "password"; value?: undefined }
  );

export const TextField = ({
  name,
  label,
  hint,
  error,
  value,
  type,
}: TextFieldProps) => (
  <Field name={name} label={label} hint={hint} error={error}>
    <input
      id={name}
      name={name}
      type={type ?? "text"}
      defaultValue={value}
      autoComplete={type === "password" ? "new-password" : undefined}
      aria-invalid={error === undefined ? undefined : true}
      aria-describedby={useDescribedBy(name, { hint, error })}
      className={control({
        state: error === undefined ? "default" : "error",
      })}
    />
  </Field>
);
