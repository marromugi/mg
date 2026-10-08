import {
  HomeIcon,
  KeyIcon,
  ListIcon,
  type IconSource,
} from "../../../ui/Icon/index.js";

export type Place = "home" | "harnesses" | "api-keys";

export type NavigationItem = {
  place: Place;
  href: string;
  label: string;
  icon: IconSource;
  state: "idle" | "current";
};

const PLACES: Omit<NavigationItem, "state">[] = [
  { place: "home", href: "/", label: "ホーム", icon: HomeIcon },
  {
    place: "harnesses",
    href: "/harnesses",
    label: "エージェント",
    icon: ListIcon,
  },
  {
    place: "api-keys",
    href: "/api-keys",
    label: "API キー",
    icon: KeyIcon,
  },
];

// The places of the app in menu order, with the one the page belongs to
// marked as current.
export const useNavigation = (current: Place): NavigationItem[] =>
  PLACES.map((item) => ({
    ...item,
    state: item.place === current ? "current" : "idle",
  }));
