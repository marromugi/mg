import {
  Field,
  control,
  useDescribedBy,
  type FieldProps,
} from "../Field/index.js";

type TextAreaProps = FieldProps & { value?: string };

export const TextArea = ({
  name,
  label,
  hint,
  error,
  value,
}: TextAreaProps) => (
  <Field name={name} label={label} hint={hint} error={error}>
    <textarea
      id={name}
      name={name}
      rows={3}
      defaultValue={value}
      aria-invalid={error === undefined ? undefined : true}
      aria-describedby={useDescribedBy(name, { hint, error })}
      className={control({
        state: error === undefined ? "default" : "error",
      })}
    />
  </Field>
);
