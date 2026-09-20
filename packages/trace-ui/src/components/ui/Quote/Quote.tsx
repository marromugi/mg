import type { ReactNode } from "react";

export const Quote = ({ children }: { children: ReactNode }) => (
  <div className="my-1.5 border-l-3 border-edge px-2.5 py-1">
    {children}
  </div>
);
