import type { ReactNode } from "react";

export const Role = ({ children }: { children: ReactNode }) => (
  <div className="text-xs font-semibold uppercase opacity-70">
    {children}
  </div>
);
