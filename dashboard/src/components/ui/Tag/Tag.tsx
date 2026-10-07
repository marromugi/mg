import type { ReactNode } from "react";

// A short word in a pill, for a kind or a property of the thing beside
// it.
export const Tag = ({ children }: { children: ReactNode }) => (
  <span className="inline-flex items-center rounded-full border border-edge px-3 py-1 text-xs whitespace-nowrap">
    {children}
  </span>
);
