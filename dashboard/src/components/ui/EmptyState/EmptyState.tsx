import type { ReactNode } from "react";

export const EmptyState = ({
  title,
  children,
}: {
  title: string;
  children?: ReactNode;
}) => (
  <section className="rounded-container border border-edge container-p-6">
    <h2 className="font-semibold">{title}</h2>
    {children === undefined ? null : <p className="mt-2">{children}</p>}
  </section>
);
