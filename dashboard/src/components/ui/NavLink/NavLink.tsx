import type { ReactNode } from "react";
import { tv } from "tailwind-variants";

const navLink = tv({
  base: "block rounded-control px-3 control-py-2 transition duration-160 ease-out focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
  variants: {
    state: {
      default: "hover:bg-edge",
      current: "bg-accent/15 font-semibold text-accent-text",
    },
  },
  defaultVariants: { state: "default" },
});

type NavLinkProps = {
  href: string;
  state?: "default" | "current";
  children: ReactNode;
};

export const NavLink = ({ href, state, children }: NavLinkProps) => (
  <a
    className={navLink({ state })}
    href={href}
    aria-current={state === "current" ? "page" : undefined}
  >
    {children}
  </a>
);
