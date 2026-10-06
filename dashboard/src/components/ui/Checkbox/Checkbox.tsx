type CheckboxProps = {
  name: string;
  value: string;
  label: string;
  checked?: boolean;
};

export const Checkbox = ({
  name,
  value,
  label,
  checked,
}: CheckboxProps) => (
  <label className="flex items-center gap-2">
    <input
      type="checkbox"
      name={name}
      value={value}
      defaultChecked={checked}
      className="accent-accent"
    />
    {label}
  </label>
);
