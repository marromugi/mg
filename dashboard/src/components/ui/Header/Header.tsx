import type { ReactNode } from "react";

type HeaderProps = {
  start?: ReactNode;
  end?: ReactNode;
};

// A bar across the top of a page: `start` sits at its leading end and
// `end` at its trailing end.
export const Header = ({ start, end }: HeaderProps) => (
  <header className="flex w-full items-center justify-between gap-3 rounded-full bg-surface p-2">
    <div className="flex min-h-10 items-center gap-2">{start}</div>
    <div className="flex min-h-10 items-center gap-2">{end}</div>
  </header>
);
