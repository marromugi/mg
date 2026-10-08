import type { ReactNode } from "react";

type SidebarProps = {
  label: string;
  top: ReactNode;
  bottom: ReactNode;
  children: ReactNode;
};

// A narrow column: `top` and `bottom` sit at the ends, and the
// navigation in `children` is centred in the space between them.
export const Sidebar = ({
  label,
  top,
  bottom,
  children,
}: SidebarProps) => (
  <aside className="flex h-full w-14 flex-col items-center rounded-full bg-surface p-2">
    {top}
    <nav
      aria-label={label}
      className="flex flex-1 flex-col items-center justify-center gap-3"
    >
      {children}
    </nav>
    {bottom}
  </aside>
);
