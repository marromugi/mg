import { tv } from "tailwind-variants";

const input = tv({
  base: "block w-full rounded-control border border-edge bg-transparent px-3.5 control-py-3 font-sans text-base shadow-none transition duration-160 ease-out outline-none placeholder:opacity-50 focus-visible:border-accent focus-visible:shadow-ring disabled:cursor-not-allowed disabled:opacity-50 [&::-webkit-search-cancel-button]:transition-opacity [&::-webkit-search-cancel-button]:duration-150 [&::-webkit-search-cancel-button]:ease-out [&::-webkit-search-cancel-button]:will-change-opacity",
  variants: {
    invalid: {
      true: "border-error focus-visible:border-error focus-visible:shadow-ring-error",
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
