import type { ReactNode } from "react";
import {
  Header,
  Icon,
  IconButton,
  LogoIcon,
  PlusIcon,
  Sidebar,
} from "../../ui/index.js";
import { SchemeToggle } from "./SchemeToggle.js";
import { useNavigation, type Place } from "./hooks/useNavigation.js";

// The frame every page of the app sits in: the menu down the side, the
// bar across the top, and the page's own content in the space left.
export const AppFrame = ({
  current,
  children,
}: {
  current: Place;
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
        <Header
          end={
            <IconButton
              icon={PlusIcon}
              label="ハーネスを作る"
              labelSide="bottom"
              href="/harnesses/new"
            />
          }
        />
        <main className="min-h-0 flex-1 overflow-auto">{children}</main>
      </div>
    </div>
  );
};
