import { tv } from "tailwind-variants";

const input = tv({
  base: "block w-full rounded-md border border-edge bg-transparent px-3.5 py-2 font-sans text-base transition-colors placeholder:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent enabled:hover:bg-edge/15 disabled:cursor-not-allowed disabled:opacity-50",
  variants: {
    invalid: {
      true: "border-error focus-visible:outline-error",
      false: "",
    },
  },
  defaultVariants: { invalid: false },
});

type TextFieldProps = {
  id?: string;
  name: string;
  label: string;
  type?: "text" | "search";
  defaultValue?: string;
  placeholder?: string;
  hint?: string;
  error?: string;
  disabled?: boolean;
};

export const TextField = (props: TextFieldProps) => {
  const {
    name,
    label,
    type = "text",
    defaultValue,
    placeholder,
    hint,
    error,
    disabled,
  } = props;
  const id = props.id ?? `field-${name}`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const describedBy =
    [
      hint !== undefined ? hintId : null,
      error !== undefined ? errorId : null,
    ]
      .filter((value): value is string => value !== null)
      .join(" ") || undefined;

  return (
    <div className="my-2.5">
      <label htmlFor={id} className="mb-1 block text-sm font-semibold">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        disabled={disabled}
        aria-invalid={error !== undefined ? true : undefined}
        aria-describedby={describedBy}
        className={input({ invalid: error !== undefined })}
      />
      {hint !== undefined ? (
        <p id={hintId} className="mt-1 text-meta opacity-70">
          {hint}
        </p>
      ) : null}
      {error !== undefined ? (
        <p id={errorId} className="mt-1 text-meta text-error">
          {error}
        </p>
      ) : null}
    </div>
  );
};
