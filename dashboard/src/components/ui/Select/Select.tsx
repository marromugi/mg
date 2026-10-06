import {
  Field,
  control,
  useDescribedBy,
  type FieldProps,
} from "../Field/index.js";

type SelectProps = FieldProps & {
  options: readonly { value: string; label: string }[];
  value?: string;
};

export const Select = ({
  name,
  label,
  hint,
  error,
  options,
  value,
}: SelectProps) => (
  <Field name={name} label={label} hint={hint} error={error}>
    <select
      id={name}
      name={name}
      defaultValue={value}
      aria-invalid={error === undefined ? undefined : true}
      aria-describedby={useDescribedBy(name, { hint, error })}
      className={control({
        state: error === undefined ? "default" : "error",
      })}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  </Field>
);
