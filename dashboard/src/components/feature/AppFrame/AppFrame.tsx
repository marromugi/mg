import type { ReactNode } from "react";
import {
  Header,
  Icon,
  IconButton,
  LogoIcon,
  Sidebar,
} from "../../ui/index.js";
import { SchemeToggle } from "./SchemeToggle.js";
import { useNavigation, type Place } from "./hooks/useNavigation.js";

// The frame every page of the app sits in: the menu down the side, the
// bar across the top with the page's `actions` at its end, and the
// page's own content in the space left.
export const AppFrame = ({
  current,
  actions,
  children,
}: {
  current: Place;
  actions?: ReactNode;
  children?: ReactNode;
}) => {
  const items = useNavigation(current);

  return (
    <div className="flex h-screen gap-3 p-3">
      <Sidebar
        label="メニュー"
        top={
          <span className="inline-flex size-10 items-center justify-center">
            <Icon icon={LogoIcon} size="lg" tone="accent" />
          </span>
        }
        bottom={<SchemeToggle />}
      >
        {items.map((item) => (
          <IconButton
            key={item.place}
            icon={item.icon}
            label={item.label}
            href={item.href}
            state={item.state}
          />
        ))}
      </Sidebar>
      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <Header end={actions} />
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
};
