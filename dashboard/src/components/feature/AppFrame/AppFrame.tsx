import type { ReactNode } from "react";
import { NavLink } from "../../ui/index.js";
import { useNavigation, type Place } from "./hooks/useNavigation.js";

export const AppFrame = ({
  current,
  children,
}: {
  current: Place;
  children: ReactNode;
}) => {
  const items = useNavigation(current);

  return (
    <div className="flex min-h-screen">
      <nav
        aria-label="メニュー"
        className="w-48 shrink-0 border-r border-edge p-4"
      >
        <ul className="flex flex-col gap-1">
          {items.map((item) => (
            <li key={item.place}>
              <NavLink href={item.href} state={item.state}>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
      <main className="max-w-page flex-1 px-8 py-6">{children}</main>
    </div>
  );
};
