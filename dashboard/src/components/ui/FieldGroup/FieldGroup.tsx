import type { ReactNode } from "react";

type FieldGroupProps = {
  legend: string;
  hint?: string;
  error?: string;
  children: ReactNode;
};

export const FieldGroup = ({
  legend,
  hint,
  error,
  children,
}: FieldGroupProps) => (
  <fieldset className="flex flex-col gap-3 rounded-container border border-edge container-p-4">
    <legend className="px-2 font-semibold">{legend}</legend>
    {hint === undefined ? null : <p className="text-meta">{hint}</p>}
    {children}
    {error === undefined ? null : (
      <p role="alert" className="text-meta text-error">
        {error}
      </p>
    )}
  </fieldset>
);
