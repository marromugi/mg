import {
  Field,
  control,
  useDescribedBy,
  type FieldProps,
} from "../Field/index.js";

type TextAreaProps = FieldProps & {
  value?: string;
  placeholder?: string;
  rows?: number;
};

// Text over several lines. It starts `rows` lines tall and can be
// dragged taller or shorter, never wider.
export const TextArea = ({
  name,
  label,
  hint,
  error,
  size,
  value,
  placeholder,
  rows = 3,
}: TextAreaProps) => (
  <Field name={name} label={label} hint={hint} error={error}>
    <textarea
      id={name}
      name={name}
      rows={rows}
      defaultValue={value}
      placeholder={placeholder}
      aria-invalid={error === undefined ? undefined : true}
      aria-describedby={useDescribedBy(name, { hint, error })}
      className={control({
        size,
        state: error === undefined ? "default" : "error",
        className: "block resize-y",
      })}
    />
  </Field>
);
