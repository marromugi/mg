import { useLayoutEffect, useRef } from "react";
import {
  Field,
  control,
  useDescribedBy,
  type FieldProps,
} from "../Field/index.js";
import { useFittedHeight } from "./hooks/useFittedHeight.js";

// With `height` "content" the box follows its text, so only then is
// there a most it may grow to.
type Height =
  | { height?: "fixed"; maxRows?: undefined }
  | { height: "content"; maxRows?: number };

type TextAreaProps = FieldProps & {
  value?: string;
  placeholder?: string;
  rows?: number;
} & Height;

// Text over several lines, at least `rows` lines tall. With `height`
// "fixed" it can be dragged taller or shorter, never wider. With
// "content" it grows and shrinks with its text up to `maxRows` lines,
// then scrolls.
export const TextArea = ({
  name,
  label,
  hint,
  error,
  size,
  value,
  placeholder,
  rows = 3,
  height = "fixed",
  maxRows = 12,
}: TextAreaProps) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  const fit = () => {
    const area = ref.current;
    if (area === null || height !== "content") return;
    area.style.height = "auto";
    const style = getComputedStyle(area);
    const fitted = useFittedHeight(
      {
        content: area.scrollHeight,
        line: parseFloat(style.lineHeight),
        padding:
          parseFloat(style.paddingTop) +
          parseFloat(style.paddingBottom),
        borders: area.offsetHeight - area.clientHeight,
      },
      maxRows,
    );
    area.style.height = `${fitted.height}px`;
    area.style.overflowY = fitted.scrolls ? "auto" : "hidden";
  };
  useLayoutEffect(fit);

  return (
    <Field name={name} label={label} hint={hint} error={error}>
      <textarea
        ref={ref}
        id={name}
        name={name}
        rows={rows}
        defaultValue={value}
        placeholder={placeholder}
        onInput={fit}
        aria-invalid={error === undefined ? undefined : true}
        aria-describedby={useDescribedBy(name, { hint, error })}
        className={control({
          size,
          state: error === undefined ? "default" : "error",
          className:
            height === "content"
              ? "block resize-none"
              : "block resize-y",
        })}
      />
    </Field>
  );
};
