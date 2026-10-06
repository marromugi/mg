import type { ReactNode } from "react";

export const Heading = ({ children }: { children: ReactNode }) => (
  <h1 className="mb-4 text-heading font-bold">{children}</h1>
);
