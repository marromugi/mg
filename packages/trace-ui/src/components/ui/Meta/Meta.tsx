import type { ReactNode } from "react";

export const Meta = ({ children }: { children: ReactNode }) => (
  <p className="text-meta font-normal opacity-70">{children}</p>
);
