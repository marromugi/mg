import {
  Field,
  control,
  useDescribedBy,
  type FieldProps,
} from "../Field/index.js";

type TextFieldProps = FieldProps & {
  value?: string;
  type?: "text" | "number";
};

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
      aria-invalid={error === undefined ? undefined : true}
      aria-describedby={useDescribedBy(name, { hint, error })}
      className={control({
        state: error === undefined ? "default" : "error",
      })}
    />
  </Field>
);
