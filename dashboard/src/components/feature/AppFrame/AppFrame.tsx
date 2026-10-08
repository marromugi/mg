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
// bar across the top with `start` at its leading end and the page's
// `actions` at its trailing end, and the page's own content in the
// space left. `aside` stands beside all of that, as tall as the menu.
export const AppFrame = ({
  current,
  start,
  actions,
  aside,
  children,
}: {
  current: Place;
  start?: ReactNode;
  actions?: ReactNode;
  aside?: ReactNode;
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
        <Header start={start} end={actions} />
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
      {aside}
    </div>
  );
};
