import {
  FloatingTree,
  useFloatingParentNodeId,
} from "@floating-ui/react";
import type { ReactNode } from "react";

// Lets floating parts that open from inside one another know of each
// other, so that a press in an inner one does not count as a press
// outside the outer one. The outermost part starts the tree; the ones
// inside it join it.
export const Nested = ({ children }: { children: ReactNode }) =>
  useFloatingParentNodeId() === null ? (
    <FloatingTree>{children}</FloatingTree>
  ) : (
    children
  );
