import { IconButton, ThemeIcon } from "../../ui/index.js";

// Turns the page to the other colour scheme. The choice lasts until the
// page is left.
export const SchemeToggle = () => (
  <IconButton
    icon={ThemeIcon}
    label="配色を切り替える"
    type="button"
    onClick={() => {
      const root = document.documentElement;
      const dark =
        root.style.colorScheme === ""
          ? matchMedia("(prefers-color-scheme: dark)").matches
          : root.style.colorScheme === "dark";
      root.style.colorScheme = dark ? "light" : "dark";
    }}
  />
);
